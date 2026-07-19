/**
 * Ranking pipeline configuration — the single config object that flows through
 * the check_recipe ranking pipeline. See docs/planning/session-novelty-and-pool-diversity.md
 * (plan v2) and docs/architecture/ranking-engine.md.
 *
 * The contract (operator rulings 2026-07-17, recipes 9067ca1b / ebdc6ad7):
 *   - Ranking is a PURE FUNCTION of the check's explicit inputs and the
 *     corpus. No hidden identity state reorders or hides results — a recipe
 *     missing from results can only mean "not relevant enough" or "deleted".
 *     This holds for any future reranking layer too.
 *   - Session awareness is RENDERING, not ranking: recipes the session
 *     already knows keep their rank and render as id-stubs; the freed display
 *     budget backfills with the next results in line. Token efficiency only.
 *   - Benchmark run isolation is the benchmark's job, not a ranking concern.
 *
 * Config layering (recipe 8ee8e3ab): versioned code defaults here (a default
 * change bumps RANKING_ALGORITHM_VERSION with a ranking-changelog.md entry in
 * the same commit — defaults never change silently); per-request parameters
 * are explicit check inputs, echoed back in the response.
 *
 * Standing constraint for future levers: any recency/decay lever decays from
 * COALESCE(decided_at, created_at) — backfilled decisions (decision
 * archaeology) age as old judgments, not fresh ones (operator ruling
 * 2026-07-16).
 */

/**
 * Dated ranking-algorithm version identifier. Minted ONLY when a shipped
 * default changes behavior — additive levers defaulting to the previous
 * behavior do not mint. Surfaced in check responses (`data.ranking.version`)
 * and audit metadata. History: docs/architecture/ranking-changelog.md.
 */
export const RANKING_ALGORITHM_VERSION = "2026-07-19";

/**
 * Clustering candidate pool — hypothesis P6 (ranking-engine.md stage 3).
 *
 *   - "page": legacy — the pool is the pagination window (per_page, default
 *     20), an inherited default doing double duty. Comparison arm since the
 *     2026-07-19 flip.
 *   - "fixed": the pool is the top `size` candidates by rank. THE DEFAULT
 *     since 2026-07-19: the real-scale P6 sweep measured coverage gains
 *     saturating at or before pool 60 in both embedding spaces with every
 *     other metric invariant (docs/planning/ranking-research/
 *     p6-pool-sweep-report.md); 100 is the four-source convention and sits
 *     inside the ANN plan. (The 2026-07-17 "fixture-relative" caution applied
 *     to corpora smaller than the pool — real-scale measurement superseded it.)
 *   - "score-gap": the pool extends down the ranking to the largest adjacent
 *     score gap found between `minSize` and `size` candidates — a
 *     relevance-bounded boundary instead of a global cutoff ("a single global
 *     cutoff is inherently brittle" — Tail-Aware Adaptive-k, see
 *     docs/planning/ranking-research/candidate-pool-sizing.md).
 *
 * Pool selection shapes only the clustered summary — no score floor ever
 * hides a result from the flat surface. `size` also bounds implementation
 * cost (the ANN candidate constants are tunables revisited with this lever).
 * vectorDims: MRL truncation for pool clustering vectors (768 = the Recipe
 * Map precedent, 4× cheaper than full 3,072; 0 = full dims).
 */
export interface ClusterPoolConfig {
  mode: "page" | "fixed" | "score-gap";
  /** Fixed-mode pool size, and the score-gap mode's maximum. */
  size: number;
  /** Score-gap mode's minimum pool size (gap search starts here). */
  minSize: number;
  vectorDims: number;
}

/**
 * Cluster display ordering — hypothesis P7 (ranking-engine.md stage 5). Chooses
 * what the caller reads FIRST among the clustered exemplars. Reorders the
 * clustered summary only — never membership, ranking, scores, or the flat
 * surface (same seam discipline as the P6 pool lever). The reorder is a
 * downstream permutation of the parallel cluster arrays AFTER k-means; the
 * clustering primitive stays pure geometry with legacy size ordering (the map
 * and briefing-exemplar surfaces depend on it).
 *
 *   - "member-count": legacy — biggest cluster first (the scatter/gather-era
 *     size ordering). THE DEFAULT (byte-stable): additive lever, ships in the
 *     legacy position, so no version mint (ranking-changelog.md convention).
 *   - "max-similarity": order clusters by their best member's query
 *     similarity — relevance-first cluster ranking, the standard remedy when
 *     size ordering rewards redundancy. The contrarian-miss diagnosis found
 *     member-count "rewards the failure mode": "Echo clusters win member-count
 *     by self-similarity; the metric rewards the failure mode"
 *     (contrarian-miss diagnosis 2026-07-19).
 *   - "evidence-mass": order by the summed evidence-row count of members —
 *     corroboration weight. Evidence count is an explicit corpus property, so
 *     this stays a pure function of the check's inputs and corpus state
 *     (consistent with the pure-function ranking ruling, recipe 9067ca1b).
 */
