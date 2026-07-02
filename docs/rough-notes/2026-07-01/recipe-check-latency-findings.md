# Recipe-check latency at ~1,300 recipes — measurement findings

**Date:** 2026-07-01
**Method:** black-box latency matrix against the production `/check` endpoint (each request toggles one pipeline stage), direct Gemini `embedContent` timing, and a local-stack reproduction seeded to 1,301 traces with stub embeddings (isolates DB/CPU cost from external-API cost). No code was changed; this note informs the approach.

## Headline

**The clustering code is ruled out.** K-means runs over at most one page of results (20 vectors × 3072 dims, ≤20 iterations) — sub-5ms, and prod timings with `expand=true` (clustering disabled) are statistically identical to clustered runs, as are `clusters=10` runs.

The latency has two real sources:

1. **Sequential external embedding calls dominate.** A new-recipe check makes **6 sequential Gemini `embedContent` round-trips**; a duplicate re-check makes 2. None are parallelized, none consult `vector_cache`, and 3 of the 6 are provably redundant (details below).
2. **The ANN search queries do not use the HNSW index.** `EXPLAIN ANALYZE` shows a full seq scan computing 3072-dim cosine distance against every `SEMANTIC_SIMILARITY` row (~12k today), then a top-N sort — **twice per check** (trace search + evidence search). This is the component that grows linearly with corpus size, i.e. the "it got slower as my recipes grew" signal. The carefully tuned `hnsw.ef_search = 1000` is currently a no-op.

## Measurements

### Production end-to-end (`/check?format=json`, test-project book, 2026-07-01)

| Request shape | Samples | Observed total |
|---|---|---|
| `/health` (network + TLS baseline) | 3 | 0.30 s |
| New recipe (full write + search) | 5 | **5.3 – 11.6 s** |
| Duplicate re-check (search only), cold-ish | 5 | 1.8 – 4.5 s |
| Duplicate re-check, steady state | 10 | **0.96 – 1.45 s** (one 2.9 s outlier) |
| Duplicate + `expand=true` (no clustering) | 5 | 1.0 – 3.1 s (indistinguishable from clustered) |
| Duplicate + `clusters=10` | 3 | 1.3 – 2.4 s (indistinguishable) |

The first requests after idle run 2–4× slower than steady state (buffer cache / connection warm-up). Sporadic real-world checks — which is how agents actually use it — mostly experience the cold-ish numbers.

### Gemini `embedContent` direct (from dev machine, 4 rounds)

200–450 ms per call, ~1.5 s for the 6-call sequence the code makes. Note the prod new−duplicate delta is **4–10 s for 4 calls**, far more than these numbers explain — either Gemini latency from the production network path is much worse, or something else in the sync write block is slow. This is the one gap only prod-side instrumentation can close (see the observability items).

### Local stack at prod scale (stub embeddings ⇒ pure DB/app cost)

Seeded 136 → 1,301 traces via 1,164 sequential real `/check` requests:

| Corpus size | New check (write+search) p50 | Search-only probe p50 |
|---|---|---|
| ~150 | 80 ms | 32 ms |
| ~700 | 119 ms | 58 ms |
| ~1,300 | **128 ms** | **71 ms** |

Everything the database does — including the 4 sync HNSW index inserts per new check, all ~70 small queries, clustering, and both ANN queries — fits in ~130 ms at prod scale on dev hardware. **The DB is not the bottleneck today**, but the seq-scan ANN cost is the piece that scales linearly (probe p50 doubled while corpus grew 10×) and will keep growing.

### EXPLAIN ANALYZE of the trace ANN query (local, 1,301 traces, literal and parameterized both)

```
Limit → Sort (top-N heapsort)
  → Hash Join ...
    → Seq Scan on embedding_vectors  (rows=11,738; Rows Removed by Filter: 11,738)
Execution Time: ~98–120 ms   (HNSW index never touched)
```

The planner rejects the HNSW path because the `ORDER BY` sits above joins with post-join filters (`es.source_type`, `es.group_id IN (...)`) and a `LIMIT 1000` that post-filtering can't guarantee to fill from the index's candidate stream. The standard pgvector fix is an inner subquery that orders/limits on `embedding_vectors` alone (where the index applies), joining and filtering outside — plus a partial index (see below).

