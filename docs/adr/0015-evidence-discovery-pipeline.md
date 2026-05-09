# ADR-0015: Evidence Discovery Pipeline

**Date:** 2026-03-29
**Status:** Accepted

---

## Context

The original design included "evidence for" and "evidence against" fields on recipe checks, with the expectation that AI agents would provide contradicting evidence and that vector search could surface contradictions from other recipes.

Literature review and empirical testing (2026-03-29) revealed two problems:

1. **The negation problem:** Embedding models encode topical similarity, not stance. "The treatment improved outcomes" and "The treatment did NOT improve outcomes" produce 0.86 cosine similarity — embeddings cannot distinguish supporting from contradicting evidence. ([Joe Sack](https://joesack.substack.com/p/the-negation-problem-in-vector-search), [SparseCL ICML 2025](https://arxiv.org/abs/2406.10746), [arxiv 2504.00584](https://arxiv.org/html/2504.00584v1))

2. **LLM behavior:** In practice, AI agents rarely provide "evidence against" their own recipes. The field was aspirational but unused.

3. **Task type bug:** `gemini-embedding-2-preview` ignores the `taskType` parameter, producing identical vectors for all task types including FACT_VERIFICATION. This eliminates the possibility of using task-type-optimized embeddings for contradiction retrieval. (Confirmed empirically; see `docs/architecture/embedding-test-results.md`.)

---

## Decision

### Remove "evidence against" from ingest

Rename "evidence for" → "supporting evidence." Remove the `evidence_against` parameter from the MCP tool and web form. The `trace_evidence.stance` field retains existing 'against' rows but new entries are always 'for.'

**Rationale:** Asking agents to label evidence as "against" is unreliable (they don't do it) and misleading (it implies the system can distinguish stance, which it cannot).

### Build evidence discovery as a separate search pipeline

Instead of relying on agents to provide contradicting evidence, build search pipelines that surface topically related evidence from other recipes. The AI agent consumer determines whether related evidence supports, contradicts, or provides context.

**Research basis:**
- Contextual Retrieval ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)): Prepending parent trace context to evidence embeddings improves retrieval by 35-67%.
- CRAG ([arxiv](https://arxiv.org/html/2406.00029v1)): Clustering retrieved documents before presenting reduces tokens 46-90%.
- Multi-field embeddings ([Superlinked](https://docs.superlinked.com/concepts/multiple-embeddings)): Per-evidence vectors alongside trace-level vectors is the pragmatic hybrid approach.

### Switch from K-Medoids to K-Means + nearest-exemplar clustering

Computed centroids better capture the geometric center of a topic cluster than K-Medoids exemplars.

**Research basis:** Manning et al. "Introduction to Information Retrieval" ch. 16; standard practice in information retrieval.

---

## Consequences

### Positive

- Simpler ingest — agents only need to provide supporting evidence
- More honest about what embeddings can do — no false promises about stance detection
- Cross-recipe evidence discovery is automatic (always-on)
- Architecture ready for future improvements (FACT_VERIFICATION when task types are fixed, NLI classification when zero-LLM constraint is relaxed)

### Negative

- Existing "evidence against" rows in the database become legacy data (preserved but no new entries)
- AI agent consumers must interpret evidence relevance themselves (consistent with "system doesn't judge" principle)
- Evidence search adds a Gemini API call per recipe check (latency increase ~200-500ms)

### Risks

- Evidence search may surface irrelevant evidence if the corpus is small or homogeneous
- The contextual enrichment pattern adds trace text to every evidence embedding, increasing token usage per embedding call
- If Google fixes task_type support, we'll need to regenerate all embeddings to benefit

---

## Implementation

See `docs/architecture/search-strategies.md` for the full strategy documentation and `docs/architecture/embedding-test-results.md` for empirical test results.
