# ADR-0015: Multi-File Payloads — Content-Addressed Files and Bundle Collections

**Status:** Withdrawn (2026-03-24) — Never implemented. The data model pivoted from claims/payloads to traces/evidence/references (Toulmin argumentation). File attachments may be revisited later with a simpler model.
**Date:** 2026-03-21

---

## Context

The original data model assumed a single file per claim: one `payload_hash`, one `mime_type`, one `s3_key`. This is insufficient for real agent workflows, where a "payload" is often a collection of related files:

- A React component with its TypeScript source, CSS module, and a screenshot
- A design decision with a PDF brief, a Figma export, and annotated reference images
- A code change with a diff, an updated test file, and a summary doc
- A research compilation with multiple PDFs

Additionally, with multimodal embeddings (Gemini Embedding supports text, image, PDF, audio, video), different files in the same payload warrant different embeddings. Concatenating them (repomix-style) would lose the per-modality signal.

The model should also support **file reuse across payloads**: if a foundational document (the corporate style guide PDF) appears in multiple claims' payloads, it should be stored once, with its hash as the identity key.

Finally, payload privacy (ADR-0014) requires per-file privacy levels: some files in a bundle can be `local_only` while others are server-stored.

---

## Decision

Replace the single `payload_hash`/`mime_type` on `claimnet.claims` with a two-layer structure, analogous to Git's blob/tree model:

- **`claimnet.payload_files`**: content-addressed individual files (blobs). Identity is `file_hash`. Stored once regardless of how many claims reference them.
- **`claimnet.payload_bundles`**: a specific collection of files tied to a claim (tree). Captures the exact set and ordering of files for this claim.
- **`claimnet.payload_bundle_files`**: join table associating files to bundles.

---

## Schema

### `claimnet.payload_files`

Individual file records. Content-addressed: `file_hash` (SHA-256) is the stable identity.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `file_hash` | `varchar(64)` | SHA-256 hex of raw file content. Globally unique per content. |
| `filename` | `text` | Original filename (e.g. `style-guide.pdf`). Advisory — the same hash can have different names in different bundles. |
| `mime_type` | `text` | Required. Must be in `ALLOWED_MIME_TYPES`. Determines embedding strategy. |
| `size_bytes` | `integer` | |
| `privacy_level` | `text` | `local_only` \| `agent_only` \| `user_only` \| `org_only` \| `public`. Independent of the claim's privacy level. |
| `vector_source` | `text` | `server` \| `client`. `client` = vectors were computed by the submitting agent; content may not be on server. |
| `s3_key` | `text` | Nullable. Null for `local_only` files or client-side-vector files where content was not transmitted. |
| `uploaded_by` | `uuid` | UUID ref → `public.users.id` |
| `organization_id` | `uuid` | UUID ref → `public.organizations.id`. For ACL scoping. |
| `created_at` | `timestamptz` | |

**Unique:** `(file_hash, organization_id)` — one record per unique content per org.
**Indexes:** `file_hash`, `organization_id`, `mime_type`, `privacy_level`.

**S3 lifecycle:** Server-stored files with `privacy_level != 'local_only'` live permanently in S3 (not cached). Files with `local_only` are never stored in S3; `s3_key` is null.

### `claimnet.payload_bundles`

A specific collection of files for a claim.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `claim_id` | `uuid` | FK → `claimnet.claims.id`. One bundle per claim. |
| `composite_hash` | `varchar(64)` | SHA-256 of sorted `file_hash` values concatenated. Identifies this exact file collection. |
| `privacy_level` | `text` | Ceiling privacy level for the bundle. No file in the bundle can be less restrictive than this. |
| `created_at` | `timestamptz` | |

**Unique:** `claim_id` — one bundle per claim (a claim has zero or one payload bundle).
**Index:** `composite_hash` (for deduplication detection).

### `claimnet.payload_bundle_files`

Join table with ordering.

