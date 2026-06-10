# Briefing Regression Testing — Behavioral Specs for Agent-Facing Copy

> **Status:** Rough note (2026-06-10) — proposal, not adopted. Expands the backlog item "Regression-test system for briefing tweaks" into a buildable plan. Promote to `docs/planning/` when the operator validates the approach.
>
> **Related:** [design-thinking.md](../../design-thinking.md) (§Reasoning-Trace Gap motivates the next briefing iteration; §Agent Archetypes are the personas), `packages/domain/src/recipe-examples.json` (failure-mode taxonomy), `scripts/qa-agent-understanding.ts` (existing prompt-builder + rubric), `packages/domain/src/embedding-strategies.ts` (multi-strategy embedding pipeline — Track 2's measurement engine), [transcript-mining-briefing.md](transcript-mining-briefing.md) (source-material channel from live sessions), `docs/backlog.md` §Agent briefing.

## The problem

The briefing is shipped to every agent session and is highly sensitive to wording. Past edits have **over-corrected**: tuned for the current issue, with unnoticed consequences for other goals (operator-reported pattern, 2026-06-10). Today the only guard is manual testing across seven agent products — slow, skipped under pressure, and a snapshot text-diff would flag every intended change too (noise, not signal).

What we need is a **behavioral diff**: a briefing edit should state which behaviors it intends to move, and demonstrate that every other specified behavior held.

## Why Gherkin

We already think in structured argumentation (Toulmin: claim / warrant / data) and in personas and scenarios (Design Thinking — the agent archetypes). Gherkin's Given / When / Then is the same family of discipline applied to expected behavior, and it gives us:

- **Consistency** — every expectation has a persona (Given), a trigger (When), and observable assertions (Then). No vague "the agent should understand X."
- **A single source of truth** — feature files generate both the headless runs and the manual checklists for agents we can't automate.
- **Reviewability** — a briefing PR that changes behavior shows up as a scenario diff a human can argue with.

We adopt the Gherkin *format*, not necessarily the Cucumber *toolchain* — the runner is an LLM-eval harness, not step-definition glue code. Plain `.feature` files parsed with a lightweight parser (or even front-matter'd markdown) are enough.

## What exists to build on

| Asset | What it gives the system |
|---|---|
| `packages/domain/src/recipe-examples.json` | A curated failure-mode taxonomy (`agent_voice`, `user_name_voice`, `group_implied_product`, …) with ranked, dimension-tagged examples. Each failure mode becomes at least one scenario; the examples are the test fixtures. |
| `scripts/qa-agent-understanding.ts` | Already builds the exact text a fresh agent receives and defines a comprehension rubric + red-flag phrases. This is phase-0 of the runner — it just lacks execution and scoring. |
| `docs/recipe-scenarios` (public) | Annotated good/bad conversations — source material for When-clauses. Currently minimal (see §Source material below for the expansion plan). |
| Agent archetypes (design-thinking.md) | The Given-clause personas: MCP-capable, web-browsing link-emitter, API-integrated, reasoning-model-with-hidden-traces. |
| `packages/domain/src/embedding-strategies.ts` + the strategy-sweep worker pipeline | Six live embedding strategies — two searched (`full_document`, `full_recipe_context`), four experimental preamble variants — generated **concurrently for every trace**, auto-backfilled when a new strategy ID is added, comparable per-strategy on the recipe map. The concurrent-generation engine Track 2 measures with. |
| The operator's real recipe books + check log | Real checks with known outcomes, made during real work — minable (PII-scrubbed) into scenarios and matched-pair sets. Operator approved 2026-06-10. |

## Source material — expanding the scenario corpus

The public `recipe-scenarios` page has six scenarios (A–F). They're strong on the core mechanic (check-as-search, assumption vs stated preference, discovery shape) but thin as a behavioral-spec source: nearly every scenario is a solo software developer on an MCP-capable agent, and the two long walkthroughs (E, F) are success-only. Operator direction (2026-06-10): grow this into thorough coverage of the distinct user types — humans *and* AIs — their diverse work and goals, and edge cases on either side of success.

Note the dual purpose: the scenario corpus is live agent-facing content (served at `/docs/recipe-scenarios`), not just test fixtures. Expanding it improves agents today, and the existing rule holds — add the scenario to the public file first, then distill into the guide (design-thinking.md §Recipe Check Scenarios).

**Coverage matrix.** Borrow the checklist discipline already proven in `recipe-examples.json`: every scenario is dimension-tagged, and the library is reviewed for thin cells rather than grown ad hoc.

- **Human archetypes** (design-thinking.md §User Archetypes): solo user, recipe-book collaborator, self-hosted user, first adopter, AI-reluctant collaborator. Today only 1, 2, and 4 appear, and the AI-reluctant collaborator only implicitly (Marcus in Scenario E).
- **Agent archetypes:** MCP tool-connected, web-browsing link-emitter, API-integrated, reasoning-model-with-hidden-traces. Today: no API-integrated scenario, and no reasoning-window scenario — the §Reasoning-Trace Gap commitment (check at the judgment moment, not session end) has no annotated conversation behind it. The API-integrated cell can be **super light** (operator, 2026-06-10): it's not a distinct workflow, it's MCP's fallback twin — same conceptual surface, different interface; a problem-solver / rosetta stone. One short scenario suffices, and the operator's real case is the candidate: mid-session the API key rotates, the MCP connection's auth goes stale, and the agent seamlessly switches to `/check?format=json` with the new key instead of making the user restart the session. The judgment to illustrate is *interface fluidity* — the agent doesn't care which surface it's on, and shouldn't.
- **Domains** (the nine in `recipe-examples.json`): software, creative arts, hobbies/crafts, education, wellness, volunteer/community, small business, family/parenting, lifestyle. Today: software, volunteer, and one creative hobby.
- **Both sides of success.** Each covered cell wants a paired shape: the success, and the adjacent failure or near-miss an agent could plausibly produce. The recipe-level failure modes are already taxonomized in `recipe-examples.json`; what scenarios uniquely add are **interaction-level** failures with no coverage anywhere yet: wrong recipe-book routing (personal taste leaking into a shared book and vice versa), pre-checking divergent candidates before the user chooses, over-checking noise (ten near-duplicate checks in one session), treating returned recipes as directives instead of data, handling a stale recipe without the correction workflow, decision archaeology with a wrong or missing `decided_at`, and the fleet case (a sub-agent that worked without checking, invisibly). Scenarios A, C, D already do failure→fix; E and F need failure-side companions.

**Mining real corpora (operator-approved 2026-06-10).** The soupnet-oss and soup-net-development recipe books — and the operator's check log — are real source material: actual checks with known outcomes, made during real work. The workflow:

1. An agent sweeps a book (or a time slice of the check log) and pulls candidate situations: checks that demonstrably helped later sessions, checks that never resurfaced, malformed checks, and judgment calls visible in the work that were never checked at all.
2. PII/context scrub by **substitution, not deletion** — the same rule as the voice guidance: real names → functional roles, project proper nouns → functional equivalents, private quotes/URLs → synthetic but structurally identical stand-ins. The scenario keeps the real shape of the interaction; nothing in it traces back.
3. **Operator interview loop:** for each mined situation, ask the operator what the actual goal was at that moment — did the check (or its absence) serve it? Was the wording optimal? What was missing? The answers are the ground truth the scenario's annotation asserts. This is the cheap, high-signal step that makes scenarios validated against real intent rather than agent guesses about intent.

**Transcript mining as a parallel channel.** [transcript-mining-briefing.md](transcript-mining-briefing.md) is a paste-ready briefing the operator hands to other live Claude Code sessions: mine your own transcript for judgment calls — which were checked, which weren't, what you'd have wanted a recipe check to return that it didn't, and why — then report PII-scrubbed findings, candidate scenarios, and system-improvement suggestions. This is the [agent-first-knowledge-base.md](agent-first-knowledge-base.md) feedback loop (synthetic demonstrations, distilled at the source) applied to ourselves first, manually, before any of it is productized.

## The spec format

```gherkin
Feature: Recipe voice
  # Guards: ROLE_PATTERNS (recipe-guide-content.ts); failure modes agent_voice,
  # user_name_voice, group_implied_product (recipe-examples.json)

  Scenario: Project-book write keeps a transferable role
    Given a fresh MCP-capable agent primed with the unified briefing
    And write access to a recipe book described as "Soup.net development"
    When the user states a backend framework preference and the agent logs it
    Then the recipe role is a transferable functional role
    And the role does not restate the project name or the user's name
    And the evidence quotes the user's actual words with a source citation

Feature: Concurrent checking inside the reasoning window
  # Guards: design-thinking.md §Reasoning-Trace Gap — the judgment-call moment
  # is the only checking moment inside the model's reasoning window.

  Scenario: Judgment call is checked when it happens, not at session end
    Given a fresh MCP-capable agent primed with the unified briefing
    And a coding task containing an embedded library-choice judgment call
    When the agent works the task
    Then it calls check_recipe at the judgment moment, before announcing the decision
    And the recipe's evidence carries the live deliberation, not a post-hoc summary

  Scenario: Web-only agent does not attempt to fetch URLs
    Given a fresh web-browsing agent (no tool calling) primed with the briefing
    When it reaches a judgment call
    Then it emits 2-4 divergent clickable recipe-check links with full recipe text
    And it does not claim to have performed a check itself
```

Then-clauses must be **observable in the transcript** (a tool call happened / didn't; a string property of the produced recipe). "Understands" is banned vocabulary — comprehension is tested via the qa-script quiz scenarios whose Then-clauses assert quiz answers.

## The runner

**The runner is an AI coding agent following a runbook, not a service** (operator, 2026-06-10). No LLM API calls get added to this codebase — the product makes no LLM generations and shouldn't grow the dependency for its tests. An orchestrating coding-agent session (e.g. Claude Code) executes the suite using its own model access and sub-agents; anything scripted lives in the eval repo (§Where this lives).

1. **Compose** — build the persona's exact input. Prefer fetching it from a running stack (the briefing endpoint and `/docs` pages on the `docker-compose.ci.yml` stack) over re-building text from domain exports — it tests exactly what agents receive, composer included, and cannot drift. The `qa-agent-understanding.ts` pattern (compose-only, zero LLM calls) is fine to keep in the product repo.
2. **Execute** — run the When-prompt against the persona's agent:
   - *Agent-run (default):* the orchestrator spawns each persona as a **fresh sub-agent context** primed with only the persona's input (MCP tools pointed at the isolated CI stack, throwaway recipe book), or drives another installed CLI agent headlessly where the persona calls for one (e.g. Codex CLI for a non-Claude persona).
   - *Manual fallback:* Gemini / ChatGPT / Claude web get a generated checklist (same feature files rendered as copy-paste prompt + human-checkable Then-list).
3. **Judge** — judge sub-agents (fresh contexts, separate from the personas) score each Then-clause against the transcript: `pass | fail` + the quoted span that decides it. Structured output, one verdict per clause; optionally 3-vote majority for flaky clauses.
4. **Report** — scenario × agent matrix, committed to the eval repo as the baseline (§Where this lives).

**The regression rule:** a PR that touches briefing copy (`recipe-guide-content.ts`, briefing composer, tool descriptions) must declare which scenarios it intends to change, re-run the suite, and show every undeclared scenario holding. That is the over-correction guard — informed, precise, concise changes to the right spots, with the rest pinned.

## What this is not

- **Not part of `test:ci`.** LLM runs cost money and are nondeterministic; the gate stays deterministic. This suite runs nightly and/or manually before briefing-touching commits. It *is* documented as a testing layer, though — `docs/testing-plan.md` Layer 6 — because these are tests, just not CI-path ones.
- **Not a text snapshot.** Wording may change freely as long as behavior holds.
- **Not a benchmark.** Scenarios assert our own design commitments, not model capability.

## Where this lives — eval repo and outcome data

Operator constraints (2026-06-10): no LLM API calls in this codebase, now or via test tooling; eval scripts isolated somewhere; outcome data does not belong in the product DB; leaning toward a separate "eval" / "AI Data Science" repo (the pattern that worked at Scratch — experiments and evals isolated from the main codebase); a LiteLLM-class eval framework is too heavy, especially since the product itself does no LLM generations.

**Proposed split (recommendation, not yet operator-confirmed): specs with the product, execution and data in the eval repo.**

- **Product repo keeps the specs** — the `.feature` files (`docs/briefing-specs/`) and the scenario corpus. They are design commitments pinned to the briefing copy that lives here, and the declared-intent regression rule works best when a briefing-touching PR can update the scenario it declares **in the same diff**. Specs are documents, not scripts — they don't violate the isolation rule. Compose-only helpers with zero LLM calls (`qa-agent-understanding.ts`) also stay.
- **Eval repo (e.g. `soupnet-evals`) holds everything that executes or measures:** runbooks the orchestrating agent follows, persona definitions, matched-pair generation and Track 2 scoring, rubric definitions, and **all outcome data**. It treats the product as a black box reached through its real surfaces — the `docker-compose.ci.yml` stack, `/mcp`, `/check`, the briefing endpoint — which is both cleaner and more faithful (it tests what agents actually receive).
- **The boundary rule, one line:** anything that calls an LLM or stores an eval outcome lives in the eval repo; the product repo never gains an LLM dependency. This extends "zero LLM on the server" (design principle #2) to the repo level.
- The alternative (specs in the eval repo too) keeps the product repo maximally clean but makes the declared-intent rule a cross-repo convention — weaker than a same-diff review. Operator call.

**Outcome data: committed files in the eval repo, not gitignored, not the product DB.** Baselines are the point of a regression suite — "show every undeclared scenario holding" requires the prior baseline to diff against, so the scenario × agent matrices and Track 2 measurements are small committed JSON/markdown with run metadata (date, model, briefing version/commit). Bulky raw run transcripts can be gitignored or kept as run artifacts. The product DB stays out of it: eval runs are data *about* the product, not user data, and eval bookkeeping tables would pollute the migration history for no runtime benefit.

**No eval framework.** Agreed that LiteLLM-class tooling is the wrong weight: the runner is an agent following a runbook, the judge is a sub-agent, and the artifacts are files. Plain files + sub-agents until something measurably hurts.

Until the eval repo exists, phases 1–2 (pure writing) land in the product repo as planned; the eval repo gets bootstrapped at phase 3 when the first execution artifact appears.

## Track 2 — Retrieval-quality regression (embedding hypotheses)

Behavioral specs (the track above) test what agents *do* with the briefing. A second track tests what the corpus *returns* — because the authoring guidance itself rests on embedding hypotheses that have never been measured, only reasoned about.

### The measurement engine already exists — embedding strategies

This track does not start from zero. The codebase already generates multiple embeddings per recipe **concurrently**, under named strategies (`packages/domain/src/embedding-strategies.ts`):

- **Searched today:** `full_document` (trace text only, sync) and `full_recipe_context` (trace + evidence + references, async) — at query time the HNSW search spans all strategies and the best score per trace wins (`vector-search.service.ts`).
- **Experimental preamble variants, generated for every trace but map-only:** `exp_trace_minimal`, `exp_trace_instructed` (instruction prefix naming the recipe format), `exp_trace_evidence_headed` / `exp_trace_evidence_weighted` (sectioned vs PRIMARY/SECONDARY-weighted composition), `exp_full_headed` / `exp_full_weighted` (same with references).
- **Zero-friction iteration:** adding a new hypothesis-bearing preamble is a code-only change (new strategy ID + builder in `buildStrategyText()`); the `strategy-sweep` worker detects the missing strategy and auto-backfills the entire corpus — no migration. Per-strategy comparison is live on the recipe map (`/traces/map?vectorStrategy=...`), and the briefing composer accepts a `strategy` param, so exemplar selection itself can be pinned to a variant under test.

What's missing is exactly what this track supplies: the experimental strategies have never been *scored* — today's comparison is eyeballing map clusters (the hypothesis behind them, "evidence dilutes clustering," is stated in `search-algorithms.md` §Experimental Embedding Strategies with a manual-evaluation plan that was never run). So Track 2 has **two interacting measurement axes**, both running over the same corpus concurrently:

1. **Authoring-side** (hypotheses 1–6 below): what text the agent writes — role terms, goal clauses, jargon.
2. **Embedding-side**: which preamble/composition the pipeline wraps that text in — each `exp_*` strategy is itself a standing hypothesis ("an instruction prefix sharpens clustering," "weighted composition keeps evidence from diluting the claim") scored by the same matched-pair method.

The axes interact — a jargon rule measured under `full_document` may wash out under `full_recipe_context`, where evidence dominates the embedding — so matched-pair runs report **per-strategy**. And the deliverable widens accordingly: findings don't just tune authoring guidance, they decide which strategies graduate into the search path (today hardcoded to two) and which preamble becomes the default. That closes the loop the experimental strategies were built for, and it means the embedding approach itself becomes iterable under the same regression discipline as the briefing copy.

The motivating case (operator, 2026-06-10): is **"As a product owner"** the right role term? It's ambiguous — the product owner for software and the product owner for shoes are different jobs, yet sometimes their judgments genuinely overlap (narrative structure, customer empathy), so cross-domain retrieval might be a feature. And the rest of the recipe (goal clause, claim, reason) may "point" the embedding toward the right neighborhood anyway. Every clause of that is a testable hypothesis, and the corpus now has enough real recipes to test against — plus the recipe shape makes synthetic data cheap to generate.

Hypotheses worth pinning (each becomes a measured assertion, re-run when the embedding model or authoring guidance changes):

1. **Goal dominates role.** Two recipes sharing a role term but differing in domain ("product owner shaping a landing page" vs "product owner choosing shoe materials") land farther apart than two recipes sharing a domain with different role terms. If false, ambiguous role terms actively pollute retrieval and the briefing should steer toward more specific roles.
2. **Useful cross-domain transfer survives.** A judgment that genuinely transfers (e.g., "open with the challenge before the solution") still retrieves across domains when the role matches, even with different goals. If goal *fully* dominates, we lose the transfer the role pattern was designed for — the guidance needs a stated balance, not a slogan.
3. **Proper-noun substitution helps as claimed.** ROLE_PATTERNS asserts proper nouns cluster weakly and functional substitutions retrieve better ("Soup.net maintainer" → "MCP server maintainer"). Measure: top-k retrieval overlap for matched pairs differing only in that substitution.
4. **Verb-form role collapse hurts as claimed.** "As an author authoring docs..." vs role + separate goal — the briefing says the former clusters worse. Measure it.
5. **Broadly-known jargon is high-density signal (operator hypothesis, 2026-06-10).** Jargon may be the "short form" that produces rich embeddings while staying readable to AI-first users — *if* it's broadly known, present in training material, and unambiguous in itself. The boundary to pin: jargon that requires context **not present in the embedding text** (or unknown to the embedding model) should hurt retrieval, while self-contained jargon ("ANN search", "Toulmin warrant", "tsvector") should sharpen it. Matched pairs: same recipe with jargon term vs spelled-out paraphrase vs context-dependent insider term (codename-grade). If confirmed, the briefing gains a concise jargon rule with the measured boundary.
6. **In-context sense disambiguation (polysemy).** "...for an agent memory system" — does the embedding place this with *AI* agents rather than real-estate or chemical agents? A human disambiguates from surrounding content; contextual transformer embeddings *should* too, but "should" is the thing this track exists to replace. Probe set: polysemous terms our corpus actually uses (agent, recipe!, trace, book, pipeline, container) embedded in (a) rich context, (b) minimal context, (c) adversarial context, plus distractor recipes from the wrong sense — measure whether wrong-sense distractors invade top-k. Note the deliciously recursive case: Soup.net's own "recipe" vocabulary is a cooking metaphor; does the corpus cluster away from actual cooking recipes? It should — and a user with a real cooking recipe book is a realistic future collision.

Method: matched-pair recipe sets — real corpus recipes plus synthetic variants where exactly one clause varies — embedded with the production pipeline **across all active strategies** (stub provider for plumbing, real Gemini for the actual measurements), scored by top-k retrieval overlap and cosine-neighborhood composition against held-out query recipes, reported per-strategy. Synthetic variants live in the isolated CI stack (`docker-compose.ci.yml`) or a dedicated throwaway recipe book — never the production corpus (prior recipe, 2026-04-01: iterate on ranking without polluting the database with test data). **Synthetic edge-case generation is agent work:** an agent takes each real recipe and generates the perturbation set around it (role swaps, jargon swaps, sense-collision distractors), so the suite grows with the corpus rather than being hand-curated.

**Findings flow forward, gated:** measured results distill into concise authoring knowledge in the briefing — "this corpus is embedded with gemini-embedding-2-preview; these specific things matter" — extending the existing "Authoring for retrieval" principle from mechanism-description to measured guidance. Every such edit still goes through Track 1's declared-intent rule: a guidance change motivated by Track 2 data has to show the behavioral scenarios holding. Longer term, findings could be injected per-recipe-book (matched by book description + contents via the existing semantic-similarity subsystems) — see [agent-first-knowledge-base.md](agent-first-knowledge-base.md).

## Track 3 — Whole-transcript analysis (idea stage)

Tracks 1–2 test the system's *outputs* (agent behavior, retrieval quality) in constructed settings. The fullest artifact of how the system actually performed is the whole agent chat transcript — every judgment call, every check made or missed, embedded in real work. Operator direction (2026-06-10): explore adding whole transcripts to this testing system as analyzable artifacts.

What a transcript can answer that no constructed scenario can:

- **Timing fidelity** — were checks made inside the reasoning window (at the judgment moment) or batched at session end? Only observable in real, long sessions (§Reasoning-Trace Gap).
- **Coverage ratio** — judgment calls visible in the transcript vs checks actually made. The denominator no scenario suite has.
- **Utility** — did returned recipes change what the agent did next, or get acknowledged and ignored?
- **The counterfactual gap** — what the agent would have wanted a check to return but didn't get. The highest-value input for authoring guidance and future KB entries.

**Rubric: a fixed spine + a generated extension.** Each chat has different goals, so a single static rubric under-measures. Two layers:

1. **Fixed best-practice spine** — identical for every transcript, comparable across runs: *reproducibility* (could another agent re-derive the judgment from the logged recipe alone?), *calibration* (does the recipe's confidence match its evidence quality — "I chose" backed by a quoted decision vs "I prefer" on one weak signal?), *coverage ratio*, *timing* (in-window vs batched), *voice compliance* (the `recipe-examples.json` failure modes).
2. **LLM-generated per-transcript extension** — the judge first extracts the chat's actual goals from the transcript, generates goal-specific criteria ("for this refactoring session, did checks capture the API-design tradeoffs the user weighed?"), then scores both layers. Generated criteria are recorded alongside the scores so a human can audit the rubric, not just the verdict.

The judge harness is shared with Track 1 — Then-clause scoring and rubric scoring are the same structured-verdict shape (`pass | fail` + deciding quoted span), so one LLM-judge module serves both.

**Privacy stance (a constraint, not an implementation detail):** transcripts are the most PII-laden artifact in the entire system. Analysis runs client-side, by the user's own agent over its own transcripts — the same posture as the [agent-first KB feedback loop](agent-first-knowledge-base.md): distillation and de-identification happen at the source; only synthetic demonstrations and scrubbed findings cross to anyone else. Raw transcripts are never submitted to Soup.net or stored in the test suite. The [transcript-mining briefing](transcript-mining-briefing.md) is this track's manual, present-day form; if it proves out, the harness form is a `scripts/transcript-rubric.ts` judge an operator points at their own transcript directory.

Findings flow the same way as Track 2's: confirmed transcript findings become Track 1 scenarios (a real-world When-clause), Track 2 authoring hypotheses, or KB candidates — all through the declared-intent gate before any briefing copy moves.

## Phasing

1. **Encode** — translate `recipe_failure_modes` + the qa-script quiz + the §Reasoning-Trace Gap commitments into `.feature` files under `docs/briefing-specs/` (or `tests/briefing-specs/`). Pure writing; immediately useful as the manual checklist even before any runner exists.
2. **Expand the scenario corpus** — coverage-matrix pass on `recipe-scenarios` (§Source material): mine the real recipe books, run the operator interview loop, hand the transcript-mining briefing to live sessions. Pure writing + interviews; feeds phase 1's feature files and improves live agents immediately.
3. **Bootstrap the eval repo + run one persona** — create `soupnet-evals` with the first runbook; an orchestrating Claude Code session runs one persona (fresh sub-agent against the CI stack), judge sub-agents score, and the first baseline matrix is committed there. No code lands in the product repo for this phase.
4. **Add personas** — additional sub-agent personas and any installed CLI agents the orchestrator can drive (e.g. Codex CLI); generated manual checklists for web agents.
5. **Wire the regression rule** — a runbook in the eval repo (run by an agent, not a script in this codebase) + a CONTRIBUTING note (and CLAUDE.md pointer) making the declare-intended-changes step part of the briefing-edit workflow, with the baseline diff coming from the eval repo.
6. **Track 2 scoring** — matched-pair generation + per-strategy scoring over the existing strategy set, run from the eval repo against a local stack (stub for plumbing, Gemini for measurements); first measured verdicts on the six standing hypotheses and the `exp_*` preambles; graduation decision for the search path.
7. **Track 3 pilot** — run the two-layer rubric over one of the operator's own transcripts (client-side); evaluate whether the generated-rubric layer earns its complexity before any harness is built.
