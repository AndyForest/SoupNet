/* eslint-disable no-console -- CLI entry point */
/**
 * Grading-pass support for real-scale golden datasets (candidate-pool-sizing
 * memo → P6 sweep). The golden format needs `questions.json` with per-trace
 * 0–3 utility grades; producing those grades is a retrieval + judgment pass:
 * candidates must first be RETRIEVED from the imported corpus so graders can
 * judge them. This script does the deterministic half of that pass:
 *
 *   --prepare                 import the dataset's corpus.json into the target
 *                             database once and embed it (cache-first via
 *                             vector_cache, same path the runner uses), then
 *                             record the book id in <dataset>/.gradeprep.json.
 *   --dump --queries <file>   for each {id, query} in the file, run the REAL
 *                             flat retrieval (expand, top --top N) against the
 *                             prepared book and write candidate texts +
 *                             similarities to <dataset>/grading-dumps.json.
 *
 * Grader agents see ONLY question text + candidate text — never variant
 * outputs — so grades cannot encode a preference for any pool mode.
 *
 * The flat order is a pure function of (query, corpus) and identical across
 * pool variants, so grading the flat top-N is variant-neutral by construction.
 *
 *   npx tsx apps/backend/src/eval/grading-dump.ts --dataset eval/golden/<name> --prepare
 *   npx tsx apps/backend/src/eval/grading-dump.ts --dataset eval/golden/<name> --dump --queries <file> [--top 80]
 */

import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

interface CorpusFile {
  schemaVersion: number;
  traces: Array<Record<string, unknown> & { id: string; claimText: string }>;
  [k: string]: unknown;
}

interface PrepState {
  groupId: string;
  userId: string;
  importedTraces: number;
  preparedAt: string;
  /** Sidecar file holding canonical→minted trace-id pairs (present when the
   *  import minted isolation copies — any import after the first of the same
   *  corpus does). Dumps reverse this so candidates carry CANONICAL ids,
   *  the id space questions.json grades key on. */
  idMapFile?: string;
}

