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
 * repair-image-fallbacks [--apply]
 *   A text fallback that overwrote an image's real vector during a rebuild: restores
 *   the real one from vector_cache. Dry run unless --apply.
 *
 * prune --model <old> --keep <read id> [--batch 500] [--sleep-ms 2000] [--cache]
 *       [--accept-refused] [--apply]
 *   Removes a retired model's rows in small batches. Dry run unless --apply.
 *   IRREVERSIBLE without another paid rebuild. For an image source whose original
 *   bytes are gone, the old row can be the only vector that ever saw the image.
 */

import { Console } from "node:console";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "../db";
import {
  readCoverage,
  readFailedRows,
  readFlipGap,
  readLiveTasks,
} from "../services/embedding-model-status.service";

// Everything on one stream, so a table stays under its heading in any log.
const out = new Console(process.stderr, process.stderr);

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
  out.table(rowsOf(await db.execute(sql`
    SELECT model_id, status, count(*)::int AS n,
           count(*) FILTER (WHERE vector_source = 'text_fallback')::int AS text_fallback
    FROM claimnet.embedding_vectors WHERE task_type = 'SEMANTIC_SIMILARITY'
    GROUP BY 1, 2 ORDER BY 1, 2
  `)));
  console.warn(`search coverage under ${read}:`, await readCoverage(db, read));
  if (target) {
    const g = await readFlipGap(db, read, target);
    console.warn(
      `gap ${read} -> ${target}: ${g.gap} chunks search reads, of which provider refused: ${g.refused}, over the retry limit: ${g.retryLimit}, ` +
        `still on their way: ${g.gap - g.refused - g.retryLimit}. Chunks search doesn't read, not counted: ${g.notSearched}. ` +
        `Safe to flip reads: ${g.gap === 0 ? "YES" : "NO"}`,
    );
  }
  console.warn("tasks heard from in the last 3 minutes:");
  out.table(await readLiveTasks(db));
  console.warn("image sources:");
  out.table(rowsOf(await db.execute(sql`
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
  const failed = await readFailedRows(db);
  if (failed.length > 0) {
    console.warn("failed rows, by kind (top 25). Try retry-failed; if the provider keeps refusing, see ADR-0024:");
    out.table(failed);
  }
  console.warn(`text fallbacks with a real image vector in the cache: ${await count(db, restorableFallbacks())}. repair-image-fallbacks restores them.`);
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

const RESTORABLE_FROM = sql`
  FROM claimnet.embedding_vectors ev
  JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
  JOIN claimnet.vector_cache vc
    ON vc.content_hash = ec.chunk_hash AND vc.model_id = ev.model_id AND vc.task_type = ev.task_type
  WHERE ev.status = 'complete' AND ev.vector_source = 'text_fallback'
`;

// A text fallback never enters the cache, so a cache row under its hash is the image's.
const restorableFallbacks = () => sql`SELECT count(*)::int AS n ${RESTORABLE_FROM}`;

async function repairImageFallbacks(db: PostgresJsDatabase): Promise<void> {
  const n = await count(db, restorableFallbacks());
  if (!flag("apply")) {
    console.warn(`${n} text fallbacks can be restored from vector_cache. Dry run. Pass --apply to restore.`);
    return;
  }
  const rows = rowsOf(await db.execute(sql`
    UPDATE claimnet.embedding_vectors target
    SET vector = found.vector::halfvec(3072), vector_source = 'server', updated_at = now()
    FROM (SELECT ev.id, vc.vector ${RESTORABLE_FROM}) found
    WHERE target.id = found.id
    RETURNING target.id
  `));
  console.warn(`${rows.length} text fallbacks restored from vector_cache.`);
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

  const g = await readFlipGap(db, model, keep);
  if (g.gap > 0 && !(acceptRefused && g.refused === g.gap)) {
    return `${g.gap} chunks search reads are complete under ${model} and not under ${keep}: ${g.refused} refused by the provider, ` +
      `${g.retryLimit} over the retry limit, ${g.gap - g.refused - g.retryLimit} still on their way. Removing them drops them from search. ` +
      "Let the rebuild finish, and run retry-failed for failed rows. --accept-refused covers only rows the provider refused, " +
      "so pass it only when nothing else is left and you accept losing them.";
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
  const loss = await readFlipGap(db, model, keep);

  console.warn("WARNING: this is irreversible without another paid rebuild.");
  console.warn(`  Removes ${total} rows under ${model}, keeping ${kept} complete rows under ${keep}.`);
  console.warn(`  Flipping reads back to ${model} afterwards means rebuilding it first, if that model still serves.`);
  console.warn(`  ${imageLoss} image sources hold their only image-derived vector under ${model}: their kept vector is text only, and their bytes are gone.`);
  if (loss.refused > 0) console.warn(`  ${loss.refused} chunks the provider refused under ${keep} leave search for good.`);
  if (loss.notSearched > 0) console.warn(`  ${loss.notSearched} chunks search doesn't read aren't complete under ${keep}. They leave the map's experimental views until the worker fills them, if it can.`);
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
  else if (command === "repair-image-fallbacks") await repairImageFallbacks(db);
  else if (command === "prune") await prune(db);
  else throw new Refused("Usage: embedding-model status|retry-failed|repair-image-fallbacks|prune (see the top of this file)");
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
