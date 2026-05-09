/**
 * Embedding pipeline — synchronous at recipe check time.
 *
 * Uses vector_cache table for content-addressed caching:
 * - Cache hit: copies vector from cache (no API call, ~5ms)
 * - Cache miss: calls Gemini API (~200-500ms), writes to cache + embedding_vectors
 * - Graceful degradation: if Gemini fails, inserts 'pending' stubs for worker
 *
 * The vector_cache table has no source text and no FKs — safe for PII cleanup.
 * Only stores: content_hash + model_id + task_type + vector.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { embedQuery, embedMultimodal } from "./provider";
import type { ContentPart } from "../gemini-client";

const MODEL_ID = "gemini-embedding-2-preview";

// KNOWN BUG (2026-03-29): gemini-embedding-2-preview ignores task_type — all types produce
// identical vectors (cosine similarity 1.0). We keep generating both so we're positioned
// to benefit when Google fixes this. Regenerate vector_cache when fixed.
// See: docs/architecture/embedding-test-results.md
// Bug report: https://discuss.ai.google.dev/t/gemini-embedding-2-preview-appears-to-ignore-task-type-for-text-and-image-embeddings/134720
const TASK_TYPES = ["RETRIEVAL_DOCUMENT", "SEMANTIC_SIMILARITY"] as const;

/**
 * Get a vector from cache, or generate via Gemini and cache it.
 * Returns the vector string (halfvec format) or null if unavailable.
 *
 * When multimodalParts is provided, uses embedMultimodal instead of embedQuery.
 * Cache still works via contentHash — but multimodal embeddings aren't cacheable
 * across different image+text combinations (the hash must reflect all parts).
 */
async function getOrCreateCachedVector(
  db: PostgresJsDatabase,
  contentHash: string,
  sourceText: string,
  taskType: string,
  multimodalParts?: ContentPart[],
): Promise<string | null> {
  // Check cache first
  const cached = await db.execute(sql`
    SELECT vector::text AS vector_str
    FROM claimnet.vector_cache
    WHERE content_hash = ${contentHash}
      AND model_id = ${MODEL_ID}
      AND task_type = ${taskType}
    LIMIT 1
  `);

  const cachedRow = (cached as unknown as Array<{ vector_str: string }>)[0];
  if (cachedRow) {
    return cachedRow.vector_str;
  }

  // Cache miss — call Gemini API (multimodal or text-only)
  const vector = multimodalParts
    ? await embedMultimodal(multimodalParts, taskType)
    : await embedQuery(sourceText, taskType);
  if (!vector) return null;

  const vectorStr = `[${vector.join(",")}]`;

  // Write to cache at full float32 precision (ON CONFLICT = another request cached it first)
  await db.execute(sql`
    INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector)
    VALUES (${contentHash}, ${MODEL_ID}, ${taskType}, ${vectorStr}::vector(3072))
    ON CONFLICT (content_hash, model_id, task_type) DO NOTHING
  `);

  return vectorStr;
}

export interface EnqueueEmbeddingParams {
  sourceType: string;
  sourceId: string;
  groupId: string;
  sourceText: string;
  artifactCategory: string;
  /** Chunking strategy ID. Defaults to 'full_document'. */
  strategyId?: string;
  /** Raw file bytes for multimodal embedding — images, video, audio, PDF (optional) */
  fileBuffer?: Buffer;
  /** MIME type for the file (required if fileBuffer provided) */
  fileMimeType?: string;
  /**
   * If true, insert pipeline rows with status='pending' and skip the Gemini API call.
   * The async worker sweep will pick these up and generate vectors.
   * Use for non-critical embeddings (evidence, full_recipe_context) that don't need
   * to be searchable immediately.
   */
  deferToWorker?: boolean;
}

