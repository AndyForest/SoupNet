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

/** What the sweep writes when a row keeps going stale. No provider said anything about it. */
export const RETRY_LIMIT_ERROR = "Auto-retry limit exceeded after stale processing recovery";

const SEARCHED_STRATEGIES = sql.join(PRODUCTION_SEARCH_STRATEGY_IDS.map((id) => sql`${id}`), sql`, `);

export interface FlipGap {
  /** Chunks search reads, complete under one model and not the other. Zero means reads can move. */
  gap: number;
  /** Of those, rows the provider failed. No wait closes them. */
  refused: number;
  /** Of those, rows the sweep gave up on. Nothing said they can't be embedded. */
  retryLimit: number;
  /** Chunks search doesn't read, missing the same way. They block nothing. */
  notSearched: number;
}

export async function readFlipGap(
  db: PostgresJsDatabase,
  fromModel: string,
  toModel: string,
): Promise<FlipGap> {
  const rows = await db.execute(sql`
    SELECT count(*) FILTER (WHERE searched)::int AS gap,
           count(*) FILTER (WHERE searched AND to_status = 'failed' AND to_error IS DISTINCT FROM ${RETRY_LIMIT_ERROR})::int AS refused,
           count(*) FILTER (WHERE searched AND to_status = 'failed' AND to_error = ${RETRY_LIMIT_ERROR})::int AS "retryLimit",
           count(*) FILTER (WHERE NOT searched)::int AS "notSearched"
    FROM (
      SELECT ecs.strategy_id IN (${SEARCHED_STRATEGIES}) AS searched, t.status AS to_status, t.error AS to_error
      FROM claimnet.embedding_vectors f
      JOIN claimnet.embedding_chunks ec ON ec.id = f.embedding_chunk_id
      JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
      LEFT JOIN claimnet.embedding_vectors t
        ON t.embedding_chunk_id = f.embedding_chunk_id AND t.model_id = ${toModel} AND t.task_type = f.task_type
      WHERE f.model_id = ${fromModel}
        AND f.task_type = 'SEMANTIC_SIMILARITY'
        AND f.status = 'complete'
        AND t.status IS DISTINCT FROM 'complete'
    ) missing
  `);
  return (rows as unknown as FlipGap[])[0] ?? { gap: 0, refused: 0, retryLimit: 0, notSearched: 0 };
}

export type ReadVectorsState = "ok" | "partial" | "empty";

export interface ReadCoverage {
  /** Chunks of the strategies search reads. */
  total: number;
  /** Searchable under this model. */
  covered: number;
  /** Out of search because the provider failed the row. */
  refused: number;
  /** Out of search because the sweep gave up on the row. */
  retryLimit: number;
  /** No searchable vector and no failure, and old enough that it isn't normal lag. */
  missing: number;
}

// New evidence waits for the next sweep, so a chunk this young hasn't missed anything.
const NORMAL_LAG = sql`interval '5 minutes'`;

/** What search can actually reach under a model, whatever other models hold. */
export async function readCoverage(db: PostgresJsDatabase, modelId: string): Promise<ReadCoverage> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ev.status = 'complete')::int AS covered,
           count(*) FILTER (WHERE ev.status = 'failed' AND ev.error IS DISTINCT FROM ${RETRY_LIMIT_ERROR})::int AS refused,
           count(*) FILTER (WHERE ev.status = 'failed' AND ev.error = ${RETRY_LIMIT_ERROR})::int AS "retryLimit",
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
    WHERE ecs.strategy_id IN (${SEARCHED_STRATEGIES})
  `);
  return (rows as unknown as ReadCoverage[])[0] ?? { total: 0, covered: 0, refused: 0, retryLimit: 0, missing: 0 };
}

// A few real refusals are normal and shouldn't page anyone on a small corpus.
const TOLERATED_REFUSALS = 10;

/**
 * `empty`: search reaches nothing while chunks exist, which is 200 with no results.
 * `partial`: over 1% of chunks are out of search for no reason a provider gave, or
 * over 1% and over a handful once refusals count too, since a provider-wide failure
 * also lands on rows as refusals. Other models' counts don't enter into it.
 */
export function readVectorsState(coverage: ReadCoverage): ReadVectorsState {
  if (coverage.total === 0) return "ok";
  if (coverage.covered === 0) return "empty";
  const onePercent = coverage.total * 0.01;
  const unexplained = coverage.missing + coverage.retryLimit;
  if (unexplained > onePercent) return "partial";
  if (unexplained + coverage.refused > Math.max(onePercent, TOLERATED_REFUSALS)) return "partial";
  return "ok";
}

export interface FailedRows {
  modelId: string;
  kind: "provider_refused" | "retry_limit" | "not_searched";
  error: string | null;
  rows: number;
}

/** Every failed row, by what it is and what it said, most common first. */
export async function readFailedRows(db: PostgresJsDatabase): Promise<FailedRows[]> {
  const rows = await db.execute(sql`
    SELECT ev.model_id AS "modelId",
           CASE WHEN ecs.strategy_id NOT IN (${SEARCHED_STRATEGIES}) THEN 'not_searched'
                WHEN ev.error = ${RETRY_LIMIT_ERROR} THEN 'retry_limit'
                ELSE 'provider_refused' END AS kind,
           left(ev.error, 120) AS error,
           count(*)::int AS rows
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    WHERE ev.status = 'failed'
    GROUP BY 1, 2, 3
    ORDER BY rows DESC
    LIMIT 25
  `);
  return rows as unknown as FailedRows[];
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
