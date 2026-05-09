# ADR-0021: Stateless MCP Streamable HTTP

**Date:** 2026-04-18
**Status:** Accepted
**Supersedes:** session-management portion of ADR-0007 (rest of ADR-0007 still applies)

---

## Context

The MCP Streamable HTTP transport (spec 2025-03-26 / 2025-11-25) defines a stateful session model: a client `initialize`s, receives an `Mcp-Session-Id` header, and includes that header on every subsequent request. The server validates the session ID on each call. When a session is invalid (server restart, idle expiry, never-existed), the spec is unambiguous: the server MUST respond with HTTP 404, and "when the client receives 404 for a request that carries an MCP-Session-Id, it MUST start a new session."

We implemented exactly that on 2026-04-04 ([commit `6fd2244`](../../packages/db/migrations/0011_blue_cardiac.sql), see also `075802b` and the [data-flow doc](../architecture/data-flow.md)). It tested fine against Claude Code, which auto-recovered.

Then we tried it with Google Antigravity. Antigravity didn't recover — it bubbled the 404 to the user. Investigation surfaced that **the spec-required client behavior is broken in nearly every major MCP client**:

- **Claude Code** ([anthropics/claude-code#27142](https://github.com/anthropics/claude-code/issues/27142)): "caches the Mcp-Session-Id at connection time and never refreshes it. The client never attempts to re-initialize." (Closed, marked stale by the maintainer.)
- **VSCode** ([microsoft/vscode#253854](https://github.com/microsoft/vscode/issues/253854)): "just logs the error and gives up."
- **Cursor** ([forum #134781](https://forum.cursor.com/t/mcp-client-wrong-handling-of-http-not-found-in-session-management-stateful-mcp-server/134781)): same complaint.
- **LibreChat** ([#11868](https://github.com/danny-avila/LibreChat/issues/11868)): SSE error handler ignores all 404s.
- **Claude Code regression** ([microsoft/playwright-mcp#1307](https://github.com/microsoft/playwright-mcp/issues/1307)): a previously working version (2.0.31) regressed in 2.0.73; downgrade fixes.
- **Antigravity**: undocumented client; in our testing it doesn't re-initialize on 404.

Server-side workarounds — silently recreating sessions when an unknown ID arrives — have a hard SDK constraint: the MCP TypeScript SDK's transport requires `_initialized = true` (set only by an actual `initialize` request) before accepting any tool calls. A previous attempt at silent recreation (`075802b`) failed because of exactly this; it was reverted within an hour. A "do it right" version would require buffering the request, faking a synthetic initialize against a fresh transport, then forwarding — feasible but a real spec violation, and the broader community discussion confirms this is a known hack rather than a clean pattern.

In parallel, we discovered that the only stateful feature we shipped — `elicit_divergent_check`, which uses `elicitation/create` for a server→client round trip over the SSE channel — was also unusable in practice. Antigravity never surfaced the picker. Claude Code did surface something, but rendered it as an unparsed wall of text and the "accept" button didn't work. No client uses it well.

The community has converged on two patterns for this situation:

1. **Stateless mode** (`sessionIdGenerator: undefined`). Each request is independent. No sessions to be stale about. Reference: [`mhart/mcp-hono-stateless`](https://github.com/mhart/mcp-hono-stateless). Trade-off: no SSE channel for server→client requests, so elicitation and notifications-from-server don't work.
2. **Sticky load balancing + Redis state** for horizontal scaling. Reference: [`modelcontextprotocol/example-remote-server`](https://github.com/modelcontextprotocol/example-remote-server). Real engineering work; the SDK's transport object is not JSON-serializable (per [typescript-sdk#330](https://github.com/modelcontextprotocol/typescript-sdk/issues/330)), so Redis can hold *state* but not the *transport*.

---

## Decision

**Run the HTTP MCP server in stateless mode. Drop `elicit_divergent_check` from both stdio and HTTP MCP. Keep the divergent-check pattern alive as natural-language conversation in the agent briefings.**

Concretely:

- `apps/backend/src/routes/mcp.ts` instantiates `WebStandardStreamableHTTPServerTransport({})` (empty options → SDK treats as stateless). Every incoming request creates a fresh transport+server pair, processes the request, and is discarded. No `sessions` Map. No cleanup interval. No stale-session 404 path.
- The CORS allowlist still permits the `mcp-session-id` header so clients that always send it (including those caching old session IDs from before the migration) don't trigger CORS preflight failures. The header is simply ignored — the SDK's `validateSession()` short-circuits when `sessionIdGenerator` is undefined.
- `elicit_divergent_check` removed from `apps/mcp-server/src/index.ts` (stdio) and `apps/backend/src/routes/mcp.ts` (HTTP). The briefing's "Divergent recipe checks" section now describes the pattern as a normal-conversation move: present 2-4 framings to the user in your reply, then `check_recipe` only the chosen one.

---

## Alternatives considered

**A. Keep stateful sessions + return 404 on stale (current behavior).** Spec-compliant, works for clients with proper auto-recovery. Rejected because the broken-client epidemic is industry-wide and durable — Anthropic marked their own client's bug stale with no plan to fix.

**B. Server-side silent session recreation with synthetic-initialize replay.** Buffer incoming requests, drive a fake `initialize` through a fresh transport, then forward. Endorsed by community as a pragmatic workaround. Rejected because it's a real spec violation, requires careful handling of SDK lifecycle internals, and the maintenance burden compounds when the SDK changes its initialize semantics. The narrower, spec-compliant variant (only fall through on actual `initialize` requests) was implemented earlier the same day but doesn't help broken clients in practice — they don't send `initialize` on retry.

**C. DB-persisted session metadata (sessionId, apiKeyId, init params) with replay-init on stale.** Survives restarts and is the right shape for horizontal scaling. Rejected for now because (i) it's spec-compliant but invents a pattern the SDK ecosystem hasn't standardized; the canonical Redis-backed reference impl ([example-remote-server](https://github.com/modelcontextprotocol/example-remote-server)) has reported gaps ([python-sdk#880](https://github.com/modelcontextprotocol/python-sdk/issues/880)); (ii) we're still bootstrapping and not horizontally scaling; (iii) hand-rolled persistence becomes maintenance debt the day the SDK adds native helpers.

**D. Sticky LB + in-memory sessions.** Standard horizontal-scaling pattern, but doesn't survive restarts and we run a single backend container today. Defer until horizontal scaling is needed.

**E. Hybrid: stateless for sync tools, sessioned for elicitation.** Doesn't fit the SDK cleanly; routing logic is brittle. Moot anyway since we're dropping the only feature that needed sessions.

---

## Consequences

### Positive

- **No more stale-session 404s.** Every MCP request succeeds or fails on its own merits. The entire class of "client cached an old session ID" bugs is gone.
- **Survives server restarts trivially.** Nothing to restore. Antigravity, Claude Code, Cursor, etc. all just work after a deploy.
- **No `Mcp-Session-Id` header coordination.** Clients that send it are tolerated; clients that don't are tolerated. Either way, no validation.
- **Smaller code surface.** Deleted ~280 lines from `routes/mcp.ts` (sessions Map, cleanup interval, stale-session logic, the entire `elicit_divergent_check` tool, helper functions). Less to maintain.
- **Spec-compliant.** Stateless mode is explicitly supported by the MCP spec and SDK.
- **Parity with the ecosystem direction.** Reference implementations (`mcp-hono-stateless`) point this way for servers that don't need server→client push.

### Negative

- **Lost: elicitation (server→client requests).** `elicit_divergent_check` and any future tool that needs to ask the user a structured question mid-call is now impossible until we either re-enable sessions or the spec adds a stateless elicitation channel. Mitigation: divergent checks happen as natural-language conversation in the briefing; the corpus pattern is preserved without the structural guardrail.
- **Lost: SSE notifications/streaming progress.** Long-running tools can't push progress updates to the client. None of our current tools do this; if a future tool needs it, we revisit.
- **Per-request transport+server construction overhead.** The McpServer registers tools at construction time; we now do that on every request. Negligible at our scale (microseconds per call) but worth noting.
- **The spec-required client behavior never gets exercised.** If we ever go back to stateful mode (e.g. for elicitation), we re-inherit the broken-client problem.

### Neutral

- **CORS allowlist still includes `mcp-session-id`.** Harmless — clients that send it succeed; the SDK ignores it in stateless mode. Avoids breaking clients that always send the header.
- **The divergent-check pattern survives in the briefings.** Agents are still encouraged to present 2-4 options to the user before checking. The structural guardrail (the tool wouldn't let an agent submit candidates before the user picked) is gone, replaced by the briefing telling the agent not to.

---

## Migration / rollback

Migration is implicit: the next request after deploy creates a fresh transport regardless of any session ID the client sent. No coordination with clients required.

Rollback would mean reintroducing the `sessions` Map + cleanup + stale-session 404 path (and re-adding `elicit_divergent_check`). We'd hit the broken-client epidemic again, so a rollback only makes sense if we also implement Option C (DB-persisted sessions with replay-init). At that point the rollback IS the implementation of C.

---

## Related

- ADR-0007 (Remote MCP server for AI agent access) — superseded in part by this ADR. The session-management decisions there no longer apply; the rest (Bearer auth, embedding the MCP endpoint in the backend, AI-agents-as-first-class) still hold.
- Earlier session-recovery commits: `075802b` (silent recreate, broken), `6fd2244` (revert to spec-compliant 404). Both are now historical — the entire session-recovery code path has been removed.
- `apps/backend/src/routes/mcp.ts` for the implementation.
