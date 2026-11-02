/**
 * Gemini embedding client — single source of truth for Gemini HTTP calls.
 *
 * Exposes:
 *   - embedQuery(text, modelId) — single text, returns null on error
 *   - embedMultimodal(parts, modelId) — text + inline image parts, returns null on error
 *   - embedPartsStrict(parts, modelId) — the same call, throws on error
 *   - batchEmbed(texts, modelId) — batch endpoint for async pipeline, throws on error
 *
 * The model is always the caller's: it resolves in lib/embeddings/provider.ts and
 * nowhere else, so the id on the wire and the id on the row can't disagree
 * (ADR-0024). No taskType goes on the wire: the preview model ignores it and the GA
 * model's documentation says it isn't supported. The task_type column stays a
 * cache-key label.
 *
 * The sync check path (enqueue.ts) uses the null-returning variants so a check
 * still succeeds when embedding fails: its vector stays 'pending' for the worker
 * and search returns no results, because there is no lexical path to fall back
 * to. The async pipeline (embedding-worker/jobs/vector-api-call.ts)
 * uses the throwing variants because it explicitly wants failures surfaced for its
 * retry policy.
 *
 * Kill-switch: if `embeddingsEnabled` system setting is false, the null-returning
 * variants return null immediately. batchEmbed does not consult the kill-switch —
 * the async pipeline is sweep-driven and is cheaper to disable upstream.
 */

import { getDb } from "../db";
import { getSetting } from "../services/system-settings.service";
import { EmbeddingHttpError, parseRetryAfterMs } from "./embeddings/errors";
import { recordProviderPushback } from "./embeddings/provider-cooldown";

/** Overridable so tests can point the real client at a local fake; unset in production. */
const GEMINI_API_URL =
  process.env["GEMINI_API_BASE_URL"] || "https://generativelanguage.googleapis.com/v1beta/models";
const BATCH_MAX = 100;
const OUTPUT_DIM = 3072;

/** A part in a Gemini content request — text or inline binary data. */
export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Generate an embedding for a text string.
 * Returns null on any error; search then returns no results for this query.
 */
export async function embedQuery(text: string, modelId: string): Promise<number[] | null> {
  return embedParts([{ text }], modelId);
}

/**
 * Generate a multimodal embedding from mixed text + image parts.
 * Accepts the same parts format as the Gemini embedContent API.
 * Returns null on any error; see embedQuery.
 */
export async function embedMultimodal(
  parts: ContentPart[],
  modelId: string,
): Promise<number[] | null> {
  return embedParts(parts, modelId);
}

/** Shared implementation for text-only and multimodal embedding calls. */
async function embedParts(parts: ContentPart[], modelId: string): Promise<number[] | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return null; // no API key means no vector, so search returns no results

  // Kill-switch: check system setting
  try {
    const enabled = await getSetting(getDb(), "embeddingsEnabled");
    if (!enabled) {
      console.warn("[gemini] Embeddings disabled via system settings — search returns no results");
      return null;
    }
  } catch {
    // If setting check fails, allow embeddings (fail-open for this check only)
  }

  try {
    return await embedPartsStrict(parts, modelId);
  } catch (err) {
    if (err instanceof EmbeddingHttpError) {
      console.error(`[gemini] Embedding failed: ${err.status} ${err.body}`);
      if (err.status === 429) {
        // A live check hit the limit: pause background embedding so it gets the quota.
        void recordProviderPushback(getDb(), modelId, err.retryAfterMs).catch(() => {});
      }
    } else {
      console.error("[gemini] Embedding request error:", err);
    }
    return null;
  }
}

/** One embedContent call. Throws EmbeddingHttpError on a non-OK response. */
export async function embedPartsStrict(parts: ContentPart[], modelId: string): Promise<number[]> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for embedding");

  const response = await fetch(`${GEMINI_API_URL}/${modelId}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: `models/${modelId}`,
      content: { parts },
      outputDimensionality: OUTPUT_DIM,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw await toHttpError(response);

  const data = (await response.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values) throw new Error("Gemini embedding response had no values");
  return values;
}

/**
 * Batch-embed up to 100 texts in a single API call. Throws on any error —
 * the async pipeline catches and classifies it.
 *
 * @param texts up to BATCH_MAX text strings
 * @param modelId model identifier, sent on the wire exactly as given
 */
export async function batchEmbed(texts: string[], modelId: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > BATCH_MAX) {
    throw new Error(`batchEmbed: max ${BATCH_MAX} texts per call, got ${texts.length}`);
  }

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for batch embedding");

  const modelPath = `models/${modelId}`;
  const requests = texts.map((text) => ({
    model: modelPath,
    content: { parts: [{ text }] },
    outputDimensionality: OUTPUT_DIM,
  }));

  const response = await fetch(`${GEMINI_API_URL}/${modelId}:batchEmbedContents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw await toHttpError(response);

  const data = (await response.json()) as { embeddings: Array<{ values: number[] }> };
  return data.embeddings.map((e) => e.values);
}

async function toHttpError(response: Response): Promise<EmbeddingHttpError> {
  const body = await response.text();
  return new EmbeddingHttpError(
    "Gemini",
    response.status,
    body,
    parseRetryAfterMs(response.headers.get("retry-after"), body),
  );
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
