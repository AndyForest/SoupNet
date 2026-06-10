# Briefing behavioral specs

Gherkin-style behavioral specs for Soup.net's agent-facing copy — the briefing, the recipe guide, and the MCP tool descriptions. Each scenario pins a design commitment: a persona (Given), a trigger (When), and observable assertions (Then). Design and rationale: [docs/rough-notes/2026-06-10/briefing-regression-testing.md](../rough-notes/2026-06-10/briefing-regression-testing.md); operational contract: [docs/testing-plan.md](../testing-plan.md) Layer 6.

**These files are the spec; the eval repo runs them.** Execution (agent-run harness, judge sub-agents) and outcome data (baseline matrices) live in the separate `SoupNet-evals` repo. Until that harness runs, these files double as the **manual checklist**: paste a scenario's persona input into a fresh agent, run the When-prompt, and check each Then-clause against the transcript yourself.

## The regression rule (once wired)

A PR that touches briefing copy (`packages/domain/src/recipe-guide-content.ts`, the briefing composer, MCP tool descriptions) must declare which scenarios it intends to change, re-run the suite, and show every undeclared scenario holding. Update the declared scenarios in the same PR.

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
