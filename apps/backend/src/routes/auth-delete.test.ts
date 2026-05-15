import { describe, it, expect } from "vitest";

/**
 * Integration tests for DELETE /auth/me (self-serve account deletion).
 * Each test scenario provisions its own throwaway user so they don't
 * collide; the deletion endpoint is destructive by design.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface RegisterResponse {
  data?: { verificationToken?: string };
}
interface LoginResponse {
  data?: { token?: string };
}

async function provisionUser(suffix: string): Promise<{ token: string; userId: string; email: string; password: string }> {
  const email = `delete-${Date.now()}-${suffix}@test.local`;
  const password = "delete-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as RegisterResponse;
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error("Setup: verificationToken missing");
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as LoginResponse;
  const token = loginBody.data?.token;
  if (!token) throw new Error("Setup: login failed");
  const meRes = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meBody = (await meRes.json()) as { data?: { user?: { id: string } } };
  const userId = meBody.data?.user?.id;
  if (!userId) throw new Error("Setup: /auth/me missing id");
  return { token, userId, email, password };
}

describe.skipIf(!BASE)("DELETE /auth/me — self-serve account deletion", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/auth/me`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "anything" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a missing password", { timeout: 15_000 }, async () => {
    const user = await provisionUser("missing-pwd");
    const res = await fetch(`${BASE}/auth/me`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a request with the wrong password", { timeout: 15_000 }, async () => {
    const user = await provisionUser("wrong-pwd");
    const res = await fetch(`${BASE}/auth/me`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ password: "this is not the password" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/incorrect/i);

    // The user should still be able to log in afterwards — the rejected
    // delete must not have side effects.
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    expect(login.status).toBe(200);
  });

  it("happy path: deletes the user, their api_keys, and revokes the login", { timeout: 20_000 }, async () => {
    const user = await provisionUser("happy");

    // Mint a daily key so we can prove key deletion happened.
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    const apiKey = keyBody.data?.key;
    expect(apiKey).toBeTruthy();

    // The key works before deletion.
    const beforeBriefing = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(beforeBriefing.status).toBe(200);

    // Delete the account.
    const delRes = await fetch(`${BASE}/auth/me`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ password: user.password }),
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);

    // Login should fail (user is gone).
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    expect(login.status).toBeGreaterThanOrEqual(400);

    // The previously-minted API key should be revoked too.
    const afterBriefing = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(afterBriefing.status).toBeGreaterThanOrEqual(400);
  });
});
