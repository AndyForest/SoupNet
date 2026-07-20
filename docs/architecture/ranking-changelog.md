# Ranking algorithm changelog

Every change to the shipped ranking defaults (`DEFAULT_RANKING` / `RANKING_ALGORITHM_VERSION` in `packages/domain/src/ranking-config.ts`) gets an entry here, in the same commit that changes the default. Defaults never change silently (docs/planning/check-recipe-ranking-system.md §3c). Format per entry: what changed (old → new values), the sweep report / golden-set measurement it rests on, and the human ruling that shipped it.

The version is surfaced as `data.ranking.version` in `/check` JSON and MCP structured responses, and as `rankingVersion` in `recipe.checked` audit metadata — consumers and experiments report which ranking they ran against.

Additive levers that default to the previous behavior do **not** mint a new version; only a behavior-changing default flip does.

---

## 2026-07-20 — cluster ordering: `member-count` → `max-similarity` (version mint: `2026-07-19` → `2026-07-20`)

`DEFAULT_RANKING.clusterOrdering` flips `member-count` → `max-similarity`: the clustered summary's sequence now leads with the cluster whose best member is most query-similar, instead of the biggest cluster. Membership, ranking, scores, the flat surface, and pagination are untouched (measured: flat tau exactly 1.0 for every ordering variant; aspectCoverage order-blind and identical).

Rests on: the P7 ordering sweep ([p7-ordering-sweep-report.md](../planning/ranking-research/p7-ordering-sweep-report.md)) — on the echo-shaped polluted arm (the diagnosed failure mode: *"Echo clusters win member-count by self-similarity; the metric rewards the failure mode"*) max-similarity gains +6.3pts exemplarOrderNdcg and +20% relative firstExemplarGrade; on clean corpora at real scale the cost is within-or-near seeding noise (gemini −0.6pt). The payoff is asymmetric toward the corpus shape production actually exhibits, and "the most relevant cluster leads" is the more explainable contract. `member-count` stays a comparison arm; `evidence-mass` stays plumbed awaiting evidence-bearing golden material (unmeasurable on traces-only corpora — degenerates to the legacy tie-break).

Ruling: operator, 2026-07-20 ("Ok, it sounds like (a) is best"), on the report's recommendation. Lineage recipes: `d8b369b2`, `7f3b8e51`.

## 2026-07-19 — cluster-ordering lever added, ships legacy member-count (no version mint)

Adds the `clusterOrdering` lever to `RankingConfig` (stage 5 cluster display ordering) with three modes: `member-count` (legacy — biggest cluster first, the shipped default), `max-similarity` (relevance-first — order by each cluster's best member's query similarity), and `evidence-mass` (corroboration weight — order by the summed evidence-row count of members). No shipped behavior changed — the lever ships in its legacy position (`member-count`, byte-stable), so the version stays `2026-07-19`; this entry records the *lever inventory* change per the 2026-07-17 convention.

Motivation: the contrarian-miss diagnosis (2026-07-19, evals-side) found member-count-descending ordering "rewards the failure mode" — self-similar echo clusters win the member count. The lever reorders the clustered summary's *sequence* only (never membership, ranking, scores, or the flat surface), as one permutation applied downstream of the pure-geometry clustering stage (clustering.service stays size-ordered for the map/briefing surfaces). Order-sensitive eval metrics (`exemplarOrderNdcg`, `firstExemplarGrade`) and the `order:max-similarity` / `order:evidence-mass` variants (`RANKEVAL_EXTRA_VARIANTS`) make it measurable; aspectCoverage is order-blind. A flip to a non-legacy default awaits the sweep → report → ruling path.

