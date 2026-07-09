/**
 * Dimension-fit helper — map any embedding into the searchable `halfvec(3072)`
 * space without a schema migration (see docs/planning/local-embedding-provider.md,
 * "The zero-migration insight", and recipe trace e1bd9b8e).
 *
 * The searchable column is `halfvec(3072)` with a single `halfvec_cosine_ops`
 * HNSW index. Rather than making the column dimension configurable, every
 * provider's output is fit into 3072 dims here:
 *
 *   d < 3072 → append zeros. Zero-padding is an isometric embedding: for
 *     a' = [a, 0…0] and b' = [b, 0…0] the dot product and both norms are
 *     unchanged, so cosine, L2, and inner product are all EXACTLY equal to
 *     their d-dim values (0.0 is exact in fp16, so halfvec quantization adds no
 *     error). The HNSW graph is structurally identical to one built in ℝ^d.
 *   d > 3072 → slice to the leading 3072 dims, then L2-renormalize. This is
 *     Matryoshka/MRL truncation; only 4096-class models (e.g. Qwen3-8B) hit it.
 *   d === 3072 → return as-is.
 *
 * Pure, no I/O. Applied centrally at the provider seam so the behavior lives in
 * one place (per recipe trace 18912fbd) — clients return native-dim vectors.
 */

export const EMBEDDING_DIM = 3072;

export function fitTo3072(v: number[]): number[] {
  const d = v.length;

  if (d === EMBEDDING_DIM) {
    return v;
  }

  if (d < EMBEDDING_DIM) {
    // Append (3072 - d) zeros. Norm and cosine are preserved exactly.
    const out = new Array<number>(EMBEDDING_DIM).fill(0);
    for (let i = 0; i < d; i++) {
      out[i] = v[i]!;
    }
    return out;
  }

  // d > 3072: truncate to the leading dims, then L2-renormalize (MRL).
  const head = v.slice(0, EMBEDDING_DIM);
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    sumSq += head[i]! * head[i]!;
  }
  const magnitude = Math.sqrt(sumSq);
  if (magnitude === 0) {
    // Degenerate: the leading 3072 dims are all zero. Nothing to normalize.
    return head;
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    head[i] = head[i]! / magnitude;
  }
  return head;
}
