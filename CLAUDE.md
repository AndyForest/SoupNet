# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Soup.net is a stigmergic search engine for taste and judgment. AI agents check recipes and simultaneously log structured traces — every check leaves a trace that makes future checks smarter. Three-entity model (traces, evidence, references) inspired by Toulmin argumentation. Hybrid search: tsvector full-text + pgvector semantic (gemini-embedding-2-preview, 3072-dim halfvec).

## Monorepo Structure

npm workspaces monorepo. Node 24 LTS, npm ≥10.

- **apps/backend** — Hono HTTP server (port 3101). JWT + API-key auth, REST API, `/check` recipe page for AI agents, remote MCP endpoint at `POST /mcp`. Runs the pg-boss embedding consumers in-process (`src/embedding-worker/`); see ADR-0020.
- **apps/frontend** — Vite React SPA (port 5273). TanStack Router + Query. User dashboard for managing recipe books, API keys, recipe map.
- **apps/mcp-server** — Stdio MCP server (packaged as `.mcpb` for Claude Desktop). Thin proxy that forwards `check_recipe` / `get_briefing` calls to backend `/check` and `/briefing`. The remote HTTP MCP lives in backend per ADR-0007 + ADR-0021.
- **packages/db** — Drizzle ORM schema + migrations for `claimnet` Postgres schema. Single source of truth for all tables.
- **packages/domain** — Business logic, ranking rules, and shared agent-facing copy (recipe guide, briefings, principles). No I/O.
- **packages/contracts** — Zod schemas for the public API (source of truth for OpenAPI). Mostly legacy shapes from the pre-pivot claims/validations model; new routes (`/check`, `/traces`, `/uploads`, etc.) currently validate inline. Consolidation tracked in backlog.
- **packages/client-sdk** — REST API client wrapper.
- **packages/api-client** — Auto-generated React Query hooks from OpenAPI. Regenerated from contracts.
- **packages/config** — Shared tsconfig and ESLint config.

## Common Commands

```bash
# Start everything (postgres + backend, runs migrations automatically)
docker compose up --build -d

# Or for development with hot reload:
docker compose up -d postgres          # Start just postgres
npm run build:packages                  # Build internal packages
source .env && npm run dev:backend      # Hono server with tsx watch on :3101
npm run dev:frontend                    # Vite dev server on :5273

# Database migrations (Drizzle only — single schema). To add a new table:
#   1. Write packages/db/src/schema/<name>.ts (use api-keys.ts as a template).
#   2. Add `export * from "./<name>";` to packages/db/src/schema/index.ts.
#   3. From the project root: npm run db:generate
#      This regenerates the SQL migration AND docs/architecture/data-model-generated.md.
#      Drizzle assigns the migration filename automatically. To pass a descriptive
#      --name, run the underlying tool directly (and cd back to root afterwards —
#      the @soupnet/db workspace has no test:ci script, so running gates from there
#      will fail):
#        cd packages/db && npx drizzle-kit generate --name <descriptive_name> && cd -
#        npm run generate:data-model      # regenerate the data-model doc
#   4. Review the generated SQL in packages/db/migrations/ before committing.
# Migrations apply automatically at backend startup (apps/backend/src/db.ts).

# Quality gates — canonical pre-commit gate is test:ci (see Pre-Commit Workflow)
npm run test:ci                  # fresh isolated DB, mirrors CI exactly
npm run typecheck                # root script with --if-present; fast iteration
npm run lint                     # root script with --if-present; fast iteration
npx vitest run path/to.test.ts   # single test file during iteration
```

Do not use `npm run <script> --workspaces` without `--if-present` — it errors on workspaces that don't define the script (e.g. `@soupnet/config`). The root-level scripts (`npm run typecheck`, `npm run lint`) already add `--if-present`; use those.

## Backlog and Coordination

The shared backlog at [docs/backlog.md](docs/backlog.md) tracks all pending work. **Before starting a task:**

1. **Read `docs/backlog.md`** for context — your task may already be described there, may have dependencies, or may overlap with another agent's work.
2. **Check for related items** — your task may complete part of a larger backlog item, or your approach may affect other planned work.

**After completing work:**

1. **Move completed backlog items** to [docs/backlog-completed.md](docs/backlog-completed.md). Cut the item from `backlog.md` and paste it under the appropriate section in `backlog-completed.md` with a date stamp.
2. **Update partially completed items** — if you completed part of a multi-part backlog item, mark the done sub-items with ~~strikethrough~~ in `backlog.md`.
3. **Add new items discovered during work** — if you identify new work needed, add it to the appropriate section in `backlog.md` with the right tag (`[IMPL]`, `[DESIGN]`, `[DECISION NEEDED]`).

