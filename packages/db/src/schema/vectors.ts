/**
 * Vector store tables — four-table pipeline.
 *
 * Pipeline:
 *   embedding_sources          ← written by main app alongside the source object
 *       └── embedding_chunk_strategies  ← which chunking strategies to apply (one per row)
 *               └── embedding_chunks    ← text chunks produced by each strategy
 *                       └── embedding_vectors  ← vectors (one per chunk + model + task_type)
 *
 * Worker 1 (chunking):  polls embedding_chunk_strategies WHERE status='pending',
 *                        runs the strategy, inserts embedding_chunks rows,
 *                        then inserts embedding_vectors stubs (status='pending').
 *
 * Worker 2 (vectoring): polls embedding_vectors WHERE status='pending',
 *                        batches up to 200 rows per Gemini API call,
 *                        writes the vector, marks status='complete'.
 *
 * Why four tables:
 *   - Multiple chunking strategies per source without duplicating source text
 *   - Multiple task_types per chunk without duplicating chunk text
 *   - Clear status tracking at each pipeline stage
 *   - Future: swap vector backend (e.g. AWS S3 Vectors) by changing Worker 2 only
 *
 * vector_source on embedding_vectors:
 *   'server' — vector was computed by the ClaimNet server (default)
 *   'client' — vector was computed client-side via @soupnet/sdk (air-gapped mode)
 *   Client-computed vectors are org-scoped only and excluded from cross-org search.
 *   See: docs/adr/0014-client-side-vector-computation.md
 *
 * See: docs/architecture/vector-store.md (includes ER diagram)
 * See: docs/adr/0005-embedding-models.md
 */

import {
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  unique,
  customType,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

/**
 * pgvector halfvec column — 3072 dimensions.
 *
 * WHY halfvec AND NOT vector:
 *   pgvector's HNSW index has a hard 2,000-dimension limit for the `vector`
 *   type. `halfvec` (16-bit floats, pgvector ≥ 0.7.0) raises that limit to
 *   4,000 dimensions, making it the required type for 3072-dim embeddings
 *   should an ANN index return (see migration 0026 — the HNSW index was
 *   dropped as unused at current scale). Standing benefit: 50% storage
 *   reduction vs float32, with similar search quality.
 *
 * Queries cast the query vector: `$vec::halfvec(3072) <=> vector`.
 *
 * MRL: gemini-embedding-2-preview supports truncation to 128/768/1536/3072
 * via output_dimensionality. Re-embedding is not required to truncate.
 *
 * Requires: pgvector ≥ 0.7.0 (our docker image pgvector/pgvector:pg17 satisfies this).
 *
 * Column is nullable — row is inserted with status=pending before vector exists.
 * Worker populates it and sets status=complete.
 */
const halfvec3072 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "halfvec(3072)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

// ── embedding_sources ──────────────────────────────────────────────────────────

/**
 * The complete source text to be chunked and vectorized.
 *
 * Written by the main app as part of the same transaction that creates the
 * source object (claim, validation, request). The source_text captures the
 * full content at write time — if the source is later updated, a new row
 * should be inserted and the old chunks re-generated.
 *
 * organization_id is stored here (not denormalized to vectors) to keep the
 * vector rows small. ACL filtering in search joins back to this table.
 */
export const embeddingSources = claimnetSchema.table(
  "embedding_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    sourceType: text("source_type").notNull(),  // claim | validation | request
    sourceId: uuid("source_id").notNull(),       // no FK — cross-schema UUID ref
    groupId: uuid("group_id").notNull(), // ref → groups.id

    // The full text content to be chunked. Captured at write time.
    // NULL reserved for future multimodal sources (image bytes stored in S3, not here).
    sourceText: text("source_text"),

    artifactCategory: text("artifact_category").notNull(),
    // text | code | data | image — informs chunking strategy selection

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("embedding_sources_source_idx").on(t.sourceType, t.sourceId),
    index("embedding_sources_group_idx").on(t.groupId),
  ]
);

