import { describe, it, expect, beforeAll } from "vitest";

/**
 * "A book always keeps an owner" lives in the module's removal statement, not
 * in its callers — requires running backend + postgres.
 *
 * removeMember locks the book's owner rows before it decides, so two owners
 * leaving at the same moment are serialized: the second one decides on what
 * the first one left behind. The concurrent case is made deterministic by
 * holding the first removal's transaction open and observing that the second
 * waits for it.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let authz: typeof import("./index");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const PASSWORD = "last-owner-test-pw";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor {
  email: string;
  token: string;
  userId: string;
}

describe.skipIf(!canConnect() || !BASE)("removeMember keeps the last owner", () => {
  let a: Actor;
  let b: Actor;
  let orgId = "";

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-last-owner-${label}-${uid}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
    });
    const vtok = ((await reg.json()) as { data?: { verificationToken?: string } }).data?.verificationToken;
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

  /** A fresh book owned by both `a` (its creator) and `b` (seeded directly: no route promotes). */
  async function bookWithTwoOwners(label: string): Promise<string> {
    const res = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
      body: JSON.stringify({ name: `Last Owner ${label} ${uid}`, slug: `last-owner-${label}-${uid}`, organizationId: orgId }),
    });
    const bookId = ((await res.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!bookId) throw new Error(`Failed to create book ${label}`);
    const db = getDb();
    await authz.addMember(db, bookId, b.userId, "member");
    await db.execute(sql`
      UPDATE claimnet.group_members SET role = 'owner'
      WHERE group_id = ${bookId}::uuid AND user_id = ${b.userId}::uuid
    `);
    expect(await authz.countOwners(db, bookId)).toBe(2);
    return bookId;
  }

  beforeAll(async () => {
    authz = await import("./index");
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;

    a = await registerAndVerify("a");
    b = await registerAndVerify("b");
    const res = await fetch(`${BASE}/recipe-books`, { headers: { Authorization: `Bearer ${a.token}` } });
    orgId = ((await res.json()) as { data: Array<{ organization_id: string }> }).data[0]?.organization_id ?? "";
    if (!orgId) throw new Error("Missing personal org");
  }, 60_000);

  it("sequentially: the first owner leaves, the second is refused, whatever case the id is in", async () => {
    const db = getDb();
    const bookId = await bookWithTwoOwners("seq");

    expect(await authz.removeMember(db, bookId, a.userId)).toBe("removed");
    expect(await authz.removeMember(db, bookId, b.userId)).toBe("last_owner");
    expect(await authz.removeMember(db, bookId, b.userId.toUpperCase())).toBe("last_owner");
    expect(await authz.countOwners(db, bookId)).toBe(1);
    expect(await authz.roleIn(db, b.userId, bookId)).toBe("owner");

    // A non-member, and a non-owner, are not the rule's business.
    expect(await authz.removeMember(db, bookId, a.userId)).toBe("not_a_member");
    await authz.addMember(db, bookId, a.userId, "admin");
    expect(await authz.removeMember(db, bookId, a.userId)).toBe("removed");
    expect(await authz.countOwners(db, bookId)).toBe(1);
  });

  it("concurrently: the second removal waits for the first, then is refused", async () => {
    const db = getDb();
    const bookId = await bookWithTwoOwners("lock");

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let firstDecided: () => void = () => {};
    const firstHasDecided = new Promise<void>((resolve) => { firstDecided = resolve; });

    // First owner leaves inside a transaction that stays open: its row locks
    // on the book's owner rows are held until `release()`.
    let firstResult = "";
    const first = db.transaction(async (tx) => {
      firstResult = await authz.removeMember(tx, bookId, a.userId);
      firstDecided();
      await held;
    });
    await firstHasDecided;
    expect(firstResult).toBe("removed");

    // Second owner leaves on another connection. It must not decide yet.
    let secondResult = "";
    const second = authz.removeMember(db, bookId, b.userId).then((r) => { secondResult = r; });
    await new Promise((r) => setTimeout(r, 750));
    expect(secondResult).toBe("");

    release();
    await first;
    await second;
    expect(secondResult).toBe("last_owner");
    expect(await authz.countOwners(db, bookId)).toBe(1);
  });

  it("concurrently, unheld: exactly one of two owners leaving at once succeeds", async () => {
    const db = getDb();
    const bookId = await bookWithTwoOwners("race");

    const results = await Promise.all([
      authz.removeMember(db, bookId, a.userId),
      authz.removeMember(db, bookId, b.userId),
    ]);
    expect([...results].sort()).toEqual(["last_owner", "removed"]);
    expect(await authz.countOwners(db, bookId)).toBe(1);
  });
});
