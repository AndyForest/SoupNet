/**
 * Gemini embedding client — single source of truth for Gemini HTTP calls.
 *
 * Exposes:
 *   - embedQuery(text, taskType) — single text, returns null on error
 *   - embedMultimodal(parts, taskType) — text + inline image parts, returns null on error
 *   - batchEmbed(texts, taskType, modelId?) — batch endpoint for async pipeline, throws on error
 *
 * The sync check path (enqueue.ts) uses the null-returning variants so search
 * degrades to lexical. The async pipeline (embedding-worker/jobs/vector-api-call.ts)
 * uses batchEmbed because it explicitly wants failures surfaced for its
 * binary-split retry policy.
 *
 * Kill-switch: if `embeddingsEnabled` system setting is false, the null-returning
 * variants return null immediately. batchEmbed does not consult the kill-switch —
 * the async pipeline is sweep-driven and is cheaper to disable upstream.
 */

import { getDb } from "../db";
import { getSetting } from "../services/system-settings.service";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-embedding-2-preview";
const BATCH_MAX = 100;
const OUTPUT_DIM = 3072;

/** A part in a Gemini content request — text or inline binary data. */
export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Generate an embedding for a text string.
 * Returns null on any error so search falls back to lexical-only.
 */
export async function embedQuery(
  text: string,
  taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  return embedParts([{ text }], taskType);
}

/**
 * Generate a multimodal embedding from mixed text + image parts.
 * Accepts the same parts format as the Gemini embedContent API.
 * Returns null on any error for graceful fallback.
 */
export async function embedMultimodal(
  parts: ContentPart[],
  taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  return embedParts(parts, taskType);
}

/** Shared implementation for text-only and multimodal embedding calls. */
async function embedParts(
  parts: ContentPart[],
  taskType: string,
): Promise<number[] | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return null; // graceful fallback — no API key means lexical-only search

  // Kill-switch: check system setting
  try {
    const enabled = await getSetting(getDb(), "embeddingsEnabled");
    if (!enabled) {
      console.warn("[gemini] Embeddings disabled via system settings — falling back to lexical");
      return null;
    }
  } catch {
    // If setting check fails, allow embeddings (fail-open for this check only)
  }

  const url = `${GEMINI_API_URL}/${MODEL}:embedContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts },
        taskType,
        outputDimensionality: 3072,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.error(
        `[gemini] Embedding failed: ${response.status} ${await response.text()}`,
      );
      return null; // fallback to lexical
    }

    const data = (await response.json()) as {
      embedding?: { values?: number[] };
    };
    return data.embedding?.values ?? null;
  } catch (err) {
    console.error("[gemini] Embedding request error:", err);
    return null; // fallback to lexical
  }
}

/**
 * Batch-embed up to 100 texts in a single API call. Throws on any error —
 * the async pipeline catches and applies binary-split retry.
 *
 * @param texts up to BATCH_MAX text strings
 * @param taskType Gemini task type (RETRIEVAL_DOCUMENT, SEMANTIC_SIMILARITY, ...)
 * @param modelId model identifier (defaults to gemini-embedding-2-preview)
 */
export async function batchEmbed(
  texts: string[],
  taskType: string,
  modelId: string = MODEL,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > BATCH_MAX) {
    throw new Error(`batchEmbed: max ${BATCH_MAX} texts per call, got ${texts.length}`);
  }

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for batch embedding");

  const modelPath = `models/${modelId}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:batchEmbedContents`;

  const requests = texts.map((text) => ({
    model: modelPath,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: OUTPUT_DIM,
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embedding API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { embeddings: Array<{ values: number[] }> };
  return data.embeddings.map((e) => e.values);
}

/**
 * Generate text from a prompt via the Gemini generateContent endpoint — the
 * server-side LLM call behind the premium `synthesize` feature (the first and
 * only text-generation call in the stack; embeddings above are the rest).
 *
 * Graceful-degradation contract, mirroring embedParts: returns null on any
 * failure (missing key, non-OK response, parse error, timeout) so the caller
 * omits the synthesis rather than failing the check. An LLM hiccup must never
 * break the recipe check it rides along with.
 */
export async function generateText(
  prompt: string,
  model: string,
): Promise<string | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return null; // graceful fallback — no API key means no synthesis

  const url = `${GEMINI_API_URL}/${model}:generateContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.warn(
        `[gemini] generateText failed: ${response.status} ${await response.text()}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.warn("[gemini] generateText request error:", err);
    return null;
  }
}
