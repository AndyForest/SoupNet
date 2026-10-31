import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { seedVerifiedUser } from "../test-users";
import { fakeGoogle } from "../test-google-issuer";
import type { FakeIdClaims } from "../test-google-issuer";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOOGLE_SIGN_IN_ERRORS,
  googleSignInErrorMessage,
  SESSION_EXPIRED_MESSAGE,
  ACCOUNT_DISABLED_MESSAGE,
  ACCOUNT_SUSPENDED_MESSAGE,
  SSO_REQUIRED_MESSAGE,
  DIRECTORY_INACTIVE_MESSAGE,
  DIRECTORY_UNCONFIRMED_MESSAGE,
} from "@soupnet/domain";
import { googleAuthRoutes } from "./google-auth";

/**
 * Sign in with Google, end to end (organization accounts round 1, stream
 * SSO; rubric docs/planning/org-accounts-build/sso.md; scenarios
 * docs/product-specs/google-sign-in.feature). Requires the running backend
 * and postgres, started with GOOGLE_OIDC_TEST_ISSUER pointing at the fake
 * Google that vitest's global setup starts (ci.yml and
 * scripts/test-ci-local.mjs set it); this file drives it over HTTP.
 *
 * The flow is driven the way the SPA drives it: start with the SHA-256 of a
 * tab secret, read state, nonce and the PKCE challenge off Google's URL,
 * register the claims the fake should sign, follow Google's redirect to the
 * backend's callback, and exchange the handoff with the secret. Direct SQL
 * only reads state back or puts a row into a state no route produces.
 *
 * Cast, as in the rubric: Sys (the site operator), Olive (Acme's owner), Max
 * (an Acme member with a password), Pat (a personal account), Eve (an
 * unverified password pre-registration), Vic (its real owner), Gil (a
 * consumer-Google pre-registration), Val (its real owner), Cy (a consumer
 * Google account on a third-party address).
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const ISSUER = process.env["GOOGLE_OIDC_TEST_ISSUER"] ?? "";
const CLIENT_ID = process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "";
const FRONTEND = (process.env["FRONTEND_URL"] ?? "http://localhost:5273").replace(/\/+$/, "");
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const DOMAIN = `acme-${run}.example`;
const PASSWORD = "google-sso-test-pw";
let n = 0;

type Json = Record<string, unknown>;

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

function call(token: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("base64url");
}

function secret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function sub(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e9)}${++n}`;
}

function address(label: string, domain = DOMAIN): string {
  return `${label}-${run}-${++n}@${domain}`;
}

interface Started {
  state: string;
  nonce: string;
  codeChallenge: string;
  secret: string;
}

async function start(returnTarget?: unknown, tabSecret = secret()): Promise<{ res: Response; started: Started | null }> {
  const res = await call(null, "POST", "/auth/google/start", { binding: sha256(tabSecret), ...(returnTarget !== undefined ? { return: returnTarget } : {}) });
  if (res.status !== 200) return { res, started: null };
  const url = new URL(((await res.clone().json()) as { data: { url: string } }).data.url);
  return {
    res,
    started: {
      state: url.searchParams.get("state") ?? "",
      nonce: url.searchParams.get("nonce") ?? "",
      codeChallenge: url.searchParams.get("code_challenge") ?? "",
      secret: tabSecret,
    },
  };
}

async function callback(query: Record<string, string>): Promise<{ status: number; location: string; fragment: URLSearchParams }> {
  const res = await fetch(`${BASE}/auth/google/callback?${new URLSearchParams(query).toString()}`, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  return { status: res.status, location, fragment: new URLSearchParams(location.split("#")[1] ?? "") };
}

function exchange(handoff: string, tabSecret: string): Promise<Response> {
  return call(null, "POST", "/auth/google/exchange", { handoff, secret: tabSecret });
}

interface SignedIn {
  token: string;
  userId: string;
  emailVerified: boolean;
  returnTo: string;
}

const google = fakeGoogle(ISSUER);

/** The whole round trip; returns the session, or the callback's error code. */
async function signIn(claims: FakeIdClaims, returnTarget?: unknown): Promise<SignedIn | { error: string }> {
  const { started } = await start(returnTarget);
  if (!started) throw new Error("start failed");
  const code = await google.issue(claims, { nonce: started.nonce, codeChallenge: started.codeChallenge });
  const cb = await callback({ state: started.state, code });
  const error = cb.fragment.get("error");
  if (error) return { error };
  const handoff = cb.fragment.get("handoff") ?? "";
  const res = await exchange(handoff, started.secret);
  const body = (await res.json()) as { ok: boolean; error?: string; data?: { token: string; user: { id: string }; emailVerified: boolean; returnTo: string } };
  if (!body.data) return { error: body.error ?? `exchange ${res.status}` };
  return { token: body.data.token, userId: body.data.user.id, emailVerified: body.data.emailVerified, returnTo: body.data.returnTo };
}

