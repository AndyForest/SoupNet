import { describe, it, expect, beforeAll } from "vitest";
import { seedVerifiedUser } from "../test-users";
import type { TxtLookup } from "../lib/dns-txt";

/**
 * Organization accounts round 1, stream Domains (rubric
 * docs/planning/org-accounts-build/domains.md; scenarios
 * docs/product-specs/organization-domains.feature). Requires running backend +
 * postgres, with ALLOW_AUTO_SETUP=true (as the gate runs it).
 *
 * Over HTTP, DNS is the backend's test-mode stub for the reserved `.test` TLD
 * (services/org-domains.service.ts, txtLookupFor): a domain whose first label
 * starts `dns-ok` publishes every claim's record, `dns-error` times out,
 * anything else doesn't exist. Service functions called directly take an
 * injected resolver, and the daily job runs narrowed to the test's own
 * organization. Direct SQL only puts a row into a state no route produces in
 * test time (a check two days old, fourteen days of failure) or reads state
 * back.
 *
 * Cast, as in the rubric: Sys (the site operator), Olive (Acme's owner), Ada
 * (an Acme admin), Max (an account verified before the claim), Nia (a new
 * employee), Rex (Globex's owner). Every test builds its own organizations
 * and domains.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let domains: typeof import("../services/org-domains.service");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let authz: typeof import("../authz");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let authority: typeof import("../authz/domain-authority");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let settings: typeof import("../services/system-settings.service");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = "org-domains-test-pw";
const NEW_PASSWORD = "org-domains-test-pw-new";
let n = 0;

type Json = Record<string, unknown>;

interface Actor {
  email: string;
  jwt: string;
  userId: string;
  personalBookId: string;
}

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

function call(actor: { jwt: string } | null, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.jwt}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** A fresh domain under the test TLD; `kind` picks what the backend's stub answers. */
function testDomain(kind: "dns-ok" | "dns-absent" | "dns-error" = "dns-ok"): string {
  return `${kind}-${run}-${++n}.test`;
}

const found: TxtLookup = async (name) => {
  const domain = name.replace(/^_soupnet-challenge\./, "");
  const rows = (await getDb().execute(sql`SELECT challenge_token FROM claimnet.organization_domains WHERE domain = ${domain}`)) as unknown as Array<{ challenge_token: string }>;
  return rows.map((r) => [`soupnet-domain-verification=${r.challenge_token}`]);
};
const absent: TxtLookup = async () => {
  throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
};

