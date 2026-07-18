# Golden datasets for the ranking-regression harness

Layer B of the offline ranking-regression harness, rebuilt 2026-07-17 for the simplified engine — pure-function ranking, session-aware rendering, relevance-bounded pool ([docs/planning/session-novelty-and-pool-diversity.md](../../docs/planning/session-novelty-and-pool-diversity.md), plan v2). Each dataset directory here is run by `npm run eval:ranking` (CI: the `ranking-eval` job) through the real `runSearchPipeline` under every ranking variant, and any `thresholds.json` breach is a red build. The tuning workflow that consumes these runs lives in [docs/workflows/ranking-tuning.md](../../docs/workflows/ranking-tuning.md).

Reports land in `eval/reports/<dataset>/` (gitignored — regenerated per run).

## The two corpus arms are a HYGIENE scenario

The clean/polluted pair no longer measures a product defect: "'pollution' is actually the system working as intended for normal use. I think our benchmark hygiene is just bad" ([session-novelty-and-pool-diversity.md, seam 3](../../docs/planning/session-novelty-and-pool-diversity.md)). The arms demonstrate what run isolation is worth on the benchmark side:

- **hygiene-polluted** — the full corpus including the session-lineage deposits (one agent lineage re-depositing task-shaped near-duplicates over its own corpus: the bad-hygiene shape).
- **hygiene-clean** — the corpus minus `meta.json`'s `sessionLineages` rows: the properly isolated run. Imported by a second eval user; the import service's deterministic mint isolates the arms and returns the id remap the metrics need.

## Dataset directory format

Each dataset is a directory under `eval/golden/` holding four files:

### `corpus.json`

An **import-ready export payload** — the exact `GET /auth/me/export` schemaVersion-1 shape that `POST /import` accepts (validated by `apps/backend/src/services/import-validate.ts`). Minimum per trace: `id` (UUID), `claimText`, `createdAt`. Optional: `decidedAt`, plus the full `evidence` / `references` / link sections — the runner drains their pending embedding stubs too.

Session authorship is runtime metadata: imports write `session_id NULL` (a human-only surface), so the corpus file cannot carry it; `meta.json` does, and the runner stamps minted session tokens onto the lineage rows after import — the same `traces.session_id` column production stamps at deposit time (migration 0031).

### `meta.json`

```jsonc
{
  "referenceNow": "2026-07-15T12:00:00Z", // anchors the fixture's timestamps
  "clusters": 3,                          // default k for questions
  "sessionLineages": { "<traceId>": "<lineageName>", ... }
}
```

`sessionLineages` defines both the hygiene arm split (hygiene-clean = corpus minus these rows) and the session known-sets: the runner mints one session token per lineage per run, stamps `traces.session_id`, and derives per-question known-sets from the stamped column — mirroring the production known-set query shape ("the known-set query is `session_id = ? AND created_at > now() - interval '7 days'`" — [session-novelty-and-pool-diversity.md](../../docs/planning/session-novelty-and-pool-diversity.md)) without wall-clock fragility.

### `questions.json`

An array of graded questions:

```jsonc
{
  "id": "q01-testing-discovery",
  "query": "As a developer about to ...",   // recipe-shaped, as an agent would check it
  "graded": { "<traceId>": 3, ... },         // 0–3 utility grades; absent = 0
  "sessions": ["lineage-self"],             // lineages whose deposits form the
                                             // querying agent's known-set (overlay)
  "unaffected": true,                        // stability-guardrail question (tau = 1)
  "aspects": { "<traceId>": "label" },       // optional, for cluster-aspect coverage
  "clusters": 3                              // optional per-question k
}
```

