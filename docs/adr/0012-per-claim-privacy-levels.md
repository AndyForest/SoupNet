# ADR-0012: Per-Claim Privacy Levels

**Status:** Accepted (revised 2026-03-22)
**Date:** 2026-03-21

---

## Context

The previous model controlled visibility at the organization level only (`organizations.visibility = public | private`). This is too coarse: an agent working on a shared org project may produce claims that should be visible only to the submitting user, or only to a specific group, without requiring a separate private org.

Privacy is a fixed setting, not a gradient. The privacy level of a claim is set at submission and is immutable. Access control requires discrete, auditable boundaries, not continuous scores.

---

## Decision

Add `privacy_level` to `claimnet.claims` as a non-nullable text column.

### MVP privacy levels

| Value | Description |
|---|---|
| `agent_only` | Visible only to the submitting `client_node` (by `node_id`). |
| `user_only` | Visible only to the submitting user (by `user_id`). |
| `group` | Visible to members of all groups this claim has been shared to (via `claim_group_shares`). |
| `org_only` | Visible to all members of the submitting organization. **Default.** |

### Future: `public` (not in MVP)

A `public` privacy level — visible to all users across all orgs — is defined in the data model schema for future use but is **not implemented in the MVP**. The API rejects any submission with `privacy_level = 'public'` with HTTP 400.

Rationale for deferring public: ClaimNet stores judgment and taste, not generic facts. Public claims are not clearly more valuable than private ones for the initial use cases (personal taste, group coordination, org knowledge). Keeping everything private for MVP reduces user anxiety, simplifies moderation, and keeps the product focused. Public claims will be revisited when private sharing is proven valuable.

One compelling future public use case: organizations publishing their taste and judgment expectations for external collaborators ("we work this way"). Not needed for MVP.

---

## ACL enforcement

Every read query (REST, MCP, graph traversal) must apply a privacy level filter derived from the authenticated principal:

```sql
-- For an authenticated user in org $orgId, on client_node $nodeId:
WHERE (
  (privacy_level = 'org_only' AND organization_id = $orgId)
  OR (privacy_level = 'group' AND id IN (
    SELECT claim_id FROM claimnet.claim_group_shares cgs
    JOIN public.group_members gm ON gm.parent_id = cgs.group_id
    WHERE gm.user_id = $userId
  ))
  OR (privacy_level = 'user_only' AND author_id = $userId)
  OR (privacy_level = 'agent_only' AND author_node_id = $nodeId)
)
```

This filter is applied in a shared query helper in `apps/backend/src/lib/acl.ts`. Failure to apply it is a security defect. The helper is tested exhaustively.

---

## Interaction with org visibility

Org visibility (`organizations.visibility`) acts as a **ceiling** on claim visibility:
- An `org_only` claim in a `private` org: visible to org members only (correct)
- A `group` claim in a `private` org: visible to group members only — group members outside the org can see it if they're in the group, unless the org is private (org ceiling wins)

The effective visibility is `min(org_visibility, claim_privacy_level)`.

---

## Immutability

`privacy_level` is set at submission and cannot be updated. To widen the visibility of a claim (e.g., promoting a `user_only` claim to `group`), create a new claim with the wider privacy level and a knowledge edge "derived from" the original. This prevents retroactive privacy violations and creates an audit trail.

**Exception:** the UI may provide a "share to group" flow that creates the derived claim and edge automatically, presenting it to the user as a single action.

---

## Relevancy and privacy

The relevancy gradient (ADR-0013) interacts with privacy:
- A claim with `privacy_level = org_only` and high decay asserts broad relevance within its org
- Agents searching within their own privacy envelope can apply a `privacy:user` flag to restrict search to their own claims

---

## Why not a gradient?

A continuous privacy value (e.g., `privacy_score: 0.0–1.0`) was considered and rejected because:
- ACL enforcement requires discrete, auditable rules
- A privacy score would require a threshold decision at query time, creating ambiguity
- Gradients are appropriate for relevancy (a continuous semantic property); not for access control (a discrete policy property)

---

## Consequences

- New column `privacy_level` on `claimnet.claims` — Drizzle migration required
- `public` privacy level exists in the schema enum but is blocked at the API boundary (HTTP 400) for MVP
- All read queries must apply the ACL filter — shared helper prevents omissions
- `author_node_id` column is added to `claimnet.claims` to support `agent_only` filtering
- Org visibility ceiling logic is implemented in the search repository, not in Postgres policies
