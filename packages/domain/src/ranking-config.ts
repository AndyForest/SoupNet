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
export const RANKING_ALGORITHM_VERSION = "2026-07-16";

/**
 * Clustering candidate pool — hypothesis P6 (ranking-engine.md stage 3).
 *
 *   - "page": legacy — the pool is the pagination window (per_page, default
 *     20), an inherited default doing double duty. Byte-stable.
 *   - "fixed": the pool is the top `size` candidates by rank. A comparison
 *     arm for sweeps — fixed caps are fixture-relative (measured 2026-07-17),
 *     so this is scaffolding, not the target.
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
 * The pipeline config object. Every ranking lever is a named field with a
 * documented default and range; stages read from this object rather than
 * scattered constants, so a new lever is a field + a stage read.
 */
export interface RankingConfig {
  /** Clustering candidate pool (P6). Ships "page" (legacy); "score-gap" is
   *  the measured candidate. */
  clusterPool: ClusterPoolConfig;
}

/** Shipped defaults — byte-identical to legacy behavior. */
export const DEFAULT_RANKING: RankingConfig = {
  clusterPool: { mode: "page", size: 133, minSize: 20, vectorDims: 768 },
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