export type EmbeddingSource = typeof embeddingSources.$inferSelect;
export type NewEmbeddingSource = typeof embeddingSources.$inferInsert;

// ── embedding_chunk_strategies ─────────────────────────────────────────────────

/**
 * Which chunking strategies to apply to a source — one row per strategy.
 *
 * The chunking worker polls for status='pending' rows, applies the named
 * strategy, inserts embedding_chunks rows, then marks this row complete.
 * Adding a new strategy is a new row + new worker implementation.
 *
 * Strategy ID examples:
 *   'full_document'        — whole source as a single chunk (always created; used for dedup)
 *   'overlap_256_64'       — 256-token windows, 64-token overlap
 *   'overlap_512_128'      — 512-token windows, 128-token overlap
 *   'semantic_markdown'    — split on markdown heading levels
 *   'hierarchical_512_256' — 512-token parent chunks, each rechunked to 256-token children
 */
export const embeddingChunkStrategies = claimnetSchema.table(
  "embedding_chunk_strategies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    embeddingSourceId: uuid("embedding_source_id")
      .notNull()
      .references(() => embeddingSources.id),

    strategyId: text("strategy_id").notNull(),
    // e.g. 'full_document' | 'overlap_256_64' | 'semantic_markdown'

    status: text("status").notNull().default("pending"),
    // pending | processing | complete | failed

    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("embedding_chunk_strategies_source_idx").on(t.embeddingSourceId),
    index("embedding_chunk_strategies_status_idx").on(t.status),
    // Partial index for pending rows defined in migration SQL:
    // CREATE INDEX ON claimnet.embedding_chunk_strategies (id)
    //   WHERE status = 'pending';
    unique("embedding_chunk_strategies_source_strategy_unique").on(
      t.embeddingSourceId,
      t.strategyId
    ),
  ]
);

export type EmbeddingChunkStrategy = typeof embeddingChunkStrategies.$inferSelect;
export type NewEmbeddingChunkStrategy = typeof embeddingChunkStrategies.$inferInsert;

// ── embedding_chunks ───────────────────────────────────────────────────────────

/**
 * Text chunks produced by a chunking strategy — one row per chunk.
 *
 * chunk_hash enables deduplication: the same text appearing in multiple
 * sources or under multiple strategies shares a hash. Future optimization:
 * skip vector generation if a vector with this hash already exists.
 *
 * chunk_path is a hierarchical path string describing where this chunk sits
 * within the source structure, e.g:
 *   'doc'                       — whole document (full_document strategy)
 *   'doc/section[0]'            — first section
 *   'doc/section[0]/para[2]'    — third paragraph of first section
 *   'doc/section[0]/chunk[0]'   — first overlapping chunk within first section
 *
 * metadata carries strategy-specific fields:
 *   { tokenStart, tokenEnd, overlapTokens }   — for overlap strategies
 *   { headingLevel, headingText }             — for semantic_markdown
 *   { parentChunkId }                         — for hierarchical strategies
 */
export const embeddingChunks = claimnetSchema.table(
  "embedding_chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    embeddingSourceId: uuid("embedding_source_id")
      .notNull()
      .references(() => embeddingSources.id),

    chunkStrategyId: uuid("chunk_strategy_id")
      .notNull()
      .references(() => embeddingChunkStrategies.id),

    chunkText: text("chunk_text").notNull(),
    chunkHash: varchar("chunk_hash", { length: 64 }).notNull(), // SHA-256 hex

    // Hierarchical path within the source document
    chunkPath: text("chunk_path"),

    // Strategy-specific metadata (token offsets, heading level, parent chunk ID, etc.)
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("embedding_chunks_source_idx").on(t.embeddingSourceId),
    index("embedding_chunks_strategy_idx").on(t.chunkStrategyId),
    index("embedding_chunks_hash_idx").on(t.chunkHash),
  ]
);

export type EmbeddingChunk = typeof embeddingChunks.$inferSelect;
export type NewEmbeddingChunk = typeof embeddingChunks.$inferInsert;

