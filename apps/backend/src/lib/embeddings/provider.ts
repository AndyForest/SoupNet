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
 * search filter, so it MUST be derived here (getEmbeddingModelId) rather than a
 * hardcoded string — otherwise a switch would return another model's vector
 * for the same content_hash (the cross-consumer poisoning 18912fbd warns against).
 *
 * This file is the one setting path for the model (ADR-0024): reads, the sync
 * wire, the worker and the cache all resolve here. EMBEDDINGS_MODEL is the id
 * search reads and the sync path writes. EMBEDDINGS_REBUILD_TARGET is a second id
 * the worker keeps a full set of vectors for. validateEmbeddingConfig() fails the
 * process at start on an unknown id. With EMBEDDINGS_MODEL unset on gemini, the id
 * comes from the database once, at start (read-model-resolve.ts).
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
  embedPartsStrict as geminiEmbedPartsStrict,
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

/**
 * Gemini models this stack can run. An entry means: returns 3072 dimensions when
 * asked and accepts text and image parts. Listed rather than free-form because a
 * typo as the read id is a silently empty search. A new model is one line here.
 */
export const GEMINI_MODELS: ReadonlySet<string> = new Set([
  "gemini-embedding-2-preview",
  "gemini-embedding-2",
]);

/** What a database with no vectors starts on. Never moves one that has them. */
export const RECOMMENDED_GEMINI_MODEL = "gemini-embedding-2";

const DEFAULT_REBUILD_VECTORS_PER_MINUTE = 600;

function trimmedEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function assertKnownGeminiModel(modelId: string, source: string): string {
  if (!GEMINI_MODELS.has(modelId)) {
    throw new Error(
      `${source}="${modelId}" is not a known Gemini embedding model. Known: ${[...GEMINI_MODELS].join(", ")}.`,
    );
  }
  return modelId;
}

let resolvedGeminiReadModel: string | null = null;

/** Called by read-model-resolve.ts, which holds the rule. */
export function setResolvedGeminiReadModel(modelId: string): void {
  resolvedGeminiReadModel = assertKnownGeminiModel(modelId, "the model found in the database");
}

function geminiReadModelId(): string {
  const model = trimmedEnv("EMBEDDINGS_MODEL");
  if (model) return assertKnownGeminiModel(model, "EMBEDDINGS_MODEL");
  if (resolvedGeminiReadModel) return resolvedGeminiReadModel;
  throw new Error(
    "The embedding read model isn't settled yet. Set EMBEDDINGS_MODEL, or call " +
      "resolveEmbeddingReadModel() after migrations in this process's entry point.",
  );
}

/** False only on gemini with no setting, before the database has been asked. */
function readModelSettled(): boolean {
  return selectProvider() !== "gemini" || Boolean(trimmedEnv("EMBEDDINGS_MODEL")) || resolvedGeminiReadModel !== null;
}

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
 * The model_id search reads and the sync path writes. Provider-derived so cache
 * and search are naturally model-scoped:
 *   - gemini            → EMBEDDINGS_MODEL, one of GEMINI_MODELS, or if unset the
 *                         id resolveEmbeddingReadModel() settled at start
 *   - stub              → "stub-embeddings"
 *   - local             → `local:${bareModel}` (e.g. "local:bge-small-en-v1.5")
 *   - openai-compatible → `oai:${bareModel}`
 * The org/ prefix is stripped so the id stays stable across equivalent repo ids.
 */
export function getEmbeddingModelId(): string {
  switch (selectProvider()) {
    case "gemini":
      return geminiReadModelId();
    case "stub":
      return "stub-embeddings";
    case "local":
      return `local:${bareModelName(embeddingModel())}`;
    case "openai-compatible":
      return `oai:${bareModelName(embeddingModel())}`;
  }
}

/**
 * The second model the worker keeps a full set of vectors for, or null.
 *
 * Not available on stub (one fixed id) or local (one model loaded in the process,
 * so a second one needs its own memory and warm-up); both change model by setting
 * EMBEDDINGS_MODEL, and the worker fills the gap with search empty meanwhile.
 */
