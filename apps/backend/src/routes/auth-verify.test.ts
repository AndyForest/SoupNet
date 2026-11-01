import { describe, it, expect, afterAll, vi } from "vitest";
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

async function register(label: string): Promise<{ email: string; token: string }> {
  const email = nextEmail(label);
  const { data } = await post("/auth/register", { email, password: PASSWORD, tosAccepted: true });
  const token = data["verificationToken"];
  if (typeof token !== "string") throw new Error(`register returned no verification token for ${email}`);
  return { email, token };
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
  afterAll(async () => {
    await getDb().execute(sql`DELETE FROM claimnet.users WHERE email LIKE ${`test-verify-%-${run}-%`}`);
  });

  it("ACC-VERIFY-01: a link opened with the sign-up's own session verifies with no password", async () => {
    const { email, token } = await register("own-session");
    const session = await signIn(email);
    const { status, data } = await post("/auth/verify", { token }, session);
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email, ownSession: true });
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

  it("ACC-VERIFY-03: on another device, the right password verifies", async () => {
    const { email, token } = await register("right-password");
    const { status, data } = await post("/auth/verify", { token, password: PASSWORD });
    expect(status).toBe(200);
    expect(data).toMatchObject({ verified: true, email, ownSession: false });
    expect((await row(email)).verified).toBe(true);
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

    await waitPastCurrentSecond();
    expect((await post("/auth/reset-password", { token: await resetToken(email), newPassword: "next-password-345" })).status).toBe(200);

    expect(await meStatus(session)).toBe(401);
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
    // A wrong password on a repeat click isn't judged at all.
    expect((await post("/auth/verify", { token, password: "not-the-password" })).status).toBe(200);
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
    expect(await row(email)).toEqual({ verified: true, waitlisted: true });
    expect((await post("/auth/login", { email, password: PASSWORD })).json["error"]).toBe("waitlisted");
  });

  it("ACC-VERIFY-11: a waitlisted owner's reset verifies the address and leaves the place on the waitlist", async () => {
    const { email } = await register("waitlisted-reset");
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = now() WHERE email = ${email}`);
    expect((await post("/auth/reset-password", { token: await resetToken(email), newPassword: "waitlist-new-pw-1" })).status).toBe(200);
    expect(await row(email)).toEqual({ verified: true, waitlisted: true });
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
  it("ACC-VERIFY-12: password attempts are limited, and asking for the prompt isn't an attempt", async () => {
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
