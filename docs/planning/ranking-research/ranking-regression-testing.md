# Evidence memo: Regression testing for ranking / recommender systems

Research sub-agent memo for the check_recipe ranking-system build (brief: `docs/planning/check-recipe-ranking-system.md` §5.2). Topic: golden-query regression suites, metamorphic testing for ranking, guardrail metrics and no-regression gates, threshold- vs statistics-based change gating, and per-stage vs end-to-end evaluation. Date: 2026-07-16.

## 1. Golden-query regression suites

The search industry's standard offline regression instrument is the **judgment list** (a.k.a. golden set / test collection):

> "A curated set of search queries paired with relevance ratings for their corresponding results, also known as a test collection."
> "When you make changes to your search engine, a judgment list can quantify the impact of those changes on result quality."
> — Elastic Search Labs, [Search quality evaluation with judgement lists](https://www.elastic.co/search-labs/blog/judgment-lists)

Quepid (OpenSource Connections, open-source) operationalizes this as **test-driven relevance**: rated queries function like unit tests, so tuning one query and silently breaking others becomes visible ([quepidapp.com](https://www.quepidapp.com/), [Quepid open-sourcing announcement](https://opensourceconnections.com/blog/2019/07/25/2019-07-22-quepid-is-now-open-source/)). Industrial semantic-search teams follow the same pattern; a CIKM 2024 industrial workshop paper describes it directly:

> "we design a pipeline that defines a golden query set, retrieves the top K results for each query, and sends calls to GPT 3.5 with formulated prompts. Our semantic evaluation pipeline helps identify common failure patterns and goals against the metric for relevance improvements."
> — Zheng et al., [Semantic Search Evaluation](https://arxiv.org/abs/2410.21549) (CIKM 2024 IRS workshop)

On CI integration and maintenance of golden datasets:

> "With a solid golden dataset, offline checks become fast and predictable. Compare outputs to reference answers and flag regressions before anyone touches production."
> "Favor small, frequent updates over rare, giant refreshes. Pull fresh scenarios from production, then re-label high-impact slices."
> "Version prompts, datasets, and graders; keep a changelog for schemas and rubrics."
> — Statsig, [Golden datasets: Creating evaluation standards](https://www.statsig.com/perspectives/golden-datasets-evaluation-standards)

The same source stresses protecting historical baselines so a metric/rubric change cannot "masquerade as a model win" — i.e., version the metric code together with the dataset. Practitioner guidance converges on 30–50 realistic queries as a useful starting size, grown by adding every production failure as a new case (Statsig, above; also [qaskills.sh RAG regression guide](https://qaskills.sh/blog/rag-regression-testing-guide) — UNVERIFIED: secondary blog, sizes are heuristics not research findings).

## 2. Metamorphic testing for ranking

Metamorphic testing (MT) solves the oracle problem for ranking — you can't label every output, but you can assert **relations between outputs of related runs**:

> "The MRs are properties of the function under test. An important (and usually missed) attribute of MR is that they relate *multiple* inputs to their expected outputs."
> — [Application of property-based testing tools for metamorphic testing](https://ar5iv.labs.arxiv.org/html/2211.12003) (arXiv 2211.12003)

**For query-based systems**, Segura et al. defined Metamorphic Relation Output Patterns (MROPs) — Equality, Equivalence, Subset, Disjoint, Complete, Difference — each expressed as set operations between the outputs of an original and a follow-up query (e.g., adding a restrictive filter must yield a subset of the original results). Sources: [Metamorphic Relation Patterns for Query-Based Systems](https://personal.us.es/sergiosegura/files/papers/segura19-met.pdf) (IEEE/ACM MET 2019); [Automated Generation of Metamorphic Relations for Query-Based Systems](https://dl.acm.org/doi/10.1145/3524846.3527338) (ICSE MET 2022). UNVERIFIED-verbatim: PDF was binary to my fetcher; pattern list confirmed across two independent secondary descriptions.

**For search engines**, Zhou et al. (IEEE TSE 2016) ran MT against Google/Bing/Baidu with user-perspective relations such as MPSite — "if original query Q finds page P in domain D, the follow-up query 'Q site:D' should still find page P" — detecting both content and **ranking-consistency** failures without any ground-truth relevance labels ([Metamorphic Testing for Software Quality Assessment: A Study of Search Engines](https://www.researchgate.net/publication/282965915_Metamorphic_Testing_for_Software_Quality_Assessment_A_Study_of_Search_Engines); UNVERIFIED-verbatim, quote via secondary source).

**For recommender systems**, an empirical study designed RS-specific MRs and ran them against LibRec, PREA, and Surprise, concluding MT "is effective in automatically revealing the reliability problems in recommender systems, without requiring test oracles" ([An empirical study on metamorphic testing for recommender systems](https://www.sciencedirect.com/science/article/abs/pii/S0950584924000156), Information & Software Technology 2024; UNVERIFIED-verbatim, abstract-level). A 2024 follow-on applying MT to LLM recommenders defines concrete relation types — rating multiplication ("For all the items in the prompt for each user, the ratings for each item and the total rating is multiplied by a constant λ integer"), rating shifting, and noise-injection relations — and, importantly for us, measures violation **as rank correlation between the two output lists**: Kendall τ, Rank-Biased Overlap (RBO, top-weighted), and overlap ratio ([Metamorphic Evaluation of ChatGPT as a Recommender System](https://arxiv.org/html/2411.12121)). RBO in particular fits ranking regression because it weights agreement at the top of the list.

The orchestrator's example invariant — "adding an irrelevant document must not reorder the rest" — is an instance of this family (input-addition relation, asserted via Kendall τ = 1 on the surviving items). I did not find that exact sentence in a primary source; treat it as our own instantiation of the Segura/Zhou pattern family, which is well-precedented.

## 3. Guardrail metrics and no-regression gates

The experimentation literature separates **success metrics** (must improve) from **guardrail metrics** (must not degrade). Spotify's decision-rule paper is the strongest primary source on gating mechanics:

> "First, we show that if guardrail metrics with non-inferiority tests are used, the significance level does not need to be multiplicity-adjusted for those tests. Second, if the decision rule includes non-inferiority tests, deterioration tests, or tests for quality, the type II error rate must be corrected to guarantee the desired power level for the decision."
> — Schultzberg, Ankargren & Frånberg (Spotify), [Risk-aware product decisions in A/B tests with multiple metrics](https://arxiv.org/abs/2402.11609)

Key mechanics: a **deterioration test** is an inferiority test ("is treatment significantly *worse* than control?") applicable to any success or guardrail metric; a **non-inferiority test** requires the metric to be provably not-worse-than-margin. Practitioner treatments: [Eppo on guardrail metrics](https://www.geteppo.com/blog/what-are-guardrail-metrics-with-examples), [VWO on guardrails](https://vwo.com/blog/guardrails-in-testing/) (the latter reports Airbnb's "Experiment Guardrails" system catching a checkout change that boosted bookings but lowered review scores — UNVERIFIED: vendor blog retelling).

## 4. Change gating: thresholds vs statistical tests

For offline golden-set comparisons the canonical IR result is Smucker, Allan & Carterette (CIKM 2007), [A comparison of statistical significance tests for information retrieval evaluation](https://dl.acm.org/doi/10.1145/1321440.1321528): across TREC runs there is **little practical difference between the paired t-test, bootstrap, and randomization tests**, while the Wilcoxon and sign tests detect poorly and can produce false detections (UNVERIFIED-verbatim; finding is widely reproduced, e.g. [Urbano et al. 2019](https://arxiv.org/pdf/1901.10696)). Implication: if you gate statistically, use a **paired** design over the fixed golden queries with t-test or permutation, never sign-style tests.

But the statistical route assumes irreducible noise. Our harness runs deterministic server-side math (stub embeddings, fixable seeds) over frozen corpus pairs — in that regime the stronger practice is the Statsig one: set fixed thresholds "just below the current baseline so the gate is not noisy" (paraphrase; see Statsig link above), after first **measuring run-to-run variance** (seed sweep) to know the noise floor. Hard invariants (conservation properties, §6) should be exact asserts, not thresholds.

## 5. Per-stage vs end-to-end evaluation ("fix one stage, lose it downstream")

Multi-stage pipelines structurally decouple stage metrics from end-to-end outcomes. A 2026 reranking study frames why: rerankers operate on "a *conditional* decision set induced by the upstream retriever" ([Scaling Laws for Reranking in Information Retrieval](https://arxiv.org/html/2603.04816v1)) — every stage's measurable behavior is conditioned on what upstream handed it, so improving a stage in isolation says nothing about what downstream stages preserve. In cascade designs, downstream quality is mathematically capped by upstream recall (the "recall ceiling"); conversely, upstream errors can mask downstream improvements entirely. Search-result summaries reported cases where the best end-to-end model was only third-best on recall@100 (UNVERIFIED: could not trace to a single primary source).

RAG evaluation practice has converged on the resolution — **both, with distinct jobs**:

- End-to-end evaluation "measures final answer quality regardless of intermediate steps but makes diagnosing failures difficult"; component evaluation "isolat[es] issues and enabl[es] targeted fixes, but may miss integration bugs" ([Evidently AI, RAG evaluation guide](https://www.evidentlyai.com/llm-guide/rag-evaluation); UNVERIFIED-verbatim, close paraphrase). The recommended structure: **gate on end-to-end, diagnose per-stage** ([Kili Technology](https://kili-technology.com/blog/rag-evaluation-guide-measuring-retrieval-and-generation-as-separate-problems), [Braintrust](https://www.braintrust.dev/articles/what-is-rag-evaluation)).

This is exactly our echo-demotion failure: echo-at-top-rank improved 0.779→0.191 at the demotion stage, but pool composition and cluster ordering (memberCount desc) absorbed the benefit, recovering only ~15–17% end-to-end. A stage-level gate would have passed the change; only an end-to-end metric over the rendered output catches absorption.

## Recommendations for this system

1. **Two-tier metric structure, gate on the outer tier.** Per-stage diagnostics (echo share of candidate pool; echo rank after demotion; echo exposure per cluster; exemplar echo rate) are reported but never sufficient to pass. The CI gate binds to **end-to-end metrics computed on the final rendered response** of golden clean/polluted corpus pairs: top-weighted echo exposure (RBO-style position weighting), plus utility × surprise proxies. Rule of thumb from the motivating failure: *a stage metric that improves without end-to-end movement is itself a red flag — the harness should say which downstream stage absorbed it.*
2. **Stage-attribution waterfall.** Because the pipeline is explicit (pool → rank → cluster assignment → cluster order → exemplar selection → render), compute the echo-exposure metric at each stage boundary and report the delta waterfall per change. This makes "absorbed downstream" a first-class, visible harness output rather than a post-hoc investigation.
3. **Hard invariants as exact asserts (they encode our rulings).**
   - *Conservation:* output recipe-ID multiset == candidate multiset at every ranking-path stage (reorder, never truncate).
   - *Display fidelity:* rendered similarity percentages bit-identical to raw cosine (never mutated).
   These are metamorphic Equality/Complete relations (Segura) and should fail the build on any violation, no threshold.
4. **Metamorphic relations that fit no-truncation.** (a) *Irrelevant-addition stability:* add one off-topic recipe to a golden corpus; all previously-present items keep their relative order (Kendall τ = 1 on survivors) and none disappear. (b) *Echo-injection monotonicity:* injecting a same-agent/same-session echo must not increase end-to-end echo exposure, and must leave non-echo relative order unchanged. (c) *Scope subset (Segura Subset pattern):* restricting `read_recipe_books` yields a subset of the unrestricted candidate pool. (d) *Input-order permutation:* shuffling candidate arrival order leaves the output identical — catches hidden seed/order dependence in k-means. Note k-means is the stochastic stage: pin seeds and initialization in the harness or relations (a)/(d) will flake.
5. **Thresholds over statistics, given determinism.** With stub embeddings and pinned seeds the harness is deterministic; use fixed thresholds set just below current baseline after a seed-sweep establishes the noise floor. If any stage stays stochastic, gate that metric with a paired permutation or t-test over golden queries (Smucker et al.: t/bootstrap/permutation equivalent; avoid Wilcoxon/sign), and per Spotify: non-inferiority guardrails need no alpha multiplicity adjustment, but power must be corrected when many guardrails must jointly pass.
6. **Golden-set lifecycle.** Version corpus pairs, metric code, and thresholds together with a changelog; every production regression becomes a new golden pair (small frequent additions over big refreshes); protect historical baselines so metric changes can't masquerade as ranking wins.

## Soup.net activity

- **Briefing:** `get_briefing` called with task purpose (biased exemplars surfaced the utility × surprise ruling recipe 4111061d and the regression-harness sequencing recipe aae000d2).
- **Discovery check:** `2f4ce29e-8ddb-446b-a82d-a0b50c0866d4` (soupnet-oss, agent_id `a-ranking-research-regression-2026-07-16`). Surfaced: ff54eafd (provenance-gated reinforcement — echo pollution lives in confident rows), cde0353d via related evidence ("the failure localizes downstream of ranking" — the motivating failure itself), 9697e6fa (sibling sub-agent's offline-IR-evaluation discovery check — confirms fleet rulings are consistently stated), 4111061d (utility × surprise objective). These shaped §5 framing and Recommendations 1–2 (gate end-to-end, attribute per stage) and kept the memo aligned with the no-truncation rulings.
- **Feedback logged:** check-feedback row on 2f4ce29e (impact=big, disposition=proceeded, story_fulfilled=yes).
- **Judgment calls proceeded:** treating the "adding an irrelevant document must not reorder the rest" invariant as our own instantiation of the Segura/Zhou MR family rather than sourcing it to a primary paper (flagged in §2); recommending deterministic thresholds over statistical gates given the stub-embedding harness. **Escalated:** none — no conflicts with standing rulings found.
