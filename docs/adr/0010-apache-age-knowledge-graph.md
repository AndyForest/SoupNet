# ADR-0010: Knowledge Graph Infrastructure — Postgres Relationships Table with Closure Cache

**Status:** Accepted (revised 2026-03-21 — replaces original AGE-based decision)
**Date:** 2026-03-21

---

## Context

The original ADR-0010 proposed Apache AGE (a Cypher-capable Postgres extension) for graph queries. That decision is superseded here for one critical reason: **RDS does not support AGE**, and the project should not self-manage a database server for the MVP.

The question is: what graph infrastructure correctly balances MVP simplicity, managed hosting, local dev parity, and a clear upgrade path?

### Graph structure: DAG (Directed Acyclic Graph), not a tree

**A claim can have multiple parents.** This is a first-class design requirement. A specific claim like "use blue buttons on Website A" can point upward to:
- The corporate style guide (authority parent)
- A psychology research paper (evidence parent)
- The director of design who approved the approach (authority parent)
- A Website B claim that took a related approach (lateral/cross-link parent)

This makes the graph a **DAG** — Directed Acyclic Graph — not a tree. DAG properties and implications for implementors:

- **Multiple parents**: any node can have any number of incoming edges (from more-specific children) and any number of outgoing edges (to more-general parents)
- **No cycles in the primary hierarchy**: a node must never become its own ancestor. Validate on edge insertion: if `target_id` is already a descendant of `source_id` in the closure, reject the edge as it would create a cycle.
- **Depth becomes a minimum**: in a tree, depth is unique per node. In a DAG, a node can be reached at multiple depths via different paths. The `depth` column in the closure table stores the **minimum depth** (shortest path) for the primary closure entry. Multiple paths at different depths may exist.
- **Path explosion**: a densely connected DAG can produce an exponential number of paths. The closure table caps this at `depth <= 16` and stores one representative path per `(descendant_id, ancestor_id)` pair. Full path enumeration is deferred to ad-hoc recursive CTE queries.
- **Deletion complexity**: removing an edge from a DAG requires rechecking whether affected closure rows are still reachable via other paths. This is the hardest maintenance operation. The standard solution: on deletion, mark affected closure rows as dirty and trigger a partial rebuild. If consistency is critical, trigger a full subtree rebuild. This is a known, solved problem — implementors should reference standard DAG closure table deletion algorithms.

### What graph capabilities ClaimNet actually needs

- Traversal: "find all claims reachable from this claim, to depth N, following edges upward (general) or downward (specific)"
- Ancestor lookup: "what authority nodes does this claim chain up to?"
- Descendant lookup: "what specific implementations of this principle exist?"
- Path queries: "what is the shortest path between claim A and claim B?"
- Cycle prevention: "is this target already a descendant of this source?"

These are all DAG traversal patterns. They are well-solved by the **closure table pattern** extended for multiple parents in standard SQL.

### The closure table pattern

A classic, proven approach for hierarchical data in relational databases:

```
knowledge_edges        — the raw relationships (one row per direct connection)
knowledge_edge_closure — worker-precomputed transitive paths to depth N
```

The closure table is rebuilt by a worker whenever edges change. Queries against it are O(1) lookups for "all descendants to depth N" instead of recursive CTEs at query time.

This is a pattern the founder has implemented before at production scale. It requires no graph database extension, no special Postgres build, and runs identically on local Docker and managed RDS.

---

## Decision

Use **standard Postgres** for the knowledge graph — no Apache AGE, no Neo4j, no graph database extension.

The implementation:
1. `claimnet.knowledge_edges` table — raw relationships with labels, evidence, and metadata
2. `claimnet.knowledge_edge_closure` cache table — worker-maintained transitive closure to depth ≤ 16
3. Recursive CTEs as fallback for cache misses and ad-hoc depth queries
4. A `QUEUES.GRAPH_CLOSURE_REBUILD` worker job triggered on edge insert/update/delete

