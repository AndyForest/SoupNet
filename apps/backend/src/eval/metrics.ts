/**
 * Ranking-eval metrics — pure functions, no I/O.
 *
 * The metric set implements the ranking-research memos' recommendations for a
 * no-truncation, cluster-ordered, utility-times-surprise ranking system
 * (docs/planning/ranking-research/offline-ir-evaluation.md §Recommendations,
 * serendipity-diversity-metrics.md §5, ranking-regression-testing.md §5):
 *
 *   - Whole-list NDCG is the primary graded-relevance metric (its log discount
 *     rewards reordering — our only lever — without implying a cutoff, matching
 *     the "reorder, never truncate" ruling). NDCG@k values are DIAGNOSTICS of
 *     attention-weighted quality, never gates on what's shown.
 *   - Echo share at each pipeline stage makes "absorbed downstream" a
 *     first-class output (the stage-attribution waterfall).
 *   - Ser@L operationalizes utility × surprise (Vargas & Castells rank/relevance
 *     scheme over Kaminskas & Bridge min-distance unexpectedness).
 *   - Kendall tau is the no-regression guardrail on unaffected queries.
 *
 * Consumed by apps/backend/src/eval/ranking-eval.ts (Layer B golden-set runner).
 * Layer 1 unit tests: metrics.test.ts (100% branch coverage).
 */

// ── DCG / NDCG ───────────────────────────────────────────────────────────────

/** Position discount, rank counted from 1: 1/log2(rank+1). */
export function rankDiscount(rank: number): number {
  return 1 / Math.log2(rank + 1);
}

/**
 * Discounted cumulative gain over graded relevance values in ranked order.
 * `cutoff` limits to the top-k prefix (diagnostic use); absent = whole list.
 */
export function dcg(gains: readonly number[], cutoff?: number): number {
  const n = cutoff === undefined ? gains.length : Math.min(cutoff, gains.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += gains[i]! * rankDiscount(i + 1);
  }
  return sum;
}

/**
 * Normalized DCG: DCG of the ranked gains over the DCG of the ideal ordering
 * of `allGains` (every graded gain in the judgment pool, retrieved or not —
 * with no-truncation retrieval the two sets coincide, but the ideal is
 * computed from the pool so a retrieval gap can never inflate the score).
 * Returns 1 when the pool holds no relevance mass (nothing to get wrong).
 */
export function ndcg(
  rankedGains: readonly number[],
  allGains: readonly number[],
  cutoff?: number,
): number {
  const ideal = [...allGains].sort((a, b) => b - a);
  const idealDcg = dcg(ideal, cutoff);
  if (idealDcg === 0) return 1;
  return dcg(rankedGains, cutoff) / idealDcg;
}

// ── Set-share metrics (echo exposure, recall) ────────────────────────────────

/**
 * Fraction of the top-k ranked ids that are members of `marked` (e.g. echo
 * traces). k defaults to the whole list. Empty prefix ⇒ 0.
 */
export function shareAtK(
  rankedIds: readonly string[],
  marked: ReadonlySet<string>,
  k?: number,
): number {
  const n = k === undefined ? rankedIds.length : Math.min(k, rankedIds.length);
  if (n === 0) return 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (marked.has(rankedIds[i]!)) hits++;
  }
  return hits / n;
}

/**
 * Recall@k of a target set (e.g. genuine relevant recipes): fraction of
 * `targets` present in the top-k ranked ids. Empty target set ⇒ 1 (nothing
 * to miss).
 */
export function recallAtK(
  rankedIds: readonly string[],
  targets: ReadonlySet<string>,
  k: number,
): number {
  if (targets.size === 0) return 1;
  const top = new Set(rankedIds.slice(0, k));
  let hits = 0;
  for (const t of targets) {
    if (top.has(t)) hits++;
  }
  return hits / targets.size;
}

// ── Kendall tau (rank-correlation guardrail) ─────────────────────────────────

/**
 * Kendall tau-a between two orderings of the same id set, computed over the
 * ids common to both (order-stability guardrail: tau = 1 ⇔ identical relative
 * order). Fewer than 2 common ids ⇒ 1 (no pair can disagree).
 */
export function kendallTau(orderA: readonly string[], orderB: readonly string[]): number {
  const posB = new Map<string, number>();
  orderB.forEach((id, i) => posB.set(id, i));
  const common = orderA.filter((id) => posB.has(id));
  const n = common.length;
  if (n < 2) return 1;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = posB.get(common[i]!)! - posB.get(common[j]!)!;
      if (d < 0) concordant++;
      else discordant++;
    }
  }
  return (concordant - discordant) / (n * (n - 1) / 2);
}

// ── Utility × surprise: Ser@L ────────────────────────────────────────────────

export interface SerendipityItem {
  /** Graded relevance normalized to [0,1] (grade / maxGrade). */
  rel: number;
  /** Unexpectedness: min cosine DISTANCE from the item's embedding to the
   *  expectation set E = {query} (∪ known-recipe embeddings when present) —
   *  Kaminskas & Bridge's min-distance surprise. */
  unexp: number;
}

