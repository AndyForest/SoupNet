# Code Generation Pipeline

All generated artifacts in ClaimNet, and when to regenerate them.

> **Principle:** Generated files are authoritative for *structure* (columns, types, hooks). Hand-written docs are authoritative for *rationale* (why this design, what the tradeoffs are). Cross-link, don't duplicate.

---

## Pipeline overview

```
Source of truth              Generator                     Output
──────────────               ─────────                     ──────

packages/db/src/schema/  →  npm run generate:data-model  → docs/architecture/data-model-generated.md
  (Drizzle ORM)               reads migration snapshot       Mermaid ER + column tables
                               from packages/db/migrations/

packages/contracts/src/  →  npm run generate:openapi     → packages/api-client/openapi.json
  (Zod schemas)               via openapi-registry           OpenAPI spec (committed)
                          →  npm run generate:api-client  → packages/api-client/src/generated/claimnet.ts
                               via Orval                      React Query hooks + TS types
```

All three generators are plain `npx tsx` or `npx orval` scripts — no build step required.

---

## When to regenerate

| Changed | Run | Auto-triggered? |
|---|---|---|
| Drizzle schema (`packages/db/src/schema/`) | `npm run db:generate` in `packages/db` (runs `drizzle-kit generate`, then `generate:data-model` automatically) | Yes — chained after `db:generate` |
| Zod schemas (`packages/contracts/src/`) | `npm run generate:openapi && npm run generate:api-client` | No — run manually |
| Nothing changed, just want fresh docs | `npm run generate:data-model` | — |

**Commit generated files** alongside your source changes. CI can diff them to catch staleness.

---

## 1. Data model docs (`generate:data-model`)

**Source:** Drizzle migration snapshot JSON (`packages/db/migrations/meta/NNNN_snapshot.json`).

**Output:** `docs/architecture/data-model-generated.md` — Mermaid ER diagram, column tables, indexes, constraints for all 20 tables.

**Companion:** `docs/architecture/data-model.md` — hand-written design rationale (Toulmin model, FK vs UUID-ref conventions, embedding pipeline design, etc.).

**Trigger:** Automatically runs after `npm run db:generate` in `packages/db`. Can also be run standalone: `npm run generate:data-model`.

**Script:** `scripts/generate-data-model-docs.ts` — reads the latest snapshot JSON (finds it via `_journal.json`), outputs markdown with Mermaid.

---

## 2. OpenAPI spec (`generate:openapi`)

**Source:** Zod schemas registered in `packages/contracts/src/openapi-registry.ts`.

**Output:** `packages/api-client/openapi.json` — committed snapshot.

**Why committed:** Orval can run without building contracts first. CI can diff against freshly generated version.

**Script:** `packages/contracts/scripts/generate-openapi.ts`.

> **Note:** The contracts package still contains schemas from the pre-pivot architecture (claims, validations, graph, nodes, requests). These need updating to match the current trace/evidence/reference model. See `backlog.md`.

---

## 3. API client hooks (`generate:api-client`)

**Source:** `packages/api-client/openapi.json`.

**Output:** `packages/api-client/src/generated/claimnet.ts` — React Query hooks + TypeScript types.

**Tool:** Orval (`packages/api-client/orval.config.ts`).

**Auth:** Custom `authFetch` mutator (`packages/api-client/src/mutator/auth-fetch.ts`) injects cookie auth. See the [auth mutator notes](#the-auth-mutator-situation) below.

---

## Who consumes what

| Consumer | Imports from | Auth mechanism |
|---|---|---|
| Frontend SPA | `@soupnet/api-client` (generated React Query hooks) | JWT cookie (`credentials: "include"`) |
| Backend (Hono) | `@soupnet/contracts` (Zod schemas for validation) | — (server-side) |
| MCP server | `@soupnet/contracts` via `@soupnet/client-sdk` | Bearer token (API key) |
| Web search page (agents) | Backend HTML endpoints | API key in URL |

MCP tools define input schemas locally in Zod — the MCP SDK converts to JSON Schema at runtime. No generation step needed.

---

## Design choices

### Why Zod is the source of truth (not OpenAPI)

Three consumers need the same schemas: backend validation (Zod `.parse()`), frontend types (TypeScript), and MCP tools (Zod → JSON Schema). Starting from Zod means the backend and MCP server can import directly. OpenAPI is derived when the frontend needs it.

### Why the OpenAPI snapshot is committed

Orval needs a file to run. Committing it means `generate:api-client` works standalone without building contracts first. The tradeoff: you must regenerate after schema changes.

### Why Drizzle snapshots (not live DB) for data model docs

The snapshot JSON is already machine-readable, always available (no running DB required), and version-controlled. It captures exactly what `drizzle-kit generate` produced — the same state that migrations will apply.

Migration-SQL-only objects (tsvector columns, HNSW indexes) are documented in a hardcoded note in the generator since they're not in the snapshot. See `data-model-generated.md`.

### The auth mutator situation

The `authFetch` mutator uses cookie auth, but the generated hooks come from the public API spec (Bearer token). This mismatch exists because the BFF registry isn't built yet. When it is, public API and BFF will have separate Orval targets.

### Why MCP tools don't use generated code

The MCP SDK converts Zod to JSON Schema at runtime. Adding a generation step would create a build dependency with no benefit.

---

## File reference

```
scripts/
└── generate-data-model-docs.ts     # Snapshot JSON → data-model-generated.md

packages/contracts/
├── src/
│   ├── *.ts                        # Zod schemas (source of truth for API types)
│   ├── openapi-registry.ts         # Registers paths + schemas for public API
│   └── index.ts                    # Barrel export
├── scripts/
│   └── generate-openapi.ts         # Writes openapi.json
└── package.json

packages/api-client/
├── openapi.json                    # Generated. Committed snapshot.
├── orval.config.ts                 # Orval → React Query hooks
├── src/
│   ├── generated/claimnet.ts       # Generated. Never hand-edit.
│   └── mutator/auth-fetch.ts       # Custom fetch wrapper (cookie auth)
└── package.json

packages/db/
├── src/schema/                     # Drizzle ORM (source of truth for DB tables)
├── migrations/
│   ├── *.sql                       # Generated migration files
│   └── meta/
│       ├── _journal.json           # Migration index
│       └── NNNN_snapshot.json      # Schema snapshot (input for data model docs)
└── package.json                    # db:generate chains → generate:data-model

docs/architecture/
├── data-model-generated.md         # Generated. Mermaid ER + column tables.
└── data-model.md                   # Hand-written. Design rationale.
```

---

## Commands summary

| Command | What it does | When to run |
|---|---|---|
| `npm run generate:data-model` | Snapshot JSON → Mermaid ER + column tables | After `drizzle-kit generate` (auto-chained) or standalone |
| `npm run generate:openapi` | Zod registry → `openapi.json` | After editing schemas or registry paths |
| `npm run generate:api-client` | `openapi.json` → React Query hooks | After `generate:openapi` |

---

## Known warnings

### `"import.meta" is not available with the "cjs" output format`

Appears during `generate:api-client`. Harmless — Orval's esbuild analyzes the mutator file in CJS mode but doesn't compile it. Vite handles `import.meta.env` correctly at build time.
