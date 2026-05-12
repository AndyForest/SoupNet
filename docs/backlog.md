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

Build `DELETE /auth/me` so the privacy policy can drop the "email admin@soup.net" workaround.

- Cascade-delete: `traces`, `evidence`, `references`, `trace_evidence`, `trace_references`, `evidence_references` rows owned by the user; `group_members` rows; `api_keys`; `embedding_vectors` keyed to the user's traces; `users` row.
- Preserve: `vector_cache` (content-hash keyed, no identifier link). `audit_log` entries (append-only; user-attributable rows can be redacted to `<deleted-user>` while preserving the security trail).
- Confirmation flow on the Settings page (modal: type "DELETE my account" to confirm).
- Once shipped: update `docs/legal/privacy-policy.md` Section 7 and `docs/legal/terms-of-service.md` Section 9 to drop the manual email path.
- Layer 3 integration test: register → check recipe → delete account → verify all owned rows gone, vector_cache rows present, audit_log redacted.

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

## How to use this file

1. Before starting work: scan for items in your area. Look for context, dependencies, conflicting in-flight work.
2. After completing work: cut the item from this file; paste into `backlog-completed.md` with date stamp; strike sub-items if a multi-part item is partially done.
3. New work discovered: add to the relevant section here with the right tag. If you don't know the section, add it under "Unsorted" at the bottom.

This file is the way concurrent AI sessions coordinate without explicit messaging.

---

## Unsorted
