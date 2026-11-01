/**
 * Operator tool for changing the embedding model (docs/adr/0024-embedding-model-switch.md).
 * Reads the database directly; the running service doesn't need to know.
 *
 *   npx tsx scripts/embedding-model.mts status --read <id> [--target <id>]
 *     Read-only. Vector counts per model, the flip gap, image sources, table sizes.
 *
 *   npx tsx scripts/embedding-model.mts retry-failed --model <id>
 *     Puts a model's failed rows back to pending for the worker.
 *
 *   npx tsx scripts/embedding-model.mts prune --model <old> --keep <read id>
 *       [--batch 500] [--sleep-ms 2000] [--cache] [--apply]
 *     Removes a retired model's rows in small batches. Dry run unless --apply.
 *     IRREVERSIBLE without another paid rebuild. For an image source whose original
 *     bytes are gone, the old row can be the only vector that ever saw the image.
 *
 * Connection: DATABASE_URL, or PGHOST + PGPORT + PGUSER + PGPASSWORD + PGDATABASE.
 */

import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
  return value;
}

function connect(): Sql {
  const url = process.env["DATABASE_URL"];
  if (url) return postgres(url, { max: 2, onnotice: () => {} });
  return postgres({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 5432),
    user: process.env["PGUSER"] ?? "claimnet",
    password: process.env["PGPASSWORD"] ?? "",
    database: process.env["PGDATABASE"] ?? "claimnet",
    max: 2,
    onnotice: () => {},
  });
}

/** Chunks complete under one model and not under the other. */
async function flipGap(sql: Sql, from: string, to: string): Promise<number> {
  const [row] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors f
    WHERE f.model_id = ${from} AND f.task_type = 'SEMANTIC_SIMILARITY' AND f.status = 'complete'
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.embedding_vectors t
        WHERE t.embedding_chunk_id = f.embedding_chunk_id AND t.model_id = ${to}
          AND t.task_type = f.task_type AND t.status = 'complete'
      )
  `;
  return row?.n ?? 0;
}

async function status(sql: Sql): Promise<void> {
  const read = required("read");
  const target = arg("target");
  const rows = await sql`
    SELECT model_id, status, count(*)::int AS n,
           count(*) FILTER (WHERE vector_source = 'text_fallback')::int AS text_fallback
    FROM claimnet.embedding_vectors WHERE task_type = 'SEMANTIC_SIMILARITY'
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  console.table([...rows]);
  if (target) {
    const gap = await flipGap(sql, read, target);
    console.log(`gap ${read} -> ${target}: ${gap}. Safe to flip reads: ${gap === 0 ? "YES" : "NO"}`);
  }
  const images = await sql`
    SELECT es.source_type, count(DISTINCT es.id)::int AS image_sources,
           count(DISTINCT ec.id)::int AS chunks
    FROM claimnet.embedding_sources es
    JOIN claimnet.embedding_chunks ec ON ec.embedding_source_id = es.id
    WHERE es.artifact_category = 'multimodal'
    GROUP BY 1
  `;
  console.log("image sources:");
  console.table([...images]);
  const [sizes] = await sql`
    SELECT pg_size_pretty(pg_table_size('claimnet.embedding_vectors')) AS vectors_with_toast,
           pg_size_pretty(pg_relation_size('claimnet.embedding_vectors_hnsw_idx')) AS hnsw,
           pg_size_pretty(pg_total_relation_size('claimnet.vector_cache')) AS vector_cache
  `;
  console.log(sizes);
  const failed = await sql`
    SELECT model_id, left(error, 120) AS error, count(*)::int AS n
    FROM claimnet.embedding_vectors WHERE status = 'failed' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10
  `;
  if (failed.length > 0) {
    console.log("failed rows:");
    console.table([...failed]);
  }
}

