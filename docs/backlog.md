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
