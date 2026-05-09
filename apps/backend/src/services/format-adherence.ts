/**
 * Format adherence scoring for recipes.
 *
 * Scores how well a recipe text matches the expected format:
 * - Full format: "As a [role] working on [goal], I [prefer/chose] so that [reason]"
 * - Minimum acceptable: role + action verb + reasoning
 * - NOT: questions, commands, bare keywords, empty text, context-free assertions
 *
 * Docs to update when changing this file:
 *   - docs/architecture/search-algorithms.md (format_adherence_score section)
 *
 * Returns a score 0.0-1.0 and a classification:
 *   - "good" (>= 0.6): well-formed recipe, proceed normally
 *   - "warn" (0.3-0.6): acceptable but could be better, show suggestion
 *   - "reject" (< 0.3): not a recipe, show error and don't log
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface FormatAdherenceResult {
  score: number; // 0.0 to 1.0
  level: "good" | "warn" | "reject";
  reason: string; // human-readable explanation
}

// ── Tunable thresholds ───────────────────────────────────────────────────────

const THRESHOLD_GOOD = 0.6;
const THRESHOLD_WARN = 0.3;

// ── Scoring constants ────────────────────────────────────────────────────────

const SCORE_ROLE_FRAMING = 0.25; // "As a " or "As an "
const SCORE_ACTION_VERB = 0.2; // " I " + action verb
const SCORE_REASONING = 0.15; // " so that " or " because "
const SCORE_LENGTH_SHORT = 0.10; // length > 25 chars
const SCORE_LENGTH_LONG = 0.15; // length > 50 chars (additional)
const SCORE_PUNCTUATION = 0.1; // comma or period
const SCORE_CAPITALIZED = 0.05; // starts with capital letter
const SCORE_HAS_ROLE = 0.1; // noun-like word after "As a"
const SCORE_PROJECT_CONTEXT = 0.1; // project/task context after role ("working on", "building", "for the")
const SCORE_DECLARATIVE = 0.1; // contains a comparative or declarative verb

const CAP_QUESTION = 0.2;
const CAP_COMMAND = 0.25;
const MIN_LENGTH = 10;

// ── Patterns ─────────────────────────────────────────────────────────────────

// Accept "As a", "As an", "As the" — all valid English ways to introduce a
// role. "As the co-creator of X" is no less valid than "As a developer".
const ROLE_PATTERN = /\bAs (?:an?|the) /i;
const ACTION_VERB_PATTERN =
  /\bI\s+(prefer|chose|decided|want|like|insist|use|selected|adopted)\b/i;
const REASONING_PATTERN = /\s(so that|because)\s/i;
const ROLE_NOUN_PATTERN = /\bAs (?:an?|the)\s+\w+/i;
const COMMAND_START_PATTERN =
  /^(Find|Search|Get|Show|List|Tell|What|How|Why|Where|Which|Change)\b/i;
const PROJECT_CONTEXT_PATTERN =
  /\b(working on|building|for the|organizing|designing|creating|managing)\b/i;
const DECLARATIVE_PATTERN =
  /\b(is|are|was|were|better|worse|prefer|superior|inferior)\b/i;

// ── Main scoring function ────────────────────────────────────────────────────

export function scoreFormatAdherence(text: string): FormatAdherenceResult {
  // Empty input
  if (!text || text.trim().length === 0) {
    return { score: 0, level: "reject", reason: "Empty input" };
  }

  const trimmed = text.trim();

  // Very short input
  if (trimmed.length < MIN_LENGTH) {
    return {
      score: 0.1,
      level: "reject",
      reason: "Too short to be a meaningful recipe",
    };
  }

  // Additive scoring
  let score = 0;

  if (ROLE_PATTERN.test(trimmed)) {
    score += SCORE_ROLE_FRAMING;
  }

  if (ACTION_VERB_PATTERN.test(trimmed)) {
    score += SCORE_ACTION_VERB;
  }

  if (REASONING_PATTERN.test(trimmed)) {
    score += SCORE_REASONING;
  }

  if (trimmed.length > 25) {
    score += SCORE_LENGTH_SHORT;
  }
  if (trimmed.length > 50) {
    score += SCORE_LENGTH_LONG;
  }

  if (/[,.]/.test(trimmed)) {
    score += SCORE_PUNCTUATION;
  }

  if (/^[A-Z]/.test(trimmed)) {
    score += SCORE_CAPITALIZED;
  }

  if (ROLE_NOUN_PATTERN.test(trimmed)) {
    score += SCORE_HAS_ROLE;
  }

  if (PROJECT_CONTEXT_PATTERN.test(trimmed)) {
    score += SCORE_PROJECT_CONTEXT;
  }

  if (DECLARATIVE_PATTERN.test(trimmed)) {
    score += SCORE_DECLARATIVE;
  }

  // Negative signals — cap the score
  const isQuestion = trimmed.endsWith("?");
  const isCommand = COMMAND_START_PATTERN.test(trimmed);

  if (isQuestion) {
    score = Math.min(score, CAP_QUESTION);
  }

  if (isCommand) {
    score = Math.min(score, CAP_COMMAND);
  }

  // Clamp to [0.0, 1.0]
  score = Math.max(0, Math.min(1, score));

  // Classify
  if (score >= THRESHOLD_GOOD) {
    return { score, level: "good", reason: "Well-formed recipe" };
  }

  if (score >= THRESHOLD_WARN) {
    // Pick a useful suggestion
    const reason = getWarnReason(trimmed);
    return { score, level: "warn", reason };
  }

  // Reject — pick a specific reason
  const reason = getRejectReason(trimmed, isQuestion, isCommand);
  return { score, level: "reject", reason };
}

// ── Reason helpers ───────────────────────────────────────────────────────────

function getWarnReason(text: string): string {
  if (!ROLE_PATTERN.test(text)) {
    return "Consider using 'As a [role] working on [goal]...' format for better matching";
  }
  if (!REASONING_PATTERN.test(text)) {
    return "Recipe could use more context — add 'so that [reason]'";
  }
  if (ROLE_PATTERN.test(text) && !PROJECT_CONTEXT_PATTERN.test(text)) {
    return "Add what you're working on — e.g., 'As a developer working on [goal]...'";
  }
  if (text.length <= 50) {
    return "Recipe needs more context — include role, goal, and reasoning";
  }
  return "Recipe is acceptable but could be more structured — try 'As a [role] working on [goal], I [chose] so that [reason]'";
}

function getRejectReason(
  _text: string,
  isQuestion: boolean,
  isCommand: boolean,
): string {
  if (isQuestion) {
    return "This looks like a question — recipes should be hypotheses, not queries";
  }
  if (isCommand) {
    return "This looks like a command, not a recipe";
  }
  return "Not enough recipe structure — try 'As a [role] working on [goal], I [preference] so that [reason]'";
}