interface QueryEntry {
  id: string;
  query: string;
  [k: string]: unknown;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function prepare(db: PostgresJsDatabase, datasetDir: string): Promise<PrepState> {
  const { registerUser } = await import("../auth");
  const { parseExportPayload } = await import("../services/import-validate");
  const { importCorpus } = await import("../services/import.service");
  const { enqueueEmbedding, getOrCreateCachedVector } = await import("../lib/embeddings/enqueue");

  const corpus = JSON.parse(readFileSync(path.join(datasetDir, "corpus.json"), "utf-8")) as CorpusFile;
  const parsed = parseExportPayload(corpus);
  if (!parsed.ok) throw new Error(`corpus.json failed import validation: ${parsed.error}`);

  const runTag = Date.now().toString(36);
  const { user } = await registerUser(db, `gradeprep-${runTag}@eval.local`, crypto.randomUUID());
  const result = await importCorpus(db, parsed.data, {
    userId: user.id,
    newBookName: `gradeprep ${runTag}`,
    overwrite: false,
  });
  if (!result.book) throw new Error("import created no destination book");
  const groupId = result.book.id;
  console.log(`imported ${result.counts.traces.inserted} traces into book ${result.book.slug}`);

  const idMap = new Map(result.idMap.filter((r) => r.entity === "trace").map((r) => [r.from, r.to]));
  const started = Date.now();
  let done = 0;
  for (const t of parsed.data.traces) {
    // Remote providers meet transient 429/5xx over 39.5k sequential calls;
    // retry with backoff so one blip doesn't kill an hours-long pass (a rerun
    // resumes via the cache anyway — this just avoids needing one).
    for (let attempt = 1; ; attempt++) {
      try {
        await enqueueEmbedding(db, {
          sourceType: "trace",
          sourceId: idMap.get(t.id) ?? t.id,
          groupId,
          sourceText: t.claimText,
          artifactCategory: "text",
        });
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        const waitMs = 2000 * 2 ** (attempt - 1);
        console.log(`  retry ${attempt}/5 for trace ${t.id} in ${waitMs}ms: ${err instanceof Error ? err.message : String(err)}`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    done++;
    if (done % 2000 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`  embedded ${done}/${parsed.data.traces.length} (${rate.toFixed(1)}/s)`);
    }
  }
  // Drain any pending rows the import queued (evidence stubs, if present).
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
  console.log(`embedded ${parsed.data.traces.length} traces (+${rows.length} pending drained) in ${((Date.now() - started) / 60000).toFixed(1)} min`);

  const state: PrepState = {
    groupId,
    userId: user.id,
    importedTraces: result.counts.traces.inserted,
    preparedAt: new Date().toISOString(),
  };
  const mintedPairs = result.idMap.filter((r) => r.entity === "trace" && r.from !== r.to);
  if (mintedPairs.length > 0) {
    const idMapFile = ".gradeprep-idmap.json";
    writeFileSync(
      path.join(datasetDir, idMapFile),
      JSON.stringify(mintedPairs.map((r) => [r.from, r.to])),
    );
    state.idMapFile = idMapFile;
  }
  writeFileSync(path.join(datasetDir, ".gradeprep.json"), JSON.stringify(state, null, 2));
  return state;
}

async function dump(db: PostgresJsDatabase, datasetDir: string, queriesFile: string, top: number): Promise<void> {
  const statePath = path.join(datasetDir, ".gradeprep.json");
  if (!existsSync(statePath)) throw new Error("No .gradeprep.json — run --prepare first");
  const state = JSON.parse(readFileSync(statePath, "utf-8")) as PrepState;

  const { embedQuery } = await import("../lib/embeddings/provider");
  const { runSearchPipeline } = await import("../services/search-pipeline");

  // Reverse the mint map so dumped candidate ids are CANONICAL (the id space
  // grades key on), regardless of which import backs this dump.
  const toCanonical = new Map<string, string>();
  if (state.idMapFile) {
    const pairs = JSON.parse(readFileSync(path.join(datasetDir, state.idMapFile), "utf-8")) as Array<[string, string]>;
    for (const [from, to] of pairs) toCanonical.set(to, from);
  }

  const queries = JSON.parse(readFileSync(queriesFile, "utf-8")) as QueryEntry[];
  const out: Array<Record<string, unknown>> = [];
  for (const q of queries) {
    const vec = await embedQuery(q.query, "SEMANTIC_SIMILARITY");
    if (!vec) throw new Error(`Embedding provider returned null for query ${q.id}`);
    const res = await runSearchPipeline({
      db,
      groupIds: [state.groupId],
      query: q.query,
      queryVectorStr: `[${vec.join(",")}]`,
      expand: true,
      perPage: top,
    });
    out.push({
      ...q,
      candidates: res.results.slice(0, top).map((t) => ({
        id: toCanonical.get(t.id) ?? t.id,
        similarity: t.semanticScore,
        createdAt: t.createdAt,
        claimText: t.claimText,
      })),
    });
    console.log(`  dumped ${q.id}: ${Math.min(res.results.length, top)} candidates (top sim ${res.results[0]?.semanticScore?.toFixed(4) ?? "—"})`);
  }
  const outPath = path.join(datasetDir, "grading-dumps.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${out.length} question dumps → ${outPath}`);
}

async function main(): Promise<void> {
  const datasetDir = path.resolve(process.cwd(), arg("--dataset") ?? "eval/golden/hygiene-realscale");
  if (!process.env["JWT_SECRET"]) {
    process.env["JWT_SECRET"] = "rankeval-offline-secret-0000000000000000000000000000000000";
  }
  const { getEmbeddingProviderId } = await import("../lib/embeddings/provider");
  if (getEmbeddingProviderId() === "stub") {
    throw new Error("Stub embeddings cannot ground a grading pass — run with EMBEDDINGS_PROVIDER=local.");
  }

  const { getDb, runMigrations } = await import("../db");
  await runMigrations();
  const db = getDb();

  if (process.argv.includes("--prepare")) {
    await prepare(db, datasetDir);
  } else if (process.argv.includes("--dump")) {
    const queriesFile = arg("--queries");
    if (!queriesFile) throw new Error("--dump requires --queries <file>");
    await dump(db, datasetDir, path.resolve(process.cwd(), queriesFile), Number(arg("--top") ?? 80));
  } else {
    throw new Error("Pass --prepare or --dump --queries <file>");
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[grading-dump] failed:", err);
  process.exit(2);
});
