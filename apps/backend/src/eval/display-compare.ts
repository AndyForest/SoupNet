/* eslint-disable no-console -- CLI entry point */
/**
 * Side-by-side display comparison — the operator-eyeball layer of a lever
 * sweep. For each question in a golden dataset, runs the production-shaped
 * clustered display call under TWO ranking configs against the prepared book
 * (grading-dump --prepare state) and writes a markdown file showing exactly
 * what an agent would see under each: the displayed representatives in order,
 * with similarity, clusterSize, and full recipe text. Grade-free by design —
 * this is how an ungraded real corpus gets judged (the operator reads the
 * two displays and decides which serves the check better).
 *
 *   npx tsx apps/backend/src/eval/display-compare.ts --dataset eval/golden/<name> \
 *     [--k 5] [--out <path.md>]
 *
 * Config A = DEFAULT_RANKING (shipped). Config B = MMR + band pool (the P8
 * candidate: displaySelection {mode:"mmr", lambda 0.6}, clusterPool
 * {mode:"band", band 0.15, size 1500, minSize 100, vectorDims 768}).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_RANKING } from "@soupnet/domain";
import type { RankingConfig } from "@soupnet/domain";

interface QueryEntry {
  id: string;
  query: string;
  graded?: Record<string, number>;
  /** When the probe IS a real corpus recipe (operator feedback 2026-07-20:
   *  probe with genuine taste/judgment recipes, not intention-framed queries),
   *  its own trace is excluded from results — exactly like a real check's
   *  deposit. Canonical id; mapped through the mint idmap when present. */
  sourceTraceId?: string;
}
interface PrepState { groupId: string; idMapFile?: string }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const MMR_CONFIG: RankingConfig = {
  clusterPool: { mode: "band", band: 0.15, size: 1500, minSize: 100, vectorDims: 768 },
  clusterOrdering: DEFAULT_RANKING.clusterOrdering,
  displaySelection: { mode: "mmr", lambda: 0.6 },
};

async function main(): Promise<void> {
  const datasetDir = path.resolve(process.cwd(), arg("--dataset") ?? "eval/golden/andy-corpus");
  const k = Number(arg("--k") ?? 5);
  const outPath = path.resolve(
    process.cwd(),
    arg("--out") ?? path.join(datasetDir, "display-compare.md"),
  );

  if (!process.env["JWT_SECRET"]) {
    process.env["JWT_SECRET"] = "rankeval-offline-secret-0000000000000000000000000000000000";
  }
  const { getEmbeddingProviderId, getEmbeddingModelId, embedQuery } = await import("../lib/embeddings/provider");
  if (getEmbeddingProviderId() === "stub") {
    throw new Error("Stub embeddings cannot produce a meaningful display comparison.");
  }
  const { getDb, runMigrations } = await import("../db");
  await runMigrations();
  const db = getDb();
  const { runSearchPipeline } = await import("../services/search-pipeline");

  const state = JSON.parse(readFileSync(path.join(datasetDir, ".gradeprep.json"), "utf-8")) as PrepState;
  const questions = JSON.parse(readFileSync(path.join(datasetDir, "questions.json"), "utf-8")) as QueryEntry[];
  const toMinted = new Map<string, string>();
  if (state.idMapFile) {
    const pairs = JSON.parse(readFileSync(path.join(datasetDir, state.idMapFile), "utf-8")) as Array<[string, string]>;
    for (const [from, to] of pairs) toMinted.set(from, to);
  }

  const lines: string[] = [
    `# Display comparison — ${path.basename(datasetDir)} (${getEmbeddingModelId()})`,
    "",
    `Config A = shipped default (cluster k-means, fixed:100 pool, max-similarity order). Config B = MMR λ0.6 over a band:0.15 pool (P8 candidate). k=${k} representatives per question. Probes are REAL corpus recipes re-checked verbatim, each excluded from its own results — exactly a real check's shape. Generated ${new Date().toISOString()}.`,
    "",
  ];

  for (const q of questions) {
    const vec = await embedQuery(q.query, "SEMANTIC_SIMILARITY");
    if (!vec) throw new Error(`query embed failed for ${q.id}`);
    const queryVectorStr = `[${vec.join(",")}]`;

    const exclude = q.sourceTraceId
      ? (toMinted.get(q.sourceTraceId) ?? q.sourceTraceId)
      : undefined;
    const run = (ranking: RankingConfig) => runSearchPipeline({
      db,
      groupIds: [state.groupId],
      query: q.query,
      queryVectorStr,
      k,
      perPage: 20,
      ...(exclude ? { excludeTraceId: exclude } : {}),
      ranking,
    });
    const [a, b] = [await run(DEFAULT_RANKING), await run(MMR_CONFIG)];

    lines.push(`## ${q.id}`, "", `> ${q.query}`, "");
    for (const [label, res] of [["A — shipped (k-means cluster)", a], ["B — MMR + band reach", b]] as const) {
      lines.push(`### ${label}`, "");
      res.results.forEach((r, i) => {
        const sim = r.semanticScore !== undefined ? `${(r.semanticScore * 100).toFixed(1)}%` : "—";
        const size = r.clusterSize !== undefined ? ` · represents ${r.clusterSize}` : "";
        lines.push(`${i + 1}. **[${sim}${size}]** ${r.claimText}`, "");
      });
    }
  }

  writeFileSync(outPath, lines.join("\n"));
  console.log(`wrote ${outPath} (${questions.length} questions, A vs B)`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[display-compare] failed:", err);
  process.exit(2);
});
