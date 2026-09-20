# Admin UI and export/import inventory

Source: read-only code sweep by a research sub-agent, 2026-09-19, condensed by the orchestrator. Citations are `file:line` at the commit current on that date and will drift. Feeds the program doc §3.12 (org admin console) and §3.13 (org data export).

## Headlines

1. The admin design system is real but half-adopted. Three of six admin pages use `apps/frontend/src/components/admin/*`. `AdminQueuesPage`, `AdminEmbeddingsPage`, and `AdminLandingPage` hand-roll their own layout, including eight raw `<table>` elements. The kit itself is entirely inline styles, and `AdminLayout`'s nav is a hardcoded array with no notion of scope.
2. `GET /admin/users` is already nearly parameterizable to org scope: it is one SQL template built from an array of predicates. What's missing is an anchor, because there is no org membership table. Today org scope is only derivable as "has a book in this org" through `group_members` joined to `groups.organization_id`.
3. The export has drifted, and nothing could have prevented it. 20 of 31 tables and roughly 30 columns are absent from `/auth/me/export`, and no manifest or coverage check knows the schema exists. `scripts/generate-data-model-docs.ts` already solved this class of problem for the data-model doc.

## Part A: admin UI

### Pages

| Route | Component | Uses the shared kit? | Notes |
|---|---|---|---|
| `/admin` | `AdminLandingPage.tsx` | No | Duplicates the role gate inline (`:17-30`) instead of `useAdminGate`. Card list (`:32-51`) omits Signups and Emails, which the nav has. |
| `/admin/users` | `AdminUsersPage.tsx` | Yes | Four metric cards, five filters, sortable paginated table. |
| `/admin/signups` | `AdminSignupsPage.tsx` | Mostly | Signup-cap form and admin-invite form are bespoke. |
| `/admin/emails` | `AdminEmailsPage.tsx` | Yes | `email_log` browser. |
| `/admin/queues` | `AdminQueuesPage.tsx` (941 lines) | No | Four raw tables; own back-link instead of the sidebar. |
| `/admin/workers/embeddings` | `AdminEmbeddingsPage.tsx` (433 lines) | No | Four raw tables; holds the embeddings kill switch. |

Not present: an audit-log page, an organizations page (though `GET /admin/organizations` exists with no consumer), a per-user detail page.

### Shared components

`AdminLayout`, `AdminPageHeader`, `AdminMetricCard`, `AdminStatusDot` (hardcoded hex colors rather than tokens), `AdminEmptyState`, `AdminFilterBar` (which also exports `AdminField`, `AdminTextInput`, `AdminSelect`), `AdminTable` (generic `AdminColumn<Row>`), `AdminPagination`, and `useAdminGate`, which is hardwired to `role === "system"` (`useAdminGate.tsx:35`). An org console needs a parameterized gate.

### Stated conventions

- `docs/architecture/admin-dashboards.md` and `docs/engineering-principles.md` §12: admin pages are data-model-driven, not curated reports. Per-table aggregates and raw rows, per-row drill-in showing every column, filters that map to columns, read-only first and actions after visibility. A two-layer split between generic data-model pages and application-specific worker pages.
- The "no generic Settings page" rule lives only as a code comment in `AdminLayout.tsx:13-15`: each control lives with the surface it governs. It has no doc home.
- Tension to resolve in design: §12 says "no hiding fields", while the org console must hide private-book detail from org admins by design. The org view is a deliberate, documented exception scoped to what the viewer is entitled to see.
- Doc drift: `admin-dashboards.md` promises a `/admin/workers` landing page that doesn't exist.

### Backend

`admin.use("/*", requireAuth, requireVerifiedEmail, requireSystem)` at `routes/admin.ts:34`. The users list (`:194-278`) builds `where` as an array of predicates joined with `sql.join`, sorts through a whitelisted `sortColumnMap`, caps `limit` at 200, and repeats the where-clause for the count query. Per-user columns: email, role, verified, suspended (+reason), waitlisted, premium, signup reason, last login, created, plus three correlated counts (active keys, recipes, books). Stats (`:281-306`) are ten unscoped scalar subqueries. The same list-query pattern is hand-written three times (users, jobs, emails).

There is no `GET /admin/users/:userId`, so the per-row drill-in that §12 calls for doesn't exist for users. `api_keys.last_used_at` is never surfaced to admins; `last_login_at` is the only recency signal.

### Actions

Exist: grant or revoke premium (audit-logged), approve waitlist, cap-bypass invite, raise cap with auto-promotion. Missing: suspend or unsuspend (the column is selected, filtered, and rendered as a status, but nothing writes or enforces it), role change, admin-initiated delete, resend verification, force password reset, revoke a user's keys, any audit-log view.

### Pain points a refactor should fix

