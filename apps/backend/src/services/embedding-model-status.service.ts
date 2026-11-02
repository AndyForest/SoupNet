/**
 * What the embedding_vectors table says about each model: how far a rebuild has
 * got, whether reads can flip, and whether the read id has anything to search.
 * Used by the worker's progress line, the read-model watch and the operator script.
 *
 * Plain aggregates over the table's main heap: the vectors themselves live in
 * TOAST and are never read here. See ADR-0024.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PRODUCTION_SEARCH_STRATEGY_IDS } from "@soupnet/domain";

export interface ModelCounts {
  complete: number;
  pending: number;
  processing: number;
  failed: number;
  /** Complete rows of an image source embedded from text only (bytes unavailable). */
  textFallback: number;
}

const EMPTY_COUNTS: ModelCounts = { complete: 0, pending: 0, processing: 0, failed: 0, textFallback: 0 };

/** Per-model row counts for the one task type the pipeline generates. */
export async function readModelCounts(db: PostgresJsDatabase): Promise<Map<string, ModelCounts>> {
  const rows = await db.execute(sql`
    SELECT model_id,
           count(*) FILTER (WHERE status = 'complete')::int AS complete,
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'processing')::int AS processing,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE status = 'complete' AND vector_source = 'text_fallback')::int AS text_fallback
    FROM claimnet.embedding_vectors
    WHERE task_type = 'SEMANTIC_SIMILARITY'
    GROUP BY model_id
  `);
  const out = new Map<string, ModelCounts>();
  for (const r of rows as unknown as Array<{
    model_id: string; complete: number; pending: number; processing: number; failed: number; text_fallback: number;
  }>) {
    out.set(r.model_id, {
      complete: r.complete,
      pending: r.pending,
      processing: r.processing,
      failed: r.failed,
      textFallback: r.text_fallback,
    });
  }
  return out;
}

export function countsFor(counts: Map<string, ModelCounts>, modelId: string): ModelCounts {
  return counts.get(modelId) ?? EMPTY_COUNTS;
}

/**
 * Chunks searchable under `fromModel` that aren't under `toModel`. Zero means reads
 * can move from one to the other without any source leaving search.
 */
export async function readFlipGap(
  db: PostgresJsDatabase,
  fromModel: string,
  toModel: string,
): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM claimnet.embedding_vectors f
    WHERE f.model_id = ${fromModel}
      AND f.task_type = 'SEMANTIC_SIMILARITY'
      AND f.status = 'complete'
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.embedding_vectors t
        WHERE t.embedding_chunk_id = f.embedding_chunk_id
          AND t.model_id = ${toModel}
          AND t.task_type = f.task_type
          AND t.status = 'complete'
      )
  `);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

/** Of a flip gap, the chunks the target's provider refused, which no wait will close. */
export async function readRefusedGap(
  db: PostgresJsDatabase,
  fromModel: string,
  toModel: string,
): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM claimnet.embedding_vectors f
    JOIN claimnet.embedding_vectors t
      ON t.embedding_chunk_id = f.embedding_chunk_id AND t.model_id = ${toModel} AND t.task_type = f.task_type
    WHERE f.model_id = ${fromModel}
      AND f.task_type = 'SEMANTIC_SIMILARITY'
      AND f.status = 'complete'
      AND t.status = 'failed'
  `);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

export type ReadVectorsState = "ok" | "partial" | "empty";

export interface ReadCoverage {
  /** Chunks of the strategies search reads. */
  total: number;
  /** Searchable under this model. */
  covered: number;
  /** The provider refused this chunk's row. Reported by the rebuild line and status. */
  refused: number;
  /** No searchable vector and none refused, and old enough that it isn't normal lag. */
  missing: number;
}

// New evidence waits for the next sweep, so a chunk this young hasn't missed anything.
const NORMAL_LAG = sql`interval '5 minutes'`;

/** What search can actually reach under a model, whatever other models hold. */
export async function readCoverage(db: PostgresJsDatabase, modelId: string): Promise<ReadCoverage> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ev.status = 'complete')::int AS covered,
           count(*) FILTER (WHERE ev.status = 'failed')::int AS refused,
           count(*) FILTER (
             WHERE (ev.status IS NULL OR ev.status NOT IN ('complete', 'failed'))
               AND ec.created_at < now() - ${NORMAL_LAG}
           )::int AS missing
    FROM claimnet.embedding_chunks ec
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    LEFT JOIN claimnet.embedding_vectors ev
      ON ev.embedding_chunk_id = ec.id
     AND ev.model_id = ${modelId}
     AND ev.task_type = 'SEMANTIC_SIMILARITY'
    WHERE ecs.strategy_id IN (${sql.join(PRODUCTION_SEARCH_STRATEGY_IDS.map((id) => sql`${id}`), sql`, `)})
  `);
  return (rows as unknown as ReadCoverage[])[0] ?? { total: 0, covered: 0, refused: 0, missing: 0 };
}

/**
 * `empty`: search reaches nothing while chunks exist, which is 200 with no results.
 * `partial`: over 1% of chunks are out of search with no refusal to explain them.
 * Failed rows and other models' counts don't enter into it. An empty corpus is `ok`.
 */
export function readVectorsState(coverage: ReadCoverage): ReadVectorsState {
  if (coverage.total === 0) return "ok";
  if (coverage.covered === 0) return "empty";
  if (coverage.missing > coverage.total * 0.01) return "partial";
  return "ok";
}

// ── What running tasks read ────────────────────────────────────────────────

const TASK_KEY_PREFIX = "embeddingTask:";

export interface LiveTask {
  read: string;
  target: string | null;
  secondsAgo: number;
}

/** Tell the fleet what this process reads and rebuilds. Stale entries get swept here too. */
export async function recordTaskHeartbeat(
  db: PostgresJsDatabase,
  taskId: string,
  read: string,
  target: string | null,
): Promise<void> {
  const key = `${TASK_KEY_PREFIX}${taskId}`;
  const value = JSON.stringify({ read, target });
  await db.execute(sql`
    INSERT INTO claimnet.system_settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `);
  await db.execute(sql`
    DELETE FROM claimnet.system_settings
    WHERE key LIKE ${`${TASK_KEY_PREFIX}%`} AND updated_at < now() - interval '10 minutes'
  `);
}

/** Tasks heard from in the last three minutes. They report once a minute. */
export async function readLiveTasks(db: PostgresJsDatabase): Promise<LiveTask[]> {
  const rows = await db.execute(sql`
    SELECT value, extract(epoch FROM now() - updated_at)::int AS seconds_ago
    FROM claimnet.system_settings
    WHERE key LIKE ${`${TASK_KEY_PREFIX}%`} AND updated_at > now() - interval '3 minutes'
  `);
  return (rows as unknown as Array<{ value: string; seconds_ago: number }>).map((r) => {
    const { read, target } = JSON.parse(r.value) as { read: string; target: string | null };
    return { read, target, secondsAgo: r.seconds_ago };
  });
}
