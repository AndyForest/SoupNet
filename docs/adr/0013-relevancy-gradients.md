# ADR-0013: Relevancy Gradients — Contextual Scope with Decay, Bias, and Evidence

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

A claim may be highly relevant in some contexts and nearly irrelevant in others. A claim about "how to handle OpenAI API rate limits in a FastAPI service using exponential backoff with a Redis lock" is very relevant for that exact configuration but attenuates as the configuration diverges. The current data model has no mechanism for a claim to declare its own relevancy scope — relevance is determined entirely by embedding similarity at query time.

This creates two problems:

1. **Precision loss.** Embedding similarity captures semantic proximity but not applicability. A claim about exponential backoff in a different language and different API may score well semantically but be inapplicable in practice. The claim author (who applied it) has direct knowledge of applicability that the embedding does not capture.

2. **No anti-spam mechanism for broad claims.** Any agent can submit a claim asserting it applies to everything. Without a cost proportional to the scope of relevance asserted, low-quality claims over-generalize. This is the context-hub problem of auto-generated documentation flooding the registry, but for claims.

### The "proof of work" property

The core insight: it must be **expensive** to assert broad relevance and **cheap** to validate that evidence. This is the same asymmetry that makes Bitcoin proof-of-work useful as an anti-spam mechanism, and the same asymmetry that makes a well-reasoned judicial opinion more trustworthy than an unsupported assertion.

For ClaimNet: an agent that claims "this applies broadly" must provide evidence claims that support that scope. Producing that evidence (finding, applying, and documenting supporting claims) is expensive. Verifying that the evidence exists and cites the right things is cheap. The larger the relevancy scope asserted, the more evidence is required.

---

## Decision

### New table: `claimnet.claim_relevancy_entries`

Each row represents one relevancy assertion: "this claim is relevant to contexts that match this phrase, with this decay and bias, supported by this evidence."

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `claim_id` | `uuid` | FK → `claimnet.claims.id` |
| `phrase` | `text` | The match phrase — a natural language description of the context where this claim applies. |
| `embedding` | `halfvec(3072)` | Embedding of `phrase`. Populated by the worker. |
| `decay` | `float` | 0.0–1.0. 0.0 = only relevant in this exact context (default). 1.0 = universally applicable. |
| `bias` | `float` | Additive offset to similarity score when this phrase matches. Can be negative (de-prioritize) or positive (boost). Default 0.0. |
| `evidence_claim_ids` | `uuid[]` | UUIDs of other claims that provide evidence supporting this relevancy scope. |
| `created_at` | `timestamptz` | |

**Default:** A claim with no relevancy entries has implicit `decay=0.0, bias=0.0` — relevant only in the specific context where it was produced.

---

### Evidence requirement (the proof-of-work schedule)

When submitting a relevancy entry with `decay > 0.2`, the entry must include evidence claims:

```
required_evidence = max(1, floor(decay * 5))
```

| `decay` range | Required evidence claims |
|---|---|
| 0.0 – 0.2 | 0 (no evidence required) |
| 0.2 – 0.4 | 1 |
| 0.4 – 0.6 | 2 |
| 0.6 – 0.8 | 3 |
| 0.8 – 1.0 | 4–5 |

Evidence claims must be:
1. Accessible to the submitting agent (within their privacy envelope)
2. Validated (at least one validation with `outcome = 'success' | 'partial_success'`)

This is enforced at submission time. The schedule values are application-level constants, not schema — they can be adjusted without a migration.

**Evidence applies even for private claims.** An `org_only` claim with `decay=0.8` still requires 4 evidence claims. The evidence does not need to be public — it just needs to exist and be accessible.

---

### How relevancy entries affect search scoring

Search is a two-stage process:

**Stage 1 — Retrieval:** Standard hybrid search (BM25 + embedding ANN) produces a candidate set ranked by primary similarity.

**Stage 2 — Re-ranking:** For each candidate claim, the system checks whether any of its `claim_relevancy_entries` match the query. A match is defined as `cosine_similarity(entry.embedding, query.embedding) > threshold`. When a match is found:

```
final_score = primary_score + (decay × similarity × bias_adjustment)
```

Where:
- `decay` is the entry's decay value (broader relevancy = larger boost)
- `similarity` is the cosine similarity between the entry phrase embedding and the query embedding
- `bias_adjustment` is `1.0 + bias` (positive bias amplifies, negative bias dampens)

This means a claim with a well-matched, high-decay relevancy entry will score higher than an equally similar claim with no relevancy entries — reflecting the author's assertion that this claim is particularly applicable.

---

### Multi-term weighted search (agent interface)

Agents submit multiple weighted search phrases to construct a composite query. Each phrase has an independent relevancy weight:

```
"rate limit handling":0.8 "exponential backoff":0.6 "OpenAI API":0.4
```

The backend:
1. Parses each `"phrase":weight` pair
2. Embeds each phrase independently
3. Computes similarity against claims (and against claim relevancy entries)
4. Combines: `Σ(weight_i × similarity_i) / Σ(weight_i)`

Agents can also submit tag-like relevancy offsets as search flags:
```
"retry logic":0.7 relevancy_offset:0.3 privacy:org
```

`relevancy_offset` shifts the minimum similarity threshold up or down, allowing agents to explore a broader or narrower radius around their primary query.

---

### AGE graph edges for relevancy

When a relevancy entry cites evidence claims, an `HAS_RELEVANCY_TO` edge is created in the AGE graph from the parent claim to each evidence claim:

```cypher
MERGE (c:Claim {id: $parentClaimId})-[r:HAS_RELEVANCY_TO {
  decay: $decay,
  bias: $bias,
  phrase: $phrase
}]->(e:Claim {id: $evidenceClaimId})
```

This enables graph traversal queries like: "find all claims that assert broad relevance to this topic and have at least 3 supporting evidence claims with successful validations."

---

### Future: learned relevancy scoring

The data structure is designed for future supervised learning. The training signal:
- **Positive:** queries that result in a successful validation of a retrieved claim
- **Negative:** queries that retrieve a claim with `outcome = 'failure' | 'not_applicable'`

A cross-encoder or bi-encoder can be trained on `(query_embedding, relevancy_entry_embedding, decay, bias, outcome)` tuples. The embedding vectors stored in `claim_relevancy_entries` are the training features. This is being collected from day one — no schema change required when training begins.

---

## Consequences

- New table `claimnet.claim_relevancy_entries` — Drizzle migration required
- Worker must embed `phrase` fields (same embedding pipeline as claims)
- Submission validation must check evidence claim existence and validation status
- Search re-ranking adds latency — acceptable for initial implementation; candidate for caching
- The evidence requirement schedule (`max(1, floor(decay * 5))`) is a first approximation; adjust based on observed submission patterns
- The `HAS_RELEVANCY_TO` graph edges require the AGE sync worker to handle relevancy entry events (in addition to claim/validation/counter-analysis events)
