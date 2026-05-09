# Trusted Tier Disclaimer

**Status:** First draft (2026-04-09). Intended for the controlled-invite phase before the full public launch. Lighter-weight than the full Privacy Policy + ToS, designed to set expectations for the first ~10 invited testers.

**To be displayed:** As a one-screen acknowledgment on the registration page (with checkbox), and as a short paragraph in the invitation email.

---

## Short version (for the invitation email and registration page)

> **Soup.net is in pre-launch trusted-tester mode.**
>
> You've been invited as one of the first ~10 testers. The system is functional but actively under development. By using Soup.net during this period, you understand and agree to the following:
>
> - **Things may break.** Bugs are expected. If something doesn't work, please tell us — that's the whole point of this phase.
> - **Don't put anything sensitive here.** Treat Soup.net like a public sketchpad. Don't upload customer data, secrets, personal health information, financial records, or anything you'd be uncomfortable seeing in a screenshot.
> - **Your data may be deleted as part of normal development.** We try not to, but we won't promise zero data loss until the full public launch. Export your data periodically if you care about preserving it (`Settings → Export my data`).
> - **The full Privacy Policy and Terms of Service apply** to your use of the hosted service. They are linked below. If anything in those documents conflicts with this disclaimer, the disclaimer wins for the trusted-tier period.
> - **Abuse is grounds for immediate revocation.** See the Acceptable Use section of the Terms.
> - **There is no warranty, no SLA, and no guaranteed support response time.** Andy is one person. He'll do his best to respond to issues within a day or two.
>
> By checking the box below and clicking Register, you acknowledge you've read this disclaimer and agree to the [Privacy Policy](/privacy) and [Terms of Service](/terms).
>
> [ ] I understand this is a trusted-tier early test. I will not upload sensitive data. I have read and agree to the Privacy Policy and Terms of Service.

---

## Longer version (for the dashboard banner and FAQ)

### What "trusted tier" means

You're one of the first ~10 invited testers using Soup.net before its full public launch. This phase exists for one reason: so the system can be tested by real users with real workflows, in a controlled environment, before opening to the public.

### What you can expect

- The core recipe-check loop works. You can submit recipes, get clustered results with evidence, and see related recipes from other testers in any groups you join.
- The web interface is functional but not polished in every corner. Some pages still show placeholders.
- The MCP server works with Claude Code, Claude Desktop, Cursor, and other MCP clients.
- New features land frequently. Check the changelog at /changelog (TODO).
- Andy reads the abuse and security inboxes daily. Other email addresses get checked a few times a week.

### What we ask of you

- **Tell us when things break.** Even small bugs. Especially small bugs. The point of this phase is to find them.
- **Tell us when things feel wrong.** UX friction, confusing copy, surprising behavior — all of it.
- **Use the system the way you actually want to use it.** The most useful feedback comes from real workflows, not test scenarios.
- **Don't share your invitation link with strangers.** If you want to invite a colleague, use the invitations feature inside the app — it tracks who you invited and counts against the trusted-tier cap.
- **Treat other testers respectfully.** Anything you submit to a shared group is visible to other group members.

### What we promise

- We will not sell your data, advertise to you, or use your content to train AI models.
- We will not casually browse your content. Access is logged.
- You can export everything we have on you at any time.
- You can delete your account and all your content at any time.
- We will give you at least 30 days notice before any breaking change to the data model or any service shutdown.
- We will not turn the trusted tier into a paid tier without grandfathering you into a free plan.

### What we don't promise

- Zero downtime
- Zero data loss
- Specific performance numbers
- Compatibility with every AI tool you might want to use
- A response within any specific time window

### Reporting issues

- **Bugs and feature requests:** [GitHub issues link, TODO]
- **Security issues:** security@soup.net
- **Abuse reports:** abuse@soup.net
- **Anything else:** hello@soup.net or just message Andy directly

---

## Where this gets shown

1. **Invitation email** — as the short version, embedded in the email body.
2. **Registration page** — as a checkbox the user must tick before the Register button enables. Stored as `users.trusted_tier_acknowledged_at` timestamp.
3. **Dashboard banner** — a dismissible banner on first login linking to the longer version.
4. **FAQ page** — the longer version, linked from the footer.
5. **Settings page** — link to re-read at any time.

## Implementation notes (for the UX agent)

- Add `trusted_tier_acknowledged_at` to the `users` table (Drizzle migration).
- Registration form: ToS checkbox + trusted-tier acknowledgment checkbox (single combined checkbox is fine for this phase — the disclaimer text covers both).
- The dashboard banner should appear once on first login and be dismissible. Track dismissal in localStorage so it doesn't follow across devices (low value to enforce once-per-account).
- The banner should NOT block the user from using the dashboard.