## Per-check call inventory (from code, confirmed by the matrix)

New-recipe check, all sequential:

| # | Call | Needed for the response? |
|---|---|---|
| 1 | trace text, `RETRIEVAL_DOCUMENT` | **No** — search filters `task_type='SEMANTIC_SIMILARITY'`, and the documented provider bug (enqueue.ts, 2026-03-29) makes it byte-identical to #2 anyway |
| 2 | trace text, `SEMANTIC_SIMILARITY` | Yes (indexes the new trace) |
| 3 | full_recipe_context, `RETRIEVAL_DOCUMENT` | **No** — same twin-vector argument |
| 4 | full_recipe_context, `SEMANTIC_SIMILARITY` | Debatable — could defer to worker like the 6 experimental strategies already do |
| 5 | query embed in `hybridSearch` | **Redundant as an API call** — the query text IS the trace text; call #2 just wrote this exact vector to `vector_cache` keyed by its content hash, but `embedQuery` never consults the cache |
| 6 | query embed in `evidenceSearch` | **Redundant** — embeds the identical string as #5 again |

Duplicate re-checks make calls #5 and #6 only — meaning today's ~1 s search-only checks could serve entirely from `vector_cache` with **zero** Gemini calls.

## Secondary findings (quality, not just latency)

- **Experimental strategies compete in production search.** `embedding-strategies.ts` says `exp_*` strategies are "not used in production search," but `hybridSearch` searches all trace vectors with no strategy filter. Each trace carries ~8 `SEMANTIC_SIMILARITY` vectors (2 production + 6 experimental), so:
  - the seq scan (or a future HNSW scan's candidate budget) does ~4× the necessary work, and
  - the **1000-row candidate limit covers only ~260 distinct traces** after best-score dedup — prod checks returned `totalResults ≈ 255–269` against a 1,286-recipe corpus. The candidate budget is silently a recall cap.
- **`exp_trace_minimal` embeds the identical text as `full_document`** — its vector is an exact duplicate occupying index space and candidate slots.
- **`RETRIEVAL_DOCUMENT` twins** double the index/table size (~23k rows for ~12k useful vectors) for a task-type distinction the model provably ignores.
- F29 per-key rate-limit COUNTs on `audit_log` measured fine (indexed, ms-scale) — not a factor.

## Recommended approach (in impact order, not yet implemented)

1. **Route query embeds through `vector_cache`** (content-hash lookup, same as `getOrCreateCachedVector`) and **embed once per request**, reusing the vector across `hybridSearch` and `evidenceSearch`. Duplicate checks drop to 0 Gemini calls; new checks drop #5/#6.
2. **Sync write path: stop generating `RETRIEVAL_DOCUMENT` synchronously** (defer to worker, as the schema already supports) and **parallelize the remaining independent embed calls**. New-check latency floor becomes ~max(one embed call) instead of the sum of six.
3. **Restore HNSW usage**: inner-subquery query shape + a partial HNSW index on (`task_type='SEMANTIC_SIMILARITY' AND status='complete' AND vector IS NOT NULL`), and decide whether `exp_*` strategies belong in the search path at all (excluding them cuts scanned vectors ~4× and un-caps recall).
4. **Land per-stage instrumentation** (`Server-Timing` header + one structured timing log line per check) so the remaining prod-side unknown — why 4 embed calls cost 4–10 s from the production network — becomes a dashboard read. Companion infra briefing: private deployment repo, `docs/briefings/check-latency-observability.md`.

Expected end state: new checks ~1–1.5 s, duplicate/search-only checks ~0.5–0.8 s, both roughly flat in corpus size.

## Artifacts

- Prod matrix CSV + local scaling CSV + EXPLAIN output: session scratchpad (`bench-results.csv`, `local-scaling.csv`); summarized fully above.
- Local dev DB now contains **1,165 synthetic seed traces** (claim text `"... (variant N)"`, stub vectors) under the dev user's default book — see handoff note.
