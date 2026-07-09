/**
 * Local embedding client — in-process CPU inference via @huggingface/transformers
 * (ONNX). Single source of truth for the `local` provider's model calls.
 *
 * Exposes the same trio as gemini-client.ts, with the same contract so the
 * provider seam can dispatch to either uniformly:
 *   - embedQuery(text, taskType?)          — single text, returns null on error
 *   - embedMultimodal(parts, taskType?)    — text + inline parts, returns null on error
 *   - batchEmbed(texts, taskType, modelId) — batch, THROWS on error (retry policy)
 * plus:
 *   - warmup()                             — load the model at boot (off the first request)
 *
 * The null-returning variants let the sync check path degrade to lexical search;
 * batchEmbed throws so the async pipeline's binary-split retry can surface failures
 * — identical to gemini-client's split contract.
 *
 * Dimension policy: this client returns NATIVE-dimension vectors (bge-small → 384).
 * It does NOT fit to halfvec(3072). Fitting lives once, at the provider seam
 * (provider.ts `.map(fitTo3072)`), per "one behavior, one place" (trace 18912fbd)
 * and the zero-pad-at-seam decision (trace e1bd9b8e). Duplicating the fit here
 * would be exactly the drift those recipes warn against.
 *
 * Loaded via DYNAMIC import() only — so gemini/stub deployments never pull in the
 * ~100-300 MB native ONNX runtime, and `npm ci` doesn't break where the optional
 * native addon is unavailable (@huggingface/transformers is an optionalDependency).
 */

const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";
// TODO(verify at deploy): confirm the exact ONNX repo id. `Xenova/*` are the classic
// transformers.js community exports; under transformers.js v3 the canonical export may
// be `onnx-community/bge-small-en-v1.5`. all-MiniLM-L6-v2 is the proven fallback — a
// one-line EMBEDDINGS_MODEL swap (both 384-dim, both text-only).

/**
 * Per-model SYMMETRIC prefix table, keyed by resolved model id.
 *
 * The stack is symmetric: stored trace text and query recipe text both go through
 * embedQuery, and only the SEMANTIC_SIMILARITY task type is generated (see enqueue.ts).
 * So any prefix must be applied identically to both sides — never asymmetric
 * query/passage prefixes. bge-small-en-v1.5 needs NO prefix. Default: no prefix.
 *
 * Example for a model that wants a symmetric prefix:
 *   "intfloat/multilingual-e5-small": "query: ",
 */
const SYMMETRIC_PREFIXES: Record<string, string> = {};

/**
 * Resolved HF repo id for the local model (env override, else the built-in default).
 * Exported and used by the provider seam (getEmbeddingModelId) too, so the id that's
 * embedded and the id that's stamped into model_id are resolved in ONE place — never
 * a second copy of the default that could drift (trace 18912fbd).
 */
export function localModelRepoId(): string {
  return process.env["EMBEDDINGS_MODEL"] ?? DEFAULT_MODEL;
}

function symmetricPrefix(): string {
  return SYMMETRIC_PREFIXES[localModelRepoId()] ?? "";
}

// --- Minimal structural types for the dynamically-imported module ------------
// @huggingface/transformers is optional and may resolve to an ambient `any` when
// the package isn't installed; casting the dynamic import through `unknown` to
// these shapes keeps the rest of this file type-checked without an explicit any.

interface EmbeddingTensor {
  /** For array input + mean pooling: dims [n, hidden] → number[][]. */
  tolist(): number[][];
}