function signedIn(r: SignedIn | { error: string }): SignedIn {
  if ("error" in r) throw new Error(`expected a session, got ${r.error}`);
  return r;
}

function workspace(email: string, subject = sub()): FakeIdClaims {
  return { sub: subject, email, email_verified: true, hd: email.split("@")[1]! };
}

function consumer(email: string, subject = sub()): FakeIdClaims {
  return { sub: subject, email, email_verified: true };
}

async function passwordLogin(email: string, password = PASSWORD): Promise<Response> {
  return call(null, "POST", "/auth/login", { email, password });
}

async function seeded(label: string, domain = DOMAIN): Promise<{ email: string; token: string; userId: string }> {
  const email = address(label, domain);
  const body = (await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string; user?: { id: string } } };
  if (!body.data?.token || !body.data.user) throw new Error(`seed failed for ${email}`);
  return { email, token: body.data.token, userId: body.data.user.id };
}

async function userRow(userId: string): Promise<{ password_hash: string | null; email_verified_at: string | null; tos_accepted_at: string | null; sessions_valid_after: string | null }> {
  const rows = (await getDb().execute(sql`
    SELECT password_hash, email_verified_at, tos_accepted_at, sessions_valid_after FROM claimnet.users WHERE id = ${userId}::uuid
  `)) as unknown as Array<{ password_hash: string | null; email_verified_at: string | null; tos_accepted_at: string | null; sessions_valid_after: string | null }>;
  return rows[0]!;
}

async function identitiesOf(userId: string): Promise<Array<{ subject: string; linked_via: string; hosted_domain: string | null }>> {
  return (await getDb().execute(sql`
    SELECT subject, linked_via, hosted_domain FROM claimnet.user_identities WHERE user_id = ${userId}::uuid
  `)) as unknown as Array<{ subject: string; linked_via: string; hosted_domain: string | null }>;
}

async function userIdByEmail(email: string): Promise<string | undefined> {
  const rows = (await getDb().execute(sql`SELECT id FROM claimnet.users WHERE email = ${email}`)) as unknown as Array<{ id: string }>;
  return rows[0]?.id;
}

describe("the SPA's outcome copy (SSO-U3)", () => {
  it("carries every closed-list sentence word for word", () => {
    const spa = readFileSync(fileURLToPath(new URL("../../../frontend/src/lib/google-sign-in.ts", import.meta.url)), "utf8");
    for (const code of GOOGLE_SIGN_IN_ERRORS) {
      expect(spa, code).toContain(`${code}: ${JSON.stringify(googleSignInErrorMessage(code))}`);
    }
  });
});

describe("the SPA's signed-out notices (SSO-U4)", () => {
  it("carry every refusal sentence word for word", () => {
    const spa = readFileSync(fileURLToPath(new URL("../../../frontend/src/lib/login-notice.ts", import.meta.url)), "utf8");
    for (const [code, message] of Object.entries({
      session_expired: SESSION_EXPIRED_MESSAGE,
      account_disabled: ACCOUNT_DISABLED_MESSAGE,
      account_suspended: ACCOUNT_SUSPENDED_MESSAGE,
      sso_required: SSO_REQUIRED_MESSAGE,
      directory_inactive: DIRECTORY_INACTIVE_MESSAGE,
      directory_unconfirmed: DIRECTORY_UNCONFIRMED_MESSAGE,
    })) {
      expect(spa, code).toContain(`${code}: ${JSON.stringify(message)}`);
    }
  });
});

