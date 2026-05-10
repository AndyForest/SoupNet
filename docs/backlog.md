# Backlog

The shared backlog for Soup.net. Tracks pending work across multiple AI agent sessions per the workflow described in `CLAUDE.md`.

**Tags:**
- `[IMPL]` — implementation work, well-defined
- `[DESIGN]` — needs design thinking before implementation
- `[DECISION NEEDED]` — needs an explicit operator decision

When you complete an item, move it to `backlog-completed.md` with a date stamp. Strike-through (`~~text~~`) sub-items as you finish them.

---

## Legal and compliance

### `[IMPL]` Self-serve account deletion endpoint

Build `DELETE /auth/me` so the privacy policy can drop the "email privacy@soup.net" workaround.

- Cascade-delete: `traces`, `evidence`, `references`, `trace_evidence`, `trace_references`, `evidence_references` rows owned by the user; `group_members` rows; `api_keys`; `embedding_vectors` keyed to the user's traces; `users` row.
- Preserve: `vector_cache` (content-hash keyed, no identifier link). `audit_log` entries (append-only; user-attributable rows can be redacted to `<deleted-user>` while preserving the security trail).
- Confirmation flow on the Settings page (modal: type "DELETE my account" to confirm).
- Once shipped: update `docs/legal/privacy-policy.md` Section 7 and `docs/legal/terms-of-service.md` Section 9 to reflect self-serve deletion (drop the "email privacy@soup.net" path or keep as alternative).
- Layer 3 integration test: register → check recipe → delete account → verify all owned rows gone, vector_cache rows present, audit_log redacted.

Currently the privacy policy and terms route deletion to `privacy@soup.net` as a manual operator response within 30 days. This is acceptable for trusted-tier but blocks the public-launch promise.

### `[DECISION NEEDED]` Public-launch lawyer review

The trusted-tier banners on `/info/privacy` and `/info/terms` flag specific items as pending counsel review:

- PIPEDA compliance review by Canadian counsel.
- GDPR Article 27 representative requirement (current position assumes not required at our scale; counsel to confirm).
- CCPA / CPRA scope confirmation (current position assumes out of scope at trusted-tier volume).
- Bespoke AWS and Google Cloud Data Processing Addenda (currently relying on standard customer agreements).
- ToS Section 10 (limitation of liability) under Ontario law.
- ToS Section 11 (indemnification) for enforceability and scope.
- ToS Section 13 (governing law) and consumer-protection carve-outs (especially Quebec, EU consumer rights).
- Postal mail contact address (whether jurisdictionally required).

Trigger: before opening signups beyond the trusted-tier cap.

### `[IMPL]` Verify Privacy Policy claims match implementation

The refined `privacy-policy.md` describes specific implementation behaviors that need verification:

- Section 2.3: "S3 lifecycle rule" for upload deletion is described as the long-term mechanism. Confirm whether it is configured today vs. enforced by cleanup jobs; soften wording or implement.
- Section 9: "Content Security Policy on all pages" — verify the CSP middleware is in place and covers all routes.
- Section 8: "Backups: 30 days" — confirm RDS automated backup retention period matches.

Surfaced during the 2026-05-09 legal pages refresh.

---

## Launch readiness

### `[DESIGN]` Onboarding polish for first session

Carried over from the controlled-invite-first sequencing decision (2026-04-09). Polish the first 30 seconds of a new tester's experience: invitation email body, post-verify dashboard state, recipe-check first-success.

---

## How to use this file

1. Before starting work: scan for items in your area. Look for context, dependencies, conflicting in-flight work.
2. After completing work: cut the item from this file; paste into `backlog-completed.md` with date stamp; strike sub-items if a multi-part item is partially done.
3. New work discovered: add to the relevant section here with the right tag. If you don't know the section, add it under "Unsorted" at the bottom.

This file is the way concurrent AI sessions coordinate without explicit messaging.

---

## Unsorted

### `[IMPL]` Residual Group → Recipe Book sweep in long-form docs

The 2026-05-10 rename pass landed all the user/agent surfaces (frontend UI, MCP tool names, /recipe-books REST routes with /groups → 308 redirects, JSON wire-format `*RecipeBookIds` fields, email/HTML copy, recipe guide, principles). The schema-level vocabulary (`groups` table, `group_members` table, `groupId` TS field, internal `readGroupIds` service-layer types) intentionally stays per the schema deferral.

What's still using "group" verbatim and should be swept on the next pass:

- `docs/design-thinking.md` — many remaining mentions in agent archetype sections (post line 280) and in user-story prose. The principal sections (User Archetypes, Collaboration user stories, Configurable defaults) are renamed.
- `docs/engineering-principles.md` — mentions "groups" as a feature concept; should likely keep schema-level "group" only where it describes the schema, otherwise rename.
- `docs/architecture/overview.md`, `docs/architecture/data-model.md`, `docs/architecture/data-flow.md`, `docs/architecture/api.md` — architecture docs describing the data model can use "group" for schema-level discussion but should call the user-facing concept "recipe book" the first time it's introduced.
- `docs/adr/0016-groups.md` — historical ADR. Title and body intentionally NOT renamed (historical record). Add a frontmatter note pointing to the rename ADR (TODO).
- ADR for the rename itself — write a new ADR documenting the Group → Recipe Book rename, the deferral of the schema-level rename, and the 308-redirect/JSON wire-format-rename pattern.

### `[DECISION NEEDED]` Schema-level Group → RecipeBook rename

Tracked as a follow-up to the 2026-05-10 user-surface rename. Renaming `claimnet.groups` → `claimnet.recipe_books` (and `group_members` → `recipe_book_members`, columns `group_id` → `recipe_book_id`) is a destructive migration that touches every API key, every audit-log row, every Drizzle query. Defer until the user-surface rename has bedded in for at least one cycle. When ready: write an ADR with the migration plan (rename + view-alias, dual-read-period, then drop alias).
