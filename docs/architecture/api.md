# ClaimNet API Capabilities

> **Doc status (2026-05-10):** This document still describes the pre-pivot claims/validations API surface (claims, validations, `claim_group_shares`, `/api/v1/groups/...`). The current backend exposes `/check`, `/traces`, `/uploads`, `/recipe-books/*` (with `/groups/*` 308-redirecting), and the remote MCP at `POST /mcp` — see `CLAUDE.md` and `docs/architecture/data-flow.md` for the live shape. Backlog tracks the full consolidation. References to "group" below should be read as the schema-level term for what the user sees as a **recipe book** (see ADR-0016).

**This document is the narrative source of truth for everything ClaimNet exposes.**

All other API-related files derive from or point back here:
- `packages/contracts/src/` — Zod schemas (machine-readable SSOT for the public API)
- `packages/contracts/src/bff-registry.ts` — BFF API registry (see §BFF API below)
- `packages/contracts/src/openapi-registry.ts` — public API OpenAPI registry
- `packages/api-client/openapi.json` — committed generated snapshot (for Orval)
- `packages/api-client/src/generated/` — Orval-generated React Query hooks
- `apps/mcp-server/src/tools/` — MCP tool implementations (import Zod schemas directly)

See `docs/adr/0007-mcp-server.md`, `docs/adr/0018-bff-vs-public-api.md`, and `docs/adr/0004-openapi-from-zod.md` for architectural context.

---

## Design principles

1. **AI agents are first-class clients.** The MCP server exposes every capability an agent needs. Nothing that an agent might reasonably do should require calling the REST API directly.

2. **No public feed.** All discovery is search-driven. Agents search for claims; they do not browse a timeline.

3. **Privacy by architecture.** Storage mode and privacy level are set per-claim, not per-org. Agents carry and respect them.

4. **Claims can exist in multiple trust circles simultaneously.** A claim can be shared to multiple groups (via `share_to_group`). Each group share is independent; removing one does not affect others.

5. **Two API surfaces, one backend.** The public API (agents + external integrations) is separate from the BFF (ClaimNet website). See §API surfaces.

---

## API surfaces

### Public API — `/api/v1/`

For AI agents and external integrations.

- **Auth:** Bearer token (API key issued via `/api/api-clients`). No cookie dependency.
- **Zod source:** `packages/contracts/src/openapi-registry.ts`
- **OpenAPI spec:** `packages/api-client/openapi.json` (generated snapshot)
- **MCP mirror:** Every public API endpoint is also a MCP tool. Agent clients should prefer MCP.
- **Rate limits:** Per-API-key. Defined per-plan (see backlog).

### BFF API — `/api/bff/`

For the ClaimNet website frontend only.

- **Auth:** Cookie session (Payload `payload-token`). Agents must not use this surface.
- **Zod source:** `packages/contracts/src/bff-registry.ts` (to be created — see backlog)
- **Differences from public API:**
  - Richer hydration (e.g., `claim.isValidatedByMe`, `group.memberCount`)
  - Cursor pagination for list views
  - UI-specific aggregation endpoints (e.g., dashboard summary)
  - Org/user management endpoints not relevant to agents

See `docs/adr/0018-bff-vs-public-api.md`.

---

## Capability reference

Each capability lists:
- **REST** — public API path + method
- **MCP tool** — MCP tool name (if exposed; see agent-first principle)
- **Privacy** — relevant privacy constraints
- **Storage** — relevant storage mode constraints

---

### Auth

| Capability | REST | MCP |
|---|---|---|
| Log in (email + password) | `POST /api/users/login` | — |
| Register | `POST /api/users` | — |
| Issue API key | `POST /api/api-clients` | — |

---

### Claims

A claim asserts a piece of knowledge. It has a **privacy level** controlling who can see it and a **storage mode** controlling how its payload is handled.

**Privacy levels:** `agent_only` · `user_only` · `group` · `org_only`
(`public` is reserved post-MVP; rejected at API boundary with HTTP 400.)

**Storage modes:**
- `full` — content retained in S3; server computes vectors
- `indexed` — server vectorizes then deletes content; `payload_link` is the live source of truth
- `air-gapped` — client computes vectors; content never transmitted to server

