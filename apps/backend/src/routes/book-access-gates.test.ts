import { describe, it, expect, beforeAll } from "vitest";

/**
 * Characterization tests for the human (JWT-path) recipe-book access gates in
 * routes/groups.ts and routes/traces.ts — requires running backend + postgres.
 *
 * Written against the code BEFORE those gates moved into src/authz/, to pin
 * the status code each role gets from each gate, then kept green across the
 * move. They assert what the routes do today, not what they ought to do: a
 * change to any expectation here is a behavior change and needs its own
 * decision, separate from a refactor.
 *
 * Only gates that the neighbouring suites leave unpinned live here. Already
 * covered elsewhere: member-vs-owner on PUT /recipe-books/:id and POST
 * /:id/members, daily-prefs membership (groups.test.ts); map scoping and the
 * ?groupId list (traces.test.ts); feedback / reaction / star reads
 * (traces-feedback.test.ts); move gates (trace-move.test.ts); delete by
 * author / admin / plain member (trace-delete.service.test.ts).
 *
 * Cast: owner (created the book), admin, member, extra (a member who gets
 * removed), outsider (never a member).
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const PASSWORD = "book-access-gates-pw";
const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000000";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor {
  email: string;
  token: string;
  userId: string;
}

describe.skipIf(!canConnect() || !BASE)("recipe-book access gates (characterization)", () => {
  let owner: Actor;
  let admin: Actor;
  let member: Actor;
  let extra: Actor;
  let outsider: Actor;
  let bookId = "";
  let ownerTraceId = "";
  let extraTraceId = "";

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-gates-${label}-${uid}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error(`Setup failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const loginBody = (await login.json()) as { data?: { token?: string; user?: { id: string } } };
    const token = loginBody.data?.token ?? "";
    const userId = loginBody.data?.user?.id ?? "";
    if (!token || !userId) throw new Error(`Login failed for ${email}`);
    return { email, token, userId };
  }

  function call(actor: Actor, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function addMember(target: Actor, role: "member" | "admin"): Promise<void> {
    const res = await call(owner, "POST", `/recipe-books/${bookId}/members`, { email: target.email, role });
    if (res.status !== 201) throw new Error(`Failed to add ${target.email} as ${role}: ${res.status}`);
  }

  /** Deposit a recipe into the shared book as `actor` (who must be a member). */
  async function seedTrace(actor: Actor, tag: string): Promise<string> {
    const keyRes = await call(actor, "POST", "/keys/daily", { writeRecipeBookId: bookId });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    const rawKey = keyBody.data?.key ?? "";
    if (!rawKey) throw new Error(`Failed to mint a daily key for ${actor.email}: ${keyRes.status}`);
    const checkRes = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: rawKey,
        trace: `As an access-gate test author, I prefer pinned status codes so that refactors stay behavior-preserving. (${uid}-${tag})`,
        ef: "Seed evidence.\n> \"pinned status codes\"\n-- this test",
        format: "json",
      }).toString(),
    });
    const checkBody = (await checkRes.json()) as { ok: boolean; data?: { checked?: { recipeId: string } } };
    const id = checkBody.data?.checked?.recipeId;
    if (!checkBody.ok || !id) throw new Error(`Failed to seed trace: ${JSON.stringify(checkBody)}`);
    return id;
  }

  beforeAll(async () => {
    const dbMod = await import("../db");
    const drizzleMod = await import("drizzle-orm");
    getDb = dbMod.getDb;
    sql = drizzleMod.sql;

    owner = await registerAndVerify("owner");
    admin = await registerAndVerify("admin");
    member = await registerAndVerify("member");
    extra = await registerAndVerify("extra");
    outsider = await registerAndVerify("outsider");

    const booksRes = await call(owner, "GET", "/recipe-books");
    const booksBody = (await booksRes.json()) as { data: Array<{ organization_id: string }> };
    const orgId = booksBody.data[0]?.organization_id ?? "";
    if (!orgId) throw new Error("Missing personal org for owner");

    const createRes = await call(owner, "POST", "/recipe-books", {
      name: `Access Gates ${uid}`,
      slug: `access-gates-${uid}`,
      organizationId: orgId,
    });
    const createBody = (await createRes.json()) as { data?: { id: string } };
    bookId = createBody.data?.id ?? "";
    if (!bookId) throw new Error("Failed to create shared book");

    await addMember(admin, "admin");
    await addMember(member, "member");
    await addMember(extra, "member");

    ownerTraceId = await seedTrace(owner, "owner");
    extraTraceId = await seedTrace(extra, "extra");
  }, 90_000);

  // ── GET /recipe-books ─────────────────────────────────────────────────────

  it("lists a book only for its members, with the caller's own role", async () => {
    const roleOf = async (actor: Actor): Promise<string | undefined> => {
      const res = await call(actor, "GET", "/recipe-books");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string; member_role: string }> };
      return body.data.find((b) => b.id === bookId)?.member_role;
    };
    expect(await roleOf(owner)).toBe("owner");
    expect(await roleOf(admin)).toBe("admin");
    expect(await roleOf(member)).toBe("member");
    expect(await roleOf(outsider)).toBeUndefined();
  });

  // ── GET /recipe-books/:id/members ─────────────────────────────────────────

  it("member list: any member may read, an outsider gets 403", async () => {
    expect((await call(admin, "GET", `/recipe-books/${bookId}/members`)).status).toBe(200);
    expect((await call(member, "GET", `/recipe-books/${bookId}/members`)).status).toBe(200);
    expect((await call(outsider, "GET", `/recipe-books/${bookId}/members`)).status).toBe(403);
    expect((await call(owner, "GET", `/recipe-books/${NONEXISTENT_ID}/members`)).status).toBe(403);
  });

  // ── PUT /recipe-books/:id ─────────────────────────────────────────────────

  it("book details: owner-only — admin and outsider get 403, and so does a book that does not exist", async () => {
    expect((await call(admin, "PUT", `/recipe-books/${bookId}`, { name: "admin rename" })).status).toBe(403);
    expect((await call(outsider, "PUT", `/recipe-books/${bookId}`, { name: "outsider rename" })).status).toBe(403);
    expect((await call(owner, "PUT", `/recipe-books/${NONEXISTENT_ID}`, { name: "ghost" })).status).toBe(403);
  });

  // ── POST /recipe-books/:id/invite, GET + DELETE /:id/invitations ──────────

  it("invitations: owner and admin may send, list, and revoke; member and outsider get 403", async () => {
    const inviteEmail = (tag: string) => ({ email: `test-gates-invitee-${tag}-${uid}@test.local` });

    expect((await call(member, "POST", `/recipe-books/${bookId}/invite`, inviteEmail("m"))).status).toBe(403);
    expect((await call(outsider, "POST", `/recipe-books/${bookId}/invite`, inviteEmail("o"))).status).toBe(403);

    const byAdmin = await call(admin, "POST", `/recipe-books/${bookId}/invite`, inviteEmail("a"));
    expect(byAdmin.status).toBe(201);
    const inviteId = ((await byAdmin.json()) as { data: { id: string } }).data.id;

    expect((await call(admin, "GET", `/recipe-books/${bookId}/invitations`)).status).toBe(200);
    expect((await call(outsider, "GET", `/recipe-books/${bookId}/invitations`)).status).toBe(403);

    expect((await call(member, "DELETE", `/recipe-books/${bookId}/invitations/${inviteId}`)).status).toBe(403);
    expect((await call(outsider, "DELETE", `/recipe-books/${bookId}/invitations/${inviteId}`)).status).toBe(403);
    expect((await call(admin, "DELETE", `/recipe-books/${bookId}/invitations/${inviteId}`)).status).toBe(200);
    // Already closed → 404, after the role gate has passed.
    expect((await call(owner, "DELETE", `/recipe-books/${bookId}/invitations/${inviteId}`)).status).toBe(404);
  });

  // ── POST /recipe-books/:id/members ────────────────────────────────────────

  it("add member: an outsider gets 403; an admin may add", async () => {
    expect(
      (await call(outsider, "POST", `/recipe-books/${bookId}/members`, { email: outsider.email })).status,
    ).toBe(403);
    // An admin passes the gate. The member already exists, so nothing is
    // written and the answer is 409 (was a misleading 201 until the endpoint
    // was made to report the stored row — recipe-book-member-add.test.ts).
    expect(
      (await call(admin, "POST", `/recipe-books/${bookId}/members`, { email: member.email })).status,
    ).toBe(409);
    const roles = (await (await call(owner, "GET", `/recipe-books/${bookId}/members`)).json()) as {
      data: Array<{ email: string; role: string }>;
    };
    expect(roles.data.find((m) => m.email === member.email)?.role).toBe("member");
  });

  // ── PUT /recipe-books/:id/daily-prefs ─────────────────────────────────────

  it("daily prefs: every role manages its own row; a nonexistent book is 403", async () => {
    for (const actor of [owner, admin, member]) {
      const res = await call(actor, "PUT", `/recipe-books/${bookId}/daily-prefs`, { dailyRead: true });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { data: { dailyRead: boolean } }).data.dailyRead).toBe(true);
    }
    expect(
      (await call(owner, "PUT", `/recipe-books/${NONEXISTENT_ID}/daily-prefs`, { dailyRead: true })).status,
    ).toBe(403);
  });

  // ── GET /traces/:id ───────────────────────────────────────────────────────

  it("trace detail: members read it, flags follow role, an outsider gets the same 404 as a missing id", async () => {
    const detail = async (actor: Actor) => {
      const res = await call(actor, "GET", `/traces/${ownerTraceId}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: Record<string, unknown> }).data;
    };
    const asOwner = await detail(owner);
    expect(asOwner["canDelete"]).toBe(true);
    expect(asOwner["canMove"]).toBe(true);
    // The viewer's role drives the flags but is not part of the payload.
    expect("viewerGroupRole" in asOwner).toBe(false);

    const asAdmin = await detail(admin);
    expect(asAdmin["canDelete"]).toBe(true);
    expect(asAdmin["canMove"]).toBe(true);

    const asMember = await detail(member);
    expect(asMember["canDelete"]).toBe(false);
    expect(asMember["canMove"]).toBe(false);

    const asOutsider = await call(outsider, "GET", `/traces/${ownerTraceId}`);
    expect(asOutsider.status).toBe(404);
    const missing = await call(owner, "GET", `/traces/${NONEXISTENT_ID}`);
    expect(missing.status).toBe(404);
    expect(await asOutsider.json()).toEqual(await missing.json());
  });

  // ── GET /traces/map, GET /traces?groupId ──────────────────────────────────

  it("map and book list: an outsider cannot scope to the book (403), an admin can", async () => {
    expect((await call(outsider, "GET", `/traces/map?groupId=${bookId}`)).status).toBe(403);
    expect((await call(outsider, "GET", `/traces/map?groupIds=${bookId}`)).status).toBe(403);
    expect((await call(outsider, "GET", `/traces?groupId=${bookId}`)).status).toBe(403);

    const asAdmin = await call(admin, "GET", `/traces?groupId=${bookId}`);
    expect(asAdmin.status).toBe(200);
    const rows = ((await asAdmin.json()) as { data: Array<{ canDelete: boolean }> }).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.canDelete).toBe(true);
  });

  // ── PATCH + DELETE /traces/:id ────────────────────────────────────────────

  it("move and delete: status codes for an outsider and for a missing trace", async () => {
    const booksRes = await call(outsider, "GET", "/recipe-books");
    const outsiderBookId = ((await booksRes.json()) as { data: Array<{ id: string }> }).data[0]?.id ?? "";
    expect(outsiderBookId).toBeTruthy();

    expect(
      (await call(outsider, "PATCH", `/traces/${ownerTraceId}`, { groupId: outsiderBookId })).status,
    ).toBe(403);
    expect(
      (await call(owner, "PATCH", `/traces/${NONEXISTENT_ID}`, { groupId: bookId })).status,
    ).toBe(404);

    expect((await call(outsider, "DELETE", `/traces/${ownerTraceId}`, {})).status).toBe(403);
    expect((await call(owner, "DELETE", `/traces/${NONEXISTENT_ID}`, {})).status).toBe(404);

    // Nothing above removed it.
    expect((await call(owner, "GET", `/traces/${ownerTraceId}`)).status).toBe(200);
  });

  // ── DELETE /recipe-books/:id/members/:userId ──────────────────────────────
  // Kept last: these mutate the cast.

  it("remove member: owner-only", async () => {
    const path = `/recipe-books/${bookId}/members/${extra.userId}`;
    expect((await call(admin, "DELETE", path)).status).toBe(403);
    expect((await call(member, "DELETE", path)).status).toBe(403);
    expect((await call(extra, "DELETE", path)).status).toBe(403);
    expect((await call(outsider, "DELETE", path)).status).toBe(403);
    expect((await call(owner, "DELETE", path)).status).toBe(200);

    const roles = (await (await call(owner, "GET", `/recipe-books/${bookId}/members`)).json()) as {
      data: Array<{ email: string }>;
    };
    expect(roles.data.map((m) => m.email)).not.toContain(extra.email);
  });

  it("an author who has left the book still reads, and may delete, their own recipe", async () => {
    expect((await call(extra, "GET", `/recipe-books/${bookId}/members`)).status).toBe(403);
    expect((await call(extra, "GET", `/traces?groupId=${bookId}`)).status).toBe(403);

    const detail = await call(extra, "GET", `/traces/${extraTraceId}`);
    expect(detail.status).toBe(200);
    const data = ((await detail.json()) as { data: Record<string, unknown> }).data;
    expect(data["canDelete"]).toBe(true);
    expect((await call(extra, "GET", `/traces/${extraTraceId}/feedback`)).status).toBe(200);

    // The owner's recipe in the same book is no longer readable to them.
    expect((await call(extra, "GET", `/traces/${ownerTraceId}`)).status).toBe(404);
    expect((await call(extra, "GET", `/traces/${ownerTraceId}/feedback`)).status).toBe(404);

    expect((await call(extra, "DELETE", `/traces/${extraTraceId}`, {})).status).toBe(200);
  });

  it("last-owner protection: a sole owner cannot remove themselves; with a second owner they can", async () => {
    const selfPath = `/recipe-books/${bookId}/members/${owner.userId}`;
    const blocked = await call(owner, "DELETE", selfPath);
    expect(blocked.status).toBe(400);
    expect((await call(owner, "GET", `/recipe-books/${bookId}/members`)).status).toBe(200);

    // No route promotes a member to owner, so the second owner is seeded
    // directly — the same fixture shortcut trace-delete.service.test.ts uses.
    await getDb().execute(sql`
      UPDATE claimnet.group_members SET role = 'owner'
      WHERE group_id = ${bookId}::uuid AND user_id = ${admin.userId}::uuid
    `);

    expect((await call(owner, "DELETE", selfPath)).status).toBe(200);
    expect((await call(owner, "GET", `/recipe-books/${bookId}/members`)).status).toBe(403);
    // The promoted owner now holds the last-owner position.
    expect(
      (await call(admin, "DELETE", `/recipe-books/${bookId}/members/${admin.userId}`)).status,
    ).toBe(400);
  });
});
