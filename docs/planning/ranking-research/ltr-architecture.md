# Evidence memo: learning-to-rank system architecture (the shape, not the ML)

Research input for the check_recipe ranking-system build (docs/planning/check-recipe-ranking-system.md §5.3).
Question: how production LTR systems structure pipeline stages, feature availability, and logging — so our
non-ML pipeline adopts the conventions that keep ML open later without paying for ML now.

Sourcing note: quotes below were captured via web-fetch extraction on 2026-07-16; wording is verbatim as
extracted, but ellipses/joins inside quotes come from the extraction step. Anything load-bearing should be
spot-checked against the linked source before being quoted onward.

## Finding 1 — Production ranking is a staged funnel with explicit separation of concerns

Every mature system separates *candidate generation* (fast, coarse, recall-oriented) from *ranking*
(slow, precise, precision-oriented), and most add stages after scoring for business logic and presentation.

Eugene Yan's cross-industry survey ([System Design for Discovery](https://eugeneyan.com/writing/system-design-for-discovery/))
frames it as a 2×2 (offline/online × retrieval/ranking): retrieval is "a fast—but coarse—step" that narrows
millions to hundreds ("We trade off precision for efficiency to quickly narrow the search space"), while ranking
is "a slower—but more precise—step" where "we have room to add features that would have been infeasible in the
retrieval step."

