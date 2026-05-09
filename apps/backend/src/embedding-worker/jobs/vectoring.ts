/**
 * Legacy vectoring job handler — drains in-flight jobs from the pre-4-tier queue.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { batchEmbed } from "../../lib/embeddings/provider";

const MAX_BATCH_SIZE = 100;

interface BatchVectorItem {
  vectorId: string;
  chunkId: string;
  chunkText: string;
  chunkHash: string;
  taskType: string;
  modelId: string;
}

interface JobData {
  embeddingChunkStrategyId?: string;
  batchVectors?: BatchVectorItem[];
}

export async function handleVectoringJob(
  job: { data: JobData },
  db: PostgresJsDatabase,
): Promise<void> {
  if (job.data.batchVectors) {
    return handleBatchMode(job.data.batchVectors, db);
  }
  if (job.data.embeddingChunkStrategyId) {
    return handleLegacyMode(job.data.embeddingChunkStrategyId, db);
  }
}

async function handleBatchMode(
  items: BatchVectorItem[],
  db: PostgresJsDatabase,
): Promise<void> {
  if (items.length === 0) return;

  const vectorIds = items.map((i) => i.vectorId);
  await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'processing', updated_at = now()
    WHERE id IN (${sql.join(vectorIds.map(id => sql`${id}::uuid`), sql`, `)})
      AND status = 'pending'
  `);

  const taskType = items[0]!.taskType;
  const modelId = items[0]!.modelId;
  const texts = items.map((i) => i.chunkText);

  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const batch = items.slice(i, i + MAX_BATCH_SIZE);
    const batchTexts = texts.slice(i, i + MAX_BATCH_SIZE);

    try {
      const embeddings = await batchEmbed(batchTexts, taskType, modelId);

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]!;
        const embedding = embeddings[j];
        if (!embedding) {
          await markFailed(db, item.vectorId, "No embedding returned for this index");
          continue;
        }

        try {
          const vectorStr = `[${embedding.join(",")}]`;
          await db.execute(sql`
            UPDATE claimnet.embedding_vectors
            SET vector = ${vectorStr}::halfvec(3072),
                status = 'complete',
                updated_at = now()
            WHERE id = ${item.vectorId}
          `);
        } catch (writeErr) {
          const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
          await markFailed(db, item.vectorId, `Vector write failed: ${message}`);
        }
      }

      console.log(`[vectoring] Batch complete: ${batch.length} vectors (${taskType})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[vectoring] Batch failed (${taskType}):`, err);
      for (const item of batch) {
        await markFailed(db, item.vectorId, `Batch API call failed: ${message}`);
      }
    }
  }
}

async function handleLegacyMode(
  embeddingChunkStrategyId: string,
  db: PostgresJsDatabase,
): Promise<void> {
  const pendingRows = await db.execute(sql`
    SELECT ev.id, ev.embedding_chunk_id, ev.task_type, ev.model_id
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    WHERE ec.chunk_strategy_id = ${embeddingChunkStrategyId}
      AND ev.status = 'pending'
    ORDER BY ev.id
  `);

  const pending = pendingRows as unknown as Array<{
    id: string;
    embedding_chunk_id: string;
    task_type: string;
    model_id: string;
  }>;
  if (pending.length === 0) return;

  const pendingIds = pending.map((p) => p.id);
  await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'processing', updated_at = now()
    WHERE id IN (${sql.join(pendingIds.map(id => sql`${id}::uuid`), sql`, `)})
  `);

  const chunkIds = [...new Set(pending.map((p) => p.embedding_chunk_id))];
  const chunkRows = await db.execute(sql`
    SELECT id, chunk_text
    FROM claimnet.embedding_chunks
    WHERE id IN (${sql.join(chunkIds.map(id => sql`${id}::uuid`), sql`, `)})
  `);

  const chunkTextMap = new Map<string, string>();
  for (const row of chunkRows as unknown as Array<{ id: string; chunk_text: string }>) {
    chunkTextMap.set(row.id, row.chunk_text);
  }

  const texts: string[] = [];
  const validItems: typeof pending = [];
  for (const item of pending) {
    const text = chunkTextMap.get(item.embedding_chunk_id);
    if (!text) {
      await markFailed(db, item.id, "Chunk text not found");
      continue;
    }
    texts.push(text);
    validItems.push(item);
  }

  if (validItems.length === 0) return;

  try {
    const taskType = validItems[0]!.task_type;
    const modelId = validItems[0]!.model_id;
    const embeddings = await batchEmbed(texts, taskType, modelId);

    for (let j = 0; j < validItems.length; j++) {
      const item = validItems[j]!;
      const embedding = embeddings[j];
      if (!embedding) {
        await markFailed(db, item.id, "No embedding returned");
        continue;
      }
      const vectorStr = `[${embedding.join(",")}]`;
      await db.execute(sql`
        UPDATE claimnet.embedding_vectors
        SET vector = ${vectorStr}::halfvec(3072), status = 'complete', updated_at = now()
        WHERE id = ${item.id}
      `);
    }

    console.log(`[vectoring] Legacy batch: strategy=${embeddingChunkStrategyId} vectors=${validItems.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vectoring] Legacy batch failed: strategy=${embeddingChunkStrategyId}`, err);
    for (const item of validItems) {
      await markFailed(db, item.id, `Batch API call failed: ${message}`);
    }
  }
}

async function markFailed(
  db: PostgresJsDatabase,
  vectorId: string,
  error: string,
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE claimnet.embedding_vectors
      SET status = 'failed', error = ${error}, updated_at = now()
      WHERE id = ${vectorId}
    `);
  } catch (updateErr) {
    console.error(`[vectoring] Failed to mark vector ${vectorId} as failed:`, updateErr);
  }
}
