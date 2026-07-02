# Search Strategies — Discovery Strategies & Research Notes

> **Purpose:** Documents how Soup.net's discovery strategies work at a conceptual level — what each strategy searches, how results are combined, and the research basis. Also serves as the home for research notes, alternatives we evaluated, and ideas we haven't implemented.
>
> **Audience:** Engineers and product thinkers who need to understand the search architecture conceptually, or who are evaluating new approaches.
>
> **Related docs (and how they differ):**
> - [search-algorithms.md](search-algorithms.md) — **Implementation details:** code locations, endpoint mappings, exact parameters. That doc says "line 81 of vector-search.service.ts"; this doc says "we use semantic vector search."
> - [research-foundations.md](research-foundations.md) — **Formal math and citations:** LaTeX, research lineage, verification experiments. This doc references research informally; research-foundations.md provides the full academic treatment.
> - [design-thinking.md](../design-thinking.md) — **Who and why:** user archetypes, product vision. No search details.
>
> **Rule of thumb:** If it's a strategy description, research note, or something we considered/rejected, put it here. If it's running code with line numbers, put it in search-algorithms.md. If it needs LaTeX and citations, put it in research-foundations.md.

How Soup.net discovers relevant recipes and evidence. Each strategy is a combination of query construction, embedding corpus, and result interpretation. Results are labeled by strategy so AI agent consumers understand how they were discovered.

## Research Foundation

