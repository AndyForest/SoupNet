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

---

## v1.1 — import identity, fresh-user provisioning, cache survival (2026-07-13)

v1 shipped as PR #32 (merge `1f51388`). v1.1 records Andy's rulings that turn import from a same-owner backup/restore into a **corpus-portability tool** — and the guarantees that portability depends on.

### 1. Import identity — mint on conflict, accept missing ids

> "This isn't a database backup and restore tool, it's a corpus export and import tool. So it seems fine for us to just make up a new FK for a recipe if there's a conflict." … "I'd even argue that it would be ok for the PK to be missing in the data to be imported and still be fine to import."
> — Andy, 2026-07-13

The tool-identity rationale: a corpus is a person's recipes, not a database dump. It should move wherever it's needed without demanding byte-identical primary-key restoration into a specific instance. So:

- **Ownership conflict → mint.** A trace id that already exists **and is owned by another user** is no longer skipped (v1 counted it as `notOwned` and dropped it). It is minted a fresh UUID and inserted as the importer's own. The import result returns an **old→new id mapping** (`idMap`), and the in-file cross-references to that recipe id — the `trace_evidence` / `trace_references` endpoints, the only recipe-id references the export format carries — are rewritten to the new id **within the import**, so the minted rows and their links stay internally consistent. The dependent link rows also get fresh PKs of their own (a link on a minted trace is a genuinely new relationship; keeping its old PK would collide with the source owner's link row on a same-instance re-import and be dropped, orphaning the minted trace).
- **Missing PK → mint.** A row that arrives without an `id` is accepted and minted one at parse time. Only the row's own PK is minted; foreign-key endpoints (`traceId`/`evidenceId`/`referenceId`) stay required, because a link with a missing endpoint has no row to point at.
- **Same-owner path preserved (unchanged).** A re-import of *your own* corpus still upserts on the preserved ids — the v1 idempotency acceptance criterion stands, and backup/restore + citation stability for one's own corpus survive. Mint-on-conflict adds multi-tenant mobility *on top of* exact-id same-owner restore; it does not replace it.

**id-mapping shape** (in the import result and the `corpus.imported` audit row):

```jsonc
"idMap": [
  { "entity": "trace", "from": "<original-export-id>", "to": "<minted-id>" }
]
```

Empty when nothing collided. `remapped` also appears in `counts.traces` as the number of minted-on-conflict traces (a subset of `inserted` — those rows *are* inserted). Shared rows (evidence, references) have no owner and are never remapped; they follow the existing "existing wins" collision rule.

> Note: this is the same ownership-remap decision the read-only-sharing `copyTraceToBook` primitive will need (see `docs/backlog.md`). Decide it once here; reuse there.

### 2. Fresh-user-per-corpus provisioning (intended usage)

> "It even feels safer from recipe pollution to just have a run setup step that always just makes a new user, then imports the data into it. Then tear-down the user afterwards."
> — Andy, 2026-07-13

With mint-on-conflict, this pattern is fully supported on a **single instance** using only existing surfaces — no new endpoints:

1. **Create** a throwaway account — `POST /auth/register` → `POST /auth/verify` → `POST /auth/login` (or provision directly for automated setup).
2. **Import** the corpus into it — `POST /import` (new book by default). Every id that already belongs to someone else on the instance is minted anew, so the throwaway account gets a complete, independently-owned copy rather than a pile of skipped rows.
3. **Tear down** — `DELETE /auth/me` (routes through `deleteUserCascade`), which removes the account and all its data **but deliberately preserves the vector cache** (see §3).

This isolates imported content from the operator's real books (recipe-pollution safety) while the content-addressed cache means the *next* provisioning of the same corpus re-embeds for free.

### 3. Vector-cache preservation across user deletion

> "let's double check that deleting a user doesn't delete their entries in the vector cache. We want to keep those precisely for this kind of thing."
> — Andy, 2026-07-13

**Verified safe — no fix required.** The `vector_cache` table is content-addressed (`content_hash + model_id + task_type`), holds no source text, and carries no foreign keys back to any entity, so it is deliberately cross-user and PII-free. Neither deletion path touches it:

- `deleteUserCascade` (`user-delete.service.ts`) lists `vector_cache` under "Deliberately preserved."
- `deleteEmbeddingChainForSource` (`trace-delete.service.ts`) removes the four-table embedding chain (sources → strategies → chunks → vectors) for a source but never the cache.
- `scripts/cleanup-test-data.ts` deletes the embedding chain, not the cache.

Regression test: `apps/backend/src/services/import-cache-survival.test.ts` — create user → import → embed → delete user → assert the `vector_cache` row **survives byte-for-byte** (same id + `created_at`, not re-created) → re-import the identical content as another user → assert the re-embed is a cache **hit** (0 provider calls: the surviving row is returned unchanged, never re-inserted).

### 4. `decided_at` semantics — null is contemporaneous

> "I like that it's null rather than filled with the createdAt so we know the difference."
> — Andy, 2026-07-13

`traces.decided_at` is **null by design when the decision was contemporaneous** with the check (the agent logged it as it happened) and **populated only when a decision is backfilled** to its original historical date (decision archaeology). The null vs. populated distinction is *information*, not a gap — it tells a reader whether a judgment date was asserted or is simply "whenever it was logged." On a real corpus almost every trace is null (contemporaneous), and that is the expected, correct state — not something to "fill in."

Import preserves `decided_at` exactly (v1 design point 4), including the null. **Consumers that need "when was this decided" filter or order on `COALESCE(decided_at, created_at)`** — the coalesce lives in the consumer, not in the stored data. (See the stigmergic-decay note in `docs/backlog.md`, which already weights on `COALESCE(decided_at, created_at)` for the same reason.)
