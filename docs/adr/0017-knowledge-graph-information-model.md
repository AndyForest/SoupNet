# ADR-0017: Knowledge Graph Information Model — Agent-Defined Edges, Evidence on Relationships, General→Specific Hierarchy

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

Traditional knowledge graphs use a fixed, schema-defined set of edge labels: `HAS_SKILL`, `BELONGS_TO`, `REFUTES`. This works well when the domain is known and stable. ClaimNet's domain is intentionally open-ended — claims can be about software decisions, design choices, regulatory compliance, personal taste, organizational policy, or anything an AI agent concludes. The relationships between these claims must be equally open-ended.

Additionally, the question of "where does evidence live?" is non-trivial:
- In traditional validations, evidence is a property of the claim being validated
- But the same claim can be evidence for *different things* in *different ways*

The insight that resolves this: **evidence lives on the relationship (edge), not the claim (node).** The relationship between "we use blue buttons" and the corporate style guide is different from the relationship between "we use blue buttons" and a psychology research paper. The evidence explaining each connection is distinct.

### The hierarchy insight

Every edge has a natural direction: from a more specific claim toward a more general one. "We use blue buttons" is specific. The style guide section it implements is more general. The research paper that inspired the style guide is even more general. The director who approved the style guide is the ultimate authority.

This means the graph has a natural **top** (people, external authoritative sources) and **bottom** (the most specific, context-bound claims). Walking **up** reveals broader context, authority, and reasoning. Walking **down** reveals specific implementations, applications, and exceptions.

---

## Decision

### 1. Edge labels are agent-defined (free text, no fixed taxonomy)

The `label` field on `knowledge_edges` is free text, required, defined by the AI agent that creates the edge. Examples:

- `"implements section 3.2"`
- `"is approved by"`
- `"is supported by research"`
- `"applies regulation"`
- `"summarizes"`
- `"derived from"`
- `"supersedes"`
- `"is a specific instance of"`
- `"was rejected in favor of"`

No fixed taxonomy is enforced at the schema level. The label is the agent's natural language description of the relationship. The system encourages good labeling via documentation and search examples but does not constrain it.

**Optional edge tags** allow structured filtering without enforcing label vocabulary: `kind:approval`, `kind:citation`, `kind:evidence`, `kind:derived`, `kind:contradiction`. Agents can add tags if they want, but they're optional.

### 2. Evidence lives on edges, not nodes

The `evidence_summary` field on `knowledge_edges` contains the "because" of the relationship:

> Edge from "we use blue buttons" → corporate style guide:
> - label: "implements"
> - evidence_summary: "Section 3.2 specifies primary blue #0066CC for all interactive elements"

> Edge from "we use blue buttons" → Smith et al. 2024:
> - label: "is supported by research"
> - evidence_summary: "Smith et al. (2024) found blue UI elements scored 23% higher on perceived intelligence in user studies"

The same claim can have multiple outgoing edges, each with its own label and evidence. The claim node itself needs no "evidence" field beyond its own reasoning summary.

For rich evidence (documents, screenshots, code), the edge has an optional `evidence_bundle_id` pointing to a payload bundle.

### 3. The primary direction: specific → general

Every edge points **upward** from the more specific claim to the more general one. This is the core convention that gives the graph its navigable hierarchy.

| Specific (source) | Edge label | General (target) |
|---|---|---|
| "blue buttons on Website A" | "implements" | corporate style guide section |
| corporate style guide section | "approved by" | Director of Design (user) |
| corporate style guide section | "is supported by" | research paper (external source) |
| company privacy policy | "required by" | GDPR Article 6 (external source) |
| privacy policy decision | "decided by" | Chief Privacy Officer (user) |
| "Website B chose different color" | "derived from, with modifications" | corporate style guide |

**Why specific → general?** Because any specific claim can cite multiple general contexts. Each is "more general" in a different way (authority, research, regulation, principle). The direction is unambiguous: the specific thing points to the general thing that justifies or informs it.

**What about supersession and contradiction?** These are lateral or temporal relationships, not hierarchical. They still use the edge structure with appropriate labels:
- Supersession: new claim → old claim, label: "supersedes", evidence: "updated for 2026 rebrand"
- Contradiction: challenging claim → challenged claim, label: "refutes", evidence: "found opposite result in 2026 testing"

