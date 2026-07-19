# P7 cluster-ordering sweep — results and recommendation (2026-07-19)

The measured answer to [hypothesis P7](../../architecture/ranking-engine.md#presentation--budget) (member-count cluster ordering rewards echo-mass; relevance-first or corroboration-weighted ordering should surface the best cluster first). Report step of the sweep → report → ruling path; the ruling is the operator's. Lever + metrics landed in commit `9192f2a` (default `member-count`, byte-stable, no version mint).

## Setup

Three measurement contexts, because the lever's motivating scenario is a corpus *shape*: the contrarian-miss diagnosis's finding — *"Echo clusters win member-count by self-similarity; the metric rewards the failure mode"* (evals-side forensics, 2026-07-19) — only manifests where near-duplicate clusters exist.

- **`synthetic-echo-v1` polluted arm** — the motivating shape: 15 task-shaped near-duplicate deposits under one lineage over 30 durable recipes. Small-corpus caveats apply, but the echo-cluster geometry is exactly the diagnosed failure mode.
- **`synthetic-echo-v1` clean arm** — same corpus minus the lineage rows.
- **`hygiene-realscale`** (39,524 traces, both embedding spaces) — real scale, but the hygiene-CLEAN arm only: dense same-domain near-duplicates exist (dialog-distilled corpus) but no adversarial echo lineages. Real production corpora sit between the clean benchmark and the synthetic polluted arm — the diagnosis's own specimen was a real 1.3k corpus where a 15-member echo cluster anchored the display.

Metrics: `exemplarOrderNdcg` (DCG of displayed exemplar grades in display order over their own ideal) and `firstExemplarGrade` — the order-sensitive instruments added with the lever (aspectCoverage is order-blind and, as expected, identical across ordering variants everywhere). Runs: reports `2026-07-19T17-59` (gemini realscale), `18-1x` (local realscale + synthetic) in `eval/reports/` (gitignored, regenerable).

## Results — exemplarOrderNdcg / firstExemplarGrade

| context | member-count (default) | max-similarity | evidence-mass |
|---|---|---|---|
| synthetic **polluted** | 0.8631 / 0.1667 | **0.9262 / 0.2000** | 0.8631 / 0.1667 |
| synthetic clean | 0.9500 / 0.2000 | **1.0000 / 0.2333** | 0.9500 / 0.2000 |
| realscale local | 0.9485 / 0.5370 | 0.9497 / 0.5278 | 0.9485 / 0.5370 |
| realscale gemini | 0.9675 / 0.5741 | 0.9611 / 0.5463 | 0.9675 / 0.5741 |

Guardrails: flat-order Kendall tau exactly 1.0000 for every ordering variant in every run (the lever permutes the clustered summary's sequence only); aspectCoverage identical across ordering variants (order-blind, as designed); all calibrated thresholds green in every run.

## Findings

1. **Max-similarity delivers exactly where the diagnosis predicted.** On the echo-shaped polluted arm: +6.3pts exemplarOrderNdcg and +20% relative firstExemplarGrade — the echo cluster loses its member-count-won top slot to the most relevant cluster. On the small clean arm it reaches perfect ordering (1.0000).
2. **On clean corpora at real scale the effect is neutral to slightly negative** (local +0.1pt; gemini −0.6pt ndcg / −2.8pts first-grade — at or just beyond the ±0.2–0.4pt seeding-noise band). Where near-duplicate mass is honest topical mass, biggest-first is a reasonable proxy and relevance-first buys little.
3. **Evidence-mass is unmeasured, not refuted.** Both golden corpora are traces-only deliveries (zero discriminating evidence rows), so the mode degenerates to the legacy tie-break byte-identically. It needs an evidence-bearing golden set before it can earn or lose a place; the lever stays plumbed.
4. **The measurement gap that matters**: the real-scale polluted arm (the evals side's 1,984 staged echoes) was never delivered — *"regeneration costs ~$2.4/pass and needs the 6 per-persona accounts"* (golden-exports-p6 MANIFEST). That arm would measure the motivating scenario at real scale and settle the conditional cleanly.

## Recommendation (for ruling)

Two defensible rulings; my lean is the first:

**(a) Flip the default to `max-similarity`.** The payoff is asymmetric: large exactly in the failure mode the product actually exhibits (the diagnosis's specimen was a *real* corpus, and production deposits skew near-duplicate-heavy — dialog-distilled and hypothesis-append shapes), and the clean-corpus cost is within-or-near noise. It is also the more explainable contract to agents: "the most relevant cluster leads" beats "the biggest cluster leads" (relevance-first cluster ranking is the standard remedy when size ordering rewards redundancy). Mints a version + changelog entry.

**(b) Hold member-count pending the real-scale polluted arm.** The strict reading: the only real-scale numbers we have are neutral-to-slightly-negative, and the big win is fixture-scale. Request the polluted-arm regeneration from the evals side (~$2.4) and re-run before flipping.

Either way: evidence-mass stays plumbed awaiting evidence-bearing golden material, and the adaptive-depth design (backlog `[DESIGN]`, P3 extension) can proceed on top of whichever ordering rules — its "top 2 clusters" prerequisite is satisfied by max-similarity more defensibly than by member-count.

## Soup.net activity

Lever design check `d8b369b2` (downstream-permutation placement — proceeded, corpus confirmed); sweep lineage `7f3b8e51` (production-space decision framing). Feedback rows logged per protocol.
