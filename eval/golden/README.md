# Golden datasets for the ranking-regression harness

Layer B of the offline ranking-regression harness ([docs/planning/check-recipe-ranking-system.md](../../docs/planning/check-recipe-ranking-system.md) §3b). Each dataset directory here is run by `npm run eval:ranking` (CI: the `ranking-eval` job) through the real `runSearchPipeline` under every ranking variant, and any `thresholds.json` breach is a red build. The tuning workflow that consumes these runs lives in [docs/workflows/ranking-tuning.md](../../docs/workflows/ranking-tuning.md).

Reports land in `eval/reports/<dataset>/` (gitignored — regenerated per run).

## Dataset directory format

Each dataset is a directory under `eval/golden/` holding four files:

### `corpus.json`

An **import-ready export payload** — the exact `GET /auth/me/export` schemaVersion-1 shape that `POST /import` accepts (validated by `apps/backend/src/services/import-validate.ts`). Minimum per trace: `id` (UUID), `claimText`, `createdAt`. Optional: `decidedAt` (curation exemption signal), plus the full `evidence` / `references` / link sections — the runner drains their pending embedding stubs too.

Two conventions matter for echo datasets:

- **`createdAt` is the echo signal.** Echo traces must sit inside the session/day windows *relative to `meta.json`'s `referenceNow`*, never relative to wall-clock now — the fixture stays meaningful forever.
- **Authorship is runtime metadata.** Imports write `api_key_id NULL` (a human-only surface), so the corpus file cannot carry agent identity; `meta.json` does, and the runner stamps minted key uuids onto the echo rows after import.

### `meta.json`

```jsonc
{
  "referenceNow": "2026-07-15T12:00:00Z", // "now" for echo recency math
  "clusters": 3,                          // default k for questions
  "echoTraces": { "<traceId>": "<logicalAgentKey>", ... }
}
```

