/* eslint-disable no-console -- CLI entry point: the console summary IS the product */
/**
 * Golden-set ranking eval — Layer B of the offline regression harness
 * (workflow: docs/workflows/ranking-tuning.md; engine contract:
 * docs/planning/session-novelty-and-pool-diversity.md, plan v2).
 *
 * One offline run: imports a golden corpus (import-format export payload) into
 * a throwaway database, backfills full_document embeddings SYNCHRONOUSLY per
 * trace through the same cache-first path the check route uses (vector_cache
 * is content-hash keyed, so repeat runs against a persistent DB re-embed
 * nothing), then drives every golden question through the REAL
 * runSearchPipeline under each ranking variant and computes the memo-derived
 * metrics (see eval/metrics.ts). Exits non-zero on any thresholds.json breach.
 *
 * Requires a REAL semantic embedding provider — EMBEDDINGS_PROVIDER=local
 * (bge-small via ONNX, keyless) is the intended one. Stub embeddings are
 * near-orthogonal between distinct texts and CANNOT verify semantic ranking
 * (the reason ci.yml's local-embeddings-smoke job exists), so the runner
 * refuses to run under stub unless RANKEVAL_ALLOW_STUB=1 (plumbing debug only).
 *
 * Invocation (scripts/ranking-eval.mjs boots the throwaway postgres and calls
 * this; CI's ranking-eval job points it at the job's postgres service):
 *
 *     npx tsx apps/backend/src/eval/ranking-eval.ts [--dataset <dir>]
 *
 * Corpus arms — the HYGIENE scenario (plan v2 seam 3: run isolation is the
 * benchmark's job; "pollution" is one agent lineage re-depositing over its own
 * corpus, i.e. bad benchmark hygiene, not a product defect):
 *   - hygiene-polluted: the full corpus including the session-lineage
 *     deposits, imported first so trace ids stay canonical.
 *   - hygiene-clean: the corpus minus meta.sessionLineages — the properly
 *     isolated run, imported by a SECOND eval user (the import service's
 *     deterministic mint isolates the arm and returns the id remap).
 *
 * Ranking variants (P6 proving arms — ranking is a pure function, so these
 * differ only in the clustering-pool boundary):
 *   - baseline:       DEFAULT_RANKING (page pool — legacy)
 *   - pool-fixed100:  fixed:100 clustering pool @ 768-dim pool vectors
 *   - pool-score-gap: score-gap pool (largest gap in [20, 133]) @ 768 dims
 *
 * Calls per question × arm × variant: an expanded flat call for the
 * whole-list metrics, a production-shaped clustered call (perPage 20) for the
 * display metrics, and — on session questions in the hygiene-polluted arm — a
 * session overlay of the display call (knownIds from the stamped
 * traces.session_id lineages) for tokenEfficiency + siblingVisibility.
 */

import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DEFAULT_RANKING, RANKING_ALGORITHM_VERSION } from "@soupnet/domain";
import type { RankingConfig } from "@soupnet/domain";
import {
  ndcg,
  recallAtK,
  kendallTau,
  serendipityAtL,
  aspectCoverage,
  mean,
} from "./metrics";
import type { SerendipityItem } from "./metrics";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

// ── Fixture types (documented in eval/golden/README.md) ─────────────────────

interface GoldenQuestion {
  id: string;
  /** Recipe-shaped query text, exactly as an agent would check it. */
  query: string;
  /** Trace id → grade 0–3 (0-grades may be omitted; absent = 0). */
  graded: Record<string, number>;
  /** Session-lineage names (meta.sessionLineages values) whose deposits form
   *  the querying agent's known-set for the session overlay measurement. */
  sessions?: string[];
  /** Stability-guardrail question (Kendall tau vs baseline must be 1). */
  unaffected?: boolean;
  /** Trace id → aspect label, for cluster-aspect coverage. */
  aspects?: Record<string, string>;
  /** Cluster count for this question (default: meta.clusters, then 3). */
  clusters?: number;
}

