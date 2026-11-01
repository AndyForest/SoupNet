/**
 * Tier 4: Vector API Call — per batch of cache misses (≤64).
 *
 * Calls the unified provider's batchEmbed (same implementation used by the
 * sync check path), writes vectors + populates cache.
 *
 * Every row is written under its own model_id, and a batch only ever calls one
 * model: a job holding several is split before any call is made.
 *
 * Failures split by whose fault they are (lib/embeddings/errors.ts):
 *   Provider side (429, 5xx, timeout, bad key, model gone): rows go back to
 *   'pending', the model backs off fleet-wide, and the sweep picks them up after.
 *   Nothing is marked failed and nothing is retried in a tight loop.
 *
 *   Row side (the provider refuses the input): binary-split retry to isolate it.
 *     Attempt 1: retry same batch
 *     Attempt 2+: split in half, enqueue two child jobs
 *     Batch of 1 that fails: mark vector as 'failed' permanently
 *
 * Image sources (artifact_category 'multimodal') can't go through the text batch.
 * With the original bytes on this disk they are embedded for real, with the same
 * region-of-interest treatment as the sync path. Without them the row gets a
 * text-only vector labelled vector_source='text_fallback', so the source stays in
 * search and the loss is countable. That vector never enters vector_cache: the
 * cache key covers the image bytes, and a text-only vector under it would poison
 * the entry (ADR-0019).
 *
 * See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture
 * See: docs/adr/0020-unified-embedding-service.md
 * See: docs/adr/0024-embedding-model-switch.md
 */

import type PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  batchEmbed,
  embedImagePartsStrict,
  getEmbeddingModelId,
  getEmbeddingProviderId,
  providerEmbedsImages,
} from "../../lib/embeddings/provider";
import { computeChunkHash } from "../../lib/embeddings/enqueue";
import { isProviderSideFailure } from "../../lib/embeddings/errors";
import { EmbeddingHttpError } from "../../lib/embeddings/errors";
import { cooldownRemainingMs, recordProviderPushback } from "../../lib/embeddings/provider-cooldown";
import { readStoredFile } from "../../lib/file-store";
import { QUEUES } from "../queues";
import type { VectorCheckItem } from "../queues";
import { loadVectorItems, type LoadedVectorItem } from "./load-vector-items";

interface ImageSource {
  fileHash: string | null;
  mimeType: string | null;
  regionMeta: { image_box?: { x0: number; y0: number; x1: number; y1: number } } | null;
}

const API_CALL_JOB_OPTIONS = {
  retryLimit: 2,
  retryDelay: 5,
  retryBackoff: true,
  expireInMinutes: 10,
} as const;

/** Background rebuild work yields to the read id's own rows. */
export function embeddingJobPriority(modelId: string): number {
  return modelId === getEmbeddingModelId() ? 1 : 0;
}

