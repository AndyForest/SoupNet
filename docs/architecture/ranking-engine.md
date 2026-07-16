# The recipe-check ranking engine

> **Who this is for.** (1) A person new to this project who wants to understand what the ranking engine is for, how it works today, and how we'll know it's working — assuming no knowledge of decisions we've already made. (2) The AI agents building the companion evaluation workstream (currently private), for whom the [hypothesis register](#5-the-hypothesis-register) is the shared research agenda.
>
> **What this is not.** Not an implementation reference ([search-algorithms.md](search-algorithms.md) has the exact algorithms and code locations), not the math ([research-foundations.md](research-foundations.md)), not a history (the [ranking changelog](ranking-changelog.md) carries the timeline), and not the original build plan ([the implementation brief](../planning/check-recipe-ranking-system.md)). This page is the current truth plus the near future, summarized, with every detail linked. Facts here are quoted verbatim from their sources — if you find an unquoted number, treat it as a bug in this doc.

## 1. What this engine is for

Soup.net's core operation is the **recipe check**: an AI agent working for a human submits the judgment call it's facing — *"As a data engineer mapping client GL codes, I prefer…"* — and gets back the most similar judgments already recorded in the human's corpus, together with their evidence. Checking is also logging (the submitted recipe becomes part of the corpus — the stigmergic trick the [product README](../../README.md) explains), which means the ranking engine sits between everything agents have ever deposited and the small slice one agent sees at its moment of decision.

That framing gives the engine five goals, and everything else in this document serves one of them:

