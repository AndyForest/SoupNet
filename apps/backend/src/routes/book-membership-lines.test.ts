import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { seedVerifiedUser } from "../test-users";

/**
 * Membership an agent can act on (drafts-and-triage slice 8b item 3), Layer 3
 * against a running backend (BACKEND_URL). Rubric rows S8b3-* in
 * docs/planning/drafts-and-triage-build.md.
 *
 * Every book in the corpus-context block carries a Members line, a solo book
 * included ("Members (1): you"), with the caller first as "you"; a book the
 * caller owns or administers carries "Pending invites (n)", 0 included,
 * counting the invitations the web's pending list shows.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const run = Date.now();
const PASSWORD = "book-membership-lines-pw";
const ACCEPT_BOTH = "application/json, text/event-stream";

interface Actor {
  email: string;
  jwt: string;
  userId: string;
  personalBookId: string;
  orgId: string;
}

describe.skipIf(!BASE)("book membership lines (slice 8b item 3)", () => {
  let sql: ReturnType<typeof postgres>;
  let olga: Actor; // owner of the shared book
  let ada: Actor; // admin of it
  let mo: Actor; // plain member
  let ivy: Actor; // accepts an invitation mid-test
  let dee: Actor; // declines one
  let twin: Actor; // shares Olga's display name
  let shared = { id: "", slug: "" };
  let olgaKey = "";
  let olgaSharedOnlyKey = "";
  let adaKey = "";
  let moKey = "";
  let twinKey = "";
  let ivyInvite = "";
  const inviteIds: Record<string, string> = {};

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function register(label: string): Promise<Actor> {
    const email = `test-bml-${label}-${run}@test.local`;
    const login = await seedVerifiedUser(email, PASSWORD);
    const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data?: Array<{ id: string; organization_id: string }> }).data ?? [];
    const actor = { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
    if (!actor.jwt || !actor.userId || !actor.personalBookId) throw new Error(`setup failed for ${email}`);
    return actor;
  }
  async function mintKey(actor: Actor, books: string[]): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: books, writeRecipeBookIds: books, defaultWriteRecipeBookId: books[0],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }
  async function invite(bookId: string, email: string): Promise<string> {
    const res = await call(olga, "POST", `/recipe-books/${bookId}/invite`, { email });
    const id = ((await res.json()) as { data?: { id?: string } }).data?.id ?? "";
    if (!id) throw new Error(`invite failed: ${res.status}`);
    return id;
  }
  async function mcpText(key: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { content?: Array<{ text?: string }> } };
    return msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  }
  const listBooks = (key: string) => mcpText(key, "list_my_recipe_books");
  /** The recipe-books block: from the first book bullet through the default line. */
  function booksBlock(text: string): string {
    const start = text.indexOf("\n  - ");
    const end = text.indexOf("\nDefault write recipe book:");
    if (start < 0 || end < 0) throw new Error(`no recipe-books block in: ${text.slice(0, 300)}`);
    return text.slice(start + 1, end);
  }
  /** The sub-lines under one book's bullet. */
  function bookLines(text: string, slug: string): string[] {
    const lines = booksBlock(text).split("\n");
    const at = lines.findIndex((l) => l.startsWith(`  - ${slug} (`));
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (l.startsWith("  - ")) break;
      out.push(l);
    }
    return out;
  }
  const membersLine = (text: string, slug: string) => bookLines(text, slug).find((l) => l.startsWith("    Members ("));
  const pendingLine = (text: string, slug: string) => bookLines(text, slug).find((l) => l.startsWith("    Pending invites ("));
  async function personalSlug(actor: Actor): Promise<string> {
    const rows = await sql`SELECT slug FROM claimnet.groups WHERE id = ${actor.personalBookId}::uuid`;
    return String(rows[0]?.["slug"] ?? "");
  }

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [olga, ada, mo, ivy, dee, twin] = await Promise.all([
      register("olga"), register("ada"), register("mo"), register("ivy"), register("dee"), register("twin"),
    ]);
    await sql`UPDATE claimnet.users SET display_name = ${`Olga ${run}`} WHERE id IN (${olga.userId}::uuid, ${twin.userId}::uuid)`;

    const slug = `bml-${run}`;
    const created = await call(olga, "POST", "/recipe-books", { name: `Membership lines ${run}`, slug, organizationId: olga.orgId });
    shared = { id: ((await created.json()) as { data?: { id: string } }).data?.id ?? "", slug };
    if (!shared.id) throw new Error("book create failed");
    for (const [m, role] of [[ada, "admin"], [mo, "member"], [twin, "member"]] as const) {
      const r = await call(olga, "POST", `/recipe-books/${shared.id}/members`, { email: m.email, role });
      if (r.status !== 201) throw new Error(`add member failed: ${r.status}`);
    }

    // The pending list's cases: one live, one re-sent (the earlier copy is
    // expired by the re-send), one accepted, one declined, one revoked, one
    // lapsed. The web's list holds the live and the re-sent: 2.
    inviteIds["live"] = await invite(shared.id, `live-${run}@test.local`);
    await invite(shared.id, `again-${run}@test.local`);
    inviteIds["again"] = await invite(shared.id, `again-${run}@test.local`);
    ivyInvite = await invite(shared.id, ivy.email);
    inviteIds["dee"] = await invite(shared.id, dee.email);
    inviteIds["gone"] = await invite(shared.id, `gone-${run}@test.local`);
    inviteIds["late"] = await invite(shared.id, `late-${run}@test.local`);
    expect((await call(dee, "POST", `/invitations/${inviteIds["dee"]}/decline`)).status).toBe(200);
    expect((await call(olga, "DELETE", `/recipe-books/${shared.id}/invitations/${inviteIds["gone"]}`)).status).toBe(200);
    await sql`UPDATE claimnet.invitations SET expires_at = NOW() - interval '1 hour' WHERE id = ${inviteIds["late"]}::uuid`;
    // One to Olga's personal book, which must never count toward the shared one.
    await invite(olga.personalBookId, `personal-${run}@test.local`);

    [olgaKey, olgaSharedOnlyKey, adaKey, moKey, twinKey] = await Promise.all([
      mintKey(olga, [olga.personalBookId, shared.id]),
      mintKey(olga, [shared.id]),
      mintKey(ada, [shared.id]),
      mintKey(mo, [shared.id]),
      mintKey(twin, [shared.id]),
    ]);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("S8b3-M1: a solo book says Members (1): you", async () => {
    const text = await listBooks(olgaKey);
    expect(membersLine(text, await personalSlug(olga))).toBe("    Members (1): you");
  });

  it("S8b3-M1/M2: the shared book counts everyone, the caller first as you, a same-named colleague by email", async () => {
    const olgaView = membersLine(await listBooks(olgaKey), shared.slug);
    const twinView = membersLine(await listBooks(twinKey), shared.slug);
    expect(olgaView).toMatch(/^ {4}Members \(4\): you, /);
    expect(twinView).toMatch(/^ {4}Members \(4\): you, /);
    expect(olgaView).toContain(`Olga ${run} <${twin.email}>`);
    expect(olgaView).not.toContain(`<${olga.email}>`);
    expect(twinView).toContain(`Olga ${run} <${olga.email}>`);
    expect(twinView).not.toContain(`<${twin.email}>`);
  });

  it("S8b3-P1/P2: the owner and the admin see the count the web's pending list holds; the member sees no line", async () => {
    const web = (await (await call(olga, "GET", `/recipe-books/${shared.id}/invitations`)).json()) as { data: Array<{ id: string }> };
    const listed = web.data.map((r) => r.id).sort();
    expect(listed).toEqual([inviteIds["live"], inviteIds["again"], ivyInvite].sort());
    expect(pendingLine(await listBooks(olgaKey), shared.slug)).toBe(`    Pending invites (${listed.length})`);
    expect(pendingLine(await listBooks(adaKey), shared.slug)).toBe(`    Pending invites (${listed.length})`);
    const moText = await listBooks(moKey);
    expect(membersLine(moText, shared.slug)).toBeDefined();
    expect(pendingLine(moText, shared.slug)).toBeUndefined();
  });

  it("S8b3-P3: another book's invitations never count, and the personal book shows its own", async () => {
    const text = await listBooks(olgaKey);
    expect(pendingLine(text, await personalSlug(olga))).toBe("    Pending invites (1)");
  });

  it("S8b3-S2: a key scoped to one book shows nothing of the owner's other books", async () => {
    const text = await listBooks(olgaSharedOnlyKey);
    const personal = await personalSlug(olga);
    expect(bookLines(text, personal)).toEqual([]);
    expect(booksBlock(text)).not.toContain(personal);
    expect(membersLine(text, shared.slug)).toMatch(/^ {4}Members \(4\): you, /);
  });

  it("S8b3-S1: list_my_recipe_books, get_briefing and GET /briefing print the same recipe-books block", async () => {
    const listed = booksBlock(await listBooks(olgaKey));
    const briefed = booksBlock(await mcpText(olgaKey, "get_briefing"));
    const rest = (await (await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${olgaKey}` } })).json()) as { data?: { text?: string } };
    expect(briefed).toBe(listed);
    expect(booksBlock(rest.data?.text ?? "")).toBe(listed);
    expect(listed).toContain("    Pending invites (");
  });

  it("S8b3-S4: listing writes nothing", async () => {
    const count = async () => Number((await sql`SELECT COUNT(*)::int AS n FROM claimnet.audit_log WHERE actor_user_id = ${olga.userId}::uuid`)[0]?.["n"] ?? -1);
    const before = await count();
    await listBooks(olgaKey);
    expect(await count()).toBe(before);
  });

  it("S8b3-M3: an accepted invitation moves from the count to the roster on the next call", async () => {
    const before = await listBooks(olgaKey);
    expect(membersLine(before, shared.slug)).not.toContain(ivy.email);
    expect((await call(ivy, "POST", `/invitations/${ivyInvite}/accept`)).status).toBe(200);
    const after = await listBooks(olgaKey);
    expect(membersLine(after, shared.slug)).toMatch(/^ {4}Members \(5\): you, /);
    expect(membersLine(after, shared.slug)).toContain(ivy.email);
    expect(pendingLine(after, shared.slug)).toBe("    Pending invites (2)");
  });

  it("S8b3-P4: the role is read at call time: a demoted admin loses the count, a promoted member gains it", async () => {
    await sql`UPDATE claimnet.group_members SET role = 'member' WHERE group_id = ${shared.id}::uuid AND user_id = ${ada.userId}::uuid`;
    await sql`UPDATE claimnet.group_members SET role = 'admin' WHERE group_id = ${shared.id}::uuid AND user_id = ${mo.userId}::uuid`;
    expect(pendingLine(await listBooks(adaKey), shared.slug)).toBeUndefined();
    expect(pendingLine(await listBooks(moKey), shared.slug)).toBe("    Pending invites (2)");
  });
});
