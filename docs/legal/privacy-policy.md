# Privacy Policy — Soup.net

**Effective date:** 2026-05-12 (retention wording clarified 2026-06-11)
**Service:** Soup.net — a stigmergic search engine for taste and judgment
**Maintained by:** Andy Forest, in Canada
**Contact:** admin@soup.net

---

## Summary

- We collect the minimum needed to run the service: your email, your password (hashed), the recipes you check, and the evidence you attach.
- We use Google Gemini to generate vector embeddings of your text. Your text is sent to Google for processing. We don't send your email or identity with it.
- We don't sell your data. We don't advertise. We don't use third-party trackers. We use localStorage only to keep you signed in.
- You can export everything we have on you at any time (`Settings → Export my data`). You can request account deletion by emailing **admin@soup.net**.
- If anything material about how we handle your data changes, we'll notify you by reasonable means before the change takes effect.

---

## 1. Who we are

Soup.net is maintained by Andy Forest, in Canada. For privacy questions or requests: **admin@soup.net**.

## 2. What we collect

### 2.1 Account information

- **Email address** — for authentication and required notifications (verification, password reset, security alerts).
- **Password** — stored as a bcrypt hash. We never store or log your plaintext password.
- **Email verification status and timestamps** — to know when you have confirmed your email.
- **Account creation timestamp**, last login, and a small audit log of authentication events (login success/failure, password reset, key creation/revocation). These are kept for security incident investigation.
- **Terms of Service / Privacy Policy acceptance timestamp** — recorded when you register.

### 2.2 Content you create

- **Recipes** ("traces") — the structured taste/judgment statements you check via the recipe-check API or the web interface. Format: "As a [role] working on [goal], I [prefer/chose] X so that [reason]."
- **Evidence** — interpretations, direct quotes, and source citations you attach to recipes.
- **References** — URLs or documents you cite as evidence.
- **Recipe book memberships** — which recipe books you belong to and your role in each.
- **API keys** — stored as SHA-256 hashes. We can verify a key but cannot recover it.

### 2.3 Files you upload (multimodal evidence)

You may attach files (screenshots, PDFs, images, audio) as evidence for a recipe check. We process these as follows:

- The file is sent to Google Gemini to generate a vector embedding.
- The file is retained so we can re-process it if the embedding pipeline improves, and deleted when you delete your account (or the recipe it supports).
- Files are **never served back to anyone**, including the uploader, via any public URL. There is no `/files/` or `/uploads/` GET endpoint. This is a deliberate design choice to limit our exposure to misuse.
- Files that look like images are sanitized (re-encoded, EXIF stripped) before processing. We reject files whose contents do not match their declared file type.

### 2.4 Vector embeddings

When you submit a recipe, we generate vector embeddings (numeric representations) of the text and any attached files using Google Gemini. These embeddings power semantic search. We store:

- **Quantized embeddings** in our search index, indexed by recipe ID.
- **Full-precision embeddings** in a content-hashed cache, so identical text generates an embedding only once. The cache key is a hash of the text content and is not linked to your user ID.

When you delete your account, the recipe-keyed embeddings are deleted along with the recipes themselves. The content-hashed cache is not deleted — its keys are derived from content (not identity), and the embeddings are mathematical projections that cannot be reversed to text. Removing your recipes removes the only path to associate cached entries with you.

### 2.5 Technical data

- **IP address and user agent** — used for rate limiting and abuse detection. Stored in audit log entries, which we retain for security and operational purposes.
- **localStorage** — we store your authentication token in your browser's localStorage. This storage is strictly necessary to keep you signed in to the service you requested. We do not use cookies for tracking, third-party analytics, or tag managers.

## 3. What we do with it

- **Run the service.** Authentication, recipe storage, search, recipe-book access control.
- **Send transactional email.** Verification, password reset, invitation, security alerts. We do not send marketing email.
- **Generate embeddings.** Recipe text and uploaded files are sent to Google Gemini. We do not send your email address or user ID with the request — Google sees only the text or file content. See Section 6.
- **Detect and respond to abuse.** Rate-limit violations, suspicious authentication patterns, and abuse reports may trigger account review and revocation.
- **Improve the service.** We look at aggregate statistics (recipe count, recipe-book count, search latency) to improve performance. We do not read individual recipes for product development unless you explicitly grant support access.