/**
 * Expected serendipity of a ranked list (Candidate A of the serendipity memo,
 * Vargas-scheme rank-discounted utility × surprise):
 *
 *     Ser@L = (1/Z) · Σ_i disc(rank_i) · rel_i · unexp_i,   disc(k) = 1/log2(k+1)
 *     Z     = Σ_i disc(rank_i)
 *
 * Items arrive in ranked order (rank = index + 1). Pure cosine ranking scores
 * low (top items have unexp ≈ 0); random reorder scores low (high-unexp items
 * have rel ≈ 0) — the maximum lives at "distant enough to teach, applicable
 * enough to act on". Empty list ⇒ 0.
 */
export function serendipityAtL(items: readonly SerendipityItem[]): number {
  if (items.length === 0) return 0;
  let mass = 0;
  let z = 0;
  for (let i = 0; i < items.length; i++) {
    const d = rankDiscount(i + 1);
    mass += d * items[i]!.rel * items[i]!.unexp;
    z += d;
  }
  return mass / z;
}

// ── Cluster-aspect coverage ──────────────────────────────────────────────────

/**
 * Aspect coverage of the displayed exemplars: of the aspects that have at
 * least one RELEVANT trace in the judgment pool, what fraction appear among
 * the exemplars via a relevant trace? (α-nDCG-style intent coverage with the
 * golden aspect labels standing in for subtopics.) No relevant-aspect mass in
 * the pool ⇒ 1.
 *
 * @param exemplarIds   displayed cluster exemplars, in display order
 * @param aspectByTrace trace id → aspect label (golden fixture labels)
 * @param relevantIds   trace ids with graded relevance > 0 for this question
 */
export function aspectCoverage(
  exemplarIds: readonly string[],
  aspectByTrace: ReadonlyMap<string, string>,
  relevantIds: ReadonlySet<string>,
): number {
  const relevantAspects = new Set<string>();
  for (const id of relevantIds) {
    const aspect = aspectByTrace.get(id);
    if (aspect !== undefined) relevantAspects.add(aspect);
  }
  if (relevantAspects.size === 0) return 1;
  const covered = new Set<string>();
  for (const id of exemplarIds) {
    if (!relevantIds.has(id)) continue;
    const aspect = aspectByTrace.get(id);
    if (aspect !== undefined && relevantAspects.has(aspect)) covered.add(aspect);
  }
  return covered.size / relevantAspects.size;
}

// ── Cluster-ordering quality (P7 lever) ──────────────────────────────────────

/**
 * NDCG of the displayed exemplars AS ORDERED against the ideal ordering of the
 * SAME exemplars (their grades sorted descending). Measures whether cluster
 * ordering surfaced the best exemplar first — independent of WHICH exemplars
 * clustering chose (that is aspectCoverage's job, which is order-blind). 1.0
 * when no displayed exemplar carries relevance mass (nothing to get wrong).
 *
 * @param displayedGrades exemplar grades in DISPLAY order (position 0 first).
 */
export function exemplarOrderNdcg(displayedGrades: readonly number[]): number {
  return ndcg(displayedGrades, displayedGrades);
}

/**
 * Grade of the FIRST displayed exemplar, normalized to [0,1] (grade /
 * maxGrade) — the single most attention-weighted slot, which member-count
 * ordering is suspected to squander on the echo-mass cluster. Empty display ⇒ 0
 * (nothing relevant surfaced first).
 *
 * @param displayedGrades exemplar grades in DISPLAY order (position 0 first).
 * @param maxGrade the grading scale's maximum (3 in the golden sets).
 */
export function firstExemplarGrade(displayedGrades: readonly number[], maxGrade: number): number {
  if (displayedGrades.length === 0) return 0;
  return displayedGrades[0]! / maxGrade;
}

// ── Display redundancy (grade-free diversity) ────────────────────────────────

/** Cosine similarity, truncating to the shorter vector (MRL prefix). */
function cosineSim(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Mean pairwise cosine similarity of the displayed representatives' vectors —
 * the redundancy of the display (lower = more diverse). A GRADE-FREE metric: it
 * reads only the display vectors, so it makes the k-means baseline and MMR
 * comparable on ungraded corpora, where the graded metrics (nDCG, aspect
 * coverage) can't tell them apart. This is exactly the redundancy term MMR
 * minimizes (Carbonell & Goldstein 1998), read straight off the pipeline
 * output. Fewer than two vectors ⇒ 0 (a lone representative is redundant with
 * nothing).
 */
export function displayRedundancy(vectors: readonly (readonly number[])[]): number {
  const n = vectors.length;
  if (n < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += cosineSim(vectors[i]!, vectors[j]!);
      pairs++;
    }
  }
  return sum / pairs;
}

// ── Aggregation helper ───────────────────────────────────────────────────────

/** Arithmetic mean; empty input ⇒ 0 (an empty question set aggregates to 0,
 *  which any sane min-bound threshold then flags). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