Grades use the 4-point *utility-to-the-querying-agent* scale from the offline-IR memo: 0 = noise, 1 = topically adjacent but tells the agent nothing (a lineage's task-shaped near-duplicates grade 1), 2 = useful, 3 = useful and not derivable from the query itself. Grades key on the corpus's canonical trace ids; the runner remaps them for the hygiene-clean arm automatically.

### `thresholds.json`

An array of `{ metric, min?, max?, rationale }` rules. `metric` is a dotted path into the run's aggregates (e.g. `arms.hygiene-polluted.baseline.tokenEfficiency`, `guardrail.unaffectedTau.pool-score-gap`). **`rationale` is mandatory** — every bound records what it protects and which calibration run set it. Calibrate margins from a baseline run, leaving ~0.05 headroom for cross-platform ONNX float drift near ranking ties; contract-level invariants (the tau guardrails, siblingVisibility) stay exact at 1.

## Ranking variants per run

Ranking is a pure function of the check's inputs ("The sum of the inputs to the recipe check should be all that influences the results" — [session-novelty-and-pool-diversity.md, seam 1](../../docs/planning/session-novelty-and-pool-diversity.md)), so variants differ only in the clustering-pool boundary (`variantConfig` in [ranking-eval.ts](../../apps/backend/src/eval/ranking-eval.ts)):

- **baseline** — `DEFAULT_RANKING` (page pool — the legacy pagination-window pool).
- **pool-fixed100** — `clusterPool: {mode: "fixed", size: 100}`: the fixed-cap comparison arm, "scaffolding, not the target" since "fixed caps are fixture-relative (measured 2026-07-17)" ([ranking-config.ts](../../packages/domain/src/ranking-config.ts)).
- **pool-score-gap** — the measured candidate: "the pool extends down the ranking to the largest adjacent score gap found between `minSize` and `size` candidates — a relevance-bounded boundary instead of a global cutoff" ([ranking-config.ts](../../packages/domain/src/ranking-config.ts)).

## Pipeline calls per question

Two calls per question × arm × variant, plus a session overlay where it applies. The flat call (`expand: true, perPage: 100`) measures the whole-list ranking surface; the display call (`perPage: 20`, the question's cluster count) measures what an agent actually sees at the production window. On session questions in the hygiene-polluted arm, a third call repeats the display call with `knownIds` derived from the stamped lineages — measuring the known-set rendering seam: "Already-known recipes keep their rank and stay visible — they render as id-stubs … and the freed display budget backfills with the next results in line" ([session-novelty-and-pool-diversity.md, seam 2](../../docs/planning/session-novelty-and-pool-diversity.md)).

## Metrics per run

Definitions in `apps/backend/src/eval/metrics.ts`; every number regenerates from the one command `npm run eval:ranking` (or `npx tsx apps/backend/src/eval/ranking-eval.ts --dataset eval/golden/<name>` against an existing database):

- **ndcgFull** (primary) + **ndcg5/10/20** (diagnostics) — whole-list graded NDCG over the flat order; the log discount rewards reordering without implying a cutoff (the no-truncation ruling). Identical across pool variants by construction (pure-function seam).
- **relevantRecall5/10** — recall of grade≥2 recipes in the flat top-k.
- **aspectCoverage** — of the aspects with a relevant trace, the fraction represented by a relevant displayed exemplar on the production-shaped call (the diversity guardrail paired with every relevance metric; the pool lever's target: "aspect coverage … should rise with pool size" — [candidate-pool-sizing.md](../../docs/planning/ranking-research/candidate-pool-sizing.md)).
- **serendipity** — Ser@L = (1/Z)·Σ disc(rank)·rel·unexp with disc(k) = 1/log₂(k+1), rel = grade/3, unexp = min cosine distance from the result embedding to the expectation set E = {query embedding} (Vargas-scheme utility × surprise over Kaminskas–Bridge min-distance; flat order, full 3,072 dims for every variant). Report-only on the synthetic set.
- **tokenEfficiency** / **tokenSavedChars** — session overlay: the share (and absolute chars) of the display call's recipe-text budget saved by known-set stubs (known flat results, stub exemplars, and `promotedOverKnownIds` carried on backfilled exemplars).
- **siblingVisibility** — session overlay: the fraction of relevant results OUTSIDE the known-set rendered fully. Exactly 1 by contract — sibling-session deposits are the cross-agent communication channel ("that's exactly how sub-agents cross communicate, by seeing the recent relevant recipes from their peer sub-agents" — [ranking-engine.md](../../docs/architecture/ranking-engine.md)).
- **guardrail.unaffectedTau.*** — Kendall tau vs baseline flat order on `unaffected` questions, one entry per pool variant; must be exactly 1 (the pool feeds only the clustered summary).

## Real golden datasets arrive out-of-band

Only the synthetic starter (`synthetic-echo-v1/`) is committed. Real golden corpora are export files from the evals side, delivered via the operator (coordinate through Andy), because they contain real recipe text that is not public-repo material. To install one: drop the delivered directory (same four files) under `eval/golden/<name>/`, run `npx tsx apps/backend/src/eval/ranking-eval.ts --dataset eval/golden/<name>` for its baseline report, calibrate its `thresholds.json` from that run, and keep the directory out of git unless the operator rules it committable. Fixture v2 and golden-export question sets wait on the plan-v2 build sequence ("Fixture v2 and golden-export questions wait until this design is ruled and built" — [session-novelty-and-pool-diversity.md](../../docs/planning/session-novelty-and-pool-diversity.md)).

## `synthetic-echo-v1`

**Fully synthetic fixture** (generated 2026-07-16 — invented recipes, no PII, no real corpus rows; safe to commit). 30 durable judgments across 5 topics (testing, migrations, API errors, docs, frontend a11y/perf; six with `decidedAt` variety), plus 15 task-shaped near-duplicate deposits under one session lineage (`lineage-self`) concentrated on the testing and migrations topics — the measured bad-hygiene shape. 10 questions: 4 with session lineages (the overlay measurements), 3 graded neutral, 3 `unaffected` guardrails. Thresholds recalibrated 2026-07-17 from the simplified-engine rewrite baseline (see each rule's rationale).

Fixture-scale caveat (honest limit, not a verdict on the levers): these corpora (30–45 traces) are smaller than or close to both the page window (20) and the pool bounds, so pool modes degenerate toward whole-corpus pools here — `pool-fixed100` measured aspectCoverage 0.6393 vs 0.6893 page-mode on the clean arm (2026-07-17), the pool-sizing memo's own oversize warning in miniature: "too large and cluster centroids answer 'what is this corpus about' instead of 'what bears on this query.'" ([candidate-pool-sizing.md](../../docs/planning/ranking-research/candidate-pool-sizing.md)). Pool arms therefore carry stability/contract guardrails only; the coverage-gain measurement belongs to real-scale golden exports.
