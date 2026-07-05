/**
 * Check-feedback vocabulary — the field-proven schema v1 enums (2026-06/07
 * fleet sessions; ~180 rows ground-truthed in the 2026-07-02 effectiveness
 * analysis) that the server-side check_feedback table (WT-4, 2026-07-05)
 * inherits unchanged. The strict validation is deliberate: v1's enum checks
 * caught bad values in the wild, and analytical queries depend on a closed
 * vocabulary.
 *
 * Shared by the backend feedback service (validation + helpful error
 * messages), the MCP tool descriptions, and the frontend feedback display.
 * No I/O here — packages/domain rule.
 */

export const FEEDBACK_KINDS = ["check-feedback", "operational", "outcome"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_IMPACTS = ["none", "new", "subtle", "big", "operational"] as const;
export type FeedbackImpact = (typeof FEEDBACK_IMPACTS)[number];

export const FEEDBACK_DISPOSITIONS = [
  "proceeded",
  "corrected",
  "asked-human",
  "charted-new",
  "deferred",
] as const;
export type FeedbackDisposition = (typeof FEEDBACK_DISPOSITIONS)[number];

export const FEEDBACK_FULFILLED = ["yes", "partial", "no", "unknown"] as const;
export type FeedbackFulfilled = (typeof FEEDBACK_FULFILLED)[number];

/** Human reactions on a recipe (trace) — Layer 3 of the UVP measurement
 *  architecture: one click, timestamped, attributed, one per user per trace. */
export const TRACE_REACTIONS = ["still_true", "stale", "wrong"] as const;
export type TraceReaction = (typeof TRACE_REACTIONS)[number];

/** Render an enum vocabulary for error messages: "a | b | c". */
export function vocab(values: readonly string[]): string {
  return values.join(" | ");
}
