# Briefing behavioral specs

Gherkin-style behavioral specs for Soup.net's agent-facing copy — the briefing, the recipe guide, and the MCP tool descriptions. Each scenario pins a design commitment: a persona (Given), a trigger (When), and observable assertions (Then). Design and rationale: [docs/rough-notes/2026-06-10/briefing-regression-testing.md](../rough-notes/2026-06-10/briefing-regression-testing.md); operational contract: [docs/testing-plan.md](../testing-plan.md) Layer 6.

**These files are the spec; the eval repo runs them.** Execution (agent-run harness, judge sub-agents) and outcome data (baseline matrices) live in the separate `SoupNet-evals` repo. Until that harness runs, these files double as the **manual checklist**: paste a scenario's persona input into a fresh agent, run the When-prompt, and check each Then-clause against the transcript yourself.

## The regression rule (once wired)

A PR that touches briefing copy (`packages/domain/src/recipe-guide-content.ts`, the briefing composer, MCP tool descriptions) must **declare which scenarios it intends to change** — name the files/scenarios in the PR description — **re-run the suite, and show every undeclared scenario still holding.** Update the declared scenarios in the same PR. This is the over-correction guard: past briefing edits have been tuned for the issue in front of them with unnoticed consequences for other goals, and a plain text-diff would flag every intended change too (noise, not signal) — declaring intent up front is what turns the diff into something reviewable. Full rationale: [docs/rough-notes/2026-06-10/briefing-regression-testing.md](../rough-notes/2026-06-10/briefing-regression-testing.md) §The problem.

**`@unreleased`** tags a scenario for a capability that doesn't exist yet (see the four files below). These are forward-looking specs for behaviors scoped in the 2026-07-05 work-tree plan — they exist now so the PR that ships the capability can declare and move exactly that scenario, instead of writing the spec and the feature in the same diff. Drop the tag in the same PR that implements the capability.

## Conventions

- **Then-clauses must be observable in the transcript** — a tool call happened or didn't; a string property of the produced recipe; a quiz answer. "Understands" is banned vocabulary everywhere except `comprehension-quiz.feature`, where comprehension is tested via quiz answers as the observable.
- **`# Guards:` comments** trace each Feature/Scenario to its source: a failure mode in `packages/domain/src/recipe-examples.json`, a constant in `recipe-guide-content.ts`, a section of `design-thinking.md`, or a public scenario at `/docs/recipe-scenarios`. Every cataloged failure mode should have at least one scenario; when adding a failure mode to recipe-examples.json, add its scenario here.
- **Personas** (the Given-clauses) are the agent archetypes from design-thinking.md: fresh MCP-capable agent, fresh web-browsing agent (no tool calling), API-integrated harness, reasoning-model-with-hidden-traces. "Fresh" means a context primed with *only* the briefing/guide text — no CLAUDE.md, no memory, no prior conversation.
- **Format is the point, not the toolchain.** Plain `.feature` files, no Cucumber step definitions. The runner is an LLM-eval harness (see the eval repo's runbooks).

## Files

| File | Concern |
|---|---|
| `recipe-voice.feature` | The user's perspective in a transferable role (recipe-level failure modes) |
| `evidence-integrity.feature` | Truthfulness: interpretation, verbatim quote, citation (evidence/reference failure modes) |
| `checking-behavior.feature` | Genuine hypotheses, autonomous timing, the reasoning window |
| `recipe-book-routing.feature` | Who benefits — privacy-narrow defaults, shared-book attribution |
| `divergent-checks.feature` | Selection-as-signal: wait for the user's choice |
| `web-only-agents.feature` | Link emission, identity-based URL formatting, pasted-results handling |
| `comprehension-quiz.feature` | The qa-agent-understanding rubric as scenarios |
| `advanced-workflows.feature` | Decision archaeology, agent fleets, interface fluidity |
| `frontmatter-recipe-lookup.feature` | `@unreleased` — resolving a doc's `soupnet_recipes` frontmatter ids before editing (WT-3) |
| `known-recipes-dedup.feature` | `@unreleased` — `known_recipes` trims repeats in rendering only, never in the logged trace (WT-4) |
| `feedback-loop.feature` | `@unreleased` — feedback chained on the next check, or via `log_feedback` standalone (WT-4) |
| `subagent-purpose-briefing.feature` | `@unreleased` — `purpose`-scoped `get_briefing` for sub-agents, alongside the standard fleet check-instructions (WT-3) |
