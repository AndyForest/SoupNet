/**
 * QA Test: Fresh Agent Understanding of Recipe Checks
 *
 * Tests whether a fresh AI agent, given only the bootstrap blurb and the
 * recipe guide content, correctly understands the read-with-side-effect
 * model and key nuances of the system.
 *
 * This test does NOT require an LLM API call. It builds the exact text
 * a fresh agent would receive, then defines the comprehension rubric
 * that a human reviewer (or AI agent running this script) uses to evaluate.
 *
 * Run: npx tsx scripts/qa-agent-understanding.ts
 *
 * The script outputs:
 *   1. The exact prompt a fresh agent would receive (bootstrap blurb + guide)
 *   2. A comprehension quiz with expected answers
 *   3. Red-flag phrases that indicate the agent misunderstands
 *
 * A human dev or AI agent then gives the prompt to a fresh LLM session
 * and checks the responses against the rubric.
 */

import {
  BOOTSTRAP_BLURB,
  HOW_THIS_WORKS,
  FOR_AI_AGENTS,
  WHEN_TO_CHECK,
  TASTE_VS_JUDGMENT,
  RECIPE_FORMAT,
  EVIDENCE_FORMAT,
  RECIPE_EXAMPLES,
  RELATED_EVIDENCE_IS_NEUTRAL,
  RESPONSE_SIZE_CONTROL,
  TIPS,
} from "../packages/domain/src/recipe-guide-content.js";

// ── Build the exact text a fresh agent receives ────────────────────────────

const examples = RECIPE_EXAMPLES.map((r, i) =>
  `${i + 1}. ${r.label}:\n   Recipe: ${r.recipe}\n   Supporting evidence: ${r.evidenceFor}${r.quote ? `\n   > "${r.quote}"` : ""}${r.source ? `\n   -- ${r.source}` : ""}${r.explanation ? `\n   (${r.explanation})` : ""}`
).join("\n\n");

const triggers = WHEN_TO_CHECK.triggers.map((t, i) =>
  `${i + 1}. ${t.label.toUpperCase()} — ${t.detail}`
).join("\n");

const tips = TIPS.map((t) => `- ${t}`).join("\n");

const guideText = `Soup.net Recipe Check Guide

${HOW_THIS_WORKS.title.toUpperCase()}
${HOW_THIS_WORKS.text}

${FOR_AI_AGENTS.title.toUpperCase()}
${FOR_AI_AGENTS.text}

${WHEN_TO_CHECK.title.toUpperCase()}
Three common triggers:
${triggers}

${WHEN_TO_CHECK.framing}

${TASTE_VS_JUDGMENT.title.toUpperCase()}
${TASTE_VS_JUDGMENT.taste}
${TASTE_VS_JUDGMENT.judgment}
${TASTE_VS_JUDGMENT.summary}

${RECIPE_FORMAT.title.toUpperCase()}
Preferred: "${RECIPE_FORMAT.preferred}"
Simple taste: "${RECIPE_FORMAT.simple}"
Key: ${RECIPE_FORMAT.key}

${EVIDENCE_FORMAT.title.toUpperCase()}
${EVIDENCE_FORMAT.template}

EXAMPLES
${examples}

${RELATED_EVIDENCE_IS_NEUTRAL.title.toUpperCase()}
${RELATED_EVIDENCE_IS_NEUTRAL.text}

${RESPONSE_SIZE_CONTROL.title.toUpperCase()}
${RESPONSE_SIZE_CONTROL.text}

TIPS
${tips}`;

// ── Comprehension rubric ───────────────────────────────────────────────────

interface RubricItem {
  id: string;
  question: string;
  expectedNuances: string[];
  redFlags: string[];
}

