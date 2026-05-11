import { describe, it, expect } from "vitest";

/**
 * Integration tests for /auth routes — requires running backend.
 * Skips if BACKEND_URL is not set (sync check, avoids async beforeAll timing issue).
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const testEmail = `test-auth-${uid}@test.local`;
const testPassword = "integration-test-password-123";

interface ApiResponse {
  ok: boolean;
  error?: string;
  data?: {
    token?: string;
    user?: { id: string; email: string; role: string };
  };
}

let authToken = "";

describe.skipIf(!BASE)("/auth routes integration", () => {
  // F30 (security-audit-2026-04-09): /auth/register no longer hands back the
  // JWT or a user object — that was an enumeration oracle when paired with
  // the 409-on-duplicate branch. The response is a generic message either
  // way; callers must verify and then explicitly /auth/login to obtain a
  // token.
  it("POST /auth/register returns generic message for new email (no auto-login)", { timeout: 15_000 }, async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword, tosAccepted: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { message?: string; verificationToken?: string; token?: string; user?: unknown } };
    expect(body.ok).toBe(true);
    expect(body.data?.message).toContain("verification email");
    // No token, no user object — those would be the enumeration oracle.
    expect(body.data?.token).toBeUndefined();
    expect(body.data?.user).toBeUndefined();
    // verificationToken is exposed only in dev (ALLOW_AUTO_SETUP=true) so
    // integration tests can drive /auth/verify without scraping Mailpit.
    expect(body.data?.verificationToken).toBeTruthy();

    // Verify + login to obtain a token for downstream tests.
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.data!.verificationToken }),
    });
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginBody = (await loginRes.json()) as ApiResponse;
    authToken = loginBody.data?.token ?? "";
    expect(authToken).toBeTruthy();
  });

  // F30 regression: re-registering with the same email must return a body
  // that is byte-identical to the new-email response (modulo the
  // verificationToken, which is dev-only and absent here because no new user
  // was created). No 409, no "already registered" text.
  it("F30: re-registering an existing email returns the same generic message (no enumeration)", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword, tosAccepted: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { message?: string; verificationToken?: string; token?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.message).toContain("verification email");
    expect(body.data?.token).toBeUndefined();
    // No verificationToken on the duplicate branch — there is no new user
    // to verify. The dev-only field's presence/absence is the only signal,
    // and it's gated to dev so production responses are byte-identical.
    expect(body.data?.verificationToken).toBeUndefined();
  });

  it("POST /auth/register validates input", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(false);
  });

  it("POST /auth/register requires tosAccepted=true", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-tos-${Date.now()}@test.local`,
        password: "valid-password-123",
        // tosAccepted intentionally omitted
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(false);
  });

  it("POST /auth/register rejects tosAccepted=false", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-tos-false-${Date.now()}@test.local`,
        password: "valid-password-123",
        tosAccepted: false,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/login with valid credentials", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword, tosAccepted: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.token).toBeDefined();
    expect(body.data?.user?.email).toBe(testEmail);

    authToken = body.data?.token ?? "";
  });

  it("POST /auth/login with wrong password", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: "wrong-password-123" }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(false);
  });

  it("GET /auth/me with valid token", async () => {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.user?.email).toBe(testEmail);
    expect(body.data?.user?.id).toBeDefined();
  });

  it("GET /auth/me without token", async () => {
    const res = await fetch(`${BASE}/auth/me`);

    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(false);
  });
});

/**
 * F15 hard gate: unverified users cannot create API keys.
 * Login still succeeds (so the user can land on the dashboard and see the
 * "verify your email" banner), but POST /keys/daily and /keys/scoped return
 * 403 with error: "email_not_verified" until the verification link is used.
 */
