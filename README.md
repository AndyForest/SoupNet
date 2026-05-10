# Soup.net

A stigmergic search engine for taste and judgment. AI agents check recipes — structured traces of preferences and decisions with evidence — and the system finds similar recipes from previous sessions. Every check makes future searches smarter.

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — system topology, three agent surfaces, data model at a glance
- [`docs/design-thinking.md`](docs/design-thinking.md) — product vision, user archetypes, recipe-check scenarios
- [`docs/planning/pivot-search-as-logging.md`](docs/planning/pivot-search-as-logging.md) — the search-as-logging pivot (decision history)
- [`docs/engineering-principles.md`](docs/engineering-principles.md) — 13 principles that govern every design choice
- [`docs/backlog.md`](docs/backlog.md) — current work queue; completed items in `docs/backlog-completed.md`
- [`docs/adr/`](docs/adr/) — architecture decisions with dates and status lines
- [`docs/testing-plan.md`](docs/testing-plan.md), [`docs/workflows/security.md`](docs/workflows/security.md) — how tests and audits work

Each document's top section states its purpose and how it differs from nearby docs. If you add a new doc, do the same — and link into this section.

---

## Quick start

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET (openssl rand -hex 32), DEV_USERNAME, DEV_PASSWORD.
# GEMINI_API_KEY is optional locally — leave EMBEDDINGS_PROVIDER=stub for tests.

docker compose up --build -d    # postgres + backend (with in-process embedding worker) + mailpit
npm run dev:frontend            # Vite SPA on :5273 (separate terminal)
```

Open `http://localhost:5273` — log in, generate a recipe check link, and start checking recipes.

---

Mailpit Web UI for local dev: http://localhost:8625 

## Architecture

```
apps/backend       Hono HTTP server (port 3101) — auth, REST API, /check recipe page,
                   remote MCP endpoint (/mcp), plus in-process pg-boss embedding consumers
                   (src/embedding-worker/). See ADR-0020, ADR-0021.
apps/frontend      Vite React SPA (port 5273) — dashboard, recipe map, admin pages
apps/mcp-server    Stdio MCP server (bundled as soupnet.mcpb for Claude Desktop)

packages/db        Drizzle schema + migrations — single claimnet schema, single source of truth
packages/domain    Business logic, ranking rules, shared agent-facing copy (no I/O)
packages/contracts Zod schemas + OpenAPI registry (mostly pre-pivot shapes; new routes inline-validate)
packages/client-sdk REST API client wrapper
packages/api-client Auto-generated React Query hooks (regenerated from contracts)
packages/config    Shared tsconfig, ESLint config
```

---

## MCP setup

The primary path is **remote MCP over Streamable HTTP** (stateless, ADR-0021). Point your agent at the backend's `/mcp` endpoint with an API key as a Bearer token — works the same whether you run locally (`http://localhost:3101/mcp`) or against the deployed instance (`https://mcp.soup.net/mcp`).

**1. Generate an API key** — Log in to the SPA, open **API keys**, create a daily or scoped key, copy the raw value.

**2. Paste the config block that matches your client.** Each client's schema differs; don't mix them.

**Claude Code** — per-project `.mcp.json` at the repo root (or `~/.claude/.mcp.json` for global). One-liner:
```
claude mcp add --transport http soupnet http://localhost:3101/mcp --header "Authorization: Bearer YOUR_KEY"
```

Or in `.mcp.json`:
```jsonc
{
  "mcpServers": {
    "soupnet": {
      "type": "http",
      "url": "http://localhost:3101/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

**VS Code** — per-project `.vscode/mcp.json`. Top-level key is `servers` (not `mcpServers`); `inputs` is required:
```jsonc
{
  "servers": {
    "soupnet": {
      "type": "http",
      "url": "http://localhost:3101/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  },
  "inputs": []
}
```

**Google Antigravity** — user-global `~/.gemini/antigravity/mcp_config.json`. Uses `serverUrl` (not `url`):
```jsonc
{
  "mcpServers": {
    "soupnet": {
      "serverUrl": "http://localhost:3101/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

**3. Restart the client** (or run `/mcp` in Claude Code) to pick up the new server. Available tools: `check_recipe`, `get_recipe_guide`, `list_my_recipe_books`, `update_recipe_book_description`.

Clients that can't speak HTTP MCP natively (Claude Desktop, older tooling) can bridge via `mcp-remote` or run the stdio server in `apps/mcp-server/` — both covered in the live guide at `/docs/mcp-setup` (serves with your key pre-filled when reached from the dashboard).

---

## Development

**Prerequisites:** Node 24 LTS, npm ≥ 10, Docker

**Start everything via Docker:**

```bash
docker compose up --build -d    # postgres + backend + worker
npm run dev:frontend             # Vite dev server (separate terminal)
```

**Or run backend locally with hot reload:**

```bash
docker compose up -d postgres    # just the database
npm run build:packages           # build internal packages
source .env && npm run dev:backend   # Hono with tsx watch on :3101
npm run dev:frontend             # Vite on :5273
```

**Database migrations:**

```bash
cd packages/db
npx drizzle-kit generate         # generate migration from schema changes
# migrations auto-apply at backend startup
```

---

## Testing

```bash
npx vitest run                    # all tests (.env auto-loaded by vitest config)
npx vitest watch                  # watch mode
npm run test:ci                   # clean reproduction of CI (fresh DB on :5534, no Gemini)
```

Integration tests hit the running Docker backend, so keep `docker compose up -d` alive.

**Integration tests create test data** in the live database (users with `@test.local` emails, in their own recipe books). Test traces are recipe-book-scoped and don't appear in your personal search results. To clean up accumulated test data:

```bash
npx tsx scripts/cleanup-test-data.ts           # clean up
npx tsx scripts/cleanup-test-data.ts --status  # just show counts
```

See [`docs/testing-plan.md`](docs/testing-plan.md) for coverage expectations and test categories.

---

## Public vs hosted

This is the open-source codebase. The hosted version's deployment specifics — Terraform, operational runbooks, AWS topology — live in a separate private companion repo because they're specific to one operator's infrastructure choices and not generally useful.

**Test for what belongs in this repo:** would a self-hoster running this stack on their own infrastructure need this content? If yes, it's here. If it's specific to a particular hosted deployment, it isn't.

The application is deployment-agnostic — only Postgres 17 with `pgvector` and the env vars in `.env.example`. Container-platform-agnostic too: Docker Compose locally, anything else (Kubernetes, ECS, Fly, Hetzner) in production.

---

## Key rules

- No business logic in route handlers or React components — use services
- Never make direct DB edits — always use Drizzle migrations
- `import type { ... }` for type-only imports; `unknown` not `any`
- See [`docs/engineering-principles.md`](docs/engineering-principles.md)
