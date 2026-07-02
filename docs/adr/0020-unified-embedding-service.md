# ADR-0020: Unified embedding service — collapse worker into backend

**Date:** 2026-04-17
**Status:** Accepted

---

## Context

ADR-0002 split the system into two Node processes:
- `apps/backend` (Hono HTTP) — handles requests, writes primary data, does the sync embedding path at check time.
- `apps/worker` (pg-boss) — runs the async 4-tier embedding pipeline (StrategySweep → StrategyCheck → VectorCheck → VectorApiCall).

That split served the original "embeddings don't block primary writes" rule (engineering-principles.md: "ACID writes, async side-effects"), but in practice both processes grew parallel implementations of the same things and then drifted:

- Two `embedding-provider.ts` modules (backend in `apps/backend/src/lib/embeddings/`, worker in `apps/worker/src/lib/`) with the same shape but different capabilities.
- Two Gemini clients (`gemini-client.ts` vs `gemini-embeddings.ts`) — similar request logic, different timeouts and default models.
- Two `db.ts` connection files, copy-pasted.
- The worker's `VectorCheckItem` carries only `{ vectorId, chunkId, chunkText, chunkHash, taskType, modelId }` — no file bytes, no mime type, no ROI metadata. When a multimodal chunk is deferred to the worker path, the worker emits a text-only vector and writes it to `vector_cache` under a hash the backend computed as `sha256(text + fileBuffer)`. That corrupts the cache for that hash. Documented and mitigated in ADR-0019 by forcing multimodal to the sync path.

The drift was possible because nothing structurally forced the two processes to share code. DRY-by-convention is load-bearing documentation; DRY-by-construction is a compiler check.

The question for this ADR: given there is no roadmap work that requires the async path to diverge from the sync path, what's the minimum-complexity structure that makes divergence impossible?

---

## Decision

**Collapse `apps/worker` into `apps/backend/src/embedding-worker/`. Boot the pg-boss consumers in-process from `apps/backend/src/index.ts`, gated by `EMBEDDING_WORKER_ENABLED` (default `true`).**

Concretely:

1. **Code move.** `apps/worker/src/*` moves verbatim to `apps/backend/src/embedding-worker/` preserving the `jobs/` and `lib/` subdirectory structure. The directory is named for what it does, not where it used to live — but the internal shape is preserved so reversing this decision is a straight file move.

2. **Shared modules collapse.** The worker's `db.ts` is deleted (backend already has one). `lib/embedding-provider.ts` and `lib/gemini-embeddings.ts` are deleted; the async pipeline imports from `apps/backend/src/lib/embeddings/provider.ts` and `apps/backend/src/lib/gemini-client.ts`. The backend provider already handles both text and multimodal; the pipeline will need a `batchEmbed(texts, taskType, modelId)` affordance added to the backend module (a small surface-area widening, not a new module).

3. **Queues boot at backend startup.** `apps/backend/src/index.ts` creates the `PgBoss` instance, calls `createQueue` for each queue, registers the work handlers, and schedules the 1-minute strategy sweep. HTTP listener starts after queues are wired so liveness reflects both.

4. **Bounded concurrency.** `WORKER_CONCURRENCY` (default 5) controls the pg-boss `batchSize` as before. The Node process also serves HTTP, so memory and event-loop pressure is shared — bounded concurrency keeps the HTTP side responsive when a strategy sweep fans out.

5. **Feature flag for future re-splitting.** `EMBEDDING_WORKER_ENABLED` env var (default `true`). When `false`, the backend skips the pg-boss boot and behaves as an HTTP-only process. This is the escape hatch: if HTTP and background work ever need to scale independently, set `EMBEDDING_WORKER_ENABLED=false` on the HTTP process and stand up a separate process (sidecar / separate container / separate service) with the same image and `EMBEDDING_WORKER_ENABLED=true`. No code re-split required; just a deployment-time flag.

6. **Graceful shutdown.** SIGTERM/SIGINT stops pg-boss (graceful) first, then closes the HTTP listener. Order matters: in-flight jobs complete, new ones stop being picked up, then the HTTP socket closes.

