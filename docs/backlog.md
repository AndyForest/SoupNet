# Backlog

The shared backlog for Soup.net. Tracks pending work across multiple AI agent sessions per the workflow described in `CLAUDE.md`.

**Tags:**
- `[IMPL]` — implementation work, well-defined
- `[DESIGN]` — needs design thinking before implementation
- `[DECISION NEEDED]` — needs an explicit operator decision

When you complete an item, move it to `backlog-completed.md` with a date stamp. Strike-through (`~~text~~`) sub-items as you finish them.

---

## Recipe-check response format

### `[DESIGN]` Markdown response option for web `/check` page, encapsulated in backticks

Today the `/check` web page renders the recipe-check result as JSON for the human to copy back to their AI agent. Two observations from the 2026-05-27 InData demo to four AI-first developers (and earlier from a non-technical user via Andy):

1. JSON is alienating *even for technical users*. They felt friction at the "copy this JSON blob" step. Surprising — we'd assumed JSON was friendly for developers, scary only for the non-technical case the citation-link concept was meant to solve.
2. The briefing page already encourages copy-paste of fenced content into chat UIs, because the chat then visually treats the pasted block as an "attachment" rather than inline text — looks cleaner, the agent treats it more like a structured payload.

Proposed: in addition to (or instead of) raw JSON, render the recipe-check result as **markdown wrapped in triple backticks**. Same information, but:
- The human can read it themselves on the way back to the agent — transparency, less alienation
- Pasted into chat, the fenced block renders as a clean attachment-like card
- Encourages agents to treat it the same way they treat the pasted briefing

This is adjacent to but distinct from the **citation-link** proposal in `docs/design-thinking.md` §"Citation Links for Non-Technical Copy-Back" — citation link is the eventual ideal (paste one short URL, agent fetches it); markdown response is the smaller-step improvement that helps both technical and non-technical users immediately.

Design questions:
- Does the existing `format=json` path stay as-is, with markdown as a new `format=markdown` (or just the default for the HTML view)?
- Should the MCP `check_recipe` tool also gain a markdown response shape, or stay structured? (Probably stay structured — MCP agents parse it directly.)
- What's the markdown shape? Likely: a header per result with the recipe text, evidence interpretation as paragraph, references as block quotes with citations. Mirror the briefing's exemplar formatting.

---

## Evidence ingestion

### `[DESIGN]` Support multiple references per one interpretation in `parseEvidenceMarkdown`

`parseEvidenceMarkdown` (`apps/backend/src/services/evidence-parser.ts`) and its `EvidenceEntry` shape carry a single `quote`/`source` per entry, and `insertEvidenceEntries` creates exactly one reference per entry — even though the DB model (`evidence_references` N:N) already supports many references per evidence. The 2026-05-31 folding fix (orphaned citation block folds back into the preceding interpretation) handles the dominant case — one interpretation, one quote — but when an author writes one interpretation followed by *two* `> quote` / `-- source` blocks, only the first folds in; the second stays a standalone "(no interpretation)" entry rather than attaching as a second reference to the same interpretation. To fully support it, `EvidenceEntry` would need a `references[]` array and the insert path would create N reference rows + N `evidence_references` links per entry. Deferred as a smaller graceful-degradation case; the conservative fold preserves the reference (no data loss) rather than dropping or clobbering it.

### `[IMPL]` Repair historical fragmented-evidence traces

Traces checked before the 2026-05-31 folding fix that hit the blank-line-fragmentation bug are stored as separate interpretation-only and `(no interpretation)` citation rows (e.g. trace `a2c8fb64-d0bd-4d65-9248-4a4a8c727650`). The parser fix is forward-only — it doesn't touch already-stored rows. A one-off data migration could re-fold these: find evidence rows with content `(no interpretation)` that are linked to a reference and adjacent (same trace, same `created_at`) to an interpretation-only evidence row with no reference, then merge. Low priority — cosmetic on the trace-detail page, no functional impact. Scope first: query how many traces are actually affected before writing the migration.

---

## Agent briefing

### `[IMPL]` Briefing regression testing — behavioral specs (design done; build phases 1–2)

