import { describe, it, expect, beforeAll } from "vitest";

/**
 * DELETE /recipe-books/:id/members/:userId — requires running backend +
 * postgres.
 *
 * A book always keeps an owner: the rule holds however the member id in the
 * path is written, and a malformed id is refused before anything runs. (The
 * rule itself, and the concurrent case, are tested at the module:
 * authz/last-owner.test.ts.)
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const PASSWORD = "recipe-book-member-removal-pw";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor {
  email: string;
  token: string;
  userId: string;
}

describe.skipIf(!canConnect() || !BASE)("recipe-book members: removing", () => {
  let owner: Actor;
  let member: Actor;
  let bookId = "";

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-member-removal-${label}-${uid}@test.local`;
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

  function call(actor: Actor, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function memberEmails(): Promise<string[]> {
    const res = await call(owner, "GET", `/recipe-books/${bookId}/members`);
    const body = (await res.json()) as { data: Array<{ email: string }> };
    return body.data.map((m) => m.email).sort();
  }

  async function ownerCount(): Promise<number> {
    const rows = await getDb().execute(sql`
      SELECT count(*)::int AS n FROM claimnet.group_members
      WHERE group_id = ${bookId}::uuid AND role = 'owner'
    `);
    return (rows as unknown as Array<{ n: number }>)[0]?.n ?? -1;
  }

  async function addPlainMember(): Promise<void> {
    const added = await call(owner, "POST", `/recipe-books/${bookId}/members`, { email: member.email });
    if (added.status !== 201) throw new Error(`Failed to add member: ${added.status}`);
  }

  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;

    owner = await registerAndVerify("owner");
    member = await registerAndVerify("member");

    const books = ((await (await call(owner, "GET", "/recipe-books")).json()) as {
      data: Array<{ organization_id: string }>;
    }).data;
    const orgId = books[0]?.organization_id ?? "";
    if (!orgId) throw new Error("Missing personal org for owner");

    const createRes = await call(owner, "POST", "/recipe-books", {
      name: `Member Removal ${uid}`,
      slug: `member-removal-${uid}`,
      organizationId: orgId,
    });
    bookId = ((await createRes.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!bookId) throw new Error("Failed to create book");

    await addPlainMember();
  }, 60_000);

  it("the last owner cannot be removed, however their id is written", async () => {
    const variants = [owner.userId, owner.userId.toUpperCase()];
    expect(variants[0]).not.toBe(variants[1]);
    for (const id of variants) {
      const res = await call(owner, "DELETE", `/recipe-books/${bookId}/members/${id}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "Cannot remove the last owner of a recipe book",
      );
      expect(await ownerCount()).toBe(1);
    }
    expect(await memberEmails()).toEqual([member.email, owner.email].sort());
  });

  it("a malformed member id or book id is 400 Invalid input, and nothing is removed", async () => {
    for (const bad of ["not-a-uuid", "123", `${owner.userId}x`]) {
      const res = await call(owner, "DELETE", `/recipe-books/${bookId}/members/${bad}`);
      expect(res.status).toBe(400);
      expect((await res.json()) as { ok: boolean; error: string }).toMatchObject({
        ok: false,
        error: "Invalid input",
      });
    }
    const badBook = await call(owner, "DELETE", `/recipe-books/not-a-uuid/members/${member.userId}`);
    expect(badBook.status).toBe(400);
    expect(await memberEmails()).toEqual([member.email, owner.email].sort());
  });

  it("a member is removed whichever case their id arrives in; removing a non-member stays a 200 no-op", async () => {
    const res = await call(owner, "DELETE", `/recipe-books/${bookId}/members/${member.userId.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(await memberEmails()).toEqual([owner.email]);

    const again = await call(owner, "DELETE", `/recipe-books/${bookId}/members/${member.userId}`);
    expect(again.status).toBe(200);
    expect(await ownerCount()).toBe(1);
  });

  it("with two owners, one may leave; the one left is then the last owner", async () => {
    // No route promotes a member to owner, so the second owner is seeded
    // directly — the same fixture shortcut book-access-gates.test.ts uses.
    await addPlainMember();
    await getDb().execute(sql`
      UPDATE claimnet.group_members SET role = 'owner'
      WHERE group_id = ${bookId}::uuid AND user_id = ${member.userId}::uuid
    `);

    expect((await call(owner, "DELETE", `/recipe-books/${bookId}/members/${owner.userId}`)).status).toBe(200);
    expect(await ownerCount()).toBe(1);
    const last = await call(member, "DELETE", `/recipe-books/${bookId}/members/${member.userId.toUpperCase()}`);
    expect(last.status).toBe(400);
    expect(await ownerCount()).toBe(1);
  });
});
