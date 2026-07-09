/**
 * Embedding provider abstraction — single source of truth for sync and async paths.
 *
 * The sync path (enqueue.ts, `/check` route) and the async pipeline
 * (embedding-worker/jobs/*) both call through this module. One
 * EMBEDDINGS_PROVIDER env var chooses the provider process-wide:
 *
 *   gemini            — real Gemini API via gemini-client.ts (default; required in prod)
 *   stub              — deterministic fake vectors via @soupnet/domain stubEmbeddingVector.
 *                       No network. Same input → same vector → same hash → real
 *                       vector_cache logic still works.
 *   local             — in-process CPU inference via @huggingface/transformers (ONNX),
 *                       local-client.ts. Zero external service, zero API key. Default
 *                       model bge-small-en-v1.5 (384-dim). Serves headless CI / tire-kicker
 *                       / lowest-friction self-host personas.
 *   openai-compatible — any OpenAI-style /v1/embeddings endpoint (llama.cpp, LM Studio,
 *                       Ollama, TEI, …) via openai-client.ts, configured by
 *                       EMBEDDINGS_BASE_URL + EMBEDDINGS_MODEL. Serves the self-hoster
 *                       running a stronger/SOTA model through their own harness.
 *
 * See docs/planning/local-embedding-provider.md for the two-provider design and
 * docs/adr/0020-unified-embedding-service.md for why sync and async share this module.
 *
 * Dimension policy: gemini/stub already emit 3072-dim vectors and pass through
 * untouched. The local/openai-compatible clients return NATIVE-dimension vectors
 * (e.g. bge-small → 384); this seam maps them into the searchable halfvec(3072)
 * space with a single central `.map(fitTo3072)` on dispatch return — one behavior,
 * one place (recipe trace 18912fbd), never duplicated inside each client.
 *
 * Model identity: model_id is part of the content-addressed cache key and the
 * search filter, so it MUST be provider-derived (getEmbeddingModelId) rather than a
 * hardcoded string — otherwise a provider switch would return another model's vector
 * for the same content_hash (the cross-consumer poisoning 18912fbd warns against).
 *
 * Multimodal support: gemini is multimodal; stub, local, and openai-compatible are
 * text-only and fold multimodal parts into the concatenated text (image bytes are
 * already folded into chunk_hash upstream — see enqueue.ts — so cache keys stay
 * distinct regardless).
 */

import { stubEmbeddingVector } from "@soupnet/domain";
import {
  embedQuery as geminiEmbedQuery,
  embedMultimodal as geminiEmbedMultimodal,
  batchEmbed as geminiBatchEmbed,
} from "../gemini-client";
import type { ContentPart } from "../gemini-client";
import {
  embedQuery as localEmbedQuery,
  embedMultimodal as localEmbedMultimodal,
  batchEmbed as localBatchEmbed,
  localModelRepoId,
} from "./local-client";
import {
  embedQuery as openaiEmbedQuery,
  embedMultimodal as openaiEmbedMultimodal,
  batchEmbed as openaiBatchEmbed,
} from "./openai-client";
import { fitTo3072 } from "./dims";

export type EmbeddingProviderId = "gemini" | "stub" | "local" | "openai-compatible";

let cachedProvider: EmbeddingProviderId | null = null;
let cachedModel: string | null = null;
let cachedBaseUrl: string | null = null;

function selectProvider(): EmbeddingProviderId {
  if (cachedProvider) return cachedProvider;
  const raw = (process.env["EMBEDDINGS_PROVIDER"] ?? "gemini").toLowerCase();
  if (raw === "stub") {
    cachedProvider = "stub";
  } else if (raw === "gemini") {
    cachedProvider = "gemini";
  } else if (raw === "local") {
    cachedProvider = "local";
  } else if (raw === "openai-compatible") {
    cachedProvider = "openai-compatible";
  } else {
    throw new Error(
      `Invalid EMBEDDINGS_PROVIDER=${raw}. Must be "gemini", "stub", "local", or "openai-compatible".`,
    );
  }
  return cachedProvider;
}

export function getEmbeddingProviderId(): EmbeddingProviderId {
  return selectProvider();
}

/**
 * Resolved wire/repo model name for the pluggable-model providers.
 * Memoized (mirrors selectProvider). Meaningful only for `local` and
 * `openai-compatible` — gemini/stub have a fixed model id and never call this.
 *   - local             → EMBEDDINGS_MODEL, else the bge-small default.
 *   - openai-compatible → EMBEDDINGS_MODEL, required (throws clearly if unset).
 */
