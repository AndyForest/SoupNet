import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { seedVerifiedUser } from "../test-users";

/**
 * Layer 3: read paths for reports (drafts-and-triage slice 9). Each test
 * names its rubric row (docs/planning/drafts-and-triage-build.md §Slice 9
 * rubric).
 *
 * Cast: Pat (the reader), Sam (a member of Pat's second book, who leaves a
 * draft there Pat may not read), Olive (an outsider with her own intent and
 * feedback). Pat's books: A (personal) and B. Keys: K1 reads A only, K2 reads
 * A and B, H is a headless key with K2's books.
 *
 * Deposits go through the MCP tool, feedback through POST /feedback, as an
 * agent would. Two rows of state are seeded directly because no request
 * produces them on demand: intent_shown entries (a check records whatever its
 * results were) and nothing else; everything else is read back only.
 *
 * Requires a running backend (BACKEND_URL) and its database; skipped otherwise.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "report-paths-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const RANDOM_UUID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const RANDOM_INTENT = "int_AAAAAAAAAAAAAAAAAAAAAAAA";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }
type Json = Record<string, unknown>;

interface FeedbackRow extends Json { id: string; traceId: string | null; searchId: string | null; briefingId: string | null; intentId: string | null; relatedTraceIds: string[] | null; createdAt: string }
interface ListPage<T> { items: T[]; total: number; page: number; perPage: number; totalPages: number }
interface IntentSummary { id: string; story: string; agentId: string | null; apiKeyLabel: string | null; counts: { shown: number; deposits: number; feedback: number } }
type Lineage = { type: "shown"; traceId: string; at: string } | { type: "deposit"; traceId: string; at: string; draftState: string | null } | { type: "feedback"; at: string; feedback: FeedbackRow };

let n = 0;
function recipe(topic: string): string {
  n += 1;
  return `As a report-path tester working on ${topic} (${run}-${n}), I prefer reports that read only my own rows so that a fleet report never shows someone else's work.`;
}
const EVIDENCE = `The operator asked for reports on the fleet.\n> "a read path for intent, feedback sounds very useful for creating reports"\n-- report-read-paths.test.ts, ${run}`;

describe.skipIf(!BASE || !canConnect())("read paths for reports (drafts-and-triage slice 9)", { timeout: 120_000 }, () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let olive: Actor;
  const bookB = { id: "", slug: "" };
  let K1 = "";
  let K2 = "";
  let H = "";
  let S = "";
  let O = "";
  let intent = "";
  let oliveIntent = "";
  let depositIntent = "";
  const deposits: Record<string, string> = {};
  let rA = "";
  let rB = "";
  let rC = "";
  let samDraft = "";
  let searchId = "";
  const fb: Record<string, string> = {};

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function login(email: string): Promise<string> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
    });
    return ((await res.json()) as { data?: { token?: string } }).data?.token ?? "";
  }
  async function register(label: string): Promise<Actor> {
    const email = `test-reports-${label}-${run}@test.local`;
    await seedVerifiedUser(email, PASSWORD);
    const jwt = await login(email);
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data?: Array<{ id: string; organization_id: string }> }).data ?? [];
    return { email, jwt, userId: me.data?.user?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }
  async function mintKey(actor: Actor, books: string[], label: string, extra: Json = {}): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: books, writeRecipeBookIds: books, defaultWriteRecipeBookId: books[0],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), label, ...extra,
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
  async function deposit(key: string, book: string, extra: Json = {}): Promise<string> {
    const r = await mcp(key, "check_recipe", { recipe: recipe(`book ${book}`), supporting_evidence: EVIDENCE, recipe_book: book, response_format: "structured", ...extra });
    const id = String(((r.structured?.["checked"] as Json | undefined) ?? {})["recipeId"] ?? "");
    if (!id) throw new Error(`deposit failed: ${r.text}`);
    return id;
  }
  async function registerIntent(key: string, story: string): Promise<string> {
    const r = await mcp(key, "get_briefing", { intent: story });
    const id = /int_[A-Za-z0-9]{24}/.exec(r.text)?.[0] ?? "";
    if (!id) throw new Error(`intent registration failed: ${r.text.slice(0, 200)}`);
    return id;
  }
  async function postFeedback(key: string, row: Json): Promise<string> {
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        kind: "check-feedback", impact: "subtle", disposition: "proceeded", story_fulfilled: "yes",
        story: `As a report-path tester (${run}), I checked this so that the report has a row.`, ...row,
      }),
    });
    const body = (await res.json()) as { data?: { results?: Array<{ ok: boolean; feedbackId?: string; error?: string }> } };
    const r = body.data?.results?.[0];
    if (!r?.ok || !r.feedbackId) throw new Error(`feedback failed: ${res.status} ${JSON.stringify(body)}`);
    return r.feedbackId;
  }
  function get(key: string, path: string): Promise<Response> {
    return fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  }
  async function rows(key: string, qs = ""): Promise<ListPage<FeedbackRow>> {
    const res = await get(key, `/feedback/rows${qs ? `?${qs}` : ""}`);
    expect(res.status, `/feedback/rows?${qs}`).toBe(200);
    return ((await res.json()) as { data: ListPage<FeedbackRow> }).data;
  }
  async function intentList(key: string, qs = ""): Promise<ListPage<IntentSummary>> {
    const res = await get(key, `/intents${qs ? `?${qs}` : ""}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: ListPage<IntentSummary> }).data;
  }
  async function intentDetail(key: string, id: string, qs = ""): Promise<{ intent: IntentSummary; lineage: Lineage[] } & ListPage<never>> {
    const res = await get(key, `/intents/${id}${qs ? `?${qs}` : ""}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { intent: IntentSummary; lineage: Lineage[] } & ListPage<never> }).data;
  }
  const ids = (page: ListPage<FeedbackRow>): string[] => page.items.map((r) => r.id);

  // ── fixtures ──────────────────────────────────────────────────────────────

  beforeAll(async () => {
    sql = postgres(process.env["DATABASE_URL"] ?? {
      host: process.env["PGHOST"], port: Number(process.env["PGPORT"] ?? 5432),
      user: process.env["PGUSER"], password: process.env["PGPASSWORD"], database: process.env["PGDATABASE"],
    } as never, { max: 2 });

    [pat, sam, olive] = await Promise.all([register("pat"), register("sam"), register("olive")]);
    bookB.slug = `reports-b-${run}`;
    const created = await call(pat, "POST", "/recipe-books", { name: `Reports B ${run}`, slug: bookB.slug, organizationId: pat.orgId });
    bookB.id = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!bookB.id) throw new Error(`book create failed: ${created.status} ${JSON.stringify(pat)}`);
    const added = await call(pat, "POST", `/recipe-books/${bookB.id}/members`, { email: sam.email, role: "member" });
    if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);

    K1 = await mintKey(pat, [pat.personalBookId], "k1-a-only");
    K2 = await mintKey(pat, [pat.personalBookId, bookB.id], "k2-a-and-b");
    H = await mintKey(pat, [pat.personalBookId, bookB.id], "h-headless", { depositLevel: "drafts" });
    S = await mintKey(sam, [bookB.id], "sam-b");
    O = await mintKey(olive, [olive.personalBookId], "olive");

    intent = await registerIntent(K2, `As a report-path tester (${run}), I want my agent to log feedback so that a report can read it.`);
    oliveIntent = await registerIntent(O, `As an outsider (${run}), I want my own intent so that nobody else reads it.`);

    rA = await deposit(K2, pat.personalBookId);
    rB = await deposit(K2, bookB.id);
    rC = await deposit(K2, pat.personalBookId);
    samDraft = await deposit(S, bookB.id, { draft: true });
    const oliveRecipe = await deposit(O, olive.personalBookId);

    const search = await fetch(`${BASE}/check?key=${encodeURIComponent(K2)}&filter=${encodeURIComponent(`report path ${run}`)}&format=json`);
    searchId = ((await search.json()) as { data?: { searchId?: string } }).data?.searchId ?? "";
    if (!searchId) throw new Error("search failed to return a searchId");

    // Ordered, so createdAt order is known: fA, fB, fS, fRel.
    fb["A"] = await postFeedback(K2, { trace_id: rA, intent_id: intent, agent_id: `agent-x-${run}` });
    fb["B"] = await postFeedback(K2, { trace_id: rB, intent_id: intent, agent_id: `agent-y-${run}` });
    fb["S"] = await postFeedback(K2, { search_id: searchId, intent_id: intent, agent_id: `agent-x-${run}` });
    fb["Rel"] = await postFeedback(K1, { trace_id: rA, related_trace_ids: [rB, samDraft], note: "related" });
    fb["Olive"] = await postFeedback(O, { trace_id: oliveRecipe, intent_id: oliveIntent });
    // Olive carries Pat's intent id: join-only capture never checks ownership,
    // so the read must (S9-I3, the lineage is Pat's rows only).
    fb["OliveOnPats"] = await postFeedback(O, { trace_id: oliveRecipe, intent_id: intent });

    // Deposits under their own intent (slice 6a writes traces.intent_id at
    // deposit), so the exact shown counts above are not disturbed.
    depositIntent = await registerIntent(K2, `As a report-path tester (${run}), I want my deposits counted so that a report shows them.`);
    deposits["A"] = await deposit(K2, pat.personalBookId, { intent: depositIntent });
    deposits["B"] = await deposit(K2, bookB.id, { intent: depositIntent });
    deposits["draft"] = await deposit(K2, pat.personalBookId, { intent: depositIntent, draft: true });

    // The human-origin row: Pat re-files rC into B on the web.
    const moved = await call(pat, "PATCH", `/traces/${rC}`, { groupId: bookB.id });
    if (!moved.ok) throw new Error(`move failed: ${moved.status}`);
    const human = await sql`SELECT id::text AS id FROM claimnet.check_feedback WHERE trace_id = ${rC}::uuid AND actor_user_id = ${pat.userId}::uuid`;
    fb["Human"] = String(human[0]?.["id"] ?? "");
    if (!fb["Human"]) throw new Error("re-filing wrote no feedback row");

    // Delivery ledger: what a check under the intent would have recorded.
    await sql`INSERT INTO claimnet.intent_shown (intent_id, trace_id, shown_at) VALUES
      (${intent}, ${rA}::uuid, NOW() - interval '3 minutes'),
      (${intent}, ${rB}::uuid, NOW() - interval '2 minutes'),
      (${intent}, ${samDraft}::uuid, NOW() - interval '1 minute')`;
  }, 120_000);

  afterAll(async () => { await sql?.end(); });

  // ── intents ───────────────────────────────────────────────────────────────

  it("S9-I1: lists the caller's user's intents only, newest first, with counts", async () => {
    const page = await intentList(K2);
    const listed = page.items.map((i) => i.id);
    expect(listed).toContain(intent);
    expect(listed).not.toContain(oliveIntent);
    const mine = page.items.find((i) => i.id === intent)!;
    expect(mine.apiKeyLabel).toBe("k2-a-and-b");
    // shown: rA, rB (Sam's draft is not Pat's to read); feedback: fA, fB, fS (fRel carries no intent; Olive's row is not Pat's).
    expect(mine.counts).toEqual({ shown: 2, deposits: 0, feedback: 3 });
    const created = page.items.map((i) => (i as unknown as { createdAt: string }).createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });

  it("S9-I1/S9-S2: an intent is listed for every key of the user; recipe-naming counts follow the key's books", async () => {
    const mine = (await intentList(K1)).items.find((i) => i.id === intent)!;
    // K1 reads A only: shown rA; feedback fA and fS (a search names no recipe).
    expect(mine.counts).toEqual({ shown: 1, deposits: 0, feedback: 2 });
  });

  it("S9-I2: the lineage is oldest first; recipes deposited without the intent are not its deposits", async () => {
    const d = await intentDetail(K2, intent);
    expect(d.intent.id).toBe(intent);
    expect(d.total).toBe(5);
    const at = d.lineage.map((e) => e.at);
    expect([...at].sort()).toEqual(at);
    expect(d.lineage.filter((e) => e.type === "shown").map((e) => (e as { traceId: string }).traceId)).toEqual([rA, rB]);
    expect(d.lineage.filter((e) => e.type === "feedback").map((e) => (e as { feedback: FeedbackRow }).feedback.id)).toEqual([fb["A"], fb["B"], fb["S"]]);
    expect(d.lineage.some((e) => (e as { type: string }).type === "deposit")).toBe(false);
  });

  it("S9-I4: deposits under an intent are counted and listed, under the key's books, with the draft state the viewer may see", async () => {
    const k2 = await intentDetail(K2, depositIntent);
    expect(k2.intent.counts.deposits).toBe(3);
    const k2Deposits = k2.lineage.filter((e) => e.type === "deposit") as Array<{ traceId: string; draftState: string | null }>;
    expect(k2Deposits.map((e) => e.traceId)).toEqual([deposits["A"], deposits["B"], deposits["draft"]]);
    expect(k2Deposits.map((e) => e.draftState)).toEqual([null, null, "unverified"]);

    const k1 = await intentDetail(K1, depositIntent);
    expect(k1.intent.counts.deposits).toBe(2);
    expect(k1.lineage.filter((e) => e.type === "deposit").map((e) => (e as { traceId: string }).traceId)).toEqual([deposits["A"], deposits["draft"]]);
    expect((await intentList(K1)).items.find((i) => i.id === depositIntent)?.counts.deposits).toBe(2);
  });

  it("S9-I2: the lineage pages", async () => {
    const p1 = await intentDetail(K2, intent, "per_page=2");
    const p3 = await intentDetail(K2, intent, "per_page=2&page=3");
    expect(p1.lineage).toHaveLength(2);
    expect(p3.lineage).toHaveLength(1);
    expect(p1.totalPages).toBe(3);
  });

  it("S9-I3: another user's intent, an unknown id, and a malformed id are the same 404, and touch nothing", async () => {
    const before = await sql`SELECT last_used_at FROM claimnet.intents WHERE id = ${oliveIntent}`;
    const answers = await Promise.all([oliveIntent, RANDOM_INTENT, "not-an-intent"].map(async (id) => {
      const res = await get(K2, `/intents/${id}`);
      return { status: res.status, body: await res.text() };
    }));
    for (const a of answers) {
      expect(a.status).toBe(404);
      expect(a.body).toBe(answers[0]!.body);
    }
    expect(JSON.parse(answers[0]!.body)).toEqual({ ok: false, error: "Intent not found" });
    const after = await sql`SELECT last_used_at FROM claimnet.intents WHERE id = ${oliveIntent}`;
    expect(String(after[0]?.["last_used_at"])).toBe(String(before[0]?.["last_used_at"]));
  });

  // ── feedback rows ─────────────────────────────────────────────────────────

  it("S9-F1: lists the caller's user's rows, newest first, from every key of theirs and the human row", async () => {
    const page = await rows(K2);
    const listed = ids(page);
    for (const k of ["A", "B", "S", "Rel", "Human"]) expect(listed, k).toContain(fb[k]);
    expect(listed).not.toContain(fb["Olive"]);
    expect(listed).not.toContain(fb["OliveOnPats"]);
    const created = page.items.map((r) => r.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });

  it("S9-F1: each filter alone and combined", async () => {
    expect(ids(await rows(K2, `intent_id=${intent}`)).sort()).toEqual([fb["A"], fb["B"], fb["S"]].sort());
    expect(ids(await rows(K2, `trace_id=${rA}`)).sort()).toEqual([fb["A"], fb["Rel"]].sort());
    expect(ids(await rows(K2, `recipe_id=${rA}`)).sort()).toEqual([fb["A"], fb["Rel"]].sort());
    expect(ids(await rows(K2, `search_id=${searchId}`))).toEqual([fb["S"]]);
    expect(ids(await rows(K2, `agent_id=agent-x-${run}`)).sort()).toEqual([fb["A"], fb["S"]].sort());
    expect(ids(await rows(K2, `recipe_book=${bookB.slug}`)).sort()).toEqual([fb["B"], fb["Human"]].sort());
    expect(ids(await rows(K2, `recipe_book=${bookB.id}`)).sort()).toEqual([fb["B"], fb["Human"]].sort());
    expect(ids(await rows(K2, `intent_id=${intent}&agent_id=agent-x-${run}`)).sort()).toEqual([fb["A"], fb["S"]].sort());
  });

  it("S9-F1: since is inclusive and composes", async () => {
    const all = await rows(K2, `intent_id=${intent}`);
    const newest = all.items[0]!;
    const since = await rows(K2, `intent_id=${intent}&since=${encodeURIComponent(newest.createdAt)}`);
    expect(ids(since)).toContain(newest.id);
    expect((await rows(K2, "since=2999-01-01")).total).toBe(0);
  });

  it("S9-F2: a row carries every field the per-recipe route gives, with the same values, plus its target", async () => {
    const perRecipe = (await (await call(pat, "GET", `/traces/${rA}/feedback`)).json()) as { data: { feedback: Json[] } };
    const web = perRecipe.data.feedback.find((r) => r["id"] === fb["A"])!;
    const listed = (await rows(K2, `trace_id=${rA}`)).items.find((r) => r.id === fb["A"])!;
    for (const [k, v] of Object.entries(web)) {
      expect(listed, k).toHaveProperty(k);
      if (k === "createdAt") expect(new Date(String(listed[k])).getTime()).toBe(new Date(String(v)).getTime());
      else expect(listed[k], k).toEqual(v);
    }
    expect(listed.traceId).toBe(rA);
    expect(listed.searchId).toBeNull();
    expect(listed.intentId).toBe(intent);
  });

  it("S9-F3: a foreign or unknown filter value is the empty page, the same as one that never existed", async () => {
    for (const qs of [`intent_id=${oliveIntent}`, `intent_id=${RANDOM_INTENT}`, `trace_id=${samDraft}`, `trace_id=${RANDOM_UUID}`,
      `recipe_book=${olive.personalBookId}`, `recipe_book=no-such-book-${run}`, `search_id=${RANDOM_UUID}`]) {
      const page = await rows(K2, qs);
      expect(page.total, qs).toBe(0);
      expect(page.items, qs).toEqual([]);
    }
  });

  it("S9-F1: pages are stable and cover the rows once", async () => {
    const all = await rows(K2, `intent_id=${intent}`);
    const p1 = await rows(K2, `intent_id=${intent}&per_page=2`);
    const p2 = await rows(K2, `intent_id=${intent}&per_page=2&page=2`);
    expect(p1.totalPages).toBe(2);
    expect([...ids(p1), ...ids(p2)]).toEqual(ids(all));
  });

  // ── scope ─────────────────────────────────────────────────────────────────

  it("S9-S2: a row about a recipe outside the key's books is not listed; related ids follow the read rule", async () => {
    const k1 = ids(await rows(K1));
    expect(k1).toContain(fb["A"]);
    expect(k1).toContain(fb["S"]);
    expect(k1).not.toContain(fb["B"]);
    expect(k1).not.toContain(fb["Human"]);

    const relK2 = (await rows(K2, `trace_id=${rA}`)).items.find((r) => r.id === fb["Rel"])!;
    expect(relK2.relatedTraceIds).toEqual([rB]); // Sam's draft dropped
    const relK1 = (await rows(K1, `trace_id=${rA}`)).items.find((r) => r.id === fb["Rel"])!;
    expect(relK1.relatedTraceIds).toEqual([]); // B is outside K1
  });

  it("S9-S1: no Bearer header, a bad key, an expired key, and a JWT are 401 on every path", async () => {
    const expired = await mintKey(pat, [pat.personalBookId], "expired");
    // Expiry is set directly: the mint refuses a past expiry, and waiting is not a test.
    await sql`UPDATE claimnet.api_keys SET expires_at = NOW() - interval '1 minute' WHERE label = 'expired' AND user_id = ${pat.userId}::uuid`;
    for (const path of ["/intents", `/intents/${intent}`, "/feedback/rows"]) {
      expect((await fetch(`${BASE}${path}`)).status, path).toBe(401);
      expect((await get("cn_s_notARealKey000000000000000000", path)).status, path).toBe(401);
      expect((await get(expired, path)).status, path).toBe(401);
      expect((await get(pat.jwt, path)).status, path).toBe(401);
    }
  });

  it("S9-I1: an intent registered on a check, not a briefing, is listed too", async () => {
    const qs = new URLSearchParams({
      key: K2, format: "json", recipe: recipe("intent on a check"), evidence: EVIDENCE,
      intent: `As a report-path tester (${run}), I register this intent on a check so that a report lists it.`,
    });
    const res = await fetch(`${BASE}/check?${qs.toString()}`);
    const viaCheck = ((await res.json()) as { data?: { intentId?: string } }).data?.intentId ?? "";
    expect(viaCheck).toMatch(/^int_[A-Za-z0-9]{24}$/);
    expect((await intentList(K2)).items.map((i) => i.id)).toContain(viaCheck);
  });

  it("S9-W1: the detail page's feedback rows say whether each is the viewer's own, so only those intents are linked", async () => {
    const asSam = (await (await call(sam, "GET", `/traces/${rB}/feedback`)).json()) as { data: { feedback: Array<{ id: string; isMine: boolean; intentId: string | null }> } };
    const patsRow = asSam.data.feedback.find((r) => r.id === fb["B"])!;
    expect(patsRow.intentId).toBe(intent);
    expect(patsRow.isMine).toBe(false);
    const asPat = (await (await call(pat, "GET", `/traces/${rB}/feedback`)).json()) as { data: { feedback: Array<{ id: string; isMine: boolean }> } };
    expect(asPat.data.feedback.find((r) => r.id === fb["B"])!.isMine).toBe(true);
  });

  it("S9-S3: a headless key reads exactly what an ordinary key of the same books reads", async () => {
    const strip = (v: unknown) => JSON.stringify(v);
    expect(strip(await rows(H))).toBe(strip(await rows(K2)));
    expect(strip(await intentList(H))).toBe(strip(await intentList(K2)));
    expect(strip(await intentDetail(H, intent))).toBe(strip(await intentDetail(K2, intent)));
  });

  // ── parameters ────────────────────────────────────────────────────────────

  it("S9-P1: unknown, repeated, and unparseable parameters are one 400 naming each", async () => {
    const res = await get(K2, `/feedback/rows?intentid=${intent}&per_page=0&since=yesterday&key=x`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: string[] };
    expect(body.fields.sort()).toEqual(["intentid", "key", "per_page", "since"]);
    expect(body.error).toContain("Authorization: Bearer");
    expect((await get(K2, "/intents?intent_id=x")).status).toBe(400);
    expect((await get(K2, `/intents/${intent}?page=1&page=2`)).status).toBe(400);
  });

  it("S9-F4: the URL-built write form still records a row", async () => {
    const qs = new URLSearchParams({
      key: K2, trace_id: rA, kind: "check-feedback", impact: "none", disposition: "proceeded", story_fulfilled: "unknown",
      story: `As a report-path tester (${run}), I check the write form still writes.`, format: "json",
    });
    const res = await fetch(`${BASE}/feedback?${qs.toString()}`);
    expect(res.status).toBe(200);
  });

  // ── web ───────────────────────────────────────────────────────────────────

  it("S9-W2: the web route reads the person's intent by the person's rule, with the uniform 404", async () => {
    const res = await call(pat, "GET", `/me/intents/${intent}`);
    expect(res.status).toBe(200);
    const d = ((await res.json()) as { data: { intent: IntentSummary; lineage: Lineage[] } }).data;
    expect(d.intent.counts).toEqual({ shown: 2, deposits: 0, feedback: 3 });
    const answers = await Promise.all([oliveIntent, RANDOM_INTENT, "nope"].map(async (id) => {
      const r = await call(pat, "GET", `/me/intents/${id}`);
      return { status: r.status, body: await r.text() };
    }));
    for (const a of answers) {
      expect(a.status).toBe(404);
      expect(a.body).toBe(answers[0]!.body);
    }
  });

  it("S9-F1 (with 8a): a row about a briefing and an outcome row naming only its intent are listed for every key, with their target", async () => {
    const own = await registerIntent(K2, `As a report-path tester (${run}), I log a briefing row and an outcome row so that a report reads them.`);
    const brief = await fetch(`${BASE}/briefing?intent=${own}`, { headers: { Authorization: `Bearer ${K2}` } });
    const briefingId = ((await brief.json()) as { data?: { briefingId?: string } }).data?.briefingId ?? "";
    expect(briefingId).toMatch(/^[0-9a-f-]{36}$/);
    fb["Brief"] = await postFeedback(K2, { briefing_id: briefingId, intent_id: own });
    fb["Outcome"] = await postFeedback(K2, { kind: "outcome", intent_id: own });

    // Neither names a recipe, so K1 (book A only) reads both, like a search row.
    const listed = await rows(K1, `intent_id=${own}`);
    expect(ids(listed).sort()).toEqual([fb["Brief"], fb["Outcome"]].sort());
    const b = listed.items.find((r) => r.id === fb["Brief"])!;
    const o = listed.items.find((r) => r.id === fb["Outcome"])!;
    expect([b.traceId, b.searchId, b.briefingId]).toEqual([null, null, briefingId]);
    expect([o.traceId, o.searchId, o.briefingId, o.intentId]).toEqual([null, null, null, own]);
    expect((await intentDetail(K1, own)).intent.counts.feedback).toBe(2);
  });

  // ── export ────────────────────────────────────────────────────────────────

  it("S9-E1/S9-E2: the export carries the user's intents and feedback rows, and imports", async () => {
    const res = await call(pat, "GET", "/auth/me/export");
    expect(res.status).toBe(200);
    const text = await res.text();
    const exported = JSON.parse(text) as { schemaVersion: number; intents: Array<{ id: string }>; checkFeedback: Array<{ id: string; contentHash?: unknown }> };
    expect(exported.schemaVersion).toBe(1);
    expect(exported.intents.map((i) => i.id)).toContain(intent);
    expect(exported.intents.map((i) => i.id)).not.toContain(oliveIntent);
    const exportedIds = exported.checkFeedback.map((f) => f.id);
    for (const k of ["A", "B", "S", "Rel", "Human"]) expect(exportedIds, k).toContain(fb[k]);
    expect(exportedIds).not.toContain(fb["Olive"]);
    expect(exportedIds).not.toContain(fb["OliveOnPats"]);
    expect(exported.checkFeedback[0]).not.toHaveProperty("contentHash");
    expect(exported.checkFeedback.find((f) => f.id === fb["Brief"])).toHaveProperty("briefingId");
    expect(exported.checkFeedback.find((f) => f.id === fb["Outcome"])).toBeDefined();

    const imported = await fetch(`${BASE}/import?book_name=${encodeURIComponent(`Reimport ${run}`)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${olive.jwt}` }, body: text,
    });
    expect(imported.status, await imported.clone().text()).toBe(200);
  });
});
