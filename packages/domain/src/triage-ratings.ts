/**
 * Triage ratings on a recipe check (drafts-and-triage slice 1).
 *
 * Two optional ratings an agent may attach to any check, in the briefing's own
 * words for when a check is worth making ("uncertainty × impact"):
 *   - impact: how much rides on getting this call right
 *   - uncertainty: how unsure the agent is of the person's position
 * each `low | medium | high`. Omitted means not rated (null), never a stored
 * default. Design: docs/planning/drafts-and-triage.md §Triage ratings.
 *
 * Capture-only leniency (recipe 4cfd166e): an unrecognized value is stored as
 * not rated and explained in a notice; it never rejects the check. A repeat
 * of an identical check keeps the first ratings (build log open question 4).
 *
 * Ratings shape display and triage only. Nothing in the ranking, clustering,
 * or MMR code reads them (self-ratings are unsafe as a relevance signal,
 * recipe ff54eafd); apps/backend/src/services/ranking-isolation.test.ts
 * pins that statically.
 *
 * Pure functions, no I/O.
 */
import { TRIAGE_RATING_VALUES } from "@soupnet/contracts";
import type { TriageRating } from "@soupnet/contracts";

export interface TriageRatings {
  impact: TriageRating | null;
  uncertainty: TriageRating | null;
}

const VOCABULARY = TRIAGE_RATING_VALUES.join(" | ");

/** One rating value: a vocabulary value, not rated (null), or an
 *  unrecognized value (null, with what was sent). */
export function parseTriageRating(raw: unknown): { value: TriageRating | null; unrecognized?: string } {
  if (raw === undefined || raw === null) return { value: null };
  // Only a string can name a rating. Any other JSON type (a number, a
  // boolean, an array, an object) is unrecognized and echoed as JSON, so
  // ["high"] never passes as "high" through String() coercion.
  const text = typeof raw === "string" ? raw.trim() : JSON.stringify(raw);
  if (text === "") return { value: null };
  const lowered = text.toLowerCase();
  const match = typeof raw === "string" ? TRIAGE_RATING_VALUES.find((v) => v === lowered) : undefined;
  return match ? { value: match } : { value: null, unrecognized: echo(text) };
}

const ECHO_MAX = 60;
/** The unrecognized value as the notice quotes it, bounded in length. */
function echo(text: string): string {
  return text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX)}…` : text;
}

/** Both ratings from a check's raw params, plus a notice naming any
 *  unrecognized value and the accepted vocabulary. */
export function parseTriageRatings(raw: { impact?: unknown; uncertainty?: unknown }): {
  ratings: TriageRatings;
  notice?: string;
} {
  const impact = parseTriageRating(raw.impact);
  const uncertainty = parseTriageRating(raw.uncertainty);
  const rejected = [
    ...(impact.unrecognized !== undefined ? [`impact "${impact.unrecognized}"`] : []),
    ...(uncertainty.unrecognized !== undefined ? [`uncertainty "${uncertainty.unrecognized}"`] : []),
  ];
  const ratings = { impact: impact.value, uncertainty: uncertainty.value };
  if (rejected.length === 0) return { ratings };
  return {
    ratings,
    notice:
      `${rejected.join(" and ")} ${rejected.length > 1 ? "are not rating values, so they are" : "is not a rating value, so it is"} stored as not rated. `
      + `Ratings take ${VOCABULARY}; omit one you have no view on.`,
  };
}

/** "impact high, uncertainty not rated" */
export function describeRatings(r: TriageRatings): string {
  return `impact ${r.impact ?? "not rated"}, uncertainty ${r.uncertainty ?? "not rated"}`;
}

/**
 * The notice for a repeat of an identical check (same key, book, and text)
 * that sent ratings different from the stored ones. The stored recipe is
 * returned unchanged: first write wins, so an append-only surface never
 * mutates a stored field. Undefined when the repeat sent no rating that
 * differs from what is stored.
 */
export function repeatRatingsNotice(requested: TriageRatings, stored: TriageRatings): string | undefined {
  const differs =
    (requested.impact !== null && requested.impact !== stored.impact)
    || (requested.uncertainty !== null && requested.uncertainty !== stored.uncertainty);
  if (!differs) return undefined;
  return (
    `This recipe was already logged by an identical earlier check from this key, so its first `
    + `ratings stand (${describeRatings(stored)}); this check's ratings were not applied.`
  );
}

/**
 * The markdown echo of the deposit's ratings, for the MCP and copy-back
 * reports. Silent when nothing was rated and there is nothing to explain, so
 * agents that never rate see no extra line.
 */
export function renderRatingsMarkdown(ratings: TriageRatings | undefined, notice?: string): string {
  const rated = ratings !== undefined && (ratings.impact !== null || ratings.uncertainty !== null);
  if (!rated && !notice) return "";
  const r = ratings ?? { impact: null, uncertainty: null };
  let text = `Your ratings: ${describeRatings(r)} (triage only, never ranking).\n`;
  if (notice) text += `${notice}\n`;
  return text;
}
