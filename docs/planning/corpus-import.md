# Corpus import — implementation brief

**Status**: ready to implement (2026-07-12). Owner: implementation agent + Andy review.
**What**: the inverse of `GET /auth/me/export` — take an export JSON and load it into an account, so a corpus can move between instances, be restored from backup, or be rebuilt into fresh books.

## Why now

- The public benchmarks page promises it: *"a corpus-import path (the inverse of `/auth/me/export`) is on the roadmap so a reader can load the exact corpus and reproduce cheaply via the content-addressed cache"* ([docs/benchmarks.md](../benchmarks.md), Reproducing this).
- It is the enabling feature for the portability story: one corpus, exported once, loaded anywhere, consulted from any vendor's agent.
- Backup/restore currently requires raw DB access; import makes `/auth/me/export` a real backup format.

## Design points (from [backlog.md](../backlog.md), preserved verbatim where quoted)

1. **Idempotency** — "re-import must not duplicate — trace ids are UUIDs, upsert on id." Double-importing the same file is a no-op. Importing a file that partially overlaps existing data upserts the overlap, inserts the rest.
2. **Re-embedding** — "the export carries no vectors, so import must enqueue re-embedding." Embeddings run through the existing content-addressed vector cache (`content_hash + model_id + task_type`), so re-importing previously-embedded text costs zero API calls; only genuinely new text hits the embedding provider. **Embeddings stay off the write critical path**: the import transaction commits rows first; embedding is an async queue that drains afterward. Imported-but-not-yet-embedded traces must be visibly pending, not silently invisible to search.
3. **Prompt-injection posture** — "imported traces are third-party text entering briefings — same review consideration as shared books." Import does not launder trust: imported content is stored as data, never interpreted as instructions during import, and inherits whatever review/labeling treatment shared-book content gets on the read path.
4. **`decided_at` fidelity** — the export includes `traces.decided_at` (commit `d0e667c`); import must preserve it exactly, along with created/captured timestamps. Timestamp preservation is load-bearing for any consumer that filters or orders by decision date.
5. **Book targeting** — the caller chooses the destination: import into a **new book** (default; safest, aligns with the search-append hygiene guidance) or a named existing book. Original book/group structure in the file is preserved as metadata either way, so a multi-book export can be reconstructed or deliberately flattened. Keep the server simple: subsetting/filtering an export (by date, book, tag) is the **client's job on the JSON** before upload — no server-side filter parameters in v1.
6. **Schema versioning** — exports carry a `schemaVersion`; treat unknown *additive* keys as forward-compatible (additive-by-key-presence), reject only on incompatible structural versions, with an actionable error naming the version mismatch.
7. **Collision semantics** — on id collision with differing content, the import result reports it (id, which fields differ, kept-vs-incoming) rather than silently overwriting; default = existing row wins, `overwrite: true` opts into upsert-replace. The result summary doubles as an existence oracle: counts of inserted / skipped-identical / conflicted / failed rows.
8. **Auth surface** — import mutates traces, so it follows the existing trace-mutation posture: signed-in human (JWT + verified email), owner-only, no API-key path. Same reasoning as recipe re-filing and deletion being human-only controls.
9. **Scale** — real exports are ~20 MB / 40k+ traces today. Streaming or chunked parse (no whole-file-in-memory JSON.parse on the request thread), progress reporting for the async embed queue, and a documented practical size limit.
10. **Operational constraint** — no schema migration work in this feature may violate the migration-at-startup availability constraint already recorded for this codebase.

## Out of scope (v1)

- Cross-account merge policies beyond the collision semantics above.
- Server-side transform/filter of the export during import (client-side on the JSON).
- Importing feedback/reaction rows (traces + books + metadata first; log a follow-up if the export gains more sections).
- PII handling: the export is the user's own data; scrubbing before *sharing* an export remains the exporter's responsibility, as today.

## Acceptance criteria

1. **Round-trip**: export → import into a fresh account → export again → semantically equivalent (same traces, books-as-mapped, timestamps incl. `decided_at`, modulo server-assigned metadata).
2. **Idempotent**: importing the same file twice → second run reports all rows skipped-identical, zero duplicates.
3. **Cache-warm re-embed**: importing an export whose text was previously embedded on the instance completes its embed queue with zero provider API calls (verify via provider-call counter/logs).
4. **Cold re-embed**: novel text is embedded async; search finds it after queue drain; pending state visible before.
5. **Conflict report**: a doctored overlapping file produces the per-row conflict summary; default preserves existing rows.
6. **Rejects** malformed files and incompatible schema versions with actionable errors; a failed import leaves no partial invisible state (transactional or resumable, documented which).
7. Route is JWT + verified-email gated; API-key access returns 403.

## Suggested implementation order

Parse/validate + schema gate → transactional row import with collision handling → embed-queue integration (cache-first) → result summary → route/auth wiring → round-trip + idempotency + cache tests → docs (README export section gains its import counterpart; benchmarks.md "Reproducing this" updated to point at the real path).

## Working practice

Standard Soup.net development practice applies: get the briefing at session start, recipe-check genuine design judgment calls as they arise (several of the design points above came from exactly such recorded calls), and log feedback on recipes that influenced decisions.