Two design languages across the console; a duplicated gate and a second hardcoded nav list; inline styles everywhere with repeated font literals; per-page filter-state boilerplate copied between Users and Emails; about a dozen copies of the `{ok, data, error}` unwrap; the list-query pattern written three times on the backend; actions shipped before visibility (premium toggles with no audit surface).

## Part B: export and import

### What `/auth/me/export` includes

`apps/backend/src/routes/auth.ts:383-532`. One JSON object with `exportedAt`, `schemaVersion: 1`, and ten sections: `user`, `organizations` (owned only), `groupMemberships`, `apiKeys` (never the key itself), `traces`, `traceEvidence`, `evidence`, `traceReferences`, `evidenceReferences`, `references`. Everything anchors on `user_id = me` and fans out by join. There is no book or org anchor anywhere, so an org export can't reuse the query shape. It needs `groups.organization_id` as the root.

Stated policy (`:385-389`): the user gets back what they contributed, not what the system derived. `schemaVersion` stays 1 for additive nullable fields and changes only on breaking changes (`:506-512`).

### Drift against the schema

Missing columns on exported tables that look user-authored: `users.displayName`, `users.preferences`, `users.signupReason`; `organizations.isPersonal`; `groups.organizationId` (without it a multi-org corpus can't be reconstructed); `group_members.dailyRead` and `dailyWrite`; `references.originalFilename` and `regionMeta` (the known backlog bug).

Absent tables that look exportable: `trace_reactions`, `check_feedback`, `check_feedback_stars`, `intents`, `uploads`, `ephemeral_books`. Feedback and reactions are acknowledged as out of scope in `docs/planning/corpus-import.md`, so that part is known debt.

Correctly system-only: the four embedding tables (note `embedding_sources.source_text` is cleartext user content), `vector_cache`, `reference_source_cache`, OAuth client and code tables, `system_settings`, `audit_log`, `email_log`, `session_shown`, `intent_shown`. Unclear: `invitations`, which carries a live token and so can't be exported raw.

### How import depends on the shape

Import reads one JSON object into memory under a byte cap, gates on a root-level `schemaVersion`, treats missing sections as empty and unknown keys as ignorable, and treats wrong-typed sections as errors. Section names are the contract, and `groupMemberships` doubles as the book manifest. Type fidelity matters: the null-versus-value distinction on `decidedAt` is documented as information and tested.

Consequences for changing the format: per-table JSONL is viable and better for streaming, but it is a breaking change by the project's own definition (a `schemaVersion` bump, with v1 files still accepted) and the validator must be re-rooted on a manifest. CSV can only ever be a presentation format, because it can't distinguish null from empty string and would destroy the semantics the import design protects.

### The fail-loud pattern to copy

`scripts/generate-data-model-docs.ts:120-201`: one hand-maintained map (`tableGroups`) that must be total over the machine-derived table set. The guard computes both directions (uncategorized tables, stale entries), names the offenders and the file to edit, and exits before writing anything. The generator is deterministic, so `scripts/check-data-model-docs.mjs` can regenerate into a temp dir and diff, wired into CI and `test:ci`.

## Recommendations

### Shared admin users design

1. Extract the users list into a service taking a scope union (`site` or `org` with an id). One predicate array, one sort map, one count query. With a real `organization_members` table the org predicate is a plain join.
2. Extract the generic list-query helper the three hand-written copies share.
3. Add the read surfaces first: `GET /admin/users/:id` and the org-scoped twins, before any org-admin action.
4. Same service, different gates: `requireSystem` for `/admin/*`, an org-role check for the org routes. Keep org-admin disable distinct from site suspension in the scope model.
5. Build enforcement for disable before shipping an org console, or the org "disable member" control will look right and do nothing, as the suspended status does today.
6. Frontend: one `AdminUsersTable` taking scope, columns, and actions, with column definitions in one factory so the two views can't drift. The org visibility rules (aggregates only for private content) belong in that column factory.
7. One `useAdminListQuery` hook for filter state and response unwrapping; parameterize `AdminLayout`'s nav and `useAdminGate`.
8. Migrate the two holdout pages onto the kit and move repeated style literals into design tokens, so "shares components with the site admin tools" is true of the whole console.

### Manifest-driven export

1. One manifest classifying every table as `export` (section, columns), `mask` (columns withheld, reason), or `omit` (reason), plus the table's scope anchor (`user`, `group`, `org`, or none).
2. A `check:export-manifest` guard modelled on `check:data-model`: fails on tables or columns present in the schema snapshot but unclassified, and on stale entries. The column-level check is what would have caught `original_filename` and `region_meta`.
3. Keep the hand-written queries, which carry real scoping logic, and assert their select lists against the manifest.
4. Ship the manifest inside the payload now. It is additive, so `schemaVersion` stays 1, and it stages the later move to per-table JSONL.
5. Order: write the manifest, let the guard fail, fix the known drift and classify feedback, reactions, intents, and uploads explicitly, then build the org export on top.
