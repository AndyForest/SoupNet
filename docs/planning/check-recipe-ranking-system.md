# check_recipe ranking — from point fixes to a tunable, regression-tested system

**Status**: implemented 2026-07-16 (same-day) — §3a/§3b/§3c shipped, §3d lever shipped default-OFF pending golden-set measurement; research memos in [ranking-research/](ranking-research/); current state + remaining work tracked in [docs/backlog.md](../backlog.md) §Ranking. **Executor**: the SoupNet implementation agent, with research sub-agents (spawn them early — §5). **Author**: the evals side, at Andy's direction — the regression/tuning capability is the heart of this brief, and the evals work is where the need was measured.

## 1. Why a system, not another fix (measured evidence)

The ranking behind `check_recipe` is now the product's most consequential surface — retrieval quality is what the public benchmark results rest on ([docs/benchmarks.md](../benchmarks.md)), and the self-pollution work made it a measured engineering problem rather than a vibes one.

The echo-suppression change (merged) taught the structural lesson. Its demotion mechanism **works at its own stage** — measured echo-at-top-rank fell 0.779 → 0.191 with zero regression on unaffected queries — yet end-to-end answer quality on a polluted corpus recovered only ~15–17% of the pollution gap. Two downstream stages the fix never touched absorbed the benefit:

1. **Pool composition**: demoted echoes still occupy top-K candidate slots wherever echo density rivals durable-recipe count, displacing durable recipes from the pool entirely.
2. **Cluster ordering**: displayed clusters are ordered by `memberCount desc` (`clustering.service.ts`) — self-similar multi-pass echoes win that count, so **demotion never reaches what the caller sees first**.

Conclusion: point changes to one pipeline stage don't survive the pipeline. The algorithm needs to be a *system* — stages explicit, signals available everywhere, every change measured against golden datasets before it ships, parameters tunable without code changes.

## 2. Standing design rulings that constrain everything here (all on the record)

- **No relevance floors or cutoffs, ever** — full clustered results with similarity percentages; even orthogonal recipes carry taste signal; the consuming agent judges relevance. Demotion reorders, never truncates, and never mutates displayed percentages.
- **Server relevance order is load-bearing** — client-side re-sorting measured harmful (−0.15 to −0.22). Ordering improvements belong here, server-side.
- **The objective is utility × surprise**, not relevance-max — the check algorithm is deliberately a serendipity/diversity problem, distinct from a plain vector search.
- **Feedback-driven reinforcement gates per-recipe, not per-set**, on provenance independent of the reporting agent (cross-agent corroboration, human reactions); decay comes only from human reactions. Confidence-weighting is a measured trap.
- **Recency belongs in server ranking** (demotion/decay), not client reorder.
- No LLM on the ranking path: the server does math (embeddings, search, clustering, ranking); agents do the reasoning.

## 3. What to build

### 3a. Explicit pipeline with per-stage signal access
Name and document the stages — candidate retrieval → scoring/demotion → clustering → **cluster ordering** → exemplar selection → rendering — with a single config object flowing through. Every ranking-relevant signal (similarity, authorship/api_key, created_at recency, decided_at/curated status, feedback provenance, human reactions) must be *available* at every stage, so future levers don't require plumbing rewrites. The echo-demotion weight becomes the first of several named, documented parameters.

### 3b. The offline regression harness (the heart of this brief)
A one-command, ~zero-cost (embedding-cache-warm) offline evaluation that any algorithm change must pass before merge:

- **Golden datasets** (delivered out-of-band as import-ready corpus exports + question sets — construct fixtures via the import feature; don't commit raw corpora):
  1. a **clean/polluted corpus pair** with a question set and known-good outcomes (the pollution replay assets — clean anchor ~0.71, polluted ~0.59 on the same questions);
  2. a **graded feedback set** (~705 rows labeled genuine-vs-echo) for provenance/reinforcement metrics;
  3. a **held-out judgment Q&A set** for retrieval-supports-the-right-answer checks.
- **Metrics per run** (each with a documented regeneration command): echo share@k and in-displayed-clusters; genuine-recall@k; cluster-ordering quality (does the top cluster carry durable judgment?); rank-correlation stability on unaffected queries (the no-regression guardrail); and a utility×surprise proxy (research sub-agent §5 informs the exact operationalization).
- **CI integration**: thresholds gate merges touching the ranking path. A failing golden metric is a red build, not a judgment call.

### 3c. Tunable parameters + a versioned tuning workflow
All knobs (demotion weight, recency windows, cluster-order key blend, pool size, diversity pressure) live in config with defaults and documented ranges. Tuning workflow: offline sweep on the golden sets → report → human ruling → default change shipped as a **versioned algorithm event** (an algorithm version identifier surfaced in API responses/metadata, so consumers and experiments can pin and report which ranking they ran against). Defaults never change silently.

### 3d. First change through the system: cluster-layer demotion integration
Implemented *after* the harness exists, as its proving run: cluster ordering weighs demotion-adjusted mass instead of raw `memberCount` (and evaluate a pool-composition lever alongside). Success criterion: echo share in displayed clusters drops materially on the golden polluted set with no regression on the clean set's guardrails. This is the fix R1's measurement pointed at — shipped as the system's first regression-tested change rather than another bandaid.

## 4. Acceptance criteria

1. Harness runs offline in minutes, ~$0 warm-cache, one command, documented.
2. CI gates ranking-path changes on the golden metrics; thresholds recorded with rationale.
3. Algorithm version visible in responses/metadata; changelog of default changes.
4. The cluster-integration change (§3d) ships through the harness and moves displayed-cluster echo share materially on the polluted golden set, guardrails green.
5. All §2 rulings hold by construction (no truncation, percentages untouched, no LLM on the path).

## 5. Research sub-agents (spawn in parallel, before designing §3b's metrics)

Each returns a short evidence memo — verbatim quotes + links, UNVERIFIED flagged — synthesized into the design before implementation:

1. **Offline IR evaluation best practices**: graded-relevance methodology, NDCG-family vs interleaving, golden-query-set construction and maintenance, how production search teams keep judgment sets fresh.
2. **Regression testing for ranking/recommender systems**: golden queries, metamorphic tests, guardrail metrics, change-gating patterns; how teams prevent the "fix one stage, lose it downstream" failure this brief exists because of.
3. **Learning-to-rank system architecture** (for the shape, not necessarily ML now): feature logging, feature availability across stages, offline/online metric alignment.
4. **Serendipity/diversity/novelty metrics** in RecSys literature — candidate operationalizations of utility × surprise that fit content-addressed vector retrieval.
5. **Experiment/config management for ranking**: parameter versioning, pinned-algorithm reporting, safe-default rollout patterns.

## 6. Working practice

Standard Soup.net practice: get the briefing at session start; recipe-check genuine design judgment calls (several §2 rulings began as exactly such checks); log feedback on recipes that influence decisions. The golden-dataset exports will be provided by the evals side on request — coordinate through Andy.
