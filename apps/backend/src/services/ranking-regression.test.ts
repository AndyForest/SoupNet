import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { DEFAULT_RANKING } from "@soupnet/domain";
import type { RankingConfig } from "@soupnet/domain";

/**
 * Ranking-pipeline regression tests — full-stack, over the REAL
 * runSearchPipeline / submitAndSearch (retrieval → pool → clustering →
 * known-set rendering), not just hybridSearch.
 *
 * Layer A of the offline regression harness: runs inside the normal test:ci
 * quality gate with zero new CI wiring. Semantic-quality metrics live in
 * Layer B (apps/backend/src/eval/ranking-eval.ts, golden datasets, local
 * embeddings); this file proves the MECHANISMS of the simplified engine
 * (docs/planning/session-novelty-and-pool-diversity.md, plan v2) with
 * hand-crafted unit vectors where cosine geometry must be exact and with the
 * real deposit path where session semantics must be end-to-end.
 *
 * What it locks down:
 *   1. Seam 1 — ranking is a PURE FUNCTION of the check's explicit inputs:
 *      identical inputs under different api_keys (same read scope) return
 *      identical ordering and scores; a session_id changes NOTHING about
 *      ranking or membership — only stub flags.
 *   2. Seam 2 — sibling visibility: deposits from a DIFFERENT session on the
 *      same key render fully — never stubbed, never reordered (the sub-agent
 *      cross-communication guardrail, recipe 4d25aec9).
 *   3. Known-set rendering: same-session deposits come back known:true at
 *      unchanged rank with unchanged scores; a known cluster exemplar is
 *      replaced for display by the next-nearest non-known member, with ALL
 *      known cluster-mates listed via knownClusterMemberIds ("stub, stub,
 *      full recipe" — 2026-07-18 reshape); an all-known cluster renders a
 *      stub exemplar. Id-multiset + display-score invariants hold across a
 *      with/without-session pair.
 *   4. The clusterPool lever (P6): "page" mode is byte-identical to the
 *      pre-lever caller shape; "fixed" reaches diversity outside the page
 *      window; "score-gap" cuts the pool at the largest score cliff, clamped
 *      by minSize/size; the pool never leaks into flat pagination.
 *   5. The novel-counted display window (session/seen design, recipe
 *      31d184df): the window holds exactly perPage UNSEEN recipes with knowns
 *      interleaved as stubs at their true ranks; offsets count novel items;
 *      knowns before the window start are skipped; sessionless calls stay a
 *      plain slice.
 *   6. Seen accumulation (session_shown): what a check displays in full stubs
 *      on the session's next check — results AND related-evidence parents —
 *      with the window walking to surface new content each time, and an
 *      omitted token refreshing to full texts (context-compaction
 *      affordance). Flat ordering identical across the session arms.
 *
 * Requires a running backend + postgres (skipped otherwise). Process
 * discipline (2026-07-17 gate fix): anything that DEPOSITS (a real check)
 * goes over HTTP against BACKEND_URL, so the check's side effects — including
 * validateKey's fire-and-forget last_used_at UPDATE — run in the backend
 * process, not this vitest worker. In-process calls are reserved for the
 * READ-ONLY pipeline path (runSearchPipeline with a supplied queryVectorStr
 * performs only SELECTs) plus awaited seeding/cleanup SQL; running
 * submitAndSearch in-process left floating queries that could reject at fork
 * teardown and kill the worker after its tests passed ("Worker exited
 * unexpectedly" at full-suite scale).
 */

const BASE = process.env["BACKEND_URL"] ?? "";

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let runSearchPipeline: typeof import("./search-pipeline").runSearchPipeline;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let validateKey: typeof import("./api-key.service").validateKey;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getEmbeddingModelId: typeof import("../lib/embeddings/provider").getEmbeddingModelId;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let deleteTraceCascade: typeof import("./trace-delete.service").deleteTraceCascade;

const DIMS = 3072;

/**
 * Unit vector with `sim` on dim 0 and the residual mass on `axis` — cosine to
 * the query e0 is exactly `sim`, while the residual axis controls cluster
 * geometry: seeds sharing an axis are near-identical to each other, seeds on
 * different axes only share the query component, so k-means separates the
 * groups regardless of arrival order.
 */
function dirVec(sim: number, axis: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[0] = sim;
  v[axis] = Math.sqrt(1 - sim * sim);
  return v;
}
const toPgVec = (v: number[]) => `[${v.join(",")}]`;
const Q = toPgVec(dirVec(1, 1)); // query at e0 (residual is 0 at sim=1)

const uid = Date.now();

interface Agent {
  userId: string;
  groupId: string;
  keyId: string;
  apiKey: string;
  jwt: string;
}

/** Register + verify + login + mint a daily key over HTTP — gives an isolated
 *  user/recipe-book/api-key set per describe block (fixture isolation: each
 *  block's group contains only its own seeds/deposits). */
async function registerAgent(tag: string): Promise<Agent> {
  const email = `test-rankreg-${tag}-${uid}@test.local`;
  const password = "rankreg-test-password";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error("Backend did not return verificationToken — ALLOW_AUTO_SETUP must be true");
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const apiKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
  if (!apiKey) throw new Error("Failed to mint API key for ranking-regression test");
  const kr = await validateKey(getDb(), apiKey);
  if (!kr) throw new Error("validateKey failed for ranking-regression test key");
  return { userId: kr.userId, groupId: kr.defaultWriteGroupId, keyId: kr.keyId, apiKey, jwt };
}

/** Mint a second, SCOPED key for the same user + book — a different api_key
 *  identity with the identical read scope (the pure-function comparison). */
