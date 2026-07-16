/* eslint-disable no-console -- CLI entry point: the console summary IS the product */
/**
 * Golden-set ranking eval — Layer B of the offline regression harness
 * (docs/planning/check-recipe-ranking-system.md §3b; workflow:
 * docs/workflows/ranking-tuning.md).
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
 * Env: PG* connection vars (or DATABASE_URL), EMBEDDINGS_PROVIDER=local,
 * JWT_SECRET (defaulted here if unset — eval users are throwaway).
 *
 * Corpus arms (fixture format: eval/golden/README.md):
 *   - polluted: the full corpus (durable recipes + same-key echo appends),
 *     imported first so trace ids stay canonical (graded labels key on them).
 *   - clean: the corpus minus meta.echoTraces, imported by a SECOND eval user —
 *     the import service's deterministic mint isolates the arm and returns the
 *     id remap the metrics need.
 *
 * Ranking variants (§3d proving arms):
 *   - baseline:     DEFAULT_RANKING (echo off, member-count cluster order)
 *   - echo-on:      echo demotion enabled, member-count cluster order
 *   - echo-on-mass: echo demotion enabled + demotion-adjusted-mass cluster order
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
  shareAtK,
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
  /** Logical agent keys the querying agent holds; [0] becomes the current
   *  api_key. Empty/absent ⇒ a fresh key that authored nothing (guardrail). */
  echoKeys?: string[];
  /** Guardrail question: demotion must be a no-op (Kendall tau = 1). */
  unaffected?: boolean;
  /** Trace id → aspect label, for cluster-aspect coverage. */
  aspects?: Record<string, string>;
  /** Cluster count for this question (default: meta.clusters, then 3). */
  clusters?: number;
}

interface GoldenMeta {
  /** "now" for echo recency math — fixed so fixture created_at timestamps
   *  keep their session/day-window meaning forever. */
  referenceNow: string;
  /** Echo trace id → logical agent key that "authored" it. The runner mints
   *  one real api_key uuid per logical key per run and stamps these rows. */
  echoTraces: Record<string, string>;
  /** Default cluster count for questions (default 3). */
  clusters?: number;
}

interface ThresholdRule {
  /** Dotted path into the aggregates object, e.g.
   *  "arms.polluted.echo-on.echoShareTop3". */
  metric: string;
  min?: number;
  max?: number;
  /** Mandatory: why this bound, and what run calibrated it. */
  rationale: string;
}

const MAX_GRADE = 3;
const VARIANTS = ["baseline", "echo-on", "echo-on-mass"] as const;
type VariantName = (typeof VARIANTS)[number];

function variantConfig(name: VariantName): RankingConfig {
  switch (name) {
    case "baseline":
      return DEFAULT_RANKING;
    case "echo-on":
      return { ...DEFAULT_RANKING, echo: { ...DEFAULT_RANKING.echo, enabled: true } };
    case "echo-on-mass":
      return {
        ...DEFAULT_RANKING,
        echo: { ...DEFAULT_RANKING.echo, enabled: true },
        clusterOrdering: "demotion-adjusted-mass",
      };
  }
}

// ── Per-question measurement ─────────────────────────────────────────────────

interface QuestionMeasurement {
  ndcgFull: number;
  ndcg5: number;
  ndcg10: number;
  ndcg20: number;
  genuineRecall5: number;
  genuineRecall10: number;
  echoShareTop3: number;
  echoShareTop5: number;
  /** 1 when the first displayed exemplar (the #1 cluster's face) is an echo. */
  firstExemplarEcho: number;
  exemplarEchoShare: number;
  topClusterEchoShare: number;
  aspectCoverage: number;
  serendipity: number;
  /** Flat post-demotion order — kept for the tau guardrail. */
  flatIds: string[];
}

interface ArmContext {
  db: PostgresJsDatabase;
  groupId: string;
  /** Canonical (fixture) id → this arm's id. Identity for the polluted arm. */
  mapId: (id: string) => string;
  /** This arm's echo trace ids (empty for the clean arm). */
  echoIds: Set<string>;
}

