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
- `scripts/cleanup-test-data.mts` deletes the embedding chain, not the cache.

Regression test: `apps/backend/src/services/import-cache-survival.test.ts` — create user → import → embed → delete user → assert the `vector_cache` row **survives byte-for-byte** (same id + `created_at`, not re-created) → re-import the identical content as another user → assert the re-embed is a cache **hit** (0 provider calls: the surviving row is returned unchanged, never re-inserted).

### 4. `decided_at` semantics — null is contemporaneous

> "I like that it's null rather than filled with the createdAt so we know the difference."
> — Andy, 2026-07-13

`traces.decided_at` is **null by design when the decision was contemporaneous** with the check (the agent logged it as it happened) and **populated only when a decision is backfilled** to its original historical date (decision archaeology). The null vs. populated distinction is *information*, not a gap — it tells a reader whether a judgment date was asserted or is simply "whenever it was logged." On a real corpus almost every trace is null (contemporaneous), and that is the expected, correct state — not something to "fill in."

Import preserves `decided_at` exactly (v1 design point 4), including the null. **Consumers that need "when was this decided" filter or order on `COALESCE(decided_at, created_at)`** — the coalesce lives in the consumer, not in the stored data. (See the stigmergic-decay note in `docs/backlog.md`, which already weights on `COALESCE(decided_at, created_at)` for the same reason.)

---

> **Document convention (Andy, 2026-07-13):** unlike most docs in this repo, this file is a **timeline**, not a living spec — new rulings are appended with their date; earlier sections are the historical record and are not rewritten. Read bottom-up for current behavior.

## v1.2 — isolation supersedes sharing: deterministic full-subgraph mint (2026-07-13, later the same day)

v1.1 above shipped mint-on-conflict for **traces only**, with random UUIDs, and linked minted traces to the source owner's existing evidence/reference rows ("shared rows … never remapped"). Reviewing it, Andy stated the goal the design must serve:

> "The purpose of this is to … empower benchmarking tools to import the exact same recipes into a brand new user's recipe book, and have no cross recipe book or cross user connections so that parallel benchmark runs are not cross contaminated, and can also each be easily deleted on their own."
> — Andy, 2026-07-13

Two consequences of the v1.1 design violated that goal, and one latent defect compounded it:

1. **Shared rows are cross-user connections.** A minted trace linking to another user's evidence/reference rows is exactly the edge the goal forbids — and it broke clean per-run deletion: deleting one run left its book-scoped embedding rows behind whenever another run still linked the shared evidence (the orphan-check correctly preserves the shared row, but nothing removes the deleted run's scope rows for it).
2. **Shared evidence was invisible to the importer's related-evidence search** — its embedding rows stay scoped to the source book, and import queued stubs only for inserted evidence.
3. **Random minting was not idempotent.** Re-importing the same foreign file minted fresh ids every run — full duplicate copies — and nothing could catch it: imported traces carry `api_key_id = NULL`, which exempts them from the `(api_key_id, group_id, claim_text_hash)` uniqueness index (Postgres treats NULLs as distinct).

### The v1.2 ruling

Import produces a **fully independent subgraph per importer**, minted **deterministically**:

