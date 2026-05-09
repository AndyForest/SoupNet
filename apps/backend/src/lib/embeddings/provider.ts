/**
 * Embedding provider abstraction — single source of truth for sync and async paths.
 *
 * The sync path (enqueue.ts, `/check` route) and the async pipeline
 * (embedding-worker/jobs/*) both call through this module. One
 * EMBEDDINGS_PROVIDER env var chooses the provider process-wide:
 *
 *   gemini  — real Gemini API via gemini-client.ts (default; required in prod)
 *   stub    — deterministic fake vectors via @soupnet/domain stubEmbeddingVector.
 *             No network. Same input → same vector → same hash → real
 *             vector_cache logic still works.
 *
 * Multimodal support: the stub treats multimodal calls as text embeddings of
 * the concatenated text parts. Callers that care about image bytes already
 * fold them into chunk_hash upstream (see enqueue.ts) so cache keys stay
 * distinct regardless.
 *
 * See docs/adr/0020-unified-embedding-service.md for why sync and async share
 * this module.
 */

import { stubEmbeddingVector } from "@soupnet/domain";
import {
  embedQuery as geminiEmbedQuery,
  embedMultimodal as geminiEmbedMultimodal,
  batchEmbed as geminiBatchEmbed,
} from "../gemini-client";
import type { ContentPart } from "../gemini-client";

const MODEL_ID = "gemini-embedding-2-preview";

export type EmbeddingProviderId = "gemini" | "stub";

let cachedProvider: EmbeddingProviderId | null = null;

function selectProvider(): EmbeddingProviderId {
  if (cachedProvider) return cachedProvider;
  const raw = (process.env["EMBEDDINGS_PROVIDER"] ?? "gemini").toLowerCase();
  if (raw === "stub") {
    cachedProvider = "stub";
  } else if (raw === "gemini") {
    cachedProvider = "gemini";
  } else {
    throw new Error(
      `Invalid EMBEDDINGS_PROVIDER=${raw}. Must be "gemini" or "stub".`,
    );
  }
  return cachedProvider;
}

export function getEmbeddingProviderId(): EmbeddingProviderId {
  return selectProvider();
}

/**
 * Embed a single text. Returns null on failure for graceful lexical fallback.
 * Stub provider never returns null.
 */
export async function embedQuery(
  text: string,
  taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  if (selectProvider() === "stub") {
    return Promise.resolve(stubEmbeddingVector(text, taskType, MODEL_ID));
  }
  return geminiEmbedQuery(text, taskType);
}

/**
 * Embed multimodal content parts. Stub provider hashes only the text parts —
 * tests don't need real image embeddings, and any caller that needs to
 * differentiate by image bytes already includes the bytes in chunk_hash
 * upstream (see enqueue.ts:136).
 */
export async function embedMultimodal(
  parts: ContentPart[],
  taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  if (selectProvider() === "stub") {
    const text = parts
      .map((p) => ("text" in p ? p.text : `[inline:${p.inlineData.mimeType}:${p.inlineData.data.length}b]`))
      .join("\n");
    return Promise.resolve(stubEmbeddingVector(text, taskType, MODEL_ID));
  }
  return geminiEmbedMultimodal(parts, taskType);
}

/**
 * Batch-embed an array of texts. Used by the async pipeline for cache-miss
 * batches. Throws on failure — pipeline applies binary-split retry.
 *
 * The async pipeline carries model_id through from the vector row, so the
 * modelId arg is explicit rather than defaulted here.
 */
export async function batchEmbed(
  texts: string[],
  taskType: string,
  modelId: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (selectProvider() === "stub") {
    return Promise.resolve(texts.map((t) => stubEmbeddingVector(t, taskType, modelId)));
  }
  return geminiBatchEmbed(texts, taskType, modelId);
}
