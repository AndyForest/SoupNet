/**
 * What a vector job needs to do its work, read fresh from the database. Jobs hold row
 * ids, so a recipe deleted after its job was queued has no row here: nothing is sent to
 * the provider and nothing is cached. Text in a job from before this rule is ignored.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { VectorCheckItem } from "../queues";

export interface LoadedVectorItem extends VectorCheckItem {
  chunkId: string;
  chunkText: string;
  chunkHash: string;
}

export async function loadVectorItems(
  db: PostgresJsDatabase,
  items: VectorCheckItem[],
): Promise<LoadedVectorItem[]> {
  if (items.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT ev.id AS vector_id, ev.task_type, ev.model_id,
           ec.id AS chunk_id, ec.chunk_text, ec.chunk_hash
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    WHERE ev.id IN (${sql.join(items.map((i) => sql`${i.vectorId}::uuid`), sql`, `)})
  `);
  return (rows as unknown as Array<{
    vector_id: string; task_type: string; model_id: string;
    chunk_id: string; chunk_text: string; chunk_hash: string;
  }>).map((r) => ({
    vectorId: r.vector_id,
    taskType: r.task_type,
    modelId: r.model_id,
    chunkId: r.chunk_id,
    chunkText: r.chunk_text,
    chunkHash: r.chunk_hash,
  }));
}
