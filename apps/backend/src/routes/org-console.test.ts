import { describe, it, expect, beforeAll } from "vitest";
import { seedVerifiedUser } from "../test-users";

/**
 * Organization accounts round 1, stream Console (rubric
 * docs/planning/org-accounts-build/console.md). Requires running backend +
 * postgres.
 *
 * Accounts, organizations, books, invitations and recipes are made through
 * the real HTTP surface. Direct SQL only gives the site operator their role
 * or reads state back.
 *
 * Cast, as in the rubric: Sys (the site operator), Olive (Acme's owner), Ada
 * (an Acme admin), Max (an Acme member), Gus (a personal account outside
 * Acme), Bea (the admin of a second organization, Beta). Every test builds
 * its own organization.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let domain: typeof import("@soupnet/domain");

const BASE = process.env["BACKEND_URL"] ?? "";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = "org-console-test-pw";
const EVIDENCE = 'The operator asked for it.\n> "an org admin console"\n-- console test fixture';
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

async function login(email: string): Promise<Response> {
  return fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

async function json(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}

describe.skipIf(!canConnect() || !BASE)("organization accounts: stream Console", () => {
  let sys: Actor;

  async function actor(label: string): Promise<Actor> {
    const email = `test-con-${label}-${run}-${++n}@test.local`;
    const res = await seedVerifiedUser(email, PASSWORD);
    const body = (await res.json()) as { data?: { token?: string; user?: { id: string } } };
    const token = body.data?.token ?? "";
    const userId = body.data?.user?.id ?? "";
    if (!token || !userId) throw new Error(`login failed for ${email}`);
    const books = ((await (await call({ jwt: token }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string }> }).data;
    return { email, jwt: token, userId, personalBookId: books[0]!.id };
  }

  async function relogin(a: Actor): Promise<Actor> {
    const body = (await (await login(a.email)).json()) as { data?: { token?: string } };
    return { ...a, jwt: body.data?.token ?? "" };
  }

  async function createOrg(owner: Actor): Promise<{ orgId: string; defaultBookId: string }> {
    const res = await call(sys, "POST", "/admin/organizations", { name: `Acme ${run} ${++n}`, slug: `acme-${run}-${n}`, ownerEmail: owner.email });
    const body = (await res.json()) as { data?: { organizationId: string; defaultRecipeBookId: string } };
    if (res.status !== 201 || !body.data) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(body)}`);
    return { orgId: body.data.organizationId, defaultBookId: body.data.defaultRecipeBookId };
  }

  async function mustAdd(orgId: string, who: Actor, role: "owner" | "admin" | "member"): Promise<void> {
    const res = await call(sys, "POST", `/admin/organizations/${orgId}/members`, { email: who.email, role });
    if (res.status !== 201) throw new Error(`addToOrg failed: ${res.status} ${await res.text()}`);
  }

  /** Acme with Olive (owner), Ada (admin), Max (member); Gus outside it. */
  async function acme() {
    const olive = await actor("olive");
    const ada = await actor("ada");
    const max = await actor("max");
    const gus = await actor("gus");
    const { orgId, defaultBookId } = await createOrg(olive);
    await mustAdd(orgId, ada, "admin");
    await mustAdd(orgId, max, "member");
    return { olive, ada, max, gus, orgId, defaultBookId };
  }

  async function book(owner: Actor, name: string, extra: Json = {}): Promise<string> {
    const res = await call(owner, "POST", "/recipe-books", { name, slug: `${name}-${run}-${++n}`, ...extra });
    const id = ((await res.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!id) throw new Error(`book ${name} failed: ${res.status}`);
    return id;
  }

  function setSharing(who: Actor, orgId: string, policy: Json): Promise<Response> {
    return call(who, "PATCH", `/organizations/${orgId}/sharing`, policy);
  }

  async function pendingInvite(who: Actor, bookId: string): Promise<string | undefined> {
    const body = (await (await call(who, "GET", "/invitations/pending")).json()) as { data: Array<{ id: string; groupId: string }> };
    return body.data.find((i) => i.groupId === bookId)?.id;
  }

  /** A scoped key that reads and writes one book, so a deposit lands there. */
  async function keyFor(a: Actor, bookId: string): Promise<string> {
    const res = await call(a, "POST", "/keys/scoped", {
      readRecipeBookIds: [bookId],
      writeRecipeBookIds: [bookId],
      defaultWriteRecipeBookId: bookId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`scoped key failed: ${res.status}`);
    return key;
  }

  async function seedRecipe(key: string, claim: string): Promise<string> {
    const form = new URLSearchParams({ key, trace: claim, ef: EVIDENCE, format: "json" });
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const body = (await res.json()) as { ok: boolean; data?: { checked?: { recipeId: string } } };
    if (!body.ok || !body.data?.checked?.recipeId) throw new Error(`seed recipe failed: ${JSON.stringify(body)}`);
    return body.data.checked.recipeId;
  }

  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    domain = await import("@soupnet/domain");
    const s = await actor("sys");
    await getDb().execute(sql`UPDATE claimnet.users SET role = 'system' WHERE id = ${s.userId}::uuid`);
    sys = await relogin(s);
  }, 60_000);

  // ── Scope and gate ────────────────────────────────────────────────────────

  it("ORG-CON-01 / CN-G1, CN-G2: only Acme's active owners and admins read Acme; everyone else gets Core's 404 byte for byte", async () => {
    const { olive, ada, max, gus, orgId } = await acme();
    const bea = await actor("bea");
    await createOrg(bea);

    const reference = await (await call(olive, "GET", `/organizations/${crypto.randomUUID()}/members`)).text();
    expect(JSON.parse(reference)).toEqual(domain.ORGANIZATION_NOT_FOUND);

    for (const path of ["", "/members", "/books", "/activity"]) {
      expect((await call(olive, "GET", `/organizations/${orgId}${path}`)).status).toBe(200);
      expect((await call(ada, "GET", `/organizations/${orgId}${path}`)).status).toBe(200);
      for (const who of [max, gus, bea, sys]) {
        const res = await call(who, "GET", `/organizations/${orgId}${path}`);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(reference);
      }
      const malformed = await call(olive, "GET", `/organizations/not-a-uuid${path}`);
      expect(malformed.status).toBe(404);
      expect(await malformed.text()).toBe(reference);
    }
    const patch = await setSharing(max, orgId, { outbound: "blocked" });
    expect(patch.status).toBe(404);
    expect(await patch.text()).toBe(reference);
  });

  // ── Members ──────────────────────────────────────────────────────────────

  it("ORG-CON-02 / CN-U1, CN-U2: the member list carries the org column set exactly, counts only Acme's published recipes, and never a book name", async () => {
    const { olive, ada, max, gus, orgId, defaultBookId } = await acme();
    const secret = `max-secret-plans-${run}`;
    await book(max, secret);
    const gusBook = await book(gus, "gus-shared");
    expect((await call(gus, "POST", `/recipe-books/${gusBook}/members`, { email: max.email, role: "member" })).status).toBe(201);

    // One recipe in Acme's default book, one in Gus's: only the first counts.
    await seedRecipe(await keyFor(max, defaultBookId), `As a member I log an org recipe ${run}`);
    await seedRecipe(await keyFor(max, gusBook), `As a member I log a recipe outside ${run}`);

    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);

    const res = await call(olive, "GET", `/organizations/${orgId}/members`);
    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain("gus-shared");
    const users = (JSON.parse(text) as { data: { users: Json[]; total: number } }).data.users;
    expect(users).toHaveLength(3);
    const expected = domain.columnKeysFor("org", "organization").sort();
    for (const row of users) expect(Object.keys(row).sort()).toEqual(expected);

    const maxRow = users.find((u) => u["id"] === max.userId)!;
    expect(maxRow).toMatchObject({ status: "disabled", orgRole: "member", joinedVia: "operator", recipeCount: 1 });
    expect(maxRow["privateBookCount"]).toBeGreaterThanOrEqual(2); // his moved personal book and the secret one
    expect(maxRow["orgWideBookCount"]).toBe(1);
    expect(users.find((u) => u["id"] === olive.userId)).toMatchObject({ status: "active", orgRole: "owner", joinedVia: "created" });
  });

  it("CN-U3: an org admin's site-only filters and sorts are ignored", async () => {
    const { olive, orgId } = await acme();
    const plain = (await json(await call(olive, "GET", `/organizations/${orgId}/members`)))["data"] as Json;
    const filtered = (await json(await call(olive, "GET", `/organizations/${orgId}/members?premium=yes&suspended=yes&role=system&sortBy=signupReason`)))["data"] as Json;
    expect(filtered["total"]).toBe(plain["total"]);
    expect(filtered["sortBy"]).toBe("joinedAt");
  });

  it("CN-G3, CN-S1: the site operator's lists keep their fields, and an organization's members come with every column", async () => {
    const { orgId } = await acme();
    const all = ((await json(await call(sys, "GET", "/admin/users?limit=5")))["data"] as { users: Json[] }).users;
    for (const key of ["id", "email", "role", "suspendedReason", "premiumAt", "activeKeyCount", "recipeCount", "groupCount", "organization"]) {
      expect(all[0]).toHaveProperty(key);
    }
    const members = ((await json(await call(sys, "GET", `/admin/organizations/${orgId}/members`)))["data"] as { users: Json[] }).users;
    expect(members).toHaveLength(3);
    expect(Object.keys(members[0]!).sort()).toEqual(domain.columnKeysFor("site", "organization").sort());
  });

  // ── Books and sharing ────────────────────────────────────────────────────

  it("ORG-CON-04 / CN-B1: books show org-wide books by name and private ones only as totals", async () => {
    const { olive, max, orgId, defaultBookId } = await acme();
    const secret = await book(max, `max-private-${run}`);
    const res = await call(olive, "GET", `/organizations/${orgId}/books`);
    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain(`max-private-${run}`);
    const data = (JSON.parse(text) as { data: { orgWideBooks: Json[]; privateBooks: number; sharing: Json } }).data;
    expect(data.orgWideBooks.map((b) => b["id"])).toEqual([defaultBookId]);
    expect(data.orgWideBooks[0]).toMatchObject({ isDefault: true, members: 3, outsideMembers: 0 });
    expect(data.privateBooks).toBeGreaterThanOrEqual(1);
    expect(data.sharing).toEqual({ outbound: "allowed", inbound: "allowed" });
  });

  it("ORG-SHARE-01 / CN-P1: owners and admins set the policy; bad values are refused", async () => {
    const { ada, orgId } = await acme();
    expect((await setSharing(ada, orgId, { outbound: "nobody" })).status).toBe(400);
    expect((await setSharing(ada, orgId, { inbound: "admins_only" })).status).toBe(400);
    expect((await setSharing(ada, orgId, {})).status).toBe(400);
    const res = await setSharing(ada, orgId, { outbound: "admins_only" });
    expect(res.status).toBe(200);
    expect(((await json(res))["data"] as Json)["sharing"]).toEqual({ outbound: "admins_only", inbound: "allowed" });
  });

  it("ORG-SHARE-02, 03 / CN-P2: outbound, one row per value × inviter role × book kind, at invitation, accept and direct add", async () => {
    const { olive, ada, max, gus, orgId, defaultBookId } = await acme();
    const maxBook = await book(max, "max-own");
    const adaBook = await book(ada, "ada-own");

    // A pending invitation sent while sharing was allowed.
    expect((await call(max, "POST", `/recipe-books/${maxBook}/invite`, { email: gus.email })).status).toBe(201);
    const pending = await pendingInvite(gus, maxBook);
    expect(pending).toBeDefined();

    const invite = (who: Actor, bookId: string) => call(who, "POST", `/recipe-books/${bookId}/invite`, { email: gus.email });
    const add = (who: Actor, bookId: string) => call(who, "POST", `/recipe-books/${bookId}/members`, { email: gus.email, role: "member" });

    // blocked: nobody, admins included, private or org-wide.
    expect((await setSharing(olive, orgId, { outbound: "blocked" })).status).toBe(200);
    for (const [who, bookId] of [[max, maxBook], [ada, adaBook], [ada, defaultBookId]] as const) {
      const res = await invite(who, bookId);
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ error: "sharing_blocked" });
      expect((await add(who, bookId)).status).toBe(403);
    }
    // The invitation sent earlier can't be accepted now, and stays pending.
    const accept = await call(gus, "POST", `/invitations/${pending}/accept`);
    expect(accept.status).toBe(403);
    expect(((await json(accept))["message"] as string)).toMatch(/^This recipe book's organization/);
    expect(await pendingInvite(gus, maxBook)).toBe(pending);

    // admins_only: Ada may, Max may not.
    expect((await setSharing(olive, orgId, { outbound: "admins_only" })).status).toBe(200);
    expect((await invite(max, maxBook)).status).toBe(403);
    expect((await add(max, maxBook)).status).toBe(403);
    expect((await invite(ada, adaBook)).status).toBe(201);
    expect((await add(ada, defaultBookId)).status).toBe(201);
    // Max's invitation, from a member, still can't be accepted.
    expect((await call(gus, "POST", `/invitations/${pending}/accept`)).status).toBe(403);

    // Inside the company is never refused: Max can be added to Ada's book.
    expect((await setSharing(olive, orgId, { outbound: "blocked" })).status).toBe(200);
    expect((await call(ada, "POST", `/recipe-books/${adaBook}/members`, { email: max.email, role: "member" })).status).toBe(201);
  });

  it("ORG-SHARE-04 / CN-P3: inbound refuses Max at accept, and Gus learns nothing about Max's organization", async () => {
    const { olive, max, gus, orgId } = await acme();
    const gusOpen = await book(gus, "gus-open");
    const gusClosed = await book(gus, "gus-closed");

    const before = await call(gus, "POST", `/recipe-books/${gusOpen}/invite`, { email: max.email });
    expect((await setSharing(olive, orgId, { inbound: "blocked" })).status).toBe(200);
    const after = await call(gus, "POST", `/recipe-books/${gusClosed}/invite`, { email: max.email });
    expect(after.status).toBe(before.status);
    expect(Object.keys((await json(after))["data"] as Json).sort()).toEqual(Object.keys((await json(before))["data"] as Json).sort());

    const id = await pendingInvite(max, gusClosed);
    const accept = await call(max, "POST", `/invitations/${id}/accept`);
    expect(accept.status).toBe(403);
    expect((await json(accept))["message"]).toBe(domain.sharingRefusalMessage("inbound_blocked", "joiner"));

    // A direct add answers exactly as for an email with no account.
    const direct = await call(gus, "POST", `/recipe-books/${gusClosed}/members`, { email: max.email, role: "member" });
    const nobody = await call(gus, "POST", `/recipe-books/${gusClosed}/members`, { email: `nobody-${run}@test.local`, role: "member" });
    expect(direct.status).toBe(404);
    expect(await direct.text()).toBe(await nobody.text());
  });

  it("ORG-SHARE-05 / CN-P4: re-filing a recipe out of Acme follows outbound", async () => {
    const { olive, ada, max, gus, orgId } = await acme();
    const maxBook = await book(max, "max-notes");
    const gusBook = await book(gus, "gus-notes");
    expect((await call(gus, "POST", `/recipe-books/${gusBook}/members`, { email: max.email, role: "member" })).status).toBe(201);
    expect((await call(gus, "POST", `/recipe-books/${gusBook}/members`, { email: ada.email, role: "member" })).status).toBe(201);
    const recipe = await seedRecipe(await keyFor(max, maxBook), `As a member I keep a note ${run}`);

    expect((await setSharing(olive, orgId, { outbound: "admins_only" })).status).toBe(200);
    const res = await call(max, "PATCH", `/traces/${recipe}`, { groupId: gusBook });
    expect(res.status).toBe(403);
    expect((await json(res))["message"]).toBe(domain.sharingRefusalMessage("outbound_admins_only", "mover"));

    expect((await setSharing(olive, orgId, { outbound: "allowed" })).status).toBe(200);
    expect((await call(max, "PATCH", `/traces/${recipe}`, { groupId: gusBook })).status).toBe(200);
  });

  it("ORG-SHARE-06 / CN-P5: tightening removes nothing, and the Books page counts the outsiders", async () => {
    const { olive, ada, max, gus, orgId, defaultBookId } = await acme();
    const maxBook = await book(max, "max-shared");
    expect((await call(max, "POST", `/recipe-books/${maxBook}/members`, { email: gus.email, role: "member" })).status).toBe(201);
    expect((await call(ada, "POST", `/recipe-books/${defaultBookId}/members`, { email: gus.email, role: "member" })).status).toBe(201);

    expect((await setSharing(olive, orgId, { outbound: "blocked", inbound: "blocked" })).status).toBe(200);
    const members = (await json(await call(max, "GET", `/recipe-books/${maxBook}/members`)))["data"] as Json[];
    expect(members.some((m) => m["email"] === gus.email)).toBe(true);

    const data = (await json(await call(olive, "GET", `/organizations/${orgId}/books`)))["data"] as { orgWideBooks: Json[]; outsidePeopleInPrivateBooks: number };
    expect(data.orgWideBooks.find((b) => b["id"] === defaultBookId)).toMatchObject({ outsideMembers: 1 });
    expect(data.outsidePeopleInPrivateBooks).toBe(1);
  });

  // ── Activity and the member's own page ───────────────────────────────────

  it("ORG-CON-05 / CN-L1: activity lists admin actions only, the operator as Soup.net, and never metadata", async () => {
    const { olive, ada, max, orgId, defaultBookId } = await acme();
    await seedRecipe(await keyFor(max, defaultBookId), `As a member I check a recipe ${run}`);
    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);
    expect((await call(olive, "PATCH", `/organizations/${orgId}/members/${ada.userId}`, { role: "member" })).status).toBe(200);

    const res = await call(olive, "GET", `/organizations/${orgId}/activity`);
    const text = await res.text();
    expect(text).not.toContain(sys.email);
    expect(text).not.toContain("previousSlug");
    expect(text).not.toContain("movedBooks");
    expect(text).not.toContain('"personal');
    const events = ((JSON.parse(text) as { data: { events: Json[] } }).data.events);
    expect(events.every((e) => ["joined", "disabled", "enabled", "role_changed", "sharing_changed"].includes(e["kind"] as string))).toBe(true);
    expect(events.find((e) => e["kind"] === "joined" && e["target"] === max.email)).toMatchObject({ actor: domain.SOUPNET_ACTOR_LABEL });
    expect(events.find((e) => e["kind"] === "disabled")).toMatchObject({ actor: ada.email, target: max.email });
    expect(events.find((e) => e["kind"] === "role_changed")).toMatchObject({ actor: olive.email, target: ada.email, role: "member" });
    for (const e of events) expect(Object.keys(e).sort()).toEqual(e["kind"] === "role_changed" ? ["actor", "at", "kind", "role", "target"] : ["actor", "at", "kind", "target"]);
  });

  it("ORG-CON-06, 07 / CN-L2, CN-T2: the member sees their organization, the admin actions on them and their own sign-ins; admins never see sign-ins", async () => {
    const { olive, ada, max, gus, orgId } = await acme();
    expect((await login(max.email)).status).toBe(200);
    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);
    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/enable`)).status).toBe(200);
    const fresh = await relogin(max);

    const data = (await json(await call(fresh, "GET", "/me/organization")))["data"] as {
      organization: Json; adminActions: Json[]; signIns: Json[];
    };
    expect(data.organization).toMatchObject({ id: orgId, role: "member", sharing: { outbound: "allowed", inbound: "allowed" } });
    expect(data.adminActions.map((a) => a["kind"])).toEqual(expect.arrayContaining(["joined", "disabled", "enabled"]));
    expect(data.signIns.length).toBeGreaterThanOrEqual(2);
    for (const s of data.signIns) expect(Object.keys(s).sort()).toEqual(["at", "method"]);
    expect(data.signIns[0]).toMatchObject({ method: "password" });

    const personal = (await json(await call(gus, "GET", "/me/organization")))["data"] as Json;
    expect(personal["organization"]).toBeNull();

    for (const path of ["/members", "/activity"]) {
      const text = await (await call(olive, "GET", `/organizations/${orgId}${path}`)).text();
      expect(text).not.toContain("signed_in");
      expect(text).not.toContain('"method"');
    }
  });

  /** A directory connection row on a domain: the credential is never read here. */
  async function connectDirectory(orgId: string, domainName: string, connectedAt = sql`NOW()`): Promise<void> {
    await getDb().execute(sql`
      INSERT INTO claimnet.organization_directory_connections
        (organization_id, kind, domain, domain_unicode, admin_email, credential_ciphertext, credential_iv, credential_tag, key_version, connected_at)
      VALUES (${orgId}::uuid, 'admin_consent', ${domainName}, ${domainName}, ${`admin@${domainName}`}, 'x', 'x', 'x', 1, ${connectedAt})
    `);
  }

  it("CN-U5, CN-U6: a member the directory switched off has their own label, the filter finds them, and last checked is empty without a connection", async () => {
    const { olive, ada, max, orgId } = await acme();
    const statusOf = async (who: Actor): Promise<Json> => {
      const body = (await json(await call(olive, "GET", `/organizations/${orgId}/members`)))["data"] as { users: Json[] };
      return body.users.find((u) => u["id"] === who.userId)!;
    };
    // A recorded status with no connection refuses nobody, so it reads active.
    await getDb().execute(sql`UPDATE claimnet.organization_members SET directory_status = 'suspended', directory_checked_at = NOW() WHERE user_id = ${max.userId}::uuid`);
    expect(await statusOf(max)).toMatchObject({ status: "active" });
    expect(await statusOf(ada)).toMatchObject({ status: "active", directoryCheckedAt: null });

    const domainName = `con-${run}-${++n}.example`;
    await connectDirectory(orgId, domainName);
    for (const [recorded, listed] of [["suspended", "directory_suspended"], ["archived", "directory_archived"], ["deleted", "directory_deleted"]] as const) {
      await getDb().execute(sql`UPDATE claimnet.organization_members SET directory_status = ${recorded} WHERE user_id = ${max.userId}::uuid`);
      expect((await statusOf(max))["status"]).toBe(listed);
      expect(domain.ADMIN_USER_STATUS_LABELS[listed]).not.toBe(domain.ADMIN_USER_STATUS_LABELS.disabled);
    }
    expect((await statusOf(max))["directoryCheckedAt"]).toBeTruthy();

    const ids = async (status: string): Promise<unknown[]> =>
      ((await json(await call(olive, "GET", `/organizations/${orgId}/members?status=${status}`)))["data"] as { users: Json[] }).users.map((u) => u["id"]);
    expect(await ids("directory")).toEqual([max.userId]);
    expect(await ids("active")).not.toContain(max.userId);
    expect(await ids("disabled")).not.toContain(max.userId);

    // An admin's disable wins over the directory's reason, and reads as theirs.
    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/disable`)).status).toBe(200);
    expect((await statusOf(max))["status"]).toBe("disabled");
    expect(await ids("directory")).toEqual([]);

    // The site operator's every-account list names the same reason.
    expect((await call(ada, "POST", `/organizations/${orgId}/members/${max.userId}/enable`)).status).toBe(200);
    const site = (await json(await call(sys, "GET", `/admin/users?q=${encodeURIComponent(max.email)}`)))["data"] as { users: Json[] };
    expect(site.users.find((u) => u["id"] === max.userId)).toMatchObject({ status: "directory_deleted" });
  });

  it("CN-U6: a check that hasn't succeeded for a day reads as a failed directory check", async () => {
    const { olive, max, orgId } = await acme();
    const domainName = `con-${run}-${++n}.example`;
    expect((await call(olive, "POST", `/organizations/${orgId}/domains`, { domain: domainName })).status).toBe(201);
    await getDb().execute(sql`UPDATE claimnet.organization_domains SET verified_at = NOW(), last_checked_at = NOW() WHERE organization_id = ${orgId}::uuid`);
    await getDb().execute(sql`UPDATE claimnet.users SET email = ${`max@${domainName}`} WHERE id = ${max.userId}::uuid`);
    await connectDirectory(orgId, domainName, sql`NOW() - interval '25 hours'`);
    const body = (await json(await call(olive, "GET", `/organizations/${orgId}/members`)))["data"] as { users: Json[] };
    expect(body.users.find((u) => u["id"] === max.userId)).toMatchObject({ status: "directory_unconfirmed" });
  });

  it("CN-U6: Activity shows directory events with only their checked details, and a member sees only their own status", async () => {
    const { olive, max, orgId } = await acme();
    const audit = (action: string, targetType: string, targetId: string, actor: string | null, metadata: Json) => getDb().execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (${actor}::uuid, ${action}, ${targetType}, ${targetId}::uuid, ${JSON.stringify(metadata)}::jsonb)
    `);
    await audit("organization.member_directory_status", "user", max.userId, null, { organizationId: orgId, from: "from-marker", to: "active" });
    await audit("organization.directory_connected", "organization", orgId, olive.userId, { kind: "admin_consent", domain: "acme.example", by: "by-marker", cleared: { suspended: 2, archived: 0, deleted: 1 } });
    await audit("organization.directory_connect_failed", "organization", orgId, olive.userId, { kind: "admin_consent", domain: "acme.example", reason: "directory_not_admin" });
    await audit("organization.directory_connect_failed", "organization", orgId, olive.userId, { kind: "service_account", domain: "acme.example", reason: "google-said-marker" });
    await audit("organization.directory_disconnected", "organization", orgId, olive.userId, { by: "by-marker", cleared: { suspended: 1, archived: 0, deleted: 0 } });
    await audit("organization.directory_deletions_noticed", "organization", orgId, null, { count: 4, note: "note-marker" });

    const text = await (await call(olive, "GET", `/organizations/${orgId}/activity`)).text();
    for (const marker of ["from-marker", "by-marker", "google-said-marker", "note-marker", '"from"', '"by"', '"reason"']) expect(text).not.toContain(marker);
    const events = (JSON.parse(text) as { data: { events: Json[] } }).data.events;
    expect(events.find((e) => e["kind"] === "directory_status")).toMatchObject({ actor: domain.DIRECTORY_ACTOR_LABEL, target: max.email, directoryStatus: "active" });
    expect(events.find((e) => e["kind"] === "directory_connected")).toMatchObject({ actor: olive.email, connectionKind: "admin_consent", domain: "acme.example", cleared: { suspended: 2, archived: 0, deleted: 1 } });
    const failed = events.filter((e) => e["kind"] === "directory_connect_failed");
    expect(failed.find((e) => e["connectionKind"] === "admin_consent")).toMatchObject({ connectFailure: "directory_not_admin" });
    expect(failed.find((e) => e["connectionKind"] === "service_account")).not.toHaveProperty("connectFailure");
    expect(events.find((e) => e["kind"] === "directory_disconnected")).toMatchObject({ cleared: { suspended: 1, archived: 0, deleted: 0 } });
    expect(events.find((e) => e["kind"] === "directory_deletions_noticed")).toMatchObject({ actor: domain.SOUPNET_ACTOR_LABEL, removedCount: 4 });

    const mine = (await json(await call(max, "GET", "/me/organization")))["data"] as { adminActions: Json[] };
    const kinds = mine.adminActions.map((a) => a["kind"]);
    expect(kinds).toContain("directory_status");
    for (const hidden of ["directory_connected", "directory_connect_failed", "directory_disconnected", "directory_deletions_noticed"]) expect(kinds).not.toContain(hidden);
  });
});
