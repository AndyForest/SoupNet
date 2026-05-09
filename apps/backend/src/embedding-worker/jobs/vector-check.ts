/**
 * Tier 3: Vector Check — per batch of ≤64 vectors.
 *
 * Resolves as many vectors as possible from the vector_cache (fast, <5ms each).
 * Remaining cache misses are forwarded to a Vector API Call job.
 *
 * Separating cache lookups from API calls means API batches contain
 * ONLY genuine cache misses — no wasted API capacity.
 *
 * See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture
 */

import type PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { QUEUES } from "../queues";
import type { VectorCheckItem } from "../queues";

export async function handleVectorCheck(
  job: { data: { items: VectorCheckItem[] } },
  boss: PgBoss,
  db: PostgresJsDatabase,
): Promise<void> {
  const { items } = job.data;
  if (items.length === 0) return;

  const vectorIds = items.map((i) => i.vectorId);
  await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'processing', updated_at = now()
    WHERE id IN (${sql.join(vectorIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND status = 'pending'
  `);

  const cacheMisses: VectorCheckItem[] = [];
  let cacheHits = 0;

  for (const item of items) {
    const cacheRows = await db.execute(sql`
      SELECT vector::text AS vector_str
      FROM claimnet.vector_cache
      WHERE content_hash = ${item.chunkHash}
        AND task_type = ${item.taskType}
        AND model_id = ${item.modelId}
      LIMIT 1
    `);

    const cached = (cacheRows as unknown as Array<{ vector_str: string }>)[0];

    if (cached) {
      await db.execute(sql`
        UPDATE claimnet.embedding_vectors
        SET vector = ${cached.vector_str}::halfvec(3072),
            status = 'complete',
            updated_at = now()
        WHERE id = ${item.vectorId}::uuid
      `);
      cacheHits++;
    } else {
      cacheMisses.push(item);
    }
  }

  if (cacheMisses.length > 0) {
    await boss.send(QUEUES.VECTOR_API_CALL, {
      items: cacheMisses,
    }, {
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      expireInMinutes: 10,
      priority: 1,
    });
  }

  if (cacheHits > 0 || cacheMisses.length > 0) {
    console.warn(
      `[vector-check] batch=${items.length}: ${cacheHits} cache hits → ${cacheMisses.length} forwarded to vector.api-call`,
    );
  }
}