export type ClusterOrderingMode = "member-count" | "max-similarity" | "evidence-mass";

/**
 * The pipeline config object. Every ranking lever is a named field with a
 * documented default and range; stages read from this object rather than
 * scattered constants, so a new lever is a field + a stage read.
 */
export interface RankingConfig {
  /** Clustering candidate pool (P6). Ships "fixed:100" (2026-07-19 ruling);
   *  "page" (legacy) and "score-gap" stay plumbed as comparison arms. */
  clusterPool: ClusterPoolConfig;
  /** Cluster display ordering (P7). Ships "member-count" (legacy); the
   *  relevance-first and corroboration-weighted arms stay plumbed, awaiting
   *  the sweep → report → ruling path (no default flip yet). */
  clusterOrdering: ClusterOrderingMode;
}

/** Shipped defaults. Flat results, pagination, and displayed scores are
 *  untouched by the pool — it shapes only the clustered summary (P6 sweep:
 *  every flat metric byte-identical, guardrail tau exactly 1.0). Cluster
 *  ordering ships legacy member-count (P7 lever added default-off). */
export const DEFAULT_RANKING: RankingConfig = {
  clusterPool: { mode: "fixed", size: 100, minSize: 20, vectorDims: 768 },
  clusterOrdering: "member-count",
};

/**
 * Per-candidate ranking signals, hydrated on the existing row load and
 * available to every downstream stage (recipe 1121a2a5).
 */
export interface CandidateSignals {
  /** Raw insertion time (display dates coalesce decided_at separately). */
  createdAt: Date;
  /** Judgment date when backfilled (decision archaeology); null otherwise. */
  decidedAt: Date | null;
  /** Session token stamped at deposit (null for pre-session or sessionless
   *  deposits). Drives known-set stub rendering only — never ranking. */
  sessionId: string | null;
}

/**
 * Select the clustering pool boundary from the ranked candidate scores,
 * per the pool config. Pure. Returns the pool length to take from the top of
 * the ranked list (callers slice). "page" returns undefined — no pool.
 */
export function poolBoundary(
  scoresDescending: readonly number[],
  pool: ClusterPoolConfig,
): number | undefined {
  if (pool.mode === "page") return undefined;
  const max = Math.min(pool.size, scoresDescending.length);
  if (pool.mode === "fixed") return max;
  // score-gap: cut at the largest adjacent score drop in [minSize, max].
  const min = Math.min(Math.max(1, pool.minSize), max);
  if (max <= min) return max;
  let cut = max;
  let biggestGap = -Infinity;
  for (let i = min; i < max; i++) {
    const gap = scoresDescending[i - 1]! - scoresDescending[i]!;
    if (gap > biggestGap) {
      biggestGap = gap;
      cut = i;
    }
  }
  return cut;
}

/**
 * Per-cluster statistics the ordering lever ranks on — one entry per cluster,
 * in the incoming (legacy member-count) order.
 */
export interface ClusterOrderStat {
  /** Cluster member count (legacy ordering key). */
  memberCount: number;
  /** Max query similarity over the cluster's members (relevance-first key). */
  maxScore: number;
  /** Summed evidence-row count over the cluster's members (corroboration key). */
  evidenceMass: number;
}

/**
 * Cluster display permutation for an ordering mode (P7). Returns the display
 * order as indices into `stats` — index i of the result names the cluster that
 * renders in position i. Pure. Stable: clusters with equal key keep their
 * incoming (legacy member-count) order, so a mode never gratuitously reshuffles
 * ties. Descending by the mode's key (biggest cluster / best similarity /
 * heaviest evidence first). See ClusterOrderingMode for each key's rationale.
 */
export function orderClusters(
  stats: readonly ClusterOrderStat[],
  mode: ClusterOrderingMode,
): number[] {
  const key = (s: ClusterOrderStat): number =>
    mode === "max-similarity" ? s.maxScore
      : mode === "evidence-mass" ? s.evidenceMass
        : s.memberCount;
  // Tie-break on the original index keeps ties in incoming order regardless of
  // the engine's sort stability — the "ties preserve legacy order" contract as
  // a literal comparator rather than an assumed property.
  return stats
    .map((s, i) => ({ i, k: key(s) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((e) => e.i);
}
