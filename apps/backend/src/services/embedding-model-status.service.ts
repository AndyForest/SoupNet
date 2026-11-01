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

export type ReadVectorsState = "ok" | "partial" | "empty";

/**
 * Whether the read id can serve the corpus. `empty`: other models hold vectors and
 * this one holds none, which is search returning 200 with nothing. `partial`: some
 * other model holds over 1% more, which a catch-up in progress doesn't reach. An
 * empty corpus is `ok`: there is nothing to lose.
 */
export function readVectorsState(
  counts: Map<string, ModelCounts>,
  readModelId: string,
): ReadVectorsState {
  const readComplete = countsFor(counts, readModelId).complete;
  let otherComplete = 0;
  for (const [id, c] of counts) {
    if (id !== readModelId) otherComplete = Math.max(otherComplete, c.complete);
  }
  if (readComplete === 0 && otherComplete > 0) return "empty";
  if (readComplete < otherComplete * 0.99) return "partial";
  return "ok";
}
