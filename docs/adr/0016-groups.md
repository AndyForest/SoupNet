# ADR-0016: Groups — Lightweight Cross-Org Project Sharing

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The current model has one sharing axis: organizations. Claims are visible within an org (`org_only`) or publicly (`public`). This is too coarse for real collaboration patterns:

1. **Cross-org collaboration**: A group of parents working on a school project don't share an organization. Neither do two freelancers collaborating on a client project. Creating a formal organization just to share a few claims is too heavyweight.

2. **Project-scoped sharing**: Even within an organization, some claims are only relevant to a specific project or team. Marking everything `org_only` creates noise; a separate project-scoped space is cleaner.

3. **Social analogy**: The natural mental model is closer to a private Facebook group or a Discord server channel than a formal company. You create a group for a project, invite the people working on it, and the group goes dormant when the project ends. The claims remain for reference; the group just stops being active.

---

## Decision

Add **groups** as a lightweight, project-scoped sharing layer that sits alongside organizations. A group:
- Can include users from multiple orgs
- Has no billing, no admin hierarchy beyond owner/admin/member roles
- Is created for a specific project or purpose
- Has claims shared to it explicitly (a claim belongs to an org; it is *shared* to a group)
- Can be searched independently from org search

---

## Schema additions (Payload-managed, `public` schema)

### `public.groups`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Payload default |
| `name` | `text` | 2–100 chars |
| `slug` | `text` | Unique, URL-safe identifier |
| `description` | `text` | Optional, max 1000 chars |
| `created_by` | `uuid` | FK → `users.id` |
| `is_archived` | `boolean` | Archived groups are read-only. Default `false`. |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `public.group_members` (Payload join table)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | |
| `parent_id` | `uuid` | FK → `groups.id` |
| `user_id` | `uuid` | FK → `users.id` |
| `role` | `text` | `owner` \| `admin` \| `member` |
| `joined_at` | `timestamptz` | |

---

## Schema additions (Drizzle-managed, `claimnet` schema)

### `claimnet.claim_group_shares`

Records which claims are shared to which groups.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `claim_id` | `uuid` | FK → `claimnet.claims.id` |
| `group_id` | `uuid` | UUID ref → `public.groups.id` |
| `shared_by` | `uuid` | UUID ref → `public.users.id` |
| `shared_at` | `timestamptz` | |

**Unique:** `(claim_id, group_id)`.
**Indexes:** `claim_id`, `group_id`.

---

## Privacy level additions

The `privacy_level` enum on `claimnet.claims` gains one new value:

| Value | Description |
|---|---|
| `group` | Visible to members of all groups this claim has been shared to (via `claim_group_shares`). |

A `group` claim is NOT visible to org members unless they are also members of the relevant group. A `group` claim IS visible cross-org to all members of the groups it's been shared with.

**Effective visibility chain:**
```
local_only < agent_only < user_only < group < org_only < public
```

