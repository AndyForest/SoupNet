import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { DEFAULT_RANKING } from "@soupnet/domain";
import type { RankingConfig } from "@soupnet/domain";
import { shareAtK, kendallTau } from "../eval/metrics";

/**
 * Ranking-pipeline regression tests — full-stack, over the REAL
 * runSearchPipeline (retrieval → scoring/demotion → clustering → cluster
 * ordering → exemplar selection), not just hybridSearch.
 *
 * Layer A of the offline regression harness
 * (docs/planning/check-recipe-ranking-system.md §3b): runs inside the normal
 * test:ci quality gate with zero new CI wiring. Semantic-quality metrics live
 * in Layer B (apps/backend/src/eval/ranking-eval.ts, golden datasets, local
 * embeddings); this file proves the MECHANISMS with hand-crafted unit vectors
 * so cosine scores are exact (same seeding pattern as
 * vector-search.echo.test.ts — no dependence on the embedding provider).
 *
 * What it locks down:
 *   1. The §2 rulings as exact asserts: result-id multiset identical across
 *      ranking arms (reorder, never truncate); per-id semanticScore identical
 *      across arms (displayed percentages never mutated); the
 *      clusters[i].exemplarIndex ↔ results[i] index-parallel contract.
 *   2. The echo-exposure waterfall on a seeded polluted set — echo share
 *      measured at the flat stage AND the displayed-cluster stages, so
 *      "absorbed downstream" is a first-class assert (the §3d mechanism
 *      proof: demotion-adjusted-mass cluster ordering reaches what the
 *      caller sees first; member-count ordering does not).
 *   3. Guardrail: a query whose candidates contain no same-key traces is
 *      byte-stable across arms (Kendall tau = 1 exactly).
 *   4. Curation exemptions: decided_at (shipped ON) and the two corroboration
 *      flags (human still_true reaction, cross-key fulfilled check-feedback)
 *      exempt a candidate from demotion ONLY when their flag is on.
 *
 * Requires a running backend + postgres (skipped otherwise) — registration
 * goes over HTTP; seeding and pipeline calls hit the DB directly.
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

const DIMS = 3072;

/**
 * Unit vector with `sim` on dim 0 and the residual mass on `axis` — cosine to
 * the query e0 is exactly `sim`, while the residual axis controls cluster
 * geometry: seeds sharing an axis are near-identical to each other
 * (cos ≈ sim_i·sim_j + b_i·b_j), seeds on different axes only share the query
 * component (cos = sim_i·sim_j), so k-means separates the groups regardless
 * of arrival order.
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
}

/** Register + verify + login + mint a daily key over HTTP — gives an isolated
 *  user/recipe-book/api-key triple per describe block (fixture isolation:
 *  each block's group contains only its own seeds). */
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
  return { userId: kr.userId, groupId: kr.defaultWriteGroupId, keyId: kr.keyId };
}

interface SeedSpec {
  sim: number;
  axis: number;
  apiKeyId: string;
  /** SQL expression for created_at — the append time (echo signal). */
  createdAtSql: string;
  decidedAt?: string;
}

/** Insert a trace plus a complete full_document embedding row with the
 *  hand-crafted vector (same chain the echo test seeds). Returns the trace id. */
