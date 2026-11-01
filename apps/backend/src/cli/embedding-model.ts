/**
 * Operator tool for changing the embedding model (docs/adr/0024-embedding-model-switch.md).
 * Built into the image, and connects as the service does, TLS included:
 *
 *   node dist/cli/embedding-model.js <command>           in the image
 *   npx tsx apps/backend/src/cli/embedding-model.ts ...  from a checkout
 *
 * status --read <id> [--target <id>]
 *   Read-only. Vectors per model, the flip gap, what running tasks read, image sources,
 *   table sizes, and refused rows with their ids and errors.
 *
 * retry-failed --model <id>
 *   Puts a model's failed rows back to pending for the worker.
 *
 * prune --model <old> --keep <read id> [--batch 500] [--sleep-ms 2000] [--cache]
 *       [--accept-refused] [--apply]
 *   Removes a retired model's rows in small batches. Dry run unless --apply.
 *   IRREVERSIBLE without another paid rebuild. For an image source whose original
 *   bytes are gone, the old row can be the only vector that ever saw the image.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "../db";
import {
  readCoverage,
  readFlipGap,
  readLiveTasks,
  readRefusedGap,
} from "../services/embedding-model-status.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

class Refused extends Error {}

function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Refused(`--${name} is required`);
  return value;
}

const rowsOf = <T>(result: unknown) => result as unknown as T[];

async function count(db: PostgresJsDatabase, query: ReturnType<typeof sql>): Promise<number> {
  return rowsOf<{ n: number }>(await db.execute(query))[0]?.n ?? 0;
}

async function status(db: PostgresJsDatabase): Promise<void> {
  const read = required("read");
  const target = arg("target");
  console.warn("vectors:");
  console.table(rowsOf(await db.execute(sql`
    SELECT model_id, status, count(*)::int AS n,
           count(*) FILTER (WHERE vector_source = 'text_fallback')::int AS text_fallback
    FROM claimnet.embedding_vectors WHERE task_type = 'SEMANTIC_SIMILARITY'
    GROUP BY 1, 2 ORDER BY 1, 2
  `)));
  console.warn(`search coverage under ${read}:`, await readCoverage(db, read));
  if (target) {
    const gap = await readFlipGap(db, read, target);
    const refused = await readRefusedGap(db, read, target);
    console.warn(`gap ${read} -> ${target}: ${gap}, of which refused by the provider: ${refused}. Safe to flip reads: ${gap === 0 ? "YES" : "NO"}`);
  }
  console.warn("tasks heard from in the last 3 minutes:");
  console.table(await readLiveTasks(db));
  console.warn("image sources:");
  console.table(rowsOf(await db.execute(sql`
    SELECT es.source_type, count(DISTINCT es.id)::int AS image_sources, count(DISTINCT ec.id)::int AS chunks
    FROM claimnet.embedding_sources es
    JOIN claimnet.embedding_chunks ec ON ec.embedding_source_id = es.id
    WHERE es.artifact_category = 'multimodal'
    GROUP BY 1
  `)));
  console.warn(rowsOf(await db.execute(sql`
    SELECT pg_size_pretty(pg_table_size('claimnet.embedding_vectors')) AS vectors_with_toast,
           pg_size_pretty(pg_relation_size('claimnet.embedding_vectors_hnsw_idx')) AS hnsw,
           pg_size_pretty(pg_total_relation_size('claimnet.vector_cache')) AS vector_cache
  `))[0]);
  const failed = rowsOf(await db.execute(sql`
    SELECT id AS vector_id, model_id, left(error, 120) AS error
    FROM claimnet.embedding_vectors WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 25
  `));
  if (failed.length > 0) {
    console.warn("refused rows (latest 25). Try retry-failed; if the provider keeps refusing, see ADR-0024:");
    console.table(failed);
  }
}

async function retryFailed(db: PostgresJsDatabase): Promise<void> {
  const model = required("model");
  const rows = rowsOf(await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'pending', retry_count = retry_count + 1, error = NULL, updated_at = now()
    WHERE model_id = ${model} AND status = 'failed'
    RETURNING id
  `));
  console.warn(`${rows.length} rows under ${model} back to pending.`);
}

/** Whatever could make this prune take rows away from search, checked before each batch. */
async function pruneRefusal(
  db: PostgresJsDatabase,
  model: string,
  keep: string,
  acceptRefused: boolean,
): Promise<string | null> {
  if (model === keep) return "--model and --keep are the same model.";

  const tasks = await readLiveTasks(db);
  if (tasks.length === 0) {
    return "No task has reported what it reads in the last 3 minutes, so this can't tell what removing rows would do. " +
      "Run this with the service up, on code that reports.";
  }
  const readingOther = tasks.filter((t) => t.read !== keep);
  if (readingOther.length > 0) {
    return `Running tasks read ${[...new Set(readingOther.map((t) => t.read))].join(", ")}, not ${keep}. ` +
      `Flip reads to ${keep} and wait for those tasks to stop (their reports expire after 3 minutes).`;
  }
  if (tasks.some((t) => t.target === model)) {
    return `Running tasks still rebuild ${model}, so removed rows would be added back and paid for again. ` +
      "Deploy with EMBEDDINGS_REBUILD_TARGET empty first, and wait 3 minutes.";
  }

  if (await count(db, sql`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors WHERE model_id = ${keep} AND status = 'complete'
  `) === 0) {
    return `${keep} has no complete vectors. Removing ${model} would empty search.`;
  }

  const gap = await readFlipGap(db, model, keep);
  if (gap > 0) {
    const refused = await readRefusedGap(db, model, keep);
    if (!acceptRefused || refused < gap) {
      return `${gap} chunks are complete under ${model} and not under ${keep}, ${refused} of them refused by the provider. ` +
        "Removing them drops them from search. Let the rebuild finish; for refused rows, try retry-failed, " +
        "and pass --accept-refused only if you accept losing them.";
    }
  }
  return null;
}

