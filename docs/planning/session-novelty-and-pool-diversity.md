# Session novelty + pool diversity — replacing key-based echo demotion and fixed candidate windows

**Status**: plan for operator ruling (2026-07-17). Supersedes the direction of the shipped (default-OFF, never-flipped) api_key-based echo demotion as the *target* architecture; the shipped lever stays as a measurement arm and its plumbing is reused. Companion research: [candidate-pool-sizing.md](ranking-research/candidate-pool-sizing.md), [echo-suppression.md](echo-suppression.md), [ranking-engine.md](../architecture/ranking-engine.md).

## The two problems, in the operator's words (complete inventory)

**Problem A — single-agent echo suppression must not break the fleet.** Everything the operator has said:

1. The replacement sketch that started it: *"remove this stage here, then at the very end, when we have all our clustered results, we could walk through the recipes that we're about to send back. If we find one authored by the same agent session, then we could just return the ID instead, and then crucially, return the full text of the next recipe in line. That way, the agent gets the full data, and if it somehow doesn't remember the recipe we omitted, it can use the recipe ID to grab it."* (2026-07-16)
2. The identity flaw in the shipped signal: *"Especially important since we don't actually know if it's the same agent, since all the sub-agents share the same API key."* (2026-07-16)
3. The showstopper: *"Oh, that's actually a show stopper for omitting the recipe - that's exactly how sub-agents cross communicate, by seeing the recent relevant recipes from their peer sub-agents. Hmm. So a better system would be state tracking. Ick."* (2026-07-16)
4. Server-side state shape: *"Have the 'get briefing' surface also return a new 'sessionId'. Then the recipe check surface has an optional 'sessionId' input. Then the server has a state tracking table for that specific agent. Some sub-agents inherit the conversation history of their parent, so they might not want to get a whole new briefing. Maybe that's too bad, and they just should. Or we could consider having the recipe check return a fresh new sessionID if a valid one is not sent with the call. Maybe that's better anyways. Self healing if we want to expire the sessions after a week or something."* (2026-07-16)
5. Client-side state shape: *"Keep track of all the recipe ids that you know. Send a list on every call. That seems like it's asking a lot from the client LLM though."* (2026-07-16)
6. The verdict on the shipped stage: *"This feels very much like an arbitrary unmaintainable bandaid to solve a specific problem. Do not like."* (2026-07-16)
7. The re-invocation when a display-clearing result was reported as a win: *"Remember what I said about echo demotion breaking communication of fresh recipes across parallel concurrent sub-agents?"* (2026-07-17)

**Problem B — the candidate pool fills with too-similar recipes.** Everything the operator has said:

8. The growth dynamic: *"It feels to me that a result of this would be a loss of diversity as a corpus gets richer because then there will be more closer matches, so the top 20 will be much more similar to each other. It feels like the point of clustering is diversity, and that the default 20 limits this. So this might be our actual 'echo chamber' issue."* (2026-07-16)
9. The dig instruction: *"Why 20? Dig. Is there some performance reason? Or functionality? ie: get rid of all the not relevant recipes."* (2026-07-16)
10. The naming honesty point: *"It's also kind of misnamed as 'pagination' since our later stage, the number of clusters is actually the number of results returned to the user."* (2026-07-16)
11. The sizing instincts: *"Is it ok to just have the same 10000 cap that the clustering stage has? That feels like it might then just have too many irrelevant things in it. Maybe we just grab the top 30 % or something?"* (2026-07-17)
12. The rejection of the fixed cap as the fix, quoting the memo's own adaptive-k line back: *"Yeah, this doesn't sound like 'just raise the cap to 100' to me. Why would you just raise the cap to 100?"* (2026-07-17)
13. The problem's real name: *"candidates getting filled up with too-similar recipes"* (2026-07-17)

Standing context that binds both: the objective is utility × surprise; clustering's purpose is diversity; the engine is an experimentation platform whose levers the evaluation side tests (recipe `a7108776`).

## Why the current state conflicts with A (the evidence)

The 2026-07-17 production-shaped measurement: with demotion on, *"at production shape, demotion alone fully clears the 20-window display (0.0 across display metrics)."* Same key + recent + small window ⇒ every same-key-recent candidate leaves the displayed summary — functionally the omission of statement 3, applied to sibling sub-agents' fresh trails as collateral. The harness could not see this cost: no fixture scenario contains a sibling session depositing fresh relevant recipes, so there is no metric that would have gone red (recipe `81f40bbd`).

## Accounting: what was deprioritized or dropped, and pushback

- **Dropped without reason — now core:** statement 1's stub-plus-backfill mechanism ("return the ID instead… crucially, return the full text of the next recipe in line"). It was logged into recipes/backlog but never carried into an implementation plan. It is the display-budget answer and anchors Plan A below. The shipped `known_recipes` param stubs known ids but does **not** backfill the freed budget — half the idea.
- **Deprioritized by misjudgment:** session identity was parked as a `[DESIGN]` backlog item "awaiting ruling" while measurement infrastructure kept accumulating around key-based demotion — building credibility for an architecture already called a bandaid (statement 6). Measurement momentum is not a ruling.
- **Staged, under-communicated:** the adaptive pool was named the sweep alternate while only the fixed mode was implemented. The fixture run then demonstrated why fixed caps are fixture-relative: `fixed:100` on 45 traces degenerated to a whole-corpus pool, re-admitted demoted echoes, and lowered aspect coverage.
- **Still open, folded in:** statement 10's naming problem — resolved as part of the budget-surface parameter redesign (phase B3), not before.
- **Pushback (not dropped, with reasons):** (a) the demotion *plumbing* (penalty math, signal record, penalties-shared-across-stages, memberWeights) is identity-agnostic and is reused by every plan below — what changes is which identity keys it and what the display does with it; (b) clamp bounds on any adaptive pool remain necessary — an unbounded pool re-creates statement 11's "too many irrelevant things" and walks off the ANN fast plan (pool-sizing memo: ≤133); adaptive-inside-clamps is not "just raise the cap"; (c) one honest tension in session-only identity, stated rather than resolved: the originally measured pollution (*"accuracy fell 0.706 → 0.538 over five runs"*, benchmarks.md) accumulated **across runs** — different sessions of the same lineage. Session-only novelty would not have caught it. The self-minted `agent_id` (already captured on every check) is the natural lineage tier between session and key; which tiers suppress vs stub is a measured arm, not an assumption.