interface GoldenMeta {
  /** Reference "now" — kept so fixture created_at timestamps stay meaningful
   *  (the runner's known-set derivation is stamped-column-based rather than
   *  wall-clock-window-based, mirroring production's session query shape
   *  without time fragility). */
  referenceNow: string;
  /** Trace id → session-lineage name. The runner mints one session token per
   *  lineage per run, stamps traces.session_id on these rows (imports leave
   *  it NULL), and derives per-question known-sets from the stamped column. */
  sessionLineages: Record<string, string>;
  /** Default cluster count for questions (default 3). */
  clusters?: number;
}

interface ThresholdRule {
  /** Dotted path into the aggregates object, e.g.
   *  "arms.hygiene-polluted.pool-score-gap.aspectCoverage". */
  metric: string;
  min?: number;
  max?: number;
  /** Mandatory: why this bound, and what run calibrated it. */
  rationale: string;
}

const MAX_GRADE = 3;
const VARIANTS = ["baseline", "pool-fixed100", "pool-score-gap"] as const;
type VariantName = (typeof VARIANTS)[number];
const ARMS = ["hygiene-polluted", "hygiene-clean"] as const;
type ArmName = (typeof ARMS)[number];

function variantConfig(name: VariantName): RankingConfig {
  switch (name) {
    case "baseline":
      return DEFAULT_RANKING; // page pool — legacy
    case "pool-fixed100":
      // Fixed-cap comparison arm (fixture-relative by design — scaffolding
      // for the sweep, not the target; candidate-pool-sizing memo).
      return { clusterPool: { mode: "fixed", size: 100, minSize: 20, vectorDims: 768 } };
    case "pool-score-gap":
      // The measured candidate: relevance-bounded boundary at the largest
      // score gap, searched between the default minSize/size bounds.
      return {
        clusterPool: {
          mode: "score-gap",
          size: DEFAULT_RANKING.clusterPool.size,
          minSize: DEFAULT_RANKING.clusterPool.minSize,
          vectorDims: 768,
        },
      };
  }
}

// ── Per-question measurement ─────────────────────────────────────────────────

interface QuestionMeasurement {
  ndcgFull: number;
  ndcg5: number;
  ndcg10: number;
  ndcg20: number;
  relevantRecall5: number;
  relevantRecall10: number;
  aspectCoverage: number;
  serendipity: number;
  /** Session overlay (hygiene-polluted arm, session questions only): share of
   *  the display call's recipe-text chars saved by known-set stubs. */
  tokenEfficiency?: number;
  /** Absolute chars saved by stubs on the overlay display call. */
  tokenSavedChars?: number;
  /** Fraction of relevant non-known-set results the overlay rendered fully —
   *  1.0 by construction (seam 2's sibling-visibility contract). */
  siblingVisibility?: number;
  /** Flat whole-list order — kept for the tau guardrail. */
  flatIds: string[];
}

interface ArmContext {
  db: PostgresJsDatabase;
  groupId: string;
  /** Canonical (fixture) id → this arm's id. Identity for the polluted arm. */
  mapId: (id: string) => string;
  /** Lineage name → this arm's stamped trace ids (empty for the clean arm). */
  lineageIds: Map<string, string[]>;
}