This is how multiple AI agents coordinate across sessions without explicit communication — through the backlog as a shared artifact.

## Pre-Commit Workflow

`.github/workflows/ci.yml` is the source of truth for what "passing" means. `npm run test:ci` (wrapping `scripts/test-ci-local.mjs`) reproduces that environment locally — fresh isolated postgres on port 5534, same env vars, same build + typecheck + lint + test sequence — and is the single canonical gate you run before committing. Typecheck runs after a workspace-wide clear of `*.tsbuildinfo` so incremental cache can't false-pass the way CI's clean checkout would catch.

**The two files must stay in sync.** They're maintained separately, so when a gate needs a new env var (e.g. a test asserts on an absolute URL rendered by the backend), add it to `.github/workflows/ci.yml` FIRST, then mirror it into `scripts/test-ci-local.mjs`. Doing it the other way around — updating the local script first — makes the local gate green while the real CI fails on push, exactly the failure mode the local gate is supposed to prevent (lost on 2026-05-14 when `FRONTEND_URL` landed in the local mirror only and the deploy failed on GitHub).

```bash
npm run test:ci
```

If it fails, fix before committing. Do not skip. Do not invent per-workspace variants — CI uses the root-level scripts (which pass `--if-present`), so agent-invented commands like `npm run typecheck --workspaces` hit missing-script errors CI doesn't. During tight iteration you can run `npx vitest run path/to.test.ts` against the dev Docker backend for faster feedback, but the gate before commit is always `npm run test:ci`.

After tests pass, check `docs/testing-plan.md` Layer 4 for manual browser verification — tell the human what URLs to check and what to look for. **If backend code changed, run `docker compose up --build -d` before handing off to the human** — `test:ci` uses its own isolated stack (`docker-compose.ci.yml` on port 5534) and does NOT rebuild the dev containers the human tests against. Commit only after gates pass and human confirms.

**MCP testing:** When modifying MCP routes, tools, session handling, or auth, test via the `soupnet-local` MCP server in `.mcp.json` (points to `http://localhost:3101/mcp`). Call `list_my_recipe_books` or `check_recipe` through the local MCP to verify. For session changes, test recovery by running `docker compose restart backend` then calling any tool — it should work without `/mcp` reconnect. See `docs/testing-plan.md` Layer 4b for details.

## Keeping CLAUDE.md in sync

CLAUDE.md is the workflow every agent reads at the start of each session — if it drifts from reality, every future session inherits the drift. If you discover during a task that a documented command, step, or rule doesn't serve its stated goal (wrong flag, renamed script, unwritten exception, pattern that's been superseded), fix CLAUDE.md in the same commit as the work that surfaced the problem. Don't ask permission for corrections; agents are expected to patch documentation autonomously when the fix is a correction rather than a direction change.

Use the recipe check workflow (or ask the human) when the change is a genuine direction shift — a new rule, a changed preference, a tradeoff that reasonable people would disagree about. Corrections are autonomous; direction shifts need confirmation. When in doubt, lean toward recipe checking: the cost of a check is tiny, the cost of propagating a wrong-turned instruction is session-wide.

## Testing

See [docs/testing-plan.md](docs/testing-plan.md) for the full layered testing strategy (layers 1-6 + future; layer 6 is agent-run evals outside CI).

Quick reference:
- All tests: `npx vitest run` (`.env` loaded automatically; integration tests need running backend)
- Manual browser checks: see testing-plan.md Layer 4
- New routes need Layer 3 tests (status codes + response shapes)
- New pure functions need Layer 1 tests (100% branch coverage)

## Database Architecture

Single Postgres database on port **5633** (non-standard, intentional), single `claimnet` schema managed entirely by Drizzle.