export async function handleVectorApiCall(
  job: { data: { items: VectorCheckItem[] }; retryCount?: number },
  boss: PgBoss,
  db: PostgresJsDatabase,
): Promise<void> {
  // Read fresh: a row deleted since this job was queued sends nothing to the provider.
  const items = await loadVectorItems(db, job.data.items);
  if (items.length === 0) return;
  const idsOnly = (list: LoadedVectorItem[]): VectorCheckItem[] =>
    list.map(({ vectorId, taskType, modelId }) => ({ vectorId, taskType, modelId }));

  // A batch calls one model. Anything else goes back on the queue, one job per model.
  const groups = new Map<string, LoadedVectorItem[]>();
  for (const item of items) {
    const key = `${item.modelId}\0${item.taskType}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  if (groups.size > 1) {
    for (const group of groups.values()) {
      await boss.send(QUEUES.VECTOR_API_CALL, { items: idsOnly(group) }, {
        ...API_CALL_JOB_OPTIONS,
        priority: embeddingJobPriority(group[0]!.modelId),
      });
    }
    return;
  }

  const taskType = items[0]!.taskType;
  const modelId = items[0]!.modelId;

  const remaining = await cooldownRemainingMs(db, modelId);
  if (remaining > 0) {
    await releaseToPending(db, items);
    return;
  }

  try {
    const imageSources = await readImageSources(db, items);
    const textOnly: LoadedVectorItem[] = [];
    const fallback: LoadedVectorItem[] = [];
    for (const item of items) {
      if (!imageSources.has(item.chunkId)) textOnly.push(item);
      else if (!(await embedRealImage(db, item, imageSources.get(item.chunkId)!, taskType, modelId))) {
        fallback.push(item);
      }
    }

    if (textOnly.length > 0) {
      const embeddings = await batchEmbed(textOnly.map((i) => i.chunkText), taskType, modelId);
      for (let i = 0; i < textOnly.length; i++) {
        const item = textOnly[i]!;
        const embedding = embeddings[i];
        if (!embedding) {
          await markFailed(db, item.vectorId, "No embedding returned for this index");
          continue;
        }
        const vectorStr = `[${embedding.join(",")}]`;
        // No cache row for a recipe deleted during the call.
        if (await writeVector(db, item.vectorId, modelId, vectorStr, "server")) {
          await writeCache(db, item.chunkHash, modelId, taskType, vectorStr);
        }
      }
    }

    if (fallback.length > 0) {
      const embeddings = await batchEmbed(fallback.map((i) => i.chunkText), taskType, modelId);
      for (let i = 0; i < fallback.length; i++) {
        const item = fallback[i]!;
        const embedding = embeddings[i];
        if (!embedding) {
          await markFailed(db, item.vectorId, "No embedding returned for this index");
          continue;
        }
        await writeVector(db, item.vectorId, modelId, `[${embedding.join(",")}]`, "text_fallback");
      }
      console.warn(
        `[vector-api-call] ${fallback.length} image sources embedded from text only under ${modelId}: bytes unavailable`,
      );
    }

    console.warn(
      `[vector-api-call] batch=${items.length}: ${items.length} vectors generated + cached (${taskType}) provider=${getEmbeddingProviderId()} model=${modelId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (isProviderSideFailure(err)) {
      const retryAfterMs = err instanceof EmbeddingHttpError ? err.retryAfterMs : undefined;
      const status = err instanceof EmbeddingHttpError ? err.status : "network";
      const delayMs = await recordProviderPushback(db, modelId, retryAfterMs);
      await releaseToPending(db, items);
      // Deliberately not the word the background-errors alarm counts: this is the
      // system working as designed, and it reports itself in the rebuild line too.
      console.warn(
        `[vector-api-call] Provider pushback (${status}) on ${modelId}: ${items.length} vectors back to pending, ` +
          `backing off ${Math.ceil(delayMs / 1000)}s`,
      );
      return;
    }

    const retryCount = job.retryCount ?? 0;

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

      await boss.send(QUEUES.VECTOR_API_CALL, { items: idsOnly(left) }, {
        ...API_CALL_JOB_OPTIONS,
        priority: embeddingJobPriority(modelId),
      });

      await boss.send(QUEUES.VECTOR_API_CALL, { items: idsOnly(right) }, {
        ...API_CALL_JOB_OPTIONS,
        priority: embeddingJobPriority(modelId),
      });

      return;
    }

    console.error(`[vector-api-call] Batch of ${items.length} failed (will retry): ${message}`);
    throw err;
  }
}

