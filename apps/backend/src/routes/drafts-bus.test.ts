import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { seedVerifiedUser } from "../test-users";

/**
 * Layer 3: drafts as a bus (drafts-and-triage slice 10).
 *
 * A draft is live while its task is: a headless key's drafts always, others
 * for 7 days from deposit until slice 6a links a draft to its intent. Expired
 * drafts leave the review queue, `is:draft` and every result set, are listed
 * by `is:expired`, and stay readable and resolvable by id. A check or search
 * near a live draft the caller may read names it in one line. Each test names
 * its rubric row (docs/planning/drafts-and-triage-build.md §Slice 10 rubric)
 * and scenario (docs/product-specs/drafts-and-triage.feature, DT-BUS-01 to 11).
 *
 * Cast, as in the feature file: Pat, whose agents deposit, resolve and
 * search; Sam, who owns the shared book; Dana, a member who deposits on Pat's
 * behalf. Pat's keys: K1 and K2 (ordinary), H (headless).
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL reads state back, and ages a draft by moving its `created_at`
 * into the past: the one fixture write, since a week cannot be waited out.
 */

type Json = Record<string, unknown>;

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "drafts-slice10-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const RANDOM_UUID = "5d2e8a41-3c7b-4f19-8e60-9a1b2c3d4e5f";
const DAY = 24 * 60 * 60 * 1000;

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }

let n = 0;
/** A recipe with a unique token; no parentheses, which the search grammar reads as a group. */
function recipe(topic: string): string {
  n += 1;
  return `As a backend maintainer working on draft liveness, case ${topic} ${tokenFor(n)}, I prefer a question that lives while its task does so that nobody waits on a quiet session.`;
}
function tokenFor(i: number): string {
  return `${run}q${i}z`;
}
/** The recipe's token, as a quoted search term that matches it alone. */
function tag(text: string): string {
  const m = new RegExp(`${run}q[0-9]+z`).exec(text);
  if (!m) throw new Error(`no token in ${text}`);
  return `"${m[0]}"`;
}
const evidence = (quote: string): string => `Could not ask: the person is away; their answer would settle it.\n> "${quote}"\n-- drafts-bus.test.ts, ${run}`;
const settling = (tag: string): string => `The person settled it in the session.\n> "settled ${tag} ${run}"\n-- conversation with the person, ${run}`;