// ── embedding_vectors ──────────────────────────────────────────────────────────

/**
 * Vectors — one row per (chunk, model, task_type) combination.
 *
 * The vectoring worker polls status='pending', batches up to 200 per
 * Gemini API call, writes the vector float array, marks status='complete'.
 *
 * vector_source:
 *   'server' — computed by ClaimNet server via Gemini API (default)
 *   'client' — computed client-side via @soupnet/sdk (air-gapped mode)
 * Client-computed vectors are org-scoped only (excluded from cross-org search).
 * The vector_source is always visible in search result metadata.
 *
 * Task types (from Gemini embedding-2 API):
 *   RETRIEVAL_DOCUMENT  — used when indexing content to be retrieved
 *   RETRIEVAL_QUERY     — used for user/agent search queries
 *   CODE_RETRIEVAL_QUERY — used for code-specific search queries
 *   SEMANTIC_SIMILARITY — for pairwise similarity (not retrieval)
 *   QUESTION_ANSWERING  — for QA system queries
 *   FACT_VERIFICATION   — for statements to be verified (relevant for validations)
 *   CLUSTERING          — for document grouping (not needed for search)
 *
 * MVP uses: RETRIEVAL_DOCUMENT (indexing), RETRIEVAL_QUERY (text search),
 *           CODE_RETRIEVAL_QUERY (code search).
 *
 * HNSW index is defined in migration SQL — drizzle-kit cannot express
 * CREATE INDEX USING hnsw ... WITH (m=16, ef_construction=64).
 */
export const embeddingVectors = claimnetSchema.table(
  "embedding_vectors",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    embeddingChunkId: uuid("embedding_chunk_id")
      .notNull()
      .references(() => embeddingChunks.id),

    modelId: text("model_id").notNull(),
    // e.g. 'gemini-embedding-2-preview'

    taskType: text("task_type").notNull(),
    // RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY | CODE_RETRIEVAL_QUERY | ...

    vectorSource: text("vector_source").notNull().default("server"),
    // 'server' | 'client'
    // client vectors are org-scoped only; never included in cross-org public search

    status: text("status").notNull().default("pending"),
    // pending | processing | complete | failed
    // For vector_source='client', status is set to 'complete' on insert (pre-computed).

    error: text("error"),

    // Number of times this vector has been retried (auto + manual).
    // Auto-recovery in strategy sweep increments this when resetting stuck
    // 'processing' vectors. If retry_count >= AUTO_RETRY_LIMIT (3), the
    // vector is marked 'failed' instead of being reset. Manual retries
    // (admin panel) also increment but are not capped.
    // See: docs/architecture/admin-dashboards.md §Retry semantics
    retryCount: integer("retry_count").notNull().default(0),

    // NULL until worker populates. Nullable by design — row exists before vector does.
    // For vector_source='client', populated at insert time.
    vector: halfvec3072("vector"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One vector per (chunk, model, task_type)
    unique("embedding_vectors_chunk_model_task_unique").on(
      t.embeddingChunkId,
      t.modelId,
      t.taskType
    ),
    index("embedding_vectors_status_idx").on(t.status),
    index("embedding_vectors_chunk_idx").on(t.embeddingChunkId),
    index("embedding_vectors_source_idx").on(t.vectorSource),
    // No vector (ANN) index: the original HNSW index was dropped in migration
    // 0026 — the planner never chose it (search top-N seq-scans exactly at
    // current scale) while it cost 95 MB of buffer space + per-insert graph
    // maintenance. Recreate it (halfvec_cosine_ops, m=16, ef_construction=64)
    // alongside a query reshape when the corpus makes the exact scan slow —
    // see docs/backlog.md §Recipe-check latency and migration 0026's comment.
  ]
);

export type EmbeddingVector = typeof embeddingVectors.$inferSelect;
export type NewEmbeddingVector = typeof embeddingVectors.$inferInsert;

// ranking_signals table removed — coverage signals are computed at query time
// in the search-as-logging model. See packages/domain/src/ranking.ts.