const rubric: RubricItem[] = [
  {
    id: "read-vs-write",
    question:
      "Describe what happens when you call check_recipe. Is it a read operation, a write operation, or something else?",
    expectedNuances: [
      "Describes it as a search/read that also logs as a side effect",
      "Mentions the logging is append-only (no destructive writes)",
      "Conveys that checking is low-friction and should be done freely/often",
      "Understands that the side-effect logging makes future searches better (stigmergy)",
    ],
    redFlags: [
      "Describes it primarily as a WRITE operation",
      "Says the agent needs to be careful/cautious about checking",
      "Implies checking requires user permission or confirmation",
      "Treats the logging as the primary purpose rather than the search",
      "Uses alarming language about 'permanent writes' or 'polluting'",
    ],
  },
  {
    id: "whose-perspective",
    question:
      "If a user tells you 'I think Tailwind is better than vanilla CSS for this project', how would you write the recipe?",
    expectedNuances: [
      "Writes from the human user's perspective, not 'As an AI agent'",
      "Uses the user's actual words or close paraphrase as evidence",
      "Includes a role/context for the user (e.g., 'As a developer')",
      "Includes a 'so that' reason if one can be inferred",
    ],
    redFlags: [
      "Writes 'As an AI agent, I recommend...'",
      "Fabricates evidence not grounded in the user's statement",
      "Strips the user's reasoning and replaces with generic claims",
    ],
  },
  {
    id: "anti-pattern",
    question:
      "You want to find out if the user has any preferences about database ORMs. How would you check?",
    expectedNuances: [
      "Forms a genuine hypothesis based on observable evidence (e.g., project uses Drizzle)",
      "Does NOT fabricate a preference just to search for ORM recipes",
      "May use filter parameter for keyword narrowing as an alternative",
      "Understands that checking a recipe you don't believe degrades future searches",
    ],
    redFlags: [
      "Writes 'As a user, I prefer Prisma' just to search for ORM-related results",
      "Treats check_recipe as a keyword search with recipe-shaped queries",
      "Shows no awareness that a false recipe has negative consequences",
    ],
  },
  {
    id: "frequency",
    question:
      "How often should you check recipes during a typical work session?",
    expectedNuances: [
      "Frequently — before tasks, during judgment calls, after completing work",
      "Autonomously, without needing to ask the user each time",
      "As side effects of normal work, not as a separate research phase",
      "Uses max_chars or clusters to keep responses concise when context is tight",
    ],
    redFlags: [
      "Rarely or only when explicitly asked",
      "Only for major decisions, not routine work",
      "Suggests asking the user before each check",
      "Treats recipe checking as a heavyweight operation",
    ],
  },
  {
    id: "evidence-quality",
    question:
      "What makes good evidence for a recipe? Give an example of good and bad evidence.",
    expectedNuances: [
      "Direct quotes from the user or their artifacts",
      "Concrete observations (config files, code patterns, past choices)",
      "Source citations pointing to verifiable origins",
      "Distinguishes between assumption-surfacing (indirect evidence) and stated preferences (direct quotes)",
    ],
    redFlags: [
      "Generic claims like 'based on best practices'",
      "Fabricated quotes or sources",
      "Restating the recipe as evidence (circular)",
      "No awareness that evidence quality matters differently for assumptions vs stated preferences",
    ],
  },
];

// ── Output ─────────────────────────────────────────────────────────────────

console.log("=".repeat(72));
console.log("QA TEST: Fresh Agent Understanding of Recipe Checks");
console.log("=".repeat(72));

console.log("\n--- STEP 1: Give this to a fresh LLM session (no other context) ---\n");
console.log("SYSTEM/USER PROMPT:");
console.log("-".repeat(40));
console.log(BOOTSTRAP_BLURB.text);
console.log("\n--- The agent calls get_briefing and receives: ---\n");
console.log(guideText);

console.log("\n\n--- STEP 2: Ask these questions and evaluate responses ---\n");

for (const item of rubric) {
  console.log(`\n[${ item.id.toUpperCase() }]`);
  console.log(`Q: ${item.question}`);
  console.log("\nExpected nuances (should see most of these):");
  for (const n of item.expectedNuances) {
    console.log(`  + ${n}`);
  }
  console.log("\nRed flags (any of these indicates misunderstanding):");
  for (const f of item.redFlags) {
    console.log(`  ! ${f}`);
  }
  console.log();
}

console.log("=".repeat(72));
console.log("SCORING");
console.log("=".repeat(72));
console.log(`
For each question, score:
  PASS  — Response hits 3+ expected nuances, zero red flags
  SOFT  — Response hits 2+ expected nuances, zero red flags
  FAIL  — Any red flag present, OR fewer than 2 expected nuances

Overall:
  5 PASS        — The docs are working. Agent groks the system.
  4 PASS + 1 SOFT — Acceptable. Minor gaps, but core understanding is there.
  Any FAIL      — The docs need revision. Note which question failed and what
                  red flag appeared — that's the specific misunderstanding to fix.

Key insight: The 'read-vs-write' question is the most diagnostic. If the agent
describes recipe checks as primarily a write operation that requires caution,
the read-with-side-effect framing hasn't landed. If it describes them as
low-friction reads that happen to leave traces, the framing is correct.
`);