**Core tables:**
- `users`, `organizations`, `groups`, `group_members`, `invitations` — identity, access, onboarding (the `groups` and `group_members` table names are the schema-level vocabulary; the user-facing concept is "recipe books" — schema-rename deferred)
- `traces` — taste/judgment claims (user story format, tsvector for search)
- `evidence`, `references` — Toulmin-structured supporting data
- `trace_evidence`, `trace_references`, `evidence_references` — N:N linking tables with `api_key_id` for coverage tracking
- `api_keys` — daily rotating and scoped keys for agent authentication; hashed at rest
- `uploads` — multimodal evidence files, api-key-scoped capability tokens (ADR-0019)
- `embedding_sources`, `embedding_chunk_strategies`, `embedding_chunks`, `embedding_vectors` — 4-table vector pipeline
- `vector_cache` — full-precision float32 content-hash-keyed cache (survives HNSW halfvec quantization)
- `reference_source_cache` — cached fetched content from reference URLs
- `audit_log` — append-only trail
- `system_settings` — signup cap, feature flags, admin-managed config
- `pgboss.*` — pg-boss queue schema (jobs, archive, schedules) in its own schema

Auth is swappable: `users.provider` + `users.external_id` fields support future OIDC federation.

## Backend Architecture (apps/backend)

Hono HTTP server. JWT for humans, API keys (Bearer) for agents — strictly separate credential populations (engineering-principles.md §7). Route modules mounted in `src/index.ts`:

- `/auth` — register, login, me, email verification, password reset, data export
- `/keys` — daily + scoped API key CRUD (JWT-auth)
- `/check` — recipe check page for agents. HTML by default, JSON with `format=json` or `Accept: application/json`. API-key auth. The primary agent surface.
- `/recipe-books` — recipe-book CRUD, members, invites (JWT-auth; some agent-writable fields via API key). The legacy `/groups/*` paths 308-redirect to `/recipe-books/*` for backwards compatibility.
- `/invitations` — accept/decline flow for recipe-book invites
- `/admin` — system-role-only: organizations, settings (signup cap, embeddings toggle), invite (cap bypass), users list/detail, stats, audit-log, queues, workers/embeddings
- `/docs` — agent-facing HTML guides: `recipe-check-guide`, `recipe-scenarios`, `mcp-setup`, `bootstrap`. Read-only; some pre-fill with `?key=` for copy-paste configs.
- `/traces` — list, map (k-means clustering + UMAP), traces-by-id
- `/uploads` — multipart POST for multimodal evidence (images, PDFs, audio). GET always 404 — URLs are opaque capability tokens tied to the issuing api_key_id.
- `/mcp` — remote MCP endpoint. Streamable HTTP transport, stateless mode per ADR-0021, Bearer-token auth with API key.
- `/health`, `/health/ready` — liveness + DB readiness. Point a load balancer / health-check probe at `/health/ready` if the deployment uses a rotating database password (the `SELECT 1` lets the probe detect auth drift after rotation and trigger task replacement).

Auto-setup: if `DEV_USERNAME` + `DEV_PASSWORD` are set and no users exist, a system user is created at startup with personal org + default recipe book. Blocked unless `ALLOW_AUTO_SETUP=true` when `NODE_ENV=production`.

## Recipe Checks (Soup.net)

A recipe check compares your recipe against the corpus and returns similar recipes. As a side effect, your recipe is logged — this is how the corpus grows and future checks get smarter. This is stigmergy: sensing the environment while leaving a trace, like ants following and reinforcing pheromone trails. Check freely and autonomously — the system is designed for frequent, low-friction use.

Recipes capture the human user's taste and judgment, not yours. Format: "As a [role] working on [goal], I [prefer/chose] so that [reason]." Every recipe needs context — the role and goal scope the judgment. Evidence should be concrete — the user's actual words, their artifacts, or external sources.

**When to check:**
1. **Before starting a task** — broad discovery: "As a [role] about to work on [topic], I want my AI agent to surface relevant context and suggest approaches before I make decisions."
2. **When facing a judgment call** — check the specific decision with evidence for your position.
3. **After completing meaningful work** — log what was chosen and why. This is how the corpus grows.
4. **Before committing** — sweep for what the session missed. The corpus often surfaces related prior decisions (ADRs describing the old behavior, security audit findings now stale, dead code from a refactor) that the session itself didn't flag. Commit is the checkpoint where gaps become expensive to find later.

The only anti-pattern is checking a recipe you don't genuinely believe — that degrades future checks for everyone. If you're just looking for something, use the web endpoint's `filter` (alias `f`) query param for keyword narrowing rather than fabricating a recipe; the MCP tool has no equivalent — just don't check one.

**Interface:** Use the `check_recipe` MCP tool, or the `/check` web endpoint with `format=json`. Call `get_briefing` before your first check — it returns the recipe format, your recipe books, and a clustered sample of recipes from the user's corpus.