We don't engage in automated decision-making that produces legal effects or similarly significant effects on you. Search results are mathematical similarity scores, not decisions about you.

## 4. What we don't do

- We don't sell your data, and our business model doesn't involve selling data.
- We don't advertise in the service. There are no advertisers in our supply chain.
- We don't use third-party trackers. No Google Analytics, no Meta Pixel, no advertising SDKs.
- We don't use cookies for tracking. We use localStorage only for authentication.
- We don't train AI models on your recipes. Our embedding provider (Google) processes content under standard API terms that prohibit using API-submitted content for model training. If this changes for Soup.net or for our embedding provider, we'll notify you before the change takes effect.
- We don't read your content unless required to investigate an abuse report, security incident, or legal request.

## 5. Who can see your content

By default, **only you** can see the recipes you check. Recipes go to your personal recipe book unless you explicitly choose otherwise.

When you join a recipe book, recipes you check **to that recipe book** become visible to other members of the recipe book. The choice of recipe book is yours on every recipe check.

Soup.net maintainers have technical access to all data for the purposes of operating the service and responding to legal or security incidents. We don't browse user content casually. Maintainer access to user content is logged in the audit log.

## 6. Third parties

- **Google Cloud (Gemini API)** — Generates vector embeddings. We send recipe text, evidence text, and uploaded file content. We do not send your user identifier. Processed in Google's data centers under Google's standard API terms.
- **Amazon Web Services (AWS)** — Hosting and infrastructure (database, file storage, application servers). All service data is hosted in AWS regions in the United States.
- **AWS Simple Email Service (SES)** — Sends transactional email (verification, password reset, invitations).

We don't share data with any other third party. We don't use any analytics, advertising, or social-media third-party services.

## 7. Your rights

Wherever you are, you can:

- **Access** all the data we have about you — use `Settings → Export my data` (or call `GET /auth/me/export`).
- **Correct** your email address by contacting admin@soup.net.
- **Delete** your account and all your content from **Settings → Account → Delete account** in the app. Deletion is irreversible and happens immediately. If you'd prefer to delete by email, send a request from your registered email address to **admin@soup.net** with the subject "Delete my account".
- **Export** your data in machine-readable JSON format.
- **Withdraw consent** to data processing — by requesting account deletion as above.

We aim to respond to all requests within the time required by applicable law and as soon as we reasonably can.

## 8. Data retention

- **Account data, recipes, evidence, references:** kept until you request account deletion or delete the specific item.
- **Uploaded files:** retained for embedding pipeline purposes; deleted when you delete your account.
- **Audit log entries:** retained for security and operational purposes (e.g., abuse investigation, rate limiting).
- **Email records:** we keep a metadata-only log of each email we send (recipient, type, subject, delivery status — never the message body) for 60 days, then delete it.
- **Vector cache (content-hashed):** indefinite. Contains no identifiers; cannot be linked to you after account deletion.
- **Backups:** routine database backups are kept for a limited period, then expired. Deleted account data may persist in backups during that window.

## 9. Security

We use industry-standard security practices, including TLS for all connections, bcrypt password hashing, hashed API keys, content security policies, rate limiting, encryption of the database at rest, and isolation of the database in a private subnet.

We are not perfect. If you find a vulnerability, please report it to **security@soup.net**. We acknowledge security reports as soon as we reasonably can.

## 10. Breach notification

If we discover a personal data breach affecting your account, we will notify you without undue delay. Notification will describe the nature of the breach, the data affected, and the steps we are taking in response.

## 11. Age

You must be at least 18 years old to use Soup.net. We don't knowingly collect data from anyone under 18. If you believe someone under 18 has created an account, contact admin@soup.net and we'll delete the account.

## 12. Changes to this policy

We may update this policy. If we make material changes, we'll notify you by reasonable means before the change takes effect. The "Effective date" at the top will reflect the latest version.

## 13. Contact

For privacy questions, requests, or complaints: **admin@soup.net**.
For security issues: **security@soup.net**.