describe.skipIf(!BASE)("F15 — email verification hard gate", () => {
  const gateUid = Date.now() + 1;
  const gateEmail = `test-gate-${gateUid}@test.local`;
  const gatePassword = "gate-test-password-123";
  let gateToken = "";
  let gateVerificationToken = "";

  it("POST /auth/register returns a verificationToken in dev mode (no JWT — F30)", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: gateEmail, password: gatePassword, tosAccepted: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { token?: string; verificationToken?: string } };
    expect(body.ok).toBe(true);
    // F30: no JWT auto-login on register.
    expect(body.data?.token).toBeUndefined();
    gateVerificationToken = body.data?.verificationToken ?? "";
    expect(gateVerificationToken).toBeTruthy();
  });

  it("POST /auth/login succeeds for unverified user (so they can see what to do next)", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: gateEmail, password: gatePassword }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { token?: string; emailVerified?: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data?.emailVerified).toBe(false);
    // Login is now where the unverified user picks up their JWT.
    gateToken = body.data?.token ?? "";
    expect(gateToken).toBeTruthy();
  });

  it("POST /keys/daily is blocked for unverified user with email_not_verified", async () => {
    const res = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gateToken}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok?: boolean; error?: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("email_not_verified");
    expect(body.message).toContain("Verify your email");
  });

  it("POST /keys/scoped is blocked for unverified user", async () => {
    const res = await fetch(`${BASE}/keys/scoped`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gateToken}`,
      },
      body: JSON.stringify({
        readRecipeBookIds: ["00000000-0000-0000-0000-000000000000"],
        writeRecipeBookIds: ["00000000-0000-0000-0000-000000000000"],
        defaultWriteRecipeBookId: "00000000-0000-0000-0000-000000000000",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("email_not_verified");
  });

  it("POST /auth/verify is idempotent — calling twice with the same token still succeeds", async () => {
    // This is a regression guard. React StrictMode in dev double-fires
    // useEffect, page refreshes re-call /auth/verify, and the verify email
    // could be opened in two tabs. All three cases must yield "verified" both
    // times, not "Invalid or expired" on the second call. The backend
    // achieves this by COALESCE-ing email_verified_at and NOT clearing the
    // token in the UPDATE. Token expires naturally after 24h.
    const idempotentUid = Date.now() + 100;
    const idempotentEmail = `test-verify-idem-${idempotentUid}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: idempotentEmail, password: "idem-pw-123", tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Missing verificationToken");

    // First call — should succeed
    const first = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { ok: boolean; data?: { verified?: boolean } };
    expect(firstBody.data?.verified).toBe(true);

    // Second call with the SAME token — must also succeed (StrictMode case)
    const second = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { ok: boolean; data?: { verified?: boolean } };
    expect(secondBody.data?.verified).toBe(true);

    // Third call (refresh case) — also success
    const third = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    expect(third.status).toBe(200);
  });

  it("POST /auth/verify with valid token unblocks key creation", async () => {
    const verifyRes = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: gateVerificationToken }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as { ok: boolean; data?: { verified?: boolean } };
    expect(verifyBody.data?.verified).toBe(true);

    // Now key generation should succeed
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gateToken}` },
    });
    expect(keyRes.status).toBe(200);
    const keyBody = (await keyRes.json()) as { ok: boolean; data?: { key?: string } };
    expect(keyBody.ok).toBe(true);
    expect(keyBody.data?.key).toBeTruthy();
  });
});

/**
 * Password reset flow — /auth/forgot-password + /auth/reset-password.
 * Verifies happy path, account-enumeration safety, expired/reused/invalid
 * token rejection, and that the new password actually works for login.
 */
describe.skipIf(!BASE)("password reset flow", () => {
  const resetUid = Date.now() + 2;
  const resetEmail = `test-reset-${resetUid}@test.local`;
  const originalPassword = "original-password-123";
  const newPassword = "new-secure-password-456";
  let resetToken = "";

  it("registers + verifies a user (setup)", async () => {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetEmail, password: originalPassword, tosAccepted: true }),
    });
    expect(reg.status).toBe(200);
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Missing verificationToken");
    const ver = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    expect(ver.status).toBe(200);
  });

  it("POST /auth/forgot-password returns 200 for known email and yields a token in dev mode", async () => {
    const res = await fetch(`${BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetEmail }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { message?: string; resetToken?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.message).toContain("If an account exists");
    resetToken = body.data?.resetToken ?? "";
    expect(resetToken).toBeTruthy();
  });

  it("POST /auth/forgot-password returns 200 for UNKNOWN email (no enumeration)", async () => {
    const res = await fetch(`${BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `nonexistent-${resetUid}@test.local` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { message?: string; resetToken?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.message).toContain("If an account exists");
    // No resetToken for unknown email — the response shape should be
    // indistinguishable from the known-email case in production. (In dev
    // mode the absence of the token is the only difference, and that field
    // is suppressed in production.)
    expect(body.data?.resetToken).toBeUndefined();
  });

  it("POST /auth/reset-password rejects an invalid token", async () => {
    const res = await fetch(`${BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "obviously-fake-token", newPassword: "doesnt-matter-789" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid or expired");
  });

  it("POST /auth/reset-password rejects newPassword shorter than 8 chars", async () => {
    const res = await fetch(`${BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, newPassword: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/reset-password with valid token sets the new password", async () => {
    const res = await fetch(`${BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, newPassword }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { reset?: boolean; email?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.reset).toBe(true);
    expect(body.data?.email).toBe(resetEmail);
  });

  it("login with the new password succeeds", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetEmail, password: newPassword }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { token?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.token).toBeTruthy();
  });

  it("login with the old password fails", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetEmail, password: originalPassword }),
    });
    expect(res.status).toBe(401);
  });

  it("the reset token cannot be reused (single-use)", async () => {
    const res = await fetch(`${BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, newPassword: "yet-another-password-789" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Invalid or expired");
  });
});

/**
 * Data export — /auth/me/export. Returns a JSON file of the user's
 * recipes, evidence, references, group memberships, and API key metadata.
 * Promise from the landing page: "Export all your data anytime."
 */
describe.skipIf(!BASE)("data export", () => {
  const exportUid = Date.now() + 3;
  const exportEmail = `test-export-${exportUid}@test.local`;
  const exportPassword = "export-test-password-123";
  let exportToken = "";

  it("registers + verifies a user (setup)", async () => {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: exportEmail, password: exportPassword, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Missing verificationToken");
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    // F30: register no longer returns a JWT — log in to obtain one.
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: exportEmail, password: exportPassword }),
    });
    const loginBody = (await login.json()) as { data?: { token?: string } };
    exportToken = loginBody.data?.token ?? "";
    if (!exportToken) throw new Error("Missing login token");
  });

  it("GET /auth/me/export without auth returns 401", async () => {
    const res = await fetch(`${BASE}/auth/me/export`);
    expect(res.status).toBe(401);
  });

  it("GET /auth/me/export returns a JSON file with the expected top-level shape", async () => {
    const res = await fetch(`${BASE}/auth/me/export`, {
      headers: { Authorization: `Bearer ${exportToken}` },
    });
    expect(res.status).toBe(200);

    // Content-Disposition should indicate a downloadable attachment with a
    // filename that ties to the export, so browsers save it sensibly.
    const disp = res.headers.get("Content-Disposition") ?? "";
    expect(disp).toContain("attachment");
    expect(disp).toContain(".json");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body["schemaVersion"]).toBe(1);
    expect(body["exportedAt"]).toBeTruthy();
    expect(body["user"]).toBeDefined();
    expect(Array.isArray(body["organizations"])).toBe(true);
    expect(Array.isArray(body["groupMemberships"])).toBe(true);
    expect(Array.isArray(body["apiKeys"])).toBe(true);
    expect(Array.isArray(body["traces"])).toBe(true);
    expect(Array.isArray(body["evidence"])).toBe(true);
    expect(Array.isArray(body["references"])).toBe(true);
    expect(Array.isArray(body["traceEvidence"])).toBe(true);
    expect(Array.isArray(body["traceReferences"])).toBe(true);
    expect(Array.isArray(body["evidenceReferences"])).toBe(true);
  });

  it("GET /auth/me/export never includes raw API key values", async () => {
    // Generate a scoped key so apiKeys array has something to inspect.
    const groupsRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${exportToken}` },
    });
    const groupsBody = (await groupsRes.json()) as { data: Array<{ id: string }> };
    const gid = groupsBody.data[0]?.id;
    expect(gid).toBeTruthy();

    await fetch(`${BASE}/keys/scoped`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${exportToken}` },
      body: JSON.stringify({
        readRecipeBookIds: [gid],
        writeRecipeBookIds: [gid],
        defaultWriteRecipeBookId: gid,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        label: "export-test-key",
      }),
    });

    const res = await fetch(`${BASE}/auth/me/export`, {
      headers: { Authorization: `Bearer ${exportToken}` },
    });
    const body = (await res.json()) as { apiKeys: Array<Record<string, unknown>> };
    expect(body.apiKeys.length).toBeGreaterThan(0);
    for (const key of body.apiKeys) {
      // Raw key never leaves the server — only the prefix is safe to export.
      expect(key["key"]).toBeUndefined();
      expect(key["keyPrefix"]).toBeTruthy();
    }
  });
});
