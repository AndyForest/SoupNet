/**
 * Maximal Marginal Relevance (MMR) — the standard diversity-selection
 * mechanism for retrieval display: pick items that are "closest but still
 * relatively unique" so a result list isn't dominated by near-duplicates of its
 * top hit. Pure function, no I/O (packages/domain rule).
 *
 * Formula (Carbonell & Goldstein 1998, "The Use of MMR, Diversity-Based
 * Reranking for Reordering Documents and Producing Summaries", SIGIR):
 *
 *     MMR = argmax_{c ∈ R\S} [ λ·Sim1(c, q) − (1−λ)·max_{s ∈ S} Sim2(c, s) ]
 *
 * where q is the query, S the already-selected set, R the candidate set, and
 * Sim1/Sim2 are cosine similarity. λ=1 degenerates to pure relevance ordering;
 * λ=0 maximizes diversity; the paper's λ≈0.3–0.7 balances the two.
 *
 * Vendored to match the LangChain.js reference `maximalMarginalRelevance`
 * (@langchain/core/utils/math) for parity: the first pick is seeded as the
 * highest-query-similarity candidate (so the choice is well-defined even at
 * λ=0), then each subsequent pick maximizes the marginal score above. Returning
 * indices in pick order lets the caller keep any parallel per-candidate data.
 *
 * In the ranking engine this is the "mmr" display-selection mode
 * (ranking-config.ts `displaySelection`), a prototype behind the lever seam
 * against k-means clustering (hypothesis P8, docs/architecture/ranking-engine.md).
 */

/**
 * Cosine similarity between two vectors (1 = identical direction, 0 =
 * orthogonal). Iterates over the shorter length, so passing an MRL-truncated
 * vector as one argument implicitly truncates the other to the same leading
 * prefix — valid for the Matryoshka-trained gemini embeddings this engine uses
 * (same rationale as MAP_VECTOR_DIMS in search-pipeline.ts).
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Select up to `k` candidate indices by Maximal Marginal Relevance against
 * `queryVec`. Returns the selected indices IN PICK ORDER (first = most relevant,
 * each next = the best relevance-minus-redundancy trade-off). Pure.
 *
 * @param queryVec       the query embedding.
 * @param candidateVecs  candidate embeddings; the returned indices address this array.
 * @param lambda         relevance↔diversity trade-off in [0,1] (1 = pure relevance).
 * @param k              how many to select; k ≥ candidateVecs.length returns all.
 */
export function maximalMarginalRelevance(
  queryVec: readonly number[],
  candidateVecs: readonly (readonly number[])[],
  lambda: number,
  k: number,
): number[] {
  const n = candidateVecs.length;
  const pick = Math.min(k, n);
  if (pick <= 0) return [];

  const querySim = candidateVecs.map((c) => cosineSimilarity(queryVec, c));

  // First pick: the highest-query-similarity candidate (LangChain seeds the
  // loop this way, so the choice is well-defined even at λ=0 where the marginal
  // score collapses to a constant).
  let firstIdx = 0;
  for (let i = 1; i < n; i++) {
    if (querySim[i]! > querySim[firstIdx]!) firstIdx = i;
  }
  const selected: number[] = [firstIdx];
  const selectedSet = new Set<number>([firstIdx]);

  while (selected.length < pick) {
    let bestScore = -Infinity;
    let bestIdx = -1;
    for (let i = 0; i < n; i++) {
      if (selectedSet.has(i)) continue;
      let maxSimToSelected = -Infinity;
      for (const s of selected) {
        const sim = cosineSimilarity(candidateVecs[i]!, candidateVecs[s]!);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const score = lambda * querySim[i]! - (1 - lambda) * maxSimToSelected;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    selected.push(bestIdx);
    selectedSet.add(bestIdx);
  }

  return selected;
}
