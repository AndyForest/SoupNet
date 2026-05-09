# ADR-0008: Two-schema boundary — Payload (public) and Drizzle (claimnet)

**Date:** 2026-03-19
**Status:** Superseded (2026-03-24) — Payload CMS removed. All tables now live in the single `claimnet` schema, managed entirely by Drizzle. The two-schema boundary no longer exists.

---

## Context

ClaimNet uses Payload CMS as the backend framework. Payload manages its own PostgreSQL tables (users, organizations, content collections, auth, admin UI) and generates its own SQL migrations automatically.

The product also needs a set of tables that Payload does not own: vectors, ranking signals, artifact cache metadata, fulfillment attempts, the audit log, and eventually all core content tables (claims, validations, requests, etc.) once we move them off Payload's collection system.

This creates a two-system problem: **who generates and runs the migrations?**

### Options considered

**Option A: Everything in Payload.** Put all tables inside Payload collections, let Payload manage all migrations.

- Pros: one migration system, admin UI for free
- Cons: Payload's migration system is designed for its own table shape. Custom tables (e.g. `vector(3072)` pgvector columns, HNSW indexes, chunking tables) are not expressible in Payload's collection config. Workarounds require raw SQL hooks that defeat Payload's migration tracking. Vectors and ranking signals are not CMS content — forcing them into Payload's model creates semantic confusion and fragile migration state.

**Option B: Everything in Drizzle.** Write custom migrations for all tables including Payload's auth tables.

- Cons: Payload's auth, admin, and CMS machinery depends on its own table shape. Bypassing Payload's migration system means any Payload upgrade may silently break the schema. Not a maintainable path.

**Option C: Two migration systems, two PostgreSQL schemas.**

Each system owns a separate PostgreSQL schema and manages only its own schema. No interference is possible because Postgres schema isolation is enforced at the database level.

---

## Decision

Use two PostgreSQL schemas:

| Schema | Migration system | Contains |
|---|---|---|
| `public` | Payload (`payload migrate`) | `users`, `organizations`, `org_members`, `client_nodes`, `api_clients`, `moderation_cases`, all Payload internal tables |
| `claimnet` | Drizzle (`drizzle-kit generate` + `drizzle-kit migrate`) | `claims`, `validations`, `requests`, `counter_analyses`, `supersessions`, `neutral_summaries`, `embedding_sources`, `embeddings_gemini_001`, `embeddings_cohere_v4`, `ranking_signals`, `artifact_cache_entries`, `fulfillment_attempts`, `audit_log` |

`packages/db/src/schema/` is the single source of truth (SSOT) for all `claimnet.*` tables. Drizzle generates migrations from the schema files. Migrations are committed to the repo.

---

## Cross-schema references

`claimnet` tables reference `public` tables frequently (e.g. `claims.author_id` → `public.users.id`). These are plain `uuid` columns, not `FOREIGN KEY` constraints, because:

1. PostgreSQL does not enforce FK constraints across schemas by default
2. Payload owns the `public` schema — we should not add constraints that Payload doesn't know about
3. The service layer validates referenced IDs exist before writing

This is an intentional trade-off. Referential integrity is the service layer's responsibility.

---

## DDL export for documentation

As part of the CI pipeline, a `pg_dump --schema-only --schema=claimnet` step generates a snapshot of the current DDL. This snapshot is committed to `docs/schema-dump.sql` and updated on every migration. It serves as a human-readable audit trail and makes schema reviews easy in PRs.

The `public` schema DDL is not exported — Payload manages it and its migration state is internal.

---

## Consequences

- `packages/db/src/schema/` is the only place to define or change `claimnet.*` tables
- Never write raw `ALTER TABLE` against `claimnet.*` tables — always go through Drizzle migration
- `drizzle-kit generate` must be run after any schema change; the generated migration file must be committed
- Payload upgrades may change `public.*` — this is expected and handled by `payload migrate`
- The `DATABASE_URL` connection string gives both systems access to the same Postgres instance; schema prefixes keep them isolated
- Drizzle config (`packages/db/drizzle.config.ts`) sets `schemaFilter: ['claimnet']` so `drizzle-kit` never touches the `public` schema

---

## Implementation

In `packages/db/src/schema/*.ts`, all tables are wrapped in `pgSchema('claimnet')`:

```typescript
import { pgSchema } from 'drizzle-orm/pg-core';

export const claimnetSchema = pgSchema('claimnet');

export const claims = claimnetSchema.table('claims', {
  // ...
});
```

Drizzle config:

```typescript
// packages/db/drizzle.config.ts
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ['claimnet'],
});
```
