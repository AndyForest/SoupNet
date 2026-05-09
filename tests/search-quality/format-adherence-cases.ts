/**
 * Test cases for format adherence scoring (not yet implemented).
 * Documents expected behavior when the scoring system is built.
 *
 * Scoring levels:
 *   - "high":       Full user story format (As a..., I... so that...)
 *   - "acceptable": Partial format — taste assertion with some structure
 *   - "low":        Bare assertion without context or evidence framing
 *   - "reject":     Not a recipe at all (question, command, empty, etc.)
 */

export const FORMAT_ADHERENCE_CASES = [
  {
    input: "As a developer, I prefer TypeScript so that I catch bugs early.",
    expected: "high",
    reason: "Full user story format",
  },
  {
    input: "I prefer high-contrast themes for extended coding sessions.",
    expected: "acceptable",
    reason: "Taste assertion without role/goal framing — acceptable but not ideal",
  },
  {
    input: "What font should I use for my project?",
    expected: "reject",
    reason: "Question, not a recipe",
  },
  {
    input: "Change the font to 16px.",
    expected: "reject",
    reason: "Command, not a recipe",
  },
  {
    input: "Find all traces about typography.",
    expected: "reject",
    reason: "Search command, not a recipe",
  },
  {
    input: "As a developer, I chose TypeScript.",
    expected: "acceptable",
    reason: "Partial — has role + choice, no 'so that'",
  },
  {
    input: "TypeScript is better than JavaScript.",
    expected: "low",
    reason: "Bare assertion, no context or evidence framing",
  },
  {
    input: "",
    expected: "reject",
    reason: "Empty input",
  },
];
