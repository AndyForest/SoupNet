/**
 * OpenAI-compatible embedding client — single source of truth for HTTP calls
 * to any OpenAI-style `/v1/embeddings` endpoint (llama.cpp `llama-server`,
 * LM Studio, Ollama, Hugging Face TEI, vLLM, …). Selected via
 * `EMBEDDINGS_PROVIDER=openai-compatible`; see
 * docs/planning/local-embedding-provider.md.
 *
 * Exposes the same trio as gemini-client, with the same contract:
 *   - embedQuery(text)        — single text, returns null on error
 *   - embedMultimodal(parts)  — text + inline parts folded to text, null on error
 *   - batchEmbed(texts)       — batch endpoint for the async pipeline, throws on error
 *
 * The null-returning variants let the sync check path degrade to lexical; the
 * async pipeline uses batchEmbed because it wants failures surfaced for its
 * binary-split retry policy — mirroring gemini-client exactly so provider
 * dispatch at the seam stays uniform.
 *
 * Configuration (read from the environment, not passed in):
 *   - EMBEDDINGS_BASE_URL — the OpenAI-style base that already carries the
 *     version segment, e.g. `http://localhost:8080/v1`. The request path is
 *     `${base}/embeddings` (the base includes `/v1`; we do NOT re-append it —
 *     that is the convention every documented harness exposes). Required.
 *   - EMBEDDINGS_MODEL    — model id sent in the request body.
 *   - EMBEDDINGS_API_KEY  — optional; sent as `Authorization: Bearer <key>`
 *     when set (local harnesses like llama.cpp need no key).
 *
 * This client is a thin transport: it returns the model's NATIVE-dimension
 * vectors. Fitting to the stored `halfvec(3072)` column and deriving the
 * cache-scoping model_id both live centrally at the provider seam, not here
 * (one behavior, one place — see recipe 18912fbd).
 */

import type { ContentPart } from "../gemini-client";

const SINGLE_TIMEOUT_MS = 30_000;
const BATCH_TIMEOUT_MS = 60_000;

/** Shape of a successful OpenAI-compatible `/v1/embeddings` response. */
interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
}

function baseUrl(): string | undefined {
  const raw = process.env["EMBEDDINGS_BASE_URL"];
  if (!raw) return undefined;
  return raw.replace(/\/+$/, ""); // trim trailing slash(es); base already ends in /v1
}

/**
 * POST to `${EMBEDDINGS_BASE_URL}/embeddings` and return one vector per input,
 * in request order. Throws on any failure (missing base URL, non-OK response,
 * malformed body) — the null-returning wrappers below catch; batchEmbed lets
 * it propagate.
 *
 * @param input a single string (single embed) or string[] (batch embed)
 */
async function requestEmbeddings(
  input: string | string[],
  timeoutMs: number,
): Promise<number[][]> {
  const base = baseUrl();
  if (!base) {
    throw new Error(
      "EMBEDDINGS_BASE_URL is required for the openai-compatible embedding provider",
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["EMBEDDINGS_API_KEY"];
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input, model: process.env["EMBEDDINGS_MODEL"] ?? "" }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI-compatible embedding API error ${response.status}: ${body}`);
  }

  const parsed = (await response.json()) as EmbeddingsResponse;
  const rows = parsed.data;
  if (!Array.isArray(rows)) {
    throw new Error("OpenAI-compatible embedding response missing `data` array");
  }

  // Preserve request order: map the data array as returned.
  return rows.map((row, i) => {
    if (!Array.isArray(row.embedding)) {
      throw new Error(`OpenAI-compatible embedding response missing embedding at index ${i}`);
    }
    return row.embedding;
  });
}

/**
 * Generate an embedding for a text string.
 * Returns null on any error so search falls back to lexical-only.
 *
 * `_taskType` is accepted for signature parity with gemini-client's dispatch
 * at the seam; the OpenAI embeddings API has no task-type concept, so it is
 * intentionally unused.
 */
export async function embedQuery(
  text: string,
  _taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  try {
    const [vector] = await requestEmbeddings(text, SINGLE_TIMEOUT_MS);
    return vector ?? null;
  } catch (err) {
    console.error("[openai-embeddings] Embedding request error:", err);
    return null; // fallback to lexical
  }
}

/**
 * Generate an embedding from mixed text + inline parts. The documented
 * OpenAI-compatible embedding models are text-only, so parts are folded to a
 * single text string exactly as the stub provider does (image parts become a
 * short `[inline:<mime>:<bytes>b]` marker). Returns null on any error.
 */
export async function embedMultimodal(
  parts: ContentPart[],
  _taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  const text = parts
    .map((p) =>
      "text" in p ? p.text : `[inline:${p.inlineData.mimeType}:${p.inlineData.data.length}b]`,
    )
    .join("\n");
  try {
    const [vector] = await requestEmbeddings(text, SINGLE_TIMEOUT_MS);
    return vector ?? null;
  } catch (err) {
    console.error("[openai-embeddings] Multimodal embedding request error:", err);
    return null; // fallback to lexical
  }
}

/**
 * Batch-embed an array of texts in a single request. Throws on any error —
 * the async pipeline catches and applies binary-split retry.
 *
 * `_taskType` and `_modelId` are accepted for signature parity with the
 * provider seam's dispatch; the OpenAI embeddings API has no task type, and
 * the wire model always comes from EMBEDDINGS_MODEL (the seam's modelId is the
 * internal cache-scoping id, not the server's model name).
 */
export async function batchEmbed(
  texts: string[],
  _taskType: string,
  _modelId?: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  return requestEmbeddings(texts, BATCH_TIMEOUT_MS);
}