type FeatureExtractionPipeline = (
  input: string | string[],
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<EmbeddingTensor>;

interface TransformersEnv {
  backends?: { onnx?: { wasm?: { numThreads?: number } } };
}

interface TransformersModule {
  pipeline: (
    task: "feature-extraction",
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<FeatureExtractionPipeline>;
  env?: TransformersEnv;
}

/**
 * Cap ONNX-runtime CPU threads. This process also runs the in-process pg-boss
 * embedding consumers (ADR-0020), so letting ORT spin up one intra-op thread per
 * core would oversubscribe the box against WORKER_CONCURRENCY parallel jobs.
 * ORT_NUM_THREADS lets the operator tune it; default 1 (CPU inference on the small
 * corpora these personas have is fast enough single-threaded, and 1 thread leaves
 * cores for the worker). OMP_NUM_THREADS is the durable knob honored by the native
 * (glibc) onnxruntime-node backend; the transformers.js env is a best-effort mirror.
 */
function capThreads(mod: TransformersModule): void {
  const parsed = Number.parseInt(process.env["ORT_NUM_THREADS"] ?? "1", 10);
  const threads = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  if (!process.env["OMP_NUM_THREADS"]) {
    process.env["OMP_NUM_THREADS"] = String(threads);
  }
  const wasm = mod.env?.backends?.onnx?.wasm;
  if (wasm) wasm.numThreads = threads;
}

// --- Lazy singleton pipeline -------------------------------------------------

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function loadPipeline(): Promise<FeatureExtractionPipeline> {
  const mod = (await import("@huggingface/transformers")) as unknown as TransformersModule;
  capThreads(mod);
  // pooling:'mean' + normalize:true are applied at inference time (below), which is
  // where transformers.js v3 takes them — the pipeline() constructor's third arg is
  // model-load options (dtype/device/cache), not feature-extraction options.
  return mod.pipeline("feature-extraction", localModelRepoId());
}

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline().catch((err: unknown) => {
      pipelinePromise = null; // allow a later call to retry a transient load failure
      throw err;
    });
  }
  return pipelinePromise;
}

/**
 * Core embed: runs the pipeline over `texts` and returns one native-dim, unit-norm
 * vector per input. Throws on load/inference failure or a row-count mismatch — the
 * public functions decide whether to swallow (null) or propagate (throw).
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const prefix = symmetricPrefix();
  const inputs = prefix ? texts.map((t) => prefix + t) : texts;
  const output = await extractor(inputs, { pooling: "mean", normalize: true });
  const rows = output.tolist();
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new Error(
      `[local-embed] expected ${texts.length} vectors, got ${Array.isArray(rows) ? rows.length : typeof rows}`,
    );
  }
  return rows;
}

/**
 * Fold multimodal parts into a single text string — identical to the stub provider.
 * Local models are text-only; image parts contribute a stable text placeholder so
 * cache keys stay distinct (image bytes are already folded into chunk_hash upstream).
 */
function foldPartsToText(parts: ContentPart[]): string {
  return parts
    .map((p) =>
      "text" in p ? p.text : `[inline:${p.inlineData.mimeType}:${p.inlineData.data.length}b]`,
    )
    .join("\n");
}

/** A part in a content request — text or inline binary data. Mirrors gemini-client. */
export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Embed a single text. Returns null on any failure for graceful lexical fallback.
 * `_taskType` is accepted for signature parity with gemini-client; the local stack
 * is symmetric and does not vary embeddings by task type.
 */
export async function embedQuery(
  text: string,
  _taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  try {
    const rows = await embedTexts([text]);
    return rows[0] ?? null;
  } catch (err) {
    console.error("[local-embed] embedQuery failed — falling back to lexical:", err);
    return null;
  }
}

/**
 * Embed multimodal content parts. Folds parts to text exactly like the stub, then
 * embeds. Returns null on failure. `_taskType` accepted for parity (see embedQuery).
 */
export async function embedMultimodal(
  parts: ContentPart[],
  _taskType: string = "SEMANTIC_SIMILARITY",
): Promise<number[] | null> {
  try {
    const rows = await embedTexts([foldPartsToText(parts)]);
    return rows[0] ?? null;
  } catch (err) {
    console.error("[local-embed] embedMultimodal failed — falling back to lexical:", err);
    return null;
  }
}

/**
 * Batch-embed texts. THROWS on failure so the async pipeline's binary-split retry
 * surfaces errors (matches gemini-client's batch contract).
 *
 * `_taskType` and `_modelId` are accepted for signature parity with gemini-client
 * but not used: the local model is symmetric (task-type-invariant) and is selected
 * process-wide by EMBEDDINGS_MODEL — the incoming modelId (e.g. `local:bge-small…`)
 * is a cache-key id, not a loadable HF repo id.
 */
export async function batchEmbed(
  texts: string[],
  _taskType: string,
  _modelId: string,
): Promise<number[][]> {
  return embedTexts(texts);
}

/**
 * Warm the model at boot so the ~0.5-2 s ONNX model-load happens off the first real
 * request. Never throws — a warmup failure is logged and the first real embedQuery
 * retries (and degrades to lexical if the model genuinely can't load), so a boot-time
 * hiccup doesn't crash the server.
 */
export async function warmup(): Promise<void> {
  try {
    await embedTexts(["warmup"]);
  } catch (err) {
    console.warn("[local-embed] warmup failed (first embed will retry):", err);
  }
}