async function measureQuestion(
  arm: ArmContext,
  q: GoldenQuestion,
  variant: VariantName,
  keyForLogicalAgent: (k: string) => string,
  meta: GoldenMeta,
  queryVector: number[],
): Promise<QuestionMeasurement> {
  const rc = variantConfig(variant);
  const currentApiKeyId = q.echoKeys?.[0]
    ? keyForLogicalAgent(q.echoKeys[0])
    : crypto.randomUUID();

  const { runSearchPipeline } = await import("../services/search-pipeline");
  const res = await runSearchPipeline({
    db: arm.db,
    groupIds: [arm.groupId],
    query: q.query,
    queryVectorStr: `[${queryVector.join(",")}]`,
    k: q.clusters ?? meta.clusters ?? 3,
    perPage: 100, // whole corpus — no-cutoff retrieval, golden sets are small
    includeVectors: true,
    echo: {
      config: rc.echo,
      exemption: rc.exemption,
      currentApiKeyId,
      now: new Date(meta.referenceNow),
    },
    ranking: rc,
  });

  // Flat post-demotion order (allResults when clustered; results otherwise).
  const flat = res.allResults ?? res.results;
  const flatIds = flat.map((t) => t.id);
  const exemplarIds = res.clustered ? res.results.map((t) => t.id) : [];

  // Grades are keyed on canonical fixture ids — remap into this arm's ids.
  const grade = new Map<string, number>();
  for (const [origId, g] of Object.entries(q.graded)) grade.set(arm.mapId(origId), g);
  const gradeOf = (id: string) => grade.get(id) ?? 0;

  const rankedGains = flatIds.map(gradeOf);
  // Ideal pool = every graded id present in this arm. With no-truncation
  // retrieval and perPage > corpus size, the flat list IS the arm's whole
  // book, so membership-in-flat equals membership-in-arm (the clean arm
  // simply lacks its echo rows).
  const flatIdSet = new Set(flatIds);
  const armGrades = [...grade.entries()]
    .filter(([id]) => flatIdSet.has(id))
    .map(([, g]) => g);

  const genuineTargets = new Set(
    [...grade.entries()]
      .filter(([id, g]) => g >= 2 && !arm.echoIds.has(id) && flatIdSet.has(id))
      .map(([id]) => id),
  );

  // Ser@L (serendipity memo Candidate A): rel = grade/3; unexp = min cosine
  // distance to the expectation set E = {query embedding}. Computed over the
  // flat post-demotion order — the ranking stage's output, position-discounted.
  const serItems: SerendipityItem[] = [];
  for (const t of flat) {
    const vec = res.vectors?.get(t.id);
    serItems.push({
      rel: gradeOf(t.id) / MAX_GRADE,
      unexp: vec ? 1 - cosine(vec, queryVector) : 0,
    });
  }

  const aspectMap = new Map(Object.entries(q.aspects ?? {}).map(([id, a]) => [arm.mapId(id), a]));
  const relevantIds = new Set([...grade.entries()].filter(([, g]) => g > 0).map(([id]) => id));

  const topClusterIds = res.clustered
    ? res.clusters![0]!.memberIndices.map((i) => flat[i]!.id)
    : [];

  return {
    ndcgFull: ndcg(rankedGains, armGrades),
    ndcg5: ndcg(rankedGains, armGrades, 5),
    ndcg10: ndcg(rankedGains, armGrades, 10),
    ndcg20: ndcg(rankedGains, armGrades, 20),
    genuineRecall5: recallAtK(flatIds, genuineTargets, 5),
    genuineRecall10: recallAtK(flatIds, genuineTargets, 10),
    echoShareTop3: shareAtK(flatIds, arm.echoIds, 3),
    echoShareTop5: shareAtK(flatIds, arm.echoIds, 5),
    firstExemplarEcho: exemplarIds[0] !== undefined && arm.echoIds.has(exemplarIds[0]) ? 1 : 0,
    exemplarEchoShare: shareAtK(exemplarIds, arm.echoIds),
    topClusterEchoShare: shareAtK(topClusterIds, arm.echoIds),
    aspectCoverage: aspectCoverage(exemplarIds, aspectMap, relevantIds),
    serendipity: serendipityAtL(serItems),
    flatIds,
  };
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
  armName: "polluted" | "clean",
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
  const echoIdList = Object.keys(meta.echoTraces);
  const polluted = await setupArm(db, corpus, "polluted", runTag);
  const cleanCorpus: CorpusFile = {
    ...corpus,
    traces: corpus.traces.filter((t) => !(t.id in meta.echoTraces)),
  };
  const clean = await setupArm(db, cleanCorpus, "clean", runTag);

  // Mint one api_key uuid per logical agent key and stamp the echo rows
  // (imports write api_key_id NULL — a human-only surface — so echo authorship
  // is fixture metadata the runner applies). Polluted arm only; the clean arm
  // has no echo rows by construction.
  const logicalKeys = new Map<string, string>();
  const keyForLogicalAgent = (k: string): string => {
    let v = logicalKeys.get(k);
    if (!v) {
      v = crypto.randomUUID();
      logicalKeys.set(k, v);
    }
    return v;
  };
  for (const [traceId, agentKey] of Object.entries(meta.echoTraces)) {
    await db.execute(sql`
      UPDATE claimnet.traces SET api_key_id = ${keyForLogicalAgent(agentKey)}::uuid
      WHERE id = ${polluted.mapId(traceId)}::uuid
    `);
  }

  const arms: Record<"polluted" | "clean", ArmContext> = {
    polluted: {
      db,
      groupId: polluted.groupId,
      mapId: polluted.mapId,
      echoIds: new Set(echoIdList.map(polluted.mapId)),
    },
    clean: { db, groupId: clean.groupId, mapId: clean.mapId, echoIds: new Set() },
  };

  // ── Run every question × arm × variant ────────────────────────────────────
  type PerQuestion = Record<VariantName, QuestionMeasurement>;
  const results: Record<"polluted" | "clean", Map<string, PerQuestion>> = {
    polluted: new Map(),
    clean: new Map(),
  };

  for (const q of questions) {
    const queryVector = await embedQuery(q.query, "SEMANTIC_SIMILARITY");
    if (!queryVector) throw new Error(`Embedding provider returned null for question ${q.id}`);
    for (const armName of ["polluted", "clean"] as const) {
      const per = {} as PerQuestion;
      for (const variant of VARIANTS) {
        per[variant] = await measureQuestion(
          arms[armName], q, variant, keyForLogicalAgent, meta, queryVector,
        );
      }
      results[armName].set(q.id, per);
    }
    console.log(`  measured ${q.id} (${q.unaffected ? "guardrail" : "graded"})`);
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const affected = questions.filter((q) => (q.echoKeys?.length ?? 0) > 0 && !q.unaffected);
  const unaffected = questions.filter((q) => q.unaffected);

  const aggregateArm = (armName: "polluted" | "clean") => {
    const out: Record<VariantName, Record<string, number>> = {} as never;
    for (const variant of VARIANTS) {
      const all = questions.map((q) => results[armName].get(q.id)![variant]);
      const echoQs = affected.map((q) => results[armName].get(q.id)![variant]);
      out[variant] = {
        ndcgFull: mean(all.map((m) => m.ndcgFull)),
        ndcg5: mean(all.map((m) => m.ndcg5)),
        ndcg10: mean(all.map((m) => m.ndcg10)),
        ndcg20: mean(all.map((m) => m.ndcg20)),
        genuineRecall5: mean(all.map((m) => m.genuineRecall5)),
        genuineRecall10: mean(all.map((m) => m.genuineRecall10)),
        aspectCoverage: mean(all.map((m) => m.aspectCoverage)),
        serendipity: mean(all.map((m) => m.serendipity)),
        // Echo-exposure waterfall — over echo-affected questions only.
        echoShareTop3: mean(echoQs.map((m) => m.echoShareTop3)),
        echoShareTop5: mean(echoQs.map((m) => m.echoShareTop5)),
        firstExemplarEchoRate: mean(echoQs.map((m) => m.firstExemplarEcho)),
        exemplarEchoShare: mean(echoQs.map((m) => m.exemplarEchoShare)),
        topClusterEchoShare: mean(echoQs.map((m) => m.topClusterEchoShare)),
      };
    }
    return out;
  };

  // Guardrail: on unaffected questions, each echo variant's flat order must
  // match baseline exactly (tau = 1 — the current key authored nothing there).
  const guardrail: Record<string, number> = {};
  for (const variant of ["echo-on", "echo-on-mass"] as const) {
    guardrail[variant] = mean(
      unaffected.map((q) => {
        const per = results.polluted.get(q.id)!;
        return kendallTau(per[variant].flatIds, per.baseline.flatIds);
      }),
    );
  }

  const aggregates = {
    arms: { polluted: aggregateArm("polluted"), clean: aggregateArm("clean") },
    guardrail: { unaffectedTau: guardrail },
  };

  // ── Report ─────────────────────────────────────────────────────────────────
  const report = {
    dataset: datasetName,
    generatedAt: new Date().toISOString(),
    algorithmVersion: RANKING_ALGORITHM_VERSION,
    provider: { id: provider, modelId: getEmbeddingModelId() },
    questionCount: questions.length,
    affectedQuestionCount: affected.length,
    unaffectedQuestionCount: unaffected.length,
    aggregates,
    perQuestion: Object.fromEntries(
      (["polluted", "clean"] as const).map((armName) => [
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
    const metricNames = Object.keys(Object.values(variants)[0]!);
    lines.push(`## ${armName} arm`, "");
    lines.push(`| metric | ${VARIANTS.join(" | ")} |`);
    lines.push(`|---|${VARIANTS.map(() => "---:").join("|")}|`);
    for (const m of metricNames) {
      lines.push(`| ${m} | ${VARIANTS.map((v) => variants[v]![m]!.toFixed(4)).join(" | ")} |`);
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
