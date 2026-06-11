# Backlog — completed

Items moved here from `backlog.md` when finished. Date-stamped so we can see what landed when. Strike-through (`~~text~~`) for sub-items completed within a still-open parent item.

---

## Launch readiness

### 2026-06-11 — Waitlist v2: the waitlist is a user-record state

Same-day redesign of the v1 waitlist below, after the operator walked the v1 flow and found it stranded people (no password, no ToS, no path from "notified" to "account"). The `waitlist` table lasted hours; v2 (migration `0024_waitlist_v2_user_records`) drops it:

- **Registering at a full cap creates a real account** with `users.waitlisted_at` set (mirrors the `suspended_at` pattern — flag, not role): password + ToS captured up front, email verifiable while waiting, sign-in blocked with a "you're on the waitlist" message and no JWT (which blocks every other surface for free). F30 restated: the register response branches only on attacker-knowable state (public cap status, caller-supplied token validity), never on email existence.
- **Promotion**: raising the signup cap auto-promotes the top of the queue (verified accounts only, invitation-holders first, then oldest) under the signup-cap advisory lock, emailing each "you're in" (`waitlist_approved` kind); plus a per-row admin **Approve** that works regardless of cap or verification. No promote-on-login race — accounts wait until promoted.
- **Invitations unchanged**: token rows only, no user record until the invitee registers (so no premature ToS/password); their priority is queue position. Verification email gets waitlist-variant copy.
- **`users.signup_reason`**: the "what would you use Soup.net for?" question moved onto the regular register form for every signup, surfaced in admin Users + Signups views.
- **Hygiene**: unverified waitlisted accounts purge after 30 days (opportunistic, on the cap-full register branch; disclosed in privacy policy §8).
- Tests: HTTP suite for cap-open paths; DB-fixture suite (`waitlist.service.test.ts`) for the cap-state-dependent state machine — closing the global cap in HTTP tests would flake every parallel suite.

### 2026-06-11 — (v1, superseded same day) Waitlist, signup-queue semantics, email log, admin Signups page

Triggered by AWS production SES approval (site effectively live, prod cap at 5). Landed in two same-day passes — the first shipped invite-bypasses-cap, which the operator then corrected to top-of-waitlist semantics; what's described here is the final state:

- **Waitlist was fake.** The login page's waitlist form showed "You're on the list!" while persisting nothing (`TODO: Wire up to POST /waitlist`). New `claimnet.waitlist` table, public rate-limited `POST /auth/waitlist` (anti-enumeration: identical response for new/duplicate/registered emails, mirrors F30 register design), form wired. A second, unreachable copy of the waitlist screen in LoginPage (dead `showWaitlist` state) was removed.
- **Invite semantics (operator decision):** a member invitation puts the invitee at the **top of the waitlist**, it does not bypass it. The invitation reserves a slot against the cap; the invitee registers only while their reservation fits within the cap (`mayRegister` excludes their own pending invitation from the count — the previous code counted it, silently rejecting invitees at the boundary; reservations also stop counting once the email belongs to a registered user). Admin invitations (`bypass_cap`) skip the cap entirely. New public `GET /auth/invite-status` lets the register page show "you're at the top of the waitlist" instead of a silently-failing form when the cap is full.
- **Admin invite is email-only:** `POST /admin/invite` no longer requires a recipe book (`invitations.group_id` now nullable; groupless invites stamped accepted at registration) and no longer auto-emails — it returns the invite URL for manual sharing, consistent with the ADR-0016 spam-safe design the auto-send had quietly crossed.
- **Email log (light CRM):** every outgoing email goes through `sendLoggedMail` → `claimnet.email_log` (metadata only, never bodies — they carry tokens; 60-day opportunistic purge). engineering-principles.md §14. Privacy policy §8 discloses it; §2.3/2.5/8 retention wording softened to match reality (uploads kept until account deletion; audit log retained for security/operational purposes).
- **Admin `/admin/signups` page** (no generic "Settings" page — each control lives with its surface; embeddings kill-switch moved to the Embeddings page): cap editor, merged signup queue (waitlist + pending member/admin invitations, type badges, invited-first ordering), per-row "spot opened" Notify action (consent-based — waitlist signups asked for it), admin invite-by-email with copyable link.
- **Admin `/admin/emails` page**: the email log as a proper list view — always-visible "what sends email" explainer, filter by recipient/kind/status, date sort, pagination. Same pass extracted the shared admin list-view primitives (`useAdminGate`, `AdminPagination`) so Users/Signups/Emails compose the same FilterBar + Table + Pagination pieces instead of copy-pasting them.

