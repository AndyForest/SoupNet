/**
 * K-Means clustering for search result summarization.
 *
 * Groups N search results into k clusters using their vector embeddings.
 * Uses computed centroids (arithmetic mean) for precise cluster centers,
 * then finds the nearest real data point to each centroid for display.
 *
 * Pure function — no I/O, no database access.
 *
 * Docs to update when changing this file:
 *   - docs/architecture/search-algorithms.md (Clustering section + Implementation)
 *   - docs/architecture/research-foundations.md (§2 K-Means Clustering)
 *
 * Algorithm: K-Means with K-Means++ initialization (spread sampling)
 * for deterministic, well-separated initial centroids.
 *
 * Research basis: K-Means centroids better capture the geometric center
 * of a topic cluster than K-Medoids (which constrains centroids to actual
 * data points). Three traces "dancing around" a concept benefit from a
 * computed centroid that triangulates the topic. The nearest-exemplar step
 * provides a displayable representative.
 * See: Manning et al. "Introduction to Information Retrieval" ch. 16
 * See: docs/architecture/embedding-test-results.md for verification plan
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClusterResult {
  /** Index of the nearest real data point to the cluster centroid */
  exemplarIndex: number;
  /** Number of results in this cluster */
  memberCount: number;
  /** Average cosine similarity within cluster (0-1), measured to centroid */
  avgSimilarity: number;
  /** The computed centroid vector (useful for sub-clustering queries) */
  centroid: number[];
}

export interface ClusterParams {
  vectors: number[][]; // N vectors, each float array
  k?: number | undefined; // explicit cluster count
  maxChars?: number | undefined; // auto-k from character budget
  resultTexts?: string[] | undefined; // for auto-k estimation
}

// Backward compatibility alias
export type { ClusterResult as ClusterResultLegacy };

// ── Cosine distance ──────────────────────────────────────────────────────────

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  const sim = dot / denom;
  return 1 - sim; // 0 = identical, 1 = orthogonal, 2 = opposite
}

// ── Auto-k estimation ────────────────────────────────────────────────────────

const EVIDENCE_OVERHEAD_MULTIPLIER = 3.5;

function estimateK(
  n: number,
  maxChars: number,
  resultTexts: string[],
): number {
  if (resultTexts.length === 0) return Math.min(n, 3);
  const totalChars = resultTexts.reduce((sum, t) => sum + t.length, 0);
  const avgChars = totalChars / resultTexts.length;
  if (avgChars === 0) return Math.min(n, 3);
  const effectiveCharsPerResult = avgChars * EVIDENCE_OVERHEAD_MULTIPLIER;
  const k = Math.floor(maxChars / effectiveCharsPerResult);
  return Math.max(2, Math.min(n, k));
}

// ── K-Means++ initialization ────────────────────────────────────────────────