async function seedTrace(agent: Agent, label: string, spec: SeedSpec): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const claim = `rankreg-${uid}-${label}`;
  const claimHash = crypto.createHash("sha256").update(claim).digest("hex");
  const chunkHash = crypto.createHash("sha256").update(`${claim}-chunk`).digest("hex");

  await db.execute(sql`
    INSERT INTO claimnet.traces (id, user_id, group_id, api_key_id, claim_text, claim_text_hash, decided_at, created_at)
    VALUES (${id}::uuid, ${agent.userId}::uuid, ${agent.groupId}::uuid, ${spec.apiKeyId}::uuid, ${claim}, ${claimHash},
            ${spec.decidedAt ?? null}::timestamptz, ${sql.raw(spec.createdAtSql)})
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

/** The three ranking arms under comparison. */
function arms(): { off: RankingConfig; on: RankingConfig; mass: RankingConfig } {
  const off = DEFAULT_RANKING; // echo disabled, member-count — shipped defaults
  const on: RankingConfig = {
    ...DEFAULT_RANKING,
    echo: { ...DEFAULT_RANKING.echo, enabled: true },
  };
  const mass: RankingConfig = { ...on, clusterOrdering: "demotion-adjusted-mass" };
  return { off, on, mass };
}

/** Drive the real pipeline: query mode + clustering, echo context built from
 *  the same RankingConfig every stage reads. */
function runPipeline(agent: Agent, rc: RankingConfig, opts?: { k?: number; currentApiKeyId?: string }) {
  return runSearchPipeline({
    db: getDb(),
    groupIds: [agent.groupId],
    query: "unused — queryVectorStr provided",
    queryVectorStr: Q,
    k: opts?.k,
    perPage: 20,
    echo: {
      config: rc.echo,
      exemption: rc.exemption,
      currentApiKeyId: opts?.currentApiKeyId ?? agent.keyId,
      now: new Date(),
    },
    ranking: rc,
  });
}

beforeAll(async () => {
  if (!BASE) return;
  getDb = (await import("../db")).getDb;
  sql = (await import("drizzle-orm")).sql;
  runSearchPipeline = (await import("./search-pipeline")).runSearchPipeline;
  validateKey = (await import("./api-key.service")).validateKey;
  getEmbeddingModelId = (await import("../lib/embeddings/provider")).getEmbeddingModelId;
});

// ── 1+2+3: invariants, waterfall, guardrail (polluted seed set) ──────────────

describe.skipIf(!BASE)("ranking regression — pipeline invariants + echo waterfall", () => {
  let agent: Agent;
  // Polluted set: 4 same-key SAME-SESSION echoes with slightly HIGHER
  // similarity than 3 cross-agent durable recipes (the measured pollution
  // shape from docs/planning/check-recipe-ranking-system.md §1). Echoes on
  // axis 1, durables on axis 2 → k=2 clustering separates them, and the echo
  // cluster wins raw memberCount (4 > 3) while losing demotion-adjusted mass
  // (Σ sim·(1−0.5) = 1.74 < Σ sim = 2.55).
  const echoIds: string[] = [];
  const durableIds: string[] = [];

  beforeAll(async () => {
    agent = await registerAgent("waterfall");
    const echoSims = [0.9, 0.88, 0.86, 0.84];
    const durableSims = [0.87, 0.85, 0.83];
    const crossKey = crypto.randomUUID();
    for (let i = 0; i < echoSims.length; i++) {
      echoIds.push(await seedTrace(agent, `E${i}`, {
        sim: echoSims[i]!, axis: 1, apiKeyId: agent.keyId, createdAtSql: "now()",
      }));
    }
    for (let i = 0; i < durableSims.length; i++) {
      durableIds.push(await seedTrace(agent, `D${i}`, {
        sim: durableSims[i]!, axis: 2, apiKeyId: crossKey, createdAtSql: "now() - interval '40 days'",
      }));
    }
  }, 60_000);

  it("§2 rulings hold as exact asserts across all three arms", async () => {
    const { off, on, mass } = arms();
    const [rOff, rOn, rMass] = await Promise.all([
      runPipeline(agent, off, { k: 2 }),
      runPipeline(agent, on, { k: 2 }),
      runPipeline(agent, mass, { k: 2 }),
    ]);
    const seedIds = [...echoIds, ...durableIds].sort();

    for (const r of [rOff, rOn, rMass]) {
      expect(r.clustered).toBe(true);
      const flat = r.allResults!;

      // No truncation, ever: the flat result-id multiset is exactly the seeds.
      expect(flat.map((t) => t.id).sort()).toEqual(seedIds);

      // Index-parallel contract: results[i] IS the exemplar row that
      // clusters[i].exemplarIndex points at, and memberIndices partition the
      // flat list.
      expect(r.results).toHaveLength(r.clusters!.length);
      const seen = new Set<number>();
      for (let i = 0; i < r.clusters!.length; i++) {
        const c = r.clusters![i]!;
        expect(r.results[i]!.id).toBe(flat[c.exemplarIndex]!.id);
        expect(c.memberIndices).toContain(c.exemplarIndex);
        expect(c.memberIndices).toHaveLength(c.memberCount);
        for (const m of c.memberIndices) seen.add(m);
      }
      expect([...seen].sort((a, b) => a - b)).toEqual(flat.map((_, i) => i));
    }

    // Displayed percentages never mutated: per-id semanticScore identical
    // across arms (demotion reorders; it never rescales what's shown).
    const scores = (r: typeof rOff) =>
      new Map(r.allResults!.map((t) => [t.id, t.semanticScore]));
    const offScores = scores(rOff);
    for (const r of [rOn, rMass]) {
      for (const [id, score] of scores(r)) {
        expect(score).toBeCloseTo(offScores.get(id)!, 6);
      }
    }
  });

  it("waterfall: demotion wins the flat stage; only mass ordering carries it into the displayed clusters", async () => {
    const { off, on, mass } = arms();
    const [rOff, rOn, rMass] = await Promise.all([
      runPipeline(agent, off, { k: 2 }),
      runPipeline(agent, on, { k: 2 }),
      runPipeline(agent, mass, { k: 2 }),
    ]);
    const echoSet = new Set(echoIds);
    const flatIds = (r: typeof rOff) => r.allResults!.map((t) => t.id);

    // Stage 1 — flat top-3 (post-demotion): echo-on beats echo-off exactly.
    // Off: E1 .90, E2 .88, D1 .87 → 2/3. On: demoted echoes (.45…) sink below
    // every durable → 0.
    expect(shareAtK(flatIds(rOff), echoSet, 3)).toBeCloseTo(2 / 3, 10);
    expect(shareAtK(flatIds(rOn), echoSet, 3)).toBe(0);

    // Stage 2 — displayed cluster exemplars: with member-count ordering the
    // echo cluster (4 members) still leads the display — demotion's benefit is
    // absorbed at cluster ordering (§1.2, the motivating failure). With
    // demotion-adjusted mass, the durable cluster leads.
    expect(echoSet.has(rOn.results[0]!.id)).toBe(true);
    expect(echoSet.has(rMass.results[0]!.id)).toBe(false);

    // Stage 3 — the #1 displayed cluster: all-echo under member-count,
    // echo-free under demotion-adjusted mass.
    const topClusterEchoShare = (r: typeof rOff) => {
      const flat = r.allResults!;
      const memberIds = r.clusters![0]!.memberIndices.map((i) => flat[i]!.id);
      return shareAtK(memberIds, echoSet);
    };
    expect(topClusterEchoShare(rOn)).toBe(1);
    expect(topClusterEchoShare(rMass)).toBe(0);

    // Reorder only: cluster MEMBERSHIP is identical between the two ordered
    // arms — only the display order of the clusters changed.
    const membership = (r: typeof rOff) =>
      r.clusters!.map((c) => c.memberIndices.map((i) => r.allResults![i]!.id).sort())
        .sort((a, b) => a[0]!.localeCompare(b[0]!));
    expect(membership(rMass)).toEqual(membership(rOn));
  });

  it("guardrail: no same-key candidates ⇒ arms identical (Kendall tau = 1 exactly)", async () => {
    const { off, on } = arms();
    // A key that authored none of the candidates — the demotion predicate
    // matches nothing, so echo-on must be a byte-stable identity reorder.
    const strangerKey = crypto.randomUUID();
    const [rOff, rOn] = await Promise.all([
      runPipeline(agent, off, { currentApiKeyId: strangerKey }),
      runPipeline(agent, on, { currentApiKeyId: strangerKey }),
    ]);
    const idsOff = rOff.results.map((t) => t.id);
    const idsOn = rOn.results.map((t) => t.id);
    expect(idsOn).toEqual(idsOff);
    expect(kendallTau(idsOn, idsOff)).toBe(1);
  });
});

// ── 4: curation exemption flags ──────────────────────────────────────────────

describe.skipIf(!BASE)("ranking regression — curation exemption flags", () => {
  let agent: Agent;
  let xd = ""; // same-key recent, decided_at set        → exempt via decidedAt (shipped ON)
  let xr = ""; // same-key recent, human still_true row  → exempt only when humanReaction is on
  let xf = ""; // same-key recent, cross-key feedback    → exempt only when crossAgentFeedback is on
  let xn = ""; // same-key recent, plain hypothesis      → always demoted when echo is on
  let oc = ""; // cross-agent old                        → never demoted (reference point)

  beforeAll(async () => {
    agent = await registerAgent("exempt");
    const crossKey = crypto.randomUUID();
    const now = "now()";
    xd = await seedTrace(agent, "XD", { sim: 0.95, axis: 1, apiKeyId: agent.keyId, createdAtSql: now, decidedAt: "2024-01-01T00:00:00Z" });
    xr = await seedTrace(agent, "XR", { sim: 0.94, axis: 1, apiKeyId: agent.keyId, createdAtSql: now });
    xf = await seedTrace(agent, "XF", { sim: 0.93, axis: 1, apiKeyId: agent.keyId, createdAtSql: now });
    xn = await seedTrace(agent, "XN", { sim: 0.92, axis: 1, apiKeyId: agent.keyId, createdAtSql: now });
    // Demoted same-session scores land at sim·0.5 ≤ .475 — OC at .60 sits
    // between exempt (undemoted) and demoted candidates, making each
    // exemption visible as "ranks above OC".
    oc = await seedTrace(agent, "OC", { sim: 0.6, axis: 2, apiKeyId: crossKey, createdAtSql: "now() - interval '40 days'" });

    const db = getDb();
    // Human corroboration for XR: a still_true reaction (the only reaction
    // with curation polarity).
    await db.execute(sql`
      INSERT INTO claimnet.trace_reactions (trace_id, user_id, reaction)
      VALUES (${xr}::uuid, ${agent.userId}::uuid, 'still_true')
    `);
    // Cross-agent corroboration for XF: a DIFFERENT key's check-feedback row
    // whose story was fulfilled.
    await db.execute(sql`
      INSERT INTO claimnet.check_feedback (trace_id, api_key_id, kind, impact, disposition, story_fulfilled, story)
      VALUES (${xf}::uuid, ${crossKey}::uuid, 'check-feedback', 'new', 'proceeded', 'yes',
              'ranking-regression fixture: cross-agent corroboration for exemption test')
    `);
  }, 60_000);

  const order = async (rc: RankingConfig) =>
    (await runPipeline(agent, rc)).results.map((t) => t.id);

  it("decided_at exempts (shipped default); corroborated rows are still demoted while their flags are off", async () => {
    const { on } = arms(); // exemption: decidedAt only
    expect(await order(on)).toEqual([xd, oc, xr, xf, xn]);
  });

  it("humanReaction flag ON exempts the still_true-corroborated row (and only it)", async () => {
    const { on } = arms();
    const rc: RankingConfig = { ...on, exemption: { ...on.exemption, humanReaction: true } };
    expect(await order(rc)).toEqual([xd, xr, oc, xf, xn]);
  });

  it("crossAgentFeedback flag ON exempts the cross-key-corroborated row (and only it)", async () => {
    const { on } = arms();
    const rc: RankingConfig = { ...on, exemption: { ...on.exemption, crossAgentFeedback: true } };
    expect(await order(rc)).toEqual([xd, xf, oc, xr, xn]);
  });

  it("echo off: pure relevance order regardless of corroboration rows", async () => {
    const { off } = arms();
    expect(await order(off)).toEqual([xd, xr, xf, xn, oc]);
  });
});
