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

## Agent briefing

### `[DESIGN]` Regression-test system for briefing tweaks

The agent briefing is shipped to every agent session and is highly sensitive to wording changes — but there's no automated coverage. Today the canonical pre-commit gate (`npm run test:ci`) asserts route shape and auth on `/briefing` and `/keys/briefing` but nothing about the rendered text. The fallback is manual testing on every supported agent (Claude Code, Claude Desktop, Codex, Antigravity, claude.ai web, Gemini, ChatGPT) which is slow and easy to skip.

Design questions:
- What does "regression" mean for a briefing? Snapshot diff catches every wording change including intended ones — too noisy. Probably want something like a behavior eval: pre-canned test prompts run through each agent, structured score on whether the agent (a) calls `get_briefing` early, (b) picks the right recipe-book on a check, (c) writes recipe voice correctly, (d) chooses clickable vs plaintext-fenced URL format for its identity, (e) doesn't try to fetch URLs in web-only mode.
- Where do test prompts live? `scripts/qa-agent-understanding.ts` already exists — extend or rewrite?
- How do we run agents headlessly? Anthropic API + Codex CLI in batch mode are tractable; Gemini and ChatGPT web are harder.

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

The privacy policy describes a few behaviors qualitatively that should still match reality. Confirm or update implementation:

- Section 2.3: uploaded files cached for a "limited period" then deleted. Confirm the cleanup mechanism (S3 lifecycle rule vs. cleanup job) actually runs.
- Section 9: "industry-standard security practices" including content security policy, rate limiting, encryption at rest, private-subnet database. Verify each on the production stack.
- Section 6: AWS regions in the United States. Verify the live deployment matches.

---

## Launch readiness

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

## Unsorted

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