Distinct from the retired `demotion-adjusted-mass` ordering (2026-07-17): that lever derived cluster mass from echo demotion and left with it; this one ranks on explicit corpus properties (query similarity, evidence count), consistent with the pure-function ranking ruling (recipe `9067ca1b`). Register hypothesis: P7 ([ranking-engine.md §5](ranking-engine.md#presentation--budget)).

## 2026-07-19 — clustering pool decoupled from the page window: `page` → `fixed:100` (version mint: `2026-07-16` → `2026-07-19`)

`DEFAULT_RANKING.clusterPool` flips `{mode: "page"}` → `{mode: "fixed", size: 100, minSize: 20, vectorDims: 768}`. The clustering stage now summarizes the top 100 candidates instead of the 20-item pagination window; flat results, pagination arithmetic, displayed scores, and the result set are untouched (the pool feeds only the clustered summary — measured: every flat metric byte-identical across pool variants, guardrail Kendall tau exactly 1.0 in every run).

Rests on: the real-scale P6 sweep ([p6-pool-sweep-report.md](../planning/ranking-research/p6-pool-sweep-report.md), 39,524-trace golden corpus, 3,978 graded rows, both embedding spaces) — display diversity rises and saturates at or before pool 60 (bge +2.8–3.2pts, gemini +0.34–0.55pts; the lever matters most where near-duplicates are dense), latency ~144ms/call at pools to 400, and `score-gap` trails fixed in both spaces (stays plumbed as a comparison arm, as does `page`). 100 over 60: same measured result, same cost class (both inside the ANN plan), and 100 is the external convention (sbert retrieve-100, Elasticsearch sampler default, Carrot2's ≥100 minimum, the eval runner's own number).

Ruling: operator, 2026-07-19 ("Maybe we should push this fixed:100 work first"), on the report's recommendation. Sweep lineage recipes: `46ba63f5`, `dc280520`, `7f3b8e51`.

## 2026-07-17 — echo demotion retired; session-aware rendering + pool boundary land (no version mint)

No shipped behavior changed — every removed lever was default-OFF and never flipped, and every added lever ships in its legacy position — so the version stays `2026-07-16`. Recorded here because the *lever inventory* changed shape (operator rulings, recipes `9067ca1b` / `ebdc6ad7`; plan: [session-novelty-and-pool-diversity.md](../planning/session-novelty-and-pool-diversity.md)):

- **Removed**: echo demotion (score reorder, weights, windows), the curation-exemption flags + corroboration counts, the `demotion-adjusted-mass` cluster ordering, the `echo_suppress` request param (dropped cold — it was A/B-only), and the `echoSuppression` system setting. Rationale: ranking is a pure function of the check's explicit inputs (a demoted recipe is indistinguishable from a deleted one), and the pollution it targeted is reclassified as benchmark hygiene.
- **Added (rendering layer, not ranking)**: `session_id` (opaque client-held token, self-healing, stamped on deposits — migration 0031) and known-set id-stub rendering with budget backfill; the recipe-gist on stubs is removed everywhere (ossification risk — a truncated claim can be read as the claim). Extended same day (operator ruling, recipe `31d184df`; migration 0032): the known-set includes **display history** (`session_shown` — every full text rendered is recorded as shown), the display window **walks the ranking until it holds its full budget of unseen recipes** (knowns interleave as stubs at true rank; offsets count novel items), evidence-discovery entries with known parents stub too, and `check_feedback.session_id` captures the reporting session. Ranking untouched throughout; sessionless requests are byte-stable.
- **Added (lever, ships off)**: `clusterPool` mode `"score-gap"` — relevance-bounded pool boundary (largest gap in [minSize, size]); `"fixed"` remains as a sweep comparison arm; default stays `"page"`.

Initial versioned config. Behavior is byte-identical to the pre-refactor pipeline; this entry records what the levers ship as, so later flips have an explicit "old" side.

- `echo.enabled: false` — echo demotion OFF pending the golden clean/polluted pair measurement (ruling recipe `5cfee9bb`, docs/planning/echo-suppression.md §Default). Weights when enabled: `weight 0.5, sessionWindowMinutes 90, dayWindowHours 24, dayWeightFactor 0.5`.
- `exemption: { decidedAt: true, humanReaction: false, crossAgentFeedback: false }` — v1 curation exemption only. The two corroboration signals are plumbed (lazy per-candidate counts) but OFF until measured.
- `clusterOrdering: "member-count"` — legacy ordering. The `"demotion-adjusted-mass"` lever (§3d) is implemented and harness-measurable; the flip awaits the golden polluted-set ruling.
