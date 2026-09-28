/**
 * Layer 3: triage ratings on every check surface (drafts-and-triage slice 1).
 *
 * Each test names the rubric criterion (docs/planning/drafts-and-triage-build.md
 * §Slice 1 rubric) and the scenario (docs/product-specs/drafts-and-triage.feature)
 * it realizes. Stored values are read back through GET /traces/:id (JWT), the
 * trace detail surface S1-B7 adds them to. The stdio proxy's forwarding half
 * of S1-B1 is apps/mcp-server/src/server.test.ts.
 *
 * Requires a running backend (BACKEND_URL); skipped otherwise.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { seedVerifiedUser } from "../test-users";

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const EVIDENCE = `The test suite states this directly.\n> "ratings ride on the recipe"\n-- triage-ratings.test.ts`;

interface Identity { jwt: string; apiKey: string; email: string }
interface Book { id: string; slug: string; organization_id: string }
interface Checked { recipeId: string; impact: string | null; uncertainty: string | null }
interface CheckData {
  checked?: Checked;
  existingRecipe?: boolean;
  ratingsNotice?: string;
  results?: Array<{ recipeId: string; similarity?: number }>;
  totalResults?: number;
  feedbackResults?: Array<{ ok: boolean; feedbackId?: string; error?: string }>;
}

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
let n = 0;
/** A distinct, well-formed recipe per call (idempotency is per text). */
function recipeText(topic: string): string {
  n += 1;
  return `As a backend maintainer working on triage ratings (${topic}, ${run}-${n}), I prefer ratings stored on the recipe so that review can be sorted.`;
}

async function register(tag: string): Promise<Identity> {
  const email = `triage-${tag}-${run}@test.local`;
  const password = "triage-test-password-123";
  const login = await seedVerifiedUser(email, password);
  const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const apiKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
  if (!jwt || !apiKey) throw new Error("login or key mint failed");
  return { jwt, apiKey, email };
}

async function checkJsonGet(apiKey: string, params: Record<string, string>): Promise<{ status: number; data: CheckData }> {
  const qs = new URLSearchParams({ key: apiKey, ef: EVIDENCE, format: "json", ...params });
  const res = await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as { ok: boolean; data?: CheckData; error?: string };
  if (!body.ok) throw new Error(`check failed: ${JSON.stringify(body)}`);
  return { status: res.status, data: body.data ?? {} };
}

async function mcpCall(apiKey: string, name: string, args: Record<string, unknown>): Promise<{ structured: CheckData | undefined; text: string }> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const raw = await res.text();
  // Streamable HTTP answers as SSE (`data: {...}`) or plain JSON.
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  const msg = JSON.parse(line ? line.slice(6) : raw) as {
    result?: { structuredContent?: CheckData; content?: Array<{ text?: string }>; isError?: boolean };
  };
  expect(msg.result?.isError).not.toBe(true);
  return { structured: msg.result?.structuredContent, text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "" };
}

