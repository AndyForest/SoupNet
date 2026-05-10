# Privacy Policy — Soup.net

**Effective date:** 2026-05-09
**Operator:** Andy Forest (sole proprietor), Ontario, Canada
**Service:** Soup.net — a stigmergic search engine for taste and judgment
**Contact:** privacy@soup.net

> **Trusted-tier notice.** Soup.net is currently in trusted-tester mode. This policy accurately describes how Soup.net handles your data today, but has not yet undergone formal lawyer review. A counsel-reviewed version will be published before Soup.net opens to the general public. Specific items pending counsel review are noted inline. If anything here is unclear or you have questions, please email **privacy@soup.net**.

---

## Summary (read this first)

- We collect the minimum needed to run the service: your email, your password (hashed), the recipes you check, and the evidence you attach.
- We use Google Gemini to generate vector embeddings of your text. Your text is sent to Google for processing. We do not send your email or identity with it.
- We do not sell your data. We do not advertise. We do not use third-party trackers. We use localStorage only to keep you signed in.
- You can export everything we have on you at any time (`Settings → Export my data`). You can request account deletion by emailing **privacy@soup.net**.
- We are a Canadian operation subject to PIPEDA. If you are in the EU/UK or California, additional rights apply — see Section 7 below.
- If anything material changes (in this policy, in our processing, or in our third-party providers' terms), we will display an **in-app banner** for at least 14 days before the change takes effect.

---

## 1. Who we are

Soup.net is operated by Andy Forest as a sole proprietor based in Ontario, Canada. There is no parent company. There are no investors. There are no advertisers.

For privacy questions or requests: **privacy@soup.net**.

We do not have a designated Data Protection Officer (DPO). Under GDPR Article 37, this is not required at our scale (no large-scale processing of special categories of data, no large-scale systematic monitoring). Privacy questions go directly to Andy Forest at the address above.

## 2. What we collect

### 2.1 Account information

- **Email address** — for authentication and required notifications (verification, password reset, security alerts).
- **Password** — stored as a bcrypt hash (current cost factor 12, subject to upgrade as computing speeds increase). We never store or log your plaintext password.
- **Email verification status and timestamps** — to know when you have confirmed your email.
- **Account creation timestamp**, last login, and a small audit log of authentication events (login success/failure, password reset, key creation/revocation). These are kept for security incident investigation.
- **Terms of Service / Privacy Policy acceptance timestamp** — recorded when you register.

### 2.2 Content you create

- **Recipes** ("traces") — the structured taste/judgment statements you check via the recipe-check API or the web interface. Format: "As a [role] working on [goal], I [prefer/chose] X so that [reason]."
- **Evidence** — interpretations, direct quotes, and source citations you attach to recipes.
- **References** — URLs or documents you cite as evidence.
- **Group memberships** — which groups you belong to and your role in each.
- **API keys** — stored as SHA-256 hashes. We can verify a key but cannot recover it.

### 2.3 Files you upload (multimodal evidence)

You may attach files (screenshots, PDFs, images, audio) as evidence for a recipe check. We process these as follows:

- The file is sent to Google Gemini to generate a vector embedding.
- The file is **cached temporarily** (target: up to 30 days) so we can re-process it if the embedding pipeline changes.
- After the cache window, the file is deleted. Today this is enforced by our cleanup jobs; an automated S3 lifecycle rule is the long-term mechanism.
- Files are **never served back to anyone**, including the uploader, via any public URL. There is no `/files/` or `/uploads/` GET endpoint. This is a deliberate design choice to limit our exposure to misuse.
- Files that look like images are sanitized (re-encoded, EXIF stripped) before processing. We reject files whose contents do not match their declared file type.

### 2.4 Vector embeddings

When you submit a recipe, we generate vector embeddings (numeric representations) of the text and any attached files using Google Gemini. These embeddings power semantic search. We store:

- **Quantized embeddings** (`halfvec`, ~6KB per recipe) in our search index, indexed by recipe ID.
- **Full-precision embeddings** in a content-hashed cache, so identical text generates an embedding only once. The cache key is a hash of the text content and is not linked to your user ID.

When you delete your account, the recipe-keyed embeddings are deleted along with the recipes themselves. The content-hashed cache is **not** deleted — its keys are derived from content (not identity), and the embeddings are mathematical projections that cannot be reversed to text. Removing your recipes removes the only path to associate cached entries with you.

### 2.5 Technical data

- **IP address** — used for rate limiting and abuse detection. Stored in audit log entries for up to 90 days, then deleted.
- **User agent** — same purpose, same retention.
- **localStorage** — we store your JWT (authentication token) in your browser's localStorage. Under the ePrivacy Directive (Article 5(3)), no consent is required for storage that is "strictly necessary" to provide the service the user explicitly requested. Our localStorage use is limited to authentication. We do not use cookies for tracking. We do not use any third-party analytics. We do not use any third-party tag managers.

## 3. What we do with it

- **Run the service.** Authentication, recipe storage, search, group access control.
- **Send transactional email.** Verification, password reset, invitation, security alerts. We use AWS Simple Email Service (SES) for this. We do not send marketing email.
- **Generate embeddings.** Recipe text and uploaded files are sent to Google Gemini. We do not send your email address or user ID with the request — Google sees only the text or file content. See Section 6 for third-party details.
- **Detect and respond to abuse.** Rate-limit violations, suspicious authentication patterns, and abuse reports may trigger account review and revocation.
- **Improve the service.** We look at aggregate statistics (recipe count, group count, search latency) to improve performance. We do not read individual recipes for product development unless you explicitly grant support access.

We do not engage in automated decision-making that produces legal effects or similarly significant effects on you. Search results are mathematical similarity scores, not decisions about you.

## 4. What we do NOT do

- We do **not sell** your data to anyone, and our business model does not involve selling data.
- We do **not advertise** in the service. There are no advertisers in our supply chain. If this changes, we will display an in-app banner before any advertising is introduced.
- We do **not use third-party trackers**. No Google Analytics, no Meta Pixel, no advertising SDKs.
- We do **not use cookies for tracking**. We use localStorage only for authentication.
- We do **not train AI models** on your recipes. Google's API terms (which our embedding provider must follow) prohibit Gemini from using API-submitted content for training. If either Soup.net's policy or our embedding provider's terms change in this respect, we will display an in-app banner before any change takes effect.
- We do **not read your content** unless required to investigate an abuse report, security incident, or legal request.

## 5. Who can see your content

By default, **only you** can see the recipes you check. Recipes go to your personal group unless you explicitly choose otherwise.

When you join a group, recipes you check **to that group** become visible to other members of the group. The choice of group is yours on every recipe check (`group` parameter on the API and a selector in the UI).

**System operators** (currently Andy Forest only) have technical access to all data for the purposes of operating the service and responding to legal or security incidents. We do not browse user content casually. Operator access to user content is logged in the audit log (see Section 2.1).

## 6. Third parties

- **Google Cloud (Gemini API)** — Generates vector embeddings. We send recipe text, evidence text, and uploaded file content. We do not send your user identifier. Processed in Google's data centers.
- **Amazon Web Services (AWS)** — Hosting and infrastructure (RDS for the database, S3 for uploaded files, ECS for the application). All service data resides in US-East-1 (Northern Virginia).
- **AWS Simple Email Service (SES)** — Sends transactional email (verification, password reset, group invitations). We send your email address and the email content. Processed in US-East-1.

We do not share data with any other third party. We do not use any analytics, advertising, or social-media third-party services.

**Cross-border transfers.** Both AWS and Google Cloud offer Standard Contractual Clauses (SCCs) through their standard customer agreements; we operate under those standard agreements today. Bespoke Data Processing Addenda (DPAs) with each provider are on the public-launch lawyer-review checklist.

## 7. Your rights

Regardless of jurisdiction, you can:

- **Access** all data we have about you — use `Settings → Export my data` (or call `GET /auth/me/export`).
- **Correct** your email address by contacting privacy@soup.net.
- **Delete** your account and all your content by emailing **privacy@soup.net** with the subject "Delete my account" from the email address you registered with. Self-serve deletion via the Settings page is on the build-out checklist; until it ships, deletion is processed manually within 30 days of your request.
- **Export** your data in machine-readable JSON format.
- **Withdraw consent** to data processing — by requesting account deletion as above.

We will acknowledge your request within 10 business days and respond substantively within 30 days. Complex requests may take an additional 60 days; if so, we will tell you within the initial 30-day window.

### 7.1 If you are in Canada (PIPEDA)

You have all the rights above. You can complain to the Office of the Privacy Commissioner of Canada at https://www.priv.gc.ca/ if you believe we have mishandled your data.

If you are in Quebec, Law 25 (the Act respecting the protection of personal information in the private sector) may grant you additional rights that override conflicting provisions of this policy. Contact privacy@soup.net to exercise them.

### 7.2 If you are in the EU, EEA, or UK (GDPR / UK GDPR)

- Our **legal basis** for processing is **contract** (necessary to provide the service you signed up for) and **legitimate interest** (security, abuse prevention).
- You have the right to lodge a complaint with your local supervisory authority. For UK users: the ICO (https://ico.org.uk/). For EU/EEA users: the supervisory authority in your country of residence.
- **Article 27 representative.** We do not currently maintain an EU representative. The formal applicability of Article 27 to a sole-operator service of our scale is on the public-launch lawyer-review checklist. In the meantime, EU/UK users can exercise GDPR rights by emailing privacy@soup.net.
- **International data transfers.** Data flows from your location to AWS regions (US-East-1) and Google Cloud (US). Standard Contractual Clauses apply via AWS's and Google's standard agreements.

### 7.3 If you are in California (CCPA / CPRA)

Soup.net does not currently meet the size or revenue thresholds that make CCPA/CPRA legally applicable to us. As a matter of policy, we extend the same rights described in Section 7 (access, deletion, correction, opt-out of sale or sharing) to California users regardless. We do not "sell" or "share" personal information as defined by CPRA. We do not engage in automated decision-making that produces legal effects.

## 8. Data retention

- **Account data:** kept until you request account deletion.
- **Recipes, evidence, references:** kept until you request account deletion or delete the specific recipe.
- **Uploaded files:** retained for at most 30 days for embedding pipeline purposes, then deleted.
- **Audit log entries:** 90 days, then deleted.
- **Vector cache (content-hashed):** indefinite. Contains no identifiers; cannot be linked to you after account deletion.
- **Backups:** routine database backups are kept for 30 days, then expired. Deleted account data may persist in backups for up to 30 days after deletion.

## 9. Security

In summary:

- TLS 1.2+ on all connections (HSTS, 1-year max-age)
- Bcrypt password hashing (current cost 12, subject to upgrade)
- API keys stored as SHA-256 hashes
- JWT-based session authentication
- Content Security Policy on all pages
- Rate limiting on all endpoints
- Database in a private subnet, encrypted at rest
- Regular security audits (currently kept private during the trusted-tier period; some findings may be published in the future)

We are not perfect. If you find a vulnerability, please report it to **security@soup.net**. We commit to acknowledging the report within 5 business days.

## 10. Breach notification

If we discover a personal data breach affecting your account, we will notify you by email and via in-app banner without undue delay (target: within 72 hours of discovery), in accordance with PIPEDA and GDPR breach notification standards. Notification will describe the nature of the breach, the data affected, and the steps we are taking in response.

## 11. Children

Soup.net is **not directed at children under 13** and we do not knowingly collect data from children under 13 (COPPA). If you are in the EU, you must be at least 16 to use the service without parental consent. If you believe a child has created an account, contact privacy@soup.net and we will delete the account.

## 12. Changes to this policy

We may update this policy. If we make material changes, we will display an **in-app banner** for at least 14 days before the changes take effect. The "Effective date" at the top will reflect the latest version. Material changes that affect your rights or expand our processing will be highlighted in the banner.

## 13. Contact

For privacy questions, requests, or complaints:

- **Email:** privacy@soup.net
- **Subject for deletion requests:** "Delete my account"

---

**Pending counsel review (before public launch):**

The trusted-tier banner at the top reflects that the following items have not yet been formally lawyer-reviewed:

1. PIPEDA compliance review by Canadian counsel.
2. GDPR Article 27 representative requirement (current position assumes not required at our scale; counsel to confirm).
3. CCPA / CPRA scope confirmation (current position assumes out of scope at trusted-tier volume).
4. Bespoke AWS and Google Cloud Data Processing Addenda (currently relying on standard customer agreements).
5. Postal mail contact address (whether jurisdictionally required).
6. Self-serve account deletion endpoint (`DELETE /auth/me`) — currently manual via email; build-out scoped separately.
