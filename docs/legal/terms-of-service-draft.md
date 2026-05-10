# Terms of Service — Soup.net

> **Superseded by `terms-of-service.md` (2026-05-09).** This file is retained for provenance. The live terms at `/info/terms` render from `terms-of-service.md`.

**Status:** First draft (2026-04-09). Not legal advice. Sections marked **[REVIEW]** need a lawyer review before public-tier launch.

**Effective date:** [TO BE SET]
**Operator:** Andy Forest (sole proprietor), Ontario, Canada
**Service:** Soup.net

---

## 1. The deal

By using Soup.net, you agree to these terms. If you don't agree, don't use the service.

Soup.net is a search engine for taste and judgment. You submit short structured statements ("recipes") with evidence, and the system returns similar recipes from a shared corpus. Every check leaves a trace, so future checks get smarter.

Soup.net is a Canadian sole-proprietor operation. There is no support hotline, no SLA, and no warranty. We do our best, but we are operated by one person on a small budget.

## 2. Your account

- You must provide a real, working email address.
- You are responsible for keeping your password and API keys secret.
- You are responsible for everything that happens under your account, including anything your AI agents do with your API keys.
- You must be at least 13 years old (or 16 in the EU). If you're under 18, you should have a parent or guardian's permission.
- One account per person. No sharing accounts.

## 3. Your content

You retain all rights to the recipes, evidence, references, and files you upload.

By submitting content to Soup.net, you grant us a limited, worldwide, royalty-free license to:

- Store, index, and process your content to provide the service
- Generate vector embeddings via third-party AI services (currently Google Gemini)
- Display your content to other members of any group you submit it to
- Retain your content as described in the Privacy Policy

This license ends when you delete your content or your account, except where we are required to retain data for legal or security reasons.

You represent that you have the right to submit any content you upload — including any quotes, files, or third-party material you cite as evidence.

## 4. Acceptable use

You may NOT use Soup.net to:

- Post or upload illegal content of any kind, including but not limited to: child sexual abuse material (CSAM), threats of violence, content that infringes copyright or trademark, content that defames a real person, content that violates someone's privacy
- Harass, dox, or threaten anyone
- Spam the corpus with low-quality or fabricated recipes (the system explicitly relies on genuine recipes — fabrication degrades quality for all users)
- Attempt to extract data you don't have legitimate access to (groups you're not a member of, other users' API keys, internal system state)
- Run denial-of-service attacks, scrape the system at unreasonable rates, or attempt to bypass rate limits
- Reverse-engineer the service or attempt to extract proprietary algorithms (note: the application code is open source under MIT — you may inspect and fork the public repo, but the production deployment and operational state are not yours to access)
- Use the service to generate output for use in a system that violates these terms
- Resell access to the service without our written permission

We may terminate your account immediately and without notice if you violate any of these.

## 5. Reporting abuse

If you encounter content or behavior that violates these terms, please report it to **abuse@soup.net**. Include the recipe ID, group, and a short description of the issue. We aim to respond within 48 hours during the trusted-tier period.

We reserve the right to remove content, suspend accounts, and revoke API keys at our discretion in response to abuse reports.

## 6. AI processing notice

Soup.net uses Google Gemini to generate vector embeddings of the content you submit. By submitting content, you understand that:

- The text and any attached files are sent to Google for processing.
- We do not send your identity (email, user ID) with the content.
- Google's terms apply to their handling of the content. See Google's API terms for details.
- We do not run any large language model or generative AI on the server. The system performs mathematical operations on embeddings and returns similar recipes; it does not generate new content.

## 7. Service availability

Soup.net is provided **as-is**. We do not guarantee:

- Uptime
- Data durability beyond our reasonable best effort (see Privacy Policy section 8 for backup retention)
- Specific performance characteristics
- Continued availability of any feature
- Compatibility with any third-party tool, agent, or AI system

The service may be paused, modified, or shut down at any time. Andy will give as much notice as possible if the service is being shut down permanently, including a final data export window of at least 30 days.

## 8. Pricing

During the trusted-tier and early launch period, Soup.net is **free**. There are usage limits enforced via per-key rate limits. If you exceed them, your requests will be rate-limited or denied until the next window.

We may introduce paid tiers in the future. If we do:

- Existing free users will be notified at least 30 days in advance.
- The free tier will continue to exist in some form, even if more limited.
- Paid features will be clearly marked.

## 9. Termination

You can delete your account at any time via the Settings page or `DELETE /auth/me`. This is irreversible and removes your content from the active service (see Privacy Policy for backup retention details).

We can terminate your account if:

- You violate these terms
- You haven't logged in for more than 12 months (we'll email you first)
- We're shutting down the service entirely

## 10. Limitation of liability

**[REVIEW]** Standard limitation-of-liability language. Lawyer should review for Canadian (Ontario) law specifically.

To the maximum extent permitted by law, Soup.net and Andy Forest are not liable for any indirect, incidental, special, consequential, or exemplary damages, including loss of profits, data, goodwill, or other intangible losses, resulting from your use of or inability to use the service.

Our total liability for any claim arising out of or relating to these terms is limited to the greater of (a) the amount you have paid us in the past 12 months (which, if you're on the free tier, is zero) or (b) CAD $100.

## 11. Indemnification

**[REVIEW]** Indemnification clause. You agree to indemnify and hold Andy Forest harmless from any claims arising out of your content, your use of the service, or your violation of these terms. Lawyer should confirm enforceability and scope.

## 12. Changes to these terms

We may update these terms. If we make material changes, we will notify users by email at least 14 days before the new terms take effect. The "Effective date" at the top will reflect the latest version.

If you don't agree with the new terms, you should delete your account before the new terms take effect.

## 13. Governing law

**[REVIEW]** These terms are governed by the laws of the Province of Ontario, Canada. Any disputes will be resolved in the courts of Ontario. If you are a consumer in another jurisdiction, your local consumer-protection laws may also apply.

## 14. Open source

The application code that powers Soup.net is open source under the MIT license. You can inspect, fork, or self-host it at https://github.com/[OWNER]/soupnet. The infrastructure code (Terraform, deploy workflows) and operational runbooks are kept private.

These Terms of Service apply to use of the **hosted service** at soup.net. If you self-host the open-source application, you are running your own service and these terms do not apply to your deployment.

## 15. Contact

- **General questions:** hello@soup.net
- **Privacy:** privacy@soup.net
- **Security:** security@soup.net
- **Abuse reports:** abuse@soup.net

---

**[REVIEW] Items needed before public-tier launch:**

1. Lawyer review of section 10 (limitation of liability) for Ontario law
2. Lawyer review of section 11 (indemnification) for enforceability
3. Lawyer review of section 13 (governing law) and consumer-protection carve-outs
4. Confirm SES is configured for all four addresses
5. Set effective date
6. Update GitHub URL placeholder
7. Confirm CCPA / GDPR specific carve-outs are not needed at this scale
