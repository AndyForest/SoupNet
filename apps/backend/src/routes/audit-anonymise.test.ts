import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { seedVerifiedUser } from "../test-users";
import { CHECK_LOG_ACTIONS, ACCOUNT_EVENT_ACTIONS, RECIPE_TEXT_ACTIONS, BOOK_TEXT_ACTIONS } from "../services/audit-actions";

/**
 * Account deletion anonymises the person's check-log rows rather than
 * deleting them (recipe 1d1531da, keeping the September design 569fc2cc), and
 * removes their recipe text from the account events that carry it (F116).
 * Layer 3 against a running backend (BACKEND_URL); rubric rows R-A1 to R-A6
 * and R-C2 in docs/planning/openai-plugin-build/audit-log-retention.md.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const run = Date.now();
const PASSWORD = "audit-anonymise-pw";
type Row = { id: string; actor_user_id: string | null; api_key_id: string | null; action: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown> | null; occurred_at: Date };

const isRecipeText = (action: string) => (RECIPE_TEXT_ACTIONS as readonly string[]).includes(action);
const isText = (action: string) => isRecipeText(action) || (BOOK_TEXT_ACTIONS as readonly string[]).includes(action);
const TEXT_KEYS = ["claimText", "previousDescription", "newDescription", "previousName", "newName", "groupName"];

describe.skipIf(!BASE)("account deletion anonymises the check log (R-A1 to R-A6)", () => {
  let sql: ReturnType<typeof postgres>;
  interface Actor { email: string; jwt: string; userId: string; personal: string; org: string }
  let pat: Actor; // deletes the account
  let bo: Actor; // a colleague who stays
  let shared = { id: "", slug: "" };
  let patKey = "";
  let boKey = "";
  const before = new Map<string, Row>();
  let patCheckLogIds: string[] = [];
  let patEventIds: string[] = [];
  let boIds: string[] = [];
  let onBehalfRowId = "";
  let patTextIds: string[] = []; // Pat deleting a recipe of Pat's, and changing a book's description and name
  let boMovedPatsId = ""; // Bo moving a recipe of Pat's
  let boDeletedOwnId = ""; // Bo deleting a recipe of Bo's: keeps its text

  function call(jwt: string, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function register(label: string): Promise<Actor> {
    const email = `test-anon-${label}-${run}@test.local`;
    const jwt = ((await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string } }).data?.token ?? "";
    const me = (await (await call(jwt, "GET", "/auth/me")).json()) as { data?: { user?: { id: string } } };
    const books = ((await (await call(jwt, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId: me.data?.user?.id ?? "", personal: books[0]?.id ?? "", org: books[0]?.organization_id ?? "" };
  }
  async function mintKey(a: Actor, books: string[]): Promise<string> {
    const res = await call(a.jwt, "POST", "/keys/scoped", { readRecipeBookIds: books, writeRecipeBookIds: books, defaultWriteRecipeBookId: books[0], expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return ((await res.json()) as { data: { key: string } }).data.key;
  }
  async function tool(key: string, name: string, args: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    return res.text();
  }
  const evidence = (q: string) => `Why.\n> "${q}"\n-- anonymise test ${run}`;
  async function rows(ids: string[]): Promise<Row[]> {
    return ids.length ? ((await sql`SELECT id, actor_user_id, api_key_id, action, target_type, target_id, metadata, occurred_at FROM claimnet.audit_log WHERE id IN ${sql(ids)} ORDER BY id`) as unknown as Row[]) : [];
  }
  async function counts(ids: string[]) {
    return sql`
      SELECT action, date_trunc('month', occurred_at) AS month, metadata->>'intentId' AS intent, COUNT(*)::int AS n
      FROM claimnet.audit_log WHERE id IN ${sql(ids)}
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
    `;
  }

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [pat, bo] = await Promise.all([register("pat"), register("bo")]);
    const created = await call(bo.jwt, "POST", "/recipe-books", { name: `Anonymise ${run}`, slug: `anon-${run}`, organizationId: bo.org });
    shared = { id: ((await created.json()) as { data: { id: string } }).data.id, slug: `anon-${run}` };
    expect((await call(bo.jwt, "POST", `/recipe-books/${shared.id}/members`, { email: pat.email, role: "member" })).status).toBe(201);
    [patKey, boKey] = await Promise.all([mintKey(pat, [pat.personal, shared.id]), mintKey(bo, [shared.id])]);

    // Pat's check log: a check under an intent, a search with free text, a briefing.
    await tool(patKey, "check_recipe", { recipe: `As a person leaving a service, I prefer my checks counted but not named ${run}.`, supporting_evidence: evidence("counted"), recipe_book: shared.slug, intent: `As a tester, I want an intent to group checks ${run}.` });
    await tool(patKey, "search_recipes", { query: `my private search words ${run}` });
    await tool(patKey, "get_briefing", {});
    // Book-text account events: Pat changes the description and the name of
    // Pat's book; Bo changes the shared book's description, which keeps its text.
    expect((await call(pat.jwt, "PUT", `/recipe-books/${pat.personal}`, { description: `Pat's book ${run}` })).status).toBe(200);
    expect((await call(pat.jwt, "PUT", `/recipe-books/${pat.personal}`, { name: `Pat's renamed book ${run}` })).status).toBe(200);
    expect((await call(bo.jwt, "PUT", `/recipe-books/${shared.id}`, { description: `Bo's shared book ${run}` })).status).toBe(200);
    // Bo's own check, and a deposit about Pat on Pat's behalf.
    await tool(boKey, "check_recipe", { recipe: `As a colleague staying on, I prefer my rows untouched by others leaving ${run}.`, supporting_evidence: evidence("untouched"), recipe_book: shared.slug });
    await tool(boKey, "check_recipe", { recipe: `As a person leaving a service, I prefer a deposit about me to stay recorded without my name ${run}.`, supporting_evidence: evidence("about Pat"), recipe_book: shared.slug, on_behalf_of: pat.email });

    // Recipe-text account events (F116): Pat deletes a recipe of Pat's, Bo
    // moves another of Pat's out of the shared book, and Bo deletes one of Bo's.
    const texts = {
      patDeletes: `As a person leaving a service, I prefer this deleted recipe's words gone with me ${run}.`,
      boMoves: `As a person leaving a service, I prefer this moved recipe's words gone with me ${run}.`,
      boOwn: `As a colleague staying on, I prefer my own deleted recipe's record kept ${run}.`,
    };
    await tool(patKey, "check_recipe", { recipe: texts.patDeletes, supporting_evidence: evidence("deleted"), recipe_book: shared.slug });
    await tool(patKey, "check_recipe", { recipe: texts.boMoves, supporting_evidence: evidence("moved"), recipe_book: shared.slug });
    await tool(boKey, "check_recipe", { recipe: texts.boOwn, supporting_evidence: evidence("kept"), recipe_book: shared.slug });
    const traceId = async (text: string) => ((await sql`SELECT id FROM claimnet.traces WHERE claim_text = ${text}`) as unknown as Array<{ id: string }>)[0]?.id ?? "";
    const [patDeletes, boMoves, boOwn] = await Promise.all([traceId(texts.patDeletes), traceId(texts.boMoves), traceId(texts.boOwn)]);
    expect((await call(pat.jwt, "DELETE", `/traces/${patDeletes}`)).status).toBe(200);
    expect((await call(bo.jwt, "PATCH", `/traces/${boMoves}`, { groupId: bo.personal })).status).toBe(200);
    expect((await call(bo.jwt, "DELETE", `/traces/${boOwn}`)).status).toBe(200);

    const patRows = (await sql`SELECT id, action FROM claimnet.audit_log WHERE actor_user_id = ${pat.userId}::uuid`) as unknown as Array<{ id: string; action: string }>;
    patCheckLogIds = patRows.filter((r) => (CHECK_LOG_ACTIONS as readonly string[]).includes(r.action)).map((r) => r.id);
    patEventIds = patRows.filter((r) => !(CHECK_LOG_ACTIONS as readonly string[]).includes(r.action) && !isText(r.action)).map((r) => r.id);
    patTextIds = patRows.filter((r) => isText(r.action)).map((r) => r.id);
    const boRows = (await sql`SELECT id, action, target_id FROM claimnet.audit_log WHERE actor_user_id = ${bo.userId}::uuid`) as unknown as Array<{ id: string; action: string; target_id: string }>;
    boIds = boRows.map((r) => r.id);
    boMovedPatsId = boRows.find((r) => r.action === "trace.moved" && r.target_id === boMoves)?.id ?? "";
    boDeletedOwnId = boRows.find((r) => r.action === "trace.deleted" && r.target_id === boOwn)?.id ?? "";
    expect(new Set(patRows.filter((r) => isText(r.action)).map((r) => r.action))).toEqual(new Set(["trace.deleted", "group.description_updated", "group.name_updated"]));
    expect([boMovedPatsId, boDeletedOwnId]).not.toContain("");
    onBehalfRowId = ((await sql`SELECT id FROM claimnet.audit_log WHERE actor_user_id = ${bo.userId}::uuid AND metadata->>'subjectUserId' = ${pat.userId}`) as unknown as Array<{ id: string }>)[0]?.id ?? "";
    expect(new Set(patRows.filter((r) => patCheckLogIds.includes(r.id)).map((r) => r.action))).toEqual(new Set(["recipe.checked", "check.searched", "briefing.issued"]));
    expect(onBehalfRowId).not.toBe("");
    for (const r of await rows([...patCheckLogIds, ...patEventIds, ...patTextIds, ...boIds])) before.set(r.id, r);
    const countsBefore = await counts(patCheckLogIds);

    const del = await call(pat.jwt, "DELETE", "/auth/me", { password: PASSWORD });
    expect(del.status).toBe(200);
    expect(await counts(patCheckLogIds)).toEqual(countsBefore); // R-A5, checked again below
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("R-A1: the person's check-log rows lose their actor, key and query text, and keep everything else", async () => {
    const after = await rows(patCheckLogIds);
    expect(after.length).toBe(patCheckLogIds.length);
    for (const r of after) {
      const was = before.get(r.id)!;
      expect(r.actor_user_id).toBeNull();
      expect(r.api_key_id).toBeNull();
      expect(r.target_id).toBe(was.target_type === "api_key" ? null : was.target_id);
      const { apiKeyId: _k, filter: _f, ...kept } = was.metadata ?? {};
      expect(r.metadata).toEqual(kept);
      expect([r.action, r.target_type, r.occurred_at.toISOString()]).toEqual([was.action, was.target_type, was.occurred_at.toISOString()]);
    }
    const search = after.find((r) => r.action === "check.searched");
    expect(JSON.stringify(search?.metadata)).not.toContain(`my private search words ${run}`);
    expect(after.filter((r) => r.action === "recipe.checked").map((r) => r.metadata?.["intentId"])).toContainEqual(expect.stringMatching(/^int_/));
  });

  it("R-A2: a colleague's deposit about the person keeps the record, without the person's id", async () => {
    const [r] = await rows([onBehalfRowId]);
    const was = before.get(onBehalfRowId)!;
    expect(r!.metadata).toHaveProperty("subjectUserId", null);
    expect({ ...r!.metadata, subjectUserId: "x" }).toEqual({ ...was.metadata, subjectUserId: "x" });
    expect(r!.actor_user_id).toBe(bo.userId);
  });

  it("R-A3: the person's account-event rows are not changed by the deletion, apart from R-A6's text", async () => {
    const after = await rows(patEventIds);
    expect(after).toEqual(patEventIds.map((id) => before.get(id)).sort((a, b) => a!.id.localeCompare(b!.id)));
    // Written as the deletion starts, so it has no snapshot: it keeps its actor and metadata.
    const selfDelete = (await sql`SELECT metadata FROM claimnet.audit_log WHERE actor_user_id = ${pat.userId}::uuid AND action = 'user.self_delete'`) as unknown as Array<{ metadata: Record<string, unknown> }>;
    expect(selfDelete.map((r) => r.metadata)).toEqual([{ source: "DELETE /auth/me" }]);
  });

  it("R-A4: nobody else's rows change, apart from the fields R-A2 and R-A6 name", async () => {
    const untouched = boIds.filter((id) => id !== onBehalfRowId && id !== boMovedPatsId);
    expect(untouched).toContain(boDeletedOwnId);
    const after = await rows(untouched);
    expect(after).toEqual(untouched.map((id) => before.get(id)).sort((a, b) => a!.id.localeCompare(b!.id)));
    expect(after.find((r) => r.id === boDeletedOwnId)?.metadata?.["claimText"]).toMatch(/my own deleted recipe's record kept/);
    expect(after.find((r) => r.action === "group.description_updated")?.metadata?.["newDescription"]).toBe(`Bo's shared book ${run}`);
  });

  it("R-A6: recipe and book text goes from the account events the person wrote or that name their recipe, and nothing else does (F116)", async () => {
    const ids = [...patTextIds, boMovedPatsId];
    const after = await rows(ids);
    expect(after.length).toBe(ids.length);
    for (const r of after) {
      const was = before.get(r.id)!;
      expect(TEXT_KEYS.some((k) => k in (was.metadata ?? {})), r.action).toBe(true);
      const kept = Object.fromEntries(Object.entries(was.metadata ?? {}).filter(([k]) => !TEXT_KEYS.includes(k)));
      expect(r.metadata, r.action).toEqual(kept);
      expect([r.actor_user_id, r.action, r.target_id, r.occurred_at.toISOString()]).toEqual([was.actor_user_id, was.action, was.target_id, was.occurred_at.toISOString()]);
    }
    expect(after.find((r) => r.id === boMovedPatsId)?.actor_user_id).toBe(bo.userId);
    expect(after.find((r) => r.action === "group.name_updated")?.metadata).toHaveProperty("groupSlug");
  });

  it("R-A5: counts survive, in total and by month and intent", async () => {
    const after = await rows(patCheckLogIds);
    expect(after.length).toBe(patCheckLogIds.length);
    expect((await counts(patCheckLogIds)).length).toBeGreaterThan(0);
  });
});

/** F118: writeAudit's type covers its callers; this covers every other path
 *  into the table, including ones the source scan in audit-actions.test.ts
 *  cannot read (a name built at run time). It reads whatever the test run has
 *  written so far. */
describe.skipIf(!BASE)("every action in the table is classified (R-C2)", () => {
  it("SELECT DISTINCT action names only listed actions", async () => {
    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      const listed = new Set<string>([...CHECK_LOG_ACTIONS, ...ACCOUNT_EVENT_ACTIONS]);
      const actions = ((await sql`SELECT DISTINCT action FROM claimnet.audit_log`) as unknown as Array<{ action: string }>).map((r) => r.action);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.filter((a) => !listed.has(a))).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});
