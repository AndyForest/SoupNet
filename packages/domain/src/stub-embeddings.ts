/**
 * Deterministic stub embedding function — shared by worker and backend.
 *
 * Returns a 3072-dim, L2-unit-norm vector derived from
 * sha256(text + "\0" + taskType + "\0" + modelId). Properties:
 *
 *   - **Pure & deterministic**: same input → same vector. Stable across runs,
 *     processes, and machines. The `vector_cache` table is content-addressed
 *     (content_hash, model_id, task_type), so this function being a function
 *     of those same inputs means the cache key matches naturally.
 *   - **Distinguishable**: different inputs produce different vectors, so
 *     pgvector HNSW search and clustering still differentiate rows.
 *   - **Same shape as Gemini**: 3072 floats, suitable for `halfvec(3072)`.
 *   - **Zero I/O**: lives in @soupnet/domain (no I/O package) by design.
 *
 * Used by:
 *   - `apps/backend/src/lib/embeddings/provider.ts` — routes to stub or real Gemini
 *     based on EMBEDDINGS_PROVIDER. Both the sync check-time path and the
 *     async pipeline in `apps/backend/src/embedding-worker/` share this module
 *     (see ADR-0020).
 *
 * For tests that need to verify the cache hit path explicitly, see
 * `apps/backend/src/services/vector-search.test.ts` — it seeds known vectors
 * into vector_cache and asserts that the resulting embedding row matches the
 * seeded vector verbatim (not the stub vector that would otherwise be
 * computed for the same text).
 */

import { createHash } from "node:crypto";

export const STUB_VECTOR_DIMENSIONALITY = 3072;

/**
 * Mulberry32 — small, fast, deterministic 32-bit PRNG. Uniform output in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic 3072-dim unit-norm vector for the given inputs.
 * Pure function — no I/O, no randomness, no time dependence.
 */
export function stubEmbeddingVector(
  text: string,
  taskType: string,
  modelId: string,
): number[] {
  const hash = createHash("sha256")
    .update(text)
    .update("\u0000")
    .update(taskType)
    .update("\u0000")
    .update(modelId)
    .digest();

  const seed = hash.readUInt32BE(0);
  const rand = mulberry32(seed);

  const vec = new Array<number>(STUB_VECTOR_DIMENSIONALITY);
  let sumSq = 0;
  for (let i = 0; i < STUB_VECTOR_DIMENSIONALITY; i++) {
    const v = rand() * 2 - 1; // [-1, 1)
    vec[i] = v;
    sumSq += v * v;
  }

  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < STUB_VECTOR_DIMENSIONALITY; i++) {
      vec[i]! /= norm;
    }
  }
  return vec;
}
