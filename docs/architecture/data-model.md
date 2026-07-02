# ClaimNet Data Model

Single `claimnet` Postgres schema managed entirely by Drizzle ORM. Source of truth: `packages/db/src/schema/`. Run `drizzle-kit generate` after changes. Migrations applied automatically at backend startup.

Read alongside: `design-thinking.md`, `data-flow.md`, `architecture/overview.md`, `architecture/vector-store.md`.

> **Column-level reference:** See [data-model-generated.md](data-model-generated.md) for the complete table definitions, Mermaid ER diagram, indexes, and constraints. That file is auto-generated from the Drizzle migration snapshot — regenerate with `npm run generate:data-model`.

---

## Architecture: single schema, no Payload

All tables live in the `claimnet` Postgres schema. There is no `public` schema split — Payload CMS was dropped early in the project. Drizzle ORM is the sole schema manager. See `packages/db/src/schema/` for the TypeScript definitions.

---

## Three-entity Toulmin model

The core content model uses three entity types inspired by Toulmin argumentation:

- **Traces** — taste/judgment claims in user-story format ("As a [role] working on [goal], I [prefer/chose] so that [reason]"). The [goal] serves as Toulmin's Qualifier — the scope under which the claim holds. The core unit of the stigmergic search engine. Every search leaves a trace.
- **Evidence** — interpretations the recipe author offers in support of a trace. Linked via `trace_evidence`. The `stance` column persists for legacy data (`'for'` / `'against'`) but new entries are always `'for'` per ADR-0015 — embeddings can't distinguish stance, so the system stopped accepting `'against'` at ingest and the LLM consumer interprets stance at read time instead.
- **References** — raw quotes with cited sources. Can be linked to both traces (`trace_references`) and evidence (`evidence_references`).

All three link tables record `api_key_id` to track which agent session contributed each piece of coverage. Evidence and references are intentionally denormalized (no `user_id` or `group_id`) — they inherit scope through their linked traces.

References optionally support multimodal file attachments (`file_url`, `file_mime_type`, `file_hash`) for embedding via Gemini's multimodal API.

---

## Identity and access model

**Users** support local JWT auth (bcrypt passwords) with `provider`/`external_id` fields for future OIDC federation. System-level roles: `'system'` (root) and `'tenant'` (normal). Email verification is tracked with token + expiry.

**Organizations** are multi-tenant containers. Every user gets a personal org (`is_personal = true`) on signup. Organizations own recipe books.

**Recipe books** (table name: `groups`, member-link table: `group_members` — schema-level vocabulary kept per the deferred rename in ADR-0016) are the primary access-control unit. Traces and API keys are scoped to recipe books. Slugs are unique within their organization. Member roles: `'owner'`, `'admin'`, `'member'`.

**Invitations** allow adding members by email. They reserve a slot against the global signup cap (stored in `system_settings`). System admin invitations can bypass the cap.

---

## API key design

Keys are recipe-book-scoped with separate read/write permissions. Wire-format names use `recipeBook` vocabulary (`readRecipeBookIds`, `writeRecipeBookIds`, `defaultWriteRecipeBookId`); DB columns retain the schema-level `group` vocabulary per ADR-0016:

- `read_group_ids` — which recipe books this key can search
- `write_group_ids` — which recipe books this key can write traces to
- `default_write_group_id` — where traces go when no recipe book is specified

Two key types: `'daily'` (auto-rotating, generated on login) and `'scoped'` (manually created with specific permissions). Keys authenticate both the web search page (for AI agents) and the MCP endpoint (Bearer token).

The `api_key_id` on traces and linking tables enables per-agent coverage tracking — the system can report which agent sessions contributed what evidence to which claims.

---

## Idempotency

Traces use a three-column unique constraint: `(api_key_id, group_id, claim_text_hash)`. The `claim_text_hash` is a SHA-256 of the claim text. This means the same agent submitting the same recipe to the same recipe book produces the same trace — searches are naturally idempotent.

---

## Embedding pipeline

Four-table pipeline enabling multiple chunking strategies and vector types per source. See `docs/architecture/vector-store.md` for the full design.

```
embedding_sources → embedding_chunk_strategies → embedding_chunks → embedding_vectors
```

**Design rationale:**
- Multiple chunking strategies per source without duplicating source text
- Multiple task_types per chunk without duplicating chunk text
- Clear status tracking at each pipeline stage (`pending` → `processing` → `complete` | `failed`)
- ACID writes, async side-effects: embeddings never block primary writes (pg-boss queues)

**Vector types:** `halfvec(3072)` in `embedding_vectors` (HNSW-indexable, 50% storage vs float32). `vector(3072)` in `vector_cache` (full-precision originals for re-quantization).

**Vector cache:** Content-addressed by SHA-256 of source text. Avoids redundant Gemini API calls for identical content. No source text stored (PII-safe — hash is one-way, vector is not reversible).

**vector_source:** `'server'` (computed by ClaimNet via Gemini API) or `'client'` (computed client-side in air-gapped mode). Client vectors are recipe-book-scoped only.

---

## Reference source cache

When a reference cites a URL, the worker fetches and caches the content for embedding and display. Multiple fetch strategies are supported (`cloudflare_markdown`, `html_sanitized`, `direct_download`). Binary content goes to S3; text is stored inline.

---

## Audit log

Append-only, never updated or deleted. Tracks user actions (`actor_user_id`) with extensible `action` strings and `metadata` JSONB. `actor_node_id` is reserved for future client-node-initiated actions.

---

## FK vs UUID reference conventions

Tables within the same concern area use proper FK constraints (e.g., `group_members.group_id` → `groups.id`). Cross-concern references use UUID columns without FK constraints to avoid circular dependencies and tight coupling:

- `traces.user_id`, `traces.group_id` — no FK (traces schema can't import users/groups without circularity)
- `api_keys.user_id` — no FK
- `trace_evidence.api_key_id`, `trace_references.api_key_id` �� no FK
- `embedding_sources.group_id` — no FK

The service layer enforces referential integrity for all UUID references. The generated ER diagram in [data-model-generated.md](data-model-generated.md) distinguishes these visually (solid vs dotted lines).

---

## Migration-SQL-only objects

Some database objects are created by raw SQL in migration files because Drizzle doesn't support them natively:

- **`traces.tsv`** — `tsvector` generated column: `to_tsvector('english', claim_text)`. GIN-indexed for full-text search.
- ~~`embedding_vectors_hnsw_idx`~~ — dropped in migration 0026 (2026-07-02): the planner never chose it for the production search (exact top-N scan wins at current scale) while it cost 95 MB of buffer space + per-insert maintenance. Recreate (halfvec_cosine_ops, m=16, ef_construction=64) alongside a query reshape when scale demands — see backlog §Recipe-check latency.

These are documented in the generated reference but not captured by the Drizzle snapshot JSON.