export function embeddingModel(): string {
  if (cachedModel !== null) return cachedModel;
  if (selectProvider() === "openai-compatible") {
    const env = process.env["EMBEDDINGS_MODEL"];
    if (!env) {
      throw new Error(
        'EMBEDDINGS_MODEL is required when EMBEDDINGS_PROVIDER="openai-compatible" — ' +
          "it is the model id sent to the /v1/embeddings endpoint (e.g. nomic-embed-text).",
      );
    }
    cachedModel = env;
  } else {
    // local: the repo id + built-in default resolve in local-client (single source
    // of truth), so the loaded model and the derived model_id can never diverge.
    cachedModel = localModelRepoId();
  }
  return cachedModel;
}

/**
 * Resolved base URL for the `openai-compatible` provider (EMBEDDINGS_BASE_URL).
 * Memoized. Throws clearly if unset — the openai-compatible provider cannot run
 * without a target endpoint. Not meaningful for the other providers.
 */
export function embeddingBaseUrl(): string {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  const raw = process.env["EMBEDDINGS_BASE_URL"];
  if (!raw) {
    throw new Error(
      'EMBEDDINGS_BASE_URL is required when EMBEDDINGS_PROVIDER="openai-compatible" — ' +
        "the OpenAI-style base that already carries the version segment (e.g. http://localhost:8080/v1).",
    );
  }
  cachedBaseUrl = raw;
  return cachedBaseUrl;
}

/** Strip any `org/` prefix from a repo/model name (e.g. "BAAI/bge-small" → "bge-small"). */
function bareModelName(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

/**
 * The model_id written into embedding_vectors / vector_cache and filtered on at
 * search time. Provider-derived so cache and search are naturally model-scoped:
 *   - gemini            → "gemini-embedding-2-preview"
 *   - stub              → "stub-embeddings"
 *   - local             → `local:${bareModel}` (e.g. "local:bge-small-en-v1.5")
 *   - openai-compatible → `oai:${bareModel}`
 * The org/ prefix is stripped so the id stays stable across equivalent repo ids.
 */
export function getEmbeddingModelId(): string {
  switch (selectProvider()) {
    case "gemini":
      return "gemini-embedding-2-preview";
    case "stub":
      return "stub-embeddings";
    case "local":
      return `local:${bareModelName(embeddingModel())}`;
    case "openai-compatible":
      return `oai:${bareModelName(embeddingModel())}`;
  }
}

/**
 * Embed a single text. Returns null on failure for graceful lexical fallback.
 * Stub provider never returns null. Local/openai vectors are fit to halfvec(3072)
 * centrally here; gemini/stub already emit 3072-dim.
 */
export async function embedQuery(
  text: string,
  taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  switch (selectProvider()) {
    case "stub":
      return Promise.resolve(stubEmbeddingVector(text, taskType, getEmbeddingModelId()));
    case "local": {
      const v = await localEmbedQuery(text, taskType);
      return v ? fitTo3072(v) : null;
    }
    case "openai-compatible": {
      const v = await openaiEmbedQuery(text, taskType);
      return v ? fitTo3072(v) : null;
    }
    case "gemini":
      return geminiEmbedQuery(text, taskType);
  }
}

/**
 * Embed multimodal content parts. gemini embeds parts natively; stub/local/openai
 * fold parts to text (the client owns the fold for local/openai). Returns null on
 * failure. Local/openai vectors are fit to halfvec(3072) centrally here.
 */
export async function embedMultimodal(
  parts: ContentPart[],
  taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  switch (selectProvider()) {
    case "stub": {
      const text = parts
        .map((p) => ("text" in p ? p.text : `[inline:${p.inlineData.mimeType}:${p.inlineData.data.length}b]`))
        .join("\n");
      return Promise.resolve(stubEmbeddingVector(text, taskType, getEmbeddingModelId()));
    }
    case "local": {
      const v = await localEmbedMultimodal(parts, taskType);
      return v ? fitTo3072(v) : null;
    }
    case "openai-compatible": {
      const v = await openaiEmbedMultimodal(parts, taskType);
      return v ? fitTo3072(v) : null;
    }
    case "gemini":
      return geminiEmbedMultimodal(parts, taskType);
  }
}

/**
 * Batch-embed an array of texts. Used by the async pipeline for cache-miss
 * batches. Throws on failure — pipeline applies binary-split retry.
 *
 * The async pipeline carries model_id through from the vector row, so the
 * modelId arg is explicit rather than defaulted here. Local/openai vectors are
 * fit to halfvec(3072) centrally here (one behavior, one place).
 */
export async function batchEmbed(
  texts: string[],
  taskType: string,
  modelId: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  switch (selectProvider()) {
    case "stub":
      return Promise.resolve(texts.map((t) => stubEmbeddingVector(t, taskType, modelId)));
    case "local":
      return (await localBatchEmbed(texts, taskType, modelId)).map(fitTo3072);
    case "openai-compatible":
      return (await openaiBatchEmbed(texts, taskType, modelId)).map(fitTo3072);
    case "gemini":
      return geminiBatchEmbed(texts, taskType, modelId);
  }
}
