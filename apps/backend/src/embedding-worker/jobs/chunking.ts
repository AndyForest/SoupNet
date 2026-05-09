/**
 * Legacy chunking job handler — drains in-flight jobs from the pre-4-tier queue.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getChunkingStrategy } from "../lib/chunking";

const DEFAULT_MODEL_ID = "gemini-embedding-2-preview";
const DEFAULT_TASK_TYPE = "RETRIEVAL_DOCUMENT";

export async function handleChunkingJob(
  job: { data: { embeddingSourceId: string; strategyId: string } },
  db: PostgresJsDatabase,
): Promise<void> {
  const { embeddingSourceId, strategyId } = job.data;

  const strategyRows = await db.execute(sql`
    SELECT id, status
    FROM claimnet.embedding_chunk_strategies
    WHERE embedding_source_id = ${embeddingSourceId}
      AND strategy_id = ${strategyId}
    LIMIT 1
  `);

  const strategyRow = (strategyRows as unknown as Array<{ id: string; status: string }>)[0];
  if (!strategyRow || strategyRow.status !== "pending") return;

  const chunkStrategyId = strategyRow.id;

  try {
    await db.execute(sql`
      UPDATE claimnet.embedding_chunk_strategies
      SET status = 'processing', updated_at = now()
      WHERE id = ${chunkStrategyId}
    `);

    const sourceRows = await db.execute(sql`
      SELECT source_text
      FROM claimnet.embedding_sources
      WHERE id = ${embeddingSourceId}
    `);

    const sourceRow = (sourceRows as unknown as Array<{ source_text: string | null }>)[0];
    if (!sourceRow?.source_text) {
      await db.execute(sql`
        UPDATE claimnet.embedding_chunk_strategies
        SET status = 'failed', error = 'Source text is null or source not found', updated_at = now()
        WHERE id = ${chunkStrategyId}
      `);
      return;
    }

    const chunkingFn = getChunkingStrategy(strategyId);
    if (!chunkingFn) {
      await db.execute(sql`
        UPDATE claimnet.embedding_chunk_strategies
        SET status = 'failed', error = ${"Unknown strategy: " + strategyId}, updated_at = now()
        WHERE id = ${chunkStrategyId}
      `);
      return;
    }

    const chunks = chunkingFn(sourceRow.source_text);

    for (const chunk of chunks) {
      const chunkRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_chunks
          (embedding_source_id, chunk_strategy_id, chunk_text, chunk_hash, chunk_path, metadata)
        VALUES
          (${embeddingSourceId}, ${chunkStrategyId}, ${chunk.chunkText}, ${chunk.chunkHash}, ${chunk.chunkPath}, ${JSON.stringify(chunk.metadata)}::jsonb)
        RETURNING id
      `);

      const chunkRow = (chunkRows as unknown as Array<{ id: string }>)[0];
      if (!chunkRow) continue;

      await db.execute(sql`
        INSERT INTO claimnet.embedding_vectors
          (embedding_chunk_id, model_id, task_type, vector_source, status)
        VALUES
          (${chunkRow.id}, ${DEFAULT_MODEL_ID}, ${DEFAULT_TASK_TYPE}, 'server', 'pending')
      `);
    }

    await db.execute(sql`
      UPDATE claimnet.embedding_chunk_strategies
      SET status = 'complete', updated_at = now()
      WHERE id = ${chunkStrategyId}
    `);

    console.log(
      `[chunking] Completed: source=${embeddingSourceId} strategy=${strategyId} chunks=${chunks.length}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[chunking] Failed: source=${embeddingSourceId} strategy=${strategyId}`, err);

    await db.execute(sql`
      UPDATE claimnet.embedding_chunk_strategies
      SET status = 'failed', error = ${message}, updated_at = now()
      WHERE id = ${chunkStrategyId}
    `).catch((updateErr) => {
      console.error("[chunking] Failed to mark strategy as failed:", updateErr);
    });
  }
}