describe.skipIf(!BASE || !canConnect())("drafts as a bus (drafts-and-triage slice 10)", () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let dana: Actor;
  let shared = { id: "", slug: "" };
  let K1 = "";
  let K2 = "";
  let H = "";
  let samKey = "";
  let danaKey = "";

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-bus-${label}-${run}@test.local`;
    const login = await seedVerifiedUser(email, PASSWORD);
    const lb = (await login.json()) as { data?: { token?: string; user?: { id: string } } };
    const jwt = lb.data?.token ?? "";
    const userId = lb.data?.user?.id ?? "";
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId, personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }

  async function mintKey(actor: Actor, books: string[], def: string, extra: Json = {}): Promise<{ key: string; id: string }> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: books,
      writeRecipeBookIds: books,
      defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
      ...extra,
    });
    const data = ((await res.json()) as { data?: { key?: string; id?: string } }).data;
    if (!data?.key) throw new Error(`key mint failed: ${res.status}`);
    return { key: data.key, id: data.id ?? "" };
  }

  async function mcp(key: string, name: string, args: Json): Promise<{ text: string; structured: Json | undefined }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { structuredContent?: Json; content?: Array<{ text?: string }> } };
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent };
  }

  /** A fresh draft through `key`, with its text; returns its id. */
  async function draft(key: string, text: string, extra: Json = {}): Promise<string> {
    const { structured } = await mcp(key, "check_recipe", {
      recipe: text, supporting_evidence: evidence(`draft ${text.slice(-40)}`), response_format: "structured", draft: true, ...extra,
    });
    const id = (structured?.["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "";
    if (!id) throw new Error(`deposit failed for ${text}`);
    return id;
  }

  /** Age a draft by `days` (the one fixture write). */
  async function age(id: string, days: number): Promise<void> {
    await sql`UPDATE claimnet.traces SET created_at = NOW() - make_interval(secs => ${Math.round(days * 86400)}) WHERE id = ${id}::uuid`;
  }

  async function queue(actor: Actor, q?: string): Promise<{ ids: string[]; expiredTotal: number; expired: boolean; items: Array<{ id: string; expired: boolean }> }> {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    const body = (await (await call(actor, "GET", `/traces/drafts${qs}`)).json()) as {
      data: { items: Array<{ id: string; expired: boolean }>; expiredTotal: number; expired: boolean };
    };
    return { ids: body.data.items.map((i) => i.id), expiredTotal: body.data.expiredTotal, expired: body.data.expired, items: body.data.items };
  }

  async function queueCount(actor: Actor): Promise<number> {
    return ((await (await call(actor, "GET", "/traces/drafts/count")).json()) as { data: { count: number } }).data.count;
  }

  async function searchIds(key: string, query: string): Promise<{ ids: string[]; text: string; structured: Json | undefined }> {
    const r = await mcp(key, "search_recipes", { query, response_format: "structured", verbosity: "high" });
    const results = (r.structured?.["results"] as Array<{ recipeId?: string }> | undefined) ?? [];
    const text = (await mcp(key, "search_recipes", { query, verbosity: "high" })).text;
    return { ids: results.map((x) => x.recipeId ?? ""), text, structured: r.structured };
  }

  async function counts(id: string): Promise<{ evidence: number; audit: number; exists: number }> {
    const [e] = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${id}::uuid`;
    const [a] = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE target_id = ${id}`;
    const [t] = await sql`SELECT count(*)::int AS n FROM claimnet.traces WHERE id = ${id}::uuid`;
    return { evidence: Number(e?.["n"]), audit: Number(a?.["n"]), exists: Number(t?.["n"]) };
  }

  /** Retry until `probe` returns a value (the embedding worker writes vectors after the deposit). */
  async function eventually<T>(probe: () => Promise<T | undefined>, tries = 30): Promise<T | undefined> {
    for (let i = 0; i < tries; i++) {
      const v = await probe();
      if (v !== undefined) return v;
      await new Promise((r) => setTimeout(r, 500));
    }
    return undefined;
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
    [pat, sam, dana] = await Promise.all([registerAndVerify("pat"), registerAndVerify("sam"), registerAndVerify("dana")]);
    const slug = `bus-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `Bus ${run}`, slug, organizationId: sam.orgId });
    shared = { id: ((await created.json()) as { data?: { id: string } }).data?.id ?? "", slug };
    if (!shared.id) throw new Error("book create failed");
    for (const m of [pat, dana]) {
      const added = await call(sam, "POST", `/recipe-books/${shared.id}/members`, { email: m.email, role: "member" });
      if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);
    }
    const both = [shared.id, pat.personalBookId];
    K1 = (await mintKey(pat, both, shared.id, { label: `K1 ${run}` })).key;
    K2 = (await mintKey(pat, both, shared.id, { label: `K2 ${run}` })).key;
    H = (await mintKey(pat, both, shared.id, { depositLevel: "drafts", label: `H ${run}` })).key;
    samKey = (await mintKey(sam, [shared.id, sam.personalBookId], sam.personalBookId)).key;
    danaKey = (await mintKey(dana, [shared.id, dana.personalBookId], shared.id)).key;
  }, 120_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── Liveness and where expired drafts go ─────────────────────────────────

  it("S10-L1 / S10-X1 / S10-X3 / DT-BUS-01 / DT-BUS-07: a week-old draft leaves the queue, its count and is:draft, and is:expired lists it", async () => {
    const liveText = recipe("six days");
    const expiredText = recipe("eight days");
    const live = await draft(K1, liveText);
    const expired = await draft(K1, expiredText);
    await age(live, 6);
    await age(expired, 8);

    const both = `(${tag(liveText)} OR ${tag(expiredText)})`;
    const q = await queue(pat, both);
    expect(q.ids).toEqual([live]);
    expect(q.expiredTotal).toBeGreaterThanOrEqual(1);
    expect(q.expired).toBe(false);
    const qe = await queue(pat, `is:expired ${both}`);
    expect(qe.ids).toEqual([expired]);
    expect(qe.expired).toBe(true);
    expect(qe.items[0]?.expired).toBe(true);

    const isDraft = await searchIds(K1, `is:draft ${both}`);
    expect(isDraft.ids).toEqual([live]);
    const isExpired = await searchIds(K1, `is:expired ${both}`);
    expect(isExpired.ids).toEqual([expired]);
    expect(isExpired.text).toContain("[expired draft: it was deposited with no intent over 7 days ago");

    const before = await queueCount(pat);
    await age(live, 8);
    expect(await queueCount(pat)).toBe(before - 1);
  });

  it("S10-X2 / DT-BUS-06: an expired draft leaves its person's search results; a live one is there with its label", async () => {
    const text = recipe("results");
    const id = await draft(K1, text);
    const live = await searchIds(K1, tag(text));
    expect(live.ids).toEqual([id]);
    expect(live.text).toContain("[unverified draft: ");
    await age(id, 8);
    expect((await searchIds(K1, tag(text))).ids).toEqual([]);
    expect((await searchIds(K1, `is:expired ${tag(text)}`)).ids).toEqual([id]);
  });

  it("S10-L4 / DT-BUS-04: a headless key's draft never expires; once that key is gone it is judged by its age", async () => {
    const extra = await mintKey(pat, [shared.id, pat.personalBookId], shared.id, { depositLevel: "drafts", label: `H2 ${run}` });
    const text = recipe("headless");
    const id = await draft(extra.key, text);
    await age(id, 30);
    expect((await queue(pat, tag(text))).ids).toEqual([id]);
    // The mint does not return the key's id; the list does, by label.
    const listed = ((await (await call(pat, "GET", "/keys")).json()) as { data: Array<{ id: string; label: string | null }> }).data;
    const keyId = listed.find((k) => k.label === `H2 ${run}`)?.id ?? "";
    expect(keyId).not.toBe("");
    const del = await call(pat, "DELETE", `/keys/${keyId}`);
    expect(del.ok).toBe(true);
    expect((await queue(pat, tag(text))).ids).toEqual([]);
    expect((await queue(pat, `is:expired ${tag(text)}`)).ids).toEqual([id]);
  });

  it("S10-L5 / DT-BUS-05: an on-behalf draft's liveness is the depositor's, the same for both sides", async () => {
    const text = recipe("on behalf");
    const id = await draft(danaKey, text, { on_behalf_of: pat.email });
    expect((await queue(pat, tag(text))).ids).toEqual([id]);
    await age(id, 8);
    expect((await queue(pat, tag(text))).ids).toEqual([]);
    expect((await queue(pat, `is:expired ${tag(text)}`)).ids).toEqual([id]);
    const danaView = ((await (await call(dana, "GET", `/traces/${id}`)).json()) as { data: Json }).data;
    expect(danaView).toMatchObject({ draftState: "unverified", draftExpiry: "age", draftAbout: pat.email });
    const patView = ((await (await call(pat, "GET", `/traces/${id}`)).json()) as { data: Json }).data;
    expect(patView).toMatchObject({ draftState: "unverified", draftExpiry: "age" });
  });

  it("S10-X4 / S10-X5 / S10-R3 / DT-BUS-08: an expired draft reads by id with its reason and is resolvable on MCP, REST and the web; nothing is deleted", async () => {
    const aText = recipe("resolve mcp");
    const [a, b, c] = [await draft(K1, aText), await draft(K1, recipe("resolve rest")), await draft(K1, recipe("resolve web"))];
    const before = await counts(a);
    for (const id of [a, b, c]) await age(id, 9);
    expect(await counts(a)).toEqual(before);

    const read = await mcp(K1, "get_recipes", { recipe_ids: a });
    expect(read.text).toContain("Draft: [expired draft: it was deposited with no intent over 7 days ago");

    const r1 = await mcp(K2, "verify_draft", { recipe_id: a, outcome: "rejected", supporting_evidence: settling("expired mcp") });
    expect(r1.text).toMatch(new RegExp(`^Draft ${a} is rejected:`));
    const r2 = await fetch(`${BASE}/recipes/${b}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${K2}` },
      body: JSON.stringify({ supporting_evidence: settling("expired rest") }),
    });
    expect(r2.status).toBe(200);
    const r3 = await call(pat, "PUT", `/traces/${c}/reaction`, { reaction: "wrong" });
    expect(r3.ok).toBe(true);
    const states = await sql`SELECT id::text AS id, draft_state FROM claimnet.traces WHERE id IN (${a}::uuid, ${b}::uuid, ${c}::uuid)`;
    expect(Object.fromEntries(states.map((s) => [s["id"], s["draft_state"]]))).toEqual({ [a]: "rejected", [b]: "verified", [c]: "rejected" });
    for (const id of [a, b, c]) {
      const [row] = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE target_id = ${id} AND action LIKE 'recipe.draft_%'`;
      expect(Number(row?.["n"]), id).toBe(1);
    }
    // A resolved draft is neither live nor expired.
    expect((await searchIds(K1, `is:expired ${tag(aText)}`)).ids).toEqual([]);
  });

  // ── Dispatch ─────────────────────────────────────────────────────────────

  it("S10-D1 / S10-D5 / DT-BUS-09: a check near a live draft names it, on MCP markdown, the structured data and the web page", async () => {
    const text = recipe("dispatch");
    const id = await draft(K1, text);
    const line = `Open question near this call: ${id} (asked `;
    const named = await eventually(async () => {
      const r = await mcp(K2, "search_recipes", { query: text, response_format: "structured" });
      const oq = r.structured?.["openQuestion"] as { recipeId?: string; askedAt?: string } | undefined;
      return oq?.recipeId === id ? oq : undefined;
    });
    expect(named?.askedAt).toBeTruthy();
    const md = await mcp(K2, "search_recipes", { query: text });
    expect(md.text).toContain(line);
    expect(md.text).toContain("If your context settles it, resolve it; otherwise leave it.");
    // A check from another of Pat's keys with the same text: stub embeddings
    // are not semantic, so only identical text is reliably near (dedupe is per key).
    const check = await mcp(K2, "check_recipe", { recipe: text, supporting_evidence: evidence("near the open question") });
    expect(check.text).toContain(line);
    const web = await fetch(`${BASE}/check?${new URLSearchParams({ key: K2, filter: text })}`);
    expect(await web.text()).toContain(`Open question near this call: ${id}`);
  }, 60_000);

  it("S10-D2: a check never names the draft it just deposited", async () => {
    const text = recipe("self");
    const r = await mcp(K1, "check_recipe", { recipe: text, supporting_evidence: evidence("self"), draft: true, response_format: "structured" });
    const id = (r.structured?.["checked"] as { recipeId?: string } | undefined)?.recipeId;
    expect(id).toBeTruthy();
    expect((r.structured?.["openQuestion"] as { recipeId?: string } | undefined)?.recipeId).not.toBe(id);
  });

  it("S10-D4 / DT-BUS-10: no line for a collaborator, a headless caller, or an expired draft", async () => {
    const text = recipe("silence");
    const id = await draft(K1, text);
    // The line appears for Pat's own agent first, so the draft is embedded.
    const seen = await eventually(async () => {
      const r = await mcp(K2, "search_recipes", { query: text, response_format: "structured" });
      return (r.structured?.["openQuestion"] as { recipeId?: string } | undefined)?.recipeId === id ? true : undefined;
    });
    expect(seen).toBe(true);
    const samText = (await mcp(samKey, "search_recipes", { query: text })).text;
    expect(samText).not.toContain("Open question");
    expect(samText).not.toContain(id);
    const headless = (await mcp(H, "search_recipes", { query: text })).text;
    expect(headless).not.toContain("Open question");
    await age(id, 8);
    expect((await mcp(K2, "search_recipes", { query: text })).text).not.toContain(`Open question near this call: ${id}`);
  }, 60_000);

  // ── Reading a resolved draft by id ───────────────────────────────────────

  it("S10-R1 / DT-BUS-11: by id, the subject's agents see how and when each resolved draft was resolved", async () => {
    const byAgent = await draft(K1, recipe("by agent"));
    const byDepositor = await draft(K1, recipe("by depositor"));
    const byPerson = await draft(K1, recipe("by person"));
    await mcp(K2, "verify_draft", { recipe_id: byAgent, outcome: "rejected", supporting_evidence: settling("agent") });
    await mcp(K1, "verify_draft", { recipe_id: byDepositor, outcome: "not_chosen", supporting_evidence: settling("depositor") });
    await call(pat, "PUT", `/traces/${byPerson}/reaction`, { reaction: "still_true" });
    const today = new Date().toISOString().slice(0, 10);

    const text = (await mcp(K1, "get_recipes", { recipe_ids: `${byAgent},${byDepositor},${byPerson}` })).text;
    expect(text).toContain(`[rejected draft: rejected by their agent "K2 ${run}" on ${today}; its evidence says why]`);
    expect(text).toContain(`[draft not chosen: marked not chosen by the agent that deposited it on ${today}]`);
    expect(text).toContain(`[verified draft: verified by your user on ${today}]`);

    const rest = (await (await fetch(`${BASE}/recipes?ids=${byAgent},${byPerson}`, { headers: { Authorization: `Bearer ${K1}` } })).json()) as { data: { recipes: Array<Json> } };
    const agentEntry = rest.data.recipes.find((e) => e["recipeId"] === byAgent)!;
    expect(agentEntry["draftState"]).toBe("rejected");
    expect(agentEntry["draftResolution"]).toMatchObject({ by: "agent", keyLabel: `K2 ${run}` });
    expect(rest.data.recipes.find((e) => e["recipeId"] === byPerson)!["draftState"]).toBe("verified");
  });

  it("S10-R2: the depositor of an on-behalf draft sees no resolver or date, and a collaborator gets the uniform answer", async () => {
    const id = await draft(danaKey, recipe("obo resolved"), { on_behalf_of: pat.email });
    await mcp(K2, "verify_draft", { recipe_id: id, outcome: "rejected", supporting_evidence: settling("obo") });
    const danaText = (await mcp(danaKey, "get_recipes", { recipe_ids: id })).text;
    expect(danaText).toContain(`[rejected draft about ${pat.email}: its evidence says why]`);
    expect(danaText).not.toMatch(/rejected by/);
    const norm = (t: string, x: string): string => t.split(x).join("<ID>");
    const samReal = (await mcp(samKey, "get_recipes", { recipe_ids: id })).text;
    const samRandom = (await mcp(samKey, "get_recipes", { recipe_ids: RANDOM_UUID })).text;
    expect(norm(samReal, id)).toBe(norm(samRandom, RANDOM_UUID));
  });

  // ── Counts and what stays unwritten ──────────────────────────────────────

  it("S10-K1: the books block counts live drafts and those that expired unanswered in the last 7 days", async () => {
    // The shared book's Drafts line: the recipes here are all deposited there.
    const expiredCount = async (): Promise<number> => {
      const text = (await mcp(K1, "list_my_recipe_books", {})).text;
      const block = text.split(shared.slug)[1] ?? "";
      const line = block.split("\n").find((l) => l.includes("Drafts: ")) ?? "";
      if (line.includes("expired")) expect(line).toMatch(/\d+ expired unanswered in the last 7 days \(search is:expired\)$/);
      return Number(/(\d+) expired unanswered/.exec(line)?.[1] ?? 0);
    };
    const recent = await draft(K1, recipe("expired recently"));
    const old = await draft(K1, recipe("expired long ago"));
    const before = await expiredCount();
    await age(recent, 9);
    expect(await expiredCount()).toBe(before + 1);
    // Thirty days old: its window closed 23 days ago, outside the span.
    await age(old, 30);
    expect(await expiredCount()).toBe(before + 1);
  });

  it("S10-M2: reading, listing and searching drafts writes nothing to the intent or the draft", async () => {
    const reg = await mcp(K1, "search_recipes", { query: "is:draft", intent: `As a backend maintainer checking slice 10 reads (${run}), I want nothing written by a read.` });
    const intentId = /int_[A-Za-z0-9]{24}/.exec(reg.text)?.[0] ?? "";
    expect(intentId).not.toBe("");
    const id = await draft(K1, recipe("unwritten"));
    const [i0] = await sql`SELECT last_used_at FROM claimnet.intents WHERE id = ${intentId}`;
    const [t0] = await sql`SELECT updated_at, created_at, draft_state FROM claimnet.traces WHERE id = ${id}::uuid`;
    await queue(pat);
    await queue(pat, "is:expired");
    await mcp(K1, "get_recipes", { recipe_ids: id });
    await call(pat, "GET", `/traces/${id}`);
    const [i1] = await sql`SELECT last_used_at FROM claimnet.intents WHERE id = ${intentId}`;
    const [t1] = await sql`SELECT updated_at, created_at, draft_state FROM claimnet.traces WHERE id = ${id}::uuid`;
    expect(i1?.["last_used_at"]).toEqual(i0?.["last_used_at"]);
    expect(t1).toEqual(t0);
  });
});
