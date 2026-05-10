# Terms of Service — Soup.net

**Effective date:** 2026-05-09
**Operator:** Andy Forest (sole proprietor), Ontario, Canada
**Service:** Soup.net

> **Trusted-tier notice.** Soup.net is currently in trusted-tester mode. These terms accurately describe how Soup.net operates today, but Sections 10 (Limitation of Liability), 11 (Indemnification), and 13 (Governing Law) have not yet undergone formal lawyer review. A counsel-reviewed version will be published before Soup.net opens to the general public. If anything here is unclear or you have questions, please email **hello@soup.net**.

---

## 1. The deal

By using Soup.net, you agree to these terms. If you do not agree, do not use the service.

Soup.net is a search engine for taste and judgment. You submit short structured statements ("recipes") with evidence, and the system returns similar recipes from a shared corpus. Every check leaves a trace, so future checks get smarter.

Soup.net is a Canadian sole-proprietor operation. There is no support hotline, no SLA, and no warranty. We do our best, but we are operated by one person on a small budget.

## 2. Your account

- You must provide a real, working email address.
- You are responsible for keeping your password and API keys secret.
- **You are responsible for everything that happens under your account, including anything your AI agents do with your API keys.** If you give an AI agent your API key, recipes that agent submits are attributed to you as if you submitted them yourself.
- You must be at least 13 years old (or 16 in the EU). If you are under 18, you should have a parent or guardian's permission.
- One account per person. No sharing accounts.

## 3. Your content

You retain all rights to the recipes, evidence, references, and files you upload.

By submitting content to Soup.net, you grant us a limited, worldwide, royalty-free license to:

- Store, index, and process your content to provide the service
- Generate vector embeddings via third-party AI services (currently Google Gemini)
- Display your content to other members of any group you submit it to
- Retain your content as described in the Privacy Policy

This license ends when you delete your content or your account, except where we are required to retain data for legal or security reasons (see Privacy Policy Section 8).

You represent that you have the right to submit any content you upload. In particular, you may not submit:

- Copyrighted text without a fair-dealing, fair-use, or other lawful basis
- Confidential information you are contractually bound to keep private (employer NDAs, client confidentiality, etc.)
- Personal information about identifiable individuals without their consent

## 4. Acceptable use

You may NOT use Soup.net to:

- Post or upload illegal content of any kind, including but not limited to: child sexual abuse material (CSAM), threats of violence, content that infringes copyright or trademark, content that defames a real person, content that violates someone's privacy
- Harass, dox, or threaten anyone
- Spam the corpus with low-quality or fabricated recipes (the system explicitly relies on genuine recipes — fabrication degrades quality for all users)
- Attempt to extract data you do not have legitimate access to (groups you are not a member of, other users' API keys, internal system state)
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
- Google's standard API terms apply to their handling of the content. Those terms currently prohibit Google from using API-submitted content for model training.
- We do not run any large language model or generative AI on the server. The system performs mathematical operations on embeddings and returns similar recipes; it does not generate new content.

If our processing arrangement with Google or Google's API terms change in respects that affect how your content is handled, we will display an in-app banner before the change takes effect.

## 7. Service availability

Soup.net is provided **as-is**. We do not guarantee:

- Uptime
- Data durability beyond our reasonable best effort (see Privacy Policy Section 8 for backup retention)
- Specific performance characteristics
- Continued availability of any feature
- Compatibility with any third-party tool, agent, or AI system

The service may be paused, modified, or shut down at any time. We will give as much notice as possible if the service is being shut down permanently, including a final data export window of at least 30 days.

## 8. Pricing

During the trusted-tier and early launch period, Soup.net is **free**. There are usage limits enforced via per-key rate limits. If you exceed them, your requests will be rate-limited or denied until the next window.

We may introduce paid tiers in the future. If we do:

- Existing free users will be notified at least 30 days in advance via in-app banner.
- Existing trusted-tier users will be grandfathered into a free plan even if a paid tier is introduced.
- The free tier will continue to exist in some form, even if more limited.
- Paid features will be clearly marked.

## 9. Termination

You can request account deletion at any time by emailing **privacy@soup.net** with the subject "Delete my account" from the email address you registered with. Self-serve deletion via the Settings page is on the build-out checklist; until it ships, deletion is processed manually within 30 days of your request. Deletion is irreversible and removes your content from the active service (see Privacy Policy for backup retention details).

We can terminate your account if:

- You violate these terms.
- You have not logged in for more than 12 months. Before terminating for inactivity, we will display an in-app warning the next time you visit, and (if your email is verified) send a single email reminder to your registered address.
- We are shutting down the service entirely.

## 10. Limitation of liability

To the maximum extent permitted by law, Soup.net and Andy Forest are not liable for any indirect, incidental, special, consequential, or exemplary damages, including loss of profits, data, goodwill, or other intangible losses, resulting from your use of or inability to use the service.

Our total liability for any claim arising out of or relating to these terms is limited to the greater of (a) the amount you have paid us in the past 12 months (which, if you are on the free tier, is zero) or (b) CAD $100.

This clause is on the public-launch lawyer-review checklist (Ontario consumer-protection law).

## 11. Indemnification

You agree to indemnify and hold Andy Forest harmless from any claims arising out of (a) your content, (b) your use of the service in violation of these terms, or (c) your violation of any third party's rights. This indemnification clause is on the public-launch lawyer-review checklist for enforceability and scope.

## 12. Changes to these terms

We may update these terms. If we make material changes, we will display an **in-app banner** at least 14 days before the new terms take effect. The "Effective date" at the top will reflect the latest version.

If you do not agree with the new terms, you should request account deletion (see Section 9) before the new terms take effect.

## 13. Governing law

These terms are governed by the laws of the Province of Ontario, Canada, and the federal laws of Canada applicable therein. Any disputes will be resolved in the courts of Ontario.

If you are a consumer in Quebec, the Quebec Consumer Protection Act may grant you additional rights that override conflicting provisions of these terms. If you are a consumer in another jurisdiction, your local consumer-protection laws may also apply.

This clause is on the public-launch lawyer-review checklist.

## 14. Open source and trademarks

The application code that powers Soup.net is open source under the MIT license. You can inspect, fork, or self-host it at https://github.com/AndyForest/SoupNet. The infrastructure code (Terraform, deploy workflows) and operational runbooks are kept private.

The MIT license covers code only. The name **"Soup.net"**, the Soup.net logo, and the Soup.net visual design are not licensed under MIT and remain reserved to Andy Forest. Forks and derivative works must rebrand. See the LICENSE file for the full trademark notice.

These Terms of Service apply to use of the **hosted service** at soup.net. If you self-host the open-source application, you are running your own service under your own brand and these terms do not apply to your deployment.

## 15. Contact

- **General questions:** hello@soup.net
- **Privacy:** privacy@soup.net
- **Security:** security@soup.net
- **Abuse reports:** abuse@soup.net
- **Account deletion:** privacy@soup.net (subject "Delete my account")

---

**Pending counsel review (before public launch):**

1. Section 10 (limitation of liability) under Ontario law.
2. Section 11 (indemnification) for enforceability and scope.
3. Section 13 (governing law) and consumer-protection carve-outs (especially Quebec, EU consumer rights).
4. Whether CCPA / GDPR specific carve-outs are needed at our scale.
