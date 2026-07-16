/**
 * Ranking and coverage logic for trace search results.
 *
 * In the search-as-logging model, ranking is computed at query time
 * from tsvector relevance (MVP) and will later incorporate:
 * - Semantic similarity (cosine over gemini-embedding-2-preview vectors)
 * - Coverage signals (evidence diversity across agent sessions)
 * - Temporal decay (recent evidence outweighs older)
 *
 * The system makes no stance assertion. Per ADR-0015, embeddings encode
 * topic, not stance (the negation problem), so vector-similarity
 * surfaces are presented neutrally and the LLM consumer interprets
 * stance against current context.
 */

export interface CoverageSignals {
  /** Number of unique API keys (agent sessions) contributing evidence to this trace */
  supportingSessionCount: number;
  /** Total evidence entries asserted by the LLM author at write time */
  supportingEvidenceCount: number;
}

/**
 * Compute a relevance score blending lexical and semantic signals.
 *
 * When both signals are present, uses a 40/60 lexical/semantic blend.
 * Falls back gracefully to whichever signal is available.
 *
 * Inputs are clamped to [0, 1]:
 *   - tsvectorRank: ts_rank_cd output (typically 0–1)
 *   - semanticScore: 1 - cosine_distance (0 = unrelated, 1 = identical)
 */
export function computeRelevanceScore(params: {
  tsvectorRank?: number | undefined;
  semanticScore?: number | undefined;
}): number {
  const { tsvectorRank, semanticScore } = params;

  // eslint-disable-next-line eqeqeq -- loose equality intentional: checks both null and undefined
  if (tsvectorRank != null && semanticScore != null) {
    // Blend: 40% lexical, 60% semantic
    return (
      0.4 * Math.max(0, Math.min(1, tsvectorRank)) +
      0.6 * Math.max(0, Math.min(1, semanticScore))
    );
  }
  // eslint-disable-next-line eqeqeq
  if (semanticScore != null) return Math.max(0, Math.min(1, semanticScore));
  // eslint-disable-next-line eqeqeq
  if (tsvectorRank != null) return Math.max(0, Math.min(1, tsvectorRank));
  return 0;
}

// ── Echo suppression ─────────────────────────────────────────────────────────
//
// The stigmergic append side-effect means an agent that reads and writes the
// same book over many sessions starts retrieving its OWN recent task-shaped
// hypotheses instead of the user's durable taste (self-pollution — see
// docs/planning/echo-suppression.md and docs/benchmarks.md). This demotes those
// echoes in ranking. It is REORDER-ONLY: the displayed similarity percentage is
// never touched, nothing is truncated, and a demoted recipe still appears — it
// just sorts lower. The signals are authorship (same api_key), recency
// (same-session / same-day on the append time), and curated-vs-hypothesis status
// (a deliberately-dated `decided_at` decision is exempt).

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export interface EchoSuppressionConfig {
  /** Master switch. When false, every function here is an identity transform. */
  enabled: boolean;
  /** Max multiplicative penalty on a same-agent, same-session hypothesis
   *  append's ranking score, in [0,1). 0 = no effect, 0.5 = halve the score. */
  weight: number;
  /** Recency window (minutes) counted as "same session" — full `weight`. */
  sessionWindowMinutes: number;
  /** Recency window (hours) counted as "same day" — `weight * dayWeightFactor`
   *  in the band between the session window and this one. */
  dayWindowHours: number;
  /** Fraction of `weight` applied in the same-day-but-not-same-session band. */
  dayWeightFactor: number;
}

/** Shipped default: OFF. Production ranking is byte-stable until an operator or
 *  an A/B arm turns it on. Tuning values are conservative — a same-session echo
 *  loses half its ranking score, a same-day one a quarter. */
export const DEFAULT_ECHO_SUPPRESSION: EchoSuppressionConfig = {
  enabled: false,
  weight: 0.5,
  sessionWindowMinutes: 90,
  dayWindowHours: 24,
  dayWeightFactor: 0.5,
};

export interface EchoRankCandidate {
  id: string;
  /** Raw semantic similarity (0..1). This is the DISPLAYED value — never
   *  mutated by demotion; only the sort order changes. */
  semanticScore: number;
  /** api_key that authored the candidate trace (null for legacy/pre-key rows). */
  authorApiKeyId: string | null;
  /** Insertion time of the candidate trace — the append time, which is the
   *  echo signal (not decided_at, which is the judgment date). */
  createdAt: Date;
  /** True when the trace is a deliberately-dated/curated decision (decided_at
   *  set) — exempt from demotion even if same-agent and recent. */
  curated: boolean;
}

export interface EchoRankContext {
  /** api_key making the current check. */
  currentApiKeyId: string | null;
  /** "now" for recency math — injectable so tests are deterministic. */
  now: Date;
}

/**
 * Demotion penalty in [0, weight] for one candidate. 0 = no demotion.
 *
 * Non-zero only when suppression is enabled AND the candidate is a non-curated,
 * same-agent, recent append. Curated (decided_at) recipes, cross-agent recipes,
 * and appends older than the day window are never demoted.
 */
export function echoDemotionPenalty(
  candidate: EchoRankCandidate,
  ctx: EchoRankContext,
  config: EchoSuppressionConfig,
): number {
  if (!config.enabled) return 0;
  if (candidate.curated) return 0;
  // Authorship: both sides must be known and equal to count as "same agent".
  if (!ctx.currentApiKeyId || candidate.authorApiKeyId === null) return 0;
  if (candidate.authorApiKeyId !== ctx.currentApiKeyId) return 0;

  const ageMs = ctx.now.getTime() - candidate.createdAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0; // future-dated safety

  const sessionMs = config.sessionWindowMinutes * 60_000;
  const dayMs = config.dayWindowHours * 3_600_000;

  if (ageMs <= sessionMs) return clamp01(config.weight);
  if (ageMs <= dayMs) return clamp01(config.weight * config.dayWeightFactor);
  return 0;
}

/**
 * Ranking score used for ordering after demotion. Equals the raw semantic score
 * when nothing is demoted; the displayed similarity is always the raw score.
 */
export function echoRankingScore(
  candidate: EchoRankCandidate,
  ctx: EchoRankContext,
  config: EchoSuppressionConfig,
): number {
  if (!config.enabled) return candidate.semanticScore;
  return candidate.semanticScore * (1 - echoDemotionPenalty(candidate, ctx, config));
}

/**
 * Reorder candidates by demoted ranking score, descending. Stable: ties (and
 * the whole list when disabled) keep their incoming relevance order, so the
 * disabled path is a byte-stable identity transform. Reorder only — no element
 * is added, removed, or mutated.
 */
export function rankWithEchoSuppression<T extends EchoRankCandidate>(
  candidates: readonly T[],
  ctx: EchoRankContext,
  config: EchoSuppressionConfig,
): T[] {
  if (!config.enabled) return candidates.slice();
  return candidates
    .map((c, i) => ({ c, i, score: echoRankingScore(c, ctx, config) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.c);
}
