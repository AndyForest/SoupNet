/**
 * Tier 4: Vector API Call — per batch of cache misses (≤64).
 *
 * Calls the unified provider's batchEmbed (same implementation used by the
 * sync check path), writes vectors + populates cache. On failure, uses
 * binary-split retry to isolate poison pills.
 *
 * Binary-split retry:
 *   Attempt 1: retry same batch (transient error?)
 *   Attempt 2+: split in half, enqueue two child jobs
 *   Batch of 1 that fails: mark vector as 'failed' permanently
 *
 * See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture
 * See: docs/adr/0020-unified-embedding-service.md
 */

import type PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { batchEmbed, getEmbeddingProviderId } from "../../lib/embeddings/provider";
import { QUEUES } from "../queues";
import type { VectorCheckItem } from "../queues";

export async function handleVectorApiCall(
  job: { data: { items: VectorCheckItem[] }; retrycount?: number },
  boss: PgBoss,
  db: PostgresJsDatabase,
): Promise<void> {
  const { items } = job.data;
  if (items.length === 0) return;

  const taskType = items[0]!.taskType;
  const modelId = items[0]!.modelId;
  const texts = items.map((i) => i.chunkText);

  try {
    const embeddings = await batchEmbed(texts, taskType, modelId);

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const embedding = embeddings[i];

      if (!embedding) {
        await markFailed(db, item.vectorId, "No embedding returned for this index");
        continue;
      }

      const vectorStr = `[${embedding.join(",")}]`;

      await db.execute(sql`
        UPDATE claimnet.embedding_vectors
        SET vector = ${vectorStr}::halfvec(3072),
            status = 'complete',
            updated_at = now()
        WHERE id = ${item.vectorId}::uuid
      `);

      await db.execute(sql`
        INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector)
        VALUES (${item.chunkHash}, ${modelId}, ${taskType}, ${vectorStr}::vector(3072))
        ON CONFLICT (content_hash, model_id, task_type) DO NOTHING
      `);
    }

    console.warn(
      `[vector-api-call] batch=${items.length}: ${items.length} vectors generated + cached (${taskType}) provider=${getEmbeddingProviderId()}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryCount = job.retrycount ?? 0;

    if (items.length === 1) {
      console.error(`[vector-api-call] Single vector failed permanently: ${items[0]!.vectorId}`, err);
      await markFailed(db, items[0]!.vectorId, `API call failed: ${message}`);
      return;
    }

    if (retryCount >= 1) {
      const mid = Math.ceil(items.length / 2);
      const left = items.slice(0, mid);
      const right = items.slice(mid);

      console.warn(
        `[vector-api-call] Batch of ${items.length} failed twice — splitting to ${left.length} + ${right.length}`,
      );

      const allIds = items.map((i) => i.vectorId);
      await db.execute(sql`
        UPDATE claimnet.embedding_vectors
        SET status = 'pending', updated_at = now()
        WHERE id IN (${sql.join(allIds.map((id) => sql`${id}::uuid`), sql`, `)})
      `);

      await boss.send(QUEUES.VECTOR_API_CALL, { items: left }, {
        retryLimit: 2,
        retryDelay: 5,
        retryBackoff: true,
        expireInMinutes: 10,
        priority: 1,
      });

      await boss.send(QUEUES.VECTOR_API_CALL, { items: right }, {
        retryLimit: 2,
        retryDelay: 5,
        retryBackoff: true,
        expireInMinutes: 10,
        priority: 1,
      });

      return;
    }

    console.error(`[vector-api-call] Batch of ${items.length} failed (will retry): ${message}`);
    throw err;
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
      WHERE id = ${vectorId}::uuid
    `);
  } catch (updateErr) {
    console.error(`[vector-api-call] Failed to mark vector ${vectorId} as failed:`, updateErr);
  }
}
