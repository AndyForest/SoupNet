# Backlog — completed

Items moved here from `backlog.md` when finished. Date-stamped so we can see what landed when. Strike-through (`~~text~~`) for sub-items completed within a still-open parent item.

---

## Legal and compliance

### 2026-05-09 — Privacy policy + terms of service live pages

Replaced the placeholder `/info/privacy` and `/info/terms` pages with refined content rendered from `docs/legal/privacy-policy.md` and `docs/legal/terms-of-service.md` (single source of truth). Trusted-tier banner present on both pages flagging which sections still need lawyer review for public launch. Cookie/localStorage notice added (one-time dismissable bottom banner). Marketing footer links to legal pages added on `LandingPage` and `HowItWorksPage`. LICENSE addendum added covering Soup.net name, logo, and visual design as reserved trademarks excluded from the MIT grant.

Deferred from this work (now tracked in `backlog.md`):
- Self-serve `DELETE /auth/me` endpoint (privacy policy currently routes to `privacy@soup.net`).
- Verify three Privacy Policy claims (S3 lifecycle, CSP, RDS backup retention).
- Public-launch lawyer review checklist.