/** Which of these chunks are image sources, and where their bytes would be. */
async function readImageSources(
  db: PostgresJsDatabase,
  items: LoadedVectorItem[],
): Promise<Map<string, ImageSource>> {
  const chunkIds = sql.join(items.map((i) => sql`${i.chunkId}::uuid`), sql`, `);
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (ec.id) ec.id AS chunk_id, r.file_hash, r.file_mime_type, r.region_meta
    FROM claimnet.embedding_chunks ec
    JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
    LEFT JOIN claimnet.evidence_references er ON er.evidence_id = es.source_id AND es.source_type = 'evidence'
    LEFT JOIN claimnet."references" r ON r.id = er.reference_id AND r.file_hash IS NOT NULL
    WHERE ec.id IN (${chunkIds}) AND es.artifact_category = 'multimodal'
    ORDER BY ec.id, r.file_hash NULLS LAST
  `);
  const out = new Map<string, ImageSource>();
  for (const r of rows as unknown as Array<{
    chunk_id: string; file_hash: string | null; file_mime_type: string | null; region_meta: ImageSource["regionMeta"];
  }>) {
    out.set(r.chunk_id, { fileHash: r.file_hash, mimeType: r.file_mime_type, regionMeta: r.region_meta });
  }
  return out;
}

/**
 * Embed an image source from its original bytes. Returns false when the bytes aren't
 * here or the provider refuses them, leaving the row to the text-only fallback.
 * Provider-side failures propagate, so the whole batch backs off.
 */
async function embedRealImage(
  db: PostgresJsDatabase,
  item: LoadedVectorItem,
  source: ImageSource,
  taskType: string,
  modelId: string,
): Promise<boolean> {
  if (!providerEmbedsImages() || !source.fileHash || !source.mimeType) return false;
  const original = await readStoredFile(source.fileHash, source.mimeType);
  if (!original) return false;

  let bytes = original;
  let mimeType = source.mimeType;
  if (source.regionMeta?.image_box) {
    try {
      const { applyVisualCue } = await import("../../lib/image-roi");
      const processed = await applyVisualCue(original, source.regionMeta.image_box);
      bytes = processed.buffer;
      mimeType = processed.mimeType;
    } catch (err) {
      console.warn(`[vector-api-call] Region processing skipped for ${item.vectorId}:`, err instanceof Error ? err.message : err);
    }
  }

  let embedding: number[];
  try {
    embedding = await embedImagePartsStrict(
      [{ text: item.chunkText }, { inlineData: { mimeType, data: bytes.toString("base64") } }],
      modelId,
    );
  } catch (err) {
    if (isProviderSideFailure(err)) throw err;
    console.warn(`[vector-api-call] Provider refused image for ${item.vectorId}, using text only:`, err instanceof Error ? err.message : err);
    return false;
  }

  const vectorStr = `[${embedding.join(",")}]`;
  const written = await writeVector(db, item.vectorId, modelId, vectorStr, "server");
  // Cache only under a key that proves these are the bytes it was hashed from.
  if (written && computeChunkHash(item.chunkText, bytes) === item.chunkHash) {
    await writeCache(db, item.chunkHash, modelId, taskType, vectorStr);
  }
  return true;
}

async function writeVector(
  db: PostgresJsDatabase,
  vectorId: string,
  modelId: string,
  vectorStr: string,
  vectorSource: "server" | "text_fallback",
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET vector = ${vectorStr}::halfvec(3072),
        vector_source = ${vectorSource},
        status = 'complete',
        updated_at = now()
    WHERE id = ${vectorId}::uuid AND model_id = ${modelId}
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

async function writeCache(
  db: PostgresJsDatabase,
  chunkHash: string,
  modelId: string,
  taskType: string,
  vectorStr: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector)
    VALUES (${chunkHash}, ${modelId}, ${taskType}, ${vectorStr}::vector(3072))
    ON CONFLICT (content_hash, model_id, task_type) DO NOTHING
  `);
}

/** Rows not yet written go back to pending. retry_count is untouched: no row is at fault. */
async function releaseToPending(db: PostgresJsDatabase, items: VectorCheckItem[]): Promise<void> {
  await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'pending', updated_at = now()
    WHERE id IN (${sql.join(items.map((i) => sql`${i.vectorId}::uuid`), sql`, `)})
      AND status <> 'complete'
  `);
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