Design doc (rough-notes fidelity until promoted): [docs/rough-notes/2026-06-10/briefing-regression-testing.md](rough-notes/2026-06-10/briefing-regression-testing.md) (2026-06-10; expanded same day per operator feedback). Gherkin-style behavioral specs (Given persona / When trigger / Then observable assertions), LLM-judge scoring, and a declared-intent regression rule: briefing-touching PRs state which scenarios they mean to move and show all others holding — the guard against the over-correction pattern. Builds on `recipe-examples.json` failure modes, `scripts/qa-agent-understanding.ts`, and the agent archetypes as personas. The 2026-06-10 expansion added: **scenario-corpus expansion** (coverage matrix over human/agent archetypes × domains × both-sides-of-success; mining the operator's real recipe books PII-scrubbed with an operator interview loop — operator approved); **Track 2 wired to the existing multi-strategy embedding pipeline** (`packages/domain/src/embedding-strategies.ts` — per-strategy matched-pair scoring of both authoring hypotheses and the `exp_*` preamble variants, with graduation into the search path as a deliverable); **Track 3 whole-transcript analysis** (fixed best-practice rubric spine + LLM-generated per-transcript extension; client-side only for privacy); and a paste-ready [transcript-mining briefing](rough-notes/2026-06-10/transcript-mining-briefing.md) for live Claude Code sessions. Phases 1 (encode `.feature` files) and 2 (scenario corpus) are pure writing and immediately useful.

### `[DESIGN]` Agent-first knowledge base + agent-suggested improvements (idea stage)

Operator direction (2026-06-10), captured in [docs/rough-notes/2026-06-10/agent-first-knowledge-base.md](rough-notes/2026-06-10/agent-first-knowledge-base.md): Track-2 retrieval findings distill into a knowledge base of authoring nuances; KB entries are agent-first (Gherkin + recipe format); the briefing injects the few entries semantically nearest the user's recipe books (existing similarity subsystems — zero server LLM); and end users' AI agents suggest KB entries / system improvements via **synthetic demonstrations** so human developers never look at end-user data. Security note from the rough pass: published KB entries are instructions inside other users' briefings — community suggestions are a prompt-injection vector by construction and need a human review gate plus the security workflow before any design lands.

### `[IMPL]` Reasoning-window emphasis pass on briefing + tool descriptions — AFTER regression phase 1

design-thinking.md §The Reasoning-Trace Gap (2026-06-10): reasoning models discard hidden deliberation after each turn, so the judgment-call moment is the only checking moment inside the reasoning window — checks deferred to session end lose the warrant. Audit briefing copy + `check_recipe` tool descriptions for anything that makes mid-work checking feel heavyweight, and weight the "facing a judgment call" moment accordingly. Deliberately sequenced after the regression harness exists, so this edit is the first one made under the declared-intent rule rather than another over-correction.

### `[IMPL]` Flag drift between briefing voice rules and `bootstrap-your-corpus.md`

`apps/backend/public/docs/bootstrap-your-corpus.md` restates voice/format guidance in compressed form ("recipes are written in MY voice with a transferable role, not yours and not my name, and not duplicating context the group description already provides"). When the canonical `ROLE_PATTERNS` in `packages/domain/src/recipe-guide-content.ts` changes, this restatement can drift silently. Either (a) refactor bootstrap to import the canonical guidance, (b) shorten it to a one-line pointer at the canonical text, or (c) add a comment on `ROLE_PATTERNS` reminding maintainers to grep bootstrap-your-corpus.md after edits.

---

## Legal and compliance

### `[IMPL]` Change-notification mechanism

The privacy policy and ToS both promise "we will notify you by reasonable means before the change takes effect" for material changes. No actual notification feature is built yet. Pick a mechanism (in-app banner on next sign-in, dashboard message, email blast via SES, or some combination) and implement it before relying on the promise.

Implementation sketch (in-app banner option):
- New table `system_announcements` (id, body, starts_at, ends_at, dismiss_token).
- Settings record per user tracking dismissed announcement IDs.
- AppShell mounts an `<AnnouncementBanner />` if there are active announcements not dismissed by the current user.
- Admin route to publish a new announcement.

### `[DECISION NEEDED]` Counsel review pre-public-scaling

Items to put in front of a Canadian lawyer before signups grow materially. None of these are surfaced in the live policy text any more — the policy reads as confident public content — but they remain on the operator's checklist:

- PIPEDA compliance pass.
- GDPR / UK GDPR exposure assessment given worldwide user reach (including Article 27 representative question).
- CCPA / CPRA applicability assessment.
- Bespoke AWS and Google Cloud DPAs (currently relying on each provider's standard customer agreements).
- ToS Section 10 (limitation of liability) under Ontario law.
- ToS Section 11 (indemnification) enforceability and scope.
- ToS Section 13 (governing law) and consumer-protection carve-outs (Quebec, EU consumer rights).
- Whether listing a postal mail address is jurisdictionally required.
- Whether to operate Soup.net under Andy personally vs Dimentians Ltd vs Steamlabs (income/liability tradeoffs). The current policy says "operated by Andy Forest, based in Canada" — deliberately silent on legal form so this choice stays open.

### `[IMPL]` Verify privacy policy claims match implementation

The privacy policy describes a few behaviors qualitatively that should still match reality. Confirm or update implementation. Partial findings from the 2026-06-11 production-readiness pass (post-SES-approval):

- Section 2.3 / 8: uploaded files cached for a "limited period" then deleted. **MISMATCH confirmed** — `packages/db/src/schema/uploads.ts` documents "Retention: no TTL column today"; bytes are content-addressed on disk via `file-store.ts` with no sweep. Files are deleted on account deletion only. Either build the retention sweep the schema comment sketches (expired api_key_id + content_hash unreferenced by any references row), or soften the policy wording.
- Section 2.5 / 8: audit-log entries (incl. IP + user agent) "retained for a limited period, then deleted." **MISMATCH confirmed** — no `DELETE FROM claimnet.audit_log` exists anywhere; the table is append-only with no retention job. Same choice: build the sweep or fix the wording. Note F29 per-key rate limiting counts on audit_log, so a sweep must keep ≥24h.
- Section 9: content security policy + rate limiting **verified in-repo** (headers in `apps/backend/src/index.ts`, `middleware/rate-limit.ts`). Encryption at rest + private-subnet database: infra-side, verify on the production stack (operator).
- Section 6: AWS regions in the United States. Verify the live deployment matches (operator).

---

## Launch readiness

### `[DESIGN]` Concierge chatbot + setup wizard for the new-user journey

Operator idea (2026-06-10): the dashboard is crowded for a new user, and Soup.net's whole thesis is zero-effort — so the new-user journey should feel like a chatbot, not a console. A very light in-browser concierge (candidate tech: Chrome 148's Prompt API / built-in Gemini Nano — free, no server LLM cost, consistent with the cheap-math architecture) that does everything essential conversationally. It could open with a **"here's your briefing for all your agents" button before the user says anything** — the "you're already done" moment — then offer optional help: add context about what you're working on, set up recipe books, invite people. A non-LLM setup wizard is the fallback shape if the Prompt API's availability/quality disappoints (it's Chrome-only and new). Relates to "Onboarding polish for first session" below — this may be the form that polish takes.

### `[DESIGN]` Side-nav regrouping (rule of 7) + landing reachability

The signed-in nav has 8 top-level items (9 with Admin). Operator direction (2026-06-10): apply the rule of 7 — group the explainer pages (How it works, Connect to AI — plus the landing page itself and the footer's Privacy/Terms) into a single "About"/"Learn" group so the whole tree is in the nav, including footer-only pages. Admin stays an 8th top-level for the few who see it. Related finding: typing soup.net and landing on the login page is **not a routing bug** — `/` always renders the landing page (routeTree.ts, index route has no guard); it's browser-history autocomplete plus the 401-expired-JWT redirect. But it surfaced a real gap: signed-in users have no obvious nav path to the landing page except the logo. The regrouping fixes that by making the landing page a nav item inside the new group.

### `[IMPL]` Landing composition Option A — decided 2026-06-10; ship as art arrives

Decision (operator, 2026-06-10): **Option A** from [docs/rough-notes/2026-06-10/landing-page-content-options.md](rough-notes/2026-06-10/landing-page-content-options.md), plus: the challenge section's static check-log mock is **rejected** (too technical for humans as the first thing) — an illustration replaces it. Implementation sequence:

1. **When Brief 1 v2 art arrives** ([image-brief-1-v2](rough-notes/2026-06-10/image-brief-1-v2-judgment-hub.md), "the judgment hub" — v1's "unattended hours" art was delivered as `illustration-agent-alone.png` but not used: no human in frame, and the away-while-it-works premise dates as agents compress wall-clock time; kept as palette reference): replace `CheckLogMock` in the challenge section with the new illustration + caption "Three threads of work — and one place your judgment lives: you."
2. ~~Move Pillar 2's image to `illustration-shared-book.png` (the resolved-puzzle composition); Step "+" goes text-only until Brief 3 art arrives. Fix Pillar 2's alt text either way.~~ Done 2026-06-10 — Pillar 2 now carries shared-book with corrected alt + positive caption; Step "+" is text-only.
3. **When Brief 2 art arrives** ([image-brief-2](rough-notes/2026-06-10/image-brief-2-one-constellation-every-device.md), "one constellation, every device" — written 2026-06-10, deliberate resolution-pair of the judgment-hub image): swap it into Pillar 1 with caption "One recipe book — every agent you use draws from it, whatever tool it lives in."; retire the robot image (`illustration-blank-slate.png` leaves the page).
4. **When Brief 3 art arrives** (Step "+", AI-maturity variant — brief not yet written): restore the "+" panel illustration.
5. ~~Same pass: CTA/copy touch-ups — compounding agency line (recipe `90f87ce6`).~~ Done 2026-06-10 — CTA heading is now "Your judgment is what makes your agents good. Use it — productivity and agency rise together."; challenge copy carries the scarce-resource unifier (`893660af`) and compression-durable METR framing (`ed6f17f3`). "This happened to you?" hooks remain optional/unused.

Sub-item 1 also done 2026-06-10: `illustration-judgement-hub.png` shipped into the challenge section with the planned caption; the `CheckLogMock` component was removed.

Visual grammar rules now in the corpus for all future art: bowl = solution-only motif (`d9f8142e`), warm recognition not fear (`a08dfaa8`), glowing figure is the canonical agent rendering (`2e7ee32c`).

### `[DESIGN]` Onboarding polish for first session

Carried over from the controlled-invite-first sequencing decision (2026-04-09). Polish the first 30 seconds of a new user's experience: invitation email body, post-verify dashboard state, recipe-check first-success.

### `[DESIGN]` Clean up the HowItWorks page after landing-page expansion

The landing page now carries a substantial "How a recipe check works" walkthrough section (three steps, expandable Q&A, three solution illustrations) that overlaps with several sections of `/info/how-it-works`. Likely-stale or duplicated areas on the HowItWorks page:

- "How agents connect" (three-row MCP / Web chatbots / Custom split) — partially echoed by the walkthrough's Step 1 expanders.
- "A self-organizing knowledge graph" + recipe-format depth — adjacent to the walkthrough's "What's actually in the briefing?" and "How does the agent phrase a recipe check?" answers.
- The page's intro framing — written before the landing page absorbed any walkthrough content; the landing page's new section may have stolen the deep-version's narrative lead.

Goals for the cleanup pass: cut what's duplicated, sharpen what HowItWorks uniquely covers (Recipe Map / concept-axis projection / "How we keep it free at scale" / "Built to trust" / algorithms-and-research-lineage), and make the page feel like the *deeper* version of what the landing page now teaches — not a competing teach. Also verify nothing on HowItWorks contradicts the landing-page framing (cross-vendor moat, Archetype 5, vendor-memory distinction, "taste and judgment" always paired, no "team"-as-framing where the broader collaborator unit is meant).

---

## Directory submission (Anthropic connectors directory)

Foundation shipped 2026-05-14 (`a46636c`–`9c231ca`): OAuth 2.1 schema + metadata + DCR + authorize/grant + token/refresh + consent screen + MCP tool annotations + Origin-header validation + self-serve deletion. The non-code prep below is what remains before submitting.

### `[IMPL]` Manual end-to-end test against real claude.ai

Add Soup.net at `https://mcp.soup.net/mcp` via claude.ai's **Settings → Connectors → Add custom connector** against the deployed stack. Walk the full flow: OAuth redirect to `/oauth/authorize`, sign in, recipe-book scope picker, authorize, bounce back to claude.ai. Then exercise each of the three tools in a conversation. Expected to "just work" given the integration-test coverage, but real claude.ai may surface UX quirks (text wrapping in the consent screen, claude.ai's annotation display, refresh-on-stale-token behavior) that the test suite can't catch.

### `[IMPL]` Connector branding assets

- ~~Square logo on transparent background~~ — `apps/frontend/src/assets/soupnet-logo-square.png` (1322×1322, transparent). The wordmark is small relative to the canvas at directory-listing sizes (~64–128px). Consider a tighter icon-only mark for small displays before submission.
- Favicon already exists (`apps/frontend/src/assets/favicon-192x192.png`); verify it renders cleanly in browser tab + bookmark previews.
- For an MCP App listing with carousel screenshots (3–5 PNGs, ≥1000px wide, app response only with prompt text): `npm run screenshot` already captures `/info/connect` and the user-dashboard routes. Run against a populated dev stack, crop to the carousel template, choose the 3–5 that best tell the connector story.

### `[IMPL]` Submit to the connectors directory

Fill out the form at `claude.com/docs/connectors/building/submission` once branding is finalized:
- Privacy policy URL: `https://www.soup.net/info/privacy` ✓
- Public documentation URL: `https://www.soup.net/info/connect` ✓ (multi-client; Claude listed first for directory review. `/info/claude-connector` 308-redirects here.)
- Test account with sample data: provision a `directory-review@soup.net` account with 3-5 example recipes spread across one personal book.
- Logo, favicon, screenshots (see above).
- Tool annotations (already shipped — `f9a35d5`).

Common rejection reasons to double-check before submitting: missing tool annotations (30% of rejections), OAuth callback URL allowlist missing `claude.com` variant, incomplete privacy policy, server still in beta.

---

## OAuth follow-ups

### `[IMPL]` Rate-limit `/oauth/token` and `/oauth/authorize/grant`

`POST /oauth/register` is rate-limited (30/hour per IP via `registerRateLimit`). `/oauth/token` and `/oauth/authorize/grant` are not. The downstream guards already require a valid `client_secret` or JWT respectively, so the practical exposure is small, but consistent rate limits across the OAuth surface make the surface easier to reason about and harden in case any of the upstream guards weaken.

### `[DESIGN]` Consent-screen design-system polish

`OAuthAuthorizePage.tsx` currently uses inline styles (matching the LegalPage pattern). It's functional but doesn't feel like the rest of the app — borrowed from the agent-facing pages rather than the dashboard's visual language. Replace inline styles with the design-system tokens used by `ApiKeysPage` (the table layout there is the closest sibling).

### `[IMPL]` Ownership transfer for shared organizations

`DELETE /auth/me` 409s if the user owns a non-personal organization with other members (`owned_shared_orgs_exist`). There's currently no in-app way to transfer ownership — the user has to email admin for help. Add a transfer-ownership UI on the recipe-book page so owners can hand off to another admin/member before deleting. Until this ships, the deletion guard's error message points to admin-assisted transfer.

---

## How to use this file

1. Before starting work: scan for items in your area. Look for context, dependencies, conflicting in-flight work.
2. After completing work: cut the item from this file; paste into `backlog-completed.md` with date stamp; strike sub-items if a multi-part item is partially done.
3. New work discovered: add to the relevant section here with the right tag. If you don't know the section, add it under "Unsorted" at the bottom.

This file is the way concurrent AI sessions coordinate without explicit messaging.

---

## Decision archaeology follow-ups

### `[IMPL]` Surface `decided_at` beyond the trace detail page

`decided_at` shipped 2026-06-10 (column, `/check` + MCP param, coalesced judgment date in search results, trace-detail "Decided … · logged …" display). Remaining surfaces that still show only `created_at` and may want the judgment date: the traces list pages (`/app/traces`, recipe-book traces), the Recipe Map tooltips, and briefing exemplars. Low urgency — agents already see the coalesced date in check results, which is the surface that matters for alignment.

### `[DESIGN]` Temporal decay should decay from the judgment date

When stigmergic decay lands (search-algorithms.md §Stigmergic Decay), weight recipes by `COALESCE(decided_at, created_at)`, not raw `created_at`, so backfilled decisions (decision archaeology, design-thinking.md) decay as old judgments rather than fresh ones. Noted here so the decay implementation doesn't have to rediscover it.

---

## Eval + transcript-mining findings (2026-06-10)

Source detail: `docs/rough-notes/2026-06-10/scenario-mining-batch-1.md` (7 scenario candidates + 22-question operator interview batch, awaiting answers), the two `transcript-mining-report-*.md` files (self-audits from live sessions), and the SoupNet-evals ground-truth run record.

### `[DECISION NEEDED]` `/check` `filter` param is documented but not implemented

CLAUDE.md, `mcp.ts` (~line 793), and design-thinking.md all point agents at a `filter` (alias `f`) query param on `/check` as the sanctioned non-logging alternative to check-as-search — but `CHECK_PARAMS` doesn't implement it. Decide: implement `filter` on `/check`, or repoint the docs at the working read path (`GET /briefing?filter=...`). Until decided, the documented escape hatch doesn't exist, which pushes agents toward the cardinal anti-pattern.

### `[IMPL]` Missing case-study file referenced by design-thinking.md

`docs/case-studies/chatgpt-divergent-design-checks.md` is linked from design-thinking.md §Divergent Recipe Checks but doesn't exist. Recover from the original transcript if it survives (it's the divergent-checks origin story — prime scenario source material), or fix the link.

### `[IMPL]` Evidence stored with `%97` encoding artifact

Ground-truth run logged evidence containing `%97` where an em-dash belongs (windows-1252-style percent-encoding artifact) via a GET `/check` submission. Find whether the decode bug is client-side guidance or server-side parsing; add a test with non-ASCII evidence through the GET path.

### `[IMPL]` `/briefing` returns `exemplarCount: 0` for a book with one fresh trace

Observed seconds after a successful check with sync embedding enabled. Exemplar selection may require k>1 traces or an async pipeline step. Investigate; a briefing that omits a book's only recipe undercuts the copy-paste priming flow for new/small books.

### `[IMPL]` Expired/invalid API key error should carry remediation

`get_briefing` on a dead key returns just "Invalid or expired API key" — a live session then accumulated hours of silent check debt (transcript report, landing-page session). Errors are agent-facing copy: include remediation ("mint a new key at /app/keys; the web `/check?format=json` path accepts the new key without an MCP reconnect"). The companion briefing/KB "check-debt ledger" protocol belongs to the reasoning-window emphasis pass above.

### `[IMPL]` Decision archaeology pass on our own design docs

The check-log-mock rejection (landing session) was predicted verbatim by documentation prose (the "JSON is technical and scary" quote) that no check could retrieve because it was never a recipe. Run archaeology over design-thinking.md + backlog-completed with `decided_at`, so the project's own design lessons become retrievable.

---

## Unsorted

### `[IMPL]` Fresh security audit (last general audit 2026-04-09; surface has grown)

~~Security audit documents missing from the repo~~ — resolved 2026-06-11: the audits live in the **private deployment repo's** `docs/security/` (confirmed by the observability survey). CLAUDE.md and `docs/workflows/security.md` now say so. Remaining work: the last general audit was 2026-04-09 and the route surface has grown substantially since (OAuth 2.1, /uploads, remote MCP, waitlist, email log, invite-status) — now that production is live behind real SES, run a fresh audit-agent scan. The operator runs this after the 2026-06-11 batch is committed, before push.

### `[IMPL]` SES configuration-set header support

When the private infra repo creates the SES configuration set for bounce/complaint event capture (its ops-hardening Task 7), add `X-SES-CONFIGURATION-SET` header support to the nodemailer transport in `email.service.ts`, driven by an env var (e.g. `SES_CONFIGURATION_SET`, unset locally). Two-line change; blocked on infra side choosing the set name. See docs/rough-notes/2026-06-11/observability-briefing-private-infra.md.

### `[IMPL]` Admin side-nav missing on most admin pages

Found 2026-06-11 while investigating "the settings page isn't in the admin nav": `AdminLayout` (the side nav with Overview / Users / Signups / Emails / Queues / Embeddings) is only rendered by AdminUsersPage, AdminSignupsPage, and AdminEmailsPage. The Overview, Queues, and Embeddings pages use their own ad-hoc layouts with no side nav — so part of the admin console is only reachable from the Overview landing page's links. Wrap the remaining three pages in `AdminLayout` (Queues has its own inspector pane — AdminLayout already supports an `inspector` prop), and adopt the shared list-view primitives while in there: `useAdminGate` (access gate, replaces each page's hand-rolled meQuery + denied JSX) and `AdminPagination`, alongside the existing `AdminFilterBar`/`AdminTable`/`AdminMetricCard` pieces. The design intent (per the admin-pages recipe + engineering-principles §12): admin pages stay thin compositions of these primitives — shared design language without a mega list-view component, since each page's middle section differs (metric cards, inspector panes, explainers). Related: `GET /admin/invitations` no longer has a frontend consumer (the merged `/admin/waitlist` signup queue supersedes it); keep or fold into the queue view when touching this area.

### `[IMPL]` Audit-log event coverage beyond recipe.checked (F9 follow-up)

`claimnet.audit_log` only records `recipe.checked`. The F9 finding (2026-04-09 audit) calls for auth events (login success/fail, register, verify), API-key lifecycle (create/revoke), and admin actions (settings changes, invites, waitlist notify). Now that the email log covers the outbound-email surface (2026-06-11), audit_log is the remaining gap for security sweeps. Design note: keep writes through `writeAudit`, one event type per action, and mind that F29 per-key rate limiting queries this table — schema changes must keep that path fast.

### `[IMPL]` Waitlist: notify when a spot opens

The waitlist form promises "we'll email you when a spot opens up." Today that promise is fulfilled manually: the admin Settings page's per-row Invite button sends a cap-bypass invitation email via SES. Fine at cap≈5–50; if the waitlist grows past what manual triage handles, add batch-invite (top N oldest) and/or an automatic "spot opened" notification when the cap rises.

### `[IMPL]` Delete or revive `packages/client-sdk`

Discovered 2026-05-27 while drafting the workspace package map in `docs/architecture/overview.md`. `packages/client-sdk` is listed as a dependency by `apps/frontend` and `apps/mcp-server` but no source file outside its own internals imports `@soupnet/client-sdk`. The surface area still references pre-pivot endpoints (`/api/claims`, `/api/requests`, `/api/validations`) that the current Hono backend doesn't serve.

Two options:
- Delete the package and remove the two dead dependency declarations. Cleanest; matches "ruthless edits to docs that have drifted from reality" applied to code.
- Rewrite the SDK against the current `/check` / `/traces` / `/uploads` surface and actually consume it from one of the apps. Only worth it if there's a planned third consumer (e.g. a future CLI tool) that benefits from a typed REST wrapper distinct from the React Query hooks.

Recommendation: delete, on the principle that infrastructure without a consumer is a maintenance tax with no return.

### `[IMPL]` Wire `packages/api-client` into the frontend (or note it's deferred)

Discovered 2026-05-27 alongside the `client-sdk` finding. The Orval pipeline produces typed React Query hooks from the committed `openapi.json`, but no file in `apps/frontend/src/` imports `@soupnet/api-client`. The SPA fetches via hand-written hooks (`src/hooks/useTraces.ts` etc.) wrapping `authFetch`, with response types declared inline per hook.

The blocker is the contracts-consolidation work — until `/check`, `/traces`, `/uploads`, `/auth` are in `packages/contracts`, the generated client only describes the pre-pivot legacy surface, which isn't what the SPA calls. So sequencing is:

1. Consolidate new routes into `packages/contracts` (already noted in `docs/backlog.md` and in `type-safety.md` §"Where the chain is intentionally loose" #3).
2. Regenerate `openapi.json` + the Orval hooks.
3. Migrate `apps/frontend/src/hooks/*.ts` to import the generated hooks, deleting hand-written shapes (`interface Trace`, etc.).

Until step 3 ships, the headline claim in `docs/architecture/type-safety.md` ("type errors at one end of the stack surface at the other") is only true up to the package boundary on the frontend side. The doc is now honest about this; closing the gap is the work.