| Column | Type | Notes |
|---|---|---|
| `bundle_id` | `uuid` | FK → `claimnet.payload_bundles.id` |
| `file_id` | `uuid` | FK → `claimnet.payload_files.id` |
| `ordinal` | `integer` | Display/processing order within the bundle |
| `display_filename` | `text` | Optional override for display (e.g. rename in this bundle context) |

**PK:** `(bundle_id, file_id)`.
**Index:** `(bundle_id, ordinal)`.

---

## Embedding strategy per file

Each file in a bundle is embedded individually based on its `mime_type`. The Gemini multimodal embedding model (`gemini-embedding-2-preview`) handles all supported types in the same vector space:

| MIME category | Examples | Embedding approach |
|---|---|---|
| `text/*` | markdown, code, HTML, plain text | Full text embedding |
| `application/pdf` | Design briefs, policies, research papers | PDF-native embedding (not extracted text) |
| `image/*` | PNG, JPEG, WebP, SVG (rasterized) | Image embedding |
| `audio/*` | Meeting recordings, voice notes | Audio embedding |
| `video/*` | Screen recordings, demos | Video frame sampling + embedding |
| `application/json`, `application/yaml` | Config files, schemas | Text embedding |

All modalities produce 3072-dimensional vectors in the same space, enabling cross-modal search. A text query matches an image-embedded file if the semantic content is similar.

The bundle as a whole also gets an embedding: computed from the concatenated text representations of all files, or (for large bundles) from a weighted average of individual file embeddings. This bundle-level embedding enables "find claims with a payload similar to this collection" queries.

---

## Privacy enforcement

Files in a bundle can have mixed privacy levels. A bundle with `privacy_level = 'org_only'` can contain:
- Some `org_only` files (visible to org members)
- Some `user_only` files (visible to submitting user only, even within the org)
- Some `local_only` files (not stored on server; fulfillment routes to originating client)

The effective visibility of a file is `min(claim.privacy_level, bundle.privacy_level, file.privacy_level)`. A file cannot be more visible than its bundle, which cannot be more visible than its claim.

When an agent fetches a claim, it receives the bundle metadata including which files are accessible at their privilege level. Files they can't access are listed as "available via fulfillment" with the file hash and size (for planning purposes).

---

## Content-addressed deduplication

The corporate style guide PDF (a common reference) will be referenced by many claims. With content-addressing:

1. First submission: `payload_files` row is created with the file's hash and S3 upload
2. Subsequent submissions: same hash → same `payload_files` row. No duplicate S3 upload.
3. Different bundles reference the same `payload_files` row

Deduplication is per-org (a `org_only` file in Org A is not shared with Org B even if the content hash matches). Public files could theoretically be shared cross-org, but this is deferred: the implementation uses per-org uniqueness for simplicity.

---

## Changes to the existing model

The following are removed from `claimnet.claims` (replaced by the bundle model):
- `payload_hash` — moved to `payload_bundle_files.file_id → payload_files.file_hash`
- `payload_size_bytes` — moved to `payload_files.size_bytes`
- `mime_type` on claims — moved to `payload_files.mime_type`

The `artifact_cache_entries` table (previously for ephemeral S3 caching) is retired. Files are now stored permanently if server-stored (`s3_key` is the permanent key). The fulfillment flow is unchanged: `fulfillment_attempts` still routes requests for local-only files to the originating client node.

---

## Consequences

- Three new tables: `payload_files`, `payload_bundles`, `payload_bundle_files`
- Remove `payload_hash`, `payload_size_bytes`, `mime_type` from `claimnet.claims`
- Retire `artifact_cache_entries`
- Embedding worker processes per-file, not per-claim
- Multimodal embedding is now first-class: one worker, one model (Gemini), all file types
- ADR-0005 (embedding models) is superseded: consolidate on Gemini multimodal embedding; Cohere Embed v4 for images is no longer needed
- Agents that submit multi-file payloads need the `@soupnet/local` SDK or a multi-part upload flow via the REST API