async function measureQuestion(
  arm: ArmContext,
  q: GoldenQuestion,
  variant: VariantName,
  meta: GoldenMeta,
  queryVector: number[],
): Promise<QuestionMeasurement> {
  const rc = variantConfig(variant);
  const { runSearchPipeline } = await import("../services/search-pipeline");
  const queryVectorStr = `[${queryVector.join(",")}]`;
  const k = q.clusters ?? meta.clusters ?? 3;

  // (a) Expanded flat call: the whole-list ranking surface.
  const flatRes = await runSearchPipeline({
    db: arm.db,
    groupIds: [arm.groupId],
    query: q.query,
    queryVectorStr,
    expand: true,
    perPage: 100, // whole corpus — no-cutoff retrieval, golden sets are small
    includeVectors: true,
    // Pin full dims so Ser@L's unexp() is computed in the same space for
    // every variant (a pool would otherwise MRL-truncate to its vectorDims).
    vectorDims: 3072,
    ranking: rc,
  });

  // (b) Production-shaped clustered call: what an agent actually sees.
  const displayRes = await runSearchPipeline({
    db: arm.db,
    groupIds: [arm.groupId],
    query: q.query,
    queryVectorStr,
    k,
    perPage: 20, // production default — the page the summary draws from in page mode
    ranking: rc,
  });

  const flat = flatRes.results;
  const flatIds = flat.map((t) => t.id);
  const exemplarIds = displayRes.clustered ? displayRes.results.map((t) => t.id) : [];

  // Grades are keyed on canonical fixture ids — remap into this arm's ids.
  const grade = new Map<string, number>();
  for (const [origId, g] of Object.entries(q.graded)) grade.set(arm.mapId(origId), g);
  const gradeOf = (id: string) => grade.get(id) ?? 0;

  const rankedGains = flatIds.map(gradeOf);
  // Ideal pool = every graded id present in this arm. With no-cutoff
  // retrieval and perPage > corpus size, the flat list IS the arm's whole
  // book (the clean arm simply lacks its lineage rows).
  const flatIdSet = new Set(flatIds);
  const armGrades = [...grade.entries()]
    .filter(([id]) => flatIdSet.has(id))
    .map(([, g]) => g);

  const relevantTargets = new Set(
    [...grade.entries()].filter(([id, g]) => g >= 2 && flatIdSet.has(id)).map(([id]) => id),
  );

  // Ser@L (serendipity memo Candidate A): rel = grade/3; unexp = min cosine
  // distance to the expectation set E = {query embedding}; computed over the
  // flat order, position-discounted.
  const serItems: SerendipityItem[] = [];
  for (const t of flat) {
    const vec = flatRes.vectors?.get(t.id);
    serItems.push({
      rel: gradeOf(t.id) / MAX_GRADE,
      unexp: vec ? 1 - cosine(vec, queryVector) : 0,
    });
  }

  const aspectMap = new Map(Object.entries(q.aspects ?? {}).map(([id, a]) => [arm.mapId(id), a]));
  const relevantIds = new Set([...grade.entries()].filter(([, g]) => g > 0).map(([id]) => id));

  const measurement: QuestionMeasurement = {
    ndcgFull: ndcg(rankedGains, armGrades),
    ndcg5: ndcg(rankedGains, armGrades, 5),
    ndcg10: ndcg(rankedGains, armGrades, 10),
    ndcg20: ndcg(rankedGains, armGrades, 20),
    relevantRecall5: recallAtK(flatIds, relevantTargets, 5),
    relevantRecall10: recallAtK(flatIds, relevantTargets, 10),
    aspectCoverage: aspectCoverage(exemplarIds, aspectMap, relevantIds),
    serendipity: serendipityAtL(serItems),
    flatIds,
  };

  // (c) Session overlay — only where the question declares session lineages
  // AND this arm actually holds their deposits (the hygiene-polluted arm).
  const knownIds = new Set<string>();
  for (const lineage of q.sessions ?? []) {
    for (const id of arm.lineageIds.get(lineage) ?? []) knownIds.add(id);
  }
  if (knownIds.size > 0) {
    const overlayRes = await runSearchPipeline({
      db: arm.db,
      groupIds: [arm.groupId],
      query: q.query,
      queryVectorStr,
      k,
      perPage: 20,
      knownIds,
      ranking: rc,
    });

    const textOf = new Map(flat.map((t) => [t.id, t.claimText]));
    let savedChars = 0;
    let shownChars = 0;
    let relevantSiblings = 0;
    let relevantSiblingsFull = 0;
    for (const r of overlayRes.results) {
      if (r.known) {
        savedChars += (textOf.get(r.id) ?? r.claimText).length;
      } else {
        shownChars += r.claimText.length;
      }
      // Known cluster-mates listed beside the item (2026-07-18 reshape) are
      // savings too — their full text stays out of the payload.
      for (const stubId of r.knownClusterMemberIds ?? []) {
        if (stubId !== r.id) savedChars += textOf.get(stubId)?.length ?? 0;
      }
      // Sibling visibility: a relevant result OUTSIDE the known-set must
      // never arrive stubbed (seam 2 — the cross-communication channel).
      if (!knownIds.has(r.id) && gradeOf(r.id) >= 2) {
        relevantSiblings++;
        if (!r.known) relevantSiblingsFull++;
      }
    }
    measurement.tokenSavedChars = savedChars;
    measurement.tokenEfficiency =
      savedChars + shownChars > 0 ? savedChars / (savedChars + shownChars) : 0;
    measurement.siblingVisibility =
      relevantSiblings > 0 ? relevantSiblingsFull / relevantSiblings : 1;
  }

  return measurement;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Corpus setup ─────────────────────────────────────────────────────────────

interface CorpusFile {
  schemaVersion: number;
  traces: Array<Record<string, unknown> & { id: string; claimText: string }>;
  [k: string]: unknown;
}

async function setupArm(
  db: PostgresJsDatabase,
  corpus: CorpusFile,
  armName: ArmName,
  runTag: string,
): Promise<{ groupId: string; mapId: (id: string) => string }> {
  const { registerUser } = await import("../auth");
  const { parseExportPayload } = await import("../services/import-validate");
  const { importCorpus } = await import("../services/import.service");
  const { enqueueEmbedding } = await import("../lib/embeddings/enqueue");

  const { user } = await registerUser(
    db,
    `rankeval-${armName}-${runTag}@eval.local`,
    crypto.randomUUID(),
  );

  const parsed = parseExportPayload(corpus);
  if (!parsed.ok) throw new Error(`[${armName}] corpus.json failed import validation: ${parsed.error}`);

  const result = await importCorpus(db, parsed.data, {
    userId: user.id,
    newBookName: `rankeval ${armName} ${runTag}`,
    overwrite: false,
  });
  if (!result.book) throw new Error(`[${armName}] import created no destination book`);
  console.log(
    `[${armName}] imported ${result.counts.traces.inserted} traces` +
      ` (${result.counts.traces.remapped} remapped) into book ${result.book.slug}`,
  );

  // Old→new map for graded-label lookup (identity unless the import minted
  // isolation copies — the clean arm imported second always does).
  const idMap = new Map(result.idMap.filter((r) => r.entity === "trace").map((r) => [r.from, r.to]));
  const mapId = (id: string): string => idMap.get(id) ?? id;

  // Synchronous embedding backfill — the same enqueueEmbedding path the check
  // route uses (cache-first via vector_cache; no pg-boss worker involved).
  const groupId = result.book.id;
  for (const t of parsed.data.traces) {
    await enqueueEmbedding(db, {
      sourceType: "trace",
      sourceId: mapId(t.id),
      groupId,
      sourceText: t.claimText,
      artifactCategory: "text",
    });
  }
  // Drain anything the import queued as pending (evidence stubs) so future
  // golden sets with evidence sections are searchable too — cache-first, same
  // path the worker's vector-check resolves through.
  const drained = await drainPendingVectors(db, groupId);
  console.log(`[${armName}] embedded ${parsed.data.traces.length} traces (+${drained} pending rows drained)`);

  return { groupId, mapId };
}

/** Embed-and-complete any pending embedding_vectors rows scoped to a book. */
async function drainPendingVectors(db: PostgresJsDatabase, groupId: string): Promise<number> {
  const { getOrCreateCachedVector } = await import("../lib/embeddings/enqueue");
  const rows = (await db.execute(sql`
    SELECT ev.id, ec.chunk_text, ec.chunk_hash, ev.task_type
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
    WHERE ev.status = 'pending' AND es.group_id = ${groupId}::uuid
  `)) as unknown as Array<{ id: string; chunk_text: string; chunk_hash: string; task_type: string }>;
  for (const r of rows) {
    const vec = await getOrCreateCachedVector(db, r.chunk_hash, r.chunk_text, r.task_type);
    if (!vec) throw new Error(`Embedding provider returned null for pending chunk ${r.id}`);
    await db.execute(sql`
      UPDATE claimnet.embedding_vectors
      SET status = 'complete', vector = ${vec}::vector(3072)::halfvec(3072)
      WHERE id = ${r.id}::uuid
    `);
  }
  return rows.length;
}

// ── Threshold gate ───────────────────────────────────────────────────────────

function resolveMetricPath(aggregates: Record<string, unknown>, dotted: string): number {
  let node: unknown = aggregates;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      throw new Error(`thresholds.json names unknown metric path "${dotted}" (failed at "${part}")`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "number") throw new Error(`Metric path "${dotted}" is not a number`);
  return node;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argIdx = process.argv.indexOf("--dataset");
  const datasetArg = argIdx >= 0 ? process.argv[argIdx + 1] : undefined;
  const datasetDir = datasetArg
    ? path.resolve(process.cwd(), datasetArg)
    : path.join(REPO_ROOT, "eval", "golden", "synthetic-echo-v1");
  const datasetName = path.basename(datasetDir);

  // Eval users are throwaway rows in a throwaway DB; a default JWT_SECRET only
  // signs tokens nobody keeps. Real deployments never run this against prod.
  if (!process.env["JWT_SECRET"]) {
    process.env["JWT_SECRET"] = "rankeval-offline-secret-0000000000000000000000000000000000";
  }

  const { getEmbeddingProviderId, getEmbeddingModelId, embedQuery } = await import(
    "../lib/embeddings/provider"
  );
  const provider = getEmbeddingProviderId();
  if (provider === "stub" && process.env["RANKEVAL_ALLOW_STUB"] !== "1") {
    throw new Error(
      "EMBEDDINGS_PROVIDER=stub cannot verify semantic ranking (stub vectors are " +
        "near-orthogonal between distinct texts). Run with EMBEDDINGS_PROVIDER=local, " +
        "or set RANKEVAL_ALLOW_STUB=1 to debug harness plumbing only.",
    );
  }

  const read = <T>(file: string): T =>
    JSON.parse(readFileSync(path.join(datasetDir, file), "utf-8")) as T;
  const corpus = read<CorpusFile>("corpus.json");
  const questions = read<GoldenQuestion[]>("questions.json");
  const meta = read<GoldenMeta>("meta.json");
  const thresholds = read<ThresholdRule[]>("thresholds.json");
  for (const t of thresholds) {
    if (!t.rationale) throw new Error(`thresholds.json entry "${t.metric}" is missing its rationale`);
  }

  console.log(`ranking-eval — dataset ${datasetName}, algorithm ${RANKING_ALGORITHM_VERSION}`);
  console.log(`provider ${provider} (${getEmbeddingModelId()})`);

  const { getDb, runMigrations } = await import("../db");
  await runMigrations();
  const db = getDb();

  const runTag = Date.now().toString(36);

  // Polluted arm first: canonical ids. Clean arm second: minted copies + idMap.
  const lineageTraceIds = Object.keys(meta.sessionLineages);
  const polluted = await setupArm(db, corpus, "hygiene-polluted", runTag);
  const cleanCorpus: CorpusFile = {
    ...corpus,
    traces: corpus.traces.filter((t) => !(t.id in meta.sessionLineages)),
  };
  const clean = await setupArm(db, cleanCorpus, "hygiene-clean", runTag);

  // Stamp session lineages (hygiene-polluted arm): one minted session token
  // per lineage, written to traces.session_id — the same column production
  // stamps at deposit time (imports leave it NULL: a human-only surface).
  // Known-sets are then derived FROM the stamped column, mirroring the
  // production known-set query shape.
  const lineageTokens = new Map<string, string>();
  for (const [traceId, lineage] of Object.entries(meta.sessionLineages)) {
    let token = lineageTokens.get(lineage);
    if (!token) {
      token = crypto.randomUUID();
      lineageTokens.set(lineage, token);
    }
    await db.execute(sql`
      UPDATE claimnet.traces SET session_id = ${token}
      WHERE id = ${polluted.mapId(traceId)}::uuid
    `);
  }
  const pollutedLineageIds = new Map<string, string[]>();
  for (const [lineage, token] of lineageTokens) {
    const rows = (await db.execute(sql`
      SELECT id::text AS id FROM claimnet.traces WHERE session_id = ${token}
    `)) as unknown as Array<{ id: string }>;
    pollutedLineageIds.set(lineage, rows.map((r) => r.id));
  }
  console.log(
    `[hygiene-polluted] stamped ${lineageTraceIds.length} lineage deposits across ${lineageTokens.size} session token(s)`,
  );

  const arms: Record<ArmName, ArmContext> = {
    "hygiene-polluted": {
      db,
      groupId: polluted.groupId,
      mapId: polluted.mapId,
      lineageIds: pollutedLineageIds,
    },
    "hygiene-clean": { db, groupId: clean.groupId, mapId: clean.mapId, lineageIds: new Map() },
  };

  // ── Run every question × arm × variant ────────────────────────────────────
  type PerQuestion = Record<VariantName, QuestionMeasurement>;
  const results: Record<ArmName, Map<string, PerQuestion>> = {
    "hygiene-polluted": new Map(),
    "hygiene-clean": new Map(),
  };

  const loopStart = Date.now();
  let pipelineCalls = 0;
  for (const q of questions) {
    const queryVector = await embedQuery(q.query, "SEMANTIC_SIMILARITY");
    if (!queryVector) throw new Error(`Embedding provider returned null for question ${q.id}`);
    for (const armName of ARMS) {
      const per = {} as PerQuestion;
      for (const variant of VARIANTS) {
        per[variant] = await measureQuestion(arms[armName], q, variant, meta, queryVector);
        pipelineCalls += per[variant].tokenEfficiency !== undefined ? 3 : 2;
      }
      results[armName].set(q.id, per);
    }
    console.log(`  measured ${q.id} (${q.unaffected ? "guardrail" : "graded"})`);
  }
  const loopMs = Date.now() - loopStart;
  console.log(`measurement loop: ${(loopMs / 1000).toFixed(1)}s for ${pipelineCalls} pipeline calls`);

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const unaffected = questions.filter((q) => q.unaffected);

  const aggregateArm = (armName: ArmName) => {
    const out: Record<VariantName, Record<string, number>> = {} as never;
    for (const variant of VARIANTS) {
      const all = questions.map((q) => results[armName].get(q.id)![variant]);
      const overlay = all.filter((m) => m.tokenEfficiency !== undefined);
      out[variant] = {
        ndcgFull: mean(all.map((m) => m.ndcgFull)),
        ndcg5: mean(all.map((m) => m.ndcg5)),
        ndcg10: mean(all.map((m) => m.ndcg10)),
        ndcg20: mean(all.map((m) => m.ndcg20)),
        relevantRecall5: mean(all.map((m) => m.relevantRecall5)),
        relevantRecall10: mean(all.map((m) => m.relevantRecall10)),
        aspectCoverage: mean(all.map((m) => m.aspectCoverage)),
        serendipity: mean(all.map((m) => m.serendipity)),
        // Session-overlay metrics exist only where lineages were measured —
        // omitted (not zeroed) elsewhere so thresholds can't pass vacuously.
        ...(overlay.length > 0
          ? {
            tokenEfficiency: mean(overlay.map((m) => m.tokenEfficiency!)),
            tokenSavedChars: mean(overlay.map((m) => m.tokenSavedChars!)),
            siblingVisibility: mean(overlay.map((m) => m.siblingVisibility!)),
          }
          : {}),
      };
    }
    return out;
  };

  // Guardrail: on unaffected questions, each pool variant's flat order must
  // match baseline exactly — the pool shapes only the clustered summary.
  const guardrail: Record<string, number> = {};
  for (const variant of ["pool-fixed100", "pool-score-gap"] as const) {
    guardrail[variant] = mean(
      unaffected.map((q) => {
        const per = results["hygiene-polluted"].get(q.id)!;
        return kendallTau(per[variant].flatIds, per.baseline.flatIds);
      }),
    );
  }

  const aggregates = {
    arms: {
      "hygiene-polluted": aggregateArm("hygiene-polluted"),
      "hygiene-clean": aggregateArm("hygiene-clean"),
    },
    guardrail: { unaffectedTau: guardrail },
  };

  // ── Report ─────────────────────────────────────────────────────────────────
  const report = {
    dataset: datasetName,
    generatedAt: new Date().toISOString(),
    algorithmVersion: RANKING_ALGORITHM_VERSION,
    provider: { id: provider, modelId: getEmbeddingModelId() },
    questionCount: questions.length,
    unaffectedQuestionCount: unaffected.length,
    measurementLoopMs: loopMs,
    pipelineCalls,
    aggregates,
    perQuestion: Object.fromEntries(
      ARMS.map((armName) => [
        armName,
        Object.fromEntries(
          [...results[armName].entries()].map(([qid, per]) => [
            qid,
            Object.fromEntries(
              VARIANTS.map((v) => {
                const { flatIds: _flatIds, ...metrics } = per[v];
                return [v, metrics];
              }),
            ),
          ]),
        ),
      ]),
    ),
  };

  const reportsDir = path.join(REPO_ROOT, "eval", "reports", datasetName);
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(reportsDir, `${stamp}.json`), JSON.stringify(report, null, 2));
  writeFileSync(path.join(reportsDir, `${stamp}.md`), renderMarkdown(report));
  console.log(`\nreport: eval/reports/${datasetName}/${stamp}.{json,md}`);

  console.log(renderMarkdown(report));

  // ── Gate ───────────────────────────────────────────────────────────────────
  const breaches: string[] = [];
  for (const rule of thresholds) {
    const value = resolveMetricPath(aggregates, rule.metric);
    if (rule.min !== undefined && value < rule.min) {
      breaches.push(`${rule.metric} = ${value.toFixed(4)} < min ${rule.min}\n    rationale: ${rule.rationale}`);
    }
    if (rule.max !== undefined && value > rule.max) {
      breaches.push(`${rule.metric} = ${value.toFixed(4)} > max ${rule.max}\n    rationale: ${rule.rationale}`);
    }
  }
  if (breaches.length > 0) {
    console.error(`\nTHRESHOLD BREACHES (${breaches.length}):`);
    for (const b of breaches) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log(`\nAll ${thresholds.length} thresholds green.`);
  process.exit(0);
}

function renderMarkdown(report: {
  dataset: string;
  generatedAt: string;
  algorithmVersion: string;
  provider: { id: string; modelId: string };
  aggregates: {
    arms: Record<string, Record<string, Record<string, number>>>;
    guardrail: { unaffectedTau: Record<string, number> };
  };
}): string {
  const lines: string[] = [
    `# ranking-eval — ${report.dataset}`,
    "",
    `Generated ${report.generatedAt} · algorithm ${report.algorithmVersion} · provider ${report.provider.modelId}`,
    "",
  ];
  for (const [armName, variants] of Object.entries(report.aggregates.arms)) {
    const metricNames = [...new Set(Object.values(variants).flatMap((v) => Object.keys(v)))];
    lines.push(`## ${armName} arm`, "");
    lines.push(`| metric | ${VARIANTS.join(" | ")} |`);
    lines.push(`|---|${VARIANTS.map(() => "---:").join("|")}|`);
    for (const m of metricNames) {
      lines.push(
        `| ${m} | ${VARIANTS.map((v) => {
          const val = variants[v]![m];
          return val === undefined ? "—" : val.toFixed(4);
        }).join(" | ")} |`,
      );
    }
    lines.push("");
  }
  lines.push("## guardrail (unaffected questions, Kendall tau vs baseline)", "");
  for (const [v, tau] of Object.entries(report.aggregates.guardrail.unaffectedTau)) {
    lines.push(`- ${v}: ${tau.toFixed(4)}`);
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((err: unknown) => {
  console.error("[ranking-eval] failed:", err);
  process.exit(2);
});
