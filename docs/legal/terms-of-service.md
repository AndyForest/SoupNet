# Terms of Service — Soup.net

**Effective date:** 2026-05-12
**Service:** Soup.net
**Maintained by:** Andy Forest, in Canada
**Contact:** admin@soup.net

---

## 1. The deal

By using Soup.net, you agree to these terms. If you don't agree, don't use the service.

Soup.net is a search engine for taste and judgment. You submit short structured statements ("recipes") with evidence, and the system returns similar recipes from a shared corpus. Every check leaves a trace, so future checks get smarter.

The service is provided as-is. There is no support hotline, no SLA, and no warranty. We do our best.

## 2. Your account

- You must provide a real, working email address.
- You are responsible for keeping your password and API keys secret.
- **You are responsible for everything that happens under your account**, including anything your AI agents do with your API keys. If you give an AI agent your API key, recipes that agent submits are attributed to you as if you submitted them yourself.
- You must be at least 18 years old.
- One account per person. No sharing accounts.

## 3. Your content

You retain all rights to the recipes, evidence, references, and files you upload.

By submitting content to Soup.net, you grant us a limited, worldwide, royalty-free license to:

- Store, index, and process your content to provide the service
- Generate vector embeddings via third-party AI services (currently Google Gemini)
- Display your content to other members of any recipe book you submit it to
- Retain your content as described in the Privacy Policy

This license ends when you delete your content or your account, except where we are required to retain data for legal or security reasons (see Privacy Policy).

You represent that you have the right to submit any content you upload. In particular, you may not submit:

- Copyrighted text without a fair-dealing, fair-use, or other lawful basis
- Confidential information you are contractually bound to keep private (employer NDAs, client confidentiality, etc.)
- Personal information about identifiable individuals without their consent

## 4. Acceptable use

You may not:

- Post or upload illegal content of any kind, including but not limited to: child sexual abuse material (CSAM), threats of violence, content that infringes copyright or trademark, content that defames a real person, content that violates someone's privacy
- Harass, dox, or threaten anyone
- Spam the corpus with low-quality or fabricated recipes (the system explicitly relies on genuine recipes — fabrication degrades quality for all users)
- Attempt to extract data you do not have legitimate access to (recipe books you are not a member of, other users' API keys, internal system state)
- Run denial-of-service attacks, scrape the system at unreasonable rates, or attempt to bypass rate limits
- Reverse-engineer the service or attempt to extract proprietary algorithms (note: the application code is open source under MIT — you may inspect and fork the public repo, but the production deployment and operational state are not yours to access)
- Use the service to generate output for use in a system that violates these terms
- Resell access to the service without our written permission

We may terminate your account immediately and without notice if you violate any of these.

## 5. Reporting abuse

If you encounter content or behavior that violates these terms, please report it to **admin@soup.net** with the subject "Abuse report." Include the recipe ID, recipe book, and a short description of the issue.

We reserve the right to remove content, suspend accounts, and revoke API keys at our discretion in response to abuse reports.

## 6. AI processing notice

Soup.net uses Google Gemini to generate vector embeddings of the content you submit. By submitting content, you understand that:

- The text and any attached files are sent to Google for processing.
- We do not send your identity (email, user ID) with the content.
- Google's standard API terms apply to their handling of the content.
- We don't run any large language model or generative AI on the server. The system performs mathematical operations on embeddings and returns similar recipes; it doesn't generate new content.

If our processing arrangement or Google's API terms change in respects that affect how your content is handled, we'll notify you before the change takes effect.

## 7. Service availability

Soup.net is provided **as-is**. We don't guarantee:

- Uptime
- Data durability beyond our reasonable best effort
- Specific performance characteristics
- Continued availability of any feature
- Compatibility with any third-party tool, agent, or AI system

The service may be paused, modified, or shut down at any time. We will give reasonable notice before any permanent shutdown, including a final data export window.

## 8. Pricing

During the early launch period, Soup.net is free. There are usage limits enforced via per-key rate limits. If you exceed them, your requests will be rate-limited or denied until the next window.

We may introduce paid tiers in the future. If we do, existing users will be notified by reasonable means in advance, and any free-tier features in use at the time of the change will remain available in some form.

## 9. Termination

You can request account deletion at any time by emailing **admin@soup.net** with the subject "Delete my account" from the email address you registered with. Self-serve deletion via the Settings page is on the build-out checklist; until it ships, deletion is processed manually. Deletion is irreversible and removes your content from the active service (see Privacy Policy for backup retention details).

We can terminate your account if:

- You violate these terms.
- You have not logged in for a long time (we will give you reasonable notice).
- We are shutting down the service entirely.

## 10. Limitation of liability

To the maximum extent permitted by law, Soup.net and its maintainer are not liable for any indirect, incidental, special, consequential, or exemplary damages, including loss of profits, data, goodwill, or other intangible losses, resulting from your use of or inability to use the service.

Our total liability for any claim arising out of or relating to these terms is limited to the amount you have paid us in the past 12 months (which, if you are on the free tier, is zero).

## 11. Indemnification

You agree to indemnify and hold Soup.net and its maintainer harmless from any claims arising out of (a) your content, (b) your use of the service in violation of these terms, or (c) your violation of any third party's rights.

## 12. Changes to these terms

We may update these terms. If we make material changes, we'll notify you by reasonable means before the new terms take effect. The "Effective date" at the top will reflect the latest version.

If you don't agree with the new terms, you should request account deletion (see Section 9) before the new terms take effect.

## 13. Governing law

These terms are governed by the laws of the Province of Ontario, Canada, and the federal laws of Canada applicable therein. Any disputes will be resolved in the courts of Ontario. Your local consumer-protection laws may grant you additional rights that override conflicting provisions of these terms.

## 14. Open source and trademarks

The application code that powers Soup.net is open source under the MIT license. You can inspect, fork, or self-host it at https://github.com/AndyForest/SoupNet. The infrastructure code (Terraform, deploy workflows) and operational runbooks are kept private.

The MIT license covers code only. The name **"Soup.net"**, the Soup.net logo, and the Soup.net visual design are not licensed under MIT and remain reserved to Andy Forest. Forks and derivative works must rebrand. See the LICENSE file for the full trademark notice.

These Terms of Service apply to use of the **hosted service** at soup.net. If you self-host the open-source application, you are running your own service under your own brand and these terms don't apply to your deployment.

## 15. Contact

- **All inquiries:** admin@soup.net (use a clear subject line — "Abuse report", "Delete my account", "Privacy request", etc.)
- **Security issues:** security@soup.net
