# ADR-0018: BFF API vs Public API separation

**Date:** 2026-03-22
**Status:** Accepted (amended 2026-04-17)

---

## Amendment — 2026-04-17 (auth mechanism reality check)

The original text below specifies **cookie session (`payload-token`)** for the BFF surface. That was written before Payload CMS was dropped (see ADR-0001 supersession, 2026-03-24). The current, hardened boundary is:

| Surface | Who uses it | Credential | Lifetime | Where it lives |
|---|---|---|---|---|
| **BFF** (human SPA) | Human end users via the React SPA | **JWT** | 7 days | `localStorage` in the browser, sent as `Authorization: Bearer <jwt>` |
| **Public API / MCP** (agents) | AI agents and external integrations | **API key** (daily or scoped) | ≤24h (daily) or bounded (scoped) | Held by the agent runtime, sent as `Authorization: Bearer <api-key>` or `?key=` on URL-only agents |

**AI agents never hold a JWT.** This is a deliberate, load-bearing security boundary — not an implementation detail. The two credential populations are disjoint and non-interchangeable:

- The JWT is the authenticated *human session*. If an agent held one, compromise of the agent would compromise the human account (not just a group-scoped, revocable, short-lived key).
- API keys are scoped to groups, short-lived, append-only by design, and individually revocable without affecting the human's session. That is the blast-radius contract we depend on.
- The `/mcp`, `/search`, `/check`, and `/api/v1/` surfaces accept **only** API keys. The `/auth/*` + JWT-protected BFF routes accept **only** JWTs. Neither surface falls back to the other. A JWT presented to the MCP endpoint is rejected, and an API key presented to a JWT-protected route is rejected.
- The frontend's `authFetch` helper attaches the JWT to BFF calls only. Agent tooling has its own client-SDK path that attaches the API key. They do not share a credential path.

The "Bearer" in the table above is only a shared header *format* (`Authorization: Bearer <token>`), not a shared credential — both sides use the same HTTP idiom, but the tokens themselves are separate populations with separate signing/hashing, separate storage, separate lifetimes, and separate revocation stories.

Rationale for the deviation from the original text:
- Dropping Payload removed the `payload-token` cookie primitive, so the BFF moved to JWT-Bearer instead of cookie-session. CSRF is not a concern because the BFF uses `Authorization` headers, not cookies.
- CSP with per-request nonce (`apps/backend/src/index.ts:47`) is the compensating control for the XSS-via-localStorage risk on the JWT side.

Physical split status: the BFF surface has not yet been broken out under `/api/bff/`. Human-facing routes live under `/auth/*` and the JWT-gated routers today. The core decision of this ADR — **two Zod registries, two Orval clients, hard stability guarantees only for the public surface** — is unchanged.

The scaling triggers that would cause us to revisit this (refresh tokens, revocation, RS256/JWKS) are tracked separately. None apply at single-process scale.

---

## Context

ClaimNet has two distinct client populations with different needs:

1. **AI agents and external integrations** — they need a clean, stable, bearer-auth REST API and MCP tools. They care about claims, validations, knowledge graph, search, and groups. They do not care about session management, dashboard UI, or hydrated list views.

2. **ClaimNet website users** — the human-facing React SPA needs richer responses (e.g., "have I validated this?", member counts, cursor pagination), cookie-based auth, and some UI-specific aggregation endpoints that agents have no use for.

Mixing these two concerns into a single API surface creates problems:
- Auth model ambiguity (cookie vs Bearer)
- Response shapes bloat (UI-specific data leaks into agent contracts)
- Breaking changes — a UI convenience field becomes a public API contract
- Documentation noise (agents see BFF-only endpoints in the OpenAPI spec)

## Decision

Maintain **two separate API surfaces** served from the same Payload backend process:

### Public API — `/api/v1/`

For agents and external integrations.

- **Auth:** Bearer token (API key). No cookie dependency.
- **Zod source:** `packages/contracts/src/openapi-registry.ts`
- **Generated spec:** `packages/api-client/openapi.json` (committed snapshot; regenerate with `npm run generate:openapi`)
- **Orval-generated client:** `packages/api-client/src/generated/claimnet.ts`
- **MCP mirror:** Every public API capability has a corresponding MCP tool.
- **Stability guarantee:** Breaking changes require a version bump to `/api/v2/`.

### BFF API — `/api/bff/`

For the ClaimNet website frontend only. Not documented publicly.

- **Auth:** Cookie session (`payload-token`). Agents must not use this surface.
- **Zod source:** `packages/contracts/src/bff-registry.ts` (to be created — see backlog)
- **Orval-generated client:** `packages/api-client/src/generated/claimnet-bff.ts` (to be created)
- **Characteristics:**
  - Richer hydration (e.g., `claim.isValidatedByMe`, `group.memberCount`)
  - Cursor pagination for infinite-scroll list views
  - Dashboard aggregation endpoints
  - Org/user management endpoints not needed by agents
- **Stability:** Can change freely without regard to agent compatibility; frontend is co-deployed.

### What Payload-generated endpoints do

Payload auto-generates CRUD REST at `/api/<collection>`. These are not part of either the public API or BFF — they are internal and used only by Payload's admin panel. Never expose Payload-generated routes as the public API; always write custom endpoints under `/api/v1/` or `/api/bff/` instead.

## Consequences

- **Immediate:** Rename existing endpoint paths to `/api/v1/` prefix where not already done.
- **Near-term:** Create `packages/contracts/src/bff-registry.ts` and corresponding Orval config when BFF endpoints are being built.
- **Ongoing:** When adding a new capability, decide first: public API (add to `openapi-registry.ts` + MCP tool) or BFF-only (add to `bff-registry.ts` only)?
- **Not shared:** Some schemas will be shared between public API and BFF contracts. Import from the public API contract files; extend in BFF-specific files if richer shapes are needed.

## How to add a new endpoint

**Public API endpoint (agent-facing):**
1. Add/update Zod schema in `packages/contracts/src/<domain>.ts`
2. Register schema + path in `packages/contracts/src/openapi-registry.ts`
3. `npm run generate:openapi` → regenerates `packages/api-client/openapi.json`
4. `npm run generate:api-client` → Orval regenerates React Query hooks
5. Add corresponding MCP tool stub in `apps/mcp-server/src/tools/`
6. Register tool in `apps/mcp-server/src/index.ts`
7. Update `docs/architecture/api.md` MCP tools table

**BFF-only endpoint (frontend-only):**
1. Add/update Zod schema in `packages/contracts/src/bff-registry.ts`
2. `npm run generate:bff-client` → Orval regenerates BFF hooks
3. No MCP tool needed