## Plan A — session-aware novelty (replaces key-based echo demotion as target)

**A1. Session identity plumbing.** A `ranking_sessions` table + nullable `traces.session_id` stamp on deposits. `get_briefing` returns a fresh `session_id`; `check_recipe`/`/check` accept an optional one; any check with an absent/invalid id gets a fresh one in the response (statement 4's self-healing lean); sessions expire (~7 days, sweepable). Sub-agents: fresh session by default; a parent may hand its id to a child deliberately (inheritance = opt-in). `session_id` becomes a `CandidateSignals` field.

**A2. Known-set rendering with budget backfill (statement 1, unified with `known_recipes`).** One known-set per request = ids deposited by this session (server state) ∪ ids the caller declares (`known_recipes`, client state — statement 5's shape, already shipped). Results in the known-set render as id-stubs with a gist; **the freed display budget backfills with the next candidates in line** — the missing half. Nothing is omitted (stub carries the id; `get_recipes` fetches on demand); sibling sessions' recipes are NOT in the known-set and render fully — the fleet keeps communicating.
**A3. Suppression rescoped by identity tier.** Measurement arms: rank demotion keyed on `session_id` only; on `session_id ∪ agent_id` (lineage); the shipped api_key arm as the comparison baseline; and a no-demotion arm where A2's stub+backfill does all the work (statement 1's original instinct: no scoring stage at all). The winner must beat baseline on echo metrics AND hold the new sibling-visibility guardrail (M below).

**A4. Deprecation.** If a session/lineage arm ≥ key arm on echo metrics and strictly better on sibling visibility, api_key demotion is retired as a versioned changelog event.

## Plan B — relevance-bounded, redundancy-aware pool (replaces fixed caps as target)

**B1. Score-distribution pool boundary.** The pool extends down the ranking to the largest score gap (or within-δ-of-top), clamped [20, 133] (ANN fast plan; pool-sizing memo). Fixed sizes remain only as clamp bounds and sweep comparison arms — answering statement 12: 100 was scaffolding, the boundary is the design.
**B2. Redundancy handling inside the pool (statement 13).** Arms: (i) clustering the bounded pool as-is (clustering is itself the redundancy collapse — exemplar + memberCount is already the display form); (ii) relevance-weighted k-means (extend `memberWeights` from ordering into centroid weighting so larger pools can't drift off-query — the fix for statement 11's oversize worry); (iii) explicit near-duplicate collapse (θ on pairwise similarity) before clustering, freed slots backfilling per A2.
**B3. Budget-surface naming.** With pool ≠ page, rename the caller surface honestly (statement 10): the clustered mode's contract is "summarize the relevant pool into k exemplars for my budget"; `page`/`per_page` describe only the flat mode. Parameter naming lands here, once, with the redesign.

## Measurement first (both plans depend on it)

- **New guardrail metric: sibling visibility.** A fresh, relevant recipe deposited by a *different session on the same key* must surface (displayed summary or flat top-k). This is the metric that would have caught the 2026-07-17 misread — it goes red when suppression eats the fleet's channel.
- **Fixture v2 (synthetic, 300+ traces)** with three scenario families: echo lineages (same session and same agent_id across "runs"), sibling fleets (parallel sessions, same key, fresh relevant deposits), and redundancy families (near-duplicate clumps at top ranks with distinct relevant topics below rank 20). The 45-trace fixture stays for mechanism tripwires; it cannot answer A or B (measured 2026-07-17: `fixed:100` degenerates to whole-corpus there). The real golden export remains the product-grade verdict for everything.

## Open decisions for the operator

1. Session inheritance default for sub-agents: fresh-by-default with opt-in handoff (drafted above), or always-fresh (statement 4's "maybe that's too bad, and they just should")?
2. Does the no-demotion arm (A2-only, statement 1's instinct) start as the *favored* candidate, or does session-scoped demotion?
3. `agent_id` as a suppression tier: acceptable to let a self-minted, unverified id influence ranking for its own key's checks, or capture-only until abuse review?
4. Schema go-ahead: `ranking_sessions` + `traces.session_id` (one migration).
5. Fixture v2 now (unblocks all arms) vs waiting for the real golden export.

## Sequencing

1. Fixture v2 + sibling-visibility metric (measurement before mechanism — nothing else is judgeable without it).
2. A1 session plumbing (schema + surfaces).
3. A2 known-set rendering with backfill (also fixes `known_recipes`' missing backfill).
4. A3 suppression arms + B1/B2 pool arms — one sweep, all arms, against fixture v2.
5. Report → operator rulings → versioned changelog events (including retiring what loses).
