/**
 * Ranking pipeline configuration — the single config object that flows through
 * every stage of the check_recipe ranking pipeline (candidate retrieval →
 * scoring/demotion → clustering → cluster ordering → exemplar selection →
 * rendering). See docs/planning/check-recipe-ranking-system.md §3a/§3c.
 *
 * Layering (recipe 8ee8e3ab, informed by
 * docs/planning/ranking-research/ranking-config-management.md):
 *   1. Code defaults here — versioned, documented ranges, CI-gated. A default
 *      change is a versioned algorithm event: bump RANKING_ALGORITHM_VERSION
 *      and add a docs/architecture/ranking-changelog.md entry in the same
 *      commit. Defaults never change silently.
 *   2. `system_settings` — operational switches only (today: the
 *      echoSuppression setting, which can also carry tuned weights during an
 *      experiment). Merged over the code defaults at request time.
 *   3. Per-request overrides (`echo_suppress=on|off`) — ephemeral, echoed back
 *      in the response's `ranking` block, never persisted.
 *
 * Standing rulings every lever here must honor (brief §2):
 *   - No relevance floors or cutoffs, ever. Levers reorder; they never
 *     truncate and never mutate displayed similarity percentages.
 *   - Server relevance order is load-bearing; ordering improvements live here.
 *   - The objective is utility × surprise, not relevance-max.
 *   - Any future recency/decay lever decays from COALESCE(decided_at,
 *     created_at) — backfilled decisions (decision archaeology) age as old
 *     judgments, not fresh ones. (Operator ruling 2026-07-16, folded from the
 *     former decay backlog item.)
 *   - No LLM on the ranking path: the server does math, agents do reasoning.
 */

import { DEFAULT_ECHO_SUPPRESSION } from "./ranking";
import type { EchoSuppressionConfig } from "./ranking";

/**
 * Dated ranking-algorithm version identifier. Minted ONLY when a shipped
 * default in DEFAULT_RANKING (or the demotion math it selects) changes —
 * additive levers that default to the previous behavior do not mint a new
 * version. Surfaced in check responses (`data.ranking.version`) and the
 * recipe.checked audit metadata so consumers and experiments can report which
 * ranking they ran against. History: docs/architecture/ranking-changelog.md.
 */
export const RANKING_ALGORITHM_VERSION = "2026-07-16";

/**
 * Cluster display-ordering key.
 *
 *   - "member-count": legacy ordering — clusters sort by raw member count,
 *     descending. Self-similar multi-pass echoes win this count, which is how
 *     demotion's benefit was absorbed downstream (brief §1.2).
 *   - "demotion-adjusted-mass": clusters sort by the sum of their members'
 *     demotion-adjusted ranking scores (similarity × (1 − echo penalty)), so
 *     a cluster of demoted echoes sinks below a smaller cluster of durable
 *     cross-agent recipes. Reorder only — membership, exemplars, and displayed
 *     percentages are untouched. The §3d proving lever.
 *
 * Default stays "member-count" until the golden-set measurement rules the
 * flip (house rule: ranking changes arrive measured; recipe 5cfee9bb).
 */
export type ClusterOrderingKey = "member-count" | "demotion-adjusted-mass";

/**
 * Which signals exempt a candidate from echo demotion as "curated" — i.e.
 * evidence of durable judgment independent of the reporting agent
 * (docs/planning/echo-suppression.md §Curated / reinforced exemption).
 *
 * decidedAt is the shipped v1 signal. The two corroboration signals are
 * plumbed (per-candidate counts hydrate when a flag is on) but default OFF:
 * turning one on changes what echo demotion does, so each flip is a measured,
 * versioned event like any other default change.
 */
export interface CurationExemptionConfig {
  /** decided_at set ⇒ deliberately-dated decision ⇒ exempt. v1, shipped ON. */
  decidedAt: boolean;
  /** A human reacted to the trace (trace_reactions row) ⇒ exempt. Range:
   *  boolean. Default OFF pending golden-set measurement. */
  humanReaction: boolean;
  /** A DIFFERENT api_key logged check-feedback about the trace ⇒ exempt.
   *  Same-key feedback never counts (it is the echo axis itself). Range:
   *  boolean. Default OFF pending golden-set measurement. */
  crossAgentFeedback: boolean;
}