Migrations `0022_waitlist`, `0023_waitlist_crm_invite_semantics`. Tests: `waitlist.test.ts` (Layer 3 — full waitlist→notify→invite→register arc), `system-settings.service.test.ts` (Layer 1 — which branches consult the cap).

---

## Recipe checks

### 2026-06-10 — `decided_at`: backfill historical decisions with their original judgment date

New optional parameter on recipe checks for decision archaeology (design-thinking.md §Decision Archaeology — driven by the discovery-agents-on-an-unfamiliar-codebase use case): when an agent finds a past decision in git history, ADRs, or other dated artifacts, it checks the recipe with `decided_at` set to the artifact's timestamp so the judgment carries its original date instead of the logging date.

- Schema: nullable `traces.decided_at timestamptz` (migration `0021_add_traces_decided_at`). `created_at` stays the insertion time — temporal honesty: the record never claims to have been logged earlier than it was.
- Validation in `submitAndSearch` (service layer): ISO 8601 date or datetime; future dates rejected, so backdating can only make a recipe *older* — no freshness gaming.
- Agent-facing judgment date: search results coalesce `COALESCE(decided_at, created_at)` (hybrid search + corpus fetch), so `sort=recent`, result dates in JSON/HTML/MCP responses, and clustering exemplar dates all read as the judgment date. The check log (audit_log `occurred_at`) is untouched — it logs when checks happened.
- Param plumbed through all three surfaces: `CHECK_PARAMS` row (`decided_at`, alias `decided`, round-trips through Copy/re-check links), remote MCP `check_recipe`, stdio MCP proxy. Shared description in `MCP_PARAM_DESCRIPTIONS.decidedAt`; web-tier mention in `CONNECTION_TIERS`.
- Dashboard: trace detail shows "Decided ⟨date⟩ · logged ⟨date⟩" when backdated.
- Tests: stores/coalesces, null default, rejects unparseable, rejects future (trace.service.test.ts); param round-trip + alias (check-params.test.ts auto-covers via the CHECK_PARAMS table).

Follow-ups tracked in backlog.md §Decision archaeology follow-ups (more surfaces for the date; temporal decay should use the judgment date).

## Landing page

### 2026-06-10 — "The challenge" section: METR time-horizon framing + check-log visual

New section between the hero and Pillar 1 mirroring the in-person pitch (benchmark → log → explain the system): agents finish longer and longer unattended stretches (METR time-horizon measurements, linked in a Q&A expander), unattended hours are full of judgment calls, and the gap is keeping that work aligned with the user's taste and judgment. Visual is a static check-log excerpt (`CheckLogMock`) styled like the real CheckLogPage cards — one coherent afternoon of one agent's checks. Second Q&A expander differentiates from fact-storage memory (vendor memory, fact-extraction frameworks, knowledge-graph memory, markdown memory files): facts ossify; recipes carry role/goal/reasoning/quote/citation/date so future agents re-evaluate instead of obeying. Final CTA heading reworded ("The work is only getting longer…") to avoid duplicating the new section's heading; the Q&A `details` rendering was extracted from `Step` into a shared `QnaDetails` component.

---

## Landing page

### 2026-05-27 — Solution illustrations for the recipe-check walkthrough (three steps)

The landing page's "How Soup.net recipe checks solve this" section had a structural gap: the two pillar illustrations above depicted the situation Soup.net addresses, the carousel below showed concrete demonstration, but the walkthrough explaining the mechanism had no visual presence. Three small watercolor illustrations now sit beside the three steps, completing a consistent solve→demonstrate visual arc.

- `illustration-briefing-handoff.png` — person handing the briefing to an agent figure
- `illustration-checks-in-motion.png` — agent working alongside the person, recipe checks rising as small marks toward a glowing vessel
- `illustration-context-returning.png` — marks settling back around the agent, one or two glowing brighter

Layout follows pillar pattern: `flex: "1 1 220px"` with `maxWidth: 280`, `--color-outline-variant` hairline border, and `--radius-lg` rounding — same visual family as the existing two pillar illustrations, smaller scale. Connected as a vertical sequence beside the step text via tight `--space-md` gap between Steps. Responsive: shrinks below basis and wraps below step content on narrow viewports.

Pillar 1 and 2 alt texts updated in the same pass — previously solution-leaning ("aware of their working preferences," "handing accumulated context"), now describe the situations the artwork actually depicts so the new walkthrough illustrations can carry the solution imagery cleanly.

The `Step` component (`apps/frontend/src/pages/LandingPage.tsx`) gained optional `illustration` and `illustrationAlt` props during the structural work earlier the same day; wiring was a three-call drop-in. Detailed image-gen briefings used to produce the artwork are recoverable from git history (commits leading up to this move).

---

## Connector + OAuth