async function mintScopedKey(agent: Agent): Promise<string> {
  const res = await fetch(`${BASE}/keys/scoped`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.jwt}` },
    body: JSON.stringify({
      readRecipeBookIds: [agent.groupId],
      writeRecipeBookIds: [agent.groupId],
      defaultWriteRecipeBookId: agent.groupId,
      expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      label: "rankreg pure-function probe",
    }),
  });
  const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
  if (!key) throw new Error("Failed to mint scoped key for pure-function test");
  return key;
}

interface SeedSpec {
  sim: number;
  axis: number;
  createdAtSql: string;
  sessionId?: string;
}

/** Insert a trace plus a complete full_document embedding row with the
 *  hand-crafted vector (same chain the retired echo tests seeded). */
async function seedTrace(agent: Agent, label: string, spec: SeedSpec): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const claim = `rankreg-${uid}-${label}`;
  const claimHash = crypto.createHash("sha256").update(claim).digest("hex");
  const chunkHash = crypto.createHash("sha256").update(`${claim}-chunk`).digest("hex");

  await db.execute(sql`
    INSERT INTO claimnet.traces (id, user_id, group_id, api_key_id, claim_text, claim_text_hash, session_id, created_at)
    VALUES (${id}::uuid, ${agent.userId}::uuid, ${agent.groupId}::uuid, ${agent.keyId}::uuid, ${claim}, ${claimHash},
            ${spec.sessionId ?? null}, ${sql.raw(spec.createdAtSql)})
  `);
  const srcRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_sources (source_type, source_id, group_id, source_text, artifact_category)
    VALUES ('trace', ${id}::uuid, ${agent.groupId}::uuid, ${claim}, 'text')
    RETURNING id
  `);
  const sourceId = (srcRows as unknown as Array<{ id: string }>)[0]!.id;
  const stratRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_chunk_strategies (embedding_source_id, strategy_id, status)
    VALUES (${sourceId}::uuid, 'full_document', 'complete')
    RETURNING id
  `);
  const strategyId = (stratRows as unknown as Array<{ id: string }>)[0]!.id;
  const chunkRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_chunks (embedding_source_id, chunk_strategy_id, chunk_text, chunk_hash, chunk_path)
    VALUES (${sourceId}::uuid, ${strategyId}::uuid, ${claim}, ${chunkHash}, 'doc')
    RETURNING id
  `);
  const chunkId = (chunkRows as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO claimnet.embedding_vectors (embedding_chunk_id, model_id, task_type, status, vector, vector_source)
    VALUES (${chunkId}::uuid, ${getEmbeddingModelId()}, 'SEMANTIC_SIMILARITY', 'complete',
            ${toPgVec(dirVec(spec.sim, spec.axis))}::halfvec(3072), 'server')
  `);
  return id;
}

/** Hard-delete a check's own deposit (trace + evidence links + embedding
 *  chain, via the real cascade service) so the corpus can be restored between
 *  pure-function comparison runs. Awaited to completion — nothing floats. */
async function deleteDeposit(agent: Agent, traceId: string): Promise<void> {
  await deleteTraceCascade({ db: getDb(), traceId, actorUserId: agent.userId });
}

/** Drive the real pipeline in query mode. `omitRanking` leaves the ranking
 *  param entirely unset (the pre-lever caller shape) for byte-stability
 *  comparisons. */
function runPipeline(
  agent: Agent,
  rc: RankingConfig,
  opts?: {
    k?: number;
    expand?: boolean;
    omitRanking?: boolean;
    knownIds?: ReadonlySet<string>;
    page?: number;
    perPage?: number;
  },
) {
  return runSearchPipeline({
    db: getDb(),
    groupIds: [agent.groupId],
    query: "unused — queryVectorStr provided",
    queryVectorStr: Q,
    k: opts?.k,
    expand: opts?.expand,
    page: opts?.page,
    perPage: opts?.perPage ?? 20,
    knownIds: opts?.knownIds,
    ranking: opts?.omitRanking ? undefined : rc,
  });
}

/** Seed an evidence row linked to a trace, with a complete hand-crafted
 *  embedding — so evidence discovery has a candidate without any deposit
 *  having carried evidence (keeps the shown-set fully observable). */
async function seedEvidence(agent: Agent, parentTraceId: string, label: string, spec: SeedSpec): Promise<void> {
  const db = getDb();
  const evidenceId = crypto.randomUUID();
  const content = `rankreg-evidence-${uid}-${label}`;
  const chunkHash = crypto.createHash("sha256").update(`${content}-chunk`).digest("hex");
  await db.execute(sql`
    INSERT INTO claimnet.evidence (id, content) VALUES (${evidenceId}::uuid, ${content})
  `);
  await db.execute(sql`
    INSERT INTO claimnet.trace_evidence (trace_id, evidence_id, stance, api_key_id)
    VALUES (${parentTraceId}::uuid, ${evidenceId}::uuid, 'for', ${agent.keyId}::uuid)
  `);
  const srcRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_sources (source_type, source_id, group_id, source_text, artifact_category)
    VALUES ('evidence', ${evidenceId}::uuid, ${agent.groupId}::uuid, ${content}, 'text')
    RETURNING id
  `);
  const sourceId = (srcRows as unknown as Array<{ id: string }>)[0]!.id;
  const stratRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_chunk_strategies (embedding_source_id, strategy_id, status)
    VALUES (${sourceId}::uuid, 'full_document', 'complete')
    RETURNING id
  `);
  const strategyId = (stratRows as unknown as Array<{ id: string }>)[0]!.id;
  const chunkRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_chunks (embedding_source_id, chunk_strategy_id, chunk_text, chunk_hash, chunk_path)
    VALUES (${sourceId}::uuid, ${strategyId}::uuid, ${content}, ${chunkHash}, 'doc')
    RETURNING id
  `);
  const chunkId = (chunkRows as unknown as Array<{ id: string }>)[0]!.id;
  await db.execute(sql`
    INSERT INTO claimnet.embedding_vectors (embedding_chunk_id, model_id, task_type, status, vector, vector_source)
    VALUES (${chunkId}::uuid, ${getEmbeddingModelId()}, 'SEMANTIC_SIMILARITY', 'complete',
            ${toPgVec(dirVec(spec.sim, spec.axis))}::halfvec(3072), 'server')
  `);
}

// The legacy k-means display selection, shared by every non-mmr arm below.
const CLUSTER_DISPLAY: RankingConfig["displaySelection"] = { mode: "cluster", lambda: 0.6 };
// Explicit page config — no longer DEFAULT_RANKING since the 2026-07-19 flip
// to fixed:100 (ranking-changelog.md); page stays a comparison arm.
const pageArm = (): RankingConfig => ({
  clusterPool: { mode: "page", size: 133, minSize: 20, vectorDims: 768 },
  clusterOrdering: "member-count",
  displaySelection: CLUSTER_DISPLAY,
});
const fixedArm = (size: number): RankingConfig => ({
  clusterPool: { mode: "fixed", size, minSize: 20, vectorDims: 768 },
  clusterOrdering: "member-count",
  displaySelection: CLUSTER_DISPLAY,
});
const gapArm = (minSize: number, size: number): RankingConfig => ({
  clusterPool: { mode: "score-gap", size, minSize, vectorDims: 768 },
  clusterOrdering: "member-count",
  displaySelection: CLUSTER_DISPLAY,
});
// P7 cluster-ordering arms — DEFAULT_RANKING's pool (fixed:100), only the
// display ordering changes. `order` is the mode name; page-pool variants are
// used where a small hand-seeded corpus must fit the pool.
const orderArm = (
  order: "member-count" | "max-similarity" | "evidence-mass",
  pool: RankingConfig["clusterPool"] = { mode: "page", size: 133, minSize: 20, vectorDims: 768 },
): RankingConfig => ({ clusterPool: pool, clusterOrdering: order, displaySelection: CLUSTER_DISPLAY });
// MMR display selection (P8) over a score-banded pool — the prototype behind
// the lever seam. `band` is the score reach below the top; a homogeneous top
// extends it deeper.
const mmrBandArm = (
  band: number,
  size: number,
  minSize = 5,
  lambda = 0.6,
): RankingConfig => ({
  clusterPool: { mode: "band", band, size, minSize, vectorDims: 768 },
  clusterOrdering: "member-count",
  displaySelection: { mode: "mmr", lambda },
});
// The shipped default, written out explicitly (fixed:100 + max-similarity +
// cluster display since the 2026-07-20 ordering flip) — byte-identity tests
// pair this with omitted-ranking runs so a silent default drift fails loudly.
const defaultArm = (): RankingConfig => ({
  clusterPool: { mode: "fixed", size: 100, minSize: 20, vectorDims: 768 },
  clusterOrdering: "max-similarity",
  displaySelection: CLUSTER_DISPLAY,
});

beforeAll(async () => {
  if (!BASE) return;
  getDb = (await import("../db")).getDb;
  sql = (await import("drizzle-orm")).sql;
  runSearchPipeline = (await import("./search-pipeline")).runSearchPipeline;
  validateKey = (await import("./api-key.service")).validateKey;
  getEmbeddingModelId = (await import("../lib/embeddings/provider")).getEmbeddingModelId;
  deleteTraceCascade = (await import("./trace-delete.service")).deleteTraceCascade;
});