/**
 * Clustering candidate pool — hypothesis P6 (ranking-engine.md stage 3).
 *
 *   - "page": legacy — the pool is the pagination window (per_page, default
 *     20), an inherited default doing double duty. Byte-stable.
 *   - "fixed": the pool is the top `size` candidates by adjusted rank,
 *     decoupled from pagination. The clustered summary then draws from an
 *     industry-standard diversity pool (retrieve-~100-then-refine practice;
 *     Carrot2 names ~100 the clustering minimum) while flat pagination is
 *     untouched. Pool selection shapes only the clustered summary — no score
 *     floor hides anything from the flat surface (principle 2).
 *
 * size range: 20–400. ≤133 keeps the ANN top-k stream on the fast index plan
 * (133 × ANN_DEDUPE_MARGIN 3 = 399 ≤ ANN_CANDIDATE_MAX 400); larger forces
 * exhaustive scans per check. vectorDims: MRL truncation for pool clustering
 * vectors (768 = the Recipe Map precedent, 4× cheaper than full 3,072; 0 =
 * full dims). Sources: docs/planning/ranking-research/candidate-pool-sizing.md.
 */
export interface ClusterPoolConfig {
  mode: "page" | "fixed";
  size: number;
  vectorDims: number;
}

/**
 * The pipeline config object. Every ranking lever is a named field with a
 * documented default and range; stages read from this object rather than
 * from scattered constants, so a new lever is a field + a stage read — no
 * plumbing rewrite (brief §3a).
 */
export interface RankingConfig {
  /** Same-agent/same-session echo demotion (packages/domain/src/ranking.ts).
   *  weight ∈ [0,1) (shipped 0.5); sessionWindowMinutes > 0 (90);
   *  dayWindowHours ≥ sessionWindowMinutes/60 (24); dayWeightFactor ∈ [0,1]
   *  (0.5). enabled ships false — the A/B decides the flip. */
  echo: EchoSuppressionConfig;
  /** What counts as curated (demotion-exempt). */
  exemption: CurationExemptionConfig;
  /** Cluster display ordering. */
  clusterOrdering: ClusterOrderingKey;
  /** Clustering candidate pool (P6). Ships "page" (legacy); the measured
   *  candidate is fixed:100 @ 768 dims. */
  clusterPool: ClusterPoolConfig;
}

/** Shipped defaults — byte-identical to pre-refactor behavior. */
export const DEFAULT_RANKING: RankingConfig = {
  echo: DEFAULT_ECHO_SUPPRESSION,
  exemption: {
    decidedAt: true,
    humanReaction: false,
    crossAgentFeedback: false,
  },
  clusterOrdering: "member-count",
  clusterPool: { mode: "page", size: 100, vectorDims: 768 },
};

/**
 * Per-candidate ranking signals, hydrated once after retrieval and available
 * to every downstream stage (recipe 1121a2a5). Cheap signals ride the
 * existing trace-row load; the corroboration counts hydrate lazily — only
 * when an active lever needs them — so the default serving path stays cheap.
 */
export interface CandidateSignals {
  /** api_key that authored the trace (null for legacy/pre-key rows). */
  authorApiKeyId: string | null;
  /** User who owns the authoring key (null for legacy rows). */
  authorUserId: string | null;
  /** Raw insertion time — the append time, which is the echo signal. */
  createdAt: Date;
  /** Judgment date when backfilled (decision archaeology); null otherwise. */
  decidedAt: Date | null;
  /** Human trace_reactions count. Hydrated only when
   *  exemption.humanReaction is on; undefined = not hydrated. */
  humanReactionCount?: number | undefined;
  /** check_feedback rows from OTHER api_keys. Hydrated only when
   *  exemption.crossAgentFeedback is on; undefined = not hydrated. */
  crossAgentFeedbackCount?: number | undefined;
}

/**
 * Is this candidate curated (exempt from echo demotion) under the given
 * exemption config? A signal that is configured on but not hydrated
 * contributes false (never throws) — hydration gaps degrade to v1 behavior.
 */
export function isCurated(
  signals: Pick<
    CandidateSignals,
    "decidedAt" | "humanReactionCount" | "crossAgentFeedbackCount"
  >,
  exemption: CurationExemptionConfig,
): boolean {
  if (exemption.decidedAt && signals.decidedAt !== null && signals.decidedAt !== undefined) {
    return true;
  }
  if (exemption.humanReaction && (signals.humanReactionCount ?? 0) > 0) {
    return true;
  }
  if (exemption.crossAgentFeedback && (signals.crossAgentFeedbackCount ?? 0) > 0) {
    return true;
  }
  return false;
}

/**
 * Demotion-adjusted mass of one cluster: the sum of its members'
 * demotion-adjusted ranking scores. Pure aggregation — the per-member weight
 * (similarity × (1 − echo penalty)) is computed by the caller, which owns the
 * demotion context. Empty clusters weigh 0.
 */
export function demotionAdjustedMass(memberWeights: readonly number[]): number {
  let sum = 0;
  for (const w of memberWeights) sum += w;
  return sum;
}
