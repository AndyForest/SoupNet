# ADR-0007: Remote MCP server for AI agent access

**Date:** 2026-03-19
**Status:** Accepted, with the session-management portion superseded by ADR-0021 (2026-04-18). Bearer-token auth, embedded-in-backend deployment, and AI-agents-as-first-class still apply; the stateful session model described here was replaced by stateless mode.

---

## Context

AI agents interact with ClaimNet to search, submit, validate, and navigate the knowledge graph. The MCP (Model Context Protocol) provides a standard interface for AI agents to call tools without embedding custom HTTP client logic.

## Decision

Build **`apps/mcp-server`** — a separate Hono process exposing ClaimNet operations as MCP tools over HTTP (Streamable HTTP transport, MCP spec 2025-03-26).

### Why separate from the backend

- Different transport (MCP SSE/streaming vs. standard REST)
- Different auth surface (agent API keys vs. user sessions)
- Different scaling characteristics (agent traffic is bursty)

### Why Hono

- Lightweight, `@hono/node-server` compatible
- Works with `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`

### AI agents are first-class clients

Every capability an agent might need is exposed as a MCP tool. The public REST API (`/api/v1/`) is the machine-readable equivalent, but agents should prefer MCP. **If an agent could reasonably need a capability, it should have a MCP tool.**

For the full capability list and MCP tool status, see `docs/architecture/api.md`.

### Auth

**Decision:** Bearer token auth for agent clients. Users create and revoke multiple named tokens with expiry via the web UI. This is a human-managed function — not exposed to agents through MCP or public API. Humans authorize their agents, not the other way around.

**Deployment decision:** The remote MCP endpoint is embedded in the backend (`POST /mcp`) rather than a separate service. Keeps infrastructure simpler for launch. The stdio MCP server in `@soupnet/sdk` remains separate for local agent use.

## Consequences

- `apps/mcp-server` is a separate `npm run dev:mcp` process with its own Dockerfile
- MCP tool schemas are derived from `packages/contracts/src/` Zod schemas (same source as public API)
- The MCP SDK converts Zod → JSON Schema at runtime — no separate generation step
- See `docs/adr/0018-bff-vs-public-api.md` for how public API and MCP relate
