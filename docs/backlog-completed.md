# Backlog — completed

Items moved here from `backlog.md` when finished. Date-stamped so we can see what landed when. Strike-through (`~~text~~`) for sub-items completed within a still-open parent item.

---

## Agent surfaces

### 2026-05-12 — Unified agent briefing (one source, one button, includes cluster samples)

Consolidated ~10 overlapping agent-facing surfaces into a single artifact. The `GET /keys/briefing?type=mcp|web` split is gone; one endpoint returns one markdown briefing that covers both MCP-capable and web-only agents inline. The `## Context from <books>` cluster-exemplars section that previously only appeared on the Recipe Map page is now part of every briefing — Dashboard, API Keys, Recipe Book, and Map pages all hand back the same artifact (the map adds refinement params).

Frontend: dual "Copy MCP briefing" / "Copy web briefing" buttons collapsed to one "Copy agent briefing" button on all four surfaces. The Recipe Map page's client-side exemplar-injection (~80 lines) is gone — the backend composer now does it.

MCP tool rename: `get_recipe_guide` → `get_briefing`. Returns the same unified briefing the HTTP endpoint does, so MCP agents calling `get_briefing` are primed with the user's recipe books and a clustered corpus sample, not just static guide text. Stdio MCP server reduced to a thin proxy that calls the new Bearer-token-auth `GET /briefing` backend endpoint.

User preferences: new JSONB `users.preferences` column (migration `0019_user_preferences`), Zod-validated in `@soupnet/domain/user-preferences`, exposed via `GET/PATCH /me/preferences`. First two prefs are `briefing.clusterCount` (default 5; used by the briefing pipeline) and `briefing.subClusterCount` (default 1; stub for the planned sub-cluster drill-down).

Settings IA: `/app/settings` is now a layout with a left-nav and two child routes — `/app/settings/account` (extracted from the old monolithic page, minus Agent Setup / Privacy Defaults / System Admin which moved or were removed) and `/app/settings/briefings` (cluster-count preference).

Documentation: new "Priming an External LLM via Copy-Paste Briefing" pattern in `docs/design-thinking.md` and Scenario F (Factorio mod art via ChatGPT) in `apps/backend/public/docs/recipe-scenarios.md`, cross-linked.

#### 2026-05-13 — Briefing v2 (content review + list_my_recipe_books alignment)

Follow-up round after first-paste review of the unified briefing. Targeted what the receiving LLM actually needs to know vs what was over-explained or missing.

- **Section reorder**: concept frame (Principles, When to check, Recipe format) → identity (user, recipe books, corpus exemplars) → mechanics (API key, setup, how to check) → output patterns (annotation, divergent, links, JSON copy-back). The previous "two connection styles" framing at the top was removed — section headers carry it without putting a decision in the receiving model's hands.
- **Recipe format section added**: 2 annotated examples (surfacing-an-assumption + stated-preference) + the three voice-failure modes (agent voice / user-name voice / recipe-book-implied voice). New `VOICE_FAILURES` export in `recipe-guide-content.ts`; small inline format examples curated from the larger `RECIPE_EXAMPLES` set.
- **Exemplar metadata enrichment**: each exemplar now has a YAML-frontmatter header (`### Exemplar N of M`, `Recipe ID`, `Recipe book`, `Author`, `Logged`, `Cluster size`) instead of the ambiguous `(1 similar · logged YYYY-MM-DD)` single-line. Exemplar start/end is now unambiguous; the recipe ID lets the receiving agent link/reference/reinforce specific traces. Backend `briefing-exemplars.ts` was extended to join `users` + `groups` for author + book lookup.
- **Members list on shared recipe books**: each shared book in the briefing now lists other members (`displayName <email>`) so the receiving LLM can name collaborators in synthesis. Solo books omit the line entirely.
- **User identity**: new `## Your user` section gives the LLM the human's display name + email so it can address them by name. Previously the briefing was anonymous.
- **Cross-pollination framing**: new `CROSS_POLLINATION` export — explicit guidance that recipes from other members of shared books surface alongside the user's own, and should be weighed as collaborator context with author attribution.
- **`list_my_recipe_books` MCP tool aligned with the briefing**: now returns the same `## Your user` + `## Your recipe books` + `## Context from your corpus` block (no boilerplate). Single composer (`services/briefing.ts` → `composeCorpusContext`); both surfaces stay in lockstep automatically. Tool description updated to frame it as a mid-session "briefing refresh" — agents call it when conversation drifts into a new area of the user's work, or periodically during long sessions on shared books to pick up new recipes from collaborators.
- **MCP config compaction**: setup section reduced from ~80 lines (four full configs) to ~15 lines (one complete Claude Code config + a 3-bullet diff list for VS Code, Antigravity, and Claude Desktop). LLMs reason about the diff fine.
- **Evidence-formatting fixes**: stripped the internal `(no interpretation)` placeholder that some recipe-checker LLMs literally emit when they have a quote but no synthesized commentary. Quote-less references now render as a bare `-- source` line (faithful to data; reflects an LLM author who collapsed description into source).
- **Bug fix**: `SearchResultItem.createdAt` is typed `Date` but the raw `db.execute(sql\`…\`)` path in `fetchCorpusTraces` returns it as a string from postgres-js — the rest of the codebase already treats it as a string. The briefing composer was calling `.toISOString()` on it and 500ing; now uses a defensive `formatLoggedDate(unknown)` normalizer.
- **Bug fix in `useClipboard.copyToClipboardAsync`**: the `getText` callback was being invoked twice when the inner promise rejected — the ClipboardItem path failed, fell through to the textarea fallback, and called `getText` again. For copy-briefing handlers that mint a fresh daily key, this minted two keys per click. Memoized so any rejection re-throws to the caller instead of triggering a retry. Pre-existing bug, exposed by the 500.
- **Bug fix in evidence quote-parsing**: `parseEvidenceMarkdown` was storing references with surrounding `"..."` marks intact (e.g. `quote: '"the text"'`), so any renderer that wrapped with `"..."` produced doubled `""the text""`. Visible in every briefing and in the stdio MCP `check_recipe` text output. Parser now strips a pair of outer matching `"` at parse time (canonical inner-text storage); briefing renderer also strips defensively to handle already-stored legacy data without needing a DB migration. Tests updated.

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