/** Initialize centroids using spread sampling (deterministic K-Means++ variant). */
function initCentroids(vectors: number[][], k: number): number[][] {
  const n = vectors.length;
  const dims = vectors[0]!.length;
  const centroids: number[][] = [vectors[0]!.slice()]; // copy first point

  while (centroids.length < k) {
    let bestIdx = -1;
    let bestDist = -1;

    for (let i = 0; i < n; i++) {
      // Find minimum distance from this point to any existing centroid
      let minDist = Infinity;
      for (const c of centroids) {
        const d = cosineDistance(vectors[i]!, c);
        if (d < minDist) minDist = d;
      }
      // Pick the point farthest from all existing centroids
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    centroids.push(vectors[bestIdx]!.slice());
  }

  // Pad with zero vectors if needed (shouldn't happen in practice)
  while (centroids.length < k) {
    centroids.push(new Array(dims).fill(0) as number[]);
  }

  return centroids;
}

// ── Vector arithmetic ───────────────────────────────────────────────────────

function computeCentroid(vectors: number[][], memberIndices: number[]): number[] {
  if (memberIndices.length === 0) return [];
  const dims = vectors[0]!.length;
  const sum = new Array(dims).fill(0) as number[];
  for (const idx of memberIndices) {
    const v = vectors[idx]!;
    for (let d = 0; d < dims; d++) {
      sum[d]! += v[d]!;
    }
  }
  const count = memberIndices.length;
  return sum.map((s) => s / count);
}

function findNearestExemplar(centroid: number[], vectors: number[][], memberIndices: number[]): number {
  let bestIdx = memberIndices[0]!;
  let bestDist = Infinity;
  for (const idx of memberIndices) {
    const d = cosineDistance(centroid, vectors[idx]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

// ── Main clustering function ─────────────────────────────────────────────────

const MAX_ITERATIONS = 20;

export function clusterResults(params: ClusterParams): ClusterResult[] {
  const { vectors } = params;
  const n = vectors.length;

  if (n === 0) return [];

  // Determine k
  let k: number;
  // eslint-disable-next-line eqeqeq -- loose equality: checks both null and undefined
  if (params.k != null) {
    k = params.k;
  // eslint-disable-next-line eqeqeq
  } else if (params.maxChars != null && params.resultTexts) {
    k = estimateK(n, params.maxChars, params.resultTexts);
  } else {
    k = Math.min(n, 3);
  }

  k = Math.max(1, Math.min(n, k));

  // Edge case: one cluster per point
  if (k >= n) {
    return vectors
      .map((v, i) => ({
        exemplarIndex: i,
        memberCount: 1,
        avgSimilarity: 1,
        centroid: v.slice(),
      }))
      .sort((a, b) => b.memberCount - a.memberCount || a.exemplarIndex - b.exemplarIndex);
  }

  // Initialize centroids via spread sampling (K-Means++)
  const centroids = initCentroids(vectors, k);

  // K-Means iteration: assign → recompute centroids → check convergence → repeat
  let assignments = new Array(n).fill(-1) as number[]; // -1 forces first iteration to run

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = new Array(n).fill(0) as number[];
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let bestDist = cosineDistance(vectors[i]!, centroids[0]!);
      for (let c = 1; c < k; c++) {
        const d = cosineDistance(vectors[i]!, centroids[c]!);
        if (d < bestDist) {
          bestDist = d;
          bestCluster = c;
        }
      }
      newAssignments[i] = bestCluster;
    }

    // Check convergence (assignments unchanged from previous iteration)
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (newAssignments[i] !== assignments[i]) {
        changed = true;
        break;
      }
    }
    assignments = newAssignments;

    // Recompute centroids as mean of members (always, even on first iteration)
    for (let c = 0; c < k; c++) {
      const members: number[] = [];
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) members.push(i);
      }
      if (members.length > 0) {
        const newCentroid = computeCentroid(vectors, members);
        for (let d = 0; d < newCentroid.length; d++) {
          centroids[c]![d] = newCentroid[d]!;
        }
      }
    }

    // If assignments didn't change, centroids are stable — converged
    if (!changed) break;
  }

  // Build results: find nearest exemplar to each centroid
  const results: ClusterResult[] = [];
  for (let c = 0; c < k; c++) {
    const members: number[] = [];
    for (let i = 0; i < n; i++) {
      if (assignments[i] === c) members.push(i);
    }
    if (members.length === 0) continue; // empty cluster (rare)

    const centroid = centroids[c]!;
    const exemplarIndex = findNearestExemplar(centroid, vectors, members);

    // Average similarity to centroid
    let totalSim = 0;
    for (const m of members) {
      totalSim += 1 - cosineDistance(vectors[m]!, centroid);
    }

    results.push({
      exemplarIndex,
      memberCount: members.length,
      avgSimilarity: totalSim / members.length,
      centroid: centroid.slice(),
    });
  }

  // Sort by memberCount descending
  results.sort((a, b) => b.memberCount - a.memberCount || a.exemplarIndex - b.exemplarIndex);

  return results;
}
