# Backlog — completed

Items moved here from `backlog.md` when finished. Date-stamped so we can see what landed when. Strike-through (`~~text~~`) for sub-items completed within a still-open parent item.

---

## Vocabulary and rename

### 2026-05-10 — Group → Recipe Book user-surface rename + schema-rename deferral

User/agent-facing rename landed in commit `bd59f23`: frontend UI, REST routes (`/recipe-books/*` with `/groups/*` 308-redirecting), MCP tool names (`list_my_recipe_books`, `update_recipe_book_description`), JSON wire-format fields (`*RecipeBookIds`), email/blurb copy, recipe guide, agent briefings, recipe-book descriptions on Soup.net, Layer 1 regression test. Residual long-form-doc sweep (engineering-principles.md, architecture/overview.md, data-model.md, data-flow.md, api.md banner, workflows/new-user-onboarding.md, design-thinking.md remainders) landed in the follow-on commit on the same day. Schema-level rename of `claimnet.groups` / `group_members` is deferred — fully tracked in `docs/adr/0016-groups.md` §"Update 2026-05-10" with explicit trigger conditions. Both prior backlog items (the residual sweep and the schema-rename decision) are now closed there.

---

## Legal and compliance

### 2026-05-09 — Privacy policy + terms of service live pages

Replaced the placeholder `/info/privacy` and `/info/terms` pages with refined content rendered from `docs/legal/privacy-policy.md` and `docs/legal/terms-of-service.md` (single source of truth). Trusted-tier banner present on both pages flagging which sections still need lawyer review for public launch. Cookie/localStorage notice added (one-time dismissable bottom banner). Marketing footer links to legal pages added on `LandingPage` and `HowItWorksPage`. LICENSE addendum added covering Soup.net name, logo, and visual design as reserved trademarks excluded from the MIT grant.

Deferred from this work (now tracked in `backlog.md`):
- Self-serve `DELETE /auth/me` endpoint (privacy policy currently routes to `privacy@soup.net`).
- Verify three Privacy Policy claims (S3 lifecycle, CSP, RDS backup retention).
- Public-launch lawyer review checklist.
