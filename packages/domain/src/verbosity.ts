/**
 * The response-verbosity lever (operator-ratified 2026-07-26).
 *
 * One agent-facing enum replaces the numeric `clusters` / `max_chars` levers
 * on the check + briefing surfaces, matching the industry numeric→enum arc:
 * OpenAI's `text.verbosity` (low/medium/high output-length hint), Anthropic's
 * `output_config.effort` ("a behavioral signal, not a strict token budget"),
 * Gemini's `thinking_level` superseding the numeric `thinkingBudget`. Omitted
 * means automatic — the server adapts (see `adaptiveK` in the backend
 * clustering service for the adaptive realization and its research lineage).
 *
 * The enum is the CONTRACT; the numbers below are the current server-side
 * REALIZATION and are deliberately tunable without a schema change. Design +
 * citations: docs/planning/response-verbosity-lever.md.
 */

export const VERBOSITY_LEVELS = ["low", "medium", "high"] as const;

export type VerbosityLevel = (typeof VERBOSITY_LEVELS)[number];

/** Internal size-steer type: the agent-facing enum plus the internal "auto"
 *  sentinel routes substitute when a caller gave NO size steer at all. Never
 *  exposed in schemas — the external contract is omission-only automatic,
 *  matching how every major LLM API expresses its adaptive default. */
export type VerbositySteer = VerbosityLevel | "auto";

/** Parse a wire value into a verbosity level; unknown/absent → undefined
 *  (undefined = automatic — never an error, per the steer-not-cap contract). */
export function parseVerbosity(value: string | undefined | null): VerbosityLevel | undefined {
  return VERBOSITY_LEVELS.includes(value as VerbosityLevel) ? (value as VerbosityLevel) : undefined;
}

/** Level → exemplar-count steer for check results. `low` matches the
 *  pre-lever default (3 clustered exemplars), so the conservative end of the
 *  ladder is exactly the behavior every caller already had. */
export const VERBOSITY_EXEMPLAR_K: Record<VerbosityLevel, number> = {
  low: 3,
  medium: 5,
  high: 10,
};