describe.skipIf(!canConnect() || !BASE)("organization accounts: stream Domains", () => {
  let sys: Actor;

  async function actor(label: string, email?: string): Promise<Actor> {
    const address = email ?? `test-orgdom-${label}-${run}-${++n}@test.local`;
    const res = await seedVerifiedUser(address, PASSWORD);
    const body = (await res.json()) as { data?: { token?: string; user?: { id: string } } };
    const token = body.data?.token ?? "";
    const userId = body.data?.user?.id ?? "";
    if (!token || !userId) throw new Error(`login failed for ${address}: ${res.status}`);
    const books = ((await (await call({ jwt: token }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string }> }).data;
    return { email: address, jwt: token, userId, personalBookId: books[0]!.id };
  }

  async function relogin(a: Actor): Promise<Actor> {
    const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: a.email, password: PASSWORD }) });
    const body = (await res.json()) as { data?: { token?: string } };
    return { ...a, jwt: body.data?.token ?? "" };
  }

  async function createOrg(owner: Actor, seatLimit: number | null = null): Promise<{ orgId: string; defaultBookId: string }> {
    const res = await call(sys, "POST", "/admin/organizations", { name: `Acme ${run} ${++n}`, slug: `acme-dom-${run}-${n}`, ownerEmail: owner.email, seatLimit });
    const body = (await res.json()) as { data?: { organizationId: string; defaultRecipeBookId: string } };
    if (res.status !== 201 || !body.data) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(body)}`);
    return { orgId: body.data.organizationId, defaultBookId: body.data.defaultRecipeBookId };
  }

  async function addToOrg(orgId: string, who: Actor, role: "owner" | "admin" | "member" = "member"): Promise<void> {
    const res = await call(sys, "POST", `/admin/organizations/${orgId}/members`, { email: who.email, role });
    if (res.status !== 201) throw new Error(`addToOrg failed: ${res.status} ${await res.text()}`);
  }

  async function addDomain(manager: Actor, orgId: string, domain: string): Promise<Json> {
    const res = await call(manager, "POST", `/organizations/${orgId}/domains`, { domain });
    const body = (await res.json()) as { data?: Json };
    if (!body.data) throw new Error(`addDomain failed: ${res.status} ${JSON.stringify(body)}`);
    return body.data;
  }

  async function checkNow(manager: Actor, orgId: string, claimId: string): Promise<Response> {
    return call(manager, "POST", `/organizations/${orgId}/domains/${claimId}/check`);
  }

  async function setAutoJoin(manager: Actor, orgId: string, claimId: string, autoJoin: boolean): Promise<Response> {
    return call(manager, "PATCH", `/organizations/${orgId}/domains/${claimId}`, { autoJoin });
  }

  /** Add, verify (stub publishes the record) and switch on: the claim is captured. */
  async function capture(manager: Actor, orgId: string, domain = testDomain()): Promise<{ claimId: string; domain: string }> {
    const claim = await addDomain(manager, orgId, domain);
    const claimId = claim["id"] as string;
    const checked = await checkNow(manager, orgId, claimId);
    if (checked.status !== 200) throw new Error(`check failed: ${checked.status} ${await checked.text()}`);
    const on = await setAutoJoin(manager, orgId, claimId, true);
    if (on.status !== 200) throw new Error(`auto-join failed: ${on.status} ${await on.text()}`);
    return { claimId, domain };
  }

  async function orgOf(userId: string): Promise<{ organization_id: string; joined_via: string; role: string } | undefined> {
    const rows = (await getDb().execute(sql`
      SELECT organization_id, joined_via, role FROM claimnet.organization_members WHERE user_id = ${userId}::uuid
    `)) as unknown as Array<{ organization_id: string; joined_via: string; role: string }>;
    return rows[0];
  }

  async function claimRow(claimId: string): Promise<Json> {
    const rows = (await getDb().execute(sql`SELECT * FROM claimnet.organization_domains WHERE id = ${claimId}::uuid`)) as unknown as Json[];
    return rows[0]!;
  }

  /** Register over HTTP (the real sign-up) and return the verification token test mode exposes. */
  async function register(email: string): Promise<{ body: Json; token: string }> {
    const res = await call(null, "POST", "/auth/register", { email, password: PASSWORD, tosAccepted: true });
    const body = (await res.json()) as Json;
    const token = ((body["data"] as Json | undefined)?.["verificationToken"] as string | undefined) ?? "";
    if (!token) throw new Error(`register gave no token: ${res.status} ${JSON.stringify(body)}`);
    return { body, token };
  }

  /** The click of the person who signed up: F144's proof goes with the link. */
  function verify(token: string): Promise<Response> {
    return call(null, "POST", "/auth/verify", { token, password: PASSWORD });
  }

  async function resetPassword(email: string): Promise<Json> {
    const asked = (await (await call(null, "POST", "/auth/forgot-password", { email })).json()) as { data: { resetToken: string } };
    const res = await call(null, "POST", "/auth/reset-password", { token: asked.data.resetToken, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: Json }).data;
  }

  async function userIdOf(email: string): Promise<string> {
    const rows = (await getDb().execute(sql`SELECT id FROM claimnet.users WHERE email = ${email}`)) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  async function verifiedAt(email: string): Promise<unknown> {
    const rows = (await getDb().execute(sql`SELECT email_verified_at FROM claimnet.users WHERE email = ${email}`)) as unknown as Array<{ email_verified_at: unknown }>;
    return rows[0]?.email_verified_at ?? null;
  }

  async function auditRows(action: string, claimId: string): Promise<Json[]> {
    return (await getDb().execute(sql`
      SELECT actor_user_id, metadata FROM claimnet.audit_log WHERE action = ${action} AND metadata->>'claimId' = ${claimId}
    `)) as unknown as Json[];
  }

  beforeAll(async () => {
    domains = await import("../services/org-domains.service");
    authz = await import("../authz");
    authority = await import("../authz/domain-authority");
    settings = await import("../services/system-settings.service");
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    const s = await actor("sys");
    await getDb().execute(sql`UPDATE claimnet.users SET role = 'system' WHERE id = ${s.userId}::uuid`);
    sys = await relogin(s);
  }, 60_000);

  // ── Who may manage domains ───────────────────────────────────────────────

  it("ORG-DOM-09 / OD-A1: anyone but an active owner or admin gets the 404 for a missing organization, byte for byte", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const claim = await addDomain(olive, orgId, testDomain());
    const claimId = claim["id"] as string;

    const rex = await actor("rex");
    await createOrg(rex);
    const ann = await actor("ann");
    await addToOrg(orgId, ann, "member");
    const ada = await actor("ada");
    await addToOrg(orgId, ada, "admin");
    expect((await call(olive, "POST", `/organizations/${orgId}/members/${ada.userId}/disable`)).status).toBe(200);

    const randomOrg = crypto.randomUUID();
    const reference = await (await call(rex, "GET", `/organizations/${randomOrg}/domains`)).text();
    for (const who of [rex, ann]) {
      for (const [method, path, body] of [
        ["GET", `/organizations/${orgId}/domains`, undefined],
        ["POST", `/organizations/${orgId}/domains`, { domain: testDomain() }],
        ["POST", `/organizations/${orgId}/domains/${claimId}/check`, undefined],
        ["PATCH", `/organizations/${orgId}/domains/${claimId}`, { autoJoin: true }],
        ["DELETE", `/organizations/${orgId}/domains/${claimId}`, undefined],
      ] as const) {
        const res = await call(who, method, path, body);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(await res.text()).toBe(reference);
      }
    }
    // A disabled admin never reaches the gate: Core's session lookup refuses
    // every JWT route for a disabled account (OC-A1).
    const disabled = await call(ada, "GET", `/organizations/${orgId}/domains`);
    expect(disabled.status).toBe(403);
    expect(((await disabled.json()) as Json)["error"]).toBe("account_disabled");
    // A malformed id, and Olive naming a claim id that isn't Acme's.
    expect(await (await call(olive, "GET", `/organizations/not-a-uuid/domains`)).text()).toBe(reference);
    expect(await (await call(olive, "DELETE", `/organizations/${orgId}/domains/${crypto.randomUUID()}`)).text()).toBe(reference);
    // Nothing changed for Acme's claim.
    expect((await claimRow(claimId))["auto_join"]).toBe(false);
  });

  // ── Adding and verifying ─────────────────────────────────────────────────

  it("ORG-DOM-01 / OD-V1, OD-A2: adding a domain returns the record to publish, normalized", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const domain = testDomain();
    const res = await call(olive, "POST", `/organizations/${orgId}/domains`, { domain: `  ${domain.toUpperCase()}. ` });
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: Json }).data;
    expect(data).toMatchObject({ domain, status: "pending", recordName: `_soupnet-challenge.${domain}`, autoJoin: false, recheckEveryHours: 24, graceDays: 14, challengeDays: 7 });
    expect(String(data["recordValue"])).toMatch(/^soupnet-domain-verification=[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(String(data["tokenExpiresAt"])) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(data).not.toHaveProperty("accountsAwaitingJoin");
    expect(String(data["instructions"])).toContain("Subdomains are verified separately");

    // Adding it again returns the same claim with the same token.
    const again = await call(olive, "POST", `/organizations/${orgId}/domains`, { domain });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: Json }).data["recordValue"]).toBe(data["recordValue"]);

    const listed = ((await (await call(olive, "GET", `/organizations/${orgId}/domains`)).json()) as { data: Json[] }).data;
    expect(listed.map((c) => c["domain"])).toEqual([domain]);
    expect(await auditRows("organization_domain.added", data["id"] as string)).toHaveLength(1);
  });

  it("ORG-DOM-02 / OD-V2: invalid names and public providers are refused with their reasons, nothing stored", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    for (const [domain, error] of [["gmail.com", "public_email_domain"], ["contoso.onmicrosoft.com", "public_email_domain"], ["192.0.2.1", "invalid_domain"], ["localhost", "invalid_domain"], ["https://acme.example", "invalid_domain"], [42, "invalid_domain"]] as const) {
      const res = await call(olive, "POST", `/organizations/${orgId}/domains`, { domain });
      expect(res.status, String(domain)).toBe(400);
      expect(((await res.json()) as Json)["error"]).toBe(error);
    }
    const listed = ((await (await call(olive, "GET", `/organizations/${orgId}/domains`)).json()) as { data: Json[] }).data;
    expect(listed).toEqual([]);
  });

  it("ORG-DOM-02 / OD-V2, OD-S1: a domain verified by another organization is refused without naming it; pending claims coexist", async () => {
    const olive = await actor("olive");
    const acme = await createOrg(olive);
    const rex = await actor("rex");
    const globex = await createOrg(rex);
    const domain = testDomain();

    // Both pending at once.
    const globexClaim = await addDomain(rex, globex.orgId, domain);
    const acmeClaim = await addDomain(olive, acme.orgId, domain);
    // Globex verifies first; Acme's verification then collides.
    expect((await checkNow(rex, globex.orgId, globexClaim["id"] as string)).status).toBe(200);
    const collide = await checkNow(olive, acme.orgId, acmeClaim["id"] as string);
    expect(collide.status).toBe(409);
    const body = (await collide.json()) as Json;
    expect(body["error"]).toBe("domain_taken");
    expect(JSON.stringify(body)).not.toContain("Acme");
    expect(JSON.stringify(body)).not.toContain(rex.email);

    // And adding it fresh is refused the same way.
    const olive2 = await actor("olive2");
    const other = await createOrg(olive2);
    const add = await call(olive2, "POST", `/organizations/${other.orgId}/domains`, { domain });
    expect(add.status).toBe(409);
    expect(((await add.json()) as Json)["message"]).toBe("This domain is already verified by another organization. Contact Soup.net support.");
  });

  it("ORG-DOM-03 / OD-V3: check now verifies a published record; absent and error stay pending without echoing DNS", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);

    const ok = await addDomain(olive, orgId, testDomain("dns-ok"));
    const okRes = await checkNow(olive, orgId, ok["id"] as string);
    expect(okRes.status).toBe(200);
    const okData = ((await okRes.json()) as { data: Json }).data;
    expect(okData["status"]).toBe("verified");
    expect(okData).not.toHaveProperty("message");
    expect(okData["accountsAwaitingJoin"]).toBe(0);
    expect(await auditRows("organization_domain.verified", ok["id"] as string)).toHaveLength(1);

    for (const kind of ["dns-absent", "dns-error"] as const) {
      const claim = await addDomain(olive, orgId, testDomain(kind));
      const res = await checkNow(olive, orgId, claim["id"] as string);
      expect(res.status).toBe(200);
      const data = ((await res.json()) as { data: Json }).data;
      expect(data["status"]).toBe("pending");
      expect(data["message"]).toBe(`No matching record was found at ${claim["recordName"] as string}. DNS changes can take up to 72 hours to appear.`);
      expect(JSON.stringify(data)).not.toMatch(/ENOTFOUND|ETIMEOUT/);
    }
  });

  it("ORG-DOM-03 / OD-V3, OD-V1: an expired challenge is refused; adding the domain again issues a new token", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const claim = await addDomain(olive, orgId, testDomain());
    const claimId = claim["id"] as string;
    await getDb().execute(sql`UPDATE claimnet.organization_domains SET token_issued_at = NOW() - interval '8 days' WHERE id = ${claimId}::uuid`);

    const res = await checkNow(olive, orgId, claimId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json)["error"]).toBe("challenge_expired");

    const listed = ((await (await call(olive, "GET", `/organizations/${orgId}/domains`)).json()) as { data: Json[] }).data;
    expect(listed[0]!["status"]).toBe("expired");

    const again = await call(olive, "POST", `/organizations/${orgId}/domains`, { domain: claim["domain"] });
    const fresh = ((await again.json()) as { data: Json }).data;
    expect(fresh["id"]).toBe(claimId);
    expect(fresh["recordValue"]).not.toBe(claim["recordValue"]);
    expect(fresh["status"]).toBe("pending");
    expect((await checkNow(olive, orgId, claimId)).status).toBe(200);
  });

  // ── The domain authority ─────────────────────────────────────────────────

  it("ORG-DOM-07 / OD-R6: the join's domain authority holds only for a captured claim, freshness first", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);
    const holds = async (org = orgId): Promise<boolean> => {
      const rows = (await getDb().execute(sql`SELECT ${authority.domainVerifiedFor(org, domain)} AS ok`)) as unknown as Array<{ ok: boolean }>;
      return rows[0]!.ok;
    };
    const current = async (): Promise<boolean> => {
      const rows = (await getDb().execute(sql`SELECT ${authority.domainClaimCurrentFor(orgId, domain)} AS ok`)) as unknown as Array<{ ok: boolean }>;
      return rows[0]!.ok;
    };
    expect(await holds()).toBe(true);

    const set = (assignment: ReturnType<typeof sql>) => getDb().execute(sql`UPDATE claimnet.organization_domains SET ${assignment} WHERE id = ${claimId}::uuid`);

    // The last successful check was 49 hours ago: a stopped job freezes joins.
    await set(sql`last_checked_at = NOW() - interval '49 hours'`);
    expect(await holds()).toBe(false);
    expect(await current()).toBe(false);
    await set(sql`last_checked_at = NOW() - interval '47 hours'`);
    expect(await holds()).toBe(true);

    await set(sql`failing_since = NOW()`);
    expect(await holds()).toBe(false);
    await set(sql`failing_since = NULL`);

    await set(sql`auto_join = false`);
    expect(await holds()).toBe(false);
    expect(await current()).toBe(true); // Core's operator join doesn't depend on the switch
    await set(sql`auto_join = true`);

    // Another organization's id never holds on Acme's claim.
    const rex = await actor("rex");
    expect(await holds((await createOrg(rex)).orgId)).toBe(false);

    // Through Core's join: Nia on the domain, with the switch off, is refused.
    const nia = await actor("nia", `test-orgdom-nia-${run}-${++n}@${domain}`);
    await set(sql`auto_join = false`);
    expect(await authz.joinOrganization(getDb(), { organizationId: orgId, userId: nia.userId, role: "member", via: "migrated", authority: { kind: "domain", domain } })).toEqual({ ok: false, refusal: "not_authorized" });
  });

  // ── Re-verification ──────────────────────────────────────────────────────

  it("ORG-DOM-04, ORG-DOM-05 / OD-R1 to OD-R3: a failed daily check freezes joining and tells the managers once; recovery resumes", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const ada = await actor("ada");
    await addToOrg(orgId, ada, "admin");
    const { claimId, domain } = await capture(olive, orgId);

    const first = await domains.recheckDomains(getDb(), { lookup: absent, organizationId: orgId });
    expect(first.events).toEqual({ failing: 1 });
    const row = await claimRow(claimId);
    expect(row["failing_since"]).not.toBeNull();
    expect(row["verified_at"]).not.toBeNull();

    const listed = ((await (await call(olive, "GET", `/organizations/${orgId}/domains`)).json()) as { data: Json[] }).data[0]!;
    expect(listed["status"]).toBe("failing");
    expect(Date.parse(String(listed["lapsesAt"])) - Date.now()).toBeGreaterThan(13.9 * 24 * 3600_000);

    // One email per active manager, by the logged sender (sent or failed).
    let mail: Array<{ to_email: string; subject: string }> = [];
    for (let i = 0; i < 40 && mail.length < 2; i++) {
      mail = (await getDb().execute(sql`
        SELECT to_email, subject FROM claimnet.email_log WHERE kind = 'organization_domain' AND subject LIKE ${`%${domain}%`}
      `)) as unknown as Array<{ to_email: string; subject: string }>;
      if (mail.length < 2) await new Promise((r) => setTimeout(r, 50));
    }
    expect(mail.map((m) => m.to_email).sort()).toEqual([olive.email, ada.email].sort());

    // A newcomer's join is refused while failing.
    const nia = await actor("nia", `test-orgdom-nia-${run}-${++n}@${domain}`);
    expect((await domains.migrateDomainAccounts(getDb(), claimId)).joined).toBe(0);
    expect(await orgOf(nia.userId)).toBeUndefined();

    // A second failure sends nothing new.
    expect((await domains.recheckDomains(getDb(), { lookup: absent, organizationId: orgId })).events).toEqual({ still_failing: 1 });

    // The record comes back: recovered, and the job's migration seats Nia.
    const back = await domains.recheckDomains(getDb(), { lookup: found, organizationId: orgId });
    expect(back.events).toEqual({ recovered: 1 });
    expect((await claimRow(claimId))["failing_since"]).toBeNull();
    expect(await orgOf(nia.userId)).toMatchObject({ organization_id: orgId, joined_via: "migrated" });
    expect(await auditRows("organization_domain.recovered", claimId)).toHaveLength(1);
  });

  it("ORG-DOM-06 / OD-R4, OD-R5: fourteen days of failure lapses the claim, rotates its token, and leaves every member as they were", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);
    const max = await actor("max", `test-orgdom-max-${run}-${++n}@${domain}`);
    await domains.migrateDomainAccounts(getDb(), claimId);
    expect(await orgOf(max.userId)).toMatchObject({ organization_id: orgId });
    const before = await getDb().execute(sql`SELECT group_id, role, via FROM claimnet.group_members WHERE user_id = ${max.userId}::uuid ORDER BY group_id`);
    const tokenBefore = (await claimRow(claimId))["challenge_token"];

    await getDb().execute(sql`UPDATE claimnet.organization_domains SET failing_since = NOW() - interval '13 days 22 hours' WHERE id = ${claimId}::uuid`);
    expect((await domains.recheckDomains(getDb(), { lookup: absent, organizationId: orgId })).events).toEqual({ still_failing: 1 });

    await getDb().execute(sql`UPDATE claimnet.organization_domains SET failing_since = NOW() - interval '14 days 1 hour' WHERE id = ${claimId}::uuid`);
    expect((await domains.recheckDomains(getDb(), { lookup: absent, organizationId: orgId })).events).toEqual({ lapsed: 1 });
    const row = await claimRow(claimId);
    expect(row).toMatchObject({ verified_at: null, failing_since: null, auto_join: true });
    expect(row["challenge_token"]).not.toBe(tokenBefore);

    expect(await orgOf(max.userId)).toMatchObject({ organization_id: orgId, role: "member" });
    expect(await getDb().execute(sql`SELECT group_id, role, via FROM claimnet.group_members WHERE user_id = ${max.userId}::uuid ORDER BY group_id`)).toEqual(before);
    expect(before.map((r) => (r as Json)["group_id"])).toContain(defaultBookId);
    expect(await auditRows("organization_domain.lapsed", claimId)).toHaveLength(1);
  });

  it("ORG-DOM-08 / OD-R7: another organization verifying a lapsed domain inherits nobody", async () => {
    const olive = await actor("olive");
    const acme = await createOrg(olive);
    const { claimId, domain } = await capture(olive, acme.orgId);
    const max = await actor("max", `test-orgdom-max-${run}-${++n}@${domain}`);
    await domains.migrateDomainAccounts(getDb(), claimId);
    await getDb().execute(sql`UPDATE claimnet.organization_domains SET failing_since = NOW() - interval '15 days' WHERE id = ${claimId}::uuid`);
    await domains.recheckDomains(getDb(), { lookup: absent, organizationId: acme.orgId });

    const rex = await actor("rex");
    const globex = await createOrg(rex);
    const theirs = await capture(rex, globex.orgId, domain);
    expect((await claimRow(theirs.claimId))["verified_at"]).not.toBeNull();
    expect(await orgOf(max.userId)).toMatchObject({ organization_id: acme.orgId });
    const globexMembers = (await getDb().execute(sql`SELECT user_id FROM ${authz.orgMembersOf(globex.orgId)} m`)) as unknown as Array<{ user_id: string }>;
    expect(globexMembers.map((m) => m.user_id)).toEqual([rex.userId]);
  });

  // ── Joining at the proof step ────────────────────────────────────────────

  it("ORG-JOIN-D01 / OD-J1, OD-J4, OD-J7: a password sign-up on a captured domain joins on its verification click", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const { domain } = await capture(olive, orgId);

    const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
    const nia = await register(email);
    const other = await register(`test-orgdom-gus-${run}-${++n}@test.local`);
    // The register bodies differ only in the test-mode token.
    const strip = (b: Json) => JSON.stringify({ ...b, data: { ...(b["data"] as Json), verificationToken: undefined } });
    expect(strip(nia.body)).toBe(strip(other.body));

    const res = await verify(nia.token);
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: Json }).data;
    expect(data).toMatchObject({ verified: true, waitlisted: false, organization: { name: expect.stringContaining("Acme"), notice: expect.stringMatching(/^Your account now belongs to Acme .* on Soup\.net\. Acme .*'s admins manage it\.$/) } });
    const userId = await userIdOf(email);
    expect(await orgOf(userId)).toMatchObject({ organization_id: orgId, joined_via: "domain", role: "member" });
    const row = (await getDb().execute(sql`SELECT daily_read FROM claimnet.group_members WHERE group_id = ${defaultBookId}::uuid AND user_id = ${userId}::uuid`)) as unknown as Array<{ daily_read: boolean }>;
    expect(row[0]?.daily_read).toBe(true);

    // The second click changes nothing. With no session it says only what anyone
    // holding the link knows (F158); the account's own session is told which
    // organization manages it.
    const again = await verify(nia.token);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: Json }).data).toEqual({ verified: true, alreadyVerified: true, email, ownSession: false });
    const own = await call({ jwt: data["token"] as string }, "POST", "/auth/verify", { token: nia.token });
    expect(((await own.json()) as { data: Json }).data["organization"]).toEqual(data["organization"]);
    expect(await orgOf(userId)).toMatchObject({ organization_id: orgId, joined_via: "domain" });

    // An account on an ordinary domain: verified, no organization.
    const plain = await verify(other.token);
    expect(((await plain.json()) as { data: Json }).data["organization"]).toBeNull();
  });

  it("ORG-JOIN-D02 / OD-J2: with the switch off, failing, or stale, the click verifies and joins nothing", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);
    for (const state of [sql`auto_join = false`, sql`failing_since = NOW()`, sql`last_checked_at = NOW() - interval '3 days'`]) {
      await getDb().execute(sql`UPDATE claimnet.organization_domains SET auto_join = true, failing_since = NULL, last_checked_at = NOW() WHERE id = ${claimId}::uuid`);
      await getDb().execute(sql`UPDATE claimnet.organization_domains SET ${state} WHERE id = ${claimId}::uuid`);
      const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
      const { token } = await register(email);
      expect((await verify(token)).status).toBe(200);
      expect(await verifiedAt(email)).not.toBeNull();
      expect(await orgOf(await userIdOf(email))).toBeUndefined();
    }
  });

  it("ORG-JOIN-D03, ORG-SEAT-D02 / OD-J3, OD-C2: the Google hook joins only on a matching hd, and reports full", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive, 2);
    const { domain } = await capture(olive, orgId);
    const hook = async (email: string, hd: string | null): Promise<string> => {
      const a = await actor("g", email);
      return getDb().transaction((tx) => domains.onGoogleSignIn(tx, { userId: a.userId, email, hd }));
    };
    expect(await hook(`test-orgdom-a-${run}-${++n}@${domain}`, null)).toBe("none");
    expect(await hook(`test-orgdom-b-${run}-${++n}@${domain}`, `acme-corp-${run}.test`)).toBe("none");
    expect(await hook(`test-orgdom-c-${run}-${++n}@sub.${domain}`, domain)).toBe("none");
    expect(await hook(`test-orgdom-d-${run}-${++n}@${domain}`, domain.toUpperCase())).toBe("joined");
    // Olive and d hold both seats.
    expect(await hook(`test-orgdom-e-${run}-${++n}@${domain}`, domain)).toBe("full");
  });

  it("ORG-JOIN-D03 / OD-J3, OD-J4: SSO's afterGoogleSignIn hook joins a new account via domain and an existing one via migrated, with Core's notice", async () => {
    const google = await import("../services/google-sign-in.service");
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { domain } = await capture(olive, orgId);

    const fresh = await actor("g", `test-orgdom-new-${run}-${++n}@${domain}`);
    expect(await getDb().transaction((tx) => google.afterGoogleSignIn(tx, { userId: fresh.userId, email: fresh.email, hd: domain, created: true }))).toBe("joined");
    expect(await orgOf(fresh.userId)).toMatchObject({ organization_id: orgId, joined_via: "domain" });

    const existing = await actor("g", `test-orgdom-old-${run}-${++n}@${domain}`);
    expect(await getDb().transaction((tx) => google.afterGoogleSignIn(tx, { userId: existing.userId, email: existing.email, hd: domain, created: false }))).toBe("joined");
    expect(await orgOf(existing.userId)).toMatchObject({ organization_id: orgId, joined_via: "migrated" });
    let notices: unknown[] = [];
    for (let i = 0; i < 40 && notices.length === 0; i++) {
      notices = (await getDb().execute(sql`SELECT 1 FROM claimnet.email_log WHERE kind = 'organization_joined' AND to_email = ${existing.email}`)) as unknown as unknown[];
      if (notices.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(notices).toHaveLength(1);

    // No hd: the hook does nothing.
    const consumer = await actor("g", `test-orgdom-consumer-${run}-${++n}@${domain}`);
    expect(await getDb().transaction((tx) => google.afterGoogleSignIn(tx, { userId: consumer.userId, email: consumer.email, hd: null, created: true }))).toBe("none");
    expect(await orgOf(consumer.userId)).toBeUndefined();
  });

  it("ORG-JOIN-D04, ORG-JOIN-D05 / OD-J5, OD-J6: never the site operator's account; an account in another organization stays there", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);

    const ops = await actor("ops", `test-orgdom-ops-${run}-${++n}@${domain}`);
    await getDb().execute(sql`UPDATE claimnet.users SET role = 'system' WHERE id = ${ops.userId}::uuid`);
    await domains.migrateDomainAccounts(getDb(), claimId);
    expect(await orgOf(ops.userId)).toBeUndefined();
    expect(await getDb().transaction((tx) => domains.onGoogleSignIn(tx, { userId: ops.userId, email: ops.email, hd: domain }))).toBe("none");

    const rex = await actor("rex");
    const globex = await createOrg(rex);
    const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
    const { token } = await register(email);
    const niaId = await userIdOf(email);
    expect(await authz.joinOrganization(getDb(), { organizationId: globex.orgId, userId: niaId, role: "member", via: "operator", authority: { kind: "operator", actorUserId: sys.userId } })).toMatchObject({ ok: true });
    expect((await verify(token)).status).toBe(200);
    expect(await orgOf(niaId)).toMatchObject({ organization_id: globex.orgId });
  });

  it("ORG-JOIN-D06 / OD-J8: a claim covers its exact domain, never its subdomains", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);
    const email = `test-orgdom-nia-${run}-${++n}@mail.${domain}`;
    const { token } = await register(email);
    expect((await verify(token)).status).toBe(200);
    const niaId = await userIdOf(email);
    expect(await orgOf(niaId)).toBeUndefined();
    await domains.migrateDomainAccounts(getDb(), claimId);
    expect(await orgOf(niaId)).toBeUndefined();
    expect(await getDb().transaction((tx) => domains.onGoogleSignIn(tx, { userId: niaId, email, hd: domain }))).toBe("none");
  });

  // ── Existing accounts ────────────────────────────────────────────────────

  it("ORG-MIG-01, ORG-MIG-02, ORG-MIG-04 / OD-X1, OD-X2, OD-X4: turning on the switch migrates verified accounts, with an audit row naming the claim", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const domain = testDomain();
    const claim = await addDomain(olive, orgId, domain);
    const claimId = claim["id"] as string;

    const max = await actor("max", `test-orgdom-max-${run}-${++n}@${domain}`);
    const dee = `test-orgdom-dee-${run}-${++n}@${domain}`;
    await register(dee); // never verified

    // Pending: no count at all.
    let listed = ((await (await call(olive, "GET", `/organizations/${orgId}/domains`)).json()) as { data: Json[] }).data[0]!;
    expect(listed).not.toHaveProperty("accountsAwaitingJoin");

    // Verified with the switch off: a count, never a list.
    await checkNow(olive, orgId, claimId);
    listed = ((await (await call(olive, "GET", `/organizations/${orgId}/domains`)).json()) as { data: Json[] }).data[0]!;
    expect(listed["accountsAwaitingJoin"]).toBe(1);
    expect(JSON.stringify(listed)).not.toContain(max.email);
    expect(await orgOf(max.userId)).toBeUndefined();

    const on = await setAutoJoin(olive, orgId, claimId, true);
    expect(on.status).toBe(200);
    const data = ((await on.json()) as { data: Json }).data;
    expect(data["migration"]).toEqual({ joined: 1, awaitingSeat: 0 });
    expect(data["accountsAwaitingJoin"]).toBe(0);

    expect(await orgOf(max.userId)).toMatchObject({ organization_id: orgId, joined_via: "migrated" });
    const book = (await getDb().execute(sql`SELECT organization_id FROM claimnet.groups WHERE id = ${max.personalBookId}::uuid`)) as unknown as Array<{ organization_id: string }>;
    expect(book[0]!.organization_id).toBe(orgId);
    const audits = await auditRows("organization_domain.migrated", claimId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!["metadata"]).toMatchObject({ claimId, domain, userId: max.userId });
    expect(await orgOf(await userIdOf(dee))).toBeUndefined();

    // Core's notice for the migrated account.
    let notices: unknown[] = [];
    for (let i = 0; i < 40 && notices.length === 0; i++) {
      notices = (await getDb().execute(sql`SELECT 1 FROM claimnet.email_log WHERE kind = 'organization_joined' AND to_email = ${max.email}`)) as unknown as unknown[];
      if (notices.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(notices).toHaveLength(1);
  });

  it("ORG-MIG-03 / OD-X3: a migration the request didn't finish is continued by the daily job", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);
    const people = await Promise.all([1, 2, 3].map(() => actor("p", `test-orgdom-p-${run}-${++n}@${domain}`)));
    expect(await domains.migrateDomainAccounts(getDb(), claimId, 2)).toEqual({ joined: 2, awaitingSeat: 0 });
    await domains.recheckDomains(getDb(), { lookup: found, organizationId: orgId });
    for (const p of people) expect(await orgOf(p.userId)).toMatchObject({ organization_id: orgId });
  });

  // ── Seats ────────────────────────────────────────────────────────────────

  it("ORG-SEAT-D01 / OD-C1: a verification click at the seat limit is refused, leaves the address unverified, and works once a seat frees", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive, 2);
    const ann = await actor("ann");
    await addToOrg(orgId, ann);
    const { domain } = await capture(olive, orgId);

    const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
    const { token } = await register(email);
    const refused = await verify(token);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      ok: false,
      error: "organization_full",
      message: "This organization has no free seats. Ask one of its admins.",
      detail: "Your address isn't verified yet. This same link works for 24 hours once a seat is free, or sign in later to get a new one.",
    });
    expect(await verifiedAt(email)).toBeNull();

    expect((await call(olive, "POST", `/organizations/${orgId}/members/${ann.userId}/disable`)).status).toBe(200);
    const joined = await verify(token);
    expect(joined.status).toBe(200);
    expect(await orgOf(await userIdOf(email))).toMatchObject({ organization_id: orgId, joined_via: "domain" });
  });

  it("ORG-JOIN-D05 / OD-J5: a password reset verifies the address, so it joins the captured domain's organization", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { domain } = await capture(olive, orgId);
    const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
    await register(email);

    const data = await resetPassword(email);
    expect(data["organizationLines"]).toEqual([expect.stringMatching(/^Your account now belongs to Acme /)]);
    expect(await verifiedAt(email)).not.toBeNull();
    expect(await orgOf(await userIdOf(email))).toMatchObject({ organization_id: orgId, joined_via: "domain" });

    // A reset on an account already verified joins nothing here; the migration owns those.
    const max = await actor("max");
    expect((await resetPassword(max.email))["organizationLines"]).toBeUndefined();
  });

  it("ORG-SEAT-D06 / OD-J5, OD-C1: a reset at the seat limit keeps the new password and leaves the address unverified", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive, 1);
    const { domain } = await capture(olive, orgId);
    const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
    const { token } = await register(email);

    const data = await resetPassword(email);
    expect(data["organizationLines"]).toEqual(["This organization has no free seats. Ask one of its admins.", expect.stringContaining("Your password is changed")]);
    expect(await verifiedAt(email)).toBeNull();
    expect(await orgOf(await userIdOf(email))).toBeUndefined();

    // The old password no longer proves anything; the new one does, once a seat frees.
    expect((await call(null, "POST", "/auth/verify", { token, password: PASSWORD })).status).toBe(401);
    expect((await call(sys, "PATCH", `/admin/organizations/${orgId}`, { seatLimit: 2 })).status).toBe(200);
    expect((await call(null, "POST", "/auth/verify", { token, password: NEW_PASSWORD })).status).toBe(200);
    expect(await orgOf(await userIdOf(email))).toMatchObject({ organization_id: orgId, joined_via: "domain" });
  });

  it("ORG-SEAT-D03 / OD-C3: the migration leaves an account it can't seat as it is, counts it, and seats it later", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive, 1);
    const domain = testDomain();
    const claim = await addDomain(olive, orgId, domain);
    const claimId = claim["id"] as string;
    await checkNow(olive, orgId, claimId);
    const max = await actor("max", `test-orgdom-max-${run}-${++n}@${domain}`);

    const on = ((await (await setAutoJoin(olive, orgId, claimId, true)).json()) as { data: Json }).data;
    expect(on["migration"]).toEqual({ joined: 0, awaitingSeat: 1 });
    expect(on["accountsAwaitingJoin"]).toBe(1);
    expect(await orgOf(max.userId)).toBeUndefined();
    const book = (await getDb().execute(sql`SELECT organization_id FROM claimnet.groups WHERE id = ${max.personalBookId}::uuid`)) as unknown as Array<{ organization_id: string }>;
    expect(book[0]!.organization_id).not.toBe(orgId);

    expect((await call(sys, "PATCH", `/admin/organizations/${orgId}`, { seatLimit: 2 })).status).toBe(200);
    await domains.recheckDomains(getDb(), { lookup: found, organizationId: orgId });
    expect(await orgOf(max.userId)).toMatchObject({ organization_id: orgId, joined_via: "migrated" });
  });

  it("ORG-SEAT-D04 / OD-C4, OD-C5: a domain join leaves the waitlist, and managed accounts don't count toward the public cap", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { domain } = await capture(olive, orgId);
    const nia = await actor("nia", `test-orgdom-nia-${run}-${++n}@${domain}`);
    await getDb().execute(sql`UPDATE claimnet.users SET waitlisted_at = NOW() WHERE id = ${nia.userId}::uuid`);

    // One snapshot, so other tests' sign-ups can't move the count under us.
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`UPDATE claimnet.users SET waitlisted_at = NULL WHERE id = ${nia.userId}::uuid`);
      const before = await settings.getVerifiedUserCount(tx as never);
      const outcome = await domains.joinOnVerification(tx, { userId: nia.userId, email: nia.email });
      expect(outcome.kind).toBe("joined");
      expect(await settings.getVerifiedUserCount(tx as never)).toBe(before - 1);
      tx.rollback();
    }, { isolationLevel: "repeatable read" }).catch((err: unknown) => {
      if (!(err instanceof Error) || !/rollback/i.test(err.message)) throw err;
    });

    // And the waitlist is cleared by the join itself.
    const outcome = await getDb().transaction((tx) => domains.joinOnVerification(tx, { userId: nia.userId, email: nia.email }));
    expect(outcome.kind).toBe("joined");
    const rows = (await getDb().execute(sql`SELECT waitlisted_at FROM claimnet.users WHERE id = ${nia.userId}::uuid`)) as unknown as Array<{ waitlisted_at: unknown }>;
    expect(rows[0]!.waitlisted_at).toBeNull();
  });

  // ── Removing ─────────────────────────────────────────────────────────────

  it("ORG-DOM-10 / OD-A3, OD-A4: deleting a claim stops joining at once and keeps every member", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const { claimId, domain } = await capture(olive, orgId);
    const max = await actor("max", `test-orgdom-max-${run}-${++n}@${domain}`);
    await domains.migrateDomainAccounts(getDb(), claimId);

    expect((await call(olive, "DELETE", `/organizations/${orgId}/domains/${claimId}`)).status).toBe(200);
    expect(await auditRows("organization_domain.removed", claimId)).toHaveLength(1);
    expect(await orgOf(max.userId)).toMatchObject({ organization_id: orgId });

    const email = `test-orgdom-nia-${run}-${++n}@${domain}`;
    const { token } = await register(email);
    expect((await verify(token)).status).toBe(200);
    expect(await orgOf(await userIdOf(email))).toBeUndefined();
  });
});