| Technique | Source | How we use it |
|---|---|---|
| Negation problem | [Joe Sack](https://joesack.substack.com/p/the-negation-problem-in-vector-search), [SparseCL (ICML 2025)](https://arxiv.org/abs/2406.10746) | Embeddings encode topic, not stance. We removed "evidence against" from ingest — stance interpretation is delegated to the AI agent consumer. |
| Contextual Retrieval | [Anthropic](https://www.anthropic.com/news/contextual-retrieval) | Evidence embeddings prepend parent trace text as context (35-67% retrieval improvement). |
| CRAG | [arxiv](https://arxiv.org/html/2406.00029v1) | Cluster results before presenting — reduces tokens 46-90% without quality loss. Applied at both trace and evidence levels. |
| K-Means + nearest exemplar | [Manning et al. IR ch. 16](https://nlp.stanford.edu/IR-book/html/htmledition/k-means-1.html) | Computed centroids capture the geometric center better than K-Medoids exemplars. Display the nearest real data point. |
| HyDE | [Gao et al. 2022](https://arxiv.org/abs/2212.10496) | Future: construct synthetic "ideal evidence" for better retrieval. Not yet implemented. |
| Multi-field embeddings | [Superlinked](https://docs.superlinked.com/concepts/multiple-embeddings) | Per-evidence vectors + trace-level vectors. Future: combined full-recipe embedding. |
| Task type asymmetry | [Google Vertex AI docs](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/task-types) | RETRIEVAL_DOCUMENT for indexing, SEMANTIC_SIMILARITY for querying. **Note:** gemini-embedding-2-preview currently ignores task_type (all identical). See [embedding-test-results.md](embedding-test-results.md). |

## Current Strategies

### Strategy 1: Similar Recipes (trace-level search)

**What it searches:** Trace embeddings (`source_type='trace'`)
**Query construction:** Recipe text as-is (optionally combined with filter keywords)
**Search method:** Semantic (HNSW ANN cosine similarity)
**Clustering:** K-Means with auto-k from `max_chars` budget, nearest-exemplar for display
**What it finds:** Recipes about similar topics, ranked by combined relevance
**Label in response:** "Similar recipes"
**Limit:** 500 results before clustering

### Strategy 2: Related Evidence (per-evidence-entry search)

**What it searches:** Evidence embeddings (`source_type='evidence'`) — one embedding per evidence entry
**Query construction:** Recipe text used as semantic query against evidence vectors
**Key distinction from Strategy 3:** Strategy 2 embeds each evidence entry individually (with its parent trace as context). Strategy 3 embeds ALL evidence for a trace in one combined embedding. Strategy 2 finds individual evidence entries; Strategy 3 finds whole recipes based on their full evidence context.
**Evidence embedding construction:** Each evidence entry is enriched with parent trace context:
```
Recipe context: "[parent trace claim text]"
Supporting evidence: [interpretation]
> "[quote]"
-- [source]
```
This follows Anthropic's Contextual Retrieval pattern — prepending parent document context to chunks.

**Search method:** Semantic only (HNSW ANN cosine)
**What it finds:** Evidence from OTHER recipes that's topically related to the current recipe. May support, contradict, or provide additional context. The system does not determine stance — the AI agent consumer interprets relevance.
**Label in response:** "Related evidence from other recipes"
**Limit:** 20 results

### Strategy 3: Full-Recipe Context Embedding

**Status:** Implemented. Each recipe check now generates both a `full_document` embedding (trace text only) and a `full_recipe_context` embedding (trace + all evidence + references concatenated). Both are searched simultaneously via `DISTINCT ON` deduplication — the best-scoring vector per trace wins.

**Embedding construction:**
```
Claim: [trace text]

Supporting evidence: [evidence 1 interpretation]
> "[quote 1]"
-- [source 1]

Supporting evidence: [evidence 2 interpretation]
> "[quote 2]"
-- [source 2]
```

**Research basis:** [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) showed 35-67% improvement from context enrichment. The combined embedding extends this from evidence-level to recipe-level.

**Verification plan:** Compare retrieval quality (manual evaluation on 50+ recipes) between Strategy 1 (trace-only) and Strategy 3 (full-recipe). Document results in this file.

### Evidence Clustering Within Results

**Status:** Implemented. When a trace result has more than 5 evidence entries, K-Means clustering is applied to the evidence vectors. The most representative evidence per cluster is shown with a `clusterSize` indicating how many similar entries it represents. Evidence without vectors (legacy or failed embedding) is appended unclustered.

**Research basis:** [CRAG](https://arxiv.org/html/2406.00029v1) — clustering retrieved evidence before presenting reduces tokens 46-90% without quality loss.

## Output Strategies

Output strategies define how discovery results are clustered, culled, and presented. Each output corresponds to a section in the response. All respect the same `max_chars` and `clusters` parameters for consistency.

### Output 1: Similar Recipes

**Source:** Discovery Strategies 1 + 3 (trace-level search, deduplicated)
**Clustering:** K-Means with auto-k from `max_chars` budget or explicit `clusters` param
**Display:** Exemplar recipe per cluster + cluster size + supporting evidence
**HTML section:** "Similar recipes (N found, K exemplars shown)"
**JSON field:** `data.results[]`

### Output 2: Related Evidence

**Source:** Discovery Strategy 2 (evidence-level search)
**Clustering:** Matches recipe output — same exemplar count as Output 1. Diversified by parent trace (prefers evidence from different recipes for breadth).
**Display:** Evidence text + parent recipe context + similarity score
**HTML section:** "Related evidence from other recipes"
**JSON field:** `data.relatedEvidence[]`

### Output 3: Evidence Within Each Recipe (sub-clustering)

**Source:** Direct evidence attached to each trace in Output 1 results
**Clustering:** K-Means on evidence vectors when a trace has >5 evidence entries
**Display:** Exemplar evidence per cluster + cluster size
**JSON field:** Per-result `evidenceFor[]` with optional `clusterSize`

### How Outputs Appear in Responses

**JSON API:**

```json
{
  "data": {
    "results": [                 // Output 1: Similar recipes (clustered)
      {
        "recipe": "...",
        "clusterSize": 5,
        "evidenceFor": [         // Output 3: Evidence within this recipe (sub-clustered)
          { "interpretation": "...", "clusterSize": 3 }
        ]
      }
    ],
    "relatedEvidence": [         // Output 2: Related evidence (clustered, diversified)
      {
        "parentRecipe": "...",
        "evidence": "...",
        "similarity": 0.73,
        "strategy": "contextual_evidence"
      }
    ]
  }
}
```

**HTML Page:**

- **"Similar recipes"** section → Output 1 (trace clusters with supporting evidence)
- **"Related evidence from other recipes"** section → Output 2 (clustered, diversified by parent trace)
- Evidence within each recipe → Output 3 (sub-clustered when >5 entries)

**MCP Tool:**

- Recipe results with supporting evidence → Output 1
- "Related evidence from other recipes" section → Output 2
- File references shown as `[file: url]`

## Verification and Effectiveness

| Strategy | Metric | How to verify |
|---|---|---|
| 1 (Similar recipes) | Relevance of top-k results | Manual evaluation — do results match the recipe's topic? |
| 2 (Related evidence) | Cross-recipe evidence discovery | Check a recipe, verify evidence from other recipes appears. Does it add useful context? |
| 3 (Full-recipe context) | Improvement over Strategy 1 | A/B compare: same query, Strategy 1 vs 3 results. Which surfaces more relevant matches? |
| K-Means vs K-Medoids | Cluster quality | Silhouette scores, avg intra-cluster similarity. Documented in [embedding-test-results.md](embedding-test-results.md). |

## Sync vs Async Embedding

At recipe check time, only what's needed for immediate searchability runs synchronously — and only in the task type search reads (2026-07-01 latency findings, `docs/rough-notes/2026-07-01/recipe-check-latency-findings.md`):

- **Sync:** `full_document` (Strategy 1) and `full_recipe_context` (Strategy 3) trace embeddings, `SEMANTIC_SIMILARITY` only. Both are resolved **in parallel, before the write transaction** (`trace.service.ts`), so the write path costs ~one embed round-trip. The trace vector is then reused as the search query vector — the query text is the trace text — so the search pipeline makes zero additional embedding calls. Duplicate re-checks hit `vector_cache` for everything: zero API calls.
- **Async (worker):** `RETRIEVAL_DOCUMENT` rows for the two sync strategies (inserted `status='pending'`), Strategy 2 evidence embeddings, and the six `exp_*` strategies (not enqueued at check time at all — the strategy sweep discovers traces missing them and backfills within ~1 minute).
- **Exception:** multimodal (file-attached) evidence embeds both task types synchronously — the async pipeline can't re-embed file bytes (ADR-0019).

This keeps recipe checks fast (~0.5s for a new check, ~0.1s + network for a duplicate) while the worker builds richer embeddings asynchronously. Evidence search improves over minutes as the worker catches up.

## Design Principles

1. **Zero LLM on server.** Strategies use vector math, not AI reasoning. The server finds and clusters; the AI agent interprets.
2. **System doesn't judge stance.** Related evidence is topically related, not classified as supporting or contradicting. The negation problem means embeddings can't reliably distinguish these.
3. **Labeled results.** Each result set is labeled with its strategy so the consuming agent understands how it was discovered and can weight it appropriately.
4. **Research-aligned.** Every strategy decision cites its research basis. Deviations from established patterns are documented with verification plans.
