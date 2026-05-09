# ADR-0005: Embedding model selection

**Date:** 2026-03-19
**Status:** Accepted (updated 2026-03-19 — model upgraded from gemini-embedding-001 to gemini-embedding-2-preview; Cohere deferred to optional future feature)

---

## Context

Embeddings are used for:
1. Semantic similarity search (finding claims relevant to a request)
2. Document-level deduplication
3. Future: clustering, neutral summary generation

The model choice affects retrieval quality, cost, and the feasibility of multimodal inputs (image artifacts).

---

## Decision

Use **`gemini-embedding-2-preview`** as the single embedding model for MVP.

### Why a single model

- 3072 dimensions standardized across the system — no incompatible vector spaces to manage in the DB
- `gemini-embedding-2-preview` is natively multimodal (text, images, video, audio) — eliminates the need for Cohere as a separate image embedding provider in most cases
- One API key, one SDK integration, one billing account to manage
- Simpler worker: no routing logic needed during MVP

The `model_id` column in `embedding_vectors` makes adding a second model a worker-only change with no schema migration required.

### Model specifications

**Source:** https://ai.google.dev/gemini-api/docs/embeddings (check periodically — this changed materially in early 2026)

| Property | Value |
|---|---|
| Model ID | `gemini-embedding-2-preview` |
| Max input tokens | 8,192 tokens |
| Output dimensions | 3,072 (default); MRL-adjustable to 128, 768, 1536, or 3,072 |
| Modalities | Text, images (PNG/JPEG), video (MP4/MOV ≤120s), audio, PDF (≤6 pages) |
| Supported languages | 100+ |
| Batch API discount | 50% off standard per-token price |
| Synchronous batch max | 200 inputs per API call |

**MRL (Matryoshka Representation Learning):** The first N dimensions of a 3072-dim vector are a valid lower-quality embedding. Truncation to a smaller dimension requires no re-embedding. Use `output_dimensionality` parameter if truncation is needed later.

**Incompatible with `gemini-embedding-001`:** Embedding spaces are not comparable across these models. If upgrading from 001, all existing embeddings must be re-generated.

---

## Task types

Task type is set per-embedding-call and tells the model to optimize its output for the intended use. This is a key dimension of the system design. The `task_type` column in `embedding_vectors` records which task type was used.

| Task type | When to use |
|---|---|
| `RETRIEVAL_DOCUMENT` | Indexing content to be retrieved (claims, validations, requests) |
| `RETRIEVAL_QUERY` | Text search queries from users or agents |
| `CODE_RETRIEVAL_QUERY` | Code-specific search queries (natural language → code block) |
| `SEMANTIC_SIMILARITY` | Pairwise similarity scoring — not for retrieval |
| `QUESTION_ANSWERING` | QA system queries |
| `FACT_VERIFICATION` | Statements to be verified (relevant for validations) |
| `CLUSTERING` | Document grouping — not needed for HNSW-based search |

**MVP task type strategy:**
- All indexed content (claims, validations, requests) → `RETRIEVAL_DOCUMENT`
- Text/general search queries → `RETRIEVAL_QUERY`
- Code-specific search queries → `CODE_RETRIEVAL_QUERY`

Because `RETRIEVAL_DOCUMENT` is used for all indexed content regardless of artifact category (text, code, data), document embeddings only need to be generated once. Query-side task types can be experimented with without re-indexing.

**CLUSTERING vs HNSW:** CLUSTERING task type produces embeddings optimized for K-means and similar algorithms. HNSW is an index structure for ANN search — it works with any task type. They are orthogonal. We do not need CLUSTERING task type for our search use case.

---

## What gets embedded

| Source | Text content |
|---|---|
| `claim` | `summary` + serialized `reasoning` fields (whatWasAttempted, whyThisPath, conclusion, etc.) |
| `validation` | `problemStatement` + `stepsSummary` + `actualResult` + `evidenceSummary` |
| `request` | `queryText` + `contextSummary` |

For air-gapped mode claims: the client computes vectors for payload files locally using the user's own Gemini API key. Server-side embedding is skipped for those files; the claim metadata (summary, reasoning) is still embedded server-side.

Image artifacts: direct image embedding is available in `gemini-embedding-2-preview` and is now supported via inline base64 (up to 4MB). Larger media (video, long audio) will require the Gemini File API in a future phase — see [Gemini File API vs Inline Data Briefing](../working/gemini-file-api-briefing.md) for the analysis.

---

## Batch API

The Gemini synchronous API accepts up to **200 inputs per call**. The async batch API costs **50% of the standard per-token price** at the cost of added latency (minutes, not milliseconds). For MVP, use the synchronous batch (up to 200 inputs). Migrate to async batch once volume justifies the engineering effort.

---

## Known issues

**Task type ignored (2026-03-29):** Empirical testing confirmed that `gemini-embedding-2-preview` produces identical vectors regardless of `taskType` parameter. All task types (SEMANTIC_SIMILARITY, RETRIEVAL_DOCUMENT, FACT_VERIFICATION, QUESTION_ANSWERING) return cosine similarity 1.0 against each other. We continue generating both RETRIEVAL_DOCUMENT and SEMANTIC_SIMILARITY so the infrastructure is ready when Google fixes this. See `docs/architecture/embedding-test-results.md` for full test results and [the bug report](https://discuss.ai.google.dev/t/gemini-embedding-2-preview-appears-to-ignore-task-type-for-text-and-image-embeddings/134720).

**Batch API works correctly (2026-03-29):** Despite [pydantic-ai#4872](https://github.com/pydantic/pydantic-ai/issues/4872) reporting batch issues, our empirical test confirms single and batch embeddings produce identical vectors. No action needed.

## Implementation notes

- Do not block primary writes on embedding generation — the `embedding_sources` row is written in the same transaction as the source object, then the worker picks it up asynchronously
- See `packages/db/src/schema/vectors.ts` for the four-table pipeline design
- See `docs/architecture/vector-store.md` for the full design including ER diagram and worker flow
- See `docs/architecture/embedding-test-results.md` for empirical model testing

---

## Not yet built

The embedding service is designed but not implemented. See `docs/backlog.md` → "Embeddings" section.
