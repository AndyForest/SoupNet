import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVerifiedUser } from "../test-users";
import { fakeGoogle } from "../test-google-issuer";
import type { FakeIdClaims } from "../test-google-issuer";

/**
 * Offboarding through the company's Google Workspace directory, end to end
 * (organization accounts round 1, stream Offboarding; rubric
 * docs/planning/org-accounts-build/offboarding.md; scenarios
 * docs/product-specs/offboarding.feature). Requires the running backend and
 * postgres, started with GOOGLE_OIDC_TEST_ISSUER (the fake Google from
 * vitest's global setup, whose /directory routes stand in for the Directory
 * API) and DIRECTORY_CREDENTIALS_KEY.
 *
 * Organizations, domains, members, keys and connections are made through the
 * real HTTP surface. Direct SQL only moves time back (a member's last check,
 * a connection's last success, a domain claim's last DNS check), changes the
 * DNS answer, or reads state back.
 *
 * Cast, as in the rubric: Olive (Acme's owner, a Workspace admin), Max (an
 * Acme member on the domain), Rae (a member on another address), Mal (on the
 * domain, unknown to the directory).
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const ISSUER = process.env["GOOGLE_OIDC_TEST_ISSUER"] ?? "";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = "directory-test-pw";
const FRONTEND = (process.env["FRONTEND_URL"] ?? "http://localhost:5273").replace(/\/+$/, "");
let n = 0;

type Json = Record<string, unknown>;

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

const google = fakeGoogle(ISSUER);

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

interface Actor {
  email: string;
  token: string;
  userId: string;
}

describe.skipIf(!canConnect() || !BASE || !ISSUER || !process.env["DIRECTORY_CREDENTIALS_KEY"])("Workspace directory: stream Offboarding", () => {
  let sysToken = "";

  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    const s = await seeded("sys", "test.local");
    await getDb().execute(sql`UPDATE claimnet.users SET role = 'system' WHERE id = ${s.userId}::uuid`);
    sysToken = await passwordToken(s.email);
  }, 60_000);

  async function passwordToken(email: string): Promise<string> {
    const res = await call(null, "POST", "/auth/login", { email, password: PASSWORD });
    return ((await res.json()) as { data: { token: string } }).data.token;
  }

  async function seeded(label: string, domain: string): Promise<Actor> {
    const email = `${label}-${run}-${++n}@${domain}`;
    const body = (await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string; user?: { id: string } } };
    if (!body.data?.token || !body.data.user) throw new Error(`seed failed for ${email}`);
    return { email, token: body.data.token, userId: body.data.user.id };
  }

  /** Sign in with Google once, linking a Workspace identity; returns the Google session's token. */
  async function linkGoogle(a: Actor, subject: string, hd: string): Promise<string> {
    const tab = secret();
    const start = await call(null, "POST", "/auth/google/start", { binding: sha256(tab) });
    const url = new URL(((await start.json()) as { data: { url: string } }).data.url);
    const claims: FakeIdClaims = { sub: subject, email: a.email, email_verified: true, hd };
    const code = await google.issue(claims, { nonce: url.searchParams.get("nonce")!, codeChallenge: url.searchParams.get("code_challenge")! });
    const cb = await fetch(`${BASE}/auth/google/callback?state=${url.searchParams.get("state")}&code=${code}`, { redirect: "manual" });
    const handoff = new URLSearchParams((cb.headers.get("location") ?? "").split("#")[1] ?? "").get("handoff") ?? "";
    const ex = (await (await call(null, "POST", "/auth/google/exchange", { handoff, secret: tab })).json()) as { data?: { token: string } };
    if (!ex.data) throw new Error("Google sign-in failed in setup");
    return ex.data.token;
  }

  interface Org {
    orgId: string;
    domain: string;
    olive: Actor;
    oliveSubject: string;
    serviceAccount: { key: string; clientEmail: string };
  }

  /** Acme with Olive as owner, a captured domain, and a service-account connection. */
  async function acme(opts: { connect?: boolean } = {}): Promise<Org> {
    const domain = `dns-ok-dir-${run}-${++n}.test`;
    const olive = await seeded("olive", domain);
    const created = await call(sysToken, "POST", "/admin/organizations", { name: `Acme ${n}`, slug: `acme-dir-${run}-${n}`, ownerEmail: olive.email });
    const orgId = ((await created.json()) as { data: { organizationId: string } }).data.organizationId;
    olive.token = await passwordToken(olive.email);
    const claim = (await (await call(olive.token, "POST", `/organizations/${orgId}/domains`, { domain })).json()) as { data: { id: string } };
    const checked = await call(olive.token, "POST", `/organizations/${orgId}/domains/${claim.data.id}/check`);
    if (checked.status !== 200) throw new Error(`domain check failed: ${checked.status} ${await checked.text()}`);
    await google.setDirectoryUser(olive.email, {});

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const clientEmail = `sa-${run}-${n}@acme-project.iam.gserviceaccount.com`;
    await google.addServiceAccount(clientEmail, publicKey.export({ type: "spki", format: "pem" }).toString());
    const key = JSON.stringify({ type: "service_account", client_email: clientEmail, private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    const org: Org = { orgId, domain, olive, oliveSubject: `olive-${run}-${n}`, serviceAccount: { key, clientEmail } };
    if (opts.connect !== false) {
      const res = await call(olive.token, "PUT", `/organizations/${orgId}/directory/service-account`, { key, adminEmail: olive.email });
      if (res.status !== 200) throw new Error(`connect failed: ${res.status} ${await res.text()}`);
    }
    return org;
  }

  /**
   * A member with a session and a daily key, both made before the join, so
   * no directory check runs until the test presents them.
   */
  async function member(org: Org, label: string, domain = org.domain): Promise<Actor & { key: string }> {
    const a = await seeded(label, domain);
    const key = ((await (await call(a.token, "POST", "/keys/daily", {})).json()) as { data: { key: string } }).data.key;
    const added = await call(sysToken, "POST", `/admin/organizations/${org.orgId}/members`, { email: a.email, role: "member" });
    if (added.status !== 201) throw new Error(`add member failed: ${added.status} ${await added.text()}`);
    return { ...a, key };
  }

  async function makeDue(userId: string, hoursAgo = 2): Promise<void> {
    await getDb().execute(sql`
      UPDATE claimnet.organization_members
      SET directory_checked_at = NOW() - make_interval(hours => ${hoursAgo}), directory_check_claimed_at = NULL
      WHERE user_id = ${userId}::uuid
    `);
  }

  async function memberRow(userId: string): Promise<{ directory_status: string | null; directory_checked_at: string | null; directory_check_claimed_at: string | null }> {
    const rows = (await getDb().execute(sql`
      SELECT directory_status, directory_checked_at, directory_check_claimed_at FROM claimnet.organization_members WHERE user_id = ${userId}::uuid
    `)) as unknown as Array<{ directory_status: string | null; directory_checked_at: string | null; directory_check_claimed_at: string | null }>;
    return rows[0]!;
  }

  function useKey(key: string): Promise<Response> {
    return call(key, "GET", "/health/version");
  }

  async function requestsFor(userKey: string): Promise<number> {
    return (await google.stats()).directoryRequests[userKey] ?? 0;
  }

  /** Put the organization's domain claim in a state: current, or one of the ways it stops being current. */
  async function setClaim(orgId: string, state: "current" | "failing" | "stale" | "lapsed"): Promise<void> {
    await getDb().execute(sql`
      UPDATE claimnet.organization_domains SET
        verified_at = ${state === "lapsed" ? sql`NULL` : sql`COALESCE(verified_at, NOW())`},
        failing_since = ${state === "failing" ? sql`NOW()` : sql`NULL`},
        last_checked_at = ${state === "stale" ? sql`NOW() - interval '49 hours'` : sql`NOW()`}
      WHERE organization_id = ${orgId}::uuid
    `);
  }


  // ── Connecting ────────────────────────────────────────────────────────────

  it("OFF-CON-03 / OB-K3, OB-K4, OB-K6: a service account connects after a test lookup; the credential never comes back", async () => {
    const org = await acme();
    const view = await call(org.olive.token, "GET", `/organizations/${org.orgId}/directory`);
    expect(view.status).toBe(200);
    const text = await view.text();
    expect(text).not.toContain("PRIVATE KEY");
    expect(JSON.parse(text).data).toMatchObject({ connected: true, kind: "service_account", domain: org.domain, adminEmail: org.olive.email, serviceAccountEmail: org.serviceAccount.clientEmail });
    const row = (await getDb().execute(sql`SELECT credential_ciphertext FROM claimnet.organization_directory_connections WHERE organization_id = ${org.orgId}::uuid`)) as unknown as Array<{ credential_ciphertext: string }>;
    expect(row[0]!.credential_ciphertext).not.toContain("PRIVATE KEY");
    const audit = (await getDb().execute(sql`SELECT metadata FROM claimnet.audit_log WHERE action = 'organization.directory_connected' AND target_id = ${org.orgId}::uuid`)) as unknown as Array<{ metadata: Json }>;
    expect(audit[0]?.metadata).toMatchObject({ kind: "service_account", domain: org.domain });
  });

  it("OFF-CON-03 / OB-K3: refuses a malformed key, an admin off the claimed domain, and a key Google won't honour, without echoing the key", async () => {
    const org = await acme({ connect: false });
    const bad = await call(org.olive.token, "PUT", `/organizations/${org.orgId}/directory/service-account`, { key: "{", adminEmail: org.olive.email });
    expect(bad.status).toBe(400);
    const offDomain = await call(org.olive.token, "PUT", `/organizations/${org.orgId}/directory/service-account`, { key: org.serviceAccount.key, adminEmail: "someone@elsewhere.test" });
    expect(offDomain.status).toBe(400);
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const stranger = JSON.stringify({ type: "service_account", client_email: "nobody@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    const refused = await call(org.olive.token, "PUT", `/organizations/${org.orgId}/directory/service-account`, { key: stranger, adminEmail: org.olive.email });
    expect(refused.status).toBe(422);
    expect(await refused.text()).not.toContain("PRIVATE KEY");
    expect(((await (await call(org.olive.token, "GET", `/organizations/${org.orgId}/directory`)).json()) as { data: Json }).data["connected"]).toBe(false);
  });

  it("OFF-CON-04 / OB-K4: only an active owner or admin reaches the routes; anyone else gets the uniform 404", async () => {
    const org = await acme();
    const max = await member(org, "max-gate");
    await google.setDirectoryUser(max.email, {});
    const asMember = await call(max.token, "GET", `/organizations/${org.orgId}/directory`);
    const nowhere = await call(max.token, "GET", `/organizations/${crypto.randomUUID()}/directory`);
    expect(asMember.status).toBe(404);
    expect(await asMember.text()).toBe(await nowhere.text());
  });

  it("OFF-CON-01, 02 / OB-K1, OB-K2: admin consent completes only for the linked Google account on the domain, with a refresh token", async () => {
    const org = await acme({ connect: false });
    await linkGoogle(org.olive, org.oliveSubject, org.domain);

    async function consent(claims: FakeIdClaims, refreshToken: string | undefined): Promise<string> {
      const start = await call(org.olive.token, "POST", `/organizations/${org.orgId}/directory/google/start`, { binding: sha256(secret()), domain: org.domain });
      expect(start.status).toBe(200);
      const url = new URL(((await start.json()) as { data: { url: string } }).data.url);
      expect(url.searchParams.get("scope")).toContain("admin.directory.user.readonly");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("hd")).toBe(org.domain);
      const code = await google.issue(claims, { nonce: url.searchParams.get("nonce")!, codeChallenge: url.searchParams.get("code_challenge")!, ...(refreshToken ? { refreshToken } : {}) });
      const cb = await fetch(`${BASE}/auth/google/callback?state=${url.searchParams.get("state")}&code=${code}`, { redirect: "manual" });
      return cb.headers.get("location") ?? "";
    }

    const asOlive = { sub: org.oliveSubject, email: org.olive.email, email_verified: true, hd: org.domain };
    expect(await consent({ ...asOlive, sub: "someone-else" }, `rt-${run}-a`)).toBe(`${FRONTEND}/auth/google/complete#error=directory_wrong_account`);
    expect(await consent({ ...asOlive, hd: "other.test" }, `rt-${run}-b`)).toBe(`${FRONTEND}/auth/google/complete#error=directory_wrong_domain`);
    expect(await consent(asOlive, undefined)).toBe(`${FRONTEND}/auth/google/complete#error=directory_no_refresh_token`);
    expect(await consent(asOlive, `rt-${run}-ok`)).toBe(`${FRONTEND}/auth/google/complete#directory=connected`);
    const view = ((await (await call(org.olive.token, "GET", `/organizations/${org.orgId}/directory`)).json()) as { data: Json }).data;
    expect(view).toMatchObject({ connected: true, kind: "admin_consent", domain: org.domain });
  });

  // ── The check ─────────────────────────────────────────────────────────────

  it("OFF-DIR-01, 02 / OB-C1, OB-C2, OB-C11: suspended in Google refuses every credential; restored, the same ones work again", async () => {
    const org = await acme();
    const max = await member(org, "max");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);
    expect((await memberRow(max.userId)).directory_status).toBe("active");

    await google.setDirectoryUser(max.email, { suspended: true });
    await makeDue(max.userId);
    const keysBefore = await getDb().execute(sql`SELECT id, expires_at, consumed_at FROM claimnet.api_keys WHERE user_id = ${max.userId}::uuid ORDER BY id`);
    expect((await useKey(max.key)).status).toBe(401);
    const me = await call(max.token, "GET", "/auth/me");
    expect(me.status).toBe(403);
    expect(((await me.json()) as { error: string }).error).toBe("directory_inactive");
    expect(await getDb().execute(sql`SELECT id, expires_at, consumed_at FROM claimnet.api_keys WHERE user_id = ${max.userId}::uuid ORDER BY id`)).toEqual(keysBefore);
    const audit = (await getDb().execute(sql`
      SELECT metadata FROM claimnet.audit_log WHERE action = 'organization.member_directory_status' AND target_id = ${max.userId}::uuid ORDER BY occurred_at
    `)) as unknown as Array<{ metadata: Json }>;
    expect(audit.map((r) => r.metadata)).toEqual([
      { organizationId: org.orgId, from: null, to: "active" },
      { organizationId: org.orgId, from: "active", to: "suspended" },
    ]);

    await google.setDirectoryUser(max.email, {});
    await makeDue(max.userId);
    expect((await useKey(max.key)).status).toBe(200);
    expect((await call(max.token, "GET", "/auth/me")).status).toBe(200);
  });

  it("OFF-DIR-03 / OB-C3: unknown to the directory (deleted) or archived refuses", async () => {
    const org = await acme();
    const gone = await member(org, "gone");
    expect((await useKey(gone.key)).status).toBe(401);
    expect((await memberRow(gone.userId)).directory_status).toBe("deleted");
    const archived = await member(org, "archived");
    await google.setDirectoryUser(archived.email, { archived: true });
    expect((await useKey(archived.key)).status).toBe(401);
    expect((await memberRow(archived.userId)).directory_status).toBe("archived");
  });

  it("OB-C3 (rename): a 404 by address but a hit by the linked Google sub is a rename, not a deletion", async () => {
    const org = await acme();
    const max = await member(org, "renamed");
    const subject = `renamed-${run}-${++n}`;
    await google.setDirectoryUser(max.email, {});
    await linkGoogle(max, subject, org.domain);
    await google.setDirectoryUser(max.email, { httpStatus: 404 });
    await google.setDirectoryUser(subject, {});
    await makeDue(max.userId);
    expect((await useKey(max.key)).status).toBe(200);
    expect((await memberRow(max.userId)).directory_status).toBe("active");
    const view = ((await (await call(org.olive.token, "GET", `/organizations/${org.orgId}/directory`)).json()) as { data: Json }).data;
    expect(String(view["lastError"])).toContain("renamed");
  });

  it("OFF-DIR-04 / OB-C4: within the hour, no Google call", async () => {
    const org = await acme();
    const max = await member(org, "quiet");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);
    const before = await requestsFor(max.email);
    for (let i = 0; i < 20; i++) expect((await useKey(max.key)).status).toBe(200);
    expect(await requestsFor(max.email)).toBe(before);
  });

  it("OFF-DIR-05 / OB-C5: twenty concurrent requests by a due member make one Google call; a dead claim is taken over", async () => {
    const org = await acme();
    const max = await member(org, "burst");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);
    await makeDue(max.userId);
    const before = await requestsFor(max.email);
    const statuses = await Promise.all(Array.from({ length: 20 }, () => useKey(max.key).then((r) => r.status)));
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(await requestsFor(max.email)).toBe(before + 1);

    await makeDue(max.userId);
    await getDb().execute(sql`UPDATE claimnet.organization_members SET directory_check_claimed_at = NOW() - interval '60 seconds' WHERE user_id = ${max.userId}::uuid`);
    const beforeStale = await requestsFor(max.email);
    expect((await useKey(max.key)).status).toBe(200);
    expect(await requestsFor(max.email)).toBe(beforeStale + 1);
  });

  it("OFF-DIR-06 / OB-C6: slow or failing Google leaves the last status, and releases the claim", async () => {
    const org = await acme();
    const max = await member(org, "slow");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);
    await google.setDirectoryUser(max.email, { delayMs: 2_500 });
    await makeDue(max.userId);
    const started = Date.now();
    expect((await useKey(max.key)).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect((await memberRow(max.userId)).directory_check_claimed_at).toBeNull();
    await google.setDirectoryUser(max.email, { httpStatus: 503 });
    expect((await useKey(max.key)).status).toBe(200);
    expect((await memberRow(max.userId)).directory_status).toBe("active");
  });

  it("OFF-DIR-07 / OB-C7: stale a day with Google failing refuses (directory_unconfirmed); one success restores", async () => {
    const org = await acme();
    const max = await member(org, "stale");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);
    await google.setDirectoryUser(max.email, { httpStatus: 503 });
    await makeDue(max.userId, 25);
    expect((await useKey(max.key)).status).toBe(401);
    const me = await call(max.token, "GET", "/auth/me");
    expect(((await me.json()) as { error: string }).error).toBe("directory_unconfirmed");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);
  });

  it("OFF-DIR-08 / OB-C8: Google refusing our credential is the connection's error, warned once after six hours", async () => {
    const org = await acme({ connect: false });
    await linkGoogle(org.olive, org.oliveSubject, org.domain);
    const start = await call(org.olive.token, "POST", `/organizations/${org.orgId}/directory/google/start`, { binding: sha256(secret()), domain: org.domain });
    const url = new URL(((await start.json()) as { data: { url: string } }).data.url);
    const code = await google.issue(
      { sub: org.oliveSubject, email: org.olive.email, email_verified: true, hd: org.domain },
      { nonce: url.searchParams.get("nonce")!, codeChallenge: url.searchParams.get("code_challenge")!, refreshToken: `rt-${run}-revoked-${n}` },
    );
    await fetch(`${BASE}/auth/google/callback?state=${url.searchParams.get("state")}&code=${code}`, { redirect: "manual" });
    const max = await member(org, "revoked");
    await google.setDirectoryUser(max.email, {});
    expect((await useKey(max.key)).status).toBe(200);

    await google.revokeAll();
    await getDb().execute(sql`UPDATE claimnet.organization_directory_connections SET last_success_at = NOW() - interval '7 hours' WHERE organization_id = ${org.orgId}::uuid`);
    await makeDue(max.userId);
    expect((await useKey(max.key)).status).toBe(200);
    const view = ((await (await call(org.olive.token, "GET", `/organizations/${org.orgId}/directory`)).json()) as { data: Json }).data;
    expect(String(view["lastError"])).toMatch(/^token_|^http_401/);
    await makeDue(max.userId);
    expect((await useKey(max.key)).status).toBe(200);
    // The warning goes out after the request, through the logged sender.
    let sent = 0;
    for (let i = 0; i < 30 && sent === 0; i++) {
      const mail = (await getDb().execute(sql`
        SELECT count(*)::int AS n FROM claimnet.email_log WHERE kind = 'organization_directory' AND to_email = ${org.olive.email}
      `)) as unknown as Array<{ n: number }>;
      sent = mail[0]!.n;
      if (sent === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(sent).toBe(1);
  });

  it("OFF-DIR-09 / OB-C9: a member on another address is never checked; one on the domain the directory doesn't know is refused", async () => {
    const org = await acme();
    const rae = await member(org, "rae", `consultancy-${run}.test`);
    await makeDue(rae.userId);
    expect((await useKey(rae.key)).status).toBe(200);
    expect(await requestsFor(rae.email)).toBe(0);
    const mal = await member(org, "mal");
    expect((await useKey(mal.key)).status).toBe(401);
  });

  it("F113: a recorded refusal holds whatever state the domain claim is in", async () => {
    const org = await acme();
    const max = await member(org, "held");
    await google.setDirectoryUser(max.email, { suspended: true });
    expect((await useKey(max.key)).status).toBe(401);
    expect((await memberRow(max.userId)).directory_status).toBe("suspended");
    const refused = async (label: string) => {
      expect((await useKey(max.key)).status, label).toBe(401);
      const me = await call(max.token, "GET", "/auth/me");
      expect(me.status, label).toBe(403);
      expect(((await me.json()) as { error: string }).error, label).toBe("directory_inactive");
      expect((await call(null, "POST", "/auth/login", { email: max.email, password: PASSWORD })).status, label).toBe(403);
    };
    // A failed DNS re-check, a re-check job stalled past the freshness window, a claim lapsed after its grace.
    for (const state of ["failing", "stale", "lapsed"] as const) {
      await setClaim(org.orgId, state);
      await makeDue(max.userId, 25);
      await refused(state);
    }
    // The TXT record removed (by anyone with DNS access, a departed admin included), found by a re-check.
    // The test resolver answers a dns-ok name from the claims themselves, so the claim and its connection
    // move to a name it answers "doesn't exist" for: the re-check then finds no record.
    await setClaim(org.orgId, "current");
    const gone = `gone-${org.domain}`;
    await getDb().execute(sql`UPDATE claimnet.organization_domains SET domain = ${gone} WHERE organization_id = ${org.orgId}::uuid`);
    await getDb().execute(sql`UPDATE claimnet.organization_directory_connections SET domain = ${gone}, domain_unicode = ${gone} WHERE organization_id = ${org.orgId}::uuid`);
    const claimId = ((await getDb().execute(sql`SELECT id FROM claimnet.organization_domains WHERE organization_id = ${org.orgId}::uuid`)) as unknown as Array<{ id: string }>)[0]!.id;
    expect((await call(org.olive.token, "POST", `/organizations/${org.orgId}/domains/${claimId}/check`)).status).toBe(200);
    const claim = (await getDb().execute(sql`SELECT failing_since FROM claimnet.organization_domains WHERE id = ${claimId}::uuid`)) as unknown as Array<{ failing_since: string | null }>;
    expect(claim[0]!.failing_since).not.toBeNull();
    await refused("txt removed");
  });

  it("OB-M2: two similar addresses are each checked under their own key", async () => {
    const org = await acme();
    const a = await member(org, "twin");
    const b = await seeded(`${a.email.split("@")[0]}x`, org.domain);
    await call(sysToken, "POST", `/admin/organizations/${org.orgId}/members`, { email: b.email, role: "member" });
    await google.setDirectoryUser(a.email, {});
    expect((await useKey(a.key)).status).toBe(200);
    expect(await requestsFor(a.email)).toBe(1);
    expect(await requestsFor(b.email)).toBe(0);
  });

  it("latency: a request carrying a check, and one carrying none (build notes)", { timeout: 60_000 }, async () => {
    const org = await acme();
    const max = await member(org, "timed");
    await google.setDirectoryUser(max.email, {});
    const p99 = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.ceil(xs.length * 0.99) - 1]!;
    const withCheck: number[] = [];
    const without: number[] = [];
    for (let i = 0; i < 30; i++) {
      await makeDue(max.userId);
      let t = performance.now();
      expect((await useKey(max.key)).status).toBe(200);
      withCheck.push(performance.now() - t);
      t = performance.now();
      expect((await useKey(max.key)).status).toBe(200);
      without.push(performance.now() - t);
    }
    // The gate hides test output, so the numbers also go to a file for the build notes.
    const line = `[directory-latency] p99 with a check ${p99(withCheck).toFixed(1)} ms, without ${p99(without).toFixed(1)} ms (n=30 each, fake Google)`;
    console.warn(line);
    appendFileSync(join(tmpdir(), "soupnet-directory-latency.txt"), `${new Date().toISOString()} ${line}
`);
    expect(p99(withCheck)).toBeLessThan(2_500);
  });

  it("OFF-DIR-10 / OB-C10: disconnecting stops the checks and lifts the directory's refusals", async () => {
    const org = await acme();
    const max = await member(org, "freed");
    await google.setDirectoryUser(max.email, { suspended: true });
    expect((await useKey(max.key)).status).toBe(401);
    expect((await call(org.olive.token, "DELETE", `/organizations/${org.orgId}/directory`)).status).toBe(200);
    expect((await useKey(max.key)).status).toBe(200);
  });
});