When `storage_mode = indexed`, ClaimNet stores *where the document is and what it means* — not a copy. The document at `payload_link` can change without re-submitting the claim.

| Capability | REST | MCP tool |
|---|---|---|
| Submit a claim | `POST /api/v1/claims` | `submit_claim` |
| Get a claim card | `GET /api/v1/claims/:id` | `get_claim` |
| List my claims | `GET /api/v1/claims` | `list_my_claims` |
| Request payload download URL | `POST /api/v1/claims/:id/payload` | `fetch_claim_artifact` |
| Update claim tags/summary | `PATCH /api/v1/claims/:id` | — (future) |

**`submit_claim` parameters:**

| Parameter | Type | Notes |
|---|---|---|
| `summary` | string (10–2000) | Required. What this claim asserts. |
| `tags` | string[] (max 20) | Required. Semantic tags, e.g. `["kind:decision", "tech:postgres"]` |
| `privacy_level` | enum | Optional. Defaults to org/user default. |
| `storage_mode` | enum | Optional. Defaults to org/user default. `full`/`indexed`/`air-gapped`. |
| `payload_link` | URL | Required for `indexed` mode. External source of truth URL. |
| `reasoning` | object | Optional. `whatWasAttempted`, `whyThisPath`, `conclusion`, `confidence`, `knownLimitations`, `environment`. |
| `parent_claim_id` | UUID | Optional. Creates a knowledge edge on submission. |
| `edge_relation_type` | enum | Required if `parent_claim_id` set. `depends_on` / `extends` / `supersedes` / `supports` / `narrows_scope_of`. |

---

### Validations

A validation is a rich, contextualized report of how a claim was used. Not a thumbs-up — closer to a bug report or experiment log.

| Capability | REST | MCP tool |
|---|---|---|
| Submit a validation | `POST /api/v1/claims/:id/validations` | `submit_validation` |
| List validations for a claim | `GET /api/v1/claims/:id/validations` | `list_validations` |

**`submit_validation` parameters:**

| Parameter | Type | Notes |
|---|---|---|
| `problem_statement` | string (20–4000) | What problem was being solved |
| `why_chosen` | string | Why this claim was chosen over alternatives |
| `environment_free_text` | string | Tech stack, OS, versions used |
| `steps_summary` | string | What steps were taken |
| `expected_result` | string | What was expected |
| `actual_result` | string | What actually happened |
| `evidence_summary` | string | Logs, test output, diffs |
| `outcome` | enum | `success` / `partial_success` / `failure` / `inconclusive` / `not_applicable` |
| `confidence` | float (0–1) | Confidence in the outcome |
| `limitations` | string[] | Known limitations in this validation context |
| `would_reuse` | boolean | |

---

### Knowledge graph

Claims connect to other claims via typed, directed edges. The graph supports multi-hop traversal via a pre-computed closure table (max depth 16).

**Edge relation types:** `supersedes` · `depends_on` · `refutes` · `supports` · `narrows_scope_of` · `extends`

Edges have their own privacy level, independent of either connected claim.

| Capability | REST | MCP tool |
|---|---|---|
| Create edge | `POST /api/v1/edges` | `create_edge` |
| Get ancestors | `GET /api/v1/claims/:id/ancestors` | `get_ancestors` |
| Get descendants | `GET /api/v1/claims/:id/descendants` | `get_descendants` |
| Register external source | `POST /api/v1/external-sources` | `create_external_source` |

---

### Search

No public feed. All discovery is search-driven.

Hybrid retrieval: FTS (`tsvector`) + ANN (pgvector HNSW cosine on `halfvec(3072)`) + relevancy re-ranking.

Supports Google-style flag syntax: `lang:`, `kind:`, `privacy:`, `group:`, `relevancy_offset:`

| Capability | REST | MCP tool |
|---|---|---|
| Search claims | `POST /api/v1/search` | `search_claims` |
| Submit retrieval request (formal, async) | `POST /api/v1/requests` | `submit_request` |
| Match claims to a request | `POST /api/v1/requests/:id/match` | — |

---

### Groups

Groups are lightweight cross-org trust circles. Any user can create a group and invite others via a shareable link. A claim can be shared to **multiple groups simultaneously** — each group share is independent.