export async function enqueueEmbedding(
  db: PostgresJsDatabase,
  params: EnqueueEmbeddingParams,
): Promise<void> {
  // Structural invariant: multimodal embeddings are sync-only.
  //
  // The async pipeline's VectorCheckItem carries chunk_text but not file
  // bytes or mime type. A deferred multimodal chunk would be embedded
  // text-only by the async consumer and written to vector_cache keyed
  // under the multimodal content hash — corrupting the cache for that
  // hash. See ADR-0019 §Consequences and ADR-0020. Lifting this
  // constraint requires threading file + region_meta through the job
  // payload; deferred until latency actually matters.
  if (params.deferToWorker && params.fileBuffer) {
    throw new Error(
      "enqueueEmbedding: deferToWorker=true is incompatible with fileBuffer. " +
        "Multimodal embeddings must be generated synchronously. See ADR-0019.",
    );
  }

  const category = params.fileBuffer ? "multimodal" : params.artifactCategory;

  // Insert the embedding source (sourceText is null for image-only)
  const sourceRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_sources
      (source_type, source_id, group_id, source_text, artifact_category)
    VALUES
      (${params.sourceType}, ${params.sourceId}::uuid, ${params.groupId}::uuid, ${params.sourceText}, ${category})
    RETURNING id
  `);

  const sourceRow = (sourceRows as unknown as Array<{ id: string }>)[0];
  if (!sourceRow) {
    throw new Error("Failed to insert embedding_sources row");
  }

  const strategyId = params.strategyId ?? "full_document";

  // Insert the chunk strategy (complete — chunking done inline)
  const strategyRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_chunk_strategies
      (embedding_source_id, strategy_id, status)
    VALUES
      (${sourceRow.id}::uuid, ${strategyId}, 'complete')
    RETURNING id
  `);

  const strategyRow = (strategyRows as unknown as Array<{ id: string }>)[0];
  if (!strategyRow) {
    throw new Error("Failed to insert embedding_chunk_strategies row");
  }

  // Content hash: combine text + image bytes for multimodal (ensures unique cache keys)
  const hasher = crypto.createHash("sha256");
  hasher.update(params.sourceText);
  if (params.fileBuffer) {
    hasher.update(params.fileBuffer);
  }
  const chunkHash = hasher.digest("hex");

  const chunkRows = await db.execute(sql`
    INSERT INTO claimnet.embedding_chunks
      (embedding_source_id, chunk_strategy_id, chunk_text, chunk_hash, chunk_path, metadata)
    VALUES
      (${sourceRow.id}::uuid, ${strategyRow.id}::uuid, ${params.sourceText}, ${chunkHash}, 'doc', '{}'::jsonb)
    RETURNING id
  `);

  const chunkRow = (chunkRows as unknown as Array<{ id: string }>)[0];
  if (!chunkRow) {
    throw new Error("Failed to insert embedding_chunks row");
  }

  // Build multimodal parts if image is present
  const multimodalParts: ContentPart[] | undefined = params.fileBuffer && params.fileMimeType
    ? [
        { text: params.sourceText },
        { inlineData: { mimeType: params.fileMimeType, data: params.fileBuffer.toString("base64") } },
      ]
    : undefined;

  // When deferring to worker: insert pending stubs, skip Gemini API calls.
  // The worker sweep picks up pending vectors and generates them in batch.
  if (params.deferToWorker) {
    for (const taskType of TASK_TYPES) {
      await db.execute(sql`
        INSERT INTO claimnet.embedding_vectors
          (embedding_chunk_id, model_id, task_type, status, vector)
        VALUES
          (${chunkRow.id}::uuid, ${MODEL_ID}, ${taskType}, 'pending', NULL)
      `);
    }
    return;
  }

  // Sync path: get vectors from cache or Gemini API for each task type
  for (const taskType of TASK_TYPES) {
    const vectorStr = await getOrCreateCachedVector(
      db, chunkHash, params.sourceText, taskType, multimodalParts,
    );

    if (vectorStr) {
      await db.execute(sql`
        INSERT INTO claimnet.embedding_vectors
          (embedding_chunk_id, model_id, task_type, status, vector)
        VALUES
          (${chunkRow.id}::uuid, ${MODEL_ID}, ${taskType}, 'complete', ${vectorStr}::vector(3072)::halfvec(3072))
      `);
    } else {
      // Gemini unavailable — insert pending stub for worker
      await db.execute(sql`
        INSERT INTO claimnet.embedding_vectors
          (embedding_chunk_id, model_id, task_type, status, vector)
        VALUES
          (${chunkRow.id}::uuid, ${MODEL_ID}, ${taskType}, 'pending', NULL)
      `);
    }
  }
}
