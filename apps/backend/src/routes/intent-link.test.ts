import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";
import { getDb } from "../db";
import { authenticateKey } from "../authz";
import { searchWithoutLogging, submitAndSearch } from "../services/trace.service";
import { seedVerifiedUser } from "../test-users";

/**
 * Layer 3: the recipe-to-intent link (drafts-and-triage slice 6a).
 *
 * Each test names its rubric row (docs/planning/drafts-and-triage-build.md
 * §Slice 6a rubric) and, where one applies, its scenario
 * (docs/product-specs/drafts-and-triage.feature).
 *
 * Cast: Pat (the person), Sam (owns the shared book; his intent J1 is the
 * foreign id), Dana (a writer of the shared book who deposits on Pat's
 * behalf under her intent D1). Pat's intents: I1 and I2, and an empty one.
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL only reads state back.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "intent-link-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const MARKER = `intentmarker${run}`;
const RANDOM_INTENT = "int_Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

type Json = Record<string, unknown>;
interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }
interface QueueItem { id: string; intent: { id: string; story: string } | null; state: string }
interface QueueData { items: QueueItem[]; total: number; totalPages: number; order: string; notice?: string }

let n = 0;
function recipe(topic: string): string {
  n += 1;
  return `As a backend maintainer working on the intent link (${topic} ${run}-${n} ${MARKER}), I prefer each recipe to name its run so that an orchestrator polls exactly its own drafts.`;
}
function evidence(interpretation: string): string {
  return `${interpretation}\n> "quote ${run}-${n}"\n-- intent-link.test.ts, ${run}`;
}

describe.skipIf(!BASE || !canConnect())("the recipe-to-intent link (drafts-and-triage slice 6a)", () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let dana: Actor;
  const shared = { id: "", slug: "" };
  let patKey = "";
  let samKey = "";
  let danaKey = "";
  let I1 = "";
  let I2 = "";
  let EMPTY = "";
  let J1 = "";
  let D1 = "";
  const ids: Record<string, string> = {};

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-intent-${label}-${run}@test.local`;
    const jwt = ((await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string } }).data?.token ?? "";
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
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

  async function deposit(key: string, text: string, extra: Json = {}): Promise<Json> {
    const { structured } = await mcp(key, "check_recipe", {
      recipe: text, supporting_evidence: evidence("Could not ask: the person is away."), response_format: "structured", ...extra,
    });
    if (!structured) throw new Error("deposit failed");
    return structured;
  }
  const checkedId = (s: Json): string => ((s["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "");

  /** Register a fresh intent for this key from story text. */
  async function registerIntent(key: string, story: string): Promise<string> {
    const { text } = await mcp(key, "get_briefing", { intent: story });
    const id = /Intent registered: (int_[A-Za-z0-9]{24})/.exec(text)?.[1];
    if (!id) throw new Error("intent registration failed");
    return id;
  }

  /** MCP search_recipes (exclude-own default on). Results are clustered
   *  exemplars, so set assertions use `total` or the flat web list. */
  async function search(key: string, query: string): Promise<{ ids: string[]; total: number; data: Json; text: string }> {
    const { structured, text } = await mcp(key, "search_recipes", { query, response_format: "structured" });
    const data = (structured?.["data"] as Json | undefined) ?? structured ?? {};
    const results = (data["results"] as Array<{ recipeId: string }> | undefined) ?? [];
    return { ids: results.map((r) => r.recipeId), total: Number(data["totalResults"] ?? results.length), data, text };
  }

  /** /check?filter= as a flat list (clusters above the page size). */
  async function webSearch(key: string, filter: string): Promise<{ ids: string[]; body: Json }> {
    const qs = new URLSearchParams({ key, format: "json", filter, clusters: "100" });
    const body = (await (await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } })).json()) as Json;
    const data = (body["data"] as Json | undefined) ?? {};
    return { ids: ((data["results"] as Array<{ recipeId: string }> | undefined) ?? []).map((r) => r.recipeId), body };
  }

  async function queue(actor: { jwt: string }, q?: string): Promise<{ status: number; data: QueueData }> {
    const res = await call(actor, "GET", `/traces/drafts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    return { status: res.status, data: ((await res.json()) as { data: QueueData }).data };
  }

  async function intentOf(id: string): Promise<string | null> {
    const rows = await sql`SELECT intent_id FROM claimnet.traces WHERE id = ${id}::uuid`;
    return (rows[0]?.["intent_id"] as string | null) ?? null;
  }

  /** Replace what differs between two otherwise identical responses: the
   *  one intent id under comparison (never every int_ id, which would hide a
   *  third id leaking), per-call uuids, and timestamps. */
  function normalize(value: unknown, comparedIntent: string): string {
    return JSON.stringify(value)
      .split(comparedIntent).join("<compared-intent>")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<time>");
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
    const slug = `intent-shared-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `intent shared ${run}`, slug, organizationId: sam.orgId });
    shared.id = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    shared.slug = slug;
    for (const m of [pat, dana]) {
      const added = await call(sam, "POST", `/recipe-books/${shared.id}/members`, { email: m.email, role: "member" });
      if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);
    }
    patKey = await mintKey(pat, [shared.id, pat.personalBookId], shared.id);
    samKey = await mintKey(sam, [shared.id], shared.id);
    danaKey = await mintKey(dana, [shared.id], shared.id);

    // I1 is registered by the first check itself (decision 1); the rest by briefing.
    const first = await deposit(patKey, recipe("i1 first"), { intent: `As a developer choosing a cache strategy ${run}, I want both options built.`, draft: true, impact: "low", uncertainty: "low" });
    ids["i1a"] = checkedId(first);
    I1 = String(first["intentId"] ?? "");
    I2 = await registerIntent(patKey, `As a developer naming queue states ${run}, I want the field's words.`);
    EMPTY = await registerIntent(patKey, `As a developer with nothing deposited yet ${run}, I want a clean slate.`);
    J1 = await registerIntent(samKey, `As a book owner reviewing ${run}, I want my own run.`);
    D1 = await registerIntent(danaKey, `As a colleague backfilling Pat's calls ${run}, I want them reviewed.`);

    ids["i1c"] = checkedId(await deposit(patKey, recipe("i1 high"), { intent: I1, draft: true, impact: "high", uncertainty: "high" }));
    ids["none_b"] = checkedId(await deposit(patKey, recipe("ungrouped b"), { draft: true, impact: "high", uncertainty: "medium" }));
    ids["i2d"] = checkedId(await deposit(patKey, recipe("i2 medium"), { intent: I2, draft: true, impact: "medium", uncertainty: "medium" }));
    ids["none_e"] = checkedId(await deposit(patKey, recipe("ungrouped e"), { draft: true, impact: "low", uncertainty: "medium" }));
    ids["i1pub"] = checkedId(await deposit(patKey, recipe("i1 published"), { intent: I1 }));
    ids["j1pub"] = checkedId(await deposit(samKey, recipe("j1 published"), { intent: J1 }));
    ids["d1obo"] = checkedId(await deposit(danaKey, recipe("d1 on behalf"), { intent: D1, on_behalf_of: pat.email }));
    ids["unknown"] = checkedId(await deposit(patKey, recipe("unknown id"), { intent: RANDOM_INTENT }));
    ids["foreign"] = checkedId(await deposit(patKey, recipe("foreign id"), { intent: J1 }));
  }, 240_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── Storage and the one writer ───────────────────────────────────────────

  it("S6a-S2: a deposit links the intent the check resolved: registered from text on that check, or carried by id", async () => {
    expect(I1).toMatch(/^int_[A-Za-z0-9]{24}$/);
    expect(await intentOf(ids["i1a"]!)).toBe(I1);
    expect(await intentOf(ids["i1c"]!)).toBe(I1);
    expect(await intentOf(ids["i2d"]!)).toBe(I2);
    expect(await intentOf(ids["none_b"]!)).toBeNull();
  });

  it("S6a-S2: an unknown id and another person's id deposit unlinked", async () => {
    expect(await intentOf(ids["unknown"]!)).toBeNull();
    expect(await intentOf(ids["foreign"]!)).toBeNull();
    expect(await intentOf(ids["j1pub"]!)).toBe(J1);
  });

  it("S6a-S2: an oversize story and an over-budget registration deposit unlinked", async () => {
    const tooLong = `As a developer ${"x".repeat(10_001)}`;
    const oversize = await deposit(patKey, recipe("oversize story"), { intent: tooLong });
    expect(oversize["intentId"]).toBeUndefined();
    expect(await intentOf(checkedId(oversize))).toBeNull();
    // Over budget: the deposit path in-process with a registration budget of
    // one per hour, which Pat has already spent (envCapLocal reads the
    // environment at call time).
    const principal = await authenticateKey(getDb(), patKey);
    if (!principal) throw new Error("key did not authenticate");
    const saved = process.env["INTENT_RATE_LIMIT_HOURLY"];
    process.env["INTENT_RATE_LIMIT_HOURLY"] = "1";
    try {
      const text = recipe("over budget");
      const r = await submitAndSearch({ principal, traceText: text, evidenceFor: evidence("over budget"), intent: `As a developer over budget ${run}` });
      expect(r.intent?.budgetExceeded).toBe(true);
      expect(r.traceId).toBeTruthy();
      expect(await intentOf(r.traceId!)).toBeNull();
    } finally {
      if (saved === undefined) delete process.env["INTENT_RATE_LIMIT_HOURLY"];
      else process.env["INTENT_RATE_LIMIT_HOURLY"] = saved;
    }
  });

  it("S6a-S3: an identical repeat under another intent keeps the first link", async () => {
    const text = recipe("repeat");
    const firstId = checkedId(await deposit(patKey, text, { intent: I1 }));
    const again = checkedId(await deposit(patKey, text, { intent: I2 }));
    expect(again).toBe(firstId);
    expect(await intentOf(firstId)).toBe(I1);
  });

  it("S6a-S4: verifying a draft and moving a recipe leave the link as deposited", async () => {
    const draftId = checkedId(await deposit(patKey, recipe("verify me"), { intent: I1, draft: true }));
    expect((await call(pat, "PUT", `/traces/${draftId}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect(await intentOf(draftId)).toBe(I1);
    const movedId = checkedId(await deposit(patKey, recipe("move me"), { intent: I1 }));
    expect((await call(pat, "PATCH", `/traces/${movedId}`, { groupId: pat.personalBookId })).status).toBe(200);
    expect(await intentOf(movedId)).toBe(I1);
  });

  // ── The qualifier ────────────────────────────────────────────────────────

  it("S6a-Q2 / S6a-Q4: intent:I1 returns only I1's recipes, Pat's own included without author:me", async () => {
    const r = (await webSearch(patKey, `intent:${I1}`)).ids;
    expect(r).toContain(ids["i1pub"]);
    expect(r).toContain(ids["i1a"]);
    expect(r).toContain(ids["i1c"]);
    for (const other of ["i2d", "none_b", "none_e", "j1pub"]) expect(r, other).not.toContain(ids[other]);
    // On MCP the exclude-own default is on, and intent: lifts it.
    const viaMcp = await search(patKey, `intent:${I1}`);
    expect(viaMcp.total).toBe(r.length);
    expect(r).toEqual(expect.arrayContaining(viaMcp.ids));
    expect((await search(patKey, `-author:me intent:${I1}`)).total).toBe(0);
  });

  it("S6a-Q3 / DT-OPT-01: is:draft intent:I1 is the orchestrator's exact poll, and the other qualifiers narrow it", async () => {
    const poll = await webSearch(patKey, `is:draft intent:${I1}`);
    expect(new Set(poll.ids)).toEqual(new Set([ids["i1a"], ids["i1c"]]));
    expect((await search(patKey, `is:draft intent:${I1}`)).total).toBe(2);
    expect((await webSearch(patKey, `is:draft intent:${I1} impact:high`)).ids).toEqual([ids["i1c"]]);
    expect((await webSearch(patKey, `is:draft intent:${I1} -uncertainty:high`)).ids).toEqual([ids["i1a"]]);
    expect((await webSearch(patKey, `-is:draft intent:${I1}`)).ids).not.toContain(ids["i1a"]);
    expect((await webSearch(patKey, `intent:${I1} author:${sam.email}`)).ids).toEqual([]);
    expect((await webSearch(patKey, `intent:${I1} before:2000-01-01`)).ids).toEqual([]);
    expect((await webSearch(patKey, `intent:${I1} "i1 high"`)).ids).toEqual([ids["i1c"]]);
  });

  it("S6a-Q2: with semantic text the qualifier only removes rows: the matching subsequence, same order and similarities", async () => {
    // The S3-G7 shape: the pipeline's own order, before any display
    // collapse (clustering and MMR pick from whatever candidates are present,
    // so a display list is not the layer this property is about): the search
    // service called directly with no size lever.
    const principal = await authenticateKey(getDb(), patKey);
    if (!principal) throw new Error("key did not authenticate");
    const flat = async (filter: string) => {
      const out: Array<{ id: string; sim: number | undefined }> = [];
      for (let page = 1; page <= 20; page++) {
        const r = await searchWithoutLogging({ principal, filter, page, perPage: 50 });
        out.push(...r.results.map((x) => ({ id: x.id, sim: x.semanticScore })));
        if (page >= r.totalPages) break;
      }
      return out;
    };
    const text = `orchestrator polls its own drafts ${MARKER}`;
    const all = await flat(text);
    const narrowed = await flat(`${text} intent:${I1}`);
    expect(narrowed.length).toBeGreaterThan(0);
    const kept = new Set(narrowed.map((x) => x.id));
    expect(narrowed).toEqual(all.filter((x) => kept.has(x.id)));
    for (const x of narrowed) expect(await intentOf(x.id)).toBe(I1);
  });

  it("S6a-Q5: another person's intent and a random id give Pat the same answer; his own empty intent no note", async () => {
    const foreign = await search(patKey, `intent:${J1}`);
    const random = await search(patKey, `intent:${RANDOM_INTENT}`);
    expect(foreign.total).toBe(0);
    expect(foreign.data["intentNotRecognized"]).toBe(true);
    expect(String(foreign.data["notice"])).toContain("the intent: id was not recognized (unknown or not yours, deliberately indistinguishable)");
    expect(normalize(foreign.data, J1)).toBe(normalize(random.data, RANDOM_INTENT));
    const fMd = (await mcp(patKey, "search_recipes", { query: `intent:${J1}` })).text;
    const rMd = (await mcp(patKey, "search_recipes", { query: `intent:${RANDOM_INTENT}` })).text;
    expect(normalize(fMd, J1)).toBe(normalize(rMd, RANDOM_INTENT));
    expect(fMd).toContain("the intent: id was not recognized");
    const webF = await webSearch(patKey, `intent:${J1}`);
    const webR = await webSearch(patKey, `intent:${RANDOM_INTENT}`);
    expect(normalize(webF.body, J1)).toBe(normalize(webR.body, RANDOM_INTENT));
    // The HTML page says it too, the same for both (the results section now
    // renders for an empty read-only search).
    const html = async (id: string) => (await (await fetch(`${BASE}/check?${new URLSearchParams({ key: patKey, filter: `intent:${id}` }).toString()}`, { headers: { Accept: "text/html" } })).text());
    const htmlF = await html(J1);
    const htmlR = await html(RANDOM_INTENT);
    expect(htmlF).toContain("the intent: id was not recognized (unknown or not yours, deliberately indistinguishable)");
    expect(normalize(htmlF, J1)).toBe(normalize(htmlR, RANDOM_INTENT));
    const empty = await search(patKey, `intent:${EMPTY}`);
    expect(empty.total).toBe(0);
    expect(empty.data["intentNotRecognized"]).toBeUndefined();
    expect(String(empty.data["notice"])).not.toContain("not recognized");
  });

  it("S6a-Q6: Dana finds her on-behalf draft under D1, Pat does not, and after Pat confirms it, it stays under D1", async () => {
    expect(await intentOf(ids["d1obo"]!)).toBe(D1);
    expect((await webSearch(danaKey, `intent:${D1}`)).ids).toEqual([ids["d1obo"]]);
    const patView = await search(patKey, `intent:${D1}`);
    expect(patView.total).toBe(0);
    expect(patView.data["intentNotRecognized"]).toBe(true);
    expect((await webSearch(samKey, `intent:${I1}`)).ids).toEqual([]);
    expect((await call(pat, "PUT", `/traces/${ids["d1obo"]}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect(await intentOf(ids["d1obo"]!)).toBe(D1);
    expect((await webSearch(danaKey, `intent:${D1}`)).ids).toEqual([ids["d1obo"]]);
    expect((await webSearch(patKey, `intent:${D1}`)).ids).toEqual([]);
  });

  it("S6a-Q7: remote MCP and /check?filter= return the same set; the HTML search help names intent:", async () => {
    const viaMcp = await search(patKey, `intent:${I2}`);
    const viaWeb = (await webSearch(patKey, `intent:${I2}`)).ids;
    expect(viaMcp.total).toBe(viaWeb.length);
    expect(new Set(viaMcp.ids)).toEqual(new Set(viaWeb));
    const html = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: patKey, filter: `intent:${I1}` }).toString()}`, { headers: { Accept: "text/html" } })).text();
    expect(html).toContain("<code>intent:int_&hellip;</code>");
  });

  it("S6a-Q9: searching by intent does not touch the intent's last_used_at", async () => {
    const before = (await sql`SELECT last_used_at FROM claimnet.intents WHERE id = ${I2}`)[0]?.["last_used_at"];
    await search(patKey, `intent:${I2}`);
    const after = (await sql`SELECT last_used_at FROM claimnet.intents WHERE id = ${I2}`)[0]?.["last_used_at"];
    expect(String(after)).toBe(String(before));
  });

  it("S6a-Q1: a malformed intent: value is a loud grammar error on the agent surfaces", async () => {
    const { text } = await mcp(patKey, "search_recipes", { query: "intent:As-a-developer" });
    expect(text).toContain("intent: takes an intent id (int_ and 24 letters or digits)");
  });

  // ── The review queue ─────────────────────────────────────────────────────

  it("S6a-G1 / S6a-G2 / DT-OPT-01: Pat's queue groups I1's drafts at the group's best position, carrying the story", async () => {
    const r = await queue(pat, `"${MARKER}"`);
    expect(r.status).toBe(200);
    expect(r.data.order).toBe("triage");
    const mine = r.data.items.filter((i) => ["i1a", "i1c", "none_b", "i2d", "none_e"].some((k) => ids[k] === i.id)).map((i) => i.id);
    // Triage alone: i1c (9), none_b (6), i2d (4), none_e (2), i1a (1); grouped, i1a joins i1c.
    expect(mine).toEqual([ids["i1c"], ids["i1a"], ids["none_b"], ids["i2d"], ids["none_e"]]);
    const i1c = r.data.items.find((i) => i.id === ids["i1c"])!;
    expect(i1c.intent).toEqual({ id: I1, story: `As a developer choosing a cache strategy ${run}, I want both options built.` });
    expect(r.data.items.find((i) => i.id === ids["none_b"])!.intent).toBeNull();
  });

  it("S6a-G1: a colleague's intent is never shown: Dana's on-behalf draft is ungrouped in Pat's queue and grouped in hers", async () => {
    const draftId = checkedId(await deposit(danaKey, recipe("d1 second"), { intent: D1, on_behalf_of: pat.email }));
    const patItem = (await queue(pat, `"${MARKER}"`)).data.items.find((i) => i.id === draftId);
    expect(patItem?.intent).toBeNull();
    expect(JSON.stringify((await queue(pat, `"${MARKER}"`)).data)).not.toContain(D1);
    // Dana's own queue lists drafts about her; a draft she deposited about Pat
    // reaches her through the id-list link (slice 4, S4-Q5), which carries
    // the intent the same way (S6a-G1).
    const linked = (await (await call(dana, "GET", `/traces/drafts?ids=${draftId}`)).json()) as { data: { items: QueueItem[] } };
    expect(linked.data.items.find((i) => i.id === draftId)?.intent?.id).toBe(D1);
    const patLinked = (await (await call(pat, "GET", `/traces/drafts?ids=${draftId}`)).json()) as { data: { items: QueueItem[] } };
    expect(patLinked.data.items.find((i) => i.id === draftId)?.intent).toBeNull();
  });

  it("S6a-G3: with semantic text, a group's members sit together on the page", async () => {
    const r = await queue(pat, `orchestrator drafts ${MARKER}`);
    expect(r.data.order).toBe("similarity");
    const groupOf = r.data.items.map((i) => i.intent?.id ?? `none:${i.id}`);
    for (const g of new Set(groupOf)) {
      const at = groupOf.flatMap((x, i) => (x === g ? [i] : []));
      expect(at[at.length - 1]! - at[0]!, g).toBe(at.length - 1);
    }
  });

  it("S6a-G4: intent:I1 in the queue lists only I1's drafts; a foreign or random id lists nothing with the same note", async () => {
    const only = await queue(pat, `intent:${I1}`);
    expect(new Set(only.data.items.map((i) => i.id))).toEqual(new Set([ids["i1a"], ids["i1c"]]));
    const foreign = await queue(pat, `intent:${J1}`);
    const random = await queue(pat, `intent:${RANDOM_INTENT}`);
    expect(foreign.data.items).toEqual([]);
    expect(foreign.data.notice).toContain("the intent: id was not recognized");
    expect(normalize(foreign.data, J1)).toBe(normalize(random.data, RANDOM_INTENT));
    expect((await queue(pat, `intent:${EMPTY}`)).data.notice).toBeUndefined();
  });

  // ── Export and import ────────────────────────────────────────────────────

  it("S6a-E1: the export carries the link only for the exporter's own intents", async () => {
    const exported = (await (await call(pat, "GET", "/auth/me/export")).json()) as { traces: Array<{ id: string; intentId?: string | null }> };
    const byId = new Map(exported.traces.map((t) => [t.id, t]));
    expect(byId.get(ids["i1pub"]!)?.intentId).toBe(I1);
    expect(byId.get(ids["none_b"]!)?.intentId).toBeNull();
    // Verified on Pat's side earlier (S6a-Q6): now Pat's recipe, still under Dana's D1.
    expect(byId.has(ids["d1obo"]!)).toBe(true);
    expect(byId.get(ids["d1obo"]!)?.intentId).toBeNull();
    expect(JSON.stringify(exported)).not.toContain(D1);
  });

  it("S6a-E2: import restores the link onto the importer's own intent and drops any other", async () => {
    const own = checkedId(await deposit(patKey, recipe("export own"), { intent: I2 }));
    const exported = (await (await call(pat, "GET", "/auth/me/export")).json()) as Json & { traces: Array<Json & { id: string }> };
    const row = exported.traces.find((t) => t.id === own)!;
    expect(row["intentId"]).toBe(I2);
    expect((await call(pat, "DELETE", `/traces/${own}`)).status).toBe(200);

    const foreignRow = { ...row, id: crypto.randomUUID(), claimText: recipe("import foreign"), claimTextHash: null, intentId: J1 };
    const randomRow = { ...row, id: crypto.randomUUID(), claimText: recipe("import random"), claimTextHash: null, intentId: RANDOM_INTENT };
    const garbledRow = { ...row, id: crypto.randomUUID(), claimText: recipe("import garbled"), claimTextHash: null, intentId: "not an id" };
    const file = { ...exported, traces: [row, foreignRow, randomRow, garbledRow], traceEvidence: [], evidence: [], traceReferences: [], references: [], evidenceReferences: [] };
    const res = await fetch(`${BASE}/import?book=${shared.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` },
      body: JSON.stringify(file),
    });
    expect(res.status).toBe(200);
    expect(await intentOf(own)).toBe(I2);
    for (const r of [foreignRow, randomRow, garbledRow]) {
      const exists = await sql`SELECT intent_id FROM claimnet.traces WHERE id = ${r.id}::uuid`;
      expect(exists.length, String(r.claimText)).toBe(1);
      expect(exists[0]?.["intent_id"]).toBeNull();
    }
    // Re-importing the same row: skipped as identical, and the stored link stays.
    const again = await fetch(`${BASE}/import?book=${shared.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` },
      body: JSON.stringify({ ...file, traces: [{ ...row, intentId: null }] }),
    });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { data?: { counts?: { traces?: { skippedIdentical?: number } } } };
    expect(againBody.data?.counts?.traces?.skippedIdentical).toBe(1);
    expect(await intentOf(own)).toBe(I2);
    // A non-string intentId is a row error, as for any optional string field.
    const bad = await fetch(`${BASE}/import?book=${shared.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` },
      body: JSON.stringify({ ...file, traces: [{ ...row, id: crypto.randomUUID(), claimText: recipe("import typed"), claimTextHash: null, intentId: 7 }] }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("intentId must be a string or null");
    // Sam importing Pat's file attaches nothing to Pat's intent either.
    const samRes = await fetch(`${BASE}/import?book=${shared.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sam.jwt}` },
      body: JSON.stringify({ ...file, traces: [{ ...row, id: crypto.randomUUID(), claimText: recipe("sam imports"), claimTextHash: null }] }),
    });
    expect(samRes.status).toBe(200);
    const samRows = await sql`SELECT intent_id FROM claimnet.traces WHERE user_id = ${sam.userId}::uuid AND intent_id IS NOT NULL AND intent_id <> ${J1}`;
    expect(samRows.length).toBe(0);
  });
});
