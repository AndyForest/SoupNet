# Ranking simplification — pure-function ranking, session-aware rendering, relevance-bounded pool

**Status**: implemented 2026-07-17 (operator approved same day; see [ranking-changelog.md](../architecture/ranking-changelog.md) for the retirement record and [ranking-simplification-evals-update.md](ranking-simplification-evals-update.md) for the evaluation-workstream handoff). Replaces v1 of this document and supersedes the echo-demotion direction entirely. Operator rulings this rests on: recipes `9067ca1b` (inputs-only ranking, rendering-layer novelty), `ebdc6ad7` (pollution is benchmark hygiene), `4d25aec9` (sub-agent cross-communication showstopper), `bb952d78` (window caps diversity).

## The contract (two clean seams)

**Seam 1 — ranking is a pure function.** *"The sum of the inputs to the recipe check should be all that influences the results. Holds true even if we add reranking layers later with reranking models or LLMs, etc."* (Andy, 2026-07-17). Results are a deterministic function of (the check's explicit inputs) × (corpus state) × (versioned algorithm). No hidden identity state ever reorders or hides anything — a recipe missing from results can only mean it isn't relevant enough or was deleted, never *"is it just gone because I submitted it?"* (Andy, 2026-07-17).

**Seam 2 — session awareness is rendering, not ranking.** *"It's just sessionIDs so we can optimize and omit the full recipes that it already knows. It's optional, it's just token efficiency optimization."* (Andy, 2026-07-17). Already-known recipes keep their rank and stay visible — they render as id-stubs (id + gist, fetchable via `get_recipes`), and the freed display budget backfills with the next results in line: *"we could just return the ID instead, and then crucially, return the full text of the next recipe in line."* (Andy, 2026-07-16). The session id is an opaque token in the client's hands, so sub-agent inheritance is the orchestrator's choice — hand the token to a child to share the known-set, or don't; the server has no inheritance policy.

**Seam 3 — benchmark hygiene is the benchmark's job.** *"'pollution' is actually the system working as intended for normal use. I think our benchmark hygiene is just bad, and we're not deleting data we should be before a fresh run, or re-using users for what should be isolated agents... it's something to solve in the benchmark design."* (Andy, 2026-07-17). The product provides isolation primitives (users/books per agent, export/import rewind, account deletion, the read-only `filter` path); run isolation is evals-side responsibility. Evidence reclassified under this ruling, kept on the record: the measured cross-run degradation (*"accuracy fell 0.706 → 0.538 over five runs"*, [benchmarks.md](../benchmarks.md)) and the R1 A/B that reproduced it (recipe `cde0353d`, n=420/arm) — both are one agent re-using one corpus across runs, i.e. the hygiene shape, not normal use.

## What gets deleted (the simplification)

All shipped default-OFF and never flipped, so removal is behavior-neutral for every user:

- Echo demotion: the scoring-stage reorder, `EchoSuppressionConfig`/penalty math in `packages/domain/src/ranking.ts`, `applyEchoSuppression` + `EchoContext` in vector-search, the `echoPenalties` plumbing.
- The curation-exemption flags and their lazy corroboration counts (`isCurated`, reaction/cross-feedback subselects) — they existed to protect recipes *from demotion*; no demotion, nothing to exempt. (Reinforcement/decay, when they come, re-enter through the hypothesis register as ranking levers measured in their own right.)
- The `demotion-adjusted-mass` cluster-ordering lever and `memberWeights` ordering (demotion-derived mass has no basis without demotion).
- The `echo_suppress` request param on `/check` and the `system_settings.echoSuppression` setting.
- Harness surface tied to the above: demotion/exemption Layer A tests, the echo-on/echo-on-mass eval variants, echo-share thresholds (waterfall metrics survive where they measure display composition generally).
- `data.ranking` shrinks accordingly (version + clusterPool remain). Changelog entry records the retirement; no version mint (no shipped behavior changes).

What stays untouched: retrieval (all matches, exact count, honest raw scores), clustering-to-budget (`clusters`/`max_chars`), evidence discovery, concept axes, the version block, the config/versioning/changelog discipline, the harness machinery, `CandidateSignals` slimmed to what rendering and display need (`sessionId`, `decidedAt`).

## What gets built

**1. Session ids — one column, no table.** `traces.session_id` (nullable, indexed with `created_at`). The token has no security weight — it only compresses the holder's own responses — so no sessions table, no validation, no sweeper: `get_briefing` and check responses suggest a fresh uuid when none was presented (self-healing), deposits stamp whatever the caller presented, and the known-set query is `session_id = ? AND created_at > now() - interval '7 days'`. Optional on every surface.

**2. Known-set rendering with budget backfill.** Known-set = this session's deposits ∪ the caller's `known_recipes` ids (the shipped client-side channel — statement 5's shape — which today stubs but does not backfill; this fixes that). Known results render as stubs in place at their true rank; the response includes additional next-in-line results so the display budget is spent on novel content. Applies to exemplars and flat mode alike.

**3. Relevance-bounded clustering pool.** The pool extends down the ranking by score distribution — within-δ-of-top or largest-gap, whichever sweeps better — rather than any fixed count: fixed caps are fixture-relative (measured 2026-07-17: `fixed:100` on a 45-trace corpus degenerated to whole-corpus and got worse) and *"a single global cutoff is inherently brittle"* ([Tail-Aware Adaptive-k, pool-sizing memo](ranking-research/candidate-pool-sizing.md)). Implementation sanity limits (the ANN candidate constants) are our own tunables, revisited with the lever — not design constraints. `per_page` returns to meaning only the flat mode's page.

## Measurement (simplified)

Metrics: relevance (whole-list NDCG + recall), diversity (aspect coverage), stability guardrail (tau on unaffected queries), **sibling visibility** (a fresh relevant recipe from another session on the same key must render fully — the contract test for seam 2), and **token efficiency** (chars saved by stubs; novel-content share of the display). Echo-specific metrics retire with the feature. Arms: current-default vs stub+backfill vs pool-boundary variants. Fixture v2 and golden-export questions wait until this design is ruled and built (operator: *"No, we need to sort this out first."*).

## Open questions (small)

1. δ vs largest-gap for the pool boundary — sweepable, not a ruling blocker.
2. Stub contents: id + how much gist (the shipped `known_recipes` stub uses 80 chars — keep?).
3. `echo_suppress` removal: drop the param cold (it was A/B-only, default-off) or accept-and-ignore for one release?
4. [benchmarks.md](../benchmarks.md) publicly narrates pollution as a product finding with product fixes (*"drove real product changes: a read-only retrieval mode, same-agent-trace downranking, and feedback-driven ranking"*) — under the hygiene reframe and demotion retirement that story needs the operator's rewrite, not an agent's.
5. The evals-side hygiene checklist (fresh users per run, deletion between runs, rewind via export/import) — named here as the seam; authored evals-side.

## Sequencing

1. Deletion pass (everything listed above) + changelog entry — the codebase gets smaller before it gets new code.
2. `traces.session_id` migration + surface params (briefing/check/MCP) + stamping.
3. Known-set rendering with backfill (unifies `known_recipes`).
4. Relevance-bounded pool.
5. Harness: new metrics + arms, thresholds recalibrated once, then the sweep → operator rulings.
