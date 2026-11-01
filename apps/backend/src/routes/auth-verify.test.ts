import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { authRoutes } from "./auth";

// F144, recipe 450a107b: someone who registered a password on another person's
// address can't keep access once the real owner proves the mailbox. Scenarios
// ACC-VERIFY-* in docs/product-specs/accounts.feature.

const BASE = process.env["BACKEND_URL"] ?? "";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = "verify-route-test-pw";
const JSON_HEADERS = { "Content-Type": "application/json" };

type Json = Record<string, unknown>;

let n = 0;
function nextEmail(label: string): string {
  n += 1;
  return `test-verify-${label}-${run}-${n}@test.local`;
}

async function post(path: string, body: Json, session?: string): Promise<{ status: number; json: Json; data: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(session ? { Authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Json;
  return { status: res.status, json, data: (json["data"] ?? {}) as Json };
}

async function register(label: string): Promise<{ email: string; token: string; proof: string }> {
  const email = nextEmail(label);
  const { data } = await post("/auth/register", { email, password: PASSWORD, tosAccepted: true });
  const token = data["verificationToken"];
  const proof = data["signupProof"];
  if (typeof token !== "string" || typeof proof !== "string") throw new Error(`register returned no token or proof for ${email}`);
  return { email, token, proof };
}

/** An unverified account's session: sign-in issues one so verify-pending can work. */
async function signIn(email: string, password = PASSWORD): Promise<string> {
  const { status, data } = await post("/auth/login", { email, password });
  if (status !== 200 || typeof data["token"] !== "string") throw new Error(`login failed for ${email}: ${status}`);
  return data["token"];
}

async function row(email: string): Promise<{ verified: boolean; waitlisted: boolean }> {
  const rows = await getDb().execute(sql`
    SELECT (email_verified_at IS NOT NULL) AS verified, (waitlisted_at IS NOT NULL) AS waitlisted
    FROM claimnet.users WHERE email = ${email}
  `);
  return (rows as unknown as Array<{ verified: boolean; waitlisted: boolean }>)[0]!;
}

/** A status that says whether a session still works on an unverified or verified account. */
async function meStatus(session: string): Promise<number> {
  return (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${session}` } })).status;
}

async function waitPastCurrentSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

async function resetToken(email: string): Promise<string> {
  const { data } = await post("/auth/forgot-password", { email });
  const token = data["resetToken"];
  if (typeof token !== "string") throw new Error(`forgot-password returned no reset token for ${email}`);
  return token;
}

describe.skipIf(!BASE)("POST /auth/verify and /auth/reset-password: proving a mailbox (F144)", () => {
  it("ACC-VERIFY-01: a link opened with the sign-up's own session verifies with no password", async () => {
    const { email, token } = await register("own-session");
    const session = await signIn(email);
    const { status, data } = await post("/auth/verify", { token }, session);
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email, ownSession: true });
    expect(data["token"]).toBeUndefined();
    expect((await row(email)).verified).toBe(true);
  });

  it("ACC-VERIFY-02: with no session, a link asks for the password and changes nothing (a mail scanner verifies nothing)", async () => {
    const { email, token } = await register("no-session");
    for (let click = 0; click < 2; click += 1) {
      const { status, data } = await post("/auth/verify", { token });
      expect(status).toBe(200);
      expect(data).toEqual({ verified: false, passwordRequired: true, email, waitlisted: false });
    }
    expect((await row(email)).verified).toBe(false);
  });

  it("ACC-VERIFY-03: with no session, the right password verifies and signs the person in", async () => {
    const { email, token } = await register("right-password");
    const { status, data } = await post("/auth/verify", { token, password: PASSWORD });
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email, ownSession: false });
    expect((await row(email)).verified).toBe(true);
    // A working session on a verified account, stamped as a sign-in.
    const res = await fetch(`${BASE}/keys/daily`, { method: "POST", headers: { Authorization: `Bearer ${String(data["token"])}` } });
    expect(res.status).toBe(200);
    const rows = await getDb().execute(sql`SELECT last_login_at FROM claimnet.users WHERE email = ${email}`);
    expect((rows as unknown as Array<{ last_login_at: unknown }>)[0]?.last_login_at).toBeTruthy();
  });

  it("ACC-VERIFY-13: a suspended or org-disabled account verifies with its password and gets no session, as at sign-in", async () => {
    const { email, token } = await register("suspended");
    await getDb().execute(sql`UPDATE claimnet.users SET suspended_at = now() WHERE email = ${email}`);
    const { status, data } = await post("/auth/verify", { token, password: PASSWORD });
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email });
    expect(data["token"]).toBeUndefined();
    expect((await row(email)).verified).toBe(true);
    expect((await post("/auth/login", { email, password: PASSWORD })).json["error"]).toBe("account_suspended");
  });

  it("ACC-VERIFY-04: the wrong password is refused and changes nothing", async () => {
    const { email, token } = await register("wrong-password");
    const { status, json } = await post("/auth/verify", { token, password: "not-the-password" });
    expect(status).toBe(401);
    expect(json).toMatchObject({ ok: false, error: "wrong_password" });
    expect((await row(email)).verified).toBe(false);
  });

  it("ACC-VERIFY-05: another account's session, or a dead one, is not proof", async () => {
    const other = await register("other-account");
    await post("/auth/verify", { token: other.token, password: PASSWORD });
    const otherSession = await signIn(other.email);
    const { email, token } = await register("not-yours");

    for (const session of [otherSession, "not.a.jwt"]) {
      const { status, data } = await post("/auth/verify", { token }, session);
      expect(status).toBe(200);
      expect(data).toMatchObject({ verified: false, passwordRequired: true });
    }
    expect((await row(email)).verified).toBe(false);

    // A session cut by a reset no longer counts as the sign-up's own.
    const held = await register("cut-session");
    const heldSession = await signIn(held.email);
    await waitPastCurrentSecond();
    const reset = await post("/auth/reset-password", { token: await resetToken(held.email), newPassword: "owner-new-password-1" });
    expect(reset.status).toBe(200);
    expect((await post("/auth/verify", { token: held.token }, heldSession)).data).toMatchObject({ verified: true, ownSession: false });
  });

  it("ACC-VERIFY-06: forgot-password on an unverified account takes it back from whoever registered it", async () => {
    const { email, token } = await register("takeover");
    const strangerSession = await signIn(email);
    expect(await meStatus(strangerSession)).toBe(200);

    // The owner, at the link, doesn't know the password, and takes the reset route.
    expect((await post("/auth/verify", { token })).data).toMatchObject({ passwordRequired: true });
    expect((await row(email)).verified).toBe(false);
    await waitPastCurrentSecond();
    const newPassword = "owner-new-password-2";
    const reset = await post("/auth/reset-password", { token: await resetToken(email), newPassword });
    expect(reset.status).toBe(200);

    expect((await row(email)).verified).toBe(true);
    expect(await meStatus(strangerSession)).toBe(401);
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(401);
    await waitPastCurrentSecond();
    expect(await meStatus(await signIn(email, newPassword))).toBe(200);
  });

  it("ACC-VERIFY-07: a reset on a verified account cuts its sessions and keeps its verification time", async () => {
    const { email, token } = await register("verified-reset");
    await post("/auth/verify", { token, password: PASSWORD });
    const before = await getDb().execute(sql`SELECT email_verified_at FROM claimnet.users WHERE email = ${email}`);
    const session = await signIn(email);
    expect(await meStatus(session)).toBe(200);
    const minted = await fetch(`${BASE}/keys/daily`, { method: "POST", headers: { Authorization: `Bearer ${session}` } });
    expect(minted.status).toBe(200);
    const key = ((await minted.json()) as { data?: { key?: string } }).data?.key;
    expect(key).toBeTruthy();

    await waitPastCurrentSecond();
    expect((await post("/auth/reset-password", { token: await resetToken(email), newPassword: "next-password-345" })).status).toBe(200);

    expect(await meStatus(session)).toBe(401);
    // A person who forgot a password keeps their agents.
    expect((await fetch(`${BASE}/health/version`, { headers: { Authorization: `Bearer ${key}` } })).status).toBe(200);
    const after = await getDb().execute(sql`SELECT email_verified_at FROM claimnet.users WHERE email = ${email}`);
    expect(after).toEqual(before);
  });

  it("ACC-VERIFY-08: a reset token that doesn't match changes nothing", async () => {
    const { email } = await register("bad-reset");
    const session = await signIn(email);
    await waitPastCurrentSecond();
    expect((await post("/auth/reset-password", { token: "0".repeat(64), newPassword: "another-password-1" })).status).toBe(400);
    expect((await row(email)).verified).toBe(false);
    expect(await meStatus(session)).toBe(200);
  });

  it("ACC-VERIFY-09: a repeat click on a verified account needs no password and keeps the time", async () => {
    const { email, token } = await register("repeat");
    await post("/auth/verify", { token, password: PASSWORD });
    const before = await getDb().execute(sql`SELECT email_verified_at FROM claimnet.users WHERE email = ${email}`);
    const { status, data } = await post("/auth/verify", { token });
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email, ownSession: false });
    expect(data["token"]).toBeUndefined();
    // A password on a repeat click isn't judged and signs nobody in, so a token isn't a way to test one.
    expect((await post("/auth/verify", { token, password: "not-the-password" })).status).toBe(200);
    expect((await post("/auth/verify", { token, password: PASSWORD })).data["token"]).toBeUndefined();
    const after = await getDb().execute(sql`SELECT email_verified_at FROM claimnet.users WHERE email = ${email}`);
    expect(after).toEqual(before);
  });

  it("ACC-VERIFY-10: a waitlisted account, which gets no session, verifies with its password and stays waitlisted", async () => {
    const { email, token } = await register("waitlisted");
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = now() WHERE email = ${email}`);

    expect((await post("/auth/verify", { token })).data).toEqual({ verified: false, passwordRequired: true, email, waitlisted: true });
    expect((await row(email)).verified).toBe(false);

    const { data } = await post("/auth/verify", { token, password: PASSWORD });
    expect(data).toMatchObject({ verified: true, waitlisted: true });
    expect(data["token"]).toBeUndefined();
    expect(await row(email)).toEqual({ verified: true, waitlisted: true });
    expect((await post("/auth/login", { email, password: PASSWORD })).json["error"]).toBe("waitlisted");
  });

  it("ACC-VERIFY-11: a waitlisted owner's reset verifies the address and leaves the place on the waitlist", async () => {
    const { email } = await register("waitlisted-reset");
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = now() WHERE email = ${email}`);
    expect((await post("/auth/reset-password", { token: await resetToken(email), newPassword: "waitlist-new-pw-1" })).status).toBe(200);
    expect(await row(email)).toEqual({ verified: true, waitlisted: true });
  });

  it("ACC-VERIFY-14: the same browser's sign-up proof verifies and signs in, with nothing typed", async () => {
    const { email, token, proof } = await register("proof");
    const { status, data } = await post("/auth/verify", { token, signupProof: proof });
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email, ownSession: false });
    expect((await row(email)).verified).toBe(true);
    const res = await fetch(`${BASE}/keys/daily`, { method: "POST", headers: { Authorization: `Bearer ${String(data["token"])}` } });
    expect(res.status).toBe(200);
    // Spent once verified: a repeat click with it signs nobody in.
    expect((await post("/auth/verify", { token, signupProof: proof })).data["token"]).toBeUndefined();
  });

  it("ACC-VERIFY-15: the proof says nothing about whether the address already has an account (F30)", async () => {
    const first = await register("f30");
    const again = await post("/auth/register", { email: first.email, password: "someone-else-pw-1", tosAccepted: true });
    expect(again.status).toBe(200);
    const proof = String(again.data["signupProof"]);
    expect(first.proof).toMatch(/^[0-9a-f]{64}$/);
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    const { verificationToken: _token, signupProof: _first, ...newBody } = (await post("/auth/register", { email: nextEmail("f30-new"), password: PASSWORD, tosAccepted: true })).data;
    const { signupProof: _second, ...existingBody } = again.data;
    expect(existingBody).toEqual(newBody);
    // And the existing-address proof verifies nothing, for that account.
    expect((await post("/auth/verify", { token: first.token, signupProof: proof })).data).toMatchObject({ verified: false, passwordRequired: true });
    expect((await row(first.email)).verified).toBe(false);
  });

  it("ACC-VERIFY-16: a stranger's proof needs the emailed token, and the owner's token needs the proof", async () => {
    const stranger = await register("proof-stranger");
    const other = await register("proof-other");
    // Proof with no real token.
    expect((await post("/auth/verify", { token: "no-such-token", signupProof: stranger.proof })).status).toBe(400);
    // The owner's token with no proof, or with another account's proof, or junk.
    for (const signupProof of [undefined, other.proof, "0".repeat(64), "short"]) {
      const { status, data } = await post("/auth/verify", { token: stranger.token, ...(signupProof ? { signupProof } : {}) });
      expect(status).toBe(200);
      expect(data).toMatchObject({ verified: false, passwordRequired: true });
    }
    expect((await row(stranger.email)).verified).toBe(false);
    expect((await post("/auth/verify", { token: stranger.token, signupProof: "x".repeat(129) })).status).toBe(400);
  });

  it("ACC-VERIFY-17: the proof survives a resend, and needs a token that hasn't expired", async () => {
    const { email, token, proof } = await register("proof-resend");
    const session = await signIn(email);
    const resent = await fetch(`${BASE}/auth/resend-verification`, { method: "POST", headers: { ...JSON_HEADERS, Authorization: `Bearer ${session}` }, body: "{}" });
    expect(resent.status).toBe(200);
    const rows = await getDb().execute(sql`SELECT email_verification_token AS t FROM claimnet.users WHERE email = ${email}`);
    const fresh = (rows as unknown as Array<{ t: string }>)[0]!.t;
    expect(fresh).not.toBe(token);
    expect((await post("/auth/verify", { token, signupProof: proof })).status).toBe(400);

    await getDb().execute(sql`UPDATE claimnet.users SET email_verification_token_created_at = now() - interval '25 hours' WHERE email = ${email}`);
    expect((await post("/auth/verify", { token: fresh, signupProof: proof })).status).toBe(400);
    expect((await row(email)).verified).toBe(false);

    await getDb().execute(sql`UPDATE claimnet.users SET email_verification_token_created_at = now() WHERE email = ${email}`);
    expect((await post("/auth/verify", { token: fresh, signupProof: proof })).data).toMatchObject({ verified: true });
  });

  it("ACC-VERIFY-18: the proof passes sign-in's checks: a waitlisted or switched-off account verifies and gets no session", async () => {
    const held = await register("proof-waitlisted");
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = now() WHERE email = ${held.email}`);
    const waitlisted = (await post("/auth/verify", { token: held.token, signupProof: held.proof })).data;
    expect(waitlisted).toMatchObject({ verified: true, waitlisted: true });
    expect(waitlisted["token"]).toBeUndefined();
    expect(await row(held.email)).toEqual({ verified: true, waitlisted: true });

    const off = await register("proof-suspended");
    await getDb().execute(sql`UPDATE claimnet.users SET suspended_at = now() WHERE email = ${off.email}`);
    const suspended = (await post("/auth/verify", { token: off.token, signupProof: off.proof })).data;
    expect(suspended).toMatchObject({ verified: true });
    expect(suspended["token"]).toBeUndefined();
  });

  it("ACC-VERIFY-19: after the owner resets, the stranger's proof and session are worth nothing", async () => {
    const { email, token, proof } = await register("proof-takeover");
    const strangerSession = await signIn(email);
    await waitPastCurrentSecond();
    expect((await post("/auth/reset-password", { token: await resetToken(email), newPassword: "owner-new-password-3" })).status).toBe(200);
    expect(await meStatus(strangerSession)).toBe(401);
    expect((await post("/auth/verify", { token, signupProof: proof })).data["token"]).toBeUndefined();
  });

  it("refuses a malformed request and an unknown token", async () => {
    expect((await post("/auth/verify", {})).status).toBe(400);
    expect((await post("/auth/verify", { token: 42 })).status).toBe(400);
    expect((await post("/auth/verify", { token: "x", password: 42 })).status).toBe(400);
    expect((await post("/auth/verify", { token: "no-such-token" })).status).toBe(400);
    const malformed = await fetch(`${BASE}/auth/verify`, { method: "POST", headers: JSON_HEADERS, body: "{not json" });
    expect(malformed.status).toBe(400);
  });

  // In process, because the gate's backend runs with DISABLE_RATE_LIMIT=true.
  it("ACC-VERIFY-12: password attempts share sign-in's limit, and asking for the prompt isn't an attempt", async () => {
    const { email, token } = await register("rate-limit");
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    try {
      const attempt = (body: Json, ip: string) =>
        authRoutes.request("/verify", { method: "POST", headers: { ...JSON_HEADERS, "x-real-ip": ip }, body: JSON.stringify(body) });
      const ip = `10.144.${n}.1`;
      for (let i = 0; i < 5; i += 1) {
        expect((await attempt({ token, password: `wrong-${i}` }, ip)).status).toBe(401);
      }
      const sixth = await attempt({ token, password: PASSWORD }, ip);
      expect(sixth.status).toBe(429);
      expect((await row(email)).verified).toBe(false);
      // The prompt itself still answers, and so does another address.
      expect((await attempt({ token }, ip)).status).toBe(200);
      expect((await attempt({ token, password: PASSWORD }, `10.144.${n}.2`)).status).toBe(200);
      expect((await row(email)).verified).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
