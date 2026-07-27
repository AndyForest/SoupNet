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

import { maximalMarginalRelevance, VERBOSITY_EXEMPLAR_K } from "@soupnet/domain";
import type { VerbositySteer } from "@soupnet/domain";

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
  k?: number | undefined; // explicit cluster count (legacy `clusters` — exact control)
  /** Verbosity steer (2026-07-26 lever): level → k via VERBOSITY_EXEMPLAR_K;
   *  the internal "auto" sentinel (no caller steer) takes the automatic path
   *  governed by `autoK`. */
  verbosity?: VerbositySteer | undefined;
  maxChars?: number | undefined; // legacy auto-k from character budget
  resultTexts?: string[] | undefined; // for legacy maxChars estimation
  /** Automatic-k realization when no size steer is given (ranking-config
   *  lever): "adaptive" resolves k from the similarity curve when
   *  similarities are available; "fixed"/absent keeps the k=3 default. */
  autoK?: "fixed" | "adaptive" | undefined;
  /** Per-vector cosine similarity to the query, parallel to `vectors` —
   *  the adaptive-k signal. mmrClusters computes these itself; k-means
   *  callers may supply them when available. */
  similarities?: number[] | undefined;
}

export interface MmrClusterParams extends ClusterParams {
  /** Query embedding — MMR selects representatives most relevant to this. */
  queryVector: number[];
  /** Relevance↔diversity trade-off in [0,1] (1 = pure relevance). */
  lambda: number;
  /** λ realization (ranking-config lever): "variance" adapts λ per query from
   *  the pool's similarity dispersion; "fixed"/absent uses `lambda` as-is. */
  lambdaMode?: "fixed" | "variance" | undefined;
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

// ── Adaptive k (automatic verbosity) ─────────────────────────────────────────

export interface AdaptiveKOptions {
  /** Smallest k the automatic mode returns (when n allows). Default 2. */
  minK?: number;
  /** Largest k the automatic mode returns. Default 10 — the `verbosity=high`
   *  steer, so automatic never exceeds what an explicit caller can ask for. */
  maxK?: number;
  /** Fixed buffer added past the detected cut — the Adaptive-k paper's hedge
   *  against cutting one item too early (B=5 at passage scale; 1 at ours). */
  buffer?: number;
}

/**
 * Adaptive result-count selection from the query-similarity curve — the
 * "automatic" realization of the verbosity lever (ranking-config `autoK`).
 *
 * Largest-gap rule: sort similarities descending and cut where the drop
 * between neighbors is largest — Weaviate's production `autocut` ("looks for
 * discontinuities, or jumps, in result metrics") and Adaptive-k (EMNLP 2025:
 * "choose the index k where the similarity drop is the largest"), searched
 * only over cut positions the clamp allows. When no meaningful gap exists
 * (dense-retrieval curves are steep–flat–steep and can be smooth through the
 * clamp window), fall back to the knee: the point of maximum distance below
 * the chord from first to last score in the window — the curvature intuition
 * of Kneedle (Satopää et al. 2011) in discrete form.
 *
 * Pure; lineage + measurement plan: docs/planning/response-verbosity-lever.md.
 */
export function adaptiveK(similarities: number[], options?: AdaptiveKOptions): number {
  const n = similarities.length;
  const minK = Math.max(1, options?.minK ?? 2);
  const maxK = Math.max(minK, options?.maxK ?? 10);
  const buffer = options?.buffer ?? 1;
  if (n <= minK) return n;

  const sims = [...similarities].sort((a, b) => b - a);
  // Cut positions: keep i items, i in [minK, hi]. hi stays one short of n so
  // a gap is always measured between a kept item and a dropped one.
  const hi = Math.min(maxK, n - 1);

  let bestGap = 0;
  let gapCut = 0;
  for (let i = minK; i <= hi; i++) {
    const gap = sims[i - 1]! - sims[i]!;
    if (gap > bestGap) {
      bestGap = gap;
      gapCut = i;
    }
  }

  // Gap significance: a "jump" must stand out from the window's total drop,
  // or every quasi-linear curve would produce an arbitrary cut. Threshold =
  // 2× the window's average per-step drop; below it, use the knee fallback.
  const windowDrop = sims[minK - 1]! - sims[hi]!;
  const avgStep = windowDrop / Math.max(1, hi - minK + 1);
  let cut: number;
  if (bestGap > 2 * avgStep && bestGap > 0) {
    // Buffer hedges the gap cut only (the "one item too early" risk the
    // Adaptive-k paper names); knee/default fallbacks are not inflated.
    cut = gapCut + buffer;
  } else {
    // Knee: max vertical distance below the chord over the clamp window.
    const x0 = minK - 1;
    const x1 = hi;
    const y0 = sims[x0]!;
    const y1 = sims[x1]!;
    const span = x1 - x0;
    let bestDist = -Infinity;
    let knee = Math.min(n, 3); // degenerate (flat/linear) curve → pre-lever default
    for (let i = x0 + 1; i < x1; i++) {
      const chordY = y0 + ((y1 - y0) * (i - x0)) / span;
      const dist = chordY - sims[i]!;
      if (dist > bestDist + 1e-12) {
        bestDist = dist;
        knee = i + 1; // keep items up to and including the knee point
      }
    }
    cut = bestDist > 1e-9 ? knee : Math.min(n, 3);
  }

  return Math.max(minK, Math.min(maxK, Math.min(n, cut)));
}

// ── Adaptive λ (variance mode) ───────────────────────────────────────────────

/**
 * Variance-keyed MMR λ (ranking-config `displaySelection.lambdaMode:
 * "variance"`, plumbed off-by-default): higher similarity dispersion in the
 * pool → lower effective λ (more diversification) — the mean-variance risk
 * logic of Wang & Zhu (SIGIR 2009) with Santos et al. (CIKM 2010) as the
 * per-query selective-diversification precedent. Linear map between anchor
 * spreads, clamped to Carbonell & Goldstein's own working range
 * (λ .3 explore ↔ .7 focus, stretched to .8 for near-duplicate heads).
 * Anchors are sweep hypotheses, not rulings.
 */
export function varianceLambda(similarities: number[], baseLambda: number): number {
  const n = similarities.length;
  if (n < 3) return baseLambda;
  const mean = similarities.reduce((s, v) => s + v, 0) / n;
  const variance = similarities.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  const spread = Math.sqrt(variance);
  const TIGHT = 0.02; // spread ≤ TIGHT → focus (λ 0.8)
  const WIDE = 0.10; // spread ≥ WIDE → diversify (λ 0.3)
  if (spread <= TIGHT) return 0.8;
  if (spread >= WIDE) return 0.3;
  const t = (spread - TIGHT) / (WIDE - TIGHT);
  return 0.8 + t * (0.3 - 0.8);
}

/**
 * Resolve the cluster-count budget from the caller's size steer, clamped to
 * [1, n]. Shared by k-means and MMR display selection so any size steer means
 * the same number of representatives under either mechanism. Precedence:
 * explicit k (legacy `clusters` — exact control for harnesses/sweeps) >
 * verbosity level > legacy `max_chars` estimate > automatic (adaptive when
 * the lever + similarity signal allow, else the fixed k=3 default).
 */
function resolveK(params: ClusterParams, n: number): number {
  let k: number;
  // eslint-disable-next-line eqeqeq -- loose equality: checks both null and undefined
  if (params.k != null) {
    k = params.k;
  // eslint-disable-next-line eqeqeq
  } else if (params.verbosity != null && params.verbosity !== "auto") {
    k = VERBOSITY_EXEMPLAR_K[params.verbosity];
  // eslint-disable-next-line eqeqeq
  } else if (params.maxChars != null && params.resultTexts) {
    k = estimateK(n, params.maxChars, params.resultTexts);
  } else if (
    params.autoK === "adaptive" &&
    params.similarities &&
    params.similarities.length === n
  ) {
    k = adaptiveK(params.similarities);
  } else {
    k = Math.min(n, 3);
  }
  return Math.max(1, Math.min(n, k));
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

  const k = resolveK(params, n);

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

// ── MMR display selection ─────────────────────────────────────────────────────

/**
 * Maximal Marginal Relevance display selection — an alternative to k-means that
 * returns the SAME ClusterResult[] shape, so the pipeline's exemplar mapping,
 * known-set stubbing, and results↔clusters index-parallel contract are
 * single-sourced across both display modes (the reuse-over-fork ruling, recipe
 * 257950f3). The k representatives are chosen by MMR (Carbonell & Goldstein
 * 1998; the vendored @soupnet/domain `maximalMarginalRelevance`) over the pool
 * against the query, then every pool member is assigned to its nearest
 * representative by cosine — each returned cluster's "centroid" IS its
 * representative vector, so the pipeline's nearest-centroid member assignment
 * reproduces this partition exactly.
 *
 * Clusters are returned in MMR PICK ORDER (relevance, then diversity), which is
 * itself the display order — so the pipeline skips the P7 clusterOrdering
 * permutation for this mode (hypothesis P8: MMR replaces clustering + ordering
 * with one standard mechanism). k is resolved exactly as clusterResults
 * resolves it (shared resolveK), so a caller's budget means the same thing
 * under either mechanism.
 */
export function mmrClusters(params: MmrClusterParams): ClusterResult[] {
  const { vectors, queryVector, lambda } = params;
  const n = vectors.length;
  if (n === 0) return [];

  // Query-similarity curve — computed here (not threaded from the pipeline)
  // because the query vector is already in hand. Feeds adaptive k and the
  // variance-λ mode; skipped entirely when neither lever needs it.
  const onAutomaticPath =
    params.k === undefined &&
    params.maxChars === undefined &&
    (params.verbosity === undefined || params.verbosity === "auto");
  const wantsCurve =
    (params.autoK === "adaptive" && onAutomaticPath) || params.lambdaMode === "variance";
  // Pool vector FIRST: its (possibly MRL-truncated) length bounds the cosine
  // loop, implicitly truncating the full-dim query embedding — the same
  // convention the pipeline and the briefing purpose pass rely on.
  const similarities = wantsCurve
    ? vectors.map((v) => 1 - cosineDistance(v, queryVector))
    : params.similarities;

  const k = resolveK({ ...params, similarities }, n);
  const effectiveLambda =
    params.lambdaMode === "variance" && similarities
      ? varianceLambda(similarities, lambda)
      : lambda;
  const selected = maximalMarginalRelevance(queryVector, vectors, effectiveLambda, k);

  // Assign every vector to its nearest selected representative (cosine). A
  // representative is at distance 0 from itself, so it always anchors its own
  // cluster. Tie-break on the lowest representative index — identical to the
  // pipeline's assignToClusters, so memberCount here equals the memberIndices
  // count computed downstream.
  const memberIndicesByRep: number[][] = selected.map(() => []);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestDist = cosineDistance(vectors[i]!, vectors[selected[0]!]!);
    for (let c = 1; c < selected.length; c++) {
      const d = cosineDistance(vectors[i]!, vectors[selected[c]!]!);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    memberIndicesByRep[best]!.push(i);
  }

  return selected.map((repIdx, c) => {
    const members = memberIndicesByRep[c]!;
    let totalSim = 0;
    for (const m of members) totalSim += 1 - cosineDistance(vectors[m]!, vectors[repIdx]!);
    return {
      exemplarIndex: repIdx,
      memberCount: members.length,
      avgSimilarity: members.length > 0 ? totalSim / members.length : 1,
      centroid: vectors[repIdx]!.slice(),
    };
  });
}