/** JSON shape of a /check?format=json response (the fields these suites read). */
interface CheckJson {
  ok: boolean;
  error?: string;
  data?: {
    checked: { recipeId: string; recipe?: string };
    sessionId?: string;
    results: Array<{
      recipeId: string;
      known?: boolean;
      recipe?: string;
      createdAt?: string;
      similarity: number | null;
      knownMembers?: Array<{ recipeId: string; similarity: number }>;
    }>;
    relatedEvidence?: Array<{
      recipeId: string;
      recipe?: string;
      evidence?: Array<{ interpretation?: string }>;
    }>;
    relatedEvidenceKnown?: Array<{ recipeId: string; similarity: number }>;
  };
}

/** Run a REAL recipe check over HTTP — deposits and every check side effect
 *  stay in the backend process (see the process-discipline note above).
 *  clusters=20 ≥ corpus size degenerates clustering to one-cluster-per-result
 *  in rank order — the flat ranking surface through the real JSON route
 *  (which otherwise defaults to 3 clusters, where known-exemplar backfill
 *  legitimately swaps WHICH member is displayed — that behavior is suite 3's
 *  subject, not seam 1's). */
async function httpCheck(
  key: string,
  traceText: string,
  sessionId?: string,
  clusters = "20", // must stay ≥ the visible corpus for the degenerate-flat reading
): Promise<NonNullable<CheckJson["data"]>> {
  const params = new URLSearchParams({
    key,
    trace: traceText,
    ef: 'Fixture interpretation.\n> "fixture quote"\n-- ranking-regression test',
    format: "json",
    clusters,
    ...(sessionId !== undefined ? { session_id: sessionId } : {}),
  });
  const res = await fetch(`${BASE}/check?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const body = (await res.json()) as CheckJson;
  if (!body.ok || !body.data) throw new Error(`/check failed: ${body.error ?? res.status}`);
  return body.data;
}

// ── 1+2: pure-function contract + sibling visibility (real deposit path) ─────

describe.skipIf(!BASE)("ranking regression — pure-function ranking + session rendering (seams 1/2)", () => {
  let agent: Agent;
  let scopedKey = "";
  const SESS_A = `sess-a-${uid}`; // deposits D1, D2
  const SESS_B = `sess-b-${uid}`; // deposit D3
  let d1 = "";
  let d2 = "";
  let d3 = "";
  let sessBFirst: NonNullable<CheckJson["data"]>; // SESS_B's first-ever response

  const recipeText = (label: string) =>
    `As a backend developer working on ranking regression fixtures, I prefer the ${label} probe recipe so that orderings stay deterministic.`;

  const check = (key: string, label: string, sessionId?: string) =>
    httpCheck(key, recipeText(label), sessionId);

  beforeAll(async () => {
    agent = await registerAgent("session");
    scopedKey = await mintScopedKey(agent);
    // Corpus deposits, each under a controlled session (stub embeddings —
    // deterministic per text, so orderings are exactly reproducible).
    d1 = (await check(agent.apiKey, "alpha", SESS_A)).checked.recipeId;
    d2 = (await check(agent.apiKey, "beta", SESS_A)).checked.recipeId;
    sessBFirst = await check(agent.apiKey, "gamma", SESS_B);
    d3 = sessBFirst.checked.recipeId;
    await check(agent.apiKey, "delta"); // sessionless deposit
  }, 60_000);

  it("seam 1: identical inputs under different api_keys (same read scope) return identical ordering", async () => {
    // Run the probe with the daily key, then RESTORE the corpus (delete its
    // deposit — awaited direct-db cleanup) and run the byte-identical probe
    // with the scoped key — both checks exclude their own deposit, so both
    // rank the same corpus.
    const resA = await check(agent.apiKey, "purefn");
    await deleteDeposit(agent, resA.checked.recipeId);
    const resB = await check(scopedKey, "purefn");
    await deleteDeposit(agent, resB.checked.recipeId);

    expect(resB.results.map((r) => r.recipeId)).toEqual(resA.results.map((r) => r.recipeId));
    resB.results.forEach((r, i) => {
      expect(r.similarity).toBeCloseTo(resA.results[i]!.similarity!, 6);
    });
  });

  it("seam 1: a session_id changes NOTHING about ranking/membership — only stub flags", async () => {
    // Same key + same text ⇒ the deposit row is REUSED (ON CONFLICT DO
    // NOTHING), so both runs rank the identical corpus and exclude the same
    // own-trace. Only the presented session token differs.
    const withSession = await check(agent.apiKey, "sessprobe", SESS_A);
    const freshSession = await check(agent.apiKey, "sessprobe", `sess-f-${uid}`);

    expect(freshSession.results.map((r) => r.recipeId)).toEqual(withSession.results.map((r) => r.recipeId));
    freshSession.results.forEach((r, i) => {
      expect(r.similarity).toBeCloseTo(withSession.results[i]!.similarity!, 6);
    });

    // SESS_A's deposits are flagged known ONLY under SESS_A — at their true,
    // unchanged rank, as id-only stubs (no recipe text); the fresh session
    // gets them in full.
    for (const id of [d1, d2]) {
      const flaggedIdx = withSession.results.findIndex((r) => r.recipeId === id);
      const freshIdx = freshSession.results.findIndex((r) => r.recipeId === id);
      expect(flaggedIdx).toBeGreaterThanOrEqual(0);
      expect(freshIdx).toBe(flaggedIdx);
      expect(withSession.results[flaggedIdx]!.known).toBe(true);
      expect(withSession.results[flaggedIdx]!.recipe).toBeUndefined();
      expect(freshSession.results[freshIdx]!.known).toBeUndefined();
      expect(freshSession.results[freshIdx]!.recipe).toBeTruthy();
    }
    // Nothing is ever flagged for a session with no prior deposits.
    for (const r of freshSession.results) expect(r.known).toBeUndefined();
  });

  it("seam 2: sibling-session deposits arrive FULL on first exposure — never pre-stubbed", () => {
    // SESS_B's first-ever check: SESS_A's deposits (same api_key, different
    // session) are sibling work — the cross-communication channel — and must
    // arrive as full recipes. A session can only ever stub what it has
    // already deposited or been shown; sibling work is neither, until shown.
    for (const id of [d1, d2]) {
      const sibling = sessBFirst.results.find((r) => r.recipeId === id)!;
      expect(sibling).toBeDefined();
      expect(sibling.known).toBeUndefined();
      expect(sibling.recipe).toBeTruthy();
    }
    // The response echoes the effective session token (self-healing channel).
    expect(sessBFirst.sessionId).toBe(SESS_B);
  });

  it("seam 2: after exposure, the session stubs what it was shown AND its own deposit — display history, not authorship", async () => {
    // SESS_B's second check: d1/d2 were SHOWN to SESS_B by its first response
    // (session_shown display history) and d3 is SESS_B's own deposit — all
    // three now stub. Rendering only; ordering is covered by the purity
    // asserts above and the seen-accumulation suite.
    const res = await check(agent.apiKey, "siblingprobe", SESS_B);
    for (const id of [d1, d2, d3]) {
      const item = res.results.find((r) => r.recipeId === id)!;
      expect(item).toBeDefined();
      expect(item.known).toBe(true);
      expect(item.recipe).toBeUndefined();
    }
  });
});

// ── 3: known-set rendering in the cluster stage (hand-crafted geometry) ──────

describe.skipIf(!BASE)("ranking regression — known-set cluster rendering (seam 2)", () => {
  let agent: Agent;
  // Cluster A (axis 1): two high-sim seeds (one becomes the exemplar) + one
  // clearly-farther member N. Cluster B (axis 2): two seeds. Marking A's two
  // top seeds + all of B known exercises both branches: promotion (A still
  // has a non-known member) and the all-known stub exemplar (B).
  let a1 = "";
  let a2 = "";
  let n = "";
  let b1 = "";
  let b2 = "";

  beforeAll(async () => {
    agent = await registerAgent("known");
    const old = "now() - interval '40 days'";
    a1 = await seedTrace(agent, "A1", { sim: 0.9, axis: 1, createdAtSql: old });
    a2 = await seedTrace(agent, "A2", { sim: 0.895, axis: 1, createdAtSql: old });
    n = await seedTrace(agent, "N", { sim: 0.8, axis: 1, createdAtSql: old });
    b1 = await seedTrace(agent, "B1", { sim: 0.7, axis: 2, createdAtSql: old });
    b2 = await seedTrace(agent, "B2", { sim: 0.69, axis: 2, createdAtSql: old });
  }, 60_000);

  it("known exemplar → next-nearest non-known member promoted, listing ALL known cluster-mates; all-known cluster → stub exemplar", async () => {
    const base = await runPipeline(agent, pageArm(), { k: 2 });
    expect(base.clustered).toBe(true);

    const clusterAIds = [a1, a2, n];
    const exemplarA = base.results.find((r) => clusterAIds.includes(r.id))!;
    const exemplarB = base.results.find((r) => [b1, b2].includes(r.id))!;
    expect([a1, a2]).toContain(exemplarA.id); // N is clearly farther from A's centroid

    const known = new Set([a1, a2, b1, b2]);
    const res = await runPipeline(agent, pageArm(), { k: 2, knownIds: known });

    // Cluster A: the known exemplar is replaced for display by the
    // next-nearest non-known member (N — the only candidate), and the item
    // lists ALL of the cluster's known member ids — the "stub, stub, full
    // recipe" model (2026-07-18): the passed-over exemplar AND every other
    // shown cluster-mate stay visible (the check2b gap — known members used
    // to vanish).
    const promoted = res.results.find((r) => r.id === n)!;
    expect(promoted).toBeDefined();
    const members = promoted.knownClusterMembers ?? [];
    expect(members.map((m) => m.id).sort()).toEqual([a1, a2].sort());
    expect(members.map((m) => m.id)).toContain(exemplarA.id);
    // Member similarities ride free from retrieval (recipe ef245b63): each
    // is the member's own raw cosine, present and in [0, 1].
    for (const m of members) {
      expect(m.similarity).toBeGreaterThan(0);
      expect(m.similarity).toBeLessThanOrEqual(1);
    }
    // The seeds' exact cosines: a1 = 0.9, a2 = 0.895 (fp16 storage).
    const simOf = new Map(members.map((m) => [m.id, m.similarity]));
    expect(simOf.get(a1)).toBeCloseTo(0.9, 2);
    expect(simOf.get(a2)).toBeCloseTo(0.895, 2);
    expect(promoted.known).toBeUndefined();
    expect(promoted.clusterSize).toBe(3);

    // Cluster B: every member is known — the exemplar itself renders as a
    // stub, same id the base run chose, with its known sibling listed
    // (minus the stub's own id).
    const stubbed = res.results.find((r) => [b1, b2].includes(r.id))!;
    expect(stubbed.id).toBe(exemplarB.id);
    expect(stubbed.known).toBe(true);
    expect(stubbed.clusterSize).toBe(2);
    const siblingB = exemplarB.id === b1 ? b2 : b1;
    expect((stubbed.knownClusterMembers ?? []).map((m) => m.id)).toEqual([siblingB]);

    // Ranking/membership invariants: the flat list and the cluster geometry
    // are IDENTICAL with and without the known-set — rendering only.
    expect(res.allResults!.map((r) => r.id)).toEqual(base.allResults!.map((r) => r.id));
    res.allResults!.forEach((r, i) => {
      expect(r.semanticScore).toBeCloseTo(base.allResults![i]!.semanticScore!, 6);
    });
    expect(res.clusters).toEqual(base.clusters);
  });

  it("flat mode: known results keep their true rank, unchanged scores, id-multiset identical", async () => {
    const base = await runPipeline(agent, pageArm(), { expand: true });
    const res = await runPipeline(agent, pageArm(), { expand: true, knownIds: new Set([a1, b2]) });

    expect(res.results.map((r) => r.id)).toEqual(base.results.map((r) => r.id));
    res.results.forEach((r, i) => {
      expect(r.semanticScore).toBeCloseTo(base.results[i]!.semanticScore!, 6);
      expect(r.known).toBe([a1, b2].includes(r.id) ? true : undefined);
    });
  });
});

// ── 4: clusterPool lever (P6) ────────────────────────────────────────────────

describe.skipIf(!BASE)("ranking regression — cluster pool (P6)", () => {
  let agent: Agent;
  // 24 near-topic candidates (axis 1) fill ranks 1–24 with small even score
  // steps (0.900…0.808, step 0.004); a semantically DISTINCT topic (axis 2)
  // sits at ranks 25–27 across a large score cliff (0.808 → 0.60) — outside
  // the perPage-20 window, inside a fixed pool, and exactly the boundary a
  // score-gap pool should find.
  const commonIds: string[] = [];
  const distinctIds: string[] = [];
  const COMMON_SIMS = Array.from({ length: 24 }, (_, i) => 0.9 - i * 0.004);
  const DISTINCT_SIMS = [0.6, 0.59, 0.58];

  beforeAll(async () => {
    agent = await registerAgent("pool");
    const old = "now() - interval '40 days'";
    for (let i = 0; i < COMMON_SIMS.length; i++) {
      commonIds.push(await seedTrace(agent, `PC${i}`, { sim: COMMON_SIMS[i]!, axis: 1, createdAtSql: old }));
    }
    for (let i = 0; i < DISTINCT_SIMS.length; i++) {
      distinctIds.push(await seedTrace(agent, `PD${i}`, { sim: DISTINCT_SIMS[i]!, axis: 2, createdAtSql: old }));
    }
  }, 120_000);

  it("page mode: the distinct topic cannot reach an exemplar (outside the window)", async () => {
    const r = await runPipeline(agent, pageArm(), { k: 2 });
    expect(r.clustered).toBe(true);
    // The clustering input is the page window — top 20 near-topic candidates.
    expect(r.allResults!).toHaveLength(20);
    expect(r.allResults!.every((t) => commonIds.includes(t.id))).toBe(true);
    // So no exemplar can carry the distinct topic.
    for (const t of r.results) {
      expect(distinctIds).not.toContain(t.id);
    }
  });

  it("fixed pool: a distinct-topic exemplar appears, and clusterSize/membership index the pool", async () => {
    const r = await runPipeline(agent, fixedArm(30), { k: 2 }); // pool ⊇ all 27 seeds
    expect(r.clustered).toBe(true);

    // allResults IS the pool in fixed mode — all 27 seeds, ranked.
    const pool = r.allResults!;
    expect(pool).toHaveLength(27);
    expect(pool.slice(24).map((t) => t.id)).toEqual(distinctIds); // ranks 25–27

    // The distinct topic now wins an exemplar slot.
    expect(r.results.some((t) => distinctIds.includes(t.id))).toBe(true);

    // Membership/exemplar indices address the pool, and clusterSize counts
    // pool members: the partition covers all 27, indices beyond the page
    // window (≥20) included, and results[i] ↔ clusters[i] stays index-parallel.
    expect(r.results).toHaveLength(r.clusters!.length);
    const seen = new Set<number>();
    for (let i = 0; i < r.clusters!.length; i++) {
      const c = r.clusters![i]!;
      expect(r.results[i]!.id).toBe(pool[c.exemplarIndex]!.id);
      expect(r.results[i]!.clusterSize).toBe(c.memberCount);
      expect(c.memberIndices).toHaveLength(c.memberCount);
      for (const m of c.memberIndices) seen.add(m);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(pool.map((_, i) => i));
    expect([...seen].some((i) => i >= 20)).toBe(true);
  });

  it("score-gap pool: cuts at the score cliff", async () => {
    // Gap search over [5, 30): the 0.808 → 0.60 cliff at index 24 dwarfs the
    // 0.004 steps, so the pool is exactly the 24 near-topic candidates.
    const r = await runPipeline(agent, gapArm(5, 30), { k: 2 });
    expect(r.clustered).toBe(true);
    expect(r.allResults!).toHaveLength(24);
    expect(r.allResults!.every((t) => commonIds.includes(t.id))).toBe(true);
  });

  it("score-gap pool: minSize clamps the cut above an earlier cliff", async () => {
    // minSize 25 puts the cliff (index 24) below the search range — the
    // largest in-range gap is between the distinct seeds (index 25).
    const r = await runPipeline(agent, gapArm(25, 30), { k: 2 });
    expect(r.allResults!).toHaveLength(25);
    expect(r.allResults!.at(-1)!.id).toBe(distinctIds[0]);
  });

  it("score-gap pool: size caps the search window", async () => {
    // size 20 keeps the search inside the evenly-stepped commons — the cut
    // lands somewhere in [5, 20) (fp16 storage decides the near-tie), never
    // past the cap and never at the out-of-range cliff.
    const r = await runPipeline(agent, gapArm(5, 20), { k: 2 });
    const pool = r.allResults!;
    expect(pool.length).toBeGreaterThanOrEqual(5);
    expect(pool.length).toBeLessThan(20);
    expect(pool.every((t) => commonIds.includes(t.id))).toBe(true);
  });

  it("the shipped default (no ranking param) is byte-identical to the explicit default config", async () => {
    const [withLever, preLever] = await Promise.all([
      runPipeline(agent, defaultArm(), { k: 2 }),
      runPipeline(agent, defaultArm(), { k: 2, omitRanking: true }),
    ]);
    expect(withLever.results.map((t) => t.id)).toEqual(preLever.results.map((t) => t.id));
    expect(withLever.results.map((t) => t.clusterSize)).toEqual(preLever.results.map((t) => t.clusterSize));
    expect(withLever.clusters).toEqual(preLever.clusters);
    expect(withLever.allResults!.map((t) => t.id)).toEqual(preLever.allResults!.map((t) => t.id));
  });

  it("pool never leaks into pagination: flat results identical across pool modes", async () => {
    const [flatPage, flatFixed, flatGap] = await Promise.all([
      runPipeline(agent, pageArm(), { expand: true }),
      runPipeline(agent, fixedArm(30), { expand: true }),
      runPipeline(agent, gapArm(5, 30), { expand: true }),
    ]);
    for (const flat of [flatFixed, flatGap]) {
      expect(flat.results.map((t) => t.id)).toEqual(flatPage.results.map((t) => t.id));
      expect(flat.results.map((t) => t.semanticScore)).toEqual(flatPage.results.map((t) => t.semanticScore));
      expect(flat.totalResults).toBe(flatPage.totalResults);
      expect(flat.totalPages).toBe(flatPage.totalPages);
      expect(flat.results).toHaveLength(20); // the page window, not the pool
    }
  });
});

// ── 4b: cluster display ordering lever (P7, hand-crafted geometry) ───────────

describe.skipIf(!BASE)("ranking regression — cluster ordering (P7)", () => {
  let agent: Agent;
  // Three well-separated clusters whose three ordering keys DISAGREE:
  //   A (axis 1): 3 members, max sim 0.70 — biggest, least similar, evidence 1.
  //   B (axis 2): 2 members, max sim 0.95 — most query-similar, evidence 2.
  //   C (axis 3): 1 member,  sim 0.80     — smallest, evidence-heaviest (5).
  // member-count ⇒ [A, B, C]; max-similarity ⇒ [B, C, A]; evidence-mass ⇒ [C, B, A].
  const aIds: string[] = [];
  const bIds: string[] = [];
  const cIds: string[] = [];
  const groupOf = (id: string): string =>
    aIds.includes(id) ? "A" : bIds.includes(id) ? "B" : cIds.includes(id) ? "C" : "?";

  const memberArm = fixedArm(100); // = DEFAULT_RANKING (fixed:100 + member-count)
  const fixedPool = { mode: "fixed" as const, size: 100, minSize: 20, vectorDims: 768 };
  const maxSimArm = orderArm("max-similarity", fixedPool);
  const evidenceArm = orderArm("evidence-mass", fixedPool);

  beforeAll(async () => {
    agent = await registerAgent("order");
    const old = "now() - interval '40 days'";
    aIds.push(await seedTrace(agent, "OA1", { sim: 0.70, axis: 1, createdAtSql: old }));
    aIds.push(await seedTrace(agent, "OA2", { sim: 0.695, axis: 1, createdAtSql: old }));
    aIds.push(await seedTrace(agent, "OA3", { sim: 0.69, axis: 1, createdAtSql: old }));
    bIds.push(await seedTrace(agent, "OB1", { sim: 0.95, axis: 2, createdAtSql: old }));
    bIds.push(await seedTrace(agent, "OB2", { sim: 0.945, axis: 2, createdAtSql: old }));
    cIds.push(await seedTrace(agent, "OC1", { sim: 0.80, axis: 3, createdAtSql: old }));
    // Evidence mass by cluster: A=1, B=2, C=5 (embedding axis is irrelevant to
    // the count — evidence-mass sums trace_evidence rows).
    await seedEvidence(agent, aIds[0]!, "OEA", { sim: 0.5, axis: 5, createdAtSql: "now()" });
    for (let i = 0; i < 2; i++) {
      await seedEvidence(agent, bIds[0]!, `OEB${i}`, { sim: 0.5, axis: 5, createdAtSql: "now()" });
    }
    for (let i = 0; i < 5; i++) {
      await seedEvidence(agent, cIds[0]!, `OEC${i}`, { sim: 0.5, axis: 5, createdAtSql: "now()" });
    }
  }, 120_000);

  it("max-similarity is the shipped default: explicit config byte-identical to omitting the ranking param", async () => {
    // Since the 2026-07-20 ordering flip (ranking-changelog.md) the no-param
    // default is fixed:100 + max-similarity — [B, C, A] on this geometry.
    const [explicit, omitted] = await Promise.all([
      runPipeline(agent, orderArm("max-similarity", fixedPool), { k: 3 }),
      runPipeline(agent, orderArm("max-similarity", fixedPool), { k: 3, omitRanking: true }),
    ]);
    expect(explicit.results.map((r) => r.id)).toEqual(omitted.results.map((r) => r.id));
    expect(explicit.results.map((r) => r.clusterSize)).toEqual(omitted.results.map((r) => r.clusterSize));
    expect(explicit.clusters).toEqual(omitted.clusters);
    expect(explicit.allResults!.map((r) => r.id)).toEqual(omitted.allResults!.map((r) => r.id));
    expect(omitted.results.map((r) => groupOf(r.id))).toEqual(["B", "C", "A"]);
    // The legacy comparison arm still orders biggest-cluster-first.
    const member = await runPipeline(agent, memberArm, { k: 3 });
    expect(member.results.map((r) => groupOf(r.id))).toEqual(["A", "B", "C"]);
  });

  it("max-similarity permutes cluster ORDER only — same exemplar set, same size multiset, same flat results", async () => {
    const [member, maxSim] = await Promise.all([
      runPipeline(agent, memberArm, { k: 3 }),
      runPipeline(agent, maxSimArm, { k: 3 }),
    ]);
    // Relevance-first: the top-similarity cluster (B) leads, the biggest but
    // least-similar cluster (A — the echo failure mode) drops to last.
    expect(maxSim.results.map((r) => groupOf(r.id))).toEqual(["B", "C", "A"]);
    // A permutation, not a re-cluster: same exemplar SET, same clusterSize
    // multiset, index-parallel results↔clusters preserved.
    const bySize = (a: number | undefined, b: number | undefined) => a! - b!;
    expect(maxSim.results.map((r) => r.id).sort()).toEqual(member.results.map((r) => r.id).sort());
    expect(maxSim.results.map((r) => r.clusterSize).sort(bySize))
      .toEqual(member.results.map((r) => r.clusterSize).sort(bySize));
    expect(maxSim.results).toHaveLength(maxSim.clusters!.length);
    maxSim.results.forEach((r, i) => expect(r.clusterSize).toBe(maxSim.clusters![i]!.memberCount));

    // Flat surface untouched by ordering (same seam discipline as the pool).
    const [flatM, flatS] = await Promise.all([
      runPipeline(agent, memberArm, { expand: true }),
      runPipeline(agent, maxSimArm, { expand: true }),
    ]);
    expect(flatS.results.map((r) => r.id)).toEqual(flatM.results.map((r) => r.id));
    expect(flatS.results.map((r) => r.semanticScore)).toEqual(flatM.results.map((r) => r.semanticScore));
  });

  it("evidence-mass orders clusters by summed member evidence counts (seedEvidence)", async () => {
    const [member, evid] = await Promise.all([
      runPipeline(agent, memberArm, { k: 3 }),
      runPipeline(agent, evidenceArm, { k: 3 }),
    ]);
    // Corroboration weight: C (5 evidence rows) leads, then B (2), then A (1)
    // — an order distinct from both member-count and max-similarity.
    expect(evid.results.map((r) => groupOf(r.id))).toEqual(["C", "B", "A"]);
    // Same permutation invariant: exemplar set and sizes unchanged.
    expect(evid.results.map((r) => r.id).sort()).toEqual(member.results.map((r) => r.id).sort());
  });
});

// ── 4c: MMR display selection over a score-banded pool (P8) ──────────────────

describe.skipIf(!BASE)("ranking regression — display selection (MMR)", () => {
  let agent: Agent;
  // A homogeneous near-duplicate pile at the top of the ranking (12 axis-1
  // seeds, sims 0.900…0.878, all near-identical vectors) followed by 3 axis-2
  // seeds that are semantically DISTINCT but still score within the band
  // (sims 0.85/0.845/0.84 ≥ topScore − 0.15). The distinct topic sits at ranks
  // 13–15 — past a fixed:10 boundary (the "top N are all basically the same"
  // shape), inside the score band. This is the operator's homogeneous-top
  // what-if made concrete: fixed-N-by-count can't reach the distinct topic,
  // score-band-by-value can, and MMR then diversifies onto it.
  const PILE = 12;
  const pileIds: string[] = [];
  const distinctIds: string[] = [];

  const clusterArm = fixedArm(10); // pool = top 10 → the pile only
  const mmrArm = mmrBandArm(0.15, 100, 5); // band 0.15 reaches all 15; MMR diversifies

  beforeAll(async () => {
    agent = await registerAgent("mmr");
    const old = "now() - interval '40 days'";
    for (let i = 0; i < PILE; i++) {
      pileIds.push(await seedTrace(agent, `MP${i}`, { sim: 0.9 - i * 0.002, axis: 1, createdAtSql: old }));
    }
    const distinctSims = [0.85, 0.845, 0.84];
    for (let i = 0; i < distinctSims.length; i++) {
      distinctIds.push(await seedTrace(agent, `MD${i}`, { sim: distinctSims[i]!, axis: 2, createdAtSql: old }));
    }
  }, 120_000);

  it("(a) cluster mode (default) is byte-identical to an omitted ranking param", async () => {
    const [explicit, omitted] = await Promise.all([
      runPipeline(agent, defaultArm(), { k: 3 }),
      runPipeline(agent, defaultArm(), { k: 3, omitRanking: true }),
    ]);
    expect(explicit.results.map((r) => r.id)).toEqual(omitted.results.map((r) => r.id));
    expect(explicit.results.map((r) => r.clusterSize)).toEqual(omitted.results.map((r) => r.clusterSize));
    expect(explicit.clusters).toEqual(omitted.clusters);
  });

  it("(b) MMR + band reaches past the pile: a distinct-topic exemplar the cluster+fixed path cannot display", async () => {
    const [cluster, mmr] = await Promise.all([
      runPipeline(agent, clusterArm, { k: 3 }),
      runPipeline(agent, mmrArm, { k: 3 }),
    ]);
    expect(cluster.clustered).toBe(true);
    expect(mmr.clustered).toBe(true);

    // The fixed:10 pool is the near-duplicate pile — no distinct exemplar can
    // appear (the boundary cut off the distinct topic entirely).
    expect(cluster.allResults!).toHaveLength(10);
    expect(cluster.allResults!.every((t) => pileIds.includes(t.id))).toBe(true);
    for (const r of cluster.results) expect(distinctIds).not.toContain(r.id);

    // The band pool admits all 15 (the homogeneous top extends the reach), and
    // MMR diversifies onto the distinct topic — at least one distinct exemplar.
    expect(mmr.allResults!).toHaveLength(15);
    expect(mmr.results.some((r) => distinctIds.includes(r.id))).toBe(true);
  });

  it("(c) flat results are identical across cluster and MMR modes (display-only lever)", async () => {
    const [flatCluster, flatMmr] = await Promise.all([
      runPipeline(agent, clusterArm, { expand: true }),
      runPipeline(agent, mmrArm, { expand: true }),
    ]);
    expect(flatMmr.results.map((r) => r.id)).toEqual(flatCluster.results.map((r) => r.id));
    expect(flatMmr.results.map((r) => r.semanticScore)).toEqual(flatCluster.results.map((r) => r.semanticScore));
    expect(flatMmr.totalResults).toBe(flatCluster.totalResults);
  });

  it("(d) known-set stubbing flows through the MMR path (rendering only, ranking untouched)", async () => {
    const base = await runPipeline(agent, mmrArm, { k: 3 });
    // Mark the first displayed representative known — the highest-relevance
    // MMR pick, which anchors the pile cluster.
    const rep = base.results[0]!.id;
    const known = new Set([rep]);
    const res = await runPipeline(agent, mmrArm, { k: 3, knownIds: known });

    // The known rep is accounted for as known: either it renders as a stub in
    // place (all-known cluster) or it's promoted aside and listed among a
    // displayed row's known cluster-mates — never shown as a plain full exemplar.
    const knownViaMembers = res.results.some((r) =>
      (r.knownClusterMembers ?? []).some((m) => m.id === rep));
    const knownAsStub = res.results.some((r) => r.id === rep && r.known === true);
    expect(knownViaMembers || knownAsStub).toBe(true);
    const plainFull = res.results.some((r) => r.id === rep && !r.known && !r.knownClusterMembers);
    expect(plainFull).toBe(false);

    // Ranking/membership invariants: MMR selection and its member partition are
    // identical with and without the known-set — rendering only (same contract
    // the k-means path holds in suite 3).
    expect(res.allResults!.map((r) => r.id)).toEqual(base.allResults!.map((r) => r.id));
    expect(res.clusters).toEqual(base.clusters);
  });
});

// ── 5: novel-counted display window (walk mechanics, exact geometry) ─────────

describe.skipIf(!BASE)("ranking regression — novel-counted display window", () => {
  let agent: Agent;
  // 30 seeds in strict rank order (sims 0.900, 0.895, …). The known-set marks
  // ranks 0/2/4/6/8 — knowns interleaved through the top ranks, exactly the
  // shape a session accumulates.
  const ids: string[] = [];
  const KNOWN_RANKS = [0, 2, 4, 6, 8];

  beforeAll(async () => {
    agent = await registerAgent("window");
    const old = "now() - interval '40 days'";
    for (let i = 0; i < 30; i++) {
      ids.push(await seedTrace(agent, `W${i}`, { sim: 0.9 - i * 0.005, axis: 1, createdAtSql: old }));
    }
  }, 120_000);

  const knownSet = () => new Set(KNOWN_RANKS.map((r) => ids[r]!));

  it("window holds exactly perPage NOVEL recipes with knowns as stubs at their true ranks", async () => {
    const r = await runPipeline(agent, pageArm(), { expand: true, perPage: 10, knownIds: knownSet() });
    // Walk: ranks 0..14 — 10 novel (1,3,5,7,9,10,11,12,13,14) + the 5 knowns
    // interleaved in place. Nothing reordered, nothing dropped.
    expect(r.results.map((t) => t.id)).toEqual(ids.slice(0, 15));
    expect(r.results.filter((t) => !t.known)).toHaveLength(10);
    for (let i = 0; i < 15; i++) {
      expect(r.results[i]!.known).toBe(KNOWN_RANKS.includes(i) ? true : undefined);
    }
    // Scores untouched — the walk re-renders and extends, never rescales.
    r.results.forEach((t, i) => {
      expect(t.semanticScore).toBeCloseTo(0.9 - i * 0.005, 2);
    });
  });

  it("offset counts novel items; knowns before the window start are skipped", async () => {
    const r = await runPipeline(agent, pageArm(), { expand: true, page: 2, perPage: 10, knownIds: knownSet() });
    // Page 1 consumed novels at ranks 1..14; page 2 starts at the 11th novel
    // (rank 15) — all knowns sit before the window start and are skipped, so
    // the page is 10 purely-novel recipes.
    expect(r.results.map((t) => t.id)).toEqual(ids.slice(15, 25));
    expect(r.results.every((t) => !t.known)).toBe(true);
  });

  it("sessionless call is byte-identical to pre-walk behavior (plain slice)", async () => {
    const r = await runPipeline(agent, pageArm(), { expand: true, perPage: 10 });
    expect(r.results.map((t) => t.id)).toEqual(ids.slice(0, 10));
    expect(r.results.every((t) => t.known === undefined)).toBe(true);
    expect(r.totalResults).toBe(30);
  });
});

// ── 6: seen accumulation across checks (session_shown, real deposit path) ────

describe.skipIf(!BASE)("ranking regression — seen accumulation across checks (session_shown)", () => {
  let agent: Agent;
  // 26 seeded recipes (no deposit-borne evidence — so the shown-set stays
  // fully observable from the responses) + one hand-seeded evidence row for
  // the evidence-stubbing assert. Probe checks go over HTTP (clusters=20 ⇒
  // the flat surface; perPage is the route's fixed 20), same query text every
  // time so all three arms rank the identical corpus.
  const ids: string[] = [];
  const SESS = `sess-seen-${uid}`;
  const probeText =
    "As a backend developer working on ranking regression fixtures, I prefer the seen-accumulation probe recipe so that display history is exercised end-to-end.";
  let resA: NonNullable<CheckJson["data"]>;
  let resB: NonNullable<CheckJson["data"]>;
  let resC: NonNullable<CheckJson["data"]>;
  let resD: NonNullable<CheckJson["data"]>;
  const fullIds = (res: NonNullable<CheckJson["data"]>) =>
    res.results.filter((r) => !r.known).map((r) => r.recipeId);

  beforeAll(async () => {
    agent = await registerAgent("seen");
    const old = "now() - interval '40 days'";
    for (let i = 0; i < 26; i++) {
      ids.push(await seedTrace(agent, `SN${i}`, { sim: 0.9 - i * 0.005, axis: 1, createdAtSql: old }));
    }
    await seedEvidence(agent, ids[0]!, "E0", { sim: 0.5, axis: 3, createdAtSql: "now()" });

    // A: session token's first check. B: same token, same text (the deposit
    // row is reused, so A/B/C rank the identical corpus and exclude the same
    // own-trace). C: token omitted — the context-compaction refresh.
    // Budgets: since the fixed:100 pool flip (ranking-changelog.md
    // 2026-07-19) a clusters value ≥ corpus size displays EVERY seed, so A
    // and C use clusters=15 (< 26 seeds — a never-shown remainder must exist
    // for B's walk to be observable), while B uses clusters=30 ≥ the corpus
    // so its walked window reads as the degenerate-flat surface (one cluster
    // per result).
    resA = await httpCheck(agent.apiKey, probeText, SESS, "15");
    resB = await httpCheck(agent.apiKey, probeText, SESS, "30");
    resC = await httpCheck(agent.apiKey, probeText, undefined, "15");
    // D: B's sessionless twin (fresh token, same budget) — the pure display
    // the purity test compares B against. Note the HTTP probe embeds via the
    // STUB provider, so the seeds' rank order under this query is arbitrary
    // (deterministic, but NOT the seeded-sim order) — purity is asserted
    // arm-vs-arm, never against the seed array.
    resD = await httpCheck(agent.apiKey, probeText, undefined, "30");
  }, 120_000);

  it("check A (fresh session): a full window of full-text recipes", () => {
    expect(resA.sessionId).toBe(SESS);
    // k=15 exemplars over 26 seeds — strictly fewer than the corpus, so a
    // never-shown remainder exists for B's walk (exact count is k-means's
    // business, not this contract's).
    expect(resA.results.length).toBeGreaterThan(0);
    expect(resA.results.length).toBeLessThan(26);
    expect(resA.results.every((r) => r.known === undefined && !!r.recipe)).toBe(true);
  });

  it("check B (same session): everything A displayed returns as stubs AND the window walks to new full-text recipes", () => {
    // A's display history = its full-text results PLUS its full-text
    // related-evidence parents (both recording paths of seam 2).
    const shownByA = new Set([
      ...fullIds(resA),
      // Every relatedEvidence row is full text by construction now — known
      // parents ride relatedEvidenceKnown instead (2026-07-18 reshape).
      ...(resA.relatedEvidence ?? []).map((e) => e.recipeId),
    ]);
    // Every full-text recipe A displayed is now an id-only stub at its rank.
    for (const r of resB.results) {
      if (shownByA.has(r.recipeId)) {
        expect(r.known).toBe(true);
        expect(r.recipe).toBeUndefined();
      }
    }
    // And the window walked down: the recipes B carries in full are exactly
    // the corpus remainder A never displayed — something new each time.
    const novelInB = fullIds(resB);
    expect(novelInB.length).toBeGreaterThan(0);
    const remainder = ids.filter((id) => !shownByA.has(id)).sort();
    expect([...novelInB].sort()).toEqual(remainder);
    // Stubs + the novel remainder = the whole corpus in one walked window.
    expect(resB.results).toHaveLength(26);
  });

  it("evidence parents shown in A move to B's relatedEvidenceKnown id list (2026-07-18 reshape: no per-row stubs)", () => {
    const evA = resA.relatedEvidence?.find((e) => e.recipeId === ids[0]);
    expect(evA).toBeDefined();
    expect(evA!.recipe).toBeTruthy();
    expect(evA!.evidence?.[0]?.interpretation).toBeTruthy();
    // In B the parent is known: it never appears as a relatedEvidence row —
    // it rides relatedEvidenceKnown as {recipeId, similarity} instead
    // (recipe ef245b63: id + best evidence similarity, in [0, 1]).
    expect(resB.relatedEvidence?.some((e) => e.recipeId === ids[0])).toBeFalsy();
    const knownParent = resB.relatedEvidenceKnown?.find((p) => p.recipeId === ids[0]);
    expect(knownParent).toBeDefined();
    expect(knownParent!.similarity).toBeGreaterThan(0);
    expect(knownParent!.similarity).toBeLessThanOrEqual(1);
  });

  it("stub rows are trimmed: no createdAt, no recipe text (operator ruling 2026-07-18)", () => {
    const stub = resB.results.find((r) => r.known === true);
    expect(stub).toBeDefined();
    expect(stub!.createdAt).toBeUndefined();
    expect(stub!.recipe).toBeUndefined();
  });

  it("a real check response parses with the published CheckResponseSchema (the strongest drift guard)", async () => {
    // Same probe text + token: the deposit row is reused and the response is
    // stub-rich (known results, known evidence parents) — the fullest wire
    // shape. Parsing the RAW body with the canonical zod schema from
    // @soupnet/contracts is exactly the validation an external consumer runs
    // against GET /schemas/check-response.json; a builder field the schema
    // doesn't know (or a schema field the builder breaks) fails here.
    const { CheckResponseSchema } = await import("@soupnet/contracts");
    const params = new URLSearchParams({
      key: agent.apiKey,
      trace: probeText,
      ef: 'Fixture interpretation.\n> "fixture quote"\n-- ranking-regression test',
      format: "json",
      clusters: "30",
      session_id: SESS,
    });
    const raw = (await (await fetch(`${BASE}/check?${params.toString()}`, {
      headers: { Accept: "application/json" },
    })).json()) as unknown;
    const parsed = CheckResponseSchema.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.checked?.recipeId).toBeTruthy();
    expect(parsed.data?.results?.length).toBeGreaterThan(0);
    expect(parsed.data?.results?.some((r) => r.known === true)).toBe(true);
    expect(parsed.data?.relatedEvidenceKnown?.length).toBeGreaterThan(0);
  });

  it("check C (token omitted): full texts again — the context-compaction refresh affordance", () => {
    expect(resC.sessionId).toBeTruthy();
    expect(resC.sessionId).not.toBe(SESS);
    expect(resC.results.map((r) => r.recipeId)).toEqual(resA.results.map((r) => r.recipeId));
    expect(resC.results.every((r) => r.known === undefined && !!r.recipe)).toBe(true);
  });

  it("evidence proportionality: a filter-narrowed check with 1 result carries at most 3 evidence entries", async () => {
    // Operator finding 2026-07-18: a keyword-narrowed check with a single
    // result carried 20 evidence entries. The evidence budget is now capped
    // at max(3, displayed-full-result count). The seen suite's corpus has 26
    // traces but only ONE evidence row, so this uses its own probe: narrow
    // to one trace by full-claim keyword filter with a high k — the
    // uncapped targetCount would be k.
    const db = getDb();
    // Give four more corpus traces evidence so candidates (5) exceed the cap.
    for (let i = 1; i <= 4; i++) {
      await seedEvidence(agent, ids[i]!, `EP${i}`, { sim: 0.5 - i * 0.01, axis: 3, createdAtSql: "now()" });
    }
    const claimRows = (await db.execute(sql`
      SELECT claim_text AS claim FROM claimnet.traces WHERE id = ${ids[3]}::uuid
    `)) as unknown as Array<{ claim: string }>;
    const res = await runSearchPipeline({
      db,
      groupIds: [agent.groupId],
      query: "unused — queryVectorStr provided",
      queryVectorStr: toPgVec(dirVec(1, 1)),
      keywordFilter: claimRows[0]!.claim, // narrows results to exactly one trace
      k: 5,
      perPage: 20,
      ranking: DEFAULT_RANKING,
    });
    expect(res.results).toHaveLength(1);
    expect(res.relatedEvidence).toBeDefined();
    expect(res.relatedEvidence!.length).toBeLessThanOrEqual(3);
    expect(res.relatedEvidence!.length).toBeGreaterThan(1); // floor keeps adjacent context
  });

  it("ranking purity: flat order identical across the session arms — seen state re-renders, never reorders", () => {
    const idsA = resA.results.map((r) => r.recipeId);
    const idsB = resB.results.map((r) => r.recipeId);
    const idsC = resC.results.map((r) => r.recipeId);
    const idsD = resD.results.map((r) => r.recipeId);
    // Purity is arm-vs-arm at EQUAL budgets: the session arm's walked window
    // (B) must be id-for-id the sessionless twin's display (D) — seen state
    // re-renders rows as stubs, never reorders, never drops. Same for the
    // k=15 pair (C vs A). Cross-budget comparisons are meaningless (A's
    // exemplars are not a flat prefix), and the seed array is NOT a valid
    // reference (the HTTP probe embeds via the stub provider, so rank order
    // under this query is deterministic but unrelated to seeded sims).
    expect(idsB).toEqual(idsD);
    expect(idsC).toEqual(idsA);
    // Per-id displayed scores identical across arms (stub or full).
    const scoreA = new Map(resA.results.map((r) => [r.recipeId, r.similarity]));
    for (const r of [...resB.results, ...resC.results, ...resD.results]) {
      const a = scoreA.get(r.recipeId);
      if (a !== null && a !== undefined && r.similarity !== null) {
        expect(r.similarity).toBeCloseTo(a, 6);
      }
    }
  });
});
