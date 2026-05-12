# Backlog — completed

Items moved here from `backlog.md` when finished. Date-stamped so we can see what landed when. Strike-through (`~~text~~`) for sub-items completed within a still-open parent item.

---

## Vocabulary and rename

### 2026-05-10 — Group → Recipe Book user-surface rename + schema-rename deferral

User/agent-facing rename landed in commit `bd59f23`: frontend UI, REST routes (`/recipe-books/*` with `/groups/*` 308-redirecting), MCP tool names (`list_my_recipe_books`, `update_recipe_book_description`), JSON wire-format fields (`*RecipeBookIds`), email/blurb copy, recipe guide, agent briefings, recipe-book descriptions on Soup.net, Layer 1 regression test. Residual long-form-doc sweep (engineering-principles.md, architecture/overview.md, data-model.md, data-flow.md, api.md banner, workflows/new-user-onboarding.md, design-thinking.md remainders) landed in the follow-on commit on the same day. Schema-level rename of `claimnet.groups` / `group_members` is deferred — fully tracked in `docs/adr/0016-groups.md` §"Update 2026-05-10" with explicit trigger conditions. Both prior backlog items (the residual sweep and the schema-rename decision) are now closed there.

---

## Legal and compliance

### 2026-05-12 — Public-ready trim pass on legal pages

Big-picture review of the 2026-05-09 publish. Removed self-imposed framing that doesn't serve a public-facing policy:

- Removed the "trusted-tier" banner and "Pending counsel review" sections from both `privacy-policy.md` and `terms-of-service.md`. Counsel-review checklist moved to `backlog.md` only — not surfaced in public-facing text.
- Dropped "sole proprietor" disclosure. Operator field is now just "Andy Forest, based in Canada" — leaves Dimentians Ltd or Steamlabs as later options without amending public text.
- Consolidated all public-facing emails to `admin@soup.net` (subject-line routing for abuse / deletion / privacy requests). Kept `security@soup.net` per security.txt convention.
- Softened specific numeric commitments ("30 days deletion response", "72-hour breach notification to users", "5-day security ack", "14-day terms-change notice", "CAD $100 liability floor", "30-day backup retention", etc.) to qualitative language ("without undue delay", "as required by applicable law", "by reasonable means").
- Replaced "in-app banner for 14 days" change-notification promise with "by reasonable means" — see `backlog.md` for the actual mechanism build-out.
- Age minimum unified to 18+ across the board (was 13+/16-EU). Removes COPPA exposure and parental-consent complexity.
- Dropped jurisdiction-specific disclaimers (CCPA scope statement, GDPR Article 27 representative discussion, Quebec Law 25 mention). Rights are extended universally without commenting on which laws apply.
- Replaced "group / group memberships" with "recipe book / recipe book memberships" — vocabulary alignment with the Group → Recipe Book rename.
- LICENSE trademark notice updated: `hello@` → `admin@`.

### 2026-05-09 — Privacy policy + terms of service live pages (initial publish)

Replaced the placeholder `/info/privacy` and `/info/terms` pages with content rendered from `docs/legal/privacy-policy.md` and `docs/legal/terms-of-service.md` (single source of truth via `react-markdown` + Vite `?raw` imports). Cookie/localStorage notice added (one-time dismissable bottom banner). Marketing footer links to legal pages added on `LandingPage` and `HowItWorksPage`. LICENSE addendum added covering Soup.net name, logo, and visual design as reserved trademarks excluded from the MIT grant. Initial publish used a trusted-tier framing that was rolled back in the 2026-05-12 trim pass above.
