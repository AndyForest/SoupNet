# P8 MMR display-selection sweep — results and recommendation (2026-07-20)

The measured answer to [hypothesis P8](../../architecture/ranking-engine.md#presentation--budget): does MMR-with-banded-reach (one industry-standard mechanism) beat the per-check k-means + pool + ordering stack? Report step of the sweep → report → ruling path. Lever landed in commit `de88f94` (default `cluster`, byte-stable, no mint); the operator direction it answers, verbatim: *"We have embeddings. We want to use those to surface the closest but still relatively unique other recipes. Doesn't seem that complicated."* and the what-if: *"Let's say that the top fixed 100 are all basically the same. Then MMR doesn't get us anything, right?"* (answered by the score-banded pool: reach extends by score, not count).

## Setup

Variants: shipped baseline (k-means over fixed:100, max-similarity order) vs `mmr` at λ 0.4 / 0.6 / 0.8 over a `band:0.15` pool (minSize 100, size 1500). Three measurement contexts: the echo-shaped synthetic set (the diagnosed failure mode), the graded real-scale set (gemini — quality guardrail), and **the operator's real production corpus** (1,815 traces + 4,239 evidence rows, export of 2026-07-20; ungraded — measured by the grade-free `displayRedundancy` metric plus side-by-side display captures for operator judgment, `eval/golden/andy-corpus/display-compare.md`, local-only). Probe methodology (operator correction 2026-07-20: *"the sample recipes … are not properly formed recipes. They are framed as intentions rather than taste / judgement decisions. Perhaps just select some actual recipes instead?"*): the ten probes are **real corpus recipes re-checked verbatim**, each excluded from its own results — exactly a real check's deposit shape.

## Results

**Synthetic echo shape — the failure mode. MMR is a step-change win:**

| metric (polluted arm) | baseline (k-means) | mmr λ0.6 | mmr λ0.4 | mmr λ0.8 |
|---|---|---|---|---|
| firstExemplarGrade | 0.2000 | **0.7667** | 0.7667 | 0.7667 |
| aspectCoverage | 0.6393 | **0.7083** | 0.6726 | 0.6917 |
| exemplarOrderNdcg | 0.9262 | 0.9313 | 0.9455 | 0.9567 |
| tokenEfficiency (session overlay) | 0.775 | 0.786 | 0.768 | 0.781 |

The first thing the agent reads jumps from grade 0.6/3 to grade 2.3/3 — nearly 4× — at every λ; on the clean arm firstExemplarGrade reaches 0.9333 and coverage 0.7560–0.7952. The session-rendering interplay is intact (tokenEfficiency preserved; known-set stubbing proven on the MMR path in the regression suite).

**Graded real-scale (gemini) — neutral within known bias:** aspectCoverage ±0.3pt (λ0.4 slightly ahead at 0.3708 vs 0.3683), exemplarOrderNdcg −1.4pt, firstExemplarGrade −2.8pt, displayRedundancy improves 3.5–4.2pts (0.7935 → 0.7512–0.7586). **Caveat that biases these numbers against MMR:** the utility grades cover the fixed-100-pool retrievals; MMR's band pool (up to 1,500) reaches candidates the graders never saw, and every ungraded candidate counts as grade 0 — so MMR's graded metrics at real scale are a lower bound. Guardrail tau exactly 1.0 for every variant (flat surface untouched).

**The operator's real corpus (real-recipe probes):** displayRedundancy baseline 0.7199, mmr λ0.6 0.7575, λ0.4 **0.6886**, λ0.8 0.7689. The λ0.6 number is HIGHER than baseline, and that is the metric's honest limitation, not MMR's failure: on a focused real probe the relevant region is dense, so five on-topic picks are naturally mutually similar, while k-means earns "diversity" partly by spending display slots off-topic — diversity-of-display and usefulness-of-display diverge exactly here. The decisive evidence on this ungraded corpus is the side-by-side: MMR leads with the most relevant recipe at its honest rank while the shipped display's top slot repeatedly goes to a cluster's centroid-nearest member rather than its best — e.g. on the pg-boss probe, config A's #1 is a different project's RAG recipe at 80.0% while config B's #1 is the corpus's founding 4-table embedding-pipeline decision at **85.2%**, a recipe the shipped display never surfaces at all (buried as a non-exemplar member of a 37-recipe cluster). λ0.4 delivers below-baseline redundancy if the diversity-lean setting is preferred.

## Findings

1. **MMR wins decisively in the failure mode and on the operator-eyeball layer; graded clean-corpus metrics are neutral-within-bias.** The near-4× first-read-quality gain on the echo shape is the largest effect any lever has produced in this program. The one metric MMR "loses" at λ0.6 — real-probe displayRedundancy — is the proxy diverging from usefulness (on-topic picks are naturally mutually similar), which is itself a finding about the metric.
2. **Exemplar-based display has a structural flaw MMR removes**: a k-means exemplar is the cluster's centroid-nearest member, not its most relevant — so the best recipe for a check can be permanently invisible (never an exemplar, only a member count). MMR selects by relevance directly, so the best recipe always leads.
2. **The what-if is answered mechanically**: the band pool extends reach by score, so a homogeneous top cannot starve the selection — demonstrated in the regression suite (MMR+band displays a topic the fixed pool cannot reach).
3. **λ0.6 is the balanced default** (best failure-mode coverage; the conventional setting); λ0.4 maximizes diversity slightly at a small order-quality cost; λ0.8 defeats the purpose.
4. **The architectural payoff**: one standard, citable mechanism (Carbonell & Goldstein 1998; LangChain parity) subsumes per-check k-means, the pool-size question, and the P7 ordering permutation. The pipeline's clustered stages remain for the corpus-summary surfaces (map, briefing) where clustering is genuinely the right tool.

## Recommendation (for ruling)

**Flip `displaySelection` to `mmr` (λ 0.6) with the `band:0.15` pool as the check-path default** — version mint + changelog. Follow-up simplification (separate commit after the flip settles): retire the now-moot check-path levers from the default path documentation and mark P6/P7 as subsumed on the check surface (they remain live for map/briefing clustering). If preferred, a holding option is a per-request opt-in period first — but the evidence asymmetry (huge failure-mode win, bias-bounded neutral elsewhere, operator-visible improvement on the real corpus) supports flipping directly.

## Soup.net activity

Design checks `257950f3` (reuse-over-fork, agent), `ee4479c4` (first-principles reframe); operator direction quotes above; sweep lineage in the changelog. Feedback rows logged per protocol.
