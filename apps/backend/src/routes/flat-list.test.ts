import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getDb } from "../db";
import { authenticateKey } from "../authz";
import { submitAndSearch } from "../services/trace.service";
import { seedVerifiedUser } from "../test-users";

/**
 * Layer 3: the flat list and changed-since (drafts-and-triage slice 8b,
 * items 1 and 2).
 *
 * Each test names its rubric row (docs/planning/drafts-and-triage-build.md
 * §Slice 8b items 1 and 2 rubric).
 *
 * Cast: Pat (owns the shared book and two of his own), Sam (a member of the
 * shared book). Pat's key reads the shared book and his personal book; a
 * second key of his reads only the "many" book, which holds 120 recipes for
 * the paging rows and is outside the first key's scope.
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL only reads state back.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "flat-list-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const MARKER = `flatmarker${run}`;
const MANY = 120;

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

type Json = Record<string, unknown>;
interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }
interface Row { recipeId: string; recipe?: string; createdAt?: string; loggedAt?: string; changedAt?: string; recipeBook?: { recipeBookId: string; name: string }; draftState?: string; impact?: string | null; evidence?: unknown; similarity?: number; known?: boolean; knownMembers?: unknown[] }

let n = 0;
function recipe(topic: string): string {
  n += 1;
  return `As a steward sweeping a recipe book for what moved (${topic} ${run}-${n} ${MARKER}), I prefer a flat list of every id so that nothing arrives unseen.`;
}
function evidence(interpretation: string): string {
  return `${interpretation}\n> "quote ${run}-${n}"\n-- flat-list.test.ts, ${run}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!BASE || !canConnect())("the flat list and changed-since (drafts-and-triage slice 8b)", () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  const shared = { id: "", slug: "" };
  const many = { id: "", slug: "" };
  let patKey = "";
  let samKey = "";
  let manyKey = "";
  const ids: Record<string, string> = {};
  const manyIds: string[] = [];
  /** A time after every setup deposit and before the changes C2 makes. */
  let beforeChanges = "";

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-flat-${label}-${run}@test.local`;
    const jwt = ((await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string } }).data?.token ?? "";
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }

  async function createBook(owner: Actor, label: string): Promise<{ id: string; slug: string }> {
    const slug = `flat-${label}-${run}`;
    const res = await call(owner, "POST", "/recipe-books", { name: `flat ${label} ${run}`, slug, organizationId: owner.orgId });
    return { id: ((await res.json()) as { data?: { id: string } }).data?.id ?? "", slug };
  }

  async function mintKey(actor: Actor, books: string[], def: string): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: books,
      writeRecipeBookIds: books,
      defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }

  async function mcpRaw(key: string, name: string, args: Json): Promise<{ result?: { structuredContent?: Json; content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    return JSON.parse(line ? line.slice(6) : raw) as { result?: { structuredContent?: Json; content?: Array<{ text?: string }> }; error?: { message?: string } };
  }

  async function mcp(key: string, name: string, args: Json): Promise<{ text: string; structured: Json | undefined }> {
    const msg = await mcpRaw(key, name, args);
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent };
  }

  async function deposit(key: string, text: string, extra: Json = {}): Promise<string> {
    const { structured } = await mcp(key, "check_recipe", {
      recipe: text, supporting_evidence: evidence("Could not ask: the person is away."), response_format: "structured", ...extra,
    });
    const id = (structured?.["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "";
    if (!id) throw new Error("deposit failed");
    return id;
  }

  /** MCP search_recipes, structured. */
  async function search(key: string, query: string, extra: Json = {}): Promise<{ rows: Row[]; data: Json }> {
    const { structured } = await mcp(key, "search_recipes", { query, response_format: "structured", ...extra });
    const data = structured ?? {};
    return { rows: (data["results"] as Row[] | undefined) ?? [], data };
  }

  async function web(key: string, filter: string, extra: Record<string, string> = {}, format: "json" | "html" = "json"): Promise<{ body: Json; html: string }> {
    const qs = new URLSearchParams({ key, filter, ...extra, ...(format === "json" ? { format: "json" } : {}) });
    const res = await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: format === "json" ? "application/json" : "text/html" } });
    if (format === "html") return { body: {}, html: await res.text() };
    return { body: (await res.json()) as Json, html: "" };
  }

  async function dbNow(): Promise<string> {
    const rows = await sql`SELECT clock_timestamp() AS t`;
    return new Date(rows[0]!["t"] as string | Date).toISOString();
  }

  // ── setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [pat, sam] = await Promise.all([registerAndVerify("pat"), registerAndVerify("sam")]);
    Object.assign(shared, await createBook(pat, "shared"));
    Object.assign(many, await createBook(pat, "many"));
    const added = await call(pat, "POST", `/recipe-books/${shared.id}/members`, { email: sam.email, role: "member" });
    if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);
    patKey = await mintKey(pat, [shared.id, pat.personalBookId], shared.id);
    samKey = await mintKey(sam, [shared.id], shared.id);
    manyKey = await mintKey(pat, [many.id], many.id);

    // The shared book: Pat's published recipes (one backfilled to an old
    // judgment date), his drafts with ratings, and Sam's unresolved draft.
    ids["old"] = await deposit(patKey, recipe("old judgment"), { decided_at: "2026-01-15" });
    ids["p1"] = await deposit(patKey, recipe("published one"));
    ids["p2"] = await deposit(patKey, recipe("published two"));
    ids["dHigh"] = await deposit(patKey, recipe("draft high"), { draft: true, impact: "high", uncertainty: "high" });
    ids["dLow"] = await deposit(patKey, recipe("draft low"), { draft: true, impact: "low", uncertainty: "low" });
    ids["dUnrated"] = await deposit(patKey, recipe("draft unrated"), { draft: true });
    ids["samDraft"] = await deposit(samKey, recipe("sam draft"), { draft: true });
    // Changed-since fixtures, each changed after `beforeChanges` in C2.
    ids["toVerify"] = await deposit(patKey, recipe("to verify"), { draft: true });
    ids["toReject"] = await deposit(patKey, recipe("to reject"), { draft: true });
    ids["toMove"] = await deposit(patKey, recipe("to move"));
    ids["toFeedback"] = await deposit(patKey, recipe("to feedback"));
    ids["toReact"] = await deposit(patKey, recipe("to react"));
    ids["untouched"] = await deposit(patKey, recipe("untouched"));

    // The many book: 120 published recipes, deposited in-process (the route
    // limiter is not under test here) in small parallel batches.
    const principal = await authenticateKey(getDb(), manyKey);
    if (!principal) throw new Error("many key did not authenticate");
    for (let b = 0; b < MANY; b += 10) {
      const batch = await Promise.all(Array.from({ length: Math.min(10, MANY - b) }, () => {
        const text = recipe("many");
        return submitAndSearch({ principal, traceText: text, evidenceFor: evidence("bulk fixture") });
      }));
      for (const r of batch) {
        if (!r.traceId) throw new Error(`bulk deposit failed: ${r.error ?? "no id"}`);
        manyIds.push(r.traceId);
      }
    }

    await sleep(20);
    beforeChanges = await dbNow();
    await sleep(20);
  }, 300_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── The flat list ────────────────────────────────────────────────────────

  it("S8b-L1: a qualifier-only search returns the flat list on MCP structured, newest judgment first", async () => {
    const { rows, data } = await search(patKey, `"${MARKER}" author:me`);
    expect(data["listOrder"]).toBe("judgment");
    expect(data["perPage"]).toBe(50);
    expect(data["clustered"]).toBe(false);
    expect(data["relatedEvidence"]).toBeUndefined();
    const listed = rows.map((r) => r.recipeId);
    // Every visible recipe of Pat's in the shared book, once each.
    for (const k of ["old", "p1", "p2", "dHigh", "dLow", "dUnrated", "toVerify", "toReject", "toMove", "toFeedback", "toReact", "untouched"]) {
      expect(listed, k).toContain(ids[k]);
    }
    expect(new Set(listed).size).toBe(listed.length);
    expect(data["totalResults"]).toBe(listed.length);
    // Newest judgment first: the backfilled recipe is last.
    expect(listed[listed.length - 1]).toBe(ids["old"]);
    const judged = rows.map((r) => Date.parse(r.createdAt ?? ""));
    for (let i = 1; i < judged.length; i++) expect(judged[i - 1]!).toBeGreaterThanOrEqual(judged[i]!);
    // Decision 2's row: the whole claim, the times, the book; no evidence or similarity.
    const old = rows.find((r) => r.recipeId === ids["old"])!;
    expect(old.recipe).toContain("old judgment");
    expect(old.createdAt?.startsWith("2026-01-15")).toBe(true);
    expect(Date.parse(old.loggedAt ?? "")).toBeGreaterThan(Date.parse("2026-10-01"));
    expect(old.changedAt).toBeTruthy();
    expect(old.recipeBook?.recipeBookId).toBe(shared.id);
    expect(old.evidence).toBeUndefined();
    expect(old.similarity).toBeUndefined();
    // The viewer's own draft keeps its label and ratings (S3-AG2); a published row carries none.
    const high = rows.find((r) => r.recipeId === ids["dHigh"])!;
    expect(high.draftState).toBe("unverified");
    expect(high.impact).toBe("high");
    expect(old.draftState).toBeUndefined();
    expect(old.impact).toBeUndefined();
  });

  it("S8b-L1: the same list in markdown, /check JSON and /check HTML", async () => {
    const md = await mcp(patKey, "search_recipes", { query: `"${MARKER}" author:me` });
    expect(md.text).toMatch(/recipe\(s\) match, listed newest judgment date first/);
    expect(md.text).toContain(`- ${ids["old"]} 2026-01-15T00:00Z`);
    expect(md.text).toMatch(/Page 1 of 1, 50 per page\. This is the last page\./);
    expect(md.text).not.toMatch(/represents \d+ similar/);
    expect(md.text).not.toMatch(/Related evidence/);

    const { body } = await web(patKey, `"${MARKER}" author:me`);
    const data = body["data"] as Json;
    expect(data["listOrder"]).toBe("judgment");
    expect(((data["results"] as Row[]).map((r) => r.recipeId))).toContain(ids["old"]);
    expect((data["results"] as Row[]).find((r) => r.recipeId === ids["old"])?.loggedAt).toBeTruthy();

    const { html } = await web(patKey, `"${MARKER}" author:me`, {}, "html");
    expect(html).toContain(`<code>${ids["old"]}</code>`);
    expect(html).toContain("Listed newest judgment date first");
    expect(html).not.toContain("Sort: <strong>relevance</strong>");
  });

  it("S8b-L2: paging is total: 50, 50 and 20 distinct ids, then an empty page that names the end", async () => {
    const seen: string[] = [];
    const sizes: number[] = [];
    for (const page of [1, 2, 3]) {
      const { rows, data } = await search(manyKey, "author:me", { page });
      expect(data["totalResults"]).toBe(MANY);
      expect(data["totalPages"]).toBe(3);
      expect(data["page"]).toBe(page);
      sizes.push(rows.length);
      seen.push(...rows.map((r) => r.recipeId));
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(MANY);
    expect([...seen].sort()).toEqual([...manyIds].sort());
    const past = await search(manyKey, "author:me", { page: 4 });
    expect(past.rows).toEqual([]);
    expect(past.data["totalResults"]).toBe(MANY);
    const md = await mcp(manyKey, "search_recipes", { query: "author:me", page: 4 });
    expect(md.text).toContain("Page 4 is past the end: 120 match(es) on 3 page(s) of 50.");
    const first = await mcp(manyKey, "search_recipes", { query: "author:me" });
    expect(first.text).toContain("Page 1 of 3, 50 per page. Next: page=2.");
    // /check pages the same list.
    const { body } = await web(manyKey, "author:me", { page: "3" });
    expect(((body["data"] as Json)["results"] as Row[]).map((r) => r.recipeId)).toEqual(seen.slice(100));
  });

  it("S8b-L3: is:draft lists in the review queue's triage order", async () => {
    const { rows, data } = await search(patKey, "is:draft");
    expect(data["listOrder"]).toBe("triage");
    const res = await call(pat, "GET", "/traces/drafts");
    const queue = ((await res.json()) as { data: { items: Array<{ id: string }> } }).data.items.map((i) => i.id);
    expect(rows.map((r) => r.recipeId)).toEqual(queue);
    expect(rows[0]!.recipeId).toBe(ids["dHigh"]);
    const md = await mcp(patKey, "search_recipes", { query: "is:draft" });
    expect(md.text).toMatch(/listed in triage order/);
  });

  it("S8b-L4: visibility is unchanged: no colleague's draft, no book outside the key, totals match rows", async () => {
    const { rows, data } = await search(patKey, `"${MARKER}"`);
    const listed = rows.map((r) => r.recipeId);
    expect(listed).not.toContain(ids["samDraft"]);
    for (const id of manyIds.slice(0, 5)) expect(listed).not.toContain(id);
    expect(data["totalResults"]).toBe(listed.length);
    // Sam sees Pat's published recipes and none of Pat's drafts.
    const samView = (await search(samKey, `"${MARKER}"`)).rows.map((r) => r.recipeId);
    expect(samView).toContain(ids["p1"]);
    expect(samView).not.toContain(ids["dHigh"]);
    expect(samView).toContain(ids["samDraft"]);
  });

  it("S8b-L5: no walk-down: identical flat requests list identical rows, and nothing is marked shown", async () => {
    const session = (await search(patKey, "author:me", {})).data["sessionId"] as string;
    const intentStory = `As a steward sweeping the shared book ${run}, I want every id each tick.`;
    const a = await search(patKey, `"${MARKER}" author:me`, { session_id: session, intent: intentStory });
    const intentId = a.data["intentId"] as string;
    const b = await search(patKey, `"${MARKER}" author:me`, { session_id: session, intent: intentId });
    expect(b.rows.map((r) => r.recipeId)).toEqual(a.rows.map((r) => r.recipeId));
    expect(b.rows.every((r) => r.known === undefined)).toBe(true);
    const shown = await sql`SELECT count(*)::int AS n FROM claimnet.session_shown WHERE session_id = ${session}`;
    expect(shown[0]!["n"]).toBe(0);
    const intentShown = await sql`SELECT count(*)::int AS n FROM claimnet.intent_shown WHERE intent_id = ${intentId}`;
    expect(intentShown[0]!["n"]).toBe(0);
    // A semantic search under the same session stubs none of them.
    const ranked = await search(patKey, `steward sweeping a recipe book "${MARKER}"`, { session_id: session });
    expect(ranked.data["listOrder"]).toBeUndefined();
    expect(ranked.rows.some((r) => r.known === true)).toBe(false);
  });

  // ── Changed-since ────────────────────────────────────────────────────────

  it("S8b-C1: created-after: selects what was deposited at or after the time, on both paths", async () => {
    const t = await dbNow();
    await sleep(20);
    const fresh = await deposit(patKey, recipe("created after"));
    ids["fresh"] = fresh;
    const flat = (await search(patKey, `created-after:${t}`)).rows.map((r) => r.recipeId);
    expect(flat).toEqual([fresh]);
    const today = t.slice(0, 10);
    const byDate = (await search(patKey, `"${MARKER}" created-after:${today}`)).rows.map((r) => r.recipeId);
    expect(byDate).toContain(ids["old"]);
    expect(byDate).toContain(fresh);
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
    expect((await search(patKey, `created-after:${tomorrow}`)).rows).toEqual([]);
    // The ranked path: semantic text with the qualifier only removes rows.
    const ranked = await search(patKey, `steward sweeping a recipe book created-after:${t}`, { verbosity: "high" });
    expect(ranked.data["listOrder"]).toBeUndefined();
    expect(ranked.rows.map((r) => r.recipeId)).toEqual([fresh]);
  });

  it("S8b-C2: changed-after: selects a verification, a move, a feedback row and a reaction, latest change first", async () => {
    expect((await call(pat, "PUT", `/traces/${ids["toVerify"]}/reaction`, { reaction: "still_true" })).status).toBe(200);
    await sleep(20);
    expect((await call(pat, "PUT", `/traces/${ids["toReject"]}/reaction`, { reaction: "wrong" })).status).toBe(200);
    await sleep(20);
    expect((await call(pat, "PATCH", `/traces/${ids["toMove"]}`, { groupId: pat.personalBookId })).status).toBe(200);
    await sleep(20);
    const fb = await mcp(patKey, "log_feedback", {
      trace_id: ids["toFeedback"], kind: "check-feedback", impact: "none", disposition: "proceeded",
      story_fulfilled: "yes", story: `As a steward ${run}, I wanted to see a change.`,
    });
    expect(fb.text).not.toMatch(/^Error/);
    await sleep(20);
    expect((await call(sam, "PUT", `/traces/${ids["toReact"]}/reaction`, { reaction: "stale" })).status).toBe(200);

    const { rows, data } = await search(patKey, `"${MARKER}" changed-after:${beforeChanges}`);
    expect(data["listOrder"]).toBe("changed");
    // The rejected draft has left every result set, so it is not listed; C1's
    // recipe, deposited after the time and before these changes, is last.
    expect(rows.map((r) => r.recipeId)).toEqual([ids["toReact"], ids["toFeedback"], ids["toMove"], ids["toVerify"], ids["fresh"]]);
    const changed = rows.map((r) => Date.parse(r.changedAt ?? ""));
    for (const c of changed) expect(c).toBeGreaterThanOrEqual(Date.parse(beforeChanges));
    const md = await mcp(patKey, "search_recipes", { query: `"${MARKER}" changed-after:${beforeChanges}` });
    expect(md.text).toMatch(/listed latest change first/);
    // A recipe untouched since the time is not selected.
    expect(rows.map((r) => r.recipeId)).not.toContain(ids["untouched"]);
  });

  // ── Listing depth (F110, F105) ───────────────────────────────────────────

  it("D-2: a page past the first 10,000 results is refused on every search surface, naming page and how to narrow", async () => {
    // The flat list: page 200 is the last within reach (50 a page). Past the
    // end of a short list it is an empty page; page 201 is refused.
    const last = await search(manyKey, "author:me", { page: 200 });
    expect(last.rows).toEqual([]);
    expect(last.data["totalResults"]).toBe(MANY);
    const refused = await mcp(manyKey, "search_recipes", { query: "author:me", page: 201 });
    expect(refused.text).toContain("Error: page 201 is past what a search pages through: the first 10,000 results (pages 1 to 200 at 50 per page).");
    expect(refused.text).toContain("changed-after:, created-after: or read_recipe_books");
    const web201 = await fetch(`${BASE}/check?${new URLSearchParams({ key: manyKey, filter: "author:me", page: "201", format: "json" }).toString()}`);
    expect(web201.status).toBe(400);
    expect(((await web201.json()) as Json)["error"]).toContain("page 201 is past what a search pages through");
    // The ranked path pages 20 at a time: page 501 is refused.
    const ranked = await fetch(`${BASE}/check?${new URLSearchParams({ key: manyKey, filter: "steward sweeping", page: "501", format: "json" }).toString()}`);
    expect(ranked.status).toBe(400);
    expect(((await ranked.json()) as Json)["error"]).toContain("(pages 1 to 500 at 20 per page)");
    // A check with a deep page is refused before anything is stored.
    const before = await sql`SELECT count(*)::int AS n FROM claimnet.traces WHERE group_id = ${many.id}::uuid`;
    const check = await fetch(`${BASE}/check?${new URLSearchParams({ key: manyKey, recipe: recipe("deep page check"), ef: evidence("deep page"), page: "501", format: "json" }).toString()}`);
    expect(check.status).toBe(400);
    expect(((await check.json()) as Json)["error"]).toContain("Nothing was stored.");
    const after = await sql`SELECT count(*)::int AS n FROM claimnet.traces WHERE group_id = ${many.id}::uuid`;
    expect(after[0]!["n"]).toBe(before[0]!["n"]);
  });

  // ── Parameter ────────────────────────────────────────────────────────────

  it("S8b-P1: page must be an integer from 1; anything else is refused naming the field", async () => {
    for (const page of [0, -1, 1.5, "2"]) {
      const msg = await mcpRaw(manyKey, "search_recipes", { query: "author:me", page });
      const text = msg.error?.message ?? msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
      expect(msg.error !== undefined || msg.result?.isError === true, String(page)).toBe(true);
      expect(text, String(page)).toMatch(/page/);
    }
    // /check keeps its lenient reading: an unusable page is page 1.
    const { body } = await web(manyKey, "author:me", { page: "nonsense" });
    expect((body["data"] as Json)["page"]).toBe(1);
  });
});