1. **Return the judgment that matters** — from the whole readable corpus, surface what bears on this call: the human's own prior ruling, a collaborator's, or the closest adjacent precedent.
2. **Include the surprise** — the objective is deliberately **utility × surprise**, not relevance-max: the check exists to bring back the adjacent judgment the agent didn't know to ask for, so pure similarity ordering would optimize away part of the value.
3. **Fit the caller's budget** — agent context is scarce, so the response reshapes itself to a requested size: results are clustered into representative exemplars, and the caller can steer with an explicit cluster count or a character budget ([§3, stage 5](#stage-5--clustering-to-the-callers-budget)).
4. **Stay sharp as the corpus ages and fills** — a heavily-used, multi-agent, months-old corpus must answer as well as a fresh one. Self-pollution resistance (the current headline problem) is one instance of this goal; temporal decay and reinforcement are its future instances.
5. **Be an experimentation platform, not a final algorithm.** Operator direction, verbatim: *"We're not building the final engine here, we're building a system that we can try experiments with, and soupnet-evals can test and regression test."* (Andy, design review, 2026-07-16 — recipe `a7108776`). Every stage occupant is replaceable, every parameter is a named lever, and an idea should become an experiment by touching an [extension point](#4-extension-points--how-an-idea-becomes-an-experiment), not by rewriting the system.

## 2. The rules every experiment must honor

Five standing rulings constrain every lever and every future occupant of every stage (recorded in [the brief §2](../planning/check-recipe-ranking-system.md) and in the corpus):

1. **No relevance floors or cutoffs, ever.** Levers reorder; they never truncate, and displayed similarity percentages are never mutated. *"Demotion reorders, never truncates, and never mutates displayed percentages."* ([brief §2](../planning/check-recipe-ranking-system.md))
2. **Server-side order is load-bearing.** Ordering improvements belong in the engine, not in client-side re-sorting. ([brief §2](../planning/check-recipe-ranking-system.md))
3. **No LLM on the ranking path.** *"the server does math (embeddings, search, clustering, ranking); agents do the reasoning."* ([brief §2](../planning/check-recipe-ranking-system.md)) The server stays cheap at any scale, and results stay deterministic and auditable.
4. **Reinforcement gates on provenance independent of the reporting agent.** The measured reason, from the audit of 705 agent feedback rows: *"70.5% of the 'useful' hits were backed by the agent's own run-date hypothesis-append echoed back, not durable user history (only 27% from genuine history)."* (feedback-calibration audit, 2026-07-09, recipe `ff54eafd`) — an agent's own confidence cannot be the signal that protects or boosts a recipe.
5. **Defaults never change silently.** Every default flip is a measured, versioned, human-ruled event ([§how a change ships](#how-a-ranking-change-ships)). *"Defaults never change silently."* ([brief §3c](../planning/check-recipe-ranking-system.md))

## 3. The pipeline, stage by stage

One pipeline serves every surface ([search-pipeline.ts](../../apps/backend/src/services/search-pipeline.ts)); a single config object ([`RankingConfig`](../../packages/domain/src/ranking-config.ts)) flows through it. Each stage below states what goes in and what comes out, with the detail linked.

```mermaid
flowchart TD
    A["Recipe check arrives<br/>(/check or MCP check_recipe)"] --> B["0 · Deposit + embed<br/>out: stored trace,<br/>one vector per strategy"]
    B --> C["1 · Candidate retrieval<br/>out: EVERY readable match,<br/>ordered by similarity + exact count"]
    C --> D["2 · Scoring<br/>out: same candidates,<br/>reordered by adjusted score"]
    D --> E["3 · Pagination<br/>out: the top page slice<br/>(default 20)"]
    E --> F["4 · Signal record<br/>out: authorship + dates<br/>attached to each candidate"]
    F --> G["5 · Clustering to budget<br/>out: k clusters, each an<br/>exemplar + member count"]
    G --> H["6 · Cluster ordering<br/>out: the display order"]
    H --> I["7 · Evidence discovery<br/>out: related evidence<br/>from other recipes"]
    I --> J["8 · Projection (optional)<br/>out: x/y positions vs<br/>two concept axes"]
    J --> K["9 · Rendering<br/>out: HTML / JSON / MCP response<br/>+ ranking version block"]
```

### Stage 0 — deposit and embedding

**In:** the submitted recipe text (+ evidence). **Out:** a stored trace, and one embedding vector *per strategy*. Every recipe is embedded several ways concurrently — the claim text alone (`full_document`, synchronous), the claim plus its evidence (`full_recipe_context`, async), and a set of experimental preamble variants (`exp_*`) that a worker backfills across the whole corpus automatically. The multi-strategy pipeline is itself experiment infrastructure, by design: *"It's essential, since it allows different embedding approaches to also be concurrently generated so we can evaluate and iterate that part of the system too."* (Andy, 2026-06-10, recipe `ad08a8e1`). Which strategies *compete in production search* is a separate, deliberate list ([`PRODUCTION_SEARCH_STRATEGY_IDS`](../../packages/domain/src/embedding-strategies.ts)). Detail: [search-algorithms.md §Embedding Strategies](search-algorithms.md#embedding-strategies).

### Stage 1 — candidate retrieval

**In:** the query vector (the just-embedded recipe — reused, so this stage makes no additional embedding calls) plus the key's readable recipe books, and optionally `filter` keywords that narrow candidates by substring match. **Out:** **every** readable recipe that matches, ordered by cosine similarity, with an exact total count — **the list is ordered here, never shortened**. Each recipe's best score across the production strategies is its score (so a recipe can match on its claim text *or* its evidence context, whichever is stronger). The count query is exact by ruling: *"totalResults — an exact COUNT(DISTINCT trace) with no distance work (~5ms). Keeps the recall un-cap's honesty (operator decision 2026-07-01: no silent candidate cap)"* ([vector-search.service.ts](../../apps/backend/src/services/vector-search.service.ts)). An approximate index (HNSW) accelerates the common case with an exact-scan fallback. Detail: [search-algorithms.md §Main Search](search-algorithms.md#main-search--pure-semantic-2026-04-11).

On "how loose is the matching": there is no looseness knob and no threshold — cosine similarity orders *all* candidates (rule 1). What varies is how much of that ordered list survives into the displayed summary, which is stages 3 and 5.

### Stage 2 — scoring

**In:** the ordered candidate list plus request context (which key is asking, when). **Out:** the same candidates — same multiset, same displayed similarity per recipe — reordered by an *adjusted ranking score*. This stage is where "what ranks a recipe beyond raw similarity" lives, and it is designed as a **replaceable occupant**, because the current occupant is knowingly imperfect.

The current occupant is **echo demotion** (shipped OFF): a candidate written by the *same API key* making this check, *recently*, and *not curated*, has its ranking score multiplied down so it sorts below cross-agent recipes of similar similarity. Why it exists: *"an agent that both reads and writes the same corpus will, over repeated runs, start retrieving its own recent task-shaped queries instead of durable recipes — accuracy fell 0.706 → 0.538 over five runs before we caught it."* ([benchmarks.md](../benchmarks.md)). Design doc: [echo-suppression.md](../planning/echo-suppression.md); math: [ranking.ts](../../packages/domain/src/ranking.ts).

Its known weakness is the identity signal, named by the operator: *"we don't actually know if it's the same agent, since all the sub-agents share the same API key"* (Andy, design review 2026-07-16, recipe `4d25aec9`) — and the seemingly-simpler fix of hiding an agent's own recipes is a ruled-out dead end: *"that's exactly how sub-agents cross communicate, by seeing the recent relevant recipes from their peer sub-agents."* (same recipe). The successor direction — explicit session identity — is hypothesis [S1 in the register](#identity--scoring), tracked in [the backlog](../backlog.md).

### Stage 3 — pagination

**In:** the reordered full list. **Out:** the top page slice (`per_page`, default 20) plus the honest total count and page arithmetic. This is the first place the list gets shorter — *after* scoring, so a demoted recipe can move to a later page but never off the result set. Everything downstream (clustering, evidence, rendering) summarizes **this page**; the count tells the caller how much more exists, and `page` fetches it.

### Stage 4 — the per-candidate signal record

**In:** the page of candidates. **Out:** each candidate now carries a concrete record of ranking-relevant facts — [`CandidateSignals`](../../packages/domain/src/ranking-config.ts): which API key and user authored it, its raw append time, its deliberate decision date (`decided_at`) if backfilled, and (only when a lever needs them) how many humans marked it *still true* and how many *other* agents reported it useful. The point of this stage is architectural: any stage after it — and any future lever — reads a field from this record instead of adding new database plumbing. The cheap fields ride the existing row load; the corroboration counts hydrate lazily.

### Stage 5 — clustering to the caller's budget

**In:** the page of candidates, their vectors, and the caller's size steer — either an explicit cluster count (`clusters`) or a character budget (`max_chars`), from which the engine estimates how many exemplars fit: *"Auto-K estimation: `k = floor(budget / (avgChars × 3.5))`"* ([search-algorithms.md, parameter table](search-algorithms.md#endpoint-inventory)). **Out:** k clusters, each represented by its **exemplar** — the real recipe nearest the cluster's center (never generated text — rule 3) — plus a member count so the caller knows what each exemplar stands for. This is how goal 3 (fit the budget) is met: clustering *is* the response-size mechanism. `expand=true` bypasses it and returns the flat page. Algorithm: k-means with deterministic k-means++ seeding, [clustering.service.ts](../../apps/backend/src/services/clustering.service.ts); math and lineage: [research-foundations.md §2](research-foundations.md).

### Stage 6 — cluster ordering

**In:** the k clusters. **Out:** their display order — the first thing the caller reads. Default: biggest cluster first. The alternative occupant (`demotion-adjusted-mass`, shipped OFF) sorts clusters by the summed adjusted scores of their members, using the exact penalties stage 2 applied, so a large pile of demoted echoes sinks below a smaller durable cluster. Ordering only — membership, exemplars, and percentages are untouched, and the index-parallel contract the briefing-exemplar and map surfaces rely on is preserved.

### Stage 7 — evidence discovery

**In:** the same query vector. **Out:** individual **evidence entries from other recipes** that are topically close to the checked recipe — a second retrieval over evidence-level embeddings (each stored with its parent recipe's text prepended, the Contextual Retrieval pattern — [research-foundations.md §3](research-foundations.md)), de-duplicated so one parent recipe doesn't dominate, sized to match the cluster count. This is a large part of goal 2: evidence arrives from recipes the flat ranking might never have surfaced.

### Stage 8 — projection (optional)

**In:** `axes=termA,termB` — two caller-chosen concept words. **Out:** an x/y position for every result: its cosine similarity to each concept's embedding, so an agent (or the Recipe Map UI) can reason about where results fall between two ideas. Non-destructive by design — every result gets a position, nothing is filtered. The same mechanism powers the Recipe Map's concept-axes mode; the map's other view (UMAP) runs client-side and is a visualization concern, not a ranking one. Detail: [research-foundations.md §1](research-foundations.md), [search-algorithms.md §Concept-Axis Projection](search-algorithms.md#concept-axis-projection-tcav-style).

### Stage 9 — rendering

**In:** everything above. **Out:** the response — HTML for humans and web-only agents, JSON (`format=json`), or MCP text/structured. Rendering-only levers live here: `known_recipes` (caller declares recipe ids it already holds; those return as one-line stubs instead of full bodies — the shipped, rendering-only ancestor of client-side session state), the premium `synthesize` distillation, and the `ranking` block (`{version, echoSuppression, clusterOrdering, overrides}`) that stamps every JSON/structured response with exactly which algorithm produced it.

### How a ranking change ships

Any change to any stage: offline sweep on golden datasets (`npm run eval:ranking`) → report → human ruling → the default change, a version bump, and a [changelog](ranking-changelog.md) entry in one commit. Two enforcement layers back this: mechanism-regression tests inside the standard `test:ci` gate (the §2 rules as literal assertions, plus echo exposure measured at every stage boundary — [ranking-regression.test.ts](../../apps/backend/src/services/ranking-regression.test.ts)), and the golden-set evaluation gating CI ([workflow](../workflows/ranking-tuning.md), [dataset contract](../../eval/golden/README.md)).

## 4. Extension points — how an idea becomes an experiment

The stress test this architecture must pass: an arbitrary new ranking idea should map onto one of these points — code change scoped to the point itself, measured by the harness, shipped (or discarded) as a versioned event. If an idea genuinely fits none of them, that's a finding about the architecture and belongs in the backlog.

| You want to experiment with… | Extension point | What you touch | Nothing else moves because… |
|---|---|---|---|
| How recipes are *embedded* (preambles, sections, emphasis, models) | The strategy registry ([embedding-strategies.ts](../../packages/domain/src/embedding-strategies.ts)) | Add a named strategy; the worker sweep backfills the whole corpus automatically | Search only reads strategies listed in `PRODUCTION_SEARCH_STRATEGY_IDS`; the map's strategy dropdown and the harness can score a strategy before it ever competes live |
| What *ranks* a candidate beyond similarity (identity, decay, reinforcement, stance) | The scoring occupant (stage 2) + a [`CandidateSignals`](../../packages/domain/src/ranking-config.ts) field | A pure function in `@soupnet/domain` + one hydration column/query | Stages consume the adjusted order and the signal record, not each other's internals |
| What the caller *sees first* (cluster ordering, exemplar choice) | Stage 5/6 parameters (`memberWeights`, ordering key) | A `RankingConfig` field read at the cluster stage | The `clusters[i] ↔ results[i]` contract is test-enforced, so consumers don't care how order was computed |
| How much the caller gets (budget shaping, drill-down, hierarchy) | The `clusters` / `max_chars` / `expand` / `page` surface | The auto-k estimator or a new response param | Clustering is stateless and recomputed per request — the same check re-submitted with different shape params is idempotent |
| What the response *carries* (stubs, positions, metadata) | Stage 8/9 (rendering-only levers) | A response field or render rule | Rendering levers are documented as unable to touch logging, scoring, or cluster math |
| How any of the above is *judged* | The metric suite ([metrics.ts](../../apps/backend/src/eval/metrics.ts)) + per-dataset thresholds | A metric function + a `thresholds.json` rule with a written rationale | Metrics read pipeline output; they can't affect it |

**The stress test, worked.** The operator's deliberately-weird probe (offered *"to show how I want to 'stress test' the system architecture so that we can try different ideas without rewriting the system"* — Andy, design review 2026-07-16, recipe `a7108776`): embed each recipe several more times, each with a preamble emphasizing one part of the Toulmin/user-story structure (*"Emphasis on the goal: …"*, *"Emphasis on the user: …"*), let the checking agent pass an optional `emphasis` parameter, and search that embedding so results cluster around the chosen facet. Mapping: the per-facet embeddings are **new registry strategies** (the existing `exp_trace_instructed` strategy already tests the preamble mechanism, and the E5 research it rests on is cited in [search-algorithms.md §Experimental Embedding Strategies](search-algorithms.md#experimental-embedding-strategies-clustering-experiments)); the caller's `emphasis` param selects the strategy the retrieval predicate filters on (the same filter the map's strategy dropdown already uses); the harness scores it with a facet-labeled question set before anyone flips anything. No stage rewrite, no schema change beyond registry rows. That's the bar every future idea gets held to.

## 5. The hypothesis register

What we suspect might improve the engine, where each idea came from, which extension point carries it, and what we learn either way. This register — not a task list — is the shared agenda with the evaluation workstream: each row is a question whose answer changes a shipped default or kills an idea with evidence. Status legend: **plumbed** = the lever exists in code awaiting measurement; **infrastructure ready** = the extension point exists, the experiment doesn't; **notes only** = design notes exist.

### Retrieval & embedding

| # | Hypothesis | Source | Extension point | Status |
|---|---|---|---|---|
| R1 | Evidence dilutes clustering — trace-only embeddings cluster judgment better than claim+evidence blends: *"the `full_recipe_context` strategy conflates the core judgment with diverse evidence topics"* | [search-algorithms.md §Experimental Strategies](search-algorithms.md#experimental-embedding-strategies-clustering-experiments) | Strategy registry (six `exp_*` variants already embed the whole corpus, **never yet scored** beyond visual map inspection — recipe `ad08a8e1`) | infrastructure ready |
| R2 | Instruction preambles sharpen embeddings (E5: *"instruction-prefixed embeddings improve downstream task quality"*) | [search-algorithms.md, research basis](search-algorithms.md#experimental-embedding-strategies-clustering-experiments) | Strategy registry | infrastructure ready |
| R3 | Facet-emphasis embeddings + a caller `emphasis` param cluster results around the chosen part of the judgment (the [worked stress test](#4-extension-points--how-an-idea-becomes-an-experiment) — illustrative, not committed) | Andy, design review 2026-07-16 (recipe `a7108776`) | Strategy registry + one request param | notes only |
| R4 | HyDE-style query synthesis helps vague checks (*"Construct a synthetic 'ideal recipe' to improve retrieval for vague queries"*) — in tension with rule 3, so it would have to be client-side or template-based | [search-algorithms.md §Open Improvements](search-algorithms.md#open-improvements-and-investigations) | Query construction before stage 1 | notes only |
| R5 | Lexical+semantic hybrid (RRF) earns its way back: *"RRF may be reintroduced if future experiments demonstrate a quality benefit"* — it ran in production and was removed for lack of validated improvement, so the reintroduction bar is a measured win | [research-foundations.md, Appendix: Paused Techniques](research-foundations.md#appendix-paused-techniques) | Stage 1 (a second ranked list + rank fusion) | notes only |

### Identity & scoring

| # | Hypothesis | Source | Extension point | Status |
|---|---|---|---|---|
| S1 | Explicit session identity beats same-API-key authorship for echo detection — server-issued self-healing `sessionId`, or client-declared known-ids (`known_recipes` is the shipped rendering-only ancestor; the explicit-parameter dedup shape predates it, recipe `8e93a948`) | Andy, design review 2026-07-16 (recipe `4d25aec9`); [backlog](../backlog.md) | New `CandidateSignals` field + scoring occupant | notes only |
| S2 | Echo demotion ON recovers polluted-corpus retrieval to within noise of the clean baseline | [echo-suppression.md](../planning/echo-suppression.md); ruling recipe `5cfee9bb` | Stage 2 lever (shipped OFF) | plumbed |
| S3 | Human *still true* reactions and cross-agent fulfilled feedback protect genuinely reinforced recipes without shielding echoes (the provenance axis of rule 4) | Feedback-calibration audit 2026-07-09 (recipe `ff54eafd`) | Two exemption flags on the stage-2 occupant (shipped OFF) + lazy signal counts | plumbed |
| S4 | Temporal decay from the *judgment* date (`COALESCE(decided_at, created_at)`) retires superseded judgments without burying stable old truths; candidate shapes — exponential, result-set-relative softmax, log-decay with reinforcement — are written up, and the open methodological question is on record: *"Is temporal decay of recipe relevance (stigmergic evaporation) well-modeled by exponential decay, or would a reinforcement-aware function be more appropriate?"* | [search-algorithms.md §Stigmergic Decay](search-algorithms.md#stigmergic-decay--temporal-weighting-of-recipes-research-needed); [research-foundations.md, Open Questions #4](research-foundations.md#open-questions-for-researcher-review) | New scoring term reading `CandidateSignals` dates | notes only |
| S5 | Coverage/diversity weighting — recipes reinforced by *independent* agent sessions outrank one agent reinforcing itself (*"Diversity weighting: multiple independent agent sessions converging > one agent reinforcing itself"*) | [search-algorithms.md §Coverage Signal](search-algorithms.md#coverage-signal-deferred) | New scoring term + a signals count | notes only |
| S6 | Stance-aware presentation — embeddings can't see negation (*"A recipe with 10 contradicting and 0 supporting evidence should rank differently than one with 10 supporting and 0 contradicting — even though their vector similarity to the query is identical"*), so stored stance links could inform presentation without the server judging truth | [search-algorithms.md §Open Improvements #4](search-algorithms.md#open-improvements-and-investigations) | Signals field + rendering annotation (per ADR-0015, interpretation stays with the agent) | notes only |

### Presentation & budget

| # | Hypothesis | Source | Extension point | Status |
|---|---|---|---|---|
| P1 | Cluster ordering by demotion-adjusted mass beats raw member-count on a polluted corpus — with the measured confound that k-means inherits the demoted input order, so the lever's *independent* effect needs real golden data | [Harness finding, backlog](../backlog.md); [thresholds rationale](../../eval/golden/synthetic-echo-v1/thresholds.json) | Stage 6 lever (shipped OFF) | plumbed |
| P2 | Order-independent k-means seeding decouples scoring experiments from clustering outcomes (today an upstream reorder restructures cluster membership) and improves check-to-check stability (*"K-Means is non-deterministic… the same query can return different exemplars"*) | [Backlog](../backlog.md); [search-algorithms.md §Clustering #6](search-algorithms.md#open-improvements-and-investigations) | Stage 5 seeding rule | notes only |
| P3 | Clusters within clusters — hierarchical drill-down on the check surface (the map already re-clusters a cluster's members via `traceIds`; the response-summarization plan sketches a `depth` param and divisive splitting gated on cluster quality) | Andy, design review 2026-07-16; [search-algorithms.md §Response Summarization](search-algorithms.md#response-summarization-via-vector-clustering-planned) | Budget-shaping surface (stateless re-clustering per request) | notes only |
| P4 | Silhouette scores surfaced per response tell agents whether a clustering was meaningful or arbitrary (*"Surface this to agents so they can judge whether the clustering was meaningful or arbitrary"*) | [search-algorithms.md §Clustering #7](search-algorithms.md#open-improvements-and-investigations) | Rendering metadata | notes only |
| P5 | K-medoids extractive summarization — medoid recipes as information-dense compressed responses at very tight budgets (*"the 'summary' is composed of real recipes — no generated text, no hallucination risk, no LLM needed"*) | [search-algorithms.md §Response Summarization](search-algorithms.md#response-summarization-via-vector-clustering-planned) | Stage 5 occupant variant | notes only |

### Measurement itself

| # | Hypothesis | Source | Extension point | Status |
|---|---|---|---|---|
| M1 | Ser@L (the utility × surprise proxy) tracks real downstream usefulness — validated against feedback-row outcomes, which carry the measured self-report caveat of rule 4 | [Serendipity memo](../planning/ranking-research/serendipity-diversity-metrics.md); recipe `ff54eafd` | Metric suite | plumbed (report-only) |
| M2 | The synthetic thresholds' margins match the true cross-platform noise floor | [Tuning workflow §Threshold philosophy](../workflows/ranking-tuning.md) | Threshold rules | plumbed |

## 6. What standard retrieval systems do that we deliberately don't

For a reader arriving from mainstream RAG practice — each divergence is a choice with a reason and a source, and several have explicit ways back in:

- **Hybrid lexical+semantic retrieval** — we ran it (tsvector + RRF) and removed it: *"Simplified to pure vector similarity baseline because the hybrid layer added complexity without validated improvement over semantic-only search."* ([research-foundations.md, Appendix](research-foundations.md#appendix-paused-techniques)). Way back in: hypothesis R5.
- **Cross-encoder / LLM re-rankers** — excluded by rule 3 (no LLM on the ranking path); the cheap-math server is a product property, not an oversight. Way back in: a measured quality ceiling arithmetic provably can't cross.
- **Relevance thresholds and top-k truncation** — constitutionally excluded (rule 1); the budget problem they usually solve is handled by clustering to the caller's size instead (stage 5).
- **MMR-style diversity re-ranking** — diversity is delivered structurally (clustering + per-parent evidence dedup) rather than by a redundancy penalty in the flat order; the [serendipity memo](../planning/ranking-research/serendipity-diversity-metrics.md) covers why naive diversity metrics mislead (duplicate-clump pitfalls) and what we measure instead.
- **Fine-tuned or per-user embedding models** — one provider/model per deployment, switchable but not blendable ([ADR-0023](../adr/0023-local-embedding-providers.md)); personalization comes from the corpus content and the signal record, not from model weights.
- **Click-signal learning** — there are no clicks; consumers are agents. The equivalent signal is structured per-recipe feedback with provenance, and rule 4's audit says why it must be treated skeptically.

What we *do* share with standard practice, with lineage: contextual retrieval for evidence embeddings, k-means++ summarization, TCAV-style concept projection, ANN-with-exact-fallback retrieval — each with its research citations in [research-foundations.md](research-foundations.md), and the five [ranking-research memos](../planning/ranking-research/) document the field practices (offline IR evaluation, ranking regression testing, LTR feature architecture, serendipity metrics, config management) this engine's measurement design was built from.

## 7. What success looks like

In human terms — the engine succeeds when these are ordinarily true (the technical metrics that operationalize them belong to the evaluation workstream and [the tuning workflow](../workflows/ranking-tuning.md)):

- **The agent gets the ruling the human actually made.** An agent facing a judgment call checks it and the human's own prior decision — or their collaborator's — comes back at the top with its evidence, not buried under near-duplicates of the agent's own question.
- **The corpus rewards use instead of degrading with it.** A person who has checked thousands of recipes across many agents gets *better* answers than they did at fifty recipes — never worse. Nobody has to garden their corpus for the ranking to hold up.
- **The surprise arrives.** Checks routinely surface the adjacent judgment the agent didn't know to ask for — the related evidence, the cross-project precedent — and agents' feedback says it changed what they did.
- **A fleet works like a team.** Parallel sub-agents see each other's fresh trails (that's how they coordinate) while each one's own just-written hypotheses don't drown its next search.
- **Answers fit where they land.** A tight-context agent asks for 2,000 characters and gets a faithful miniature of the same answer a 20,000-character caller gets — not a different answer.
- **Every change arrives with receipts.** No ranking behavior ever shifts under users silently: each shift has a version, a changelog entry, the measurement it rests on, and the human ruling that shipped it.

## Near future (committed direction, not yet built)

- The three parked default flips — echo demotion (S2), mass cluster-ordering (P1), corroboration exemptions (S3) — each awaiting golden-set measurement and a ruling, shipped as [changelog](ranking-changelog.md) events.
- Session identity for scoring (S1) — design stage, [backlog](../backlog.md).
- Real golden datasets from the evaluation side (the synthetic starter proves machinery, not product — [dataset contract](../../eval/golden/README.md)).
- Decay + reinforcement (S4/S5) — the "stay sharp as the corpus ages" goal's next instances, entering through the same register.

## Doc map

| Document | What it holds |
|---|---|
| [search-algorithms.md](search-algorithms.md) | Implementation reference — exact algorithms, parameters, code locations, open improvement notes |
| [research-foundations.md](research-foundations.md) | The math, research lineage, verification experiments, paused techniques, open researcher questions |
| [search-strategies.md](search-strategies.md) | Alternatives considered and output-strategy notes |
| [ranking-changelog.md](ranking-changelog.md) | The timeline: every default change, with measurements and rulings |
| [check-recipe-ranking-system.md](../planning/check-recipe-ranking-system.md) | The implementation brief this engine was built from |
| [echo-suppression.md](../planning/echo-suppression.md) | The current scoring occupant's design doc |
| [ranking-research/](../planning/ranking-research/) | Five quote-backed research memos (offline IR eval, regression testing, LTR architecture, serendipity metrics, config management) |
| [ranking-tuning.md](../workflows/ranking-tuning.md) | The tuning workflow: sweep → report → ruling → versioned event |
| [eval/golden/README.md](../../eval/golden/README.md) | Golden dataset file contract + delivery path |
| [ranking-config.ts](../../packages/domain/src/ranking-config.ts) | The config object: every lever, default, range, and rule |
