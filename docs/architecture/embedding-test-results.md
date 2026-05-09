# Embedding Model Empirical Test Results

**Date:** 2026-03-29
**Model:** gemini-embedding-2-preview
**Test script:** scripts/test-task-types.mjs

## Test 1: Task Type Differentiation

**Finding: gemini-embedding-2-preview IGNORES task_type parameter.**

All four task types produce identical vectors (cosine similarity = 1.000000):

| Comparison | Cosine Similarity |
|---|---|
| SEMANTIC_SIMILARITY vs RETRIEVAL_DOCUMENT | 1.000000 |
| SEMANTIC_SIMILARITY vs FACT_VERIFICATION | 1.000000 |
| SEMANTIC_SIMILARITY vs QUESTION_ANSWERING | 1.000000 |
| RETRIEVAL_DOCUMENT vs FACT_VERIFICATION | 1.000000 |

**Impact:** Generating multiple task types per content wastes API calls. Our current pipeline generates both RETRIEVAL_DOCUMENT and SEMANTIC_SIMILARITY — one of these should be eliminated.

**Action:** Reduce to single task type (SEMANTIC_SIMILARITY) until Google fixes this. The `task_type` column in `embedding_vectors` preserves the ability to store different types when the model supports it.

**Reference:** [Google AI Developer Forum bug report](https://discuss.ai.google.dev/t/gemini-embedding-2-preview-appears-to-ignore-task-type-for-text-and-image-embeddings/134720) (March 2026)

## Test 2: Negation Problem

**Finding: Negation problem is REAL but not as extreme as literature suggests.**

| Comparison | Cosine Similarity |
|---|---|
| "The treatment improved patient outcomes" vs "The treatment did NOT improve patient outcomes" | 0.862 |
| "The treatment improved patient outcomes" vs "The weather forecast predicts rain tomorrow" | 0.559 |
| Same pair with FACT_VERIFICATION task type | 0.862 (identical — task type ignored) |

**Analysis:** Negated statement is closer to the original (0.86) than to unrelated text (0.56), confirming the negation problem. However, the 0.30 gap means embeddings capture *topical relevance* — they just can't distinguish stance (supporting vs. contradicting).

**Impact:** Embeddings are useful for finding *related* evidence from other recipes, but NOT for determining whether that evidence supports or contradicts the current recipe. Stance determination must be:
1. Explicitly labeled at ingest time (stance field on trace_evidence)
2. Delegated to the AI agent consumer for cross-recipe evidence

**References:**
- [The Negation Problem in Vector Search (Joe Sack)](https://joesack.substack.com/p/the-negation-problem-in-vector-search)
- [Enhancing Negation Awareness in Universal Text Embeddings (arxiv)](https://arxiv.org/html/2504.00584v1)
- [SparseCL: Contradiction Retrieval (arxiv)](https://arxiv.org/abs/2406.10746)

## Test 3: Batch API Correctness

**Finding: Batch API works correctly.**

| Text # | Single vs Batch Cosine | Result |
|---|---|---|
| Text 1 | 1.000000 | ✓ MATCH |
| Text 2 | 1.000000 | ✓ MATCH |
| Text 3 | 1.000000 | ✓ MATCH |
| Batch[0] vs Batch[1] (different texts) | 0.537 | Correctly different |

**Impact:** No need to redo cached vectors from batch processing. The bug reported in [pydantic-ai#4872](https://github.com/pydantic/pydantic-ai/issues/4872) does NOT reproduce with our API usage pattern.

## Test 4: 100-Result Search Limit

**Finding: `LIMIT 100` in both semantic and lexical search queries caps results before clustering.**

**Location:** `apps/backend/src/services/vector-search.service.ts`, lines 110 and 139.

**Impact:** `totalResults` reports max 100 even if more traces match. The clustering pipeline only sees the top 100 — traces ranked 101+ are invisible.

**Action:** Increase limit or make configurable. For the current corpus size (~200 recipes), 200 or 500 would be appropriate. Consider making it a parameter rather than hardcoded.

## Implications for Architecture

1. **Reduce to single task type** — save 50% embedding API calls
2. **Don't rely on task types for contradiction discovery** — use topical similarity + explicit stance labels instead
3. **Batch API is safe** — continue using it in the worker
4. **Increase search limit** — 100 is too low for the growing corpus
5. **Evidence search should find topically related evidence** — let the AI agent determine if it supports or contradicts