A claim can only be shared to a group if its `privacy_level` is `group` or higher (i.e., `org_only` or `public` claims are already visible to a broader audience and don't need group-specific sharing).

---

## ACL update

The privacy level query helper now includes group membership:

```sql
WHERE (
  (privacy_level = 'public')
  OR (privacy_level = 'org_only' AND organization_id = $orgId)
  OR (privacy_level = 'group' AND claim_id IN (
    SELECT claim_id FROM claimnet.claim_group_shares cgs
    JOIN public.group_members gm ON gm.parent_id = cgs.group_id
    WHERE gm.user_id = $userId
  ))
  OR (privacy_level = 'user_only' AND author_id = $userId)
  OR (privacy_level = 'agent_only' AND author_node_id = $nodeId)
)
```

---

## Group search

Agents can search within a specific group by passing `group:<slug>` as a search flag:

```
"volunteer website deployment" group:taylor-school-project
```

This restricts the search to claims shared to that group (plus any more restrictive claims the agent has access to). Group search respects all other privacy constraints.

---

## Interaction with knowledge edges

A knowledge edge (ADR-0017) between two claims has its own `privacy_level`. If a `group` claim has an edge to an `org_only` claim:
- Group members see the `group` claim and can see the edge exists
- The edge's target (`org_only` claim) is only visible to org members
- Group members outside the org see a "referenced claim not accessible" placeholder

Agents navigating the graph respect the privacy envelope at each hop. The graph query helper applies ACL filtering node by node.

---

## Groups vs. Organizations

| Dimension | Organization | Group |
|---|---|---|
| Purpose | Formal entity (company, team, personal) | Project-scoped collaboration |
| Membership | Formal, with org admin management | Informal invite-based |
| Billing | Tied to org | None |
| Claim ownership | Claims belong to an org | Claims are shared to groups, not owned |
| Lifespan | Persistent | Project-duration (archived when done) |
| Cross-org | No | Yes — members from any org |
| Visibility ceiling | Org visibility setting | Each group is independent |

---

## Consequences

- Two new Payload-managed tables (`groups`, `group_members`) in the `public` schema
- One new Drizzle-managed table (`claim_group_shares`) in the `claimnet` schema
- `privacy_level` enum gains `group` value — Drizzle migration required
- ACL helper updated to join group membership
- MCP search tool gains `group:` flag support
- **Invite flow (decided):** Invite link with code (lighter weight than org email invites). When a user tries to add a member whose email isn't in the system, generate a signup invitation link scoped to that group. Invitations stored in an `invitations` table with `inviter_id`, `group_id`, `email`, `token`, `expires_at`, `accepted_at`. Invitations reserve a slot against the global signup cap.

  **Update 2026-04-19 — spam-safe refinement (supersedes the auto-add-on-register behavior above):**
  - `POST /groups/:id/invite` is **spam-safe**: the response shape is identical regardless of whether the email is registered (no user-fishing), and **Soup.net never sends email to non-users** — the inviter gets a copy-pasteable blurb to deliver through their own channel. This protects sender reputation and prevents the system from becoming a spam vector.
  - **No auto-accept on any path.** Registered users see incoming invitations on their dashboard and Groups page (pending-invitations feed) and must click Accept. Previous behavior auto-joined on `/auth/verify` success (F31 mitigation in the 2026-04-09 audit); the current stronger gate requires both verified-email middleware AND explicit user action on `POST /invitations/:id/accept`. New endpoints: `GET /invitations/pending`, `POST /invitations/:id/accept`, `POST /invitations/:id/decline`, `GET /groups/:id/invitations`, `DELETE /groups/:id/invitations/:inviteId`.
  - Schema addition: `invitations.declined_at timestamptz NULL` (migration 0015).
  - The invitations table still reserves against the signup cap unchanged.
  - Rationale: the Soup.net-surfaced "inviting in your AI agent" framing (see `docs/design-thinking.md §"The 'inviting in your AI agent' moment"`) reframed the invitation as the moment a collaborator's AI agent gains team context — post-accept onboarding is now first-class, so explicit Accept is the natural click-point rather than a silent auto-join.
- **Group archival (decided):** Archived groups are fully read-only — no new claims can be shared to them. Claims remain accessible for reference.
- **Agent-editable group descriptions (decided):** Agents can update group descriptions via `PUT /groups/:id/description` (API key auth) and `update_group_description` MCP tool. Changes take effect immediately with notification. Agents are encouraged to recipe-check before updating. Changes logged in audit_log with api_key_id.

---

## Update 2026-05-10 — User-surface rename to "Recipe Book"; schema-level rename deferred

### What changed

The user/agent-facing concept previously called "group" is now called "recipe book" everywhere a user, agent, or marketing reader sees it. The schema-level vocabulary stays on "group" (deferred — see the Decision below).

Surfaces renamed (commit `bd59f23`):
- **Frontend UI:** all labels, page titles, button text. Route paths `/app/groups` → `/app/recipe-books` with TanStack Router redirects from the old paths.
- **Backend REST API:** `/recipe-books/*` mounted as the canonical path. Legacy `/groups/*` 308-redirects (308 over 301 so POST/PUT/DELETE preserve method+body — matters for cached briefing-link curls hitting `POST /groups/:id/invite`).
- **MCP tools:** `list_my_groups` → `list_my_recipe_books`, `update_group_description` → `update_recipe_book_description`, `check_recipe` parameters `group` → `recipe_book` and `read_groups` → `read_recipe_books`. Tool descriptions and result text updated. The `/check` page query params accept both new and legacy names so existing briefing URLs in agent context windows continue to resolve.
- **HTTP wire format on `/keys/*`:** `readGroupIds`/`writeGroupIds`/`defaultWriteGroupId` → `readRecipeBookIds`/`writeRecipeBookIds`/`defaultWriteRecipeBookId`. `writeGroupId` → `writeRecipeBookId`. Mapped at the route boundary (`toWireKey` / `toWireKeyListItem` in `apps/backend/src/routes/keys.ts`); internal service-layer types and DB columns stay on the schema-level vocabulary.
- **Email + invitation blurb:** "invited you to a recipe book on Soup.net".
- **Agent briefings, recipe guide, agent-voice copy** (`packages/domain/src/recipe-guide-content.ts`).
- **Recipe-book descriptions on Soup.net** updated for both `soup-net-development` and `soupnet-oss`; the self-hoster boundary test ("would a self-hoster running this stack on their own infrastructure need this judgment?") is preserved verbatim.
- **Layer 1 regression test** (`apps/backend/src/routes/mcp-tool-descriptions.test.ts`) reads the MCP route source and asserts the four invariants of the rename so a future drift fails CI.

What stays on schema-level "group" vocabulary:
- Drizzle tables `claimnet.groups`, `claimnet.group_members`, columns `group_id`, TS field `groupId`.
- Internal service-layer types in `api-key.service.ts`, `trace.service.ts`, audit-log action strings (`group.description_updated`, `targetType: "group"`).
- React Query cache keys (`["groups"]`, `["group-members", id]`).
- Recipe Map query params (`?groupId=`).
- Migration filenames (e.g., `0007_group_scoped_keys.sql` — immutable history).
- Historical ADRs and case studies that describe the term in use at the time.

### Decision: schema-level rename is deferred

A second-pass rename of `claimnet.groups` → `claimnet.recipe_books` (and the column / TS-field cascade) is **not done now**. The user-surface rename is sufficient for the launch-readiness goal; the residual translation tax sits in a small mapper layer in `routes/keys.ts` and a one-line CLAUDE.md hint that the schema-level vocabulary differs from the brand.

**Rationale.** The deciding question was "does the wire-format mapper bother future contributors more than reading 'groups' in the DB does?" The mapper is ~30 lines with a 4-line explanatory comment — boring once seen. Reading "groups" in the DB is a recurring small papercut, but each instance is small and the schema-vs-brand note in CLAUDE.md dispatches most of the confusion. The blast radius of a schema rename (hundreds of raw-SQL references across `routes/`, `services/`, frontend cache parsers, plus a coordinated migration with audit-log drift and immutable migration filenames that would still say "group") is genuinely big, and a rename-and-revert is dramatically harder than a code-merge-and-revert.

### Trigger conditions to revisit

Lift the deferral when any of these fire:

1. **The wire-format mapper grows teeth.** If `toWireKey` / `toWireKeyListItem` has to handle a third translated field beyond `readGroupIds` / `writeGroupIds` / `defaultWriteGroupId`, the mapper is becoming architecture rather than a shim — that's the signal to do the schema rename instead of extending the mapper.
2. **Vocabulary drift creates bugs.** If a new contributor writes service-layer code and accidentally extends the legacy "groups" vocabulary in a way that ships a bug (e.g., a new column, a new cache key, a new audit-log action), that's evidence the schema-level "group" name is actively misleading.
3. **Another destructive migration is happening anyway.** If a migration is already touching `claimnet.groups` for an unrelated reason, the marginal cost of including the rename is low — bundle them.
4. **A self-hosting operator pushes back.** If a hosted-deployment customer or active self-hoster says the DB-level naming is confusing them in operations / monitoring / queries, that's direct evidence the deferral cost has exceeded the migration cost.

When the rename is done, the migration plan should document: a transitional view (`CREATE VIEW groups AS SELECT * FROM recipe_books`) for one deploy cycle, a one-time strategy for audit-log `targetType` strings (handle both forever, or one-time UPDATE with explicit accept of the audit-log purity violation), and the resulting deletion of the wire-format mapper layer.

### Pointer

Implementation lives in the commits surrounding `bd59f23 feat(plan-03): rename Group → Recipe Book on user-agent surface`. Decision context: plan-03 briefing (Andy chose A1/B1/C1/D1 — the aggressive rename — for the user surface, and the schema-rename deferral was carried over from plan-02's locked decisions).