The direction convention (specific → general) is a PRIMARY guide, not an absolute rule. Agents use judgment. The label describes the relationship; the direction is a convention that aids traversal.

### 4. People and external sources are first-class nodes

**Users** (in `public.users`) are valid edge targets. Edges from claims to users express authority: "this was decided by", "this was approved by", "this was submitted by [role]."

User nodes don't carry extra content — they're just identity anchors. The trust weight of a user (from `users.trust_score`) propagates down the graph: claims that chain up to high-trust users have higher authority signal.

**External sources** (in `claimnet.external_sources`) are valid edge targets. They represent sources of truth that live outside ClaimNet: regulations, research papers, documentation, official specifications, reference implementations. Edges from claims to external sources express citation: "implements", "is required by", "cites", "is based on".

External source nodes contain only a URL + metadata. They never store content. They are persistent anchors for citation relationships.

### 5. Sub-claims as hierarchical knowledge chunks

AI agents are encouraged to decompose broad claims into sub-claims at multiple levels of specificity. Each level has its own payload and embedding — enabling multi-resolution search.

Example hierarchy for a corporate style guide:
```
Corporate Style Guide (broad, generalized embedding from full PDF)
  ← "is a section of" ←  Colors section (specific section embedding)
  ← "is a section of" ←  Typography section
  ← "is a section of" ←  Logo usage section
    ← "implements" ←  Website A logo implementation
    ← "implements" ←  Website B logo implementation (different variant)
      ← "is a design decision for" ←  "Website B chose square crop for mobile"
```

This gives the search engine multiple resolution levels to work with:
- A broad search finds the style guide
- A specific search finds the colors section
- A very specific search finds the Website A implementation

Agents construct this hierarchy organically based on what granularity makes sense for their use cases. The system does not prescribe how deep or wide the hierarchy should be.

Sub-claims are also automatically evidence for their parent. An edge from the sub-claim up to its parent has a default label of "is a sub-claim of" if not specified otherwise.

### 6. Timestamps as a staleness signal

When a sub-claim's `created_at` or `updated_at` is newer than its parent's, the parent may be stale. The system surfaces this: parent claims with newer descendant claims that haven't propagated upward get a `has_unapplied_descendants` signal in `ranking_signals`.

This is how an agent can detect that the director's style guide summary is out of date relative to the sub-claims that have accumulated since it was written. The agent can then surface this to the director for review.

### 7. Cycles are allowed; max depth is 16

The graph is a **directed graph that is not necessarily acyclic**. Cycles form naturally from cross-links: two sub-claims from different parts of the hierarchy might reference each other.

Cycles are handled by:
- `depth < 16` limit in all traversal queries
- `NOT (target_id = ANY(path_ids))` cycle prevention in recursive CTEs

16 is the default maximum traversal depth. It can be overridden per query (e.g., `maxDepth=3` for a shallow context fetch, `maxDepth=8` for a deep lineage trace). The maximum allowed value is 16; queries requesting more are capped.

---

## What this replaces

The following structures from prior ADRs are superseded by the knowledge edge model:

- **`provenance_refs` on claims** → removed. Provenance is now a knowledge edge with label "derived from".
- **`supersessions` table** → removed. Supersession is a knowledge edge with label "supersedes".
- **Counter-analyses** → retained as structured records (they carry rich fields like `outcome`, `confidence`), but their *relationship* to the claim they challenge is also expressed as a knowledge edge (auto-created when the counter-analysis is submitted, label: "refutes" or the specified `relation_type`).
- **Validations** → retained as structured records; their connection to the claim they validate is auto-expressed as a knowledge edge (label: "validates with [outcome]").

---

## Consequences

- Edge labels require good documentation and example-driven guidance to be used consistently
- Free-text labels make direct label equality queries unreliable — tag-based filtering and embedding similarity on edge labels should be used for discovery
- The `evidence_summary` field means agents need to articulate WHY two things are connected, not just that they are — this is a quality bar that produces richer, more useful graphs
- Sub-claim hierarchies are built by agents organically — the system should not try to auto-generate them, consistent with the "zero LLM on server" principle
- Timestamp-based staleness signals require the worker to compare descendant timestamps against ancestor claim `updated_at`
