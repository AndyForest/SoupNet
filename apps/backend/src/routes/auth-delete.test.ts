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

  // Regression (2026-07-05 integrator migration review of 0027): the auth.ts
  // deletion transaction's explicit table list doesn't cover trace_reactions
  // / check_feedback_stars, and the trace FK only cascades reactions on the
  // user's OWN traces. Without a users-FK cascade, a deleted user's
  // reactions/stars on OTHER users' shared-book traces would survive as
  // orphaned personal data. The user_id → users.id ON DELETE CASCADE FKs are
  // what this test pins down.
  it("cascades the deleted user's reactions and stars on ANOTHER user's shared-book trace", { timeout: 30_000 }, async () => {
    const userA = await provisionUser("react-owner");
    const userB = await provisionUser("react-deleter");

    // A checks a recipe (in A's default book) and logs feedback on it.
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    const keyA = keyBody.data?.key ?? "";
    expect(keyA).toBeTruthy();

    const checkParams = new URLSearchParams({
      key: keyA,
      trace: `As a developer working on shared books, I chose reaction cascades so that deleted accounts leave no orphaned reactions. (${Date.now()})`,
      ef: `Interpretation.\n> "quote"\n-- auth-delete test`,
      format: "json",
    });
    const checkRes = await fetch(`${BASE}/check?${checkParams.toString()}`, { headers: { Accept: "application/json" } });
    const checkJson = (await checkRes.json()) as { data?: { recipeId?: string } };
    const traceId = checkJson.data?.recipeId ?? "";
    expect(traceId).toBeTruthy();

    const fbRes = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
      body: JSON.stringify({
        trace_id: traceId,
        kind: "check-feedback",
        impact: "subtle",
        disposition: "proceeded",
        story_fulfilled: "yes",
        story: "As a developer working on deletion tests, I wanted a feedback row so that B can star it.",
      }),
    });
    const fbJson = (await fbRes.json()) as { data?: { results?: Array<{ feedbackId?: string }> } };
    const feedbackId = fbJson.data?.results?.[0]?.feedbackId ?? "";
    expect(feedbackId).toBeTruthy();

    // Make the book shared: add B as a member of the trace's group (fixture
    // via SQL — the invite flow isn't what's under test here).
    const postgres = (await import("postgres")).default;
    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      const traceRows: Array<{ group_id: string }> = await sql`
        SELECT group_id FROM claimnet.traces WHERE id = ${traceId}::uuid
      `;
      const groupId = traceRows[0]?.group_id;
      expect(groupId).toBeTruthy();
      await sql`
        INSERT INTO claimnet.group_members (group_id, user_id, role)
        VALUES (${groupId!}::uuid, ${userB.userId}::uuid, 'member')
      `;

      // B reacts to A's trace and stars A's feedback row (JWT surfaces).
      const reactRes = await fetch(`${BASE}/traces/${traceId}/reaction`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.token}` },
        body: JSON.stringify({ reaction: "still_true" }),
      });
      expect(reactRes.status).toBe(200);
      const starRes = await fetch(`${BASE}/traces/feedback/${feedbackId}/star`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${userB.token}` },
      });
      expect(starRes.status).toBe(200);

      // Sanity: B's rows exist before deletion.
      const beforeReactions: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.trace_reactions WHERE user_id = ${userB.userId}::uuid
      `;
      const beforeStars: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.check_feedback_stars WHERE user_id = ${userB.userId}::uuid
      `;
      expect(beforeReactions[0]?.n).toBe(1);
      expect(beforeStars[0]?.n).toBe(1);

      // B deletes their account.
      const delRes = await fetch(`${BASE}/auth/me`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.token}` },
        body: JSON.stringify({ password: userB.password }),
      });
      expect(delRes.status).toBe(200);

      // B's cross-user reaction and star are gone (users-FK cascade)…
      const afterReactions: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.trace_reactions WHERE user_id = ${userB.userId}::uuid
      `;
      const afterStars: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.check_feedback_stars WHERE user_id = ${userB.userId}::uuid
      `;
      expect(afterReactions[0]?.n).toBe(0);
      expect(afterStars[0]?.n).toBe(0);

      // …while A's trace and A's feedback row survive.
      const traceStill: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${traceId}::uuid
      `;
      const feedbackStill: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.check_feedback WHERE id = ${feedbackId}::uuid
      `;
      expect(traceStill[0]?.n).toBe(1);
      expect(feedbackStill[0]?.n).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