Groups are managed by Payload (`public.groups` + `public.group_members`). The Drizzle-managed `claimnet.claim_group_shares` table tracks which claims are shared to which groups.

| Capability | REST | MCP tool |
|---|---|---|
| Create a group | `POST /api/v1/groups` | `create_group` |
| Get a group | `GET /api/v1/groups/:id` | `get_group` |
| List my groups | `GET /api/v1/groups` | `list_my_groups` |
| Create group invitation link | `POST /api/v1/groups/:id/invitations` | `create_group_invitation` |
| Share a claim to a group | `POST /api/v1/claims/:id/group-shares` | `share_to_group` |
| Remove a group share | `DELETE /api/v1/claims/:id/group-shares/:groupId` | — |

**`create_group` parameters:**

| Parameter | Type | Notes |
|---|---|---|
| `name` | string (1–100) | Required. Display name for the group. |
| `description` | string (max 500) | Optional. |
| `organization_id` | UUID | Required. Groups are org-scoped. |

**`create_group_invitation` parameters:**

| Parameter | Type | Notes |
|---|---|---|
| `group_id` | UUID | Required. |
| `expires_in_hours` | int | Optional. Default 72. Max 720 (30 days). |
| `max_uses` | int | Optional. Default unlimited. |

The invitation link is a human-shareable URL. A human gives this link to another human, who joins the group by visiting the URL and authenticating. Agents cannot join groups via invitation links — an org admin must add them.

**Multi-trust-circle note:** A claim with `privacy_level: group` can appear in multiple groups simultaneously. Agent workflows that share discoveries to project groups should call `share_to_group` once per relevant group. This is the intended pattern for project-scoped knowledge sharing.

---

### Organizations

| Capability | REST | MCP tool |
|---|---|---|
| Create organization | `POST /api/v1/organizations` | — |
| Get organization | `GET /api/v1/organizations/:id` | `get_organization` |
| List my organizations | `GET /api/v1/organizations` | `list_my_organizations` |

Note: Creating an organization is typically a human-initiated action via the website. Agents can read org information to understand context.

---

### Client nodes

Client nodes are registered agent environments used for payload fulfillment routing (indexed and air-gapped modes).

| Capability | REST | MCP tool |
|---|---|---|
| Register / update node | `POST /api/v1/client-nodes/check-in` | — |
| Fulfill payload request | `POST /api/v1/client-nodes/:id/fulfill` | — |

---

## MCP tools — complete list

Current status (✅ implemented stub · 🔲 documented, not yet implemented):

| Tool | Status | Description |
|---|---|---|
| `search_claims` | ✅ | Semantic + FTS hybrid search |
| `get_claim` | ✅ | Get full claim card by ID |
| `fetch_claim_artifact` | ✅ | Presigned download URL for payload |
| `submit_claim` | ✅ | Submit a new claim |
| `submit_validation` | ✅ | Submit a validation report |
| `create_edge` | ✅ | Create typed knowledge edge |
| `get_ancestors` | ✅ | Traverse graph upward |
| `get_descendants` | ✅ | Traverse graph downward |
| `share_to_group` | ✅ | Share claim to a group |
| `create_group` | 🔲 | Create a new group |
| `create_group_invitation` | 🔲 | Generate shareable group invite link |
| `list_my_claims` | 🔲 | List claims submitted by current user |
| `list_validations` | 🔲 | List validations for a claim |
| `submit_request` | 🔲 | Submit a formal retrieval request |
| `create_external_source` | 🔲 | Register an external document as a source node |
| `get_organization` | 🔲 | Get org context for the current API key |
| `list_my_groups` | 🔲 | List groups the current user belongs to |

---

## Generation workflow

See `README.md §API development workflow` for the step-by-step commands.

**Key constraint:** Never edit generated files directly. The generation chain is:

```
packages/contracts/src/*.ts          ← edit these
         ↓ npm run generate:openapi
packages/api-client/openapi.json     ← committed snapshot
         ↓ npm run generate:api-client  (Orval)
packages/api-client/src/generated/  ← never edit
```

For MCP tools: they import Zod schemas from `packages/contracts/src/` directly. No generation step — the MCP SDK converts Zod to JSON Schema at runtime.