async function storedRatings(jwt: string, traceId: string): Promise<{ impact: string | null; uncertainty: string | null }> {
  const res = await fetch(`${BASE}/traces/${traceId}`, { headers: { Authorization: `Bearer ${jwt}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { impact: string | null; uncertainty: string | null } };
  return { impact: body.data.impact, uncertainty: body.data.uncertainty };
}

describe.skipIf(!BASE)("triage ratings (drafts-and-triage slice 1)", () => {
  let pat: Identity;

  beforeAll(async () => {
    pat = await register("pat");
  }, 60_000);

  // ── S1-B1 / DT-RAT-01, DT-RAT-05: every check surface ──────────────────────

  it("S1-B1 / DT-RAT-01 + DT-RAT-05 (remote MCP): check_recipe stores impact and uncertainty and echoes them", async () => {
    const { structured, text } = await mcpCall(pat.apiKey, "check_recipe", {
      recipe: recipeText("mcp"),
      supporting_evidence: EVIDENCE,
      impact: "high",
      uncertainty: "medium",
      response_format: "structured",
    });
    expect(structured?.checked?.impact).toBe("high");
    expect(structured?.checked?.uncertainty).toBe("medium");
    expect(text).toContain("Recipe checked as #");
    expect(await storedRatings(pat.jwt, structured!.checked!.recipeId)).toEqual({ impact: "high", uncertainty: "medium" });
  });

  it("S1-B1 / DT-RAT-01 (remote MCP, default markdown): the report echoes the ratings as the agent's own", async () => {
    const { text } = await mcpCall(pat.apiKey, "check_recipe", {
      recipe: recipeText("mcp-markdown"),
      supporting_evidence: EVIDENCE,
      impact: "low",
    });
    expect(text).toContain("Your ratings: impact low, uncertainty not rated");
  });

  it("S1-B1 / DT-RAT-05 (GET /check format=json): stores and echoes the ratings", async () => {
    const { data } = await checkJsonGet(pat.apiKey, { trace: recipeText("get-json"), impact: "low", uncertainty: "high" });
    expect(data.checked).toMatchObject({ impact: "low", uncertainty: "high" });
    expect(await storedRatings(pat.jwt, data.checked!.recipeId)).toEqual({ impact: "low", uncertainty: "high" });
  });

  it("S1-B1 / DT-RAT-05 (POST /check, JSON response): body params store and echo the ratings", async () => {
    const form = new URLSearchParams({
      key: pat.apiKey, trace: recipeText("post-json"), ef: EVIDENCE, format: "json", impact: "medium", uncertainty: "low",
    });
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: CheckData };
    expect(body.data.checked).toMatchObject({ impact: "medium", uncertainty: "low" });
    expect(await storedRatings(pat.jwt, body.data.checked!.recipeId)).toEqual({ impact: "medium", uncertainty: "low" });
  });

  it("S1-B1 / DT-RAT-05 (the /check HTML form): the form offers the ratings, and a multipart submission stores them", async () => {
    const page = await (await fetch(`${BASE}/check?key=${encodeURIComponent(pat.apiKey)}`)).text();
    expect(page).toContain('name="impact"');
    expect(page).toContain('name="uncertainty"');

    const form = new FormData();
    form.set("key", pat.apiKey);
    form.set("recipe", `${recipeText("html-form")}\n\n${EVIDENCE}`);
    form.set("impact", "high");
    form.set("uncertainty", "low");
    const res = await fetch(`${BASE}/check`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const html = await res.text();
    const id = /Your recipe was checked as #([0-9a-f-]{36})/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain("Your ratings: impact high, uncertainty low");
    expect(await storedRatings(pat.jwt, id!)).toEqual({ impact: "high", uncertainty: "low" });
  });

  // ── S1-B2 / DT-RAT-02: omitted means not rated ─────────────────────────────

  it("S1-B2 / DT-RAT-02: omitted ratings are stored as null and reported as not rated, never medium", async () => {
    const { data } = await checkJsonGet(pat.apiKey, { trace: recipeText("omitted") });
    expect(data.checked?.impact).toBeNull();
    expect(data.checked?.uncertainty).toBeNull();
    expect(data.ratingsNotice).toBeUndefined();
    expect(await storedRatings(pat.jwt, data.checked!.recipeId)).toEqual({ impact: null, uncertainty: null });
  });

  it("S1-B2 / DT-RAT-02 (remote MCP, markdown): an unrated check's report says nothing about ratings", async () => {
    const { text } = await mcpCall(pat.apiKey, "check_recipe", { recipe: recipeText("omitted-md"), supporting_evidence: EVIDENCE });
    expect(text).toContain("Recipe checked as #");
    expect(text).not.toContain("Your ratings");
    expect(text).not.toContain("not rated");
  });

  // ── S1-B3 / DT-RAT-04: an unrecognized value never costs the check ─────────

  it("S1-B3 / DT-RAT-04 (GET /check): impact=urgent deposits, stores not rated, and names the vocabulary", async () => {
    const { status, data } = await checkJsonGet(pat.apiKey, { trace: recipeText("urgent"), impact: "urgent", uncertainty: "low" });
    expect(status).toBe(200);
    expect(data.checked?.recipeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.checked?.impact).toBeNull();
    expect(data.checked?.uncertainty).toBe("low");
    expect(data.ratingsNotice).toContain('impact "urgent"');
    expect(data.ratingsNotice).toContain("low | medium | high");
    expect(await storedRatings(pat.jwt, data.checked!.recipeId)).toEqual({ impact: null, uncertainty: "low" });
  });

  it("S1-B3 / DT-RAT-04 (remote MCP): impact=urgent is a notice, not an SDK validation error", async () => {
    const { structured } = await mcpCall(pat.apiKey, "check_recipe", {
      recipe: recipeText("mcp-urgent"),
      supporting_evidence: EVIDENCE,
      impact: "urgent",
      response_format: "structured",
    });
    expect(structured?.checked?.recipeId).toBeTruthy();
    expect(structured?.checked?.impact).toBeNull();
    expect(structured?.ratingsNotice).toContain("low | medium | high");
  });

  it("S1-B3 follow-up (remote MCP): a wrong-type rating is stored as not rated with the notice, and the check deposits", async () => {
    const { structured } = await mcpCall(pat.apiKey, "check_recipe", {
      recipe: recipeText("mcp-wrong-type"),
      supporting_evidence: EVIDENCE,
      impact: 3,
      uncertainty: ["high"],
      response_format: "structured",
    });
    expect(structured?.checked?.recipeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(structured?.checked?.impact).toBeNull();
    expect(structured?.checked?.uncertainty).toBeNull();
    expect(structured?.ratingsNotice).toContain('impact "3" and uncertainty "["high"]" are not rating values');
    expect(await storedRatings(pat.jwt, structured!.checked!.recipeId)).toEqual({ impact: null, uncertainty: null });
  });

  it("S1-B3 follow-up (remote MCP): a non-object feedback row gets a per-row marker and never blocks the check", async () => {
    const { structured } = await mcpCall(pat.apiKey, "check_recipe", {
      recipe: recipeText("mcp-nonobject-row"),
      supporting_evidence: EVIDENCE,
      response_format: "structured",
      feedback: [5, "not a row", null],
    });
    expect(structured?.checked?.recipeId).toMatch(/^[0-9a-f-]{36}$/);
    const rows = structured?.feedbackResults ?? [];
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.ok).toBe(false);
      expect(r.error).toContain("must be an object");
    }
  });

  it("S1-B3 follow-up (remote MCP): a non-object feedback row on search_recipes is a marker, not a failed call", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${pat.apiKey}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_recipes", arguments: { query: "triage ratings", feedback: [7] } } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    expect(msg.result?.isError).not.toBe(true);
    expect(msg.result?.content?.map((c) => c.text ?? "").join(" ")).toContain("must be an object");
  });

  // ── S1-B4 / DT-RAT-03: independent ratings ─────────────────────────────────

  it("S1-B4 / DT-RAT-03: mixed values are stored independently of each other", async () => {
    const a = await checkJsonGet(pat.apiKey, { trace: recipeText("mixed-a"), impact: "high", uncertainty: "low" });
    const b = await checkJsonGet(pat.apiKey, { trace: recipeText("mixed-b"), uncertainty: "high" });
    expect(await storedRatings(pat.jwt, a.data.checked!.recipeId)).toEqual({ impact: "high", uncertainty: "low" });
    expect(await storedRatings(pat.jwt, b.data.checked!.recipeId)).toEqual({ impact: null, uncertainty: "high" });
  });

  // ── S1-B5 / DT-RAT-08: a repeat keeps the first ratings ────────────────────

  it("S1-B5 / DT-RAT-08: an identical repeat returns the existing recipe, keeps the first ratings, and says so", async () => {
    const trace = recipeText("repeat");
    const first = await checkJsonGet(pat.apiKey, { trace, impact: "low" });
    expect(first.data.existingRecipe).toBeUndefined();
    const repeat = await checkJsonGet(pat.apiKey, { trace, impact: "high", uncertainty: "high" });
    expect(repeat.data.checked?.recipeId).toBe(first.data.checked?.recipeId);
    expect(repeat.data.existingRecipe).toBe(true);
    expect(repeat.data.checked).toMatchObject({ impact: "low", uncertainty: null });
    expect(repeat.data.ratingsNotice).toContain("not applied");
    expect(await storedRatings(pat.jwt, first.data.checked!.recipeId)).toEqual({ impact: "low", uncertainty: null });
  });

  // ── S1-B6 / DT-RAT-10: the two impacts never cross ─────────────────────────

  describe("S1-B6 / DT-RAT-10: the check's impact and a feedback row's impact never cross", () => {
    let priorId = "";
    beforeAll(async () => {
      priorId = (await checkJsonGet(pat.apiKey, { trace: recipeText("prior") })).data.checked!.recipeId;
    });

    async function feedbackImpacts(note: string): Promise<string[]> {
      const res = await fetch(`${BASE}/traces/${priorId}/feedback`, { headers: { Authorization: `Bearer ${pat.jwt}` } });
      const body = (await res.json()) as { data: { feedback: Array<{ note: string | null; impact: string }> } };
      return body.data.feedback.filter((f) => f.note === note).map((f) => f.impact);
    }

    it("on MCP: check impact high, ride-along row impact new", async () => {
      const note = `mcp crossing ${run}`;
      const { structured } = await mcpCall(pat.apiKey, "check_recipe", {
        recipe: recipeText("cross-mcp"),
        supporting_evidence: EVIDENCE,
        impact: "high",
        response_format: "structured",
        feedback: [{
          trace_id: priorId, kind: "check-feedback", impact: "new", disposition: "proceeded",
          story_fulfilled: "yes", story: "As a tester, I wanted two impacts kept apart.", note,
        }],
      });
      expect(structured?.checked?.impact).toBe("high");
      expect(structured?.feedbackResults?.[0]?.ok).toBe(true);
      expect(await storedRatings(pat.jwt, structured!.checked!.recipeId)).toMatchObject({ impact: "high" });
      expect(await feedbackImpacts(note)).toEqual(["new"]);
    });

    it("on GET /check: impact=high and feedback_impact=new land in their own places", async () => {
      const note = `url crossing ${run}`;
      const { data } = await checkJsonGet(pat.apiKey, {
        trace: recipeText("cross-url"),
        impact: "high",
        feedback_trace_id: priorId,
        feedback_kind: "check-feedback",
        feedback_impact: "new",
        feedback_disposition: "proceeded",
        feedback_story_fulfilled: "yes",
        feedback_story: "As a tester, I wanted two impacts kept apart on the URL form.",
        feedback_note: note,
      });
      expect(data.checked?.impact).toBe("high");
      expect(data.feedbackResults?.[0]?.ok).toBe(true);
      expect(await storedRatings(pat.jwt, data.checked!.recipeId)).toMatchObject({ impact: "high" });
      expect(await feedbackImpacts(note)).toEqual(["new"]);
    });
  });

  // ── S1-Z4 / DT-TOOL-03: every feedback field survives the pointer schema ───

  it("S1-Z4 / DT-TOOL-03: every log_feedback field rides along on check_recipe and search_recipes and is stored", async () => {
    const prior = (await checkJsonGet(pat.apiKey, { trace: recipeText("fields-prior"), intent: `As a tester working on ${run}, I want feedback fields kept.` })).data as CheckData & { intentId?: string };
    const priorId = prior.checked!.recipeId;
    const intentId = prior.intentId!;
    expect(intentId).toMatch(/^int_/);
    const related = (await checkJsonGet(pat.apiKey, { trace: recipeText("fields-related") })).data.checked!.recipeId;

    const row = (note: string) => ({
      trace_id: priorId,
      kind: "check-feedback",
      impact: "subtle",
      disposition: "corrected",
      story_fulfilled: "partial",
      story: "As a tester, I wanted every field to survive.",
      note,
      agent_id: "a-fields-row",
      top_similarity: 0.61,
      model: "model-x",
      harness: "harness-y",
      harness_version: "9.9",
      related_trace_ids: [related],
      session_id: `sess-fields-${run}`,
      intent_id: intentId,
    });

    const onCheck = `fields on check ${run}`;
    const onSearch = `fields on search ${run}`;
    const c = await mcpCall(pat.apiKey, "check_recipe", {
      recipe: recipeText("fields-check"), supporting_evidence: EVIDENCE, response_format: "structured", feedback: [row(onCheck)],
    });
    expect(c.structured?.feedbackResults?.[0]?.ok).toBe(true);
    const s = await mcpCall(pat.apiKey, "search_recipes", {
      query: "triage ratings", response_format: "structured", feedback: [row(onSearch)],
    });
    expect(s.structured?.feedbackResults?.[0]?.ok).toBe(true);

    // The search-target form (search_id) is accepted on both tools too.
    const searchId = (s.structured as { searchId?: string } | undefined)?.searchId;
    expect(searchId).toBeTruthy();
    const bySearch = await mcpCall(pat.apiKey, "search_recipes", {
      query: "triage ratings again", response_format: "structured",
      feedback: [{ search_id: searchId, kind: "check-feedback", impact: "none", disposition: "proceeded", story_fulfilled: "no", story: "As a tester, I wanted search_id accepted." }],
    });
    expect(bySearch.structured?.feedbackResults?.[0]?.ok).toBe(true);

    const res = await fetch(`${BASE}/traces/${priorId}/feedback`, { headers: { Authorization: `Bearer ${pat.jwt}` } });
    const rows = ((await res.json()) as { data: { feedback: Array<Record<string, unknown>> } }).data.feedback;
    for (const note of [onCheck, onSearch]) {
      const stored = rows.find((r) => r["note"] === note);
      expect(stored, note).toMatchObject({
        kind: "check-feedback",
        impact: "subtle",
        disposition: "corrected",
        storyFulfilled: "partial",
        story: "As a tester, I wanted every field to survive.",
        agentId: "a-fields-row",
        topSimilarity: 0.61,
        model: "model-x",
        harness: "harness-y",
        harnessVersion: "9.9",
        relatedTraceIds: [related],
        sessionId: `sess-fields-${run}`,
        intentId,
      });
    }
  });

  // ── S1-B7 / DT-RAT-09: the detail surface ──────────────────────────────────

  it("S1-B7 / DT-RAT-09: GET /traces/:id returns both ratings for the person's own recipe", async () => {
    const { data } = await checkJsonGet(pat.apiKey, { trace: recipeText("detail"), impact: "high", uncertainty: "high" });
    const res = await fetch(`${BASE}/traces/${data.checked!.recipeId}`, { headers: { Authorization: `Bearer ${pat.jwt}` } });
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data["impact"]).toBe("high");
    expect(body.data["uncertainty"]).toBe("high");
  });

  // ── S1-B8 (a) / DT-RAT-06: ratings never change ranking ────────────────────

  it("S1-B8 (a) / DT-RAT-06: two keys differing only in ratings get identical result ids, order, and similarity", async () => {
    // A fixed corpus in Pat's default book; both checks write to a second
    // book they don't read, so neither deposit can enter the other's results.
    const books = ((await (await fetch(`${BASE}/recipe-books`, { headers: { Authorization: `Bearer ${pat.jwt}` } })).json()) as { data: Book[] }).data;
    const corpus = books[0]!;
    for (const topic of ["corpus-1", "corpus-2", "corpus-3", "corpus-4"]) {
      await checkJsonGet(pat.apiKey, { trace: recipeText(topic), recipe_book: corpus.slug });
    }
    const slug = `triage-deposits-${run}`;
    const created = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` },
      body: JSON.stringify({ name: `Triage deposits ${run}`, slug, organizationId: corpus.organization_id }),
    });
    const depositBook = ((await created.json()) as { data: { id: string } }).data.id;

    async function scopedKey(label: string): Promise<string> {
      const res = await fetch(`${BASE}/keys/scoped`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat.jwt}` },
        body: JSON.stringify({
          label,
          readRecipeBookIds: [corpus.id],
          writeRecipeBookIds: [depositBook],
          defaultWriteRecipeBookId: depositBook,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }),
      });
      const key = ((await res.json()) as { data?: { key?: string } }).data?.key;
      if (!key) throw new Error("scoped key mint failed");
      return key;
    }
    const [k1, k2] = [await scopedKey(`rated-${run}`), await scopedKey(`unrated-${run}`)];

    const trace = recipeText("ranking-probe");
    const rated = await checkJsonGet(k1, { trace, impact: "high", uncertainty: "high", verbosity: "high" });
    const unrated = await checkJsonGet(k2, { trace, verbosity: "high" });
    expect(rated.data.checked?.recipeId).not.toBe(unrated.data.checked?.recipeId);
    const shape = (d: CheckData) => (d.results ?? []).map((r) => [r.recipeId, r.similarity]);
    expect(shape(rated.data).length).toBeGreaterThan(0);
    expect(shape(rated.data)).toEqual(shape(unrated.data));
    expect(rated.data.totalResults).toBe(unrated.data.totalResults);
  });

  // ── S1-Z6 / DT-TOOL-02 (remote): the deprecated levers are still honored ──

  it("S1-Z6 / DT-TOOL-02 (remote MCP): clusters and max_chars keep their effect after shrinking to pointers", async () => {
    for (const topic of ["lever-1", "lever-2", "lever-3", "lever-4", "lever-5", "lever-6", "lever-7"]) {
      await checkJsonGet(pat.apiKey, { trace: recipeText(topic) });
    }
    const count = async (args: Record<string, unknown>) => {
      const { structured } = await mcpCall(pat.apiKey, "check_recipe", {
        recipe: recipeText("lever-probe"), supporting_evidence: EVIDENCE, response_format: "structured", ...args,
      });
      return structured?.results?.length ?? 0;
    };
    // No steer: the automatic default (3 exemplars).
    expect(await count({})).toBe(3);
    // clusters is an exact exemplar count.
    expect(await count({ clusters: 5 })).toBe(5);
    // max_chars reaches the size estimator: a tiny budget shows fewer
    // exemplars than a generous one (the exact floor is the estimator's).
    const tight = await count({ max_chars: 1 });
    const generous = await count({ max_chars: 1_000_000 });
    expect(tight).toBeLessThan(generous);
  });
});
