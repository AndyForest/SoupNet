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