async function retryFailed(sql: Sql): Promise<void> {
  const model = required("model");
  const rows = await sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'pending', retry_count = retry_count + 1, error = NULL, updated_at = now()
    WHERE model_id = ${model} AND status = 'failed'
    RETURNING id
  `;
  console.log(`${rows.length} rows under ${model} back to pending.`);
}

async function prune(sql: Sql): Promise<void> {
  const model = required("model");
  const keep = required("keep");
  const batch = Number(arg("batch") ?? 500);
  const sleepMs = Number(arg("sleep-ms") ?? 2000);
  const apply = flag("apply");
  const includeCache = flag("cache");

  const refuse = (why: string): never => {
    console.error(`REFUSED: ${why}`);
    process.exit(3);
  };

  if (model === keep) refuse("--model and --keep are the same model.");
  if (!Number.isInteger(batch) || batch < 1) refuse("--batch must be a positive whole number.");

  const [keepRow] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors
    WHERE model_id = ${keep} AND status = 'complete'
  `;
  if ((keepRow?.n ?? 0) === 0) refuse(`${keep} has no complete vectors. Removing ${model} would empty search.`);

  const gap = await flipGap(sql, model, keep);
  if (gap > 0) refuse(`${gap} chunks are complete under ${model} and not under ${keep}. Removing them drops them from search.`);

  const [recent] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors
    WHERE model_id = ${model} AND updated_at > now() - interval '15 minutes'
  `;
  if ((recent?.n ?? 0) > 0) {
    refuse(`${recent!.n} rows under ${model} changed in the last 15 minutes, so something still writes them. Unset EMBEDDINGS_REBUILD_TARGET first and wait.`);
  }

  const [rows] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors WHERE model_id = ${model}
  `;
  const [cacheRows] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.vector_cache WHERE model_id = ${model}
  `;
  const [imageLoss] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors old
    JOIN claimnet.embedding_vectors kept
      ON kept.embedding_chunk_id = old.embedding_chunk_id AND kept.model_id = ${keep} AND kept.task_type = old.task_type
    WHERE old.model_id = ${model} AND old.vector_source = 'server' AND old.status = 'complete'
      AND kept.vector_source = 'text_fallback'
  `;

  console.warn(`WARNING: this is irreversible without another paid rebuild.`);
  console.warn(`  Removes ${rows?.n ?? 0} rows under ${model}, keeping ${keepRow?.n ?? 0} complete rows under ${keep}.`);
  console.warn(`  Flipping reads back to ${model} afterwards means rebuilding it first, if that model still serves.`);
  console.warn(`  ${imageLoss?.n ?? 0} image sources hold their only image-derived vector under ${model}: their kept vector is text only, and their bytes are gone.`);
  console.warn(`  vector_cache rows under ${model}: ${cacheRows?.n ?? 0}, ${includeCache ? "removed too" : "kept (pass --cache to remove)"}.`);

  if (!apply) {
    console.log("Dry run. Nothing removed. Pass --apply to remove.");
    return;
  }

  let removed = 0;
  for (;;) {
    const deleted = await sql`
      DELETE FROM claimnet.embedding_vectors
      WHERE id IN (SELECT id FROM claimnet.embedding_vectors WHERE model_id = ${model} LIMIT ${batch})
      RETURNING id
    `;
    if (deleted.length === 0) break;
    removed += deleted.length;
    console.log(`removed ${removed}/${rows?.n ?? 0}`);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  if (includeCache) {
    let cacheRemoved = 0;
    for (;;) {
      const deleted = await sql`
        DELETE FROM claimnet.vector_cache
        WHERE id IN (SELECT id FROM claimnet.vector_cache WHERE model_id = ${model} LIMIT ${batch})
        RETURNING id
      `;
      if (deleted.length === 0) break;
      cacheRemoved += deleted.length;
      console.log(`removed from cache ${cacheRemoved}/${cacheRows?.n ?? 0}`);
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
  console.log(`Done: ${removed} rows removed. Files don't shrink on their own; freed pages are reused after autovacuum. See ADR-0024 for sizes.`);
}

const command = process.argv[2];
const sql = connect();
try {
  if (command === "status") await status(sql);
  else if (command === "retry-failed") await retryFailed(sql);
  else if (command === "prune") await prune(sql);
  else {
    console.error("Usage: embedding-model.mts status|retry-failed|prune (see the top of this file)");
    process.exitCode = 2;
  }
} finally {
  await sql.end({ timeout: 5 });
}
