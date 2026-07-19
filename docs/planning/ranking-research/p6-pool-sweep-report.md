# P6 pool sweep — results and recommendation (2026-07-19)

The measured answer to [hypothesis P6](../../architecture/ranking-engine.md#presentation--budget) ("the fixed candidate window caps clustering diversity as the corpus grows"), run per the [candidate-pool-sizing memo](candidate-pool-sizing.md)'s §Recommendations on the first real-scale golden dataset. This is the **report** step of the memo's "sweep → report → ruling → versioned-changelog path" — the ruling is the operator's.

## Setup

- **Dataset**: `eval/golden/hygiene-realscale` (local-only, gitignored — real recipe text). 39,524-trace clean-arm corpus delivered by the evals workstream (their golden-exports-p6 MANIFEST); 36 questions (30 graded + 6 tau guardrails) authored from the PERMA task material; 3,978 graded rows produced by a six-grader variant-blind fleet under a written calibration ruling (provenance: the dataset's `GRADING-NOTES.md`; grading recipes `46ba63f5`, `dc280520`).
- **Two embedding spaces**: `local` (bge-small-en-v1.5, the CI harness model) and **`gemini` (gemini-embedding-2-preview — the production space; decision numbers)**. The spaces' top-80 retrievals overlap only ~28% on average (676 shared vs 1,724 space-exclusive slots across 30 questions), so the graded pool covers the union of both spaces' retrievals — grading one space's pool and measuring the other would have silently zero-graded most of it.
- **Variants**: `page` (live default — pool = the 20-item page window), `fixed:60/100/133/400` @ 768-dim pool vectors, `score-gap` (adaptive largest-gap boundary in [20, 133]). 133 is the ANN plan boundary from the memo (`pool ≤ 133 stays ANN`).
- **Runs**: reports `2026-07-19T06-30-52` (local baseline), `06-4x` (local grid), `08-20-15` + `08-29-24` (gemini grid ×2 for seeding-noise estimate), `08-4x` (threshold verification) in `eval/reports/hygiene-realscale/` (gitignored, regenerable).

## Results — aspectCoverage (the P6 target metric: display-window diversity at the production-shaped call)

| space | page (20) | fixed:60 | fixed:100 | fixed:133 | fixed:400 | score-gap |
|---|---:|---:|---:|---:|---:|---:|
| local bge | 0.4130 | 0.4411 | 0.4411–0.4446 | 0.4411 | 0.4411 | 0.4316 |
| **gemini (production)** | **0.3628** | **0.3662–0.3683** | **0.3662–0.3683** | **0.3662–0.3683** | **0.3662–0.3683** | **0.3653** |

Ranges are across repeat runs — k-means seeding noise measured ±0.004 (local) / ±0.002 (gemini) on fixed-pool variants; `page` and `score-gap` were deterministic across repeats. Per-question (gemini, run 1): 5 of 36 questions move — three up (~+0.11 each), two down (~−0.07); the rest are unchanged.

**Every other metric is invariant across all variants in both spaces** — ndcgFull/5/10/20, relevantRecall5/10, Ser@L byte-identical, and guardrail Kendall tau exactly 1.0000 for every variant in every run. The pool lever shapes only the clustered summary; the pure-function seam held everywhere. Gemini's flat retrieval is also simply better than bge's (ndcgFull 0.9453 vs 0.9216; relevantRecall10 0.2684 vs 0.2531) — corroborated qualitatively by graders finding gemini surfaced persona gold values bge's top-80 never retrieved.

## Findings

1. **P6 confirmed directionally in both spaces, cost-free.** Pools larger than the page window raise display diversity and touch nothing else. Latency is a non-issue: 864 pipeline calls in 124.3s (~144 ms/call) at 39.5k corpus scale with pools up to 400.
2. **The effect saturates at or before 60 in both spaces.** fixed:60 = fixed:100 = fixed:133 = fixed:400 to measurement precision. Nothing approaches the ANN boundary, so the exhaustive-scan question is moot — the memo's warned-against large pools buy nothing here.
3. **Effect size is embedding-dependent — the lever matters most where the embedding is weakest.** bge space: +2.8 to +3.2 points (~+7% relative). Gemini space: +0.34 to +0.55 points (~+1.5% relative), small but consistently above both baseline determinism and seeding noise in every run. Interpretation: the richer production model's top-20 is already less redundant, so there is less near-duplicate crowd-out for a bigger pool to fix. The contrarian-miss diagnosis (2026-07-19, evals-side: 4 near-duplicate echoes consuming a fifth of the 20-pool) is the bge-shaped failure — real corpora with heavy near-duplication (echo contamination, dialog-distilled deposits) sit closer to the bge case than this measurement's clean arm does.
4. **Score-gap trails fixed in both spaces** (local 0.4316 vs 0.4411; gemini 0.3653 vs 0.3662–0.3683). The adaptive boundary cuts short on dense-similarity questions. The memo's own tie-break — *"If adaptive variants beat fixed-100 on coverage without a genuine-recall cost … prefer the bounded gap rule; otherwise fixed-100 wins on explainability"* — resolves to **fixed**.

## Recommendation (for ruling)

**Flip the default `clusterPool` from `page` to `fixed:100` @ 768-dim pool vectors.** Rationale: strictly non-negative in every measured metric and space; decouples the clustering pool from the inherited pagination constant (the architectural smell that started this investigation); directly shrinks the near-duplicate crowd-out amplifier the contrarian-miss diagnosis demonstrated (near-dups fall from 1/5th of the pool to 1/25th); 100 is the four-source convention (sbert retrieve-100, Elasticsearch sampler default 100, Carrot2's ≥100 statistical minimum, our own eval runner) and sits comfortably inside the ANN plan. 60 would suffice on this corpus, but 100 costs the same and covers broader-relevance corpora. `page` and `score-gap` stay plumbed as comparison arms.

If ruled: the flip mints a new `RANKING_ALGORITHM_VERSION` with a [ranking-changelog](../../architecture/ranking-changelog.md) entry citing this report, updates `DEFAULT_RANKING` in `@soupnet/domain`, and recalibrates the synthetic-echo thresholds (the fixture-scale caveat in `eval/golden/README.md` §synthetic-echo-v1 already documents that pool variants degenerate there).

Not recommended from this data: score-gap as default (trails fixed, harder to explain); pools >133 (no gain, ANN cost cliff); any relevance-floor or demotion revival (out of scope by standing rulings).

## Soup.net activity

Checks this arc: `46ba63f5` (variant-blind grader fleet), `dc280520` (facet-level grade-3 calibration ruling), plus the sweep-motivating lineage (`bb952d78`, `81f40bbd`, P6 research check `12fe307d`). Feedback rows closed on prior checks per protocol.