7. **Infra.** Any separate worker service / worker container / worker image-repo for the async pipeline can be retired — the backend image now carries it. Backend container memory/CPU unchanged for now (small) — if the combined workload exceeds that, bump in a follow-up.

---

## Alternatives considered

**A. Shared package for the common bits.** Extract `gemini-client`, `embedding-provider`, `db` into a `@soupnet/embedding-core` package consumed by both apps. Fixes the current drift but doesn't prevent a future `VectorCheckItem` shape drift, because the two consumers still have independent call sites. Shared code is not the same as shared behavior. Rejected — treats the symptom.

**B. Single-owner via internal API.** Backend calls itself over HTTP for async work. Adds network hop, auth, serialization — worse than the current split.

**C. Message-passing on pg-boss with all code in backend.** Backend enqueues multimodal-capable `VectorCheckItem` shapes; a worker-mode build of the same process consumes them. This is effectively the chosen design, but structured as "one process, two modes via flag" rather than "two apps." Chosen.

**D. Keep two apps but enforce parity with a type check.** Write a `@soupnet/embedding-contract` package whose types both apps must implement. Works for type-level drift, not for behavior drift (e.g. the worker's missing multimodal leg would still compile). Rejected — half-measure.

---

## Consequences

### Positive

- **No possible divergence.** The async pipeline imports the same `embedMultimodal`, `applyVisualCue`, and `chunk_hash` logic that the sync pipeline imports. Adding ROI support to the async path (next commit) is a one-site change.
- **One process to operate.** One log group, one task definition, one deploy. Worker/backend race conditions during deploy go away.
- **Simpler dev loop.** `docker compose up backend` is now the whole stack except postgres. No separate `dev:worker` terminal.
- **Feature-flag preserves the scaling option.** Same image, different env var. If HTTP latency ever gets noisy because of an embedding batch, we pull them apart without a code refactor.

### Negative / Risks

- **Shared process failure mode.** A pg-boss handler crash now takes down the HTTP process. Mitigation: handlers already catch their own errors (see `vector-api-call.ts` binary-split retry). A hard process-level crash in a handler would be a pre-existing bug.
- **Memory/CPU contention.** Backend + consumers now compete on the same 512MB task. In practice embeddings are I/O-bound (Gemini calls) so event-loop contention is low, and `WORKER_CONCURRENCY=5` caps it. Bump the task size if prod metrics show saturation.
- **Graceful shutdown order is load-bearing.** Container orchestrators send SIGTERM with a grace window (commonly 30s on most platforms). Must `boss.stop({ graceful: true })` before closing the HTTP listener so in-flight strategy sweeps complete. Tested.
- **Migration window.** When the new backend image rolls out with pg-boss wired in, the old worker service is still running. For ~1 deploy both will try to consume queues. pg-boss singleton keys + `FOR UPDATE SKIP LOCKED` make double-processing safe, but we schedule the worker service teardown in the same deploy to minimize the overlap.

### Neutral

- **Subdir name preserves reversibility.** `apps/backend/src/embedding-worker/` is tagged so a future extractor can `git mv apps/backend/src/embedding-worker apps/worker/src` and restore the old structure mechanically.

---

## Rollback

The escape hatch is the feature flag: set `EMBEDDING_WORKER_ENABLED=false` on all backend processes and stand up a fresh process (same image, flag set `true`) to handle queues. This is a deployment change, not a code change.

If the collapse itself needs to be reverted at the code level, the `embedding-worker/` subdir name and preserved `jobs/`/`lib/` structure make a mechanical extraction straightforward.

---

## Implementation notes

- `apps/backend/src/embedding-worker/index.ts` exposes `startEmbeddingWorker(db): Promise<() => Promise<void>>` returning a shutdown fn. The backend's `start()` awaits it and wires the returned fn into the SIGTERM/SIGINT handlers.
- `EMBEDDING_WORKER_ENABLED=false` short-circuits `startEmbeddingWorker` — no pg-boss connection, no handlers, no schedules.
- Handlers import from `apps/backend/src/lib/...` for DB, provider, and Gemini — not from a local copy.
- See `docs/adr/0019-roi-multimodal-embeddings.md` §Consequences for the worker drift this ADR resolves.