- **Everything foreign is minted, not shared.** A row that belongs to (traces, by ownership) or is linked into (evidence/references, by linkage through another user's trace) someone else's graph gets the importer's own copy under `mintImportId(userId, originalId)` — RFC 4122 UUIDv5, `apps/backend/src/lib/deterministic-id.ts`. The namespace constant is **frozen**: changing it breaks re-import idempotency on every live instance (pinned-vector test guards it).
- **Determinism = idempotency through the existing path.** A re-import derives the same minted ids, which now exist as the importer's own rows and flow down the ordinary same-owner upsert path: all skipped-identical, zero duplicates, `idMap` stable across runs. No new dedup machinery.
- **Parallel isolation.** The importer id is part of the mint, so two runs importing one source corpus derive disjoint ids — no cross-contamination, and each run's `DELETE /auth/me` removes its whole subgraph with no shared residue.
- **Links follow.** Every in-file reference to a minted id is rewritten within the import; a link with any remapped endpoint gets its own PK minted deterministically from the original link id (so link re-inserts self-collide and `onConflictDoNothing` keeps them idempotent).
- **Minted evidence is inserted evidence**, so it receives pending embedding stubs scoped to the importer's book — the v1.1 related-evidence blind spot dissolves rather than needing a patch.
- **Reuse only what touches nobody else.** Existing rows linked solely to the importer's own traces (or to nothing) are reused as before — same-owner backup/restore stays exact-id, the v1 idempotency criterion untouched.
- `idMap` now carries `entity: "trace" | "evidence" | "reference"`; `remapped` appears in all three `counts` blocks and counts *remaps*, not inserts (on re-import the remapped rows land in skipped counts).
- **PK-less rows stay random-minted** (v1.1 §1): a row that never had an id has no stable identity to be deterministic about, so they are not idempotent across re-imports — acceptable for the hand-trimmed one-off files that motivated accepting them.

Tests: isolation subgraph (route), re-import idempotency + stable `idMap` (route), parallel-importer disjointness (route), deterministic-mint properties + frozen-namespace pin (`deterministic-id.test.ts`). Recipe: `c40fd228`.

## v2 — create-only import (2026-09-27)

The import path produced one security finding after another, each from import reusing an id or linking into a row that already existed. Andy accepted the rethink that removes the whole class instead of guarding each path:

> "I agree with your rethink, that sounds like what we shuold have done!"
> — Andy, 2026-09-27, replying to the proposed rule "import only creates rows; links only connect rows within the same file; existing ids are always skipped or given fresh ones" (recipe `5d541d2c`)

This section supersedes v1 design point 7's `overwrite` clause, v1.1 §1's "Same-owner path preserved" upsert wording, and v1.2's "Reuse only what touches nobody else" bullet. What stays: the deterministic per-importer mint and its idempotency and isolation (recipe `c40fd228`), `idMap`, the lazily created destination book, and the one all-or-nothing transaction.

### Where each file row lands

- **An id new to the server** is inserted under that id, as before.
- **A trace whose id is the importer's own ordinary recipe** is kept as it is: skipped-identical, or a reported conflict (`kept: "existing"`) when its claim text or `decidedAt` differs.
- **An evidence or reference row whose id exists, and which nothing this import creates links to**, is kept as it is (skipped-existing). This is what a re-import of the same file sees, so it stays idempotent.
- **Anything else that exists** gets a fresh id: another person's recipe, a draft the importer deposited about someone else, or evidence and references that a recipe the import creates links to. The fresh id is the importer's mint, `mintImportId(userId, id)`, when that id is free; when the mint already exists it is kept on the same terms as the file's id, and otherwise the row gets a random id. The random fallback closes the case where someone pre-creates a row under the importer's public mint (private finding F100).
- **A row about someone else** (`onBehalfOf`) always gets a random id, as before (F96).

### Links

A link row is written only when both of its rows were created by this import, as returned by the inserts themselves. A link between two kept rows is counted `skippedExisting`; any other link, whether it has a kept row on one side or an id that is not in the file, is counted `orphaned`. Nothing is looked up in the database to decide a link, so no link can attach a quote to, read, or keep alive a row that existed before the import. The ownership rule that used to decide this (`authz/content-ownership.ts`, private finding F98) is removed.

### `overwrite` removed

`overwrite=true` on the importer's own recipes was removed rather than narrowed, because nothing depends on it: the two eval scripts passed `overwrite: false`, the frontend has no import control, and the only callers were its own Layer 3 test and the private security probes. The query parameter is now ignored; a changed row of your own is kept and reported as a conflict, which was already the default. Removing it also removes the embedding teardown that raced the worker sweep (the `import overwrite races the worker strategy sweep` flake).

### What changed in the response

- `counts.traces.overwritten` is gone.
- `counts.evidence.conflicted` and `counts.references.conflicted` are gone. Kept evidence and references are no longer compared with the file: without an ownership lookup, a content comparison against a row that may be someone else's would tell the importer whether their guess of its content was right.
- `conflicts` now only ever lists traces, always with `kept: "existing"`.

### What this costs

- A link from an existing recipe of yours to a new row in the file is counted orphaned, not written. Every link in an export joins rows of the same export, so this happens only when the destination already holds an older copy of a recipe, for example one verified with new evidence since the last import: the new evidence row is inserted but not attached to the existing recipe.
- Linking a new recipe to evidence or references by an id that is not in the file no longer works, even for your own rows. Include the rows in the file.

Recipes: `5d541d2c` (the rule), `cbe5dfad` (removing `overwrite`), `5b1ceb91` (links only between created rows; no ownership lookup).