### 2026-05-14 — claude.ai custom-connector foundation: OAuth 2.1 + MCP polish + self-serve deletion

Eight commits in one session that take the connector flow from "Bearer-only, no claude.ai web support" to "ready for directory submission once non-code prep lands". Bullets in commit order:

- `2954463` Briefing edits. Added an explicit fifth principle ("Authoring for retrieval") that names the embed + ANN-search + clustering mechanism agents are writing into — once an agent sees the mechanism, the rest of the authoring guidance is derivable. Reworded the proper-noun rule from "strip" to "replace" (substitution preserves cluster-useful signal: "Soup.net maintainer" → "MCP server maintainer", not just "maintainer"). Setup section gained a claude.ai web row pointing at the web-only fallback for now.
- `7c90158` Public `/info/claude-connector` docs page rendering `docs/connectors/claude.md`. Same `?raw`-import pattern as PrivacyPage/TermsPage. Three example prompts mapped to the canonical `checking_modes` from `recipe-examples.json` (broad_discovery, judgment_with_reasoning, logging_stated_preference). Privacy policy §7 dropped the "self-serve deletion is on the build-out checklist" promise so the live text matched reality at the time.
- `7a3e57c` Root `npm run db:generate` script delegating to the workspace's existing chained script (drizzle-kit + data-model docs regen). Eliminates the cwd-trap that broke a previous gate run (cd into `packages/db` for migration, then `npm run test:ci` from there → "Missing script: test:ci"). Incidentally caught `docs/architecture/data-model-generated.md` was last regenerated against migration 0007 — bumped to 0019 (13 migrations of drift).
- `a46636c` OAuth 2.1 DB schema. New tables `oauth_clients` and `oauth_authorization_codes`; three new columns on `api_keys` (refresh_token_hash, refresh_token_expires_at, oauth_client_id). Access tokens reuse the existing `api_keys` row with `key_type='oauth'` — OAuth is an issuance flow, not a parallel auth population. Refresh tokens live on the same row so rotation is a single INSERT + UPDATE.
- `d9c15e1` Metadata endpoints (`/.well-known/oauth-authorization-server` per RFC 8414, `/.well-known/oauth-protected-resource` per RFC 9728) + Dynamic Client Registration at `POST /oauth/register` per RFC 7591. Redirect URI validation: https only with http://localhost permitted for dev. Test infra: `test-ci-local.mjs` now sets `BACKEND_URL` on the spawned backend so absolute-URL renders (briefing, metadata, etc.) match the test BASE.
- `c5dc4d2` The middle of the flow: `POST /oauth/authorize/grant` (JWT-authed, mints the code given client+redirect+PKCE+chosen-scope) and `POST /oauth/token` (client-authed via client_secret_post or client_secret_basic, handles both authorization_code with PKCE verify and refresh_token with rotation). Server-rendered consent screen via the SPA at `/oauth/authorize` — fetches client info + recipe books, renders a read/write/default-write picker, POSTs to grant, navigates to the returned redirect_url. Authorization endpoint moved to `FRONTEND_URL` in the AS metadata since the consent UX is a SPA page. 14 new end-to-end flow tests including happy path with refresh rotation invalidating both old access AND refresh tokens, every rejection path that matters (wrong code_verifier, code reuse, redirect_uri mismatch at /token, wrong client_secret, unregistered redirect_uri at grant, unsupported response_type, unsupported code_challenge_method, scope default-write outside write set, unauthenticated grant, unsupported grant_type), and `client_secret_basic` auth.
- `f9a35d5` Tool annotations on all six MCP tool registrations (4 in remote MCP, 2 in stdio MCP) — `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`/`title`. Required for directory submission (missing annotations is the #1 rejection reason per Anthropic's checklist). Origin-header validation middleware on `/mcp/*` per the MCP transport spec — allowlists claude.ai, claude.com, FRONTEND_URL, BACKEND_URL, and localhost variants; absent Origin (server-to-server calls) passes through. Self-hosters can extend with `MCP_ALLOWED_ORIGINS`.
- `9c231ca` Self-serve account deletion (`DELETE /auth/me`). Password confirmation required. Transactional cascade in dependency order. Owned-shared-orgs guard: if the user owns a non-personal org with other members, 409s asking for ownership transfer first. Privacy policy §7 flipped from manual-only to self-serve, with the email channel retained as fallback. Settings → Account gains the matching UI.

Net: 239 → 277 tests (+38 across OAuth flow, Origin validation, deletion paths). All eight commits passed the canonical `npm run test:ci` gate. Open follow-ups (rate limits on remaining OAuth endpoints, consent-screen styling, ownership-transfer UI, directory submission's non-code prep) live in the new top-level sections of `backlog.md`.

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