export function getRebuildTargetModelId(): string | null {
  const raw = trimmedEnv("EMBEDDINGS_REBUILD_TARGET");
  if (!raw) return null;
  const provider = selectProvider();
  let target: string;
  if (provider === "gemini") {
    target = assertKnownGeminiModel(raw, "EMBEDDINGS_REBUILD_TARGET");
  } else if (provider === "openai-compatible") {
    target = `oai:${bareModelName(raw)}`;
  } else {
    throw new Error(
      `EMBEDDINGS_REBUILD_TARGET is not supported with EMBEDDINGS_PROVIDER="${provider}". ` +
        "Unset it and change EMBEDDINGS_MODEL instead; search is empty until the worker catches up.",
    );
  }
  if (readModelSettled() && target === getEmbeddingModelId()) {
    throw new Error(
      `EMBEDDINGS_REBUILD_TARGET="${raw}" is the model reads already use. Unset it, or name a different model.`,
    );
  }
  return target;
}

/** The models the worker embeds for: the read id first, then any rebuild target. */
export function getActiveEmbeddingModelIds(): string[] {
  const target = getRebuildTargetModelId();
  return target ? [getEmbeddingModelId(), target] : [getEmbeddingModelId()];
}

/** How many vectors a rebuild may add per minute across the fleet. 0 pauses it. */
export function getRebuildVectorsPerMinute(): number {
  const raw = trimmedEnv("EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE");
  if (!raw) return DEFAULT_REBUILD_VECTORS_PER_MINUTE;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE="${raw}" must be a whole number, 0 or more.`);
  }
  return Number(raw);
}

/**
 * Fail the process at start on an unknown model configuration. Runs before the
 * database is touched, so the unset gemini case is settled later, by
 * resolveEmbeddingReadModel().
 */
export function validateEmbeddingConfig(): void {
  selectProvider();
  if (readModelSettled()) getEmbeddingModelId();
  getRebuildTargetModelId();
  getRebuildVectorsPerMinute();
}

/** The name an openai-compatible server knows a row's model by. */
function openaiWireModel(modelId: string): string {
  if (modelId === getEmbeddingModelId()) return embeddingModel();
  if (modelId === getRebuildTargetModelId()) return trimmedEnv("EMBEDDINGS_REBUILD_TARGET");
  throw new Error(`Model ${modelId} is neither EMBEDDINGS_MODEL nor EMBEDDINGS_REBUILD_TARGET`);
}

/**
 * Embed a single text. Returns null on failure for graceful lexical fallback.
 * Stub provider never returns null. Local/openai vectors are fit to halfvec(3072)
 * centrally here; gemini/stub already emit 3072-dim.
 */
export async function embedQuery(
  text: string,
  taskType: string = "SEMANTIC_SIMILARITY",
  modelId: string = getEmbeddingModelId(),
): Promise<number[] | null> {
  switch (selectProvider()) {
    case "stub":
      return Promise.resolve(stubEmbeddingVector(text, taskType, modelId));
    case "local": {
      const v = await localEmbedQuery(text, taskType);
      return v ? fitTo3072(v) : null;
    }
    case "openai-compatible": {
      const v = await openaiEmbedQuery(text, taskType, openaiWireModel(modelId));
      return v ? fitTo3072(v) : null;
    }
    case "gemini":
      return geminiEmbedQuery(text, assertKnownGeminiModel(modelId, "modelId"));
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
  modelId: string = getEmbeddingModelId(),
): Promise<number[] | null> {
  switch (selectProvider()) {
    case "stub": {
      const text = parts
        .map((p) => ("text" in p ? p.text : `[inline:${p.inlineData.mimeType}:${p.inlineData.data.length}b]`))
        .join("\n");
      return Promise.resolve(stubEmbeddingVector(text, taskType, modelId));
    }
    case "local": {
      const v = await localEmbedMultimodal(parts, taskType);
      return v ? fitTo3072(v) : null;
    }
    case "openai-compatible": {
      const v = await openaiEmbedMultimodal(parts, taskType, openaiWireModel(modelId));
      return v ? fitTo3072(v) : null;
    }
    case "gemini":
      return geminiEmbedMultimodal(parts, assertKnownGeminiModel(modelId, "modelId"));
  }
}

/** Whether this provider embeds image parts natively rather than folding them to text. */
export function providerEmbedsImages(): boolean {
  return selectProvider() === "gemini";
}

/**
 * Multimodal embed for the async pipeline: throws, so the worker can tell a rate
 * limit from a refused image. Only meaningful where providerEmbedsImages().
 */
export async function embedImagePartsStrict(parts: ContentPart[], modelId: string): Promise<number[]> {
  return geminiEmbedPartsStrict(parts, assertKnownGeminiModel(modelId, "modelId"));
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
      return (await openaiBatchEmbed(texts, taskType, openaiWireModel(modelId))).map(fitTo3072);
    case "gemini":
      return geminiBatchEmbed(texts, assertKnownGeminiModel(modelId, "modelId"));
  }
}
