# Backlog

The shared backlog for Soup.net. Tracks pending work across multiple AI agent sessions per the workflow described in `CLAUDE.md`.

**Tags:**
- `[IMPL]` — implementation work, well-defined
- `[DESIGN]` — needs design thinking before implementation
- `[DECISION NEEDED]` — needs an explicit operator decision

When you complete an item, move it to `backlog-completed.md` with a date stamp. Strike-through (`~~text~~`) sub-items as you finish them.

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

---

## Directory submission (Anthropic connectors directory)

Foundation shipped 2026-05-14 (`a46636c`–`9c231ca`): OAuth 2.1 schema + metadata + DCR + authorize/grant + token/refresh + consent screen + MCP tool annotations + Origin-header validation + self-serve deletion. The non-code prep below is what remains before submitting.

### `[IMPL]` Manual end-to-end test against real claude.ai

Add Soup.net at `https://mcp.soup.net/mcp` via claude.ai's **Settings → Connectors → Add custom connector** against the deployed stack. Walk the full flow: OAuth redirect to `/oauth/authorize`, sign in, recipe-book scope picker, authorize, bounce back to claude.ai. Then exercise each of the three tools in a conversation. Expected to "just work" given the integration-test coverage, but real claude.ai may surface UX quirks (text wrapping in the consent screen, claude.ai's annotation display, refresh-on-stale-token behavior) that the test suite can't catch.

### `[IMPL]` Connector branding assets

- ~~Square logo on transparent background~~ — `apps/frontend/src/assets/soupnet-logo-square.png` (1322×1322, transparent). The wordmark is small relative to the canvas at directory-listing sizes (~64–128px). Consider a tighter icon-only mark for small displays before submission.
- Favicon already exists (`apps/frontend/src/assets/favicon-192x192.png`); verify it renders cleanly in browser tab + bookmark previews.
- For an MCP App listing with carousel screenshots (3–5 PNGs, ≥1000px wide, app response only with prompt text): `npm run screenshot` already captures `/info/claude-connector` and the user-dashboard routes. Run against a populated dev stack, crop to the carousel template, choose the 3–5 that best tell the connector story.

### `[IMPL]` Submit to the connectors directory

Fill out the form at `claude.com/docs/connectors/building/submission` once branding is finalized:
- Privacy policy URL: `https://www.soup.net/info/privacy` ✓
- Public documentation URL: `https://www.soup.net/info/claude-connector` ✓
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