async function prune(db: PostgresJsDatabase): Promise<void> {
  const model = required("model");
  const keep = required("keep");
  const batch = Number(arg("batch") ?? 500);
  const sleepMs = Number(arg("sleep-ms") ?? 2000);
  const apply = flag("apply");
  const includeCache = flag("cache");
  const acceptRefused = flag("accept-refused");
  if (!Number.isInteger(batch) || batch < 1) throw new Refused("--batch must be a positive whole number.");

  const refusal = await pruneRefusal(db, model, keep, acceptRefused);
  if (refusal) throw new Refused(refusal);

  const recent = await count(db, sql`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors
    WHERE model_id = ${model} AND updated_at > now() - interval '15 minutes'
  `);
  if (recent > 0) {
    throw new Refused(`${recent} rows under ${model} changed in the last 15 minutes, so something still writes them. Wait, or find what does.`);
  }

  const total = await count(db, sql`SELECT count(*)::int AS n FROM claimnet.embedding_vectors WHERE model_id = ${model}`);
  const cached = await count(db, sql`SELECT count(*)::int AS n FROM claimnet.vector_cache WHERE model_id = ${model}`);
  const kept = await count(db, sql`SELECT count(*)::int AS n FROM claimnet.embedding_vectors WHERE model_id = ${keep} AND status = 'complete'`);
  const imageLoss = await count(db, sql`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors old
    JOIN claimnet.embedding_vectors k
      ON k.embedding_chunk_id = old.embedding_chunk_id AND k.model_id = ${keep} AND k.task_type = old.task_type
    WHERE old.model_id = ${model} AND old.vector_source = 'server' AND old.status = 'complete'
      AND k.vector_source = 'text_fallback'
  `);
  const refusedLoss = await readRefusedGap(db, model, keep);

  console.warn("WARNING: this is irreversible without another paid rebuild.");
  console.warn(`  Removes ${total} rows under ${model}, keeping ${kept} complete rows under ${keep}.`);
  console.warn(`  Flipping reads back to ${model} afterwards means rebuilding it first, if that model still serves.`);
  console.warn(`  ${imageLoss} image sources hold their only image-derived vector under ${model}: their kept vector is text only, and their bytes are gone.`);
  if (refusedLoss > 0) console.warn(`  ${refusedLoss} chunks the provider refused under ${keep} leave search for good.`);
  console.warn(`  vector_cache rows under ${model}: ${cached}, ${includeCache ? "removed too" : "kept (pass --cache to remove)"}.`);

  if (!apply) {
    console.warn("Dry run. Nothing removed. Pass --apply to remove.");
    return;
  }

  let removed = 0;
  for (;;) {
    // A deploy can start during a long prune.
    const again = await pruneRefusal(db, model, keep, acceptRefused);
    if (again) throw new Refused(`Stopped after removing ${removed} rows. ${again}`);
    const deleted = rowsOf(await db.execute(sql`
      DELETE FROM claimnet.embedding_vectors
      WHERE id IN (SELECT id FROM claimnet.embedding_vectors WHERE model_id = ${model} LIMIT ${batch})
      RETURNING id
    `));
    if (deleted.length === 0) break;
    removed += deleted.length;
    console.warn(`removed ${removed}/${total}`);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  if (includeCache) {
    let cacheRemoved = 0;
    for (;;) {
      const deleted = rowsOf(await db.execute(sql`
        DELETE FROM claimnet.vector_cache
        WHERE (content_hash, model_id, task_type) IN (
          SELECT content_hash, model_id, task_type FROM claimnet.vector_cache WHERE model_id = ${model} LIMIT ${batch}
        )
        RETURNING content_hash
      `));
      if (deleted.length === 0) break;
      cacheRemoved += deleted.length;
      console.warn(`removed from cache ${cacheRemoved}/${cached}`);
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
  console.warn(`Done: ${removed} rows removed. Files don't shrink on their own; freed pages are reused after autovacuum. See ADR-0024 for sizes.`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const db = getDb();
  if (command === "status") await status(db);
  else if (command === "retry-failed") await retryFailed(db);
  else if (command === "prune") await prune(db);
  else throw new Refused("Usage: embedding-model status|retry-failed|prune (see the top of this file)");
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    if (err instanceof Refused) {
      console.error(`REFUSED: ${err.message}`);
      process.exit(3);
    }
    console.error(err);
    process.exit(1);
  },
);
