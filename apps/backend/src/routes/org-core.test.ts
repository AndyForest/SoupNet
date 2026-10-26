import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { seedVerifiedUser } from "../test-users";

/**
 * Organization accounts round 1, stream Core (rubric
 * docs/planning/org-accounts-build/core.md; scenarios
 * docs/product-specs/organizations.feature). Requires running backend +
 * postgres.
 *
 * Accounts, books, keys and organizations are made through the real HTTP
 * surface; the authz module's functions are called directly where a row's
 * state is the point (a key's effective scope, a refresh token's
 * consumption). Direct SQL only puts a row into a state no route produces
 * (the system role for the site operator) or reads state back.
 *
 * Cast, as in the rubric: Sys (the site operator), Olive (Acme's owner), Ada
 * (an Acme admin), Max (a member who had an account before), Gus (a personal
 * account outside Acme). Every test builds its own organization.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let authz: typeof import("../authz");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let oauth: typeof import("../services/oauth.service");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let userDelete: typeof import("../services/user-delete.service");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = "org-core-test-pw";
let n = 0;

type Json = Record<string, unknown>;

interface Actor {
  email: string;
  jwt: string;
  userId: string;
  personalBookId: string;
  personalOrgId: string;
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

async function login(email: string): Promise<Response> {
  return fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

describe.skipIf(!canConnect() || !BASE)("organization accounts: stream Core", () => {
  let sys: Actor;

  async function actor(label: string): Promise<Actor> {
    const email = `test-org-${label}-${run}-${++n}@test.local`;
    const res = await seedVerifiedUser(email, PASSWORD);
    const body = (await res.json()) as { data?: { token?: string; user?: { id: string } } };
    const token = body.data?.token ?? "";
    const userId = body.data?.user?.id ?? "";
    if (!token || !userId) throw new Error(`login failed for ${email}`);
    const books = ((await (await call({ jwt: token }, "GET", "/recipe-books")).json()) as {
      data: Array<{ id: string; organization_id: string }>;
    }).data;
    return { email, jwt: token, userId, personalBookId: books[0]!.id, personalOrgId: books[0]!.organization_id };
  }

  async function relogin(a: Actor): Promise<Actor> {
    const body = (await (await login(a.email)).json()) as { data?: { token?: string } };
    return { ...a, jwt: body.data?.token ?? "" };
  }

  async function createOrg(owner: Actor, seatLimit: number | null = null): Promise<{ orgId: string; defaultBookId: string; slug: string }> {
    const slug = `acme-${run}-${++n}`;
    const res = await call(sys, "POST", "/admin/organizations", { name: `Acme ${n}`, slug, ownerEmail: owner.email, seatLimit });
    const body = (await res.json()) as { data?: { organizationId: string; defaultRecipeBookId: string } };
    if (res.status !== 201 || !body.data) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(body)}`);
    return { orgId: body.data.organizationId, defaultBookId: body.data.defaultRecipeBookId, slug };
  }

  function addToOrg(orgId: string, who: Actor, role: "owner" | "admin" | "member" = "member"): Promise<Response> {
    return call(sys, "POST", `/admin/organizations/${orgId}/members`, { email: who.email, role });
  }

  async function mustAdd(orgId: string, who: Actor, role: "owner" | "admin" | "member" = "member"): Promise<void> {
    const res = await addToOrg(orgId, who, role);
    if (res.status !== 201) throw new Error(`addToOrg failed: ${res.status} ${await res.text()}`);
  }

  async function mintScoped(a: Actor, bookIds: string[], days = 30): Promise<Response> {
    return call(a, "POST", "/keys/scoped", {
      readRecipeBookIds: bookIds,
      writeRecipeBookIds: bookIds,
      defaultWriteRecipeBookId: bookIds[0],
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  async function scopedKey(a: Actor, bookIds: string[]): Promise<string> {
    const res = await mintScoped(a, bookIds);
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`scoped key mint failed: ${res.status}`);
    return key;
  }

  async function dailyKey(a: Actor): Promise<{ key: string; readRecipeBookIds: string[] }> {
    const res = await call(a, "POST", "/keys/daily", {});
    const data = ((await res.json()) as { data?: { key: string; readRecipeBookIds: string[] } }).data;
    if (!data) throw new Error(`daily key mint failed: ${res.status}`);
    return data;
  }

  async function bookOf(bookId: string): Promise<{ organization_id: string; slug: string; org_wide: boolean }> {
    const rows = (await getDb().execute(sql`SELECT organization_id, slug, org_wide FROM claimnet.groups WHERE id = ${bookId}::uuid`)) as unknown as Array<{ organization_id: string; slug: string; org_wide: boolean }>;
    return rows[0]!;
  }

  async function membershipRow(bookId: string, userId: string): Promise<{ role: string; via: string; daily_read: boolean; daily_write: boolean } | undefined> {
    const rows = (await getDb().execute(sql`
      SELECT role, via, daily_read, daily_write FROM claimnet.group_members WHERE group_id = ${bookId}::uuid AND user_id = ${userId}::uuid
    `)) as unknown as Array<{ role: string; via: string; daily_read: boolean; daily_write: boolean }>;
    return rows[0];
  }

  async function keyRows(userId: string): Promise<unknown[]> {
    return (await getDb().execute(sql`
      SELECT id, expires_at, consumed_at, read_group_ids, write_group_ids, default_write_group_id
      FROM claimnet.api_keys WHERE user_id = ${userId}::uuid ORDER BY id
    `)) as unknown as unknown[];
  }

  beforeAll(async () => {
    authz = await import("../authz");
    oauth = await import("../services/oauth.service");
    userDelete = await import("../services/user-delete.service");
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    const s = await actor("sys");
    await getDb().execute(sql`UPDATE claimnet.users SET role = 'system' WHERE id = ${s.userId}::uuid`);
    sys = await relogin(s);
  }, 60_000);

  // ── Creating an organization ──────────────────────────────────────────────

  it("ORG-SETUP-01 / OC-B1, OC-B5, OC-R3: the site operator creates an organization, its default book and its owner's join", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);

    const me = ((await (await call(olive, "GET", "/auth/me")).json()) as { data: { user: Json } }).data.user;
    expect(me["organization"]).toMatchObject({ id: orgId, role: "owner" });

    expect(await bookOf(defaultBookId)).toMatchObject({ organization_id: orgId, org_wide: true });
    expect(await membershipRow(defaultBookId, olive.userId)).toMatchObject({ role: "owner", via: "direct", daily_read: true, daily_write: true });
    // Her own book moved under the company, keeping its id.
    expect((await bookOf(olive.personalBookId)).organization_id).toBe(orgId);
    // Her daily link reads the organization's shared ground from the first minute.
    expect((await dailyKey(olive)).readRecipeBookIds).toContain(defaultBookId);

    // A personal account reports no organization.
    const gus = await actor("gus");
    const gusMe = ((await (await call(gus, "GET", "/auth/me")).json()) as { data: { user: Json } }).data.user;
    expect(gusMe["organization"]).toBeNull();
  });

  it("OC-B1: only the site operator creates organizations, and an owner who can't join leaves nothing behind", async () => {
    const olive = await actor("olive");
    const gus = await actor("gus");
    const refused = await call(gus, "POST", "/admin/organizations", { name: "Nope", slug: `nope-${run}`, ownerEmail: gus.email });
    expect(refused.status).toBe(403);

    await createOrg(olive);
    const slug = `second-${run}-${++n}`;
    const second = await call(sys, "POST", "/admin/organizations", { name: "Second", slug, ownerEmail: olive.email });
    expect(second.status).toBe(409);
    expect(((await second.json()) as Json)["error"]).toBe("already_in_an_organization");
    const rows = (await getDb().execute(sql`SELECT 1 FROM claimnet.organizations WHERE slug = ${slug}`)) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });

  // ── Joining ───────────────────────────────────────────────────────────────

  it("ORG-JOIN-01 / OC-J2, OC-J3: an existing account's own books move under the company with everything attached; books others shared stay put", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const max = await actor("max");
    const gus = await actor("gus");
    const gusBook = ((await (await call(gus, "POST", "/recipe-books", { name: "Gus shares", slug: `gus-${run}-${++n}` })).json()) as { data: { id: string } }).data.id;
    expect((await call(gus, "POST", `/recipe-books/${gusBook}/members`, { email: max.email, role: "member" })).status).toBe(201);

    const key = await scopedKey(max, [max.personalBookId, gusBook]);
    const before = await authz.authenticateKey(getDb(), key);
    const res = await addToOrg(orgId, max);
    expect(res.status).toBe(201);
    const moved = ((await res.json()) as { data: { movedBooks: Array<{ slug: string; previousSlug: string }> } }).data.movedBooks;

    // Olive's "personal" already sits in Acme, so Max's slug changes on the collision only.
    const local = max.email.slice(0, max.email.indexOf("@"));
    expect(moved).toEqual([{ name: "Personal", previousSlug: "personal", slug: `personal-${local}` }]);
    expect(await bookOf(max.personalBookId)).toMatchObject({ organization_id: orgId, slug: `personal-${local}` });
    expect((await bookOf(gusBook)).organization_id).toBe(gus.personalOrgId);

    const after = await authz.authenticateKey(getDb(), key);
    expect(after!.readGroupIds).toEqual(before!.readGroupIds);
    expect(after!.writeGroupIds).toEqual(before!.writeGroupIds);
    expect(after!.defaultWriteGroupId).toBe(before!.defaultWriteGroupId);

    expect(await membershipRow(defaultBookId, max.userId)).toMatchObject({ role: "member", via: "org", daily_read: true, daily_write: true });
    expect(await authz.managedOrganizationOf(getDb(), max.userId)).toMatchObject({ organizationId: orgId, role: "member", joinedVia: "operator" });
  });

  it("ORG-JOIN-02 / OC-J4: the join's audit row records the notice as owed, and the logged sender records the send", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const max = await actor("max");
    await mustAdd(orgId, max);
    const audit = (await getDb().execute(sql`
      SELECT metadata FROM claimnet.audit_log
      WHERE action = 'organization.member_joined' AND target_id = ${orgId}::uuid AND metadata->>'userId' = ${max.userId}
    `)) as unknown as Array<{ metadata: Json }>;
    expect(audit[0]?.metadata).toMatchObject({ via: "operator", authority: "operator", noticeOwed: true });

    let status: string | undefined;
    for (let i = 0; i < 40 && !status; i++) {
      const rows = (await getDb().execute(sql`
        SELECT status FROM claimnet.email_log WHERE to_email = ${max.email} AND kind = 'organization_joined'
      `)) as unknown as Array<{ status: string }>;
      status = rows[0]?.status;
      if (!status) await new Promise((r) => setTimeout(r, 250));
    }
    expect(["sent", "failed"]).toContain(status);
  });

  it("ORG-JOIN-03 / OC-J6: an account joins one organization once", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const other = await createOrg(await actor("owner2"));
    const max = await actor("max");
    await mustAdd(orgId, max);
    const again = await addToOrg(orgId, max);
    expect(again.status).toBe(409);
    expect(((await again.json()) as Json)["error"]).toBe("already_a_member");
    const elsewhere = await addToOrg(other.orgId, max);
    expect(elsewhere.status).toBe(409);
    expect(((await elsewhere.json()) as Json)["error"]).toBe("already_in_an_organization");
  });

  it("ORG-JOIN-04 / OC-J1: the join checks its own authority", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const max = await actor("max");
    const gus = await actor("gus");
    const db = getDb();
    const base = { organizationId: orgId, userId: max.userId, role: "member" as const };
    expect(await authz.joinOrganization(db, { ...base, via: "operator", authority: { kind: "operator", actorUserId: gus.userId } }))
      .toEqual({ ok: false, refusal: "not_authorized" });
    // Until Domains supplies verification, no domain authority holds, matching domain or not.
    const domain = max.email.slice(max.email.indexOf("@") + 1);
    expect(await authz.joinOrganization(db, { ...base, via: "migrated", authority: { kind: "domain", domain } }))
      .toEqual({ ok: false, refusal: "not_authorized" });
    expect(await authz.joinOrganization(db, { ...base, via: "migrated", authority: { kind: "domain", domain: "elsewhere.example" } }))
      .toEqual({ ok: false, refusal: "not_authorized" });
    // An authority can't record another kind of arrival.
    expect(await authz.joinOrganization(db, { ...base, via: "domain", authority: { kind: "operator", actorUserId: sys.userId } }))
      .toEqual({ ok: false, refusal: "not_authorized" });
    expect(await authz.managedOrganizationOf(db, max.userId)).toBeNull();
  });

  it("ORG-SEAT-01 / OC-J5: seats count active members; a full organization refuses joins and re-enables, and two joins can't share the last seat", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive, 2);
    const [max, ned, pia, quin] = await Promise.all([actor("max"), actor("ned"), actor("pia"), actor("quin")]);
    await mustAdd(orgId, max);
    const full = await addToOrg(orgId, ned);
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: "organization_full", message: "This organization has no free seats. Ask one of its admins." });

    expect((await call(olive, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);
    await mustAdd(orgId, ned);
    const reenable = await call(olive, "POST", `/organizations/${orgId}/members/${max.userId}/enable`);
    expect(reenable.status).toBe(409);
    expect(((await reenable.json()) as Json)["error"]).toBe("organization_full");

    expect((await call(sys, "PATCH", `/admin/organizations/${orgId}`, { seatLimit: 3 })).status).toBe(200);
    const statuses = (await Promise.all([addToOrg(orgId, pia), addToOrg(orgId, quin)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  // ── Disable, re-enable, suspension ────────────────────────────────────────

  it("ORG-OFF-01, ORG-OFF-02 / OC-A1, OC-A2, OC-A6: disabling refuses every credential with nothing swept, and re-enabling restores the same ones", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const ada = await actor("ada");
    const max = await actor("max");
    await mustAdd(orgId, ada, "admin");
    await mustAdd(orgId, max);
    const daily = (await dailyKey(max)).key;
    const scoped = await scopedKey(max, [max.personalBookId, defaultBookId]);
    const bundle = await oauth.mintOAuthTokenBundle(getDb(), {
      userId: max.userId,
      clientId: `org-core-${run}`,
      scopeReadGroupIds: [max.personalBookId],
      scopeWriteGroupIds: [max.personalBookId],
      scopeDefaultWriteGroupId: max.personalBookId,
    });
    const refreshHash = crypto.createHash("sha256").update(bundle.refreshToken).digest("hex");
    const unknownKeyResponse = await fetch(`${BASE}/health/version`, { headers: { Authorization: "Bearer cn_s_not-a-real-key-at-all-000000000" } });
    const unknownBody = await unknownKeyResponse.text();
    const rowsBefore = await keyRows(max.userId);

    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);

    for (const key of [daily, scoped, bundle.accessToken]) {
      expect(await authz.authenticateKey(getDb(), key)).toBeNull();
    }
    const viaHttp = await fetch(`${BASE}/health/version`, { headers: { Authorization: `Bearer ${scoped}` } });
    expect(viaHttp.status).toBe(unknownKeyResponse.status);
    expect(await viaHttp.text()).toBe(unknownBody);

    const disabledBody = { ok: false, error: "account_disabled", message: "Your organization has disabled this account. Ask one of its admins to turn it back on." };
    const books = await call(max, "GET", "/recipe-books");
    expect(books.status).toBe(403);
    expect(await books.json()).toEqual(disabledBody);
    expect((await call(max, "GET", "/auth/me")).status).toBe(403);
    const signIn = await login(max.email);
    expect(signIn.status).toBe(403);
    expect(await signIn.json()).toEqual(disabledBody);

    expect(await authz.consumeRefreshToken(getDb(), refreshHash)).toBeNull();
    expect(await keyRows(max.userId)).toEqual(rowsBefore);

    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/enable`)).status).toBe(200);
    for (const key of [daily, scoped, bundle.accessToken]) {
      expect(await authz.authenticateKey(getDb(), key)).not.toBeNull();
    }
    expect((await call(max, "GET", "/recipe-books")).status).toBe(200);
    expect((await login(max.email)).status).toBe(200);
    expect(await authz.consumeRefreshToken(getDb(), refreshHash)).not.toBeNull();
  });

  it("ORG-OFF-03 / OC-A3: a site suspension refuses the same surfaces, and an org admin's re-enable doesn't lift it", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const max = await actor("max");
    await mustAdd(orgId, max);
    const key = await scopedKey(max, [max.personalBookId]);

    expect((await call(olive, "POST", `/admin/users/${max.userId}/suspend`, {})).status).toBe(403);
    expect((await call(olive, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);
    expect((await call(sys, "POST", `/admin/users/${max.userId}/suspend`, { reason: "abuse report" })).status).toBe(200);
    expect((await call(olive, "POST", `/organizations/${orgId}/members/${max.userId}/enable`)).status).toBe(200);

    const signIn = await login(max.email);
    expect(signIn.status).toBe(403);
    expect(await signIn.json()).toEqual({ ok: false, error: "account_suspended", message: "This account is suspended. Contact Soup.net support." });
    expect(((await (await call(max, "GET", "/recipe-books")).json()) as Json)["error"]).toBe("account_suspended");
    expect(await authz.authenticateKey(getDb(), key)).toBeNull();

    expect((await call(sys, "POST", `/admin/users/${max.userId}/unsuspend`)).status).toBe(200);
    expect(await authz.authenticateKey(getDb(), key)).not.toBeNull();
    expect((await login(max.email)).status).toBe(200);
  });

  it("ORG-OFF-04 / OC-A5: a session issued before the account's cut-off is refused; one issued after works", async () => {
    const gus = await actor("gus");
    const secret = process.env["JWT_SECRET"] ?? "";
    const old = jwt.sign({ sub: gus.userId, email: gus.email, role: "tenant", iat: Math.floor(Date.now() / 1000) - 60 }, secret, { algorithm: "HS256", expiresIn: "7d" });
    await authz.invalidateSessions(getDb(), gus.userId);
    const refused = await call({ jwt: old }, "GET", "/recipe-books");
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as Json)["error"]).toBe("session_expired");
    expect((await call({ jwt: old }, "GET", "/auth/me")).status).toBe(401);
    const fresh = await relogin(gus);
    expect((await call(fresh, "GET", "/recipe-books")).status).toBe(200);
  });

  // ── The org admin's actions ───────────────────────────────────────────────

  it("ORG-ROLE-01, ORG-ROLE-02 / OC-R1, OC-R2, OC-B4: role rules, org-row roles, and one 404 for everything outside", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const ada = await actor("ada");
    const max = await actor("max");
    const gus = await actor("gus");
    await mustAdd(orgId, ada, "admin");
    await mustAdd(orgId, max);

    expect(((await (await call(ada, "POST", `/organizations/${orgId}/members/${olive.userId}/disable`)).json()) as Json)["error"]).toBe("owner_only");
    expect(((await (await call(ada, "PATCH", `/organizations/${orgId}/members/${max.userId}`, { role: "owner" })).json()) as Json)["error"]).toBe("owner_only");
    const self = await call(ada, "POST", `/organizations/${orgId}/members/${ada.userId}/disable`);
    expect(self.status).toBe(403);
    expect(((await self.json()) as Json)["error"]).toBe("cannot_act_on_self");

    expect((await call(olive, "PATCH", `/organizations/${orgId}/members/${max.userId}`, { role: "admin" })).status).toBe(200);
    expect(await membershipRow(defaultBookId, max.userId)).toMatchObject({ role: "admin", via: "org" });
    // A direct row is never re-roled by an org change: Max still owns his own book.
    expect(await membershipRow(max.personalBookId, max.userId)).toMatchObject({ role: "owner", via: "direct" });
    expect(((await (await call(olive, "PATCH", `/organizations/${orgId}/members/${max.userId}`, { role: "boss" })).json()) as Json)["error"]).toBe("Invalid input");

    // Outside callers and unknown ids all get the same 404, byte for byte.
    const responses = await Promise.all([
      call(gus, "POST", `/organizations/${orgId}/members/${max.userId}/disable`),
      call(gus, "POST", `/organizations/${crypto.randomUUID()}/members/${max.userId}/disable`),
      call(ada, "POST", `/organizations/${orgId}/members/${gus.userId}/disable`),
      call(ada, "POST", `/organizations/not-a-uuid/members/${max.userId}/disable`),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(bodies).size).toBe(1);

    // A disabled admin is outside too.
    expect((await call(olive, "POST", `/organizations/${orgId}/members/${ada.userId}/disable`)).status).toBe(200);
    expect(await authz.actOnMember(getDb(), { organizationId: orgId, actorUserId: ada.userId, targetUserId: max.userId, action: { kind: "disable" } })).toBe("not_found");
    const audit = (await getDb().execute(sql`
      SELECT action FROM claimnet.audit_log WHERE target_id = ${max.userId}::uuid AND action LIKE 'organization.member_%' ORDER BY occurred_at
    `)) as unknown as Array<{ action: string }>;
    expect(audit.map((r) => r.action)).toContain("organization.member_set_role");
  });

  // ── Books ─────────────────────────────────────────────────────────────────

  it("ORG-BOOK-01 / OC-B2: a managed account's new books land in its organization; nobody creates in an organization that isn't theirs", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const max = await actor("max");
    const gus = await actor("gus");
    await mustAdd(orgId, max);

    const maxBook = ((await (await call(max, "POST", "/recipe-books", { name: "Max new", slug: `max-new-${run}` })).json()) as { data: { id: string } }).data.id;
    expect((await bookOf(maxBook)).organization_id).toBe(orgId);
    const gusBook = ((await (await call(gus, "POST", "/recipe-books", { name: "Gus new", slug: `gus-new-${run}` })).json()) as { data: { id: string } }).data.id;
    expect((await bookOf(gusBook)).organization_id).toBe(gus.personalOrgId);

    expect((await call(max, "POST", "/recipe-books", { name: "x", slug: `x-${run}`, organizationId: gus.personalOrgId })).status).toBe(403);
    // Max's emptied personal organization is no longer his to create in either.
    expect((await call(max, "POST", "/recipe-books", { name: "y", slug: `y-${run}`, organizationId: max.personalOrgId })).status).toBe(403);
    // A guest of one of Acme's books is not a member of Acme.
    expect((await call(max, "POST", `/recipe-books/${maxBook}/members`, { email: gus.email, role: "member" })).status).toBe(201);
    expect((await call(gus, "POST", "/recipe-books", { name: "z", slug: `z-${run}`, organizationId: orgId })).status).toBe(403);
  });

  it("ORG-BOOK-02, ORG-BOOK-03 / OC-B3: org-wide books reach every member; making one private keeps direct grants only", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const ada = await actor("ada");
    const max = await actor("max");
    const gus = await actor("gus");
    await mustAdd(orgId, ada, "admin");
    await mustAdd(orgId, max);

    const created = await call(max, "POST", "/recipe-books", { name: "Team", slug: `team-${run}`, orgWide: true });
    expect(created.status).toBe(201);
    const team = ((await created.json()) as { data: { id: string } }).data.id;
    expect(await membershipRow(team, max.userId)).toMatchObject({ role: "owner", via: "direct" });
    expect(await membershipRow(team, ada.userId)).toMatchObject({ role: "admin", via: "org", daily_read: false });
    expect(await membershipRow(team, olive.userId)).toMatchObject({ role: "admin", via: "org" });

    // A member who joins later gets it too.
    const late = await actor("late");
    await mustAdd(orgId, late);
    expect(await membershipRow(team, late.userId)).toMatchObject({ role: "member", via: "org" });

    // Gus, a guest invited directly, keeps his access when it goes private; the org rows go.
    expect((await call(max, "POST", `/recipe-books/${team}/members`, { email: gus.email, role: "member" })).status).toBe(201);
    expect((await call(ada, "PUT", `/recipe-books/${team}/org-wide`, { orgWide: false })).status).toBe(200);
    expect(await membershipRow(team, gus.userId)).toMatchObject({ via: "direct" });
    expect(await membershipRow(team, ada.userId)).toBeUndefined();
    expect(await membershipRow(team, max.userId)).toMatchObject({ role: "owner", via: "direct" });

    const keepDefault = await call(olive, "PUT", `/recipe-books/${defaultBookId}/org-wide`, { orgWide: false });
    expect(keepDefault.status).toBe(400);
    expect(((await keepDefault.json()) as Json)["error"]).toBe("default_book_stays_org_wide");
    const personal = await call(gus, "POST", "/recipe-books", { name: "Mine", slug: `mine-${run}`, orgWide: true });
    expect(personal.status).toBe(400);
    expect(((await personal.json()) as Json)["error"]).toBe("not_a_company_book");
    const index = (await getDb().execute(sql`
      INSERT INTO claimnet.groups (name, slug, organization_id, org_wide, org_default)
      VALUES ('Second default', ${`second-default-${run}`}, ${orgId}::uuid, true, true)
    `).then(() => "inserted", () => "refused"));
    expect(index).toBe("refused");
  });

  // ── Keys and deletion ─────────────────────────────────────────────────────

  it("ORG-KEY-01 / OC-K1: a managed account's scoped keys last at most 90 days; a personal account's up to a year", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const max = await actor("max");
    const gus = await actor("gus");
    await mustAdd(orgId, max);
    const long = await mintScoped(max, [max.personalBookId], 120);
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ error: "key_lifetime_cap", maxDays: 90 });
    expect((await mintScoped(max, [max.personalBookId], 80)).status).toBe(200);
    expect((await mintScoped(gus, [gus.personalBookId], 120)).status).toBe(200);
  });

  it("ORG-DEL-01 / OC-R4: a managed account can't delete itself", async () => {
    const olive = await actor("olive");
    const { orgId } = await createOrg(olive);
    const max = await actor("max");
    await mustAdd(orgId, max);
    const res = await call(max, "DELETE", "/auth/me", { password: PASSWORD });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "managed_account", message: "Your organization manages this account. Ask one of its admins." });
  });

  it("the deletion cascade hands a company organization on and removes the membership row", async () => {
    const olive = await actor("olive");
    const { orgId, defaultBookId } = await createOrg(olive);
    const ada = await actor("ada");
    await mustAdd(orgId, ada, "admin");

    await userDelete.deleteUserCascade(getDb(), olive.userId);
    const org = (await getDb().execute(sql`SELECT owner_id FROM claimnet.organizations WHERE id = ${orgId}::uuid`)) as unknown as Array<{ owner_id: string }>;
    expect(org[0]?.owner_id).toBe(ada.userId);
    expect(await authz.managedOrganizationOf(getDb(), ada.userId)).toMatchObject({ organizationId: orgId, role: "owner" });
    expect((await bookOf(defaultBookId)).organization_id).toBe(orgId);
    expect(await authz.managedOrganizationOf(getDb(), olive.userId)).toBeNull();

    // The last member's deletion takes the organization with it.
    await userDelete.deleteUserCascade(getDb(), ada.userId);
    const gone = (await getDb().execute(sql`SELECT 1 FROM claimnet.organizations WHERE id = ${orgId}::uuid`)) as unknown as unknown[];
    expect(gone).toHaveLength(0);
  });
});