**Infrastructure stack remains:** RDS Postgres (or any managed Postgres) + pgvector. No additional services.

---

## Infrastructure

### Local dev

Standard `postgres:17` Docker image with pgvector:
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    ports:
      - "5432:5432"
```

Identical to production. Zero local dev friction.

### Production (MVP)

Any managed Postgres:
- **AWS RDS for PostgreSQL** (recommended for AWS-primary) — ~$15-40/mo for t4g.micro
- **Neon** — serverless, scales to zero, generous free tier — good for early MVP
- **Supabase** — includes managed Postgres + edge functions if needed

All support pgvector via the `pgvector` extension. All support recursive CTEs. No additional services needed.

---

## Schema

### `claimnet.knowledge_edges`

The raw relationship table. See ADR-0017 for the information model (edge direction convention, label semantics, evidence placement).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `source_id` | `uuid` | The more **specific** node. Required. |
| `source_type` | `text` | `claim` — currently only claims are sources |
| `target_id` | `uuid` | The more **general** node. Required. |
| `target_type` | `text` | `claim` \| `external_source` \| `user` |
| `label` | `text` | Agent-defined relationship label. Required. Free text, no fixed taxonomy. |
| `tags` | `text[]` | Optional structured tags on this edge (e.g. `kind:evidence`, `kind:approval`) |
| `evidence_summary` | `text` | Why this connection exists. The "because" of the relationship. |
| `evidence_bundle_id` | `uuid` | Optional FK → `claimnet.payload_bundles.id`. For rich evidence payloads. |
| `confidence` | `float` | 0–1. Default 1.0. |
| `privacy_level` | `text` | Same enum as claims. Edge is visible only if both nodes AND the edge are within the viewer's privacy envelope. |
| `author_id` | `uuid` | UUID ref → `public.users.id` |
| `author_node_id` | `uuid` | UUID ref → `public.client_nodes.id`. Nullable. |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

**Indexes:** `source_id`, `target_id`, `(source_id, target_type)`, `(target_id, source_type)`, `tags` GIN.

**Constraint:** No `(source_id, target_id, label)` unique constraint — multiple edges with different labels can connect the same two nodes.

### `claimnet.knowledge_edge_closure`

Pre-computed transitive closure. Rebuilt by worker; never written directly by the application.

| Column | Type | Notes |
|---|---|---|
| `ancestor_id` | `uuid` | The more general node (higher in hierarchy) |
| `ancestor_type` | `text` | |
| `descendant_id` | `uuid` | The more specific node (lower in hierarchy) |
| `descendant_type` | `text` | |
| `depth` | `integer` | 1 = direct edge, 2 = one hop, …, max 16 |
| `path_ids` | `uuid[]` | Ordered array of node IDs from descendant to ancestor |
| `path_labels` | `text[]` | Edge labels along the path |
| `refreshed_at` | `timestamptz` | When this row was last computed |

**Indexes:** `(descendant_id, depth)`, `(ancestor_id, depth)`, `(descendant_id, ancestor_id)`.

**Unique:** `(descendant_id, ancestor_id)` — one row per (descendant, ancestor) pair, storing the **minimum depth** path. Multiple paths between the same pair at different depths are not all stored; if full path enumeration is needed, use the recursive CTE fallback. This keeps the closure table bounded even in dense DAGs.

### `claimnet.external_sources`

Lightweight nodes for external sources of truth that claims can point up to.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `url` | `text` | Canonical reference URL (web URL, file path, system URI). Required. |
| `title` | `text` | Human-readable title. |
| `description` | `text` | Brief description. |
| `tags` | `text[]` | e.g. `kind:regulation`, `kind:research`, `kind:documentation` |
| `organization_id` | `uuid` | UUID ref → `public.organizations.id`. Nullable for public sources. |
| `privacy_level` | `text` | Same enum as claims. |
| `created_by` | `uuid` | UUID ref → `public.users.id` |
| `created_at` | `timestamptz` | |

**Indexes:** `url` (unique per org), `organization_id`, `tags` GIN.

---

## Closure rebuild strategy

### On edge change
When an edge is inserted, updated, or deleted, the worker enqueues a `graph.closure.rebuild` job. The job incrementally updates the closure:

- **Insert**: add new closure rows for all (descendant, ancestor) pairs newly reachable through the new edge. Also validate that the new edge does not create a cycle: if `target_id` (the general node) already appears as a descendant of `source_id` in the closure, reject the insert with a constraint violation.
- **Delete**: removing an edge from a DAG requires rechecking whether each affected closure row is still reachable via an alternative path. Standard approach: mark affected closure rows as `needs_recheck`, then re-run the transitive closure computation for the affected subtree. If the node count is small, a full subtree rebuild is acceptable. For large graphs, use the standard DAG closure deletion algorithm (find all rows that are reachable *only* through the deleted edge and remove them).
- **Update**: treat as delete + insert.

### Full rebuild (scheduled)
A nightly full rebuild reconciles any drift. It recomputes the entire closure from scratch using a recursive CTE:

```sql
WITH RECURSIVE closure AS (
  SELECT source_id AS descendant_id, source_type AS descendant_type,
         target_id AS ancestor_id, target_type AS ancestor_type,
         1 AS depth,
         ARRAY[source_id] AS path_ids,
         ARRAY[label] AS path_labels
  FROM claimnet.knowledge_edges
  UNION ALL
  SELECT c.descendant_id, c.descendant_type,
         e.target_id, e.target_type,
         c.depth + 1,
         c.path_ids || e.source_id,
         c.path_labels || e.label
  FROM closure c
  JOIN claimnet.knowledge_edges e ON e.source_id = c.ancestor_id
  WHERE c.depth < 16
    AND NOT (e.target_id = ANY(c.path_ids))  -- cycle prevention
)
INSERT INTO claimnet.knowledge_edge_closure ...
ON CONFLICT DO UPDATE ...
```

The `NOT (e.target_id = ANY(c.path_ids))` clause prevents path explosion through cycles. In a correct DAG (no ancestor-cycles), this is belt-and-suspenders safety. The `depth < 16` limit caps traversal at the agreed maximum. The `ON CONFLICT DO UPDATE` upsert ensures that if a node is reachable via multiple paths, the **minimum depth** path wins.

---

## Query patterns

### All ancestors of a claim (walk up the hierarchy)
```sql
SELECT ancestor_id, ancestor_type, depth, path_labels
FROM claimnet.knowledge_edge_closure
WHERE descendant_id = $claimId
ORDER BY depth ASC;
```

### All descendants of a claim (walk down to specifics)
```sql
SELECT descendant_id, descendant_type, depth
FROM claimnet.knowledge_edge_closure
WHERE ancestor_id = $claimId AND depth <= $maxDepth
ORDER BY depth ASC;
```

### Direct neighbors (depth 1) — skip closure, use raw edges
```sql
SELECT * FROM claimnet.knowledge_edges
WHERE source_id = $claimId OR target_id = $claimId;
```

---

## Upgrade path

When the closure table pattern becomes a bottleneck (large corpus, complex traversal queries, performance pressure):

1. Stand up **Neo4j Aura** (managed, $65+/mo, excellent Cypher support, built-in vector search)
2. Migrate `knowledge_edges` data to Neo4j graph
3. Swap the query layer implementation behind the `GraphRepository` interface
4. No change to the application API, no change to the data model

The `knowledge_edges` table is the source of truth; the closure is a cache. Migration to a graph DB is a query layer swap, not a data migration.

---

## Consequences

- Standard RDS Postgres — no AGE, no Neo4j, no special extensions beyond pgvector
- Local dev is identical to production (standard `pgvector/pgvector:pg17` image)
- Closure rebuild adds worker complexity but keeps queries fast
- Cycles handled by depth limit (max 16) and `path_ids` cycle prevention in CTE
- Upgrade path to Neo4j is clean when needed
- The logical graph model (ADR-0017) is decoupled from the physical infrastructure
