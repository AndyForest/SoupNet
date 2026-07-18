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
 *      replaced for display by the next-nearest non-known member with
 *      promotedOverKnownIds carrying the stub; an all-known cluster renders a
 *      stub exemplar. Id-multiset + display-score invariants hold across a
 *      with/without-session pair.
 *   4. The clusterPool lever (P6): "page" mode is byte-identical to the
 *      pre-lever caller shape; "fixed" reaches diversity outside the page
 *      window; "score-gap" cuts the pool at the largest score cliff, clamped
 *      by minSize/size; the pool never leaks into flat pagination.
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
  },
) {
  return runSearchPipeline({
    db: getDb(),
    groupIds: [agent.groupId],
    query: "unused — queryVectorStr provided",
    queryVectorStr: Q,
    k: opts?.k,
    expand: opts?.expand,
    perPage: 20,
    knownIds: opts?.knownIds,
    ranking: opts?.omitRanking ? undefined : rc,
  });
}

const pageArm = (): RankingConfig => DEFAULT_RANKING; // clusterPool: page (legacy)
const fixedArm = (size: number): RankingConfig => ({
  clusterPool: { mode: "fixed", size, minSize: 20, vectorDims: 768 },
});
const gapArm = (minSize: number, size: number): RankingConfig => ({
  clusterPool: { mode: "score-gap", size, minSize, vectorDims: 768 },
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
    recipeId: string;
    sessionId?: string;
    results: Array<{
      id: string;
      known?: boolean;
      recipe?: string;
      score: { semantic: number | null };
      knownStubs?: Array<{ id: string; known: boolean }>;
    }>;
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
): Promise<NonNullable<CheckJson["data"]>> {
  const params = new URLSearchParams({
    key,
    trace: traceText,
    ef: 'Fixture interpretation.\n> "fixture quote"\n-- ranking-regression test',
    format: "json",
    clusters: "20",
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

  const recipeText = (label: string) =>
    `As a backend developer working on ranking regression fixtures, I prefer the ${label} probe recipe so that orderings stay deterministic.`;

  const check = (key: string, label: string, sessionId?: string) =>
    httpCheck(key, recipeText(label), sessionId);

  beforeAll(async () => {
    agent = await registerAgent("session");
    scopedKey = await mintScopedKey(agent);
    // Corpus deposits, each under a controlled session (stub embeddings —
    // deterministic per text, so orderings are exactly reproducible).
    d1 = (await check(agent.apiKey, "alpha", SESS_A)).recipeId;
    d2 = (await check(agent.apiKey, "beta", SESS_A)).recipeId;
    d3 = (await check(agent.apiKey, "gamma", SESS_B)).recipeId;
    await check(agent.apiKey, "delta"); // sessionless deposit
  }, 60_000);

  it("seam 1: identical inputs under different api_keys (same read scope) return identical ordering", async () => {
    // Run the probe with the daily key, then RESTORE the corpus (delete its
    // deposit — awaited direct-db cleanup) and run the byte-identical probe
    // with the scoped key — both checks exclude their own deposit, so both
    // rank the same corpus.
    const resA = await check(agent.apiKey, "purefn");
    await deleteDeposit(agent, resA.recipeId);
    const resB = await check(scopedKey, "purefn");
    await deleteDeposit(agent, resB.recipeId);

    expect(resB.results.map((r) => r.id)).toEqual(resA.results.map((r) => r.id));
    resB.results.forEach((r, i) => {
      expect(r.score.semantic).toBeCloseTo(resA.results[i]!.score.semantic!, 6);
    });
  });

  it("seam 1: a session_id changes NOTHING about ranking/membership — only stub flags", async () => {
    // Same key + same text ⇒ the deposit row is REUSED (ON CONFLICT DO
    // NOTHING), so both runs rank the identical corpus and exclude the same
    // own-trace. Only the presented session token differs.
    const withSession = await check(agent.apiKey, "sessprobe", SESS_A);
    const freshSession = await check(agent.apiKey, "sessprobe", `sess-f-${uid}`);

    expect(freshSession.results.map((r) => r.id)).toEqual(withSession.results.map((r) => r.id));
    freshSession.results.forEach((r, i) => {
      expect(r.score.semantic).toBeCloseTo(withSession.results[i]!.score.semantic!, 6);
    });

    // SESS_A's deposits are flagged known ONLY under SESS_A — at their true,
    // unchanged rank, as id-only stubs (no recipe text); the fresh session
    // gets them in full.
    for (const id of [d1, d2]) {
      const flaggedIdx = withSession.results.findIndex((r) => r.id === id);
      const freshIdx = freshSession.results.findIndex((r) => r.id === id);
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

  it("seam 2: sibling-session deposits on the same key render fully — never stubbed, never reordered", async () => {
    // Checking under SESS_B: SESS_A's deposits (same api_key, different
    // session) are sibling work — the cross-communication channel — and must
    // arrive as full recipes; only SESS_B's own deposit is stubbed.
    const res = await check(agent.apiKey, "siblingprobe", SESS_B);
    for (const id of [d1, d2]) {
      const sibling = res.results.find((r) => r.id === id)!;
      expect(sibling).toBeDefined();
      expect(sibling.known).toBeUndefined();
      expect(sibling.recipe).toBeTruthy();
    }
    const own = res.results.find((r) => r.id === d3)!;
    expect(own.known).toBe(true);
    expect(own.recipe).toBeUndefined();

    // The response echoes the effective session token (self-healing channel).
    expect(res.sessionId).toBe(SESS_B);
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

  it("known exemplar → next-nearest non-known member promoted with the stub id; all-known cluster → stub exemplar", async () => {
    const base = await runPipeline(agent, pageArm(), { k: 2 });
    expect(base.clustered).toBe(true);

    const clusterAIds = [a1, a2, n];
    const exemplarA = base.results.find((r) => clusterAIds.includes(r.id))!;
    const exemplarB = base.results.find((r) => [b1, b2].includes(r.id))!;
    expect([a1, a2]).toContain(exemplarA.id); // N is clearly farther from A's centroid

    const known = new Set([a1, a2, b1, b2]);
    const res = await runPipeline(agent, pageArm(), { k: 2, knownIds: known });

    // Cluster A: the known exemplar is replaced for display by the
    // next-nearest non-known member (N — the only candidate), with the known
    // id carried as a stub and the cluster size untouched.
    const promoted = res.results.find((r) => r.id === n)!;
    expect(promoted).toBeDefined();
    expect(promoted.promotedOverKnownIds).toEqual([exemplarA.id]);
    expect(promoted.known).toBeUndefined();
    expect(promoted.clusterSize).toBe(3);

    // Cluster B: every member is known — the exemplar itself renders as a
    // stub, same id the base run chose.
    const stubbed = res.results.find((r) => [b1, b2].includes(r.id))!;
    expect(stubbed.id).toBe(exemplarB.id);
    expect(stubbed.known).toBe(true);
    expect(stubbed.clusterSize).toBe(2);

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

  it("page mode is byte-identical to a run with no ranking param at all (pre-lever shape)", async () => {
    const [withLever, preLever] = await Promise.all([
      runPipeline(agent, pageArm(), { k: 2 }),
      runPipeline(agent, pageArm(), { k: 2, omitRanking: true }),
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
