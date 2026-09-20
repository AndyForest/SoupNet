import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the DB-bound half of the authorization seam
 * (book-access.ts + memberships.ts) — requires running backend + postgres.
 *
 * Users, books, and recipes are created through the real HTTP surface (the
 * same fixture convention as services/trace-delete.service.test.ts); the
 * module's functions are then called directly against the same database, so
 * each answer is checked at the seam rather than through a route.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let authz: typeof import("./index");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const PASSWORD = "authz-seam-test-pw";
const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000000";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor {
  email: string;
  token: string;
  userId: string;
}

describe.skipIf(!canConnect() || !BASE)("authz seam (DB-bound)", () => {
  let owner: Actor;
  let member: Actor;
  let outsider: Actor;
  let ownerPersonalBookId = "";
  let bookId = "";
  let traceId = "";

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-authz-${label}-${uid}@test.local`;
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

  beforeAll(async () => {
    authz = await import("./index");
    getDb = (await import("../db")).getDb;

    owner = await registerAndVerify("owner");
    member = await registerAndVerify("member");
    outsider = await registerAndVerify("outsider");

    const booksRes = await call(owner, "GET", "/recipe-books");
    const books = ((await booksRes.json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    ownerPersonalBookId = books[0]?.id ?? "";
    const orgId = books[0]?.organization_id ?? "";
    if (!ownerPersonalBookId || !orgId) throw new Error("Missing personal book/org for owner");

    const createRes = await call(owner, "POST", "/recipe-books", {
      name: `Authz Seam ${uid}`,
      slug: `authz-seam-${uid}`,
      organizationId: orgId,
    });
    bookId = ((await createRes.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!bookId) throw new Error("Failed to create shared book");

    // Owner deposits one recipe into the shared book.
    const keyRes = await call(owner, "POST", "/keys/daily", { writeRecipeBookId: bookId });
    const rawKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!rawKey) throw new Error(`Failed to mint a daily key: ${keyRes.status}`);
    const checkRes = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: rawKey,
        trace: `As an authz-seam test author, I prefer one place for access rules so that they can be reviewed together. (${uid})`,
        ef: "Seed evidence.\n> \"one place for access rules\"\n-- this test",
        format: "json",
      }).toString(),
    });
    const checkBody = (await checkRes.json()) as { ok: boolean; data?: { checked?: { recipeId: string } } };
    traceId = checkBody.data?.checked?.recipeId ?? "";
    if (!checkBody.ok || !traceId) throw new Error(`Failed to seed trace: ${JSON.stringify(checkBody)}`);
  }, 60_000);

  // Ordered: later blocks build on the memberships earlier ones create.

  describe("before anyone is added", () => {
    it("addCreatorAsOwner (via book creation) made the creator an opted-in owner", async () => {
      const db = getDb();
      expect(await authz.roleIn(db, owner.userId, bookId)).toBe("owner");
      const mine = (await authz.booksFor(db, owner.userId)).find((b) => b.id === bookId);
      expect(mine?.member_role).toBe("owner");
      expect(mine?.daily_read).toBe(true);
      expect(mine?.daily_write).toBe(true);
      expect(await authz.countOwners(db, bookId)).toBe(1);
    });

    it("roleIn / isMember answer null / false for a non-member and for a book that does not exist", async () => {
      const db = getDb();
      expect(await authz.roleIn(db, outsider.userId, bookId)).toBeNull();
      expect(await authz.isMember(db, outsider.userId, bookId)).toBe(false);
      expect(await authz.roleIn(db, owner.userId, NONEXISTENT_ID)).toBeNull();
      expect(await authz.isMember(db, owner.userId, NONEXISTENT_ID)).toBe(false);
      expect(await authz.roleIn(db, NONEXISTENT_ID, bookId)).toBeNull();
    });

    it("bookIdsFor / booksFor list exactly the user's own memberships", async () => {
      const db = getDb();
      const ownerIds = await authz.bookIdsFor(db, owner.userId);
      expect([...ownerIds].sort()).toEqual([ownerPersonalBookId, bookId].sort());

      const outsiderIds = await authz.bookIdsFor(db, outsider.userId);
      expect(outsiderIds).not.toContain(bookId);
      expect(outsiderIds).not.toContain(ownerPersonalBookId);

      // Same set, richer rows, newest first (the shared book was created last).
      const ownerBooks = await authz.booksFor(db, owner.userId);
      expect(ownerBooks.map((b) => b.id)).toEqual([bookId, ownerPersonalBookId]);
      expect(ownerBooks[0]?.slug).toBe(`authz-seam-${uid}`);

      expect(await authz.bookIdsFor(db, NONEXISTENT_ID)).toEqual([]);
      expect(await authz.booksFor(db, NONEXISTENT_ID)).toEqual([]);
    });
  });

  describe("addMember", () => {
    it("adds with the given role and the excluded-by-default daily prefs", async () => {
      const db = getDb();
      await authz.addMember(db, bookId, member.userId, "member");

      expect(await authz.roleIn(db, member.userId, bookId)).toBe("member");
      expect(await authz.isMember(db, member.userId, bookId)).toBe(true);
      const theirs = (await authz.booksFor(db, member.userId)).find((b) => b.id === bookId);
      expect(theirs?.daily_read).toBe(false);
      expect(theirs?.daily_write).toBe(false);
    });

    it("is a no-op for an existing member — the stored role is kept", async () => {
      const db = getDb();
      await authz.addMember(db, bookId, member.userId, "admin");
      expect(await authz.roleIn(db, member.userId, bookId)).toBe("member");
      await authz.addMember(db, bookId, owner.userId, "member");
      expect(await authz.roleIn(db, owner.userId, bookId)).toBe("owner");
      expect(await authz.countOwners(db, bookId)).toBe(1);
    });

    it("listMembers returns every member with email and role, in join order", async () => {
      const members = await authz.listMembers(getDb(), bookId);
      expect(members.map((m) => [m.email, m.role])).toEqual([
        [owner.email, "owner"],
        [member.email, "member"],
      ]);
      expect(members[0]?.user_id).toBe(owner.userId);
      expect(await authz.listMembers(getDb(), NONEXISTENT_ID)).toEqual([]);
    });
  });

  describe("updateDailyPrefs", () => {
    it("updates only the fields given, only on the caller's own row", async () => {
      const db = getDb();
      expect(await authz.updateDailyPrefs(db, bookId, member.userId, { dailyRead: true }))
        .toEqual({ dailyRead: true, dailyWrite: false });
      expect(await authz.updateDailyPrefs(db, bookId, member.userId, { dailyWrite: true }))
        .toEqual({ dailyRead: true, dailyWrite: true });
      expect(await authz.updateDailyPrefs(db, bookId, member.userId, { dailyRead: false, dailyWrite: false }))
        .toEqual({ dailyRead: false, dailyWrite: false });
      // No fields → row unchanged, still returned.
      expect(await authz.updateDailyPrefs(db, bookId, member.userId, {}))
        .toEqual({ dailyRead: false, dailyWrite: false });

      const ownerRow = (await authz.booksFor(db, owner.userId)).find((b) => b.id === bookId);
      expect(ownerRow?.daily_read).toBe(true);
      expect(ownerRow?.daily_write).toBe(true);
    });

    it("returns null for a non-member and writes nothing", async () => {
      const db = getDb();
      expect(await authz.updateDailyPrefs(db, bookId, outsider.userId, { dailyRead: true })).toBeNull();
      expect(await authz.isMember(db, outsider.userId, bookId)).toBe(false);
      expect(await authz.updateDailyPrefs(db, NONEXISTENT_ID, owner.userId, { dailyRead: true })).toBeNull();
    });
  });

  describe("canReadTrace", () => {
    it("author and member can read; an outsider and a missing trace cannot", async () => {
      const db = getDb();
      expect(await authz.canReadTrace(db, traceId, owner.userId)).toBe(true);
      expect(await authz.canReadTrace(db, traceId, member.userId)).toBe(true);
      expect(await authz.canReadTrace(db, traceId, outsider.userId)).toBe(false);
      expect(await authz.canReadTrace(db, NONEXISTENT_ID, owner.userId)).toBe(false);
    });

  });

  // That the read rule exists once (mayReadTrace, applied in JS) is proved
  // without a database in trace-access.test.ts and membership-sql.test.ts.
  // Here: the one statement reports the right facts from real rows.
  describe("roleInBookOfTrace / readableTraceFor", () => {
    it("reports book, authorship and role for every viewer — including one with no access", async () => {
      const db = getDb();
      const asOwner = await authz.roleInBookOfTrace(db, owner.userId, traceId);
      expect(asOwner).toMatchObject({ traceId, bookId, authorId: owner.userId, isAuthor: true, role: "owner" });
      expect(asOwner?.claimText).toContain("authz-seam test author");

      expect(await authz.roleInBookOfTrace(db, member.userId, traceId))
        .toMatchObject({ bookId, authorId: owner.userId, isAuthor: false, role: "member" });
      // Facts, not a verdict: the outsider's row says "no standing", and move /
      // delete turn that into 403 where a missing trace is 404.
      expect(await authz.roleInBookOfTrace(db, outsider.userId, traceId))
        .toMatchObject({ bookId, isAuthor: false, role: null });

      expect(await authz.roleInBookOfTrace(db, owner.userId, NONEXISTENT_ID)).toBeNull();
      expect(await authz.roleInBookOfTrace(db, NONEXISTENT_ID, traceId))
        .toMatchObject({ isAuthor: false, role: null });
    });

    it("its role is the same fact roleIn reports for the trace's book", async () => {
      const db = getDb();
      for (const viewer of [owner, member, outsider]) {
        const facts = await authz.roleInBookOfTrace(db, viewer.userId, traceId);
        expect(facts?.role ?? null).toBe(await authz.roleIn(db, viewer.userId, bookId));
      }
    });

    it("readableTraceFor: detail row for author and member; one null for outsider and missing", async () => {
      const db = getDb();
      const forMember = await authz.readableTraceFor(db, member.userId, traceId);
      expect(forMember?.access).toMatchObject({ isAuthor: false, role: "member", bookId });
      expect(forMember?.trace).toMatchObject({
        id: traceId,
        userId: owner.userId,
        groupId: bookId,
        groupName: `Authz Seam ${uid}`,
        userEmail: owner.email,
      });
      expect((await authz.readableTraceFor(db, owner.userId, traceId))?.access.isAuthor).toBe(true);

      expect(await authz.readableTraceFor(db, outsider.userId, traceId)).toBeNull();
      expect(await authz.readableTraceFor(db, owner.userId, NONEXISTENT_ID)).toBeNull();
    });

    it("canReadTraceOfFeedback is false for a feedback id that does not exist", async () => {
      expect(await authz.canReadTraceOfFeedback(getDb(), NONEXISTENT_ID, owner.userId)).toBe(false);
    });
  });

  describe("removeMember", () => {
    it("removes the row: role, membership, book list, and trace read all close", async () => {
      const db = getDb();
      expect(await authz.removeMember(db, bookId, member.userId)).toBe("removed");

      expect(await authz.roleIn(db, member.userId, bookId)).toBeNull();
      expect(await authz.isMember(db, member.userId, bookId)).toBe(false);
      expect(await authz.bookIdsFor(db, member.userId)).not.toContain(bookId);
      expect(await authz.canReadTrace(db, traceId, member.userId)).toBe(false);
      expect((await authz.listMembers(db, bookId)).map((m) => m.email)).toEqual([owner.email]);
    });

    it("is a no-op for a non-member", async () => {
      const db = getDb();
      expect(await authz.removeMember(db, bookId, outsider.userId)).toBe("not_a_member");
      expect(await authz.countOwners(db, bookId)).toBe(1);
      expect((await authz.listMembers(db, bookId)).length).toBe(1);
    });

    it("refuses to remove the book's only owner (concurrency: last-owner.test.ts)", async () => {
      const db = getDb();
      expect(await authz.removeMember(db, bookId, owner.userId)).toBe("last_owner");
      expect(await authz.removeMember(db, bookId, owner.userId.toUpperCase())).toBe("last_owner");
      expect(await authz.countOwners(db, bookId)).toBe(1);
      expect(await authz.roleIn(db, owner.userId, bookId)).toBe("owner");
    });

    it("the author keeps read access to their own recipe after leaving the book", async () => {
      const db = getDb();
      // The module will not remove a sole owner, so the row is taken out
      // directly to make this case reachable. It is the last thing this suite
      // does to the book.
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`
        DELETE FROM claimnet.group_members
        WHERE group_id = ${bookId}::uuid AND user_id = ${owner.userId}::uuid
      `);
      expect(await authz.countOwners(db, bookId)).toBe(0);
      expect(await authz.roleIn(db, owner.userId, bookId)).toBeNull();
      expect(await authz.canReadTrace(db, traceId, owner.userId)).toBe(true);
      expect(await authz.roleInBookOfTrace(db, owner.userId, traceId))
        .toMatchObject({ isAuthor: true, role: null });
    });
  });
});
