# Evidence memo: offline IR evaluation best practices

Research sub-agent memo for the check_recipe ranking-system build (brief: `docs/planning/check-recipe-ranking-system.md` §5.1). Topic: graded-relevance methodology, NDCG-family vs interleaving vs other offline approaches, golden-query-set construction and maintenance, and the known pitfalls. Sources are primary where possible (papers, production-search practitioner writing); quotes verified verbatim against the source text unless flagged. Verified 2026-07-16.

## 1. Graded relevance is the field's answer to "similar ≠ useful"

The canonical NDCG paper (Järvelin & Kekäläinen, ACM TOIS 2002) motivates graded judgments precisely because binary relevance can't distinguish a sloppy ranker from an excellent one:

> "The current practice of liberal binary judgment of topical relevance gives equal credit for a retrieval technique for retrieving highly and marginally relevant documents."
> — [Cumulated Gain-Based Evaluation of IR Techniques](https://faculty.cc.gatech.edu/~zha/CS8803WST/dcg.pdf) (verified from PDF text)

The DCG discount exists to model reader attention decaying down the list, not to justify truncation:

> "The second one is similar but applies a discount factor to the relevance scores in order to devaluate late-retrieved documents."
> — same source, abstract

They used a **four-point relevance scale**, and normalization against the ideal ordering (nDCG) makes scores comparable across queries. Production practitioners converge on the same scale size — James Rubinstein (search quality at eBay, Apple, Pinterest, LexisNexis): "For my money a 4 point scale works pretty darn well" ([Setting up a relevance evaluation program](https://jamesrubinstein.medium.com/setting-up-a-relevance-evaluation-program-c955d32fba0e)). He also prioritizes assessor quality over volume: "If you have to make a choice, get fewer queries or documents per query in favor of higher quality raters."

## 2. NDCG-family vs interleaving vs other approaches

**Offline metrics predict online outcomes better than folklore suggests, but the agreement is context-dependent.** Amazon's SIGIR 2023 study of 36 metrics on product search:

> "Offline metrics align well with online metrics: they agree on which one of two ranking models is better up to 97% of times" … NDCG has "a discriminative power over 99%".
> — [How Well do Offline Metrics Predict Online Performance of Product Ranking Models?](https://www.amazon.science/publications/how-well-do-offline-metrics-predict-online-performance-of-product-ranking-models) (Amazon Science / [ACM](https://dl.acm.org/doi/abs/10.1145/3539618.3591865))

Airbnb's 2025 experience report is the counterweight — their NDCG and conversion "are often … inconsistent," and:

> "offline evaluations cannot fully account for the user dynamics that occur when individuals interact with ranked lists."
> — [Harnessing the Power of Interleaving and Counterfactual Evaluation for Airbnb Search Ranking](https://arxiv.org/html/2508.00751v1)

**Interleaving** (Joachims 2002 lineage) is an *online* technique — it splices results from two rankers into one displayed list and scores which ranker's items win user engagement. Airbnb measured "about 50X speedup from A/B" in experiment sensitivity, but validation showed "Overall interleaving and A/B are directionally aligned 82% of the time. The correlation coefficient is 0.6." (same source). Takeaway: interleaving is a traffic-efficiency tool for systems with abundant live user interactions, not an offline regression tool. It is the wrong instrument for a CI gate; its production analogue for this system is the feedback log, not the harness.

## 3. Golden query sets: construction

The production-search term of art is the **judgment list**. Doug Turnbull (relevance consultant, *Relevant Search* author):

> "A judgment list defines a document's relevance for a query."
> — [What Is a Judgment List?](https://softwaredoug.com/blog/2021/02/21/what-is-a-judgment-list)

Two construction families: "Explicit Judgments: in a UX-study like environment, you recruit relevance evaluators to give direct feedback" vs "Implicit Judgments: you use the implicit behaviors of your users (clicks, purchases, etc) to generate judgments" (same source). LLM-as-judge is now a recognized third family, with a known failure mode: "LLM models are probabilistic by nature, so it is not uncommon to see an LLM model giving different grades to the same result" ([Elastic Search Labs, judgment lists](https://www.elastic.co/search-labs/blog/judgment-lists-search-query-relevance-elasticsearch)).

**Sizing depends on the job.** For statistical discrimination between rankers, Rubinstein's arithmetic: "Want to be able to detect a 2% effect size on a population of 10K queries with 95% confidence you'll need 4800 queries." For a smoke-level regression gate, Elastic's guidance is the opposite end: "You only need to identify the 5–10 most critical queries for your business case and define which documents you expect to see at the top of the results." Both are legitimate — a CI gate is closer to the small end; a tuning campaign that claims "variant B beats A" needs the large end.

**Sampling:** naive random sampling over-represents the long tail ("you'll likely get a bunch of uncommon queries because there are many more uncommon queries than common ones"); Rubinstein recommends "a random weighted sample where the weights are the number of people issuing a query" — i.e., stratify by real traffic.

## 4. Keeping judgment sets fresh

Test collections have a shelf life. SIGIR 2025 (Parry et al.) reproduced the classic Cranfield result that assessor disagreement doesn't disturb *system rankings*, but found that under heavy re-use "some models substantially degrade with new relevance judgments," providing "evidence that test collections can expire" ([arXiv:2502.20937](https://arxiv.org/abs/2502.20937)). UNVERIFIED at exact wording level beyond the quoted phrases (abstract accessed via fetch summary).

The encouraging counterpoint: re-judging against an evolved corpus can preserve evaluative power. A 2026 temporal-drift study found "model rankings on the document retrieval task remain strongly correlated (Kendall τ = 0.978 at Recall@50)" across corpus snapshots when judgments were reconstructed per snapshot ([Still Fresh? Evaluating Temporal Drift in Retrieval Benchmarks](https://arxiv.org/html/2603.04532)). Elastic's operational advice is simply cadence: "Update your judgment periodically to reflect new needs."

## 5. Pitfalls

**Pooling bias.** Judgments are only collected for documents some system surfaced; everything else is silently assumed non-relevant. Buckley, Dimmick, Soboroff & Voorhees (NIST):

> "the judgment sets produced by traditional pooling when the pools are too small relative to the total document set size can be biased in that they favor relevant documents that contain topic title words"
> "Any method of selecting documents to judge from early ranks of systems may incorporate a bias that reduces future reusability of the collection."
> — [Bias and the Limits of Pooling for Large Collections](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=51236) (verified from PDF text)

Direct consequence: a new ranking variant that surfaces genuinely good but previously-unseen items scores *worse* against a stale judgment set. The standard tripwire is the **Judged@k** metric — "Percentage of results in the top k (cutoff) results that have relevance judgments" ([ir-measures](https://ir-measur.es/en/latest/measures.html)) — track it in CI and treat a drop as "judgment set needs extending," never as "variant is worse."

**Implicit-feedback bias.** "users tend to click top results more often, even if they are not relevant" (Elastic, above) — position bias makes raw engagement a corrupt training/eval signal without correction. **Assessor incentive bias:** "Raters getting paid per-judgment have an incentive to deliver as many ratings per hour as possible" (Rubinstein).

**Metric gaming (Goodhart).** Optimizing a single relevance-max metric drives out diversity — this is exactly the failure the diversity-evaluation literature formalized. Clarke et al. (SIGIR 2008) introduced **α-nDCG**, "A version of nDCG that accounts for multiple possible query intents" ([ir-measures](https://ir-measur.es/en/latest/measures.html)), which decays the gain of each result that repeats an intent/nugget already covered above it. UNVERIFIED: I could not access the SIGIR 2008 full text ([ACM record](https://dl.acm.org/doi/10.1145/1390334.1390446)); the α-redundancy-penalty mechanism is standard textbook material but I could not quote it at source. Companion beyond-accuracy metrics: **intra-list diversity** (average pairwise dissimilarity of the returned list) and serendipity/novelty measures — survey: [Kaminskas & Bridge, Diversity, Serendipity, Novelty, and Coverage](https://www.semanticscholar.org/paper/0a2a1bfeea7a572a78cd12a79f3b00911aa9bba4).

## Recommendations for this system

The no-truncation, cluster-ordered, utility-times-surprise design constrains metric choice more than it complicates it:

1. **Use whole-list graded metrics; never @k as a gate on what's shown.** NDCG over the full returned list is the natural primary metric — its log discount rewards reordering (our only lever) without implying a cutoff, matching the "reorder, never truncate" ruling exactly. Report NDCG@k at several k (5, 10, 20) as *diagnostics* of attention-weighted quality, not as objectives.
2. **Pair every relevance metric with a diversity metric, and gate on the pair.** Because the objective is utility × surprise, a CI gate that maximizes NDCG alone will Goodhart the serendipity out of the system. Gate on "no significant regression in NDCG *and* no significant regression in α-nDCG-style intent coverage / intra-list diversity." The k-means cluster labels (or held-out topic labels in the golden corpus) serve as the "intents" α-nDCG needs — we already compute them.
3. **Grade on a 4-point *utility-to-the-querying-agent* scale, not topical similarity.** 0 = noise, 1 = topically adjacent but tells the agent nothing, 2 = useful, 3 = useful *and* not derivable from the query itself. Grade 3 operationalizes surprise inside the graded-relevance frame — a judgment an LLM judge can apply with a rubric, with periodic human spot-audit (the LLM-jury inconsistency and re-validation warnings above).
4. **Size in two tiers.** CI gate: ~30–80 golden queries per dataset, stratified across corpus clusters and query archetypes (broad discovery vs specific judgment call vs post-work logging), each with judged pools — Elastic-style "critical queries," cheap to keep green. Tuning campaigns: expand toward hundreds before claiming a variant wins (Rubinstein's power arithmetic; our corpus is small enough that judging deeply per query is cheaper than adding queries).
5. **Freeze the corpus, version the judgments, track the holes.** The planned clean/polluted golden-corpus snapshots eliminate corpus drift by construction — good. Version judgment sets alongside them; compute Judged@20 (or Judged@full-list) per run and fail *soft* (queue unjudged items for judging) rather than scoring them zero — this is the pooling-bias defense. Every new ranking variant's top results get pooled into the judgment queue before its score is trusted.
6. **Set an expiry review, not just an append process.** Test collections expire under heavy reuse; schedule a periodic re-judge pass (or judgment-transfer pass when the golden corpus is regenerated) and re-validate any LLM judge against the human-judged subset each time the judge model changes.
7. **Interleaving: out of scope offline; the feedback log is our online layer.** Provenance-gated `log_feedback` rows are this system's counterpart to interleaving credit assignment — use them to *propose* judgment updates (with position-bias caution), never to auto-mutate the golden sets.

## Soup.net activity

- **Discovery check:** `9697e6fa-7a67-4144-b8c3-987884fe21f8` (soupnet-oss, agent_id `a-ranking-research-offline-ir-2026-07-16`). Surfaced the standing rulings this memo's recommendations are shaped around: utility × surprise objective (`4111061d`, via briefing), always-return-full-clustered-results / no server-side abstention (`f4075800`), provenance-gated feedback reinforcement (`ff54eafd`), recall@20 99.0% HNSW validation at display-relevant k (`d2937d31`), and benchmark-design precedent (`2093a9e0`, `48411f49`).
- **Feedback logged:** check-feedback row on `9697e6fa` — results materially shaped recommendations 1, 2, and 7 (whole-list metrics to honor the no-truncation ruling; paired diversity gate to honor utility × surprise; feedback log as the online layer).
- **Judgment calls proceeded on:** treating interleaving as out-of-scope for the offline harness (evidence-backed); recommending a 4-point utility scale with an explicit surprise grade (synthesis — no direct precedent in corpus or literature for grading "surprise" as the top relevance grade; flagging for orchestrator review). **Escalated:** none blocking; the grade-3-as-surprise rubric in rec 3 is the one design invention here that deserves an orchestrator/operator ruling before it hardens into the harness.
- **No new recipes checked beyond the discovery check** — the memo's conclusions are research synthesis, not yet the human's decisions; the orchestrator should check recipes for whichever recommendations Andy adopts.
