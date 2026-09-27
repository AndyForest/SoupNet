import { describe, it, expect, beforeAll } from "vitest";

/**
 * POST /recipe-books/:id/members — requires a running backend (BACKEND_URL).
 *
 * The endpoint reports the membership that actually exists: 201 with the
 * stored role for a new member, 409 naming the role already held for an
 * existing one. It adds; it never changes an existing member's role.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const PASSWORD = "recipe-book-member-add-pw";

interface Actor {
  email: string;
  token: string;
  userId: string;
}

describe.skipIf(!BASE)("recipe-book members: adding", () => {
  let owner: Actor;
  let member: Actor;
  let bookId = "";

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-member-add-${label}-${uid}@test.local`;
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

  async function roles(): Promise<Record<string, string>> {
    const res = await call(owner, "GET", `/recipe-books/${bookId}/members`);
    const body = (await res.json()) as { data: Array<{ email: string; role: string }> };
    return Object.fromEntries(body.data.map((m) => [m.email, m.role]));
  }

  beforeAll(async () => {
    owner = await registerAndVerify("owner");
    member = await registerAndVerify("member");

    const books = ((await (await call(owner, "GET", "/recipe-books")).json()) as {
      data: Array<{ organization_id: string }>;
    }).data;
    const orgId = books[0]?.organization_id ?? "";
    if (!orgId) throw new Error("Missing personal org for owner");

    const createRes = await call(owner, "POST", "/recipe-books", {
      name: `Member Add ${uid}`,
      slug: `member-add-${uid}`,
      organizationId: orgId,
    });
    bookId = ((await createRes.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!bookId) throw new Error("Failed to create book");
  }, 60_000);

  it("a new member: 201 with the role that was stored", async () => {
    const res = await call(owner, "POST", `/recipe-books/${bookId}/members`, { email: member.email });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      data: { userId: member.userId, email: member.email, role: "member" },
    });
    expect((await roles())[member.email]).toBe("member");
  });

  it("an existing member with a different role: 409 naming the role they actually hold, row unchanged", async () => {
    const res = await call(owner, "POST", `/recipe-books/${bookId}/members`, {
      email: member.email,
      role: "admin",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Already a member of this recipe book",
      member: { userId: member.userId, email: member.email, role: "member" },
    });
    expect((await roles())[member.email]).toBe("member");
  });

  it("an existing member with the same role is the same 409 — the endpoint adds, it never updates", async () => {
    const res = await call(owner, "POST", `/recipe-books/${bookId}/members`, {
      email: member.email,
      role: "member",
    });
    expect(res.status).toBe(409);

    // The owner adding themselves does not demote them.
    const self = await call(owner, "POST", `/recipe-books/${bookId}/members`, { email: owner.email });
    expect(self.status).toBe(409);
    expect(((await self.json()) as { member: { role: string } }).member.role).toBe("owner");
    expect((await roles())[owner.email]).toBe("owner");
  });
});
