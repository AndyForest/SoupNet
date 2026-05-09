/**
 * Vector cache — content-addressed embedding storage.
 *
 * Stores vectors keyed by content hash (SHA-256 of source text).
 * Identical text always produces the same embedding, so we cache
 * the result to avoid re-calling the Gemini API.
 *
 * This table has NO source text and NO FKs to source data.
 * It's safe for PII retention: deleting user data doesn't require
 * deleting cached vectors (the hash is one-way, the vector is not
 * reversible to text).
 *
 * The embedding pipeline checks this table before calling Gemini.
 * If a cache hit exists, it copies the vector to embedding_vectors
 * without an API call.
 */

import {
  uuid,
  text,
  timestamp,
  unique,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

// Full-precision float32 vector(3072) — NOT halfvec.
// The cache stores the original Gemini API output at full precision.
// When copied to embedding_vectors for HNSW search, it gets cast to halfvec(3072).
// This preserves the original data for re-quantization if we change strategies.
// No HNSW index needed on this table (lookup is by hash, not by similarity).
const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(3072)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

export const vectorCache = claimnetSchema.table(
  "vector_cache",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    contentHash: text("content_hash").notNull(), // SHA-256 of source text
    modelId: text("model_id").notNull(), // e.g. 'gemini-embedding-2-preview'
    taskType: text("task_type").notNull(), // e.g. 'SEMANTIC_SIMILARITY'

    vector: vector3072("vector").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("vector_cache_hash_model_task_unique").on(t.contentHash, t.modelId, t.taskType),
    index("vector_cache_content_hash_idx").on(t.contentHash),
  ]
);

export type VectorCacheEntry = typeof vectorCache.$inferSelect;
export type NewVectorCacheEntry = typeof vectorCache.$inferInsert;