NVIDIA Merlin's canonical four-stage decomposition ([Recommender Systems, Not Just Recommender Models](https://medium.com/nvidia-merlin/recommender-systems-not-just-recommender-models-485c161c755e),
Oldridge & Byleen-Higley) is retrieval → filtering → scoring → ordering. The stage boundaries encode *why*
they're separate: filtering exists because "there are items that you don't want to show to the user" and models
can't reliably enforce such constraints; ordering exists because "the best list is unlikely to fully align with
the individual item scores … we may want to provide a diverse set of items." Instagram Explore, Pinterest, and
Instacart are cited as running all four stages. Bing's L0–L4 cascade (L0 boolean, L1 BM25, L2–L4 learned
models) is the same pattern in search ([Lin, Nogueira & Yates, *Pretrained Transformers for Text Ranking*](https://arxiv.org/pdf/2010.06467) — UNVERIFIED: attribution seen in secondary summaries, not checked against the book text).

Solr's LTR module shows the minimal search-engine version: base retrieval plus an explicit re-rank window —
"Re-Ranking allows you to run a simple query for matching documents and then re-rank the top N documents using
the scores from a different, more complex query" (`reRankDocs=100`) ([Solr Reference Guide: Learning To Rank](https://solr.apache.org/guide/solr/latest/query-guide/learning-to-rank.html)).
Re-ranking depth is always an explicit, tunable parameter, never implicit.

**Mapping to us:** check_recipe already *is* this funnel — pgvector ANN (retrieval) → ACL/echo-suppression
(filtering) → hand-tuned scoring/demotion (scoring) → k-means clustering, cluster ordering, exemplar selection
(ordering/presentation). The industry lesson is not to add stages but to make these boundaries explicit and
typed, because each stage evolves on a different cadence and an ML scorer later is a drop-in replacement for
exactly one stage, not a rewrite.

## Finding 2 — Log the features you served, at serving time

The single most-repeated LTR operational rule is Google's Rule #29
([Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml)):

> "The best way to make sure that you train like you serve is to save the set of features used at serving time,
> and then pipe those features to a log to use them at training time."

Rule #31 explains why post-hoc reconstruction fails: "Beware that if you join data from a table at training and
serving time, the data in the table may change." Signals like feedback counts, reactions, and authorship stats
drift after the request; recomputing them next month gives you features the live system never saw. Solr encodes
the same rule as infrastructure: the `[features]` transformer exists "to support the calculation and return of
feature values for feature extraction purposes" — feature values ride along with the response so training data
is captured at serve time, not reconstructed.

The unbiased-LTR literature adds the second logging requirement: to ever use behavioral feedback (which
recipes got acted on) you must know *what was shown and where*. Position bias means top-ranked items get
disproportionate engagement, and counterfactual evaluation "evaluates a new ranking function using historical
interaction data … collected from a previously deployed ranking function" — which requires the presented
ranking and per-position exposure to be in the log ([Oosterhuis & de Rijke, WWW 2020 tutorial](https://ilps.github.io/webconf2020-tutorial-unbiased-ltr/WWW2020handout.pdf); [Ai et al., SIGIR 2018](https://dl.acm.org/doi/10.1145/3209978.3209986)).
Our analogue of "position" is richer than a list index: exemplar-vs-cluster-member, stub-vs-full-render
(`known_recipes`), and cluster order all determine what the agent actually attended to.

## Finding 3 — Feature stores solve definition sharing, not execution consistency; inline wins at our scale

Two distinct things are called "feature store." Solr's is a *declarative feature registry* — named feature
definitions in namespaces ("it is recommended that you organise all your features into stores which are akin to
namespaces") so the same definition serves live ranking and offline extraction. ML-platform feature stores
(Feast etc.) additionally materialize precomputed values across systems — and the critical finding is they
don't eliminate skew: "Feature stores manage data artifacts. They do not control execution. … Skew is caused by
movement—every time a feature crosses a system boundary, execution context changes, and consistency becomes
probabilistic rather than guaranteed" ([Why Feature Stores Didn't Fix Training-Serving Skew](https://dev.to/synapcores/why-feature-stores-didnt-fix-training-serving-skew-fad) — UNVERIFIED for neutrality: vendor-adjacent post, but consistent with Google Rules #29/#31/#32 and Finding 4).
The recommended remedy at small scale is unified execution: compute "features inline at query time" so training
and serving share one source. Rule #32 says the same: "Re-use code between your training pipeline and your
serving pipeline whenever possible."

**Mapping to us:** single Node process, single Postgres — no system boundary for features to cross. An external
feature store would *introduce* the skew problem we currently can't have. What we should copy is the registry
idea: one named, typed catalog of signal extractors, used by both the live pipeline and the offline regression
harness.

## Finding 4 — Why offline gains fail online, and how architecture prevents it

Richard Demsyn-Jones ([The stubborn persistence of online-offline inconsistency](https://simplicityissota.substack.com/p/the-stubborn-persistence-of-online))
identifies the dominant bug class as "features that are inadvertently computed differently between the two
settings" — DoorDash found offline features built from "the prior day's value" while "their online features
were 2, 3, or 4 days out of date," plus divergent null handling. His three remedies: structurally shared
calculation code, offline-computed features copied online, or "using logs of online features as the source for
our future offline modeling efforts." The other classic transfer-killers are logging-policy bias (your log only
contains outcomes for what the old ranker chose to show — the counterfactual-LTR problem above) and
distribution shift after launch. Google's Rule #37 prescribes measuring the gap itself: track the deltas
between training, holdout, next-day, and live performance so misalignment is detected, not assumed. And Rules
#4/#7 endorse exactly our current posture: "Keep the first model simple and get the infrastructure right," and
when ML arrives, convert existing heuristics into features rather than discarding them — our hand-tuned score
is a future feature, not future dead code.

## Recommendations for this system

**1. Signal/feature-context shape (TypeScript).** One immutable per-candidate signal record, hydrated once
after retrieval, carried through every stage:

```ts
interface CandidateSignals {           // computed once, read-only, serializable
  similarity: number;                  // raw, never mutated (standing ruling)
  bestStrategy: string;
  authorApiKeyId: string | null; authorUserId: string; isSameAgent: boolean; isSameSession: boolean;
  createdAt: string; decidedAt: string | null; isCurated: boolean;
  feedbackCounts: Record<Disposition, number>; feedbackProvenance: ProvenanceSummary;
  humanReactions: Record<string, number>;
}
interface RankingCandidate {
  traceId: string;
  signals: CandidateSignals;                    // inputs: fixed at hydration
  stageAnnotations: StageAnnotation[];          // outputs: appended per stage (score components, demotions
}                                               // applied + reasons, clusterId, exemplar flag, final slot)
```

Stages are pure functions `(candidates, ctx) => candidates` where `ctx` is the single config object — a
versioned *ranking policy* (`policyVersion` + full parameter values). Signals-as-inputs vs
annotations-as-outputs is the load-bearing split: every stage sees every signal (the brief's requirement), and
the annotation trail is the score decomposition LTR systems log. An ML scorer later replaces one stage function
and consumes `signals` as its feature vector unchanged.

**2. Log per request (Rule #29 applied).** One structured record per check: request id + agent_id + api_key_id;
`policyVersion` and resolved config; query text/embedding strategy; for every candidate that survived retrieval
(not just displayed ones): full `signals` as computed at serve time plus all `stageAnnotations`; the presented
layout (cluster order, exemplar ids, stub-vs-full per recipe, final positions); and joinability to later
feedback rows via trace/request ids. This is cheap now (JSONB table or JSONL, per the corpus's own
in-between-architecture recipe e6ae8966) and is the *only* thing that makes offline analysis, counterfactual
evaluation, and eventual training data possible — it cannot be reconstructed later (Rule #31).

**3. LTR conventions to adopt now, cheaply.**
- **Named feature registry** (Solr-style): one catalog `name → extractor(trace, ctx)`; live pipeline and the
  offline regression harness both import it (Rule #32; skew impossible by construction).
- **Explicit stage boundaries + re-rank depth in config** — never implicit constants.
- **Score decomposition retained per result**; displayed similarity never mutated, reorder-never-truncate
  (standing rulings from the corpus, consistent with the ordering-stage pattern: presentation logic is a
  separate stage, not a score mutation).
- **Hand-tuned scorer preserved as a named feature** when/if ML lands (Rule #7).
- **Do not build:** external feature store, click models, or IPS machinery — but the request log above keeps
  all three possible.
- **Measure the gap when anything learns** (Rule #37): the moment any signal is trained/fitted on logged data,
  add an offline-vs-live delta check to the eval harness rather than trusting offline numbers.

## Soup.net activity

- **Discovery check:** `b8f6f4e1-7e23-4c03-959d-15e8edae0968` (soupnet-oss, agent_id `a-ltr-arch-research-2026-07-16`).
  Surfaced: sibling offline-eval agent's check `9697e6fa` carrying the standing rulings (no floors,
  reorder-never-truncate, utility × surprise); `ff54eafd` (provenance-gated reinforcement — shaped the
  `feedbackProvenance` signal in Rec 1); `eb291228` (feedback signals gated behind offline evals — shaped Rec 3's
  "measure the gap"); `e6ae8966` (in-between architecture aimed at the sophisticated version — shaped Rec 2's
  JSONB/JSONL logging choice); `a91d29e9` (filter focuses / axes position — kept as separate concerns, not
  folded into scoring).
- **Feedback logged:** one `check-feedback` row on `b8f6f4e1` (impact=new, disposition=proceeded,
  story_fulfilled=yes).
- **Judgment calls:** proceeded on citing the vendor-adjacent dev.to post with an UNVERIFIED flag rather than
  dropping it (corroborated by Google's rules); proceeded on recommending inline signals over a feature store
  (directly supported by sources + our single-process reality); did not log new recipes — the memo's
  recommendations are researcher synthesis for the orchestrator, not yet the human's settled taste and judgment;
  escalating recipe-worthiness of the "signals-in/annotations-out" split to the orchestrator.
