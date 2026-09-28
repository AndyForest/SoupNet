import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";

/**
 * Layer 3: drafts for the key's own user (drafts-and-triage slice 2).
 *
 * Each test names the rubric criterion (docs/planning/drafts-and-triage-build.md
 * §Slice 2 rubric) and the scenario (docs/product-specs/drafts-and-triage.feature).
 * The read-path ids (RP-*) are docs/planning/drafts-and-triage-read-paths.md.
 *
 * Cast (the feature file's vocabulary): Pat, whose agent deposits drafts; Sam,
 * a collaborator who OWNS the shared book (so the book-owner case of DT-VIS-15
 * is covered by the same actor). Uniform-response tests compare Sam's answer
 * for a real draft id with the answer for a random UUID, after replacing the
 * id, on every by-id surface.
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL is used only to read state back and, once, to plant a recipe
 * whose id shares a short-id prefix with a draft (no route can choose ids).
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "drafts-slice2-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
/** Appears only in the text and evidence of Pat's drafts. */
const MARKER = `draftmarker${run}`;
const RANDOM_UUID = "7c0f3a52-5b2e-4f5a-9d1e-2b4f6c8a0e13";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }

let n = 0;
function recipe(topic: string, extra = ""): string {
  n += 1;
  return `As a backend maintainer working on draft visibility (${topic} ${run}-${n}${extra}), I prefer drafts kept private until verified so that collaborators never read a hypothesis as a decision.`;
}
function evidence(quote: string): string {
  return `The test fixture says so.\n> "${quote}"\n-- drafts.test.ts, ${run}`;
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe.skipIf(!BASE || !canConnect())("drafts for the key's own user (drafts-and-triage slice 2)", () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let shared = { id: "", slug: "" };
  let patKey = ""; // scoped: [shared, personal], default shared
  let patNoSharedKey = ""; // scoped: [personal] only (DT-VIS-07)
  let samKey = ""; // scoped: [shared, personal], default personal (Sam's probes never land in the shared book)
  let draftId = ""; // Pat's main draft in the shared book, rated impact high
  let draftText = "";
  const draftQuote = `the person has not said ${MARKER} yet`;

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-drafts-${label}-${run}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
    });
    const vtok = ((await reg.json()) as { data?: { verificationToken?: string } }).data?.verificationToken;
    if (!vtok) throw new Error(`register failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: vtok }) });
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const lb = (await login.json()) as { data?: { token?: string; user?: { id: string } } };
    const jwt = lb.data?.token ?? "";
    const userId = lb.data?.user?.id ?? "";
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId, personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }

  async function mintScopedKey(actor: Actor, bookIds: string[], defaultBookId: string): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: bookIds,
      writeRecipeBookIds: bookIds,
      defaultWriteRecipeBookId: defaultBookId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }

  /** MCP tools/call: the text content, the structured content, and the raw body. */
  async function mcp(key: string, name: string, args: Record<string, unknown>): Promise<{ text: string; structured: Record<string, unknown> | undefined; raw: string }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> } };
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent, raw };
  }

  async function checkJson(key: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({ key, format: "json", ...params });
    const res = await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
    const body = (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string };
    if (!body.ok) throw new Error(`check failed: ${JSON.stringify(body)}`);
    return body.data ?? {};
  }

  async function deposit(key: string, text: string, quote: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const { structured } = await mcp(key, "check_recipe", {
      recipe: text, supporting_evidence: evidence(quote), response_format: "structured", ...extra,
    });
    if (!structured) throw new Error("deposit failed");
    return structured;
  }

  const checkedId = (s: Record<string, unknown>): string => ((s["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "");

  async function traceRow(id: string): Promise<Record<string, unknown> | undefined> {
    const rows = await sql`SELECT draft_state, draft_resolved_at, draft_resolved_by_user_id, draft_resolved_by_key_id, impact, claim_text, decided_at, group_id FROM claimnet.traces WHERE id = ${id}::uuid`;
    return rows[0] as Record<string, unknown> | undefined;
  }

  /** The Index line under the shared book's bullet in a briefing. */
  function sharedIndexLine(text: string): string {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.includes(shared.slug));
    return lines.slice(at + 1, at + 4).find((l) => l.includes("Index:")) ?? "";
  }

  /** Sam's view of an id, with the id itself normalized out. */
  const norm = (text: string, id: string): string => text.split(id).join("<ID>").split(id.slice(0, 8)).join("<ID8>");

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
    const slug = `drafts-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `Drafts ${run}`, slug, organizationId: sam.orgId });
    shared = { id: ((await created.json()) as { data?: { id: string } }).data?.id ?? "", slug };
    if (!shared.id) throw new Error("book create failed");
    const added = await call(sam, "POST", `/recipe-books/${shared.id}/members`, { email: pat.email, role: "member" });
    if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);

    patKey = await mintScopedKey(pat, [shared.id, pat.personalBookId], shared.id);
    patNoSharedKey = await mintScopedKey(pat, [pat.personalBookId], pat.personalBookId);
    samKey = await mintScopedKey(sam, [shared.id, sam.personalBookId], sam.personalBookId);

    // Ordinary published recipes from both people, so the book has a corpus.
    await deposit(samKey, recipe("sam published one"), "sam said one", { recipe_book: shared.slug });
    await deposit(samKey, recipe("sam published two"), "sam said two", { recipe_book: shared.slug });
    await deposit(patKey, recipe("pat published"), "pat said so");
  }, 120_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── Baselines Sam sees BEFORE the draft lands (DT-VIS-02, DT-VIS-18) ─────

  let samIndexLineBefore = "";
  let samSearchTotalBefore = -1;
  let samMapTotalBefore = -1;

  it("baseline: Sam's Index line, search count, and map count before any draft", async () => {
    const briefing = await mcp(samKey, "get_briefing", {});
    samIndexLineBefore = sharedIndexLine(briefing.text);
    expect(samIndexLineBefore).toContain("3 recipes");
    const s = await checkJson(samKey, { filter: "draft visibility collaborators hypothesis", read_recipe_books: shared.slug });
    samSearchTotalBefore = Number(s["totalResults"]);
    const map = await jsonOf(await call(sam, "GET", `/traces/map?groupId=${shared.id}`));
    samMapTotalBefore = Number(((map["data"] as Record<string, unknown>)["meta"] as { totalTraces: number }).totalTraces);
    expect(samMapTotalBefore).toBe(3);
  });

  // ── S2-B1 / DT-VIS-01: depositing a draft ───────────────────────────────

  it("S2-B1 / DT-VIS-01 (remote MCP): draft=true stores an unverified draft about Pat, labelled, saying who can see it", async () => {
    draftText = recipe("the main draft", ` ${MARKER}`);
    const s = await deposit(patKey, draftText, draftQuote, { draft: true, impact: "high", uncertainty: "high" });
    draftId = checkedId(s);
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/);
    expect((s["checked"] as { draftState?: string }).draftState).toBe("unverified");
    expect(String(s["draftNotice"])).toContain("only you and your own agents");
    const row = await traceRow(draftId);
    expect(row?.["draft_state"]).toBe("unverified");
    expect(row?.["impact"]).toBe("high");
    // Deposited by Pat's key, about Pat (the author: ruling 9e663b62).
    const owner = await sql`SELECT user_id, api_key_id FROM claimnet.traces WHERE id = ${draftId}::uuid`;
    expect(owner[0]?.["user_id"]).toBe(pat.userId);
    // The markdown report says the same.
    const md = await mcp(patKey, "check_recipe", { recipe: recipe("markdown draft"), supporting_evidence: evidence("md"), draft: true });
    expect(md.text).toContain("Deposited as a draft");
  });

  it("S2-B1 (GET /check, format=json) and the HTML form: draft is accepted on the web surface too", async () => {
    const d = await checkJson(patKey, { trace: recipe("web draft"), ef: evidence("web"), draft: "true" });
    expect((d["checked"] as { draftState?: string }).draftState).toBe("unverified");
    const page = await (await fetch(`${BASE}/check?key=${encodeURIComponent(patKey)}`)).text();
    expect(page).toContain('name="draft"');
  });

  it("an unrecognized draft value never costs the check and is taken as a draft (the private side)", async () => {
    const { structured } = await mcp(patKey, "check_recipe", {
      recipe: recipe("wrong type draft"), supporting_evidence: evidence("wt"), draft: "maybe", response_format: "structured",
    });
    expect((structured!["checked"] as { draftState?: string }).draftState).toBe("unverified");
    expect(String(structured!["draftNotice"])).toContain("not true | false");
  });

  // ── S2-B2 / DT-VIS-02, DT-VIS-03: collaborators never see it ────────────

  it("S2-B2 / DT-VIS-02: Sam's check with the draft's exact text, and searches by text, quote, and author, never name it", async () => {
    // Sam's own recipe (the same text) lands in Sam's personal book; the
    // response echoes it, so the leak test is the draft's id and quote.
    const byCheck = await mcp(samKey, "check_recipe", { recipe: draftText, supporting_evidence: evidence("sam checks the same text"), clusters: 100, response_format: "structured" });
    expect(byCheck.raw).not.toContain(draftId);
    expect(byCheck.raw).not.toContain(draftQuote);
    for (const query of [draftText, `"${MARKER}"`, `author:${pat.email}`, `author:anyone "${MARKER}"`]) {
      const r = await mcp(samKey, "search_recipes", { query, response_format: "structured" });
      expect(r.raw, query).not.toContain(draftId);
    }
    const quoted = await checkJson(samKey, { filter: `"${MARKER}"`, read_recipe_books: shared.slug });
    expect(quoted["totalResults"]).toBe(0);
  });

  it("S2-B2 / DT-VIS-02: every count Sam sees equals the count without the draft", async () => {
    const s = await checkJson(samKey, { filter: "draft visibility collaborators hypothesis", read_recipe_books: shared.slug });
    // Nothing published has landed in the shared book since the baseline.
    expect(Number(s["totalResults"])).toBe(samSearchTotalBefore);
    const map = await jsonOf(await call(sam, "GET", `/traces/map?groupId=${shared.id}`));
    expect(((map["data"] as Record<string, unknown>)["meta"] as { totalTraces: number }).totalTraces).toBe(samMapTotalBefore);
    expect(JSON.stringify(map)).not.toContain(draftId);
  });

  it("S2-B2 / DT-VIS-03: the draft's evidence never surfaces as related evidence for Sam", { timeout: 240_000 }, async () => {
    // Slice 4: the wait was 80 s; under the full gate with the slice 4 suite
    // depositing alongside, the embedding worker's backlog (experimental
    // strategy backfills) twice kept this book's evidence pending past it.
    // The wait is now 200 s; the assertion is unchanged.
    // Wait for the evidence embeddings (the async worker, busy under the full
    // suite): the draft's, so a leak would show, and every other evidence
    // entry in the shared book, so the channel is live for the check below.
    let w: { draft_done: number; others_pending: number; others_done: number } | undefined;
    for (let i = 0; i < 400; i++) {
      const rows = await sql`
        SELECT
          count(*) FILTER (WHERE te.trace_id = ${draftId}::uuid AND ev.id IS NOT NULL)::int AS draft_done,
          count(*) FILTER (WHERE te.trace_id <> ${draftId}::uuid AND ev.id IS NULL)::int AS others_pending,
          count(*) FILTER (WHERE te.trace_id <> ${draftId}::uuid AND ev.id IS NOT NULL)::int AS others_done
        FROM claimnet.embedding_sources es
        JOIN claimnet.trace_evidence te ON te.evidence_id = es.source_id
        JOIN claimnet.traces t ON t.id = te.trace_id AND t.group_id = ${shared.id}::uuid
        JOIN claimnet.embedding_chunk_strategies ecs ON ecs.embedding_source_id = es.id
        JOIN claimnet.embedding_chunks ec ON ec.chunk_strategy_id = ecs.id
        LEFT JOIN claimnet.embedding_vectors ev ON ev.embedding_chunk_id = ec.id AND ev.status = 'complete'
        WHERE es.source_type = 'evidence'`;
      w = rows[0] as { draft_done: number; others_pending: number; others_done: number } | undefined;
      if (w && w.draft_done > 0 && w.others_pending === 0 && w.others_done > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // The poll must have seen the draft's own evidence embedded: otherwise
    // "never surfaces" below would pass without the draft ever being a
    // candidate (slice 4 verification follow-up).
    expect(w?.draft_done ?? 0, "the draft's evidence never embedded within the wait").toBeGreaterThan(0);
    expect(w?.others_done ?? 0, "no other evidence in the book embedded within the wait").toBeGreaterThan(0);
    const r = await mcp(samKey, "check_recipe", {
      recipe: recipe("related evidence probe"), supporting_evidence: evidence(draftQuote), clusters: 100, response_format: "structured",
    });
    // The channel is live (other recipes' evidence does come back), so the
    // absence below is meaningful.
    expect(((r.structured?.["relatedEvidence"] ?? []) as unknown[]).length).toBeGreaterThan(0);
    expect(r.raw).not.toContain(draftId);
    expect(r.raw).not.toContain(draftQuote);
  });

  // ── S2-B3 / DT-VIS-04, DT-VIS-05: uniform absence by id ─────────────────

  it("S2-B3 / DT-VIS-04: get_recipes (MCP) by full id and by 8-char prefix is the uniform marker", async () => {
    const real = await mcp(samKey, "get_recipes", { recipe_ids: draftId });
    const random = await mcp(samKey, "get_recipes", { recipe_ids: RANDOM_UUID });
    expect(norm(real.text, draftId)).toBe(norm(random.text, RANDOM_UUID));
    const prefix = await mcp(samKey, "get_recipes", { recipe_ids: draftId.slice(0, 8) });
    expect(prefix.text).toContain("not_found_or_unreadable");
  });

  it("S2-B3 / DT-VIS-04: GET /recipes?ids= is the uniform marker", async () => {
    const get = async (id: string) => {
      const res = await fetch(`${BASE}/recipes?ids=${id}`, { headers: { Authorization: `Bearer ${samKey}` } });
      return { status: res.status, body: await res.text() };
    };
    const real = await get(draftId);
    const random = await get(RANDOM_UUID);
    expect(real.status).toBe(random.status);
    expect(norm(real.body, draftId)).toBe(norm(random.body, RANDOM_UUID));
  });

  it("S2-B3 / DT-VIS-04: GET /traces/:id, its feedback, and PUT reaction are the same 404 as a missing id", async () => {
    for (const [method, suffix, body] of [["GET", "", undefined], ["GET", "/feedback", undefined], ["PUT", "/reaction", { reaction: "still_true" }]] as const) {
      const real = await call(sam, method, `/traces/${draftId}${suffix}`, body);
      const random = await call(sam, method, `/traces/${RANDOM_UUID}${suffix}`, body);
      expect(real.status, `${method} ${suffix}`).toBe(404);
      expect(random.status).toBe(404);
      expect(await real.text()).toBe(await random.text());
    }
    expect((await traceRow(draftId))?.["draft_state"]).toBe("unverified");
  });

  it("S2-B3 / DT-VIS-04: log_feedback, POST /feedback, and ride-along feedback about the draft get the uniform marker and store nothing", async () => {
    const row = (id: string) => ({ trace_id: id, kind: "check-feedback", impact: "none", disposition: "proceeded", story_fulfilled: "no", story: "As a tester, I probed a draft id." });
    const real = await mcp(samKey, "log_feedback", row(draftId));
    const random = await mcp(samKey, "log_feedback", row(RANDOM_UUID));
    expect(norm(real.text, draftId)).toBe(norm(random.text, RANDOM_UUID));
    const restReal = await fetch(`${BASE}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${samKey}` }, body: JSON.stringify(row(draftId)) });
    const restRandom = await fetch(`${BASE}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${samKey}` }, body: JSON.stringify(row(RANDOM_UUID)) });
    expect(restReal.status).toBe(restRandom.status);
    expect(norm(await restReal.text(), draftId)).toBe(norm(await restRandom.text(), RANDOM_UUID));
    const stored = await sql`SELECT count(*)::int AS n FROM claimnet.check_feedback WHERE trace_id = ${draftId}::uuid`;
    expect(Number(stored[0]?.["n"])).toBe(0);
  });

  it("S2-B3 / RP-22: Pat's agent may annotate its own draft; Sam starring that feedback row gets the missing-id 404", async () => {
    const logged = await mcp(patKey, "log_feedback", {
      trace_id: draftId, kind: "check-feedback", impact: "none", disposition: "deferred", story_fulfilled: "unknown",
      story: "As a tester, I annotated my own draft.",
    });
    expect(logged.text).toContain("Feedback recorded");
    const detail = await jsonOf(await call(pat, "GET", `/traces/${draftId}/feedback`));
    const feedbackId = ((detail["data"] as { feedback: Array<{ id: string }> }).feedback[0])?.id ?? "";
    expect(feedbackId).toMatch(/^[0-9a-f-]{36}$/);
    const real = await call(sam, "PUT", `/traces/feedback/${feedbackId}/star`);
    const random = await call(sam, "PUT", `/traces/feedback/${RANDOM_UUID}/star`);
    expect(real.status).toBe(404);
    expect(random.status).toBe(404);
    expect(await real.text()).toBe(await random.text());
  });

  it("S2-B3 / DT-VIS-04: get_briefing with recipe_ids naming the draft is the uniform marker", async () => {
    const real = await mcp(samKey, "get_briefing", { recipe_ids: draftId });
    const random = await mcp(samKey, "get_briefing", { recipe_ids: RANDOM_UUID });
    const section = (t: string) => t.slice(t.indexOf("## Requested recipes"));
    expect(norm(section(real.text), draftId)).toBe(norm(section(random.text), RANDOM_UUID));
    expect(real.text).not.toContain(MARKER);
  });

  it("S2-B3 / DT-VIS-05: a prefix shared with a visible recipe resolves to the visible one for Sam; Pat sees both", async () => {
    // Plant a published recipe whose id shares the draft's 8-char prefix.
    const twin = `${draftId.slice(0, 8)}-0000-4000-8000-${run.padEnd(12, "0").slice(0, 12).replace(/[^0-9a-f]/g, "0")}`;
    await sql`INSERT INTO claimnet.traces (id, user_id, group_id, claim_text) VALUES (${twin}::uuid, ${sam.userId}::uuid, ${shared.id}::uuid, ${"As a tester working on prefixes, I planted a visible twin so that prefix resolution can be checked."})`;
    const samView = await mcp(samKey, "get_recipes", { recipe_ids: draftId.slice(0, 8) });
    expect(samView.text).toContain(twin);
    expect(samView.text).not.toContain("ambiguous_prefix");
    expect(samView.text).not.toContain(draftId);
    const samFeedback = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${samKey}` },
      body: JSON.stringify({ trace_id: draftId.slice(0, 8), kind: "check-feedback", impact: "none", disposition: "proceeded", story_fulfilled: "no", story: "As a tester, I resolved a prefix." }),
    });
    const fbText = await samFeedback.text();
    expect(fbText).not.toContain(draftId);
    expect(fbText).toContain(twin);
    const patView = await mcp(patKey, "get_recipes", { recipe_ids: draftId.slice(0, 8) });
    expect(patView.text).toContain("ambiguous_prefix");
    expect(patView.text).toContain(draftId);
    await sql`DELETE FROM claimnet.check_feedback WHERE trace_id = ${twin}::uuid`;
    await sql`DELETE FROM claimnet.traces WHERE id = ${twin}::uuid`;
  });

  // ── S2-B4 / DT-VIS-06, DT-VIS-07: the person's own agents ───────────────

  it("S2-B4 / DT-VIS-06: Pat's agent sees the draft near it, labelled in both formats", async () => {
    const structured = await mcp(patKey, "check_recipe", {
      // Deposited in Pat's personal book, so the shared book's published
      // count stays put for the Index-line tests below.
      recipe: recipe("pat checks near"), supporting_evidence: evidence("near"), clusters: 100, recipe_book: pat.personalBookId, response_format: "structured",
    });
    const results = (structured.structured?.["results"] ?? []) as Array<{ recipeId: string; draftState?: string }>;
    const hit = results.find((r) => r.recipeId === draftId);
    expect(hit?.draftState).toBe("unverified");
    const md = await mcp(patKey, "search_recipes", { query: `author:me "${MARKER}"` });
    const line = md.text.split("\n").find((l) => l.includes(draftId));
    expect(line).toContain("[unverified draft");
    const byId = await mcp(patKey, "get_recipes", { recipe_ids: draftId });
    expect(byId.text).toContain("Draft: [unverified draft");
  });

  it("S2-B4 / DT-VIS-06 (the /check HTML page): Pat's own draft is labelled there too", async () => {
    const qs = new URLSearchParams({ key: patKey, filter: `author:me "${MARKER}"` });
    const page = await (await fetch(`${BASE}/check?${qs.toString()}`)).text();
    expect(page).toContain("[unverified draft");
  });

  it("S2-B4 / DT-VIS-06: search excludes Pat's own drafts by default, like his other recipes", async () => {
    const r = await mcp(patKey, "search_recipes", { query: `"${MARKER}"` });
    expect(r.text).not.toContain(draftId);
  });

  it("S2-B4 / DT-VIS-07: a key of Pat's with no read scope on the book finds the draft uniformly absent", async () => {
    const r = await mcp(patNoSharedKey, "search_recipes", { query: `author:me "${MARKER}"`, response_format: "structured" });
    expect(r.raw).not.toContain(draftId);
    const byId = await mcp(patNoSharedKey, "get_recipes", { recipe_ids: draftId });
    expect(byId.text).toContain("not_found_or_unreadable");
  });

  // ── S2-B5 / DT-VIS-08, -09, -17, -18: aggregates ────────────────────────

  it("S2-B5 / DT-VIS-18: Sam's Index line is unchanged, dates included", async () => {
    const briefing = await mcp(samKey, "get_briefing", {});
    expect(sharedIndexLine(briefing.text)).toBe(samIndexLineBefore);
    expect(briefing.text).not.toContain("Drafts:");
  });

  it("S2-B5 / DT-VIS-09: Pat's Index count is the non-draft count, with his drafts on a separate line", async () => {
    const briefing = await mcp(patKey, "get_briefing", {});
    const lines = briefing.text.split("\n");
    const bookAt = lines.findIndex((l) => l.includes(shared.slug));
    const block = lines.slice(bookAt, bookAt + 4).join("\n");
    expect(block).toContain("Index: 3 recipes");
    expect(block).toMatch(/Drafts: \d+ unverified drafts? about your user/);
  });

  it("S2-B5 / DT-VIS-17: Pat's own drafts are never briefing exemplars", async () => {
    const briefing = await mcp(patKey, "get_briefing", { verbosity: "high" });
    expect(briefing.text).not.toContain(draftId);
    expect(briefing.text).not.toContain(MARKER);
  });

  it("S2-B5 / DT-VIS-08: the map excludes drafts for Pat too; the book list shows Pat his own draft, labelled, and Sam nothing", async () => {
    const patMap = await jsonOf(await call(pat, "GET", `/traces/map?groupId=${shared.id}`));
    expect(JSON.stringify(patMap)).not.toContain(draftId);
    const patList = await jsonOf(await call(pat, "GET", `/traces?groupId=${shared.id}&limit=100`));
    const mine = (patList["data"] as Array<{ id: string; draftState?: string }>).find((r) => r.id === draftId);
    expect(mine?.draftState).toBe("unverified");
    const samList = await jsonOf(await call(sam, "GET", `/traces?groupId=${shared.id}&limit=100`));
    expect(JSON.stringify(samList)).not.toContain(draftId);
  });

  it("S2-B5 / DT-VIS-08: /health/integrity says nothing about the draft", async () => {
    const res = await fetch(`${BASE}/health/integrity`, { headers: { Authorization: `Bearer ${samKey}` } });
    expect(await res.text()).not.toContain(draftId);
  });

  // ── S2-B7 / DT-VIS-12: re-checking a draft's text ────────────────────────

  it("S2-B7 / DT-VIS-12: the same key re-checking the text without draft gets the draft back, still a draft, with a verify hint", async () => {
    const s = await mcp(patKey, "check_recipe", { recipe: draftText, supporting_evidence: evidence("again"), response_format: "structured" });
    expect(checkedId(s.structured!)).toBe(draftId);
    expect(s.structured!["existingRecipe"]).toBe(true);
    expect((s.structured!["checked"] as { draftState?: string }).draftState).toBe("unverified");
    expect(String(s.structured!["draftNotice"])).toContain("still a draft");
    expect(String(s.structured!["draftNotice"])).toContain("verify_draft");
    expect((await traceRow(draftId))?.["draft_state"]).toBe("unverified");
    const samView = await mcp(samKey, "get_recipes", { recipe_ids: draftId });
    expect(samView.text).toContain("not_found_or_unreadable");
  });

  // ── S2-B6 / DT-VIS-10, DT-VIS-16: export and import ─────────────────────

  it("S2-B6 / DT-VIS-10, DT-VIS-16: Pat's export carries the draft; Sam's does not; an import restores it as a draft with its ratings", async () => {
    const extra = await deposit(patKey, recipe("export round trip", ` ${MARKER}`), "export me", { draft: true, impact: "low" });
    const extraId = checkedId(extra);
    const patExport = await jsonOf(await call(pat, "GET", "/auth/me/export"));
    const exported = (patExport["traces"] as Array<{ id: string; draftState: string | null; impact: string | null }>).find((t) => t.id === extraId);
    expect(exported?.draftState).toBe("unverified");
    expect(exported?.impact).toBe("low");
    const samExport = await (await call(sam, "GET", "/auth/me/export")).text();
    expect(samExport).not.toContain(draftId);
    expect(samExport).not.toContain(extraId);

    expect((await call(pat, "DELETE", `/traces/${extraId}`)).status).toBe(200);
    const imported = await fetch(`${BASE}/import?book=${shared.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` },
      body: JSON.stringify(patExport),
    });
    expect(imported.status).toBe(200);
    const row = await traceRow(extraId);
    expect(row?.["draft_state"]).toBe("unverified");
    expect(row?.["impact"]).toBe("low");
    const samView = await mcp(samKey, "get_recipes", { recipe_ids: extraId });
    expect(samView.text).toContain("not_found_or_unreadable");
  });

  // ── S2-B8 / DT-VIS-13, DT-VIS-15: move and delete ────────────────────────

  it("S2-B8 / DT-VIS-15: Sam, the book's owner, gets the missing-id 404 on move and delete of Pat's draft, and nothing changes", async () => {
    for (const [method, body] of [["PATCH", { groupId: sam.personalBookId }], ["DELETE", {}]] as const) {
      const real = await call(sam, method, `/traces/${draftId}`, body);
      const random = await call(sam, method, `/traces/${RANDOM_UUID}`, body);
      expect(real.status, method).toBe(404);
      expect(random.status).toBe(404);
      expect(await real.text()).toBe(await random.text());
    }
    const row = await traceRow(draftId);
    expect(row?.["draft_state"]).toBe("unverified");
    expect(row?.["group_id"]).toBe(shared.id);
  });

  it("S2-B8 / DT-VIS-13: Pat moves his draft to another book and it is still a draft Sam cannot see", async () => {
    const moved = await deposit(patKey, recipe("move me", ` ${MARKER}`), "move me", { draft: true });
    const movedId = checkedId(moved);
    const res = await call(pat, "PATCH", `/traces/${movedId}`, { groupId: pat.personalBookId });
    expect(res.status).toBe(200);
    const row = await traceRow(movedId);
    expect(row?.["draft_state"]).toBe("unverified");
    expect(row?.["group_id"]).toBe(pat.personalBookId);
    expect((await mcp(samKey, "get_recipes", { recipe_ids: movedId })).text).toContain("not_found_or_unreadable");
  });

  // ── S2-B9 / DT-VER-01..03, DT-VER-07: the person's reactions ────────────

  it("S2-B9 / DT-VER-02: Pat reacting wrong rejects the draft: still hidden from Sam, and gone from Pat's own results", async () => {
    const d = checkedId(await deposit(patKey, recipe("reject me", ` ${MARKER}`), "reject me", { draft: true }));
    const res = await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "wrong" });
    expect(((await res.json()) as { data: { draftState?: string } }).data.draftState).toBe("rejected");
    expect((await traceRow(d))?.["draft_state"]).toBe("rejected");
    const search = await mcp(patKey, "search_recipes", { query: `author:me "${MARKER}"`, response_format: "structured" });
    expect(search.raw).not.toContain(d);
    const byId = await mcp(patKey, "get_recipes", { recipe_ids: d });
    expect(byId.text).toContain("[rejected draft");
    expect((await mcp(samKey, "get_recipes", { recipe_ids: d })).text).toContain("not_found_or_unreadable");
  });

  it("S2-B9 / DT-VER-01, DT-VER-03: Pat reacting still_true verifies it; Sam finds it; clearing the reaction does not un-verify", async () => {
    const d = checkedId(await deposit(patKey, recipe("verify me by reaction", ` ${MARKER}`), "verify me", { draft: true, impact: "high" }));
    await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "still_true" });
    const row = await traceRow(d);
    expect(row?.["draft_state"]).toBe("verified");
    expect(row?.["draft_resolved_by_user_id"]).toBe(pat.userId);
    expect(row?.["draft_resolved_by_key_id"]).toBeNull();
    expect((await mcp(samKey, "get_recipes", { recipe_ids: d })).text).toContain("1 of 1 resolved");
    await call(pat, "DELETE", `/traces/${d}/reaction`);
    await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "wrong" });
    expect((await traceRow(d))?.["draft_state"]).toBe("verified");
    const detail = await jsonOf(await call(pat, "GET", `/traces/${d}`));
    expect((detail["data"] as { draftState: string }).draftState).toBe("verified");
  });

  // ── S2-B10 / DT-VER-04..08: agent verification ───────────────────────────

  it("S2-B10 / DT-VER-05: no evidence, or evidence without a quote or citation, is refused and the draft stays a draft", async () => {
    for (const ev of ["", "Just my interpretation, no quote.", 'Quote but no citation.\n> "yes"']) {
      const r = await mcp(patKey, "verify_draft", { recipe_id: draftId, supporting_evidence: ev });
      expect(r.text).toContain("quote");
      expect(r.text).toContain("citation");
    }
    expect((await traceRow(draftId))?.["draft_state"]).toBe("unverified");
  });

  it("S2-B10 / DT-VER-06: evidence identical to the draft's own is refused (nothing new)", async () => {
    const r = await mcp(patKey, "verify_draft", { recipe_id: draftId, supporting_evidence: evidence(draftQuote) });
    expect(r.text).toContain("already");
    expect((await traceRow(draftId))?.["draft_state"]).toBe("unverified");
  });

  it("S2-B10 / DT-VER-07: Sam's agent calling verify on Pat's draft is the uniform marker, on MCP and REST", async () => {
    const ev = evidence("Sam says yes");
    const real = await mcp(samKey, "verify_draft", { recipe_id: draftId, supporting_evidence: ev });
    const random = await mcp(samKey, "verify_draft", { recipe_id: RANDOM_UUID, supporting_evidence: ev });
    expect(norm(real.text, draftId)).toBe(norm(random.text, RANDOM_UUID));
    const post = (id: string) => fetch(`${BASE}/recipes/${id}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${samKey}` }, body: JSON.stringify({ supporting_evidence: ev }),
    });
    const restReal = await post(draftId);
    const restRandom = await post(RANDOM_UUID);
    expect(restReal.status).toBe(404);
    expect(restRandom.status).toBe(404);
    expect(norm(await restReal.text(), draftId)).toBe(norm(await restRandom.text(), RANDOM_UUID));
    expect((await traceRow(draftId))?.["draft_state"]).toBe("unverified");
  });

  it("S2-B10 / DT-VER-08: verifying a recipe that is not a draft reports so and stores nothing", async () => {
    const pub = checkedId(await deposit(patKey, recipe("not a draft"), "published"));
    const before = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${pub}::uuid`;
    const r = await mcp(patKey, "verify_draft", { recipe_id: pub, supporting_evidence: evidence("a new quote") });
    expect(r.text).toContain("not a draft");
    const after = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${pub}::uuid`;
    expect(Number(after[0]?.["n"])).toBe(Number(before[0]?.["n"]));
  });

  it("S2-B10 / S2-B11 / DT-VER-04, DT-VER-09: Pat's agent verifies with a new quote: verified by that key, evidence attached, Sam finds it, ranking inputs untouched", async () => {
    const before = await traceRow(draftId);
    const embBefore = await sql`
      SELECT es.id::text AS id FROM claimnet.embedding_sources es
      WHERE es.source_type = 'trace' AND es.source_id = ${draftId}::uuid ORDER BY es.id`;
    const query = `author:me draft visibility ${MARKER}`;
    const patSearchBefore = await mcp(patKey, "search_recipes", { query, verbosity: "high", response_format: "structured" });
    const simBefore = ((patSearchBefore.structured?.["results"] ?? []) as Array<{ recipeId: string; similarity?: number }>).find((r) => r.recipeId === draftId)?.similarity;

    const answer = `Yes, keep drafts private until I say so (${run})`;
    const r = await mcp(patKey, "verify_draft", { recipe_id: draftId.slice(0, 8), supporting_evidence: `The person confirmed it when asked.\n> "${answer}"\n-- conversation with the person, ${run}` });
    expect(r.text).toContain("is verified");

    const after = await traceRow(draftId);
    expect(after?.["draft_state"]).toBe("verified");
    expect(after?.["draft_resolved_by_key_id"]).not.toBeNull();
    expect(after?.["draft_resolved_by_user_id"]).toBe(pat.userId);
    // DT-VER-09: text, judgment date, and ratings are unchanged…
    expect(after?.["claim_text"]).toBe(before?.["claim_text"]);
    expect(String(after?.["decided_at"])).toBe(String(before?.["decided_at"]));
    expect(after?.["impact"]).toBe("high");
    // …and so are the recipe's own embeddings.
    const embAfter = await sql`
      SELECT es.id::text AS id FROM claimnet.embedding_sources es
      WHERE es.source_type = 'trace' AND es.source_id = ${draftId}::uuid ORDER BY es.id`;
    expect(embAfter.map((e) => e["id"])).toEqual(embBefore.map((e) => e["id"]));
    // The new evidence is attached, by the verifying key.
    const quotes = await sql`
      SELECT r.quote FROM claimnet.trace_references tr JOIN claimnet.references r ON r.id = tr.reference_id
      WHERE tr.trace_id = ${draftId}::uuid`;
    expect(quotes.map((q) => q["quote"])).toContain(answer);
    // Sam can now find it, by id and by search.
    expect((await mcp(samKey, "get_recipes", { recipe_ids: draftId })).text).toContain(answer);
    const samSearch = await mcp(samKey, "search_recipes", { query: `author:anyone "${MARKER}"`, verbosity: "high", response_format: "structured" });
    expect(samSearch.raw).toContain(draftId);
    // DT-VIS-06: ranked the same as before verification (same query, same key).
    const patSearchAfter = await mcp(patKey, "search_recipes", { query, verbosity: "high", response_format: "structured" });
    const simAfter = ((patSearchAfter.structured?.["results"] ?? []) as Array<{ recipeId: string; similarity?: number }>).find((x) => x.recipeId === draftId)?.similarity;
    expect(simBefore).toBeDefined();
    expect(simAfter).toBe(simBefore);
    // The detail page can say the depositing agent verified it (open question 14).
    const detail = (await jsonOf(await call(pat, "GET", `/traces/${draftId}`)))["data"] as { draftResolvedByKeyId: string; apiKeyId: string };
    expect(detail.draftResolvedByKeyId).toBe(detail.apiKeyId);
  });

  it("S2-B10: a second verification is refused as already resolved (one-way) and stores nothing", async () => {
    const r = await mcp(patKey, "verify_draft", { recipe_id: draftId, supporting_evidence: evidence(`another new quote ${run}`) });
    expect(r.text).toMatch(/not a draft|already resolved/);
  });

  it("S2-B10 (REST twin): POST /recipes/:id/verify verifies Pat's draft with new evidence", async () => {
    const d = checkedId(await deposit(patKey, recipe("verify over REST", ` ${MARKER}`), "rest draft", { draft: true }));
    const res = await fetch(`${BASE}/recipes/${d}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${patKey}` },
      body: JSON.stringify({ supporting_evidence: `Confirmed.\n> "yes over REST ${run}"\n-- conversation, ${run}` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { draftState: string; verifiedByDepositingKey: boolean } };
    expect(body.data.draftState).toBe("verified");
    expect(body.data.verifiedByDepositingKey).toBe(true);
  });

  // ── Audit follow-ups (F78, F79, F82, F83) ───────────────────────────────

  async function mintKey(actor: Actor, read: string[], write: string[], def: string): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: read,
      writeRecipeBookIds: write,
      defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }

  const verifyEvidence = (tag: string) => `The person confirmed it.\n> "confirmed ${tag} ${run}"\n-- conversation, ${run}`;

  it("[F78] + S3-F1 (a): a key that can read the book but not write it gets the honest write-access refusal on its own person's draft, on MCP and REST, and nothing is stored", async () => {
    const readOnlyKey = await mintKey(pat, [shared.id, pat.personalBookId], [pat.personalBookId], pat.personalBookId);
    const d = checkedId(await deposit(patKey, recipe("f78 read only", ` ${MARKER}`), "f78 draft", { draft: true }));
    const evBefore = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${d}::uuid`;

    const viaMcp = await mcp(readOnlyKey, "verify_draft", { recipe_id: d, supporting_evidence: verifyEvidence("f78 mcp") });
    expect(viaMcp.text).toContain("needs write access to this recipe book");
    expect(viaMcp.text).toContain(shared.slug);
    expect(viaMcp.text).toContain(`/app/drafts?ids=${d}`);
    expect(viaMcp.text).not.toContain("not_found_or_unreadable");

    const post = (id: string) => fetch(`${BASE}/recipes/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${readOnlyKey}` },
      body: JSON.stringify({ supporting_evidence: verifyEvidence("f78 rest") }),
    });
    const rest = await post(d);
    expect(rest.status).toBe(403);
    const restBody = (await rest.json()) as { status: string; error: string; recipeBook: { slug: string } };
    expect(restBody.status).toBe("needs_write_access");
    expect(restBody.recipeBook.slug).toBe(shared.slug);
    expect(restBody.error).toContain("needs write access to this recipe book");

    expect((await traceRow(d))?.["draft_state"]).toBe("unverified");
    const evAfter = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${d}::uuid`;
    expect(Number(evAfter[0]?.["n"])).toBe(Number(evBefore[0]?.["n"]));
    expect((await mcp(samKey, "get_recipes", { recipe_ids: d })).text).toContain("not_found_or_unreadable");

    // Positive: the same key verifies a draft in the book it can write.
    const own = checkedId(await deposit(readOnlyKey, recipe("f78 personal", ` ${MARKER}`), "f78 personal draft", { draft: true }));
    const ok = await mcp(readOnlyKey, "verify_draft", { recipe_id: own, supporting_evidence: verifyEvidence("f78 personal") });
    expect(ok.text).toContain("is verified");
    expect((await traceRow(own))?.["draft_state"]).toBe("verified");
  });

  it("S3-F1 (b): a published recipe the key can read but not write is \"not a draft\" (409), not the missing-id answer", async () => {
    const readOnlyKey = await mintKey(pat, [shared.id, pat.personalBookId], [pat.personalBookId], pat.personalBookId);
    const pub = checkedId(await deposit(samKey, recipe("s3f1 sam published"), "s3f1 published", { recipe_book: shared.slug }));
    const viaMcp = await mcp(readOnlyKey, "verify_draft", { recipe_id: pub, supporting_evidence: verifyEvidence("s3f1 b mcp") });
    expect(viaMcp.text).toContain("is not a draft");
    const rest = await fetch(`${BASE}/recipes/${pub}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${readOnlyKey}` },
      body: JSON.stringify({ supporting_evidence: verifyEvidence("s3f1 b rest") }),
    });
    expect(rest.status).toBe(409);
    expect(((await rest.json()) as { status: string }).status).toBe("not_a_draft");
    const evidenceRows = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence te JOIN claimnet.evidence e ON e.id = te.evidence_id WHERE te.trace_id = ${pub}::uuid AND e.content ILIKE ${"%s3f1 b%"}`;
    expect(Number(evidenceRows[0]?.["n"])).toBe(0);
  });

  it("S3-F1 (c): everything the key cannot read keeps the uniform answer: Sam's draft, a random UUID, and an 8-character prefix of a hidden draft", async () => {
    const samDraft = checkedId(await deposit(samKey, recipe("s3f1 sam draft", ` ${MARKER}`), "s3f1 sam draft", { draft: true, recipe_book: shared.slug }));
    const readOnlyKey = await mintKey(pat, [shared.id, pat.personalBookId], [pat.personalBookId], pat.personalBookId);
    for (const key of [patKey, readOnlyKey]) {
      const real = await mcp(key, "verify_draft", { recipe_id: samDraft, supporting_evidence: verifyEvidence("s3f1 c") });
      const random = await mcp(key, "verify_draft", { recipe_id: RANDOM_UUID, supporting_evidence: verifyEvidence("s3f1 c") });
      expect(norm(real.text, samDraft)).toBe(norm(random.text, RANDOM_UUID));
      const prefix = await mcp(key, "verify_draft", { recipe_id: samDraft.slice(0, 8), supporting_evidence: verifyEvidence("s3f1 c") });
      const randomPrefix = await mcp(key, "verify_draft", { recipe_id: RANDOM_UUID.slice(0, 8), supporting_evidence: verifyEvidence("s3f1 c") });
      expect(norm(prefix.text, samDraft)).toBe(norm(randomPrefix.text, RANDOM_UUID));
      const post = (id: string) => fetch(`${BASE}/recipes/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ supporting_evidence: verifyEvidence("s3f1 c rest") }),
      });
      const restReal = await post(samDraft);
      const restRandom = await post(RANDOM_UUID);
      expect(restReal.status).toBe(404);
      expect(restRandom.status).toBe(404);
      expect(norm(await restReal.text(), samDraft)).toBe(norm(await restRandom.text(), RANDOM_UUID));
    }
    expect((await traceRow(samDraft))?.["draft_state"]).toBe("unverified");
  });

  it("[F78] + S3-F1: a key that cannot read the draft's book at all still gets the uniform answer", async () => {
    // patNoSharedKey reads and writes only Pat's personal book.
    const d = checkedId(await deposit(patKey, recipe("f78 no scope", ` ${MARKER}`), "f78 no scope", { draft: true }));
    const r = await mcp(patNoSharedKey, "verify_draft", { recipe_id: d, supporting_evidence: verifyEvidence("f78 no scope") });
    const random = await mcp(patNoSharedKey, "verify_draft", { recipe_id: RANDOM_UUID, supporting_evidence: verifyEvidence("f78 no scope") });
    expect(r.text).toContain("not_found_or_unreadable");
    expect(norm(r.text, d)).toBe(norm(random.text, RANDOM_UUID));
    expect((await traceRow(d))?.["draft_state"]).toBe("unverified");
  });

  it("[F79] + ruling 25: after Pat is removed from a book, his reaction cannot publish his draft there; he, who can still read it, is told why; still a draft", async () => {
    const slug2 = `drafts-f79-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `Drafts F79 ${run}`, slug: slug2, organizationId: sam.orgId });
    const book2 = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    expect((await call(sam, "POST", `/recipe-books/${book2}/members`, { email: pat.email, role: "member" })).status).toBe(201);
    const key2 = await mintKey(pat, [book2], [book2], book2);
    const d = checkedId(await deposit(key2, recipe("f79 removed", ` ${MARKER}`), "f79 draft", { draft: true }));
    expect((await call(sam, "DELETE", `/recipe-books/${book2}/members/${pat.userId}`)).status).toBe(200);

    for (const reaction of ["still_true", "wrong"]) {
      // The draft's own person can read it (slice 3, build log ruling 25):
      // an honest refusal naming the book, not the missing-id answer.
      const real = await call(pat, "PUT", `/traces/${d}/reaction`, { reaction });
      expect(real.status, reaction).toBe(403);
      const body = (await real.json()) as { status: string; error: string };
      expect(body.status).toBe("needs_write_access");
      expect(body.error).toContain(`Drafts F79 ${run}`);
    }
    expect((await traceRow(d))?.["draft_state"]).toBe("unverified");
    const reactions = await sql`SELECT count(*)::int AS n FROM claimnet.trace_reactions WHERE trace_id = ${d}::uuid`;
    expect(Number(reactions[0]?.["n"])).toBe(0);
    // Sam, the book's owner, still cannot see it, and still gets the uniform 404 for the reaction.
    expect((await call(sam, "GET", `/traces/${d}`)).status).toBe(404);
    const samReal = await call(sam, "PUT", `/traces/${d}/reaction`, { reaction: "still_true" });
    const samRandom = await call(sam, "PUT", `/traces/${RANDOM_UUID}/reaction`, { reaction: "still_true" });
    expect(samReal.status).toBe(404);
    expect(await samReal.text()).toBe(await samRandom.text());
    // The detail page no longer offers Pat the resolve controls.
    const detail = (await jsonOf(await call(pat, "GET", `/traces/${d}`)))["data"] as { canResolveDraft?: boolean };
    expect(detail.canResolveDraft).toBe(false);
  });

  it("[F82] Sam's view of a published recipe's feedback omits a related id that is Pat's hidden draft, and shows it once verified", async () => {
    const hidden = checkedId(await deposit(patKey, recipe("f82 hidden", ` ${MARKER}`), "f82 draft", { draft: true }));
    const pub = checkedId(await deposit(samKey, recipe("f82 sam published"), "f82 published", { recipe_book: shared.slug }));
    const logged = await mcp(patKey, "log_feedback", {
      trace_id: pub, kind: "check-feedback", impact: "none", disposition: "proceeded", story_fulfilled: "yes",
      story: "As a tester, I cited my own draft in lineage.", related_trace_ids: [hidden, RANDOM_UUID],
    });
    expect(logged.text).toContain("Feedback recorded");
    const related = async (actor: Actor): Promise<string[]> => {
      const body = (await jsonOf(await call(actor, "GET", `/traces/${pub}/feedback`)))["data"] as { feedback: Array<{ relatedTraceIds: string[] | null }> };
      return body.feedback.flatMap((f) => f.relatedTraceIds ?? []);
    };
    const samBefore = await related(sam);
    expect(samBefore).not.toContain(hidden);
    expect(samBefore).not.toContain(RANDOM_UUID);
    expect(await related(pat)).toContain(hidden);
    await call(pat, "PUT", `/traces/${hidden}/reaction`, { reaction: "still_true" });
    expect(await related(sam)).toContain(hidden);
  });

  it("[F83] a collaborator's view of a verified draft is an ordinary recipe: no draft state, verifier, or dates; the subject sees them", async () => {
    const d = checkedId(await deposit(patKey, recipe("f83 shared view", ` ${MARKER}`), "f83 draft", { draft: true }));
    await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "still_true" });
    const samDetail = (await jsonOf(await call(sam, "GET", `/traces/${d}`)))["data"] as Record<string, unknown>;
    expect(samDetail["draftState"] ?? null).toBeNull();
    expect(samDetail["draftResolvedAt"] ?? null).toBeNull();
    expect(samDetail["draftResolvedByKeyId"] ?? null).toBeNull();
    expect(samDetail["draftResolvedByEmail"] ?? null).toBeNull();
    expect(samDetail["draftResolvedByViewer"] ?? false).toBe(false);
    const samList = (await jsonOf(await call(sam, "GET", `/traces?groupId=${shared.id}&limit=100`)))["data"] as Array<{ id: string; draftState?: string | null }>;
    expect(samList.find((r) => r.id === d)?.draftState ?? null).toBeNull();
    const patDetail = (await jsonOf(await call(pat, "GET", `/traces/${d}`)))["data"] as Record<string, unknown>;
    expect(patDetail["draftState"]).toBe("verified");
    expect(patDetail["draftResolvedByViewer"]).toBe(true);
    expect(patDetail["draftResolvedAt"]).not.toBeNull();
  });

  it("[F83] import never takes resolution attribution or timestamps from the file, and an imported timestamp never blocks a real verification", async () => {
    const started = new Date(Date.now() - 60_000);
    const idVerified = crypto.randomUUID();
    const idUnverified = crypto.randomUUID();
    const row = (id: string, draftState: string, text: string) => ({
      id, claimText: recipe(text, ` ${MARKER}`), draftState, draftResolvedAt: "2001-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
    });
    const file = {
      schemaVersion: 1,
      traces: [row(idVerified, "verified", "f83 imported verified"), row(idUnverified, "unverified", "f83 imported unverified")],
      evidence: [], references: [], traceEvidence: [], traceReferences: [], evidenceReferences: [],
    };
    const res = await fetch(`${BASE}/import?book=${shared.id}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` }, body: JSON.stringify(file),
    });
    expect(res.status).toBe(200);
    const v = await traceRow(idVerified);
    expect(v?.["draft_state"]).toBe("verified");
    expect(new Date(String(v?.["draft_resolved_at"])).getTime()).toBeGreaterThan(started.getTime());
    expect(v?.["draft_resolved_by_user_id"]).toBe(pat.userId);
    const u = await traceRow(idUnverified);
    expect(u?.["draft_state"]).toBe("unverified");
    expect(u?.["draft_resolved_at"]).toBeNull();
    await call(pat, "PUT", `/traces/${idUnverified}/reaction`, { reaction: "still_true" });
    const after = await traceRow(idUnverified);
    expect(after?.["draft_state"]).toBe("verified");
    expect(new Date(String(after?.["draft_resolved_at"])).getTime()).toBeGreaterThan(started.getTime());
  });

  it("RP-24 / RP-44 (cold cache): when the draft's own person loads a book's map first, the cached layout Sam then gets has no draft", async () => {
    // A fresh book, so the process-wide layout cache has no entry for it: the
    // first load (Pat's) computes and caches the layout Sam is served.
    const slug3 = `drafts-map-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `Drafts map ${run}`, slug: slug3, organizationId: sam.orgId });
    const book3 = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    expect((await call(sam, "POST", `/recipe-books/${book3}/members`, { email: pat.email, role: "member" })).status).toBe(201);
    const patKey3 = await mintKey(pat, [book3], [book3], book3);
    const samKey3 = await mintKey(sam, [book3], [book3], book3);
    await deposit(samKey3, recipe("map cold sam one"), "map sam one");
    await deposit(samKey3, recipe("map cold sam two"), "map sam two");
    await deposit(patKey3, recipe("map cold pat published"), "map pat published");
    const d = checkedId(await deposit(patKey3, recipe("map cold pat draft", ` ${MARKER}`), "map pat draft", { draft: true }));

    const patMap = (await jsonOf(await call(pat, "GET", `/traces/map?groupId=${book3}`)))["data"] as { meta: { totalTraces: number; cached: boolean } };
    expect(patMap.meta.cached).toBe(false);
    expect(JSON.stringify(patMap)).not.toContain(d);
    expect(patMap.meta.totalTraces).toBe(3);

    const samMap = (await jsonOf(await call(sam, "GET", `/traces/map?groupId=${book3}`)))["data"] as { meta: { totalTraces: number; cached: boolean } };
    expect(samMap.meta.cached).toBe(true);
    expect(JSON.stringify(samMap)).not.toContain(d);
    expect(samMap.meta.totalTraces).toBe(3);
  });
});