`echoTraces` defines the pollution arm: the runner imports the full corpus as the **polluted** arm and the corpus minus these rows as the **clean** arm (a second eval user — the import service's deterministic mint isolates the arms and returns the id remap).

### `questions.json`

An array of graded questions:

```jsonc
{
  "id": "q01-testing-discovery",
  "query": "As a developer about to ...",   // recipe-shaped, as an agent would check it
  "graded": { "<traceId>": 3, ... },         // 0–3 utility grades; absent = 0
  "echoKeys": ["agent-self"],               // logical keys the querying agent holds;
                                             // [0] becomes the current api_key.
                                             // Empty/absent = a fresh key (guardrail)
  "unaffected": true,                        // guardrail question: demotion must be a no-op
  "aspects": { "<traceId>": "label" },       // optional, for cluster-aspect coverage
  "clusters": 3                              // optional per-question k
}
```

Grades use the 4-point *utility-to-the-querying-agent* scale from the offline-IR memo: 0 = noise, 1 = topically adjacent but tells the agent nothing (task-shaped echoes of durable judgments grade 1), 2 = useful, 3 = useful and not derivable from the query itself. Grades key on the corpus's canonical trace ids; the runner remaps them for the clean arm automatically.

### `thresholds.json`

An array of `{ metric, min?, max?, rationale }` rules. `metric` is a dotted path into the run's aggregates (e.g. `arms.polluted.echo-on.echoShareTop3`, `guardrail.unaffectedTau.echo-on-mass`). **`rationale` is mandatory** — every bound records what it protects and which calibration run set it. Calibrate margins from a baseline run (`npm run eval:ranking`), leaving ~0.05 headroom for cross-platform ONNX float drift near ranking ties; hard invariants (the tau guardrails) stay exact.

## Ranking variants per run

Each question runs under four `RankingConfig` arms (`variantConfig` in [ranking-eval.ts](../../apps/backend/src/eval/ranking-eval.ts)):

- **baseline** — `DEFAULT_RANKING` (echo off, member-count cluster order, page pool).
- **echo-on** — echo demotion enabled, everything else default.
- **echo-on-mass** — echo demotion + `demotion-adjusted-mass` cluster ordering (the §3d lever).
- **echo-on-pool100** — echo demotion + `clusterPool: {mode: "fixed", size: 100, vectorDims: 768}` — the P6 lever's measured candidate: per the pool-sizing memo, "a fixed absolute `clusterPoolSize = 100`, as a `RankingConfig` lever decoupled from `per_page`" ([candidate-pool-sizing.md](../../docs/planning/ranking-research/candidate-pool-sizing.md)). The pool shapes only the clustered summary: "Pagination and the paged `results` are unchanged — the pool only feeds the clustered summary" ([vector-search.service.ts](../../apps/backend/src/services/vector-search.service.ts)).

## Two pipeline calls per question (production fidelity, 2026-07-17)

The runner makes two `runSearchPipeline` calls per question × arm × variant. The flat call (`expand: true, perPage: 100`) measures the whole-list ranking surface; the display call (`perPage: 20`, the question's cluster count) measures what an agent actually sees — production's check path clusters "the top slice by rank (`per_page`, default 20)" ([ranking-engine.md, stage 3](../../docs/architecture/ranking-engine.md#stage-3--the-candidate-window)). The earlier single `perPage: 100` clustered call idealized that window and masked exactly the problem P6 names: "clustering's purpose is diversity, and a fixed similarity-ranked window caps the diversity available to it" ([ranking-engine.md](../../docs/architecture/ranking-engine.md#stage-3--the-candidate-window)). In fixed-pool mode the display call's membership indexes the pool: "clusterInput is what the cluster stage summarizes: the P6 pool when the lever is on, else the page (legacy — byte-stable)" ([search-pipeline.ts](../../apps/backend/src/services/search-pipeline.ts)).

## Metrics per run

Definitions in `apps/backend/src/eval/metrics.ts`; each is regenerated by the one command `npm run eval:ranking` (or `npx tsx apps/backend/src/eval/ranking-eval.ts --dataset eval/golden/<name>` against an existing database):

- **ndcgFull** (primary) + **ndcg5/10/20** (diagnostics) — whole-list graded NDCG over the flat post-demotion order (the expanded flat call); the log discount rewards reordering without implying a cutoff (the no-truncation ruling).
- **genuineRecall5/10** — recall of grade≥2 non-echo recipes in the flat top-k.
- **echoShareTop3/Top5** — echo share of the flat post-demotion top-k (the waterfall's flat stage).
- **firstExemplarEchoRate**, **exemplarEchoShare**, **topClusterEchoShare** — the waterfall's display stages, measured on the production-shaped clustered call: the exemplar leading the display, the whole exemplar list, and the #1 displayed cluster's membership — so "absorbed downstream" is a first-class output.
- **aspectCoverage** — of the aspects with a relevant trace, the fraction represented by a relevant displayed exemplar on the production-shaped call (the diversity guardrail paired with every relevance metric — P6's core prediction is that this rises with pool size: "aspect coverage … should rise with pool size — that is P6's core prediction" ([candidate-pool-sizing.md](../../docs/planning/ranking-research/candidate-pool-sizing.md))).
- **serendipity** — Ser@L = (1/Z)·Σ disc(rank)·rel·unexp with disc(k) = 1/log₂(k+1), rel = grade/3, unexp = min cosine distance from the result embedding to the expectation set E = {query embedding} (Vargas-scheme utility × surprise over Kaminskas–Bridge min-distance; computed on the flat post-demotion order at full 3,072 dims for every variant). Report-only on the synthetic set — absolute values are small and margin-unstable pending real golden exports.
- **guardrail.unaffectedTau.*** — Kendall tau vs baseline flat order on `unaffected` questions, one entry per echo/pool variant; must be exactly 1.

## Real golden datasets arrive out-of-band

Only the synthetic starter (`synthetic-echo-v1/`) is committed. The real golden corpora — the clean/polluted pollution-replay pair, the graded feedback set, and the held-out judgment Q&A set named in the brief — are **export files from the evals side, delivered via the operator** (coordinate through Andy), because they contain real recipe text that is not public-repo material. To install one: drop the delivered directory (same four files) under `eval/golden/<name>/`, run `npx tsx apps/backend/src/eval/ranking-eval.ts --dataset eval/golden/<name>` to get its baseline report, calibrate its `thresholds.json` from that run, and keep the directory out of git unless the operator rules it committable.

## `synthetic-echo-v1`

**Fully synthetic fixture** (generated 2026-07-16 — invented recipes, no PII, no real corpus rows; safe to commit). 30 durable cross-agent judgments across 5 topics (testing, migrations, API errors, docs, frontend a11y/perf; six with `decidedAt` variety), plus a pollution arm of 15 same-key task-shaped discovery-check echoes concentrated on the testing and migrations topics — the measured self-pollution shape. 10 questions: 4 echo-affected, 3 graded neutral, 3 `unaffected` guardrails. Thresholds calibrated from the 2026-07-16 baseline run and recalibrated 2026-07-17 for the production-shaped display call (see each rule's rationale).

Known properties (both scoped to this fixture's small scale, not verdicts on the levers):

- **The mass lever coincides with member-count here.** Once demotion is on at the production window (perPage 20), demoted echoes leave the window entirely and the displayed clusters measure 0.0 echo under both orderings — the `demotion-adjusted-mass` mechanism is proven by the Layer A waterfall test ([ranking-regression.test.ts](../../apps/backend/src/services/ranking-regression.test.ts)); its material displayed-cluster effect is a real-golden-set measurement.
- **The pool arm degenerates to a whole-corpus pool.** The 45-trace corpus is smaller than `fixed:100`, so `echo-on-pool100` cannot test P6's coverage prediction here — measured 2026-07-17, it re-admits demoted echoes into the clustered summary (topClusterEchoShare 0.2019 vs 0.0 page-mode) and *lowers* aspectCoverage (0.6393 vs 0.6893), which is the memo's own oversize warning in miniature: "too large and cluster centroids answer 'what is this corpus about' instead of 'what bears on this query.'" ([candidate-pool-sizing.md](../../docs/planning/ranking-research/candidate-pool-sizing.md)). The pool arm carries only a regression ceiling here; the coverage-gain measurement belongs to the real golden export sweep.