## Key Engineering Principles

- **TDD** — Write tests first.
- **Tracer bullets** — Build complete thin slices end-to-end before adding breadth.
- **Service layer** — Business logic lives in `services/` and `packages/domain/`, not in route handlers or components.
- **Composable modules** — Rich internal functionality behind clean interfaces. The vector pipeline is the canonical example.
- **ACID writes, async side-effects** — Embeddings never block primary writes (pg-boss queues).
- **Agents are first-class** — The web `/check` page is the primary agent interface (zero setup — any web-browsing agent can use it). Remote MCP at `POST /mcp` is the lower-friction path for MCP-capable clients. Stdio MCP (`apps/mcp-server`) for Claude Desktop via `.mcpb`.
- **System doesn't make judgments** — Stance is whatever the LLM author asserted at write time. Vector-similarity surfaces (related evidence from other recipes, the recipe map) are presented neutrally — cosine over gemini-embedding-2-preview encodes topic, not stance (the negation problem; see ADR-0015). The LLM consumer interprets stance against current context.
- **`no-explicit-any` is enforced** — Use `unknown` instead. Underscore-prefixed vars (`_foo`) are allowed for unused.
- **`consistent-type-imports` is enforced** — Use `import type { ... }` for type-only imports.
- **Never make direct DB edits** — Always use Drizzle migrations. `docker compose down -v` to reset.

## Security

Follow the security workflow in `docs/workflows/security.md`. Key rules:

- **Before starting any new high-level task:** Check `docs/security/` for audit files that may have been created or updated by another concurrent AI agent. Read the latest one before proceeding.
- **Before changing auth, routes, API keys, or crypto code:** Read the latest security audit in `docs/security/` to understand current findings and what's already been fixed. Do not re-introduce resolved issues.
- **Audit and implementation are separate roles.** The agent scanning for vulnerabilities must not be the same agent applying fixes. See the workflow doc for the full audit cycle.
- **Every security fix needs a test.** Unit test for crypto/auth functions, integration test for authorization checks.
- **Check recipes on Soup.net** before making security-related decisions (validation approach, headers, auth structure). Security decisions are judgment calls — check them as described in the "Recipe Checks" section above.

## Environment Setup

Copy `.env.example` to `.env`. Key variables (see `.env.example` for the full list):

- **Postgres** — individual `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` vars. The split lets a hosted deployment inject `PGPASSWORD` from a rotating secret separately from the rest. `DATABASE_URL` is kept as a legacy fallback for one-off scripts — `apps/backend/src/db.ts` prefers it if set, otherwise reads the `PG*` set. Local default port is **5633** (non-standard, avoids collision with any system postgres).
- `JWT_SECRET` — 64-char hex for JWT signing (`openssl rand -hex 32`). Backend refuses to start with the default placeholder.
- `DEV_USERNAME` / `DEV_PASSWORD` — auto-creates a system user on first startup (dev only; gated by `ALLOW_AUTO_SETUP` in production-tagged envs).
- `TEST_USERNAME` / `TEST_PASSWORD` — auto-created alongside the dev user; integration tests reuse instead of spinning up throwaway accounts.
- `GEMINI_API_KEY` — required in production. Locally, set `EMBEDDINGS_PROVIDER=stub` for deterministic fake vectors (tests exercise the full cache path without burning quota). See testing-plan.md.
- `EMBEDDING_WORKER_ENABLED` (default `true`) — boots the pg-boss consumers in-process. Set `false` to run HTTP-only. Feature-flag escape hatch for the ADR-0020 unified embedding service.
- `WORKER_CONCURRENCY` (default `5`) — pg-boss batch size.
- `SMTP_*` — Mailpit locally (auto-wired by docker-compose); configure for any SMTP server in production (e.g., AWS SES, Postmark, SendGrid).
- `BACKEND_URL` / `FRONTEND_URL` / `MCP_PORT` — app URLs.

## Infrastructure (Docker Compose)

- **postgres** (pgvector/pgvector:pg17, port 5633)
- **backend** (Hono + in-process pg-boss consumers, port 3101, Drizzle migrations at startup)
- **mailpit** (local SMTP capture, web UI on 8625, SMTP on 1125)

The application is deployment-agnostic — it only needs Postgres 17 with the `pgvector` extension and the env vars in `.env.example`. Self-hosters can run it on any container platform (Docker, Kubernetes, ECS, Fly, Hetzner, etc.).
