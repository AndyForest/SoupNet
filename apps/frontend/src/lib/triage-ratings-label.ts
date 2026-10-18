/**
 * The trace detail page's label for a recipe's triage ratings
 * (drafts-and-triage slice 1, DT-RAT-09).
 *
 * The ratings are the depositing agent's own view at check time, so the label
 * says so: it never presents them as the person's assessment. Null means the
 * agent gave no rating ("not rated"); with neither rating set the page shows
 * nothing, so recipes from agents that never rate look as they always have.
 */
export interface TriageRatingsLike {
  impact?: string | null;
  uncertainty?: string | null;
}

/**
 * One label on every page (post-merge findings, 2026-09-29: the detail page
 * said "Agent's ratings" and the queue "Depositing agent's ratings"). The
 * ratings are always the depositing agent's, whoever that agent works for.
 */
export const RATINGS_LABEL = "Depositing agent's ratings";

export function triageRatingsLabel(r: TriageRatingsLike): string | null {
  const impact = r.impact ?? null;
  const uncertainty = r.uncertainty ?? null;
  if (impact === null && uncertainty === null) return null;
  return `${RATINGS_LABEL}: impact ${impact ?? "not rated"} · uncertainty ${uncertainty ?? "not rated"}`;
}

/** Hover text: whose ratings these are, and what they are for. */
export const TRIAGE_RATINGS_TITLE =
  "Set by the agent that checked this recipe, as its own view at the time; not your assessment. Ratings sort review and never change search ranking.";