describe("Google sign-in, unconfigured (SSO-G7, in process)", () => {
  it("answers 404 on every route when no client id is set", async () => {
    const saved = process.env["GOOGLE_OAUTH_CLIENT_ID"];
    delete process.env["GOOGLE_OAUTH_CLIENT_ID"];
    try {
      expect((await googleAuthRoutes.request("/start", { method: "POST", body: "{}" })).status).toBe(404);
      expect((await googleAuthRoutes.request("/callback?state=x")).status).toBe(404);
      expect((await googleAuthRoutes.request("/exchange", { method: "POST", body: "{}" })).status).toBe(404);
    } finally {
      if (saved !== undefined) process.env["GOOGLE_OAUTH_CLIENT_ID"] = saved;
    }
  });
});

describe.skipIf(!canConnect() || !BASE || !ISSUER || !CLIENT_ID)("Google sign-in: stream SSO", () => {
  let sysToken = "";

  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    const s = await seeded("sys", "test.local");
    await getDb().execute(sql`UPDATE claimnet.users SET role = 'system' WHERE id = ${s.userId}::uuid`);
    sysToken = (((await (await passwordLogin(s.email)).json()) as { data: { token: string } }).data.token);
  }, 60_000);

  async function createOrg(ownerEmail: string): Promise<string> {
    const res = await call(sysToken, "POST", "/admin/organizations", { name: `Acme ${n}`, slug: `acme-sso-${run}-${++n}`, ownerEmail });
    const body = (await res.json()) as { data?: { organizationId: string } };
    if (res.status !== 201 || !body.data) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(body)}`);
    return body.data.organizationId;
  }

  async function addToOrg(orgId: string, email: string, role = "member"): Promise<void> {
    const res = await call(sysToken, "POST", `/admin/organizations/${orgId}/members`, { email, role });
    if (res.status !== 201) throw new Error(`addToOrg failed: ${res.status} ${await res.text()}`);
  }

  // ── The Google leg ────────────────────────────────────────────────────────

  it("GSI-START-01 / SSO-G1: start stores the pending request and returns Google's URL", async () => {
    const tabSecret = secret();
    const { res, started } = await start({ kind: "app", path: "/app/drafts?ids=a" }, tabSecret);
    expect(res.status).toBe(200);
    const url = new URL(((await res.json()) as { data: { url: string } }).data.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("access_type")).toBe(false);
    const rows = (await getDb().execute(sql`
      SELECT binding_hash, return_kind, return_params, consumed_at FROM claimnet.sso_login_requests WHERE state_hash = ${sha256(started!.state)}
    `)) as unknown as Array<{ binding_hash: string; return_kind: string; return_params: Json; consumed_at: string | null }>;
    expect(rows[0]).toMatchObject({ binding_hash: sha256(tabSecret), return_kind: "app", return_params: { path: "/app/drafts?ids=a" }, consumed_at: null });
  });

  it("GSI-START-02 / SSO-G1: start refuses a bad binding and every return it would not send a person to", async () => {
    expect((await call(null, "POST", "/auth/google/start", { binding: "short" })).status).toBe(400);
    for (const target of [
      { kind: "app", path: "https://evil.example/app/x" },
      { kind: "app", path: "/oauth/authorize?client_id=x" },
      { kind: "url", path: "/app/x" },
      { kind: "oauth_authorize", params: { response_type: "code", client_id: "unknown-client", redirect_uri: "https://evil.example/cb", code_challenge: "a".repeat(43), code_challenge_method: "S256", state: "s" } },
      { kind: "oauth_authorize", params: { response_type: "token", client_id: "x", redirect_uri: "https://x.example", code_challenge: "a".repeat(43), code_challenge_method: "S256" } },
      // SSO-G8: a metadata-document client that doesn't resolve, as the grant would refuse it.
      { kind: "oauth_authorize", params: { response_type: "code", client_id: "https://cimd-unresolvable.invalid/oauth/client.json", redirect_uri: "https://cimd-unresolvable.invalid/cb", code_challenge: "a".repeat(43), code_challenge_method: "S256", state: "s" } },
    ]) {
      const { res } = await start(target);
      expect(res.status, JSON.stringify(target)).toBe(400);
    }
  });

  it("GSI-CB-03 / SSO-G3b: a replayed callback ends exactly like an unknown state, without reaching Google", async () => {
    const email = address("replay", "gmail.com");
    const { started } = await start();
    const code = await google.issue(consumer(email), { nonce: started!.nonce, codeChallenge: started!.codeChallenge });
    const first = await callback({ state: started!.state, code });
    expect(first.fragment.get("handoff")).toBeTruthy();
    const before = (await google.stats()).tokenRequests;
    const replay = await callback({ state: started!.state, code });
    const unknown = await callback({ state: secret(), code });
    expect(replay.location).toBe(`${FRONTEND}/auth/google/complete#error=expired`);
    expect(unknown.location).toBe(replay.location);
    expect((await google.stats()).tokenRequests).toBe(before);
  });

  it("GSI-CB-02 / SSO-G4: the callback reflects nothing from the request", async () => {
    const { started } = await start();
    const marker = "MARKER<script>";
    const cb = await callback({ state: started!.state, error: marker, error_description: marker });
    expect(cb.status).toBe(302);
    expect(cb.location).toBe(`${FRONTEND}/auth/google/complete#error=failed`);
    const cancelled = await start();
    expect((await callback({ state: cancelled.started!.state, error: "access_denied" })).location).toBe(`${FRONTEND}/auth/google/complete#error=cancelled`);
    const unknownState = await callback({ state: marker });
    expect(unknownState.location).not.toContain("MARKER");
  });

  it("GSI-CSRF-01 / SSO-G5: a handoff works once, only with the starting tab's secret, and every refusal is the same", async () => {
    const email = address("csrf", "gmail.com");
    const { started } = await start();
    const code = await google.issue(consumer(email), { nonce: started!.nonce, codeChallenge: started!.codeChallenge });
    const handoff = (await callback({ state: started!.state, code })).fragment.get("handoff") ?? "";

    const wrongSecret = await exchange(handoff, secret());
    const unknownCode = await exchange(secret(), started!.secret);
    expect(wrongSecret.status).toBe(400);
    expect(unknownCode.status).toBe(400);
    const wrongBody = await wrongSecret.text();
    expect(await unknownCode.text()).toBe(wrongBody);

    const ok = await exchange(handoff, started!.secret);
    expect(ok.status).toBe(200);
    const again = await exchange(handoff, started!.secret);
    expect(again.status).toBe(400);
    expect(await again.text()).toBe(wrongBody);
  });

  it("F111 / SSO-G6: eleven sign-ins from one office address are not rate limited; one state is", async () => {
    const saved = process.env["DISABLE_RATE_LIMIT"];
    delete process.env["DISABLE_RATE_LIMIT"];
    try {
      const office = { "x-forwarded-for": `203.0.113.${(n % 200) + 1}` };
      for (let i = 0; i < 11; i++) {
        const res = await googleAuthRoutes.request(`/callback?state=${secret()}`, { headers: office });
        expect(res.status, `callback ${i + 1}`).toBe(302);
        const start = await googleAuthRoutes.request("/start", {
          method: "POST",
          headers: { ...office, "content-type": "application/json" },
          body: JSON.stringify({ binding: sha256(secret()) }),
        });
        expect(start.status, `start ${i + 1}`).toBe(200);
      }
      const one = secret();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await googleAuthRoutes.request(`/callback?state=${one}`, { headers: office })).status);
      expect(statuses).toEqual([302, 302, 302, 429]);
    } finally {
      if (saved !== undefined) process.env["DISABLE_RATE_LIMIT"] = saved;
    }
  });

  it("GSI-CAP-01 / SSO-A6: with the signup cap full, a Google sign-up lands on the waitlist (in a rolled-back transaction)", async () => {
    const { createGoogleAccount } = await import("../services/google-sign-in.service");
    const email = address("capped", "gmail.com");
    const claims = { issuer: "https://accounts.google.com", subject: sub(), email, emailVerified: true, hostedDomain: null, name: null };
    let waitlisted: boolean | null = null;
    let waitlistedAt: string | null = null;
    await getDb().transaction(async (tx) => {
      // The cap set to 0 is seen only inside this transaction, so parallel
      // files keep registering normally.
      await tx.execute(sql`
        INSERT INTO claimnet.system_settings (key, value) VALUES ('signupCap', '0')
        ON CONFLICT (key) DO UPDATE SET value = '0'
      `);
      const created = await createGoogleAccount(tx, claims, email, true);
      waitlisted = created.waitlisted;
      const rows = (await tx.execute(sql`SELECT waitlisted_at FROM claimnet.users WHERE id = ${created.userId}::uuid`)) as unknown as Array<{ waitlisted_at: string | null }>;
      waitlistedAt = rows[0]?.waitlisted_at ?? null;
      tx.rollback();
    }).catch((err: unknown) => {
      if (!(err instanceof Error) || !/rollback/i.test(err.message)) throw err;
    });
    expect(waitlisted).toBe(true);
    expect(waitlistedAt).not.toBeNull();
    expect(await userIdByEmail(email)).toBeUndefined();
  });

  it("GSI-DOM-01 / SSO-A10: Domains' hook answering full rolls a new sign-up back, and leaves an existing account signed in", async () => {
    const { resolveAccount } = await import("../services/google-sign-in.service");
    const full = async () => "full" as const;
    const email = address("full", "gmail.com");
    const claims = { issuer: "https://accounts.google.com", subject: sub(), email, emailVerified: true, hostedDomain: null, name: null };
    expect(await resolveAccount(getDb(), claims, full)).toBe("organization_full");
    expect(await userIdByEmail(email)).toBeUndefined();
    const max = await seeded("max-full");
    const linked = await resolveAccount(getDb(), { ...claims, subject: sub(), email: max.email, hostedDomain: DOMAIN }, full);
    expect(linked).toMatchObject({ userId: max.userId, created: false });
    const seen: unknown[] = [];
    await resolveAccount(getDb(), { ...claims, subject: sub(), email: address("hook", "gmail.com") }, async (_tx, input) => {
      seen.push(input);
      return "none";
    });
    expect(seen).toEqual([expect.objectContaining({ created: true, hd: null })]);
  });

  // ── Accounts ──────────────────────────────────────────────────────────────

  it("GSI-NEW-01 / SSO-A6, SSO-A8, SSO-A11, SSO-A7b: an authoritative sign-up creates a verified, password-less account", async () => {
    const email = address("new", "gmail.com");
    const s = signedIn(await signIn(consumer(email)));
    expect(s.emailVerified).toBe(true);
    expect(s.returnTo).toBe("/app/dashboard");
    const row = await userRow(s.userId);
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    expect(row.tos_accepted_at).not.toBeNull();
    expect(await identitiesOf(s.userId)).toEqual([expect.objectContaining({ linked_via: "signup", hosted_domain: null })]);
    expect((jwt.decode(s.token) as Json)["idp"]).toBe("google-consumer");
    const me = ((await (await call(s.token, "GET", "/auth/me")).json()) as { data: { user: Json } }).data.user;
    expect(me["signInMethods"]).toEqual({ password: false, google: { email, hostedDomain: null } });
    const audit = (await getDb().execute(sql`
      SELECT metadata FROM claimnet.audit_log WHERE action = 'auth.signed_in' AND actor_user_id = ${s.userId}::uuid
    `)) as unknown as Array<{ metadata: Json }>;
    expect(audit).toEqual([{ metadata: { method: "google" } }]);
  });

  it("GSI-ID-01 / SSO-A1: a linked identity signs in whatever email the token now carries", async () => {
    const subject = sub();
    const first = signedIn(await signIn(workspace(address("id"), subject)));
    const again = signedIn(await signIn(workspace(address("renamed"), subject)));
    expect(again.userId).toBe(first.userId);
    expect((jwt.decode(again.token) as Json)["idp"]).toBe("google");
  });

  it("GSI-LINK-01 / SSO-A2: a verified password account links on an authoritative token and keeps its password", async () => {
    const max = await seeded("max");
    const s = signedIn(await signIn(workspace(max.email)));
    expect(s.userId).toBe(max.userId);
    expect(await identitiesOf(max.userId)).toEqual([expect.objectContaining({ linked_via: "email_match", hosted_domain: DOMAIN })]);
    expect((await passwordLogin(max.email)).status).toBe(200);
  });

  it("GSI-LINK-02 / SSO-A3: an authoritative sign-in takes over an unverified password pre-registration", async () => {
    const victim = address("victim");
    expect((await call(null, "POST", "/auth/register", { email: victim, password: PASSWORD, tosAccepted: true })).status).toBe(200);
    const eveLogin = (await (await passwordLogin(victim)).json()) as { data: { token: string; emailVerified: boolean } };
    expect(eveLogin.data.emailVerified).toBe(false);
    // Eve's session predates the link by at least a second (iat has whole seconds).
    await new Promise((r) => setTimeout(r, 1100));

    const vic = signedIn(await signIn(workspace(victim)));
    const row = await userRow(vic.userId);
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    expect(row.sessions_valid_after).not.toBeNull();
    expect((await passwordLogin(victim)).status).toBe(401);
    const eveMe = await call(eveLogin.data.token, "GET", "/auth/me");
    expect(eveMe.status).toBe(401);
    expect(((await eveMe.json()) as { error: string }).error).toBe("session_expired");
    expect((await call(vic.token, "GET", "/auth/me")).status).toBe(200);
    const keys = (await getDb().execute(sql`
      SELECT count(*)::int AS n FROM claimnet.api_keys WHERE user_id = ${vic.userId}::uuid AND expires_at > now()
    `)) as unknown as Array<{ n: number }>;
    expect(keys[0]!.n).toBe(0);
  });

  it("GSI-LINK-05 / SSO-A3b: an authoritative sign-in takes over an unverified consumer-Google pre-registration", async () => {
    const victim2 = address("victim2");
    const gilSub = sub();
    const gil = signedIn(await signIn(consumer(victim2, gilSub)));
    expect(gil.emailVerified).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));

    const val = signedIn(await signIn(workspace(victim2)));
    expect(val.userId).toBe(gil.userId);
    expect(await identitiesOf(val.userId)).toEqual([expect.objectContaining({ linked_via: "email_match", hosted_domain: DOMAIN })]);
    expect((await userRow(val.userId)).email_verified_at).not.toBeNull();
    const gilMe = await call(gil.token, "GET", "/auth/me");
    expect(gilMe.status).toBe(401);
    expect(await signIn(consumer(victim2, gilSub))).toEqual({ error: "not_authoritative" });
  });

  it("GSI-LINK-03 / SSO-A4: a non-authoritative token links nothing into an existing account", async () => {
    const cy = await seeded("cy", `outside-${run}.example`);
    expect(await signIn(consumer(cy.email))).toEqual({ error: "not_authoritative" });
    expect(await identitiesOf(cy.userId)).toEqual([]);
  });

  it("GSI-NEW-02 / SSO-A4: a non-authoritative sign-up creates an unverified account that gets our verification email", async () => {
    const email = address("cy-new", `outside-${run}.example`);
    const s = signedIn(await signIn(consumer(email)));
    expect(s.emailVerified).toBe(false);
    const row = await userRow(s.userId);
    expect(row.email_verified_at).toBeNull();
    const token = (await getDb().execute(sql`SELECT email_verification_token FROM claimnet.users WHERE id = ${s.userId}::uuid`)) as unknown as Array<{ email_verification_token: string | null }>;
    expect(token[0]!.email_verification_token).toBeTruthy();
    // Behind requireVerifiedEmail, like a password registration's session.
    expect((await call(s.token, "GET", "/keys")).status).toBe(403);
  });

  it("GSI-LINK-04 / SSO-A5: a verified account linked to another Google sub is not relinked by email", async () => {
    const max = await seeded("max2");
    signedIn(await signIn(workspace(max.email)));
    expect(await signIn(workspace(max.email))).toEqual({ error: "different_google_account" });
  });

  it("GSI-STATE-01 / SSO-A7: a suspended account gets no session", async () => {
    const pat = await seeded("pat", "gmail.com");
    expect((await call(sysToken, "POST", `/admin/users/${pat.userId}/suspend`, { reason: "test" })).status).toBe(200);
    expect(await signIn(consumer(pat.email))).toEqual({ error: "account_suspended" });
  });

  it("GSI-STATE-01 / SSO-A7: a waitlisted account and an org-disabled account get no session either", async () => {
    const waiting = await seeded("waiting", "gmail.com");
    const waitingSub = sub();
    signedIn(await signIn(consumer(waiting.email, waitingSub)));
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = now() WHERE id = ${waiting.userId}::uuid`);
    const waitlisted = await signIn(consumer(waiting.email, waitingSub));
    // waitlist.service.test.ts promotes verified waitlisted accounts across
    // the whole table, so put the row back before asserting nothing else.
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = NULL WHERE id = ${waiting.userId}::uuid`);
    expect(waitlisted).toEqual({ error: "waitlisted" });

    const olive = await seeded("olive-dis");
    const member = await seeded("member-dis");
    const orgId = await createOrg(olive.email);
    await addToOrg(orgId, member.email);
    expect((await call(olive.token, "POST", `/organizations/${orgId}/members/${member.userId}/disable`)).status).toBe(200);
    expect(await signIn(workspace(member.email))).toEqual({ error: "account_disabled" });
  });

  it("GSI-PWD-03 / SSO-A9b: every reader of password_hash is a reviewed one", () => {
    // A new reader of the column must handle a null hash (a Google-only
    // account). Adding one fails this test until it is reviewed and listed.
    const reviewed = new Set([
      "auth.ts", // verifyPassword (dummy hash for null), createAccount (writes)
      "routes/auth.ts", // DELETE /auth/me confirmation, reset-password (writes)
      "routes/google-auth.test.ts",
      "services/google-sign-in.service.ts", // takeover sets it null
      "test-users.ts", // writes a cheap hash for seeded test users
    ]);
    const root = fileURLToPath(new URL("..", import.meta.url));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && /password_hash|passwordHash/.test(readFileSync(full, "utf8"))) {
          found.push(relative(root, full).split(sep).join("/"));
        }
      }
    };
    walk(root);
    expect(found.filter((f) => !reviewed.has(f) && !f.endsWith(".test.ts"))).toEqual([]);
  });

  it("GSI-PWD-01 / SSO-A9: a password login to a Google-only account answers like a wrong password", async () => {
    const email = address("nopw", "gmail.com");
    signedIn(await signIn(consumer(email)));
    const noPassword = await passwordLogin(email, "anything");
    const max = await seeded("wrongpw");
    const wrong = await passwordLogin(max.email, "not-the-password");
    expect(noPassword.status).toBe(401);
    expect(await noPassword.text()).toBe(await wrong.text());
  });

  it("GSI-PWD-02 / SSO-A9b: a password-less account confirms deletion with a fresh Google sign-in", async () => {
    const email = address("delete", "gmail.com");
    const subject = sub();
    const s = signedIn(await signIn(consumer(email, subject)));
    await getDb().execute(sql`UPDATE claimnet.user_identities SET last_sign_in_at = now() - interval '11 minutes' WHERE user_id = ${s.userId}::uuid`);
    const stale = await call(s.token, "DELETE", "/auth/me");
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { error: string }).error).toBe("reauthenticate");
    const fresh = signedIn(await signIn(consumer(email, subject)));
    expect((await call(fresh.token, "DELETE", "/auth/me")).status).toBe(200);
    expect(await userIdByEmail(email)).toBeUndefined();
  });

  it("GSI-MCP-01 / SSO-G1, SSO-G5: the consent page's parameters survive the round trip, resource and scope included", async () => {
    const reg = await call(null, "POST", "/oauth/register", { redirect_uris: ["https://client.example/cb"], client_name: "SSO test client" });
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const params = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://client.example/cb",
      state: "client-state",
      code_challenge: "b".repeat(43),
      code_challenge_method: "S256",
      scope: "read write openid email",
      resource: BASE,
    };
    const s = signedIn(await signIn(consumer(address("mcp", "gmail.com")), { kind: "oauth_authorize", params }));
    const back = new URL(s.returnTo, "https://spa.invalid");
    expect(back.pathname).toBe("/oauth/authorize");
    for (const [k, v] of Object.entries(params)) expect(back.searchParams.get(k), k).toBe(v);
    // SSO-G8: a resource the grant would answer invalid_target is refused at start, as is the client's unregistered redirect.
    expect((await start({ kind: "oauth_authorize", params: { ...params, resource: "https://elsewhere.example.com" } })).res.status).toBe(400);
    expect((await start({ kind: "oauth_authorize", params: { ...params, resource: `${BASE}/mcp` } })).res.status).toBe(200);
    expect((await start({ kind: "oauth_authorize", params: { ...params, redirect_uri: "https://client.example/other" } })).res.status).toBe(400);
  });

  // ── require_sso ───────────────────────────────────────────────────────────

  it("GSI-SSO-01..05 / SSO-R1 to SSO-R5: require_sso is set from a Workspace Google session and ends password sessions", async () => {
    const olive = await seeded("olive");
    const max = await seeded("max-sso");
    const pat = await seeded("pat-guest", "gmail.com");
    const orgId = await createOrg(olive.email);
    await addToOrg(orgId, max.email);

    // A reset token Max holds from before the policy.
    const forgot = (await (await call(null, "POST", "/auth/forgot-password", { email: max.email })).json()) as { data: { resetToken?: string } };
    const resetToken = forgot.data.resetToken ?? "";
    expect(resetToken).toBeTruthy();

    // SSO-R1: not from a password session; anyone else gets the uniform 404.
    const fromPassword = await call(olive.token, "PATCH", `/organizations/${orgId}`, { requireSso: true });
    expect(fromPassword.status).toBe(403);
    expect(((await fromPassword.json()) as { error: string }).error).toBe("google_session_required");
    const stranger = await call(pat.token, "PATCH", `/organizations/${orgId}`, { requireSso: true });
    const nowhere = await call(pat.token, "PATCH", `/organizations/${crypto.randomUUID()}`, { requireSso: true });
    expect(stranger.status).toBe(404);
    expect(await stranger.text()).toBe(await nowhere.text());

    const oliveGoogle = signedIn(await signIn(workspace(olive.email)));
    expect((await call(oliveGoogle.token, "PATCH", `/organizations/${orgId}`, { requireSso: true })).status).toBe(200);

    // SSO-R2: Max's password session and password login are refused.
    const meRefused = await call(max.token, "GET", "/auth/me");
    expect(meRefused.status).toBe(403);
    expect(((await meRefused.json()) as { error: string }).error).toBe("sso_required");
    expect((await call(max.token, "GET", "/keys")).status).toBe(403);
    const login = await passwordLogin(max.email);
    expect(login.status).toBe(403);
    expect(((await login.json()) as { error: string }).error).toBe("sso_required");

    // SSO-R3: a held token is refused, and no reset email goes out.
    const reset = await call(null, "POST", "/auth/reset-password", { token: resetToken, newPassword: "a-brand-new-password" });
    expect(reset.status).toBe(403);
    expect(((await reset.json()) as { error: string }).error).toBe("sso_required");
    const forgotNow = (await (await call(null, "POST", "/auth/forgot-password", { email: max.email })).json()) as { data: Json };
    expect(forgotNow.data["resetToken"]).toBeUndefined();

    // SSO-R4: a consumer Google account on Max's address is not enough.
    expect(await signIn(consumer(max.email))).toEqual({ error: "not_authoritative" });
    const maxGoogle = signedIn(await signIn(workspace(max.email)));
    expect((await call(maxGoogle.token, "GET", "/auth/me")).status).toBe(200);

    // SSO-R5: a personal account is untouched.
    expect((await call(pat.token, "GET", "/auth/me")).status).toBe(200);

    // Off again: Max's old password session works, since nothing was swept.
    expect((await call(oliveGoogle.token, "PATCH", `/organizations/${orgId}`, { requireSso: false })).status).toBe(200);
    expect((await call(max.token, "GET", "/auth/me")).status).toBe(200);
  });

  it("GSI-SSO-04 / SSO-R4: a member's consumer-Google session from before the policy is refused under it", async () => {
    const olive = await seeded("olive2");
    const consumerAddress = address("member-gmail", "gmail.com");
    const subject = sub();
    const orgId = await createOrg(olive.email);
    const member = signedIn(await signIn(consumer(consumerAddress, subject)));
    await addToOrg(orgId, consumerAddress);
    expect((await call(member.token, "GET", "/auth/me")).status).toBe(200);
    expect((await call(sysToken, "PATCH", `/admin/organizations/${orgId}`, { requireSso: true })).status).toBe(200);
    const refused = await call(member.token, "GET", "/auth/me");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("sso_required");
    expect(await signIn(consumer(consumerAddress, subject))).toEqual({ error: "sso_required_workspace" });
  });
});
