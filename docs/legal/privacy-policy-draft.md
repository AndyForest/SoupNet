# Privacy Policy — Soup.net

**Status:** First draft (2026-04-09). Not legal advice. Sections marked **[REVIEW]** need a lawyer or template-service review before public-tier launch. The trusted-invite tier may be served with this draft plus the trusted-tier disclaimer.

**Effective date:** [TO BE SET]
**Operator:** Andy Forest (sole proprietor), Ontario, Canada
**Service:** Soup.net — a stigmergic search engine for taste and judgment
**Contact:** privacy@soup.net

---

## Summary (read this first)

- We collect the minimum needed to run the service: your email, your password (hashed), the recipes you check, and the evidence you attach.
- We use Google Gemini to generate vector embeddings of your text. Your text is sent to Google for processing. We do not send your email or identity with it.
- We do not sell your data. We do not advertise. We do not use third-party trackers. We use localStorage only to keep you signed in.
- You can export everything we have on you at any time (`/auth/me/export`). You can delete your account and all your content (`/auth/me`).
- We are a Canadian operation subject to PIPEDA. If you're in the EU/UK or California, additional rights apply — see below.

---

## 1. Who we are

Soup.net is operated by Andy Forest as a sole proprietor based in Ontario, Canada. There is no parent company. There are no investors. There are no advertisers.

For privacy questions or requests: **privacy@soup.net**.

## 2. What we collect

### 2.1 Account information

- **Email address** — for authentication and required notifications (verification, password reset, security alerts).
- **Password** — stored as a bcrypt hash (cost factor 12). We never store or log your plaintext password.
- **Email verification status and timestamps** — to know when you've confirmed your email.
- **Account creation timestamp**, last login, and a small audit log of authentication events (login success/failure, password reset, key creation/revocation). These are kept for security incident investigation.

### 2.2 Content you create

- **Recipes** ("traces") — the structured taste/judgment statements you check via the recipe-check API or the web interface. Format: "As a [role] working on [goal], I [prefer/chose] X so that [reason]."
- **Evidence** — interpretations, direct quotes, and source citations you attach to recipes.
- **References** — URLs or documents you cite as evidence.
- **Group memberships** — which groups you belong to and your role in each.
- **API keys** — stored as SHA-256 hashes. We can verify a key but cannot recover it.

### 2.3 Files you upload (multimodal evidence)

You may attach files (screenshots, PDFs, images) as evidence for a recipe check. We process these as follows:

- The file is sent to Google Gemini to generate a vector embedding.
- The file is **cached temporarily** (up to 30 days) so we can re-process it if the embedding pipeline changes.
- After 30 days, the file is **automatically deleted** by an S3 lifecycle rule.
- Files are **never served back to anyone**, including the uploader, via any public URL. There is no `/files/` or `/uploads/` endpoint. This is a deliberate design choice to limit our exposure to misuse.
- Files that look like images are sanitized (re-encoded, EXIF stripped) before processing. We reject files whose contents don't match their declared file type.

### 2.4 Vector embeddings

When you submit a recipe, we generate vector embeddings (numeric representations) of the text and any attached files using Google Gemini. These embeddings power semantic search. We store:

- **Quantized embeddings** (`halfvec`, ~6KB per recipe) in our search index, indexed by recipe ID.
- **Full-precision embeddings** in a content-hashed cache, so identical text generates an embedding only once. The cache key is a hash of the text content and is not linked to your user ID.

When you delete your account, the recipe-keyed embeddings are deleted. The content-hashed cache is **not** deleted, because it has no link to your identity and cannot be reversed to text — but it also can't be associated with you.

### 2.5 Technical data

- **IP address** — used for rate limiting and abuse detection. Stored in audit log entries for up to 90 days, then deleted.
- **User agent** — same purpose, same retention.
- **localStorage** — we store your JWT (authentication token) in your browser's localStorage. We do not use cookies for tracking. We do not use any third-party analytics. We do not use any third-party tag managers.

## 3. What we do with it

- **Run the service.** Authentication, recipe storage, search, group access control.
- **Send transactional email.** Verification, password reset, invitation, security alerts. We use AWS SES for this. We do not send marketing email.
- **Generate embeddings.** Recipe text and uploaded files are sent to Google Gemini. We do not send your email address or user ID with the request — Google sees only the text or file content. See section 6.
- **Detect and respond to abuse.** Rate-limit violations, suspicious authentication patterns, and abuse reports may trigger account review and revocation.
- **Improve the service.** We look at aggregate statistics (recipe count, group count, search latency) to improve performance. We do not read individual recipes for product development unless you explicitly grant support access.

## 4. What we DON'T do

- We do **not sell** your data to anyone. There are no data brokers in our supply chain.
- We do **not advertise**. There are no advertisers in our supply chain.
- We do **not use third-party trackers**. No Google Analytics, no Meta Pixel, no advertising SDKs.
- We do **not use cookies for tracking**. We use localStorage only for authentication.
- We do **not train AI models** on your recipes. The Gemini API is used only for embedding generation, which is a one-way mathematical transformation.
- We do **not read your content** unless required to investigate an abuse report or legal request.

## 5. Who can see your content

By default, **only you** can see the recipes you check. Recipes go to your personal group unless you explicitly choose otherwise.

When you join a group, recipes you check **to that group** become visible to other members of the group. The choice of group is yours on every recipe check (`group` parameter on the API and a selector in the UI).

**System operators** (currently Andy Forest only) have technical access to all data for the purposes of operating the service and responding to legal or security incidents. We do not browse user content casually. Access to user content is logged (see section 2.1).

## 6. Third parties

| Service | What we send | Why |
|---------|--------------|-----|
| Google Cloud (Gemini API) | Recipe text, evidence text, uploaded file content | Generate vector embeddings |
| Amazon Web Services (AWS) | All service data (RDS, S3, ECS, SES) | Hosting and infrastructure |
| AWS Simple Email Service (SES) | Your email address, transactional email content | Send verification / reset / invitation emails |

We do not share any data with any other third party. We do not use any analytics, advertising, or social-media third-party services.

**[REVIEW]** We may need to add a Data Processing Addendum reference for Google and AWS depending on your jurisdiction.

## 7. Your rights

Regardless of jurisdiction, you can:

- **Access** all data we have about you — call `GET /auth/me/export` (or the Settings page export button).
- **Correct** your email address by contacting privacy@soup.net.
- **Delete** your account and all your content — call `DELETE /auth/me` (or the Settings page delete button). This is irreversible.
- **Export** your data in machine-readable JSON format.
- **Withdraw consent** to data processing — by deleting your account.

### 7.1 If you're in Canada (PIPEDA)

You have all the rights above. You can complain to the Office of the Privacy Commissioner of Canada at https://www.priv.gc.ca/ if you believe we've mishandled your data.

### 7.2 If you're in the EU, EEA, or UK (GDPR / UK GDPR)

**[REVIEW]** Lawyer should confirm:
- Our legal basis for processing is **contract** (necessary to provide the service you signed up for) and **legitimate interest** (security, abuse prevention).
- You have the right to lodge a complaint with your local supervisory authority.
- We do not have an EU representative because we are a Canadian operation processing data in Canada and the US (AWS). Confirm whether Article 27 representative is required given our scale.
- International data transfers: data flows from your location to AWS regions (US) and Google Cloud (US). Standard Contractual Clauses apply via AWS and Google's terms.

### 7.3 If you're in California (CCPA/CPRA)

**[REVIEW]** Lawyer should confirm:
- We do not "sell" or "share" personal information as defined by CPRA.
- You have the right to know, delete, correct, and opt out of automated decisions.
- We do not engage in automated decision-making that produces legal effects.

## 8. Data retention

- **Account data:** kept until you delete your account.
- **Recipes, evidence, references:** kept until you delete your account or the specific recipe.
- **Uploaded files:** auto-deleted after 30 days regardless of account status.
- **Audit log entries:** 90 days, then deleted.
- **Vector cache (content-hashed):** indefinite, but contains no identifiers and cannot be linked to you after account deletion.
- **Backups:** routine database backups are kept for 30 days, then expired. Deleted account data may persist in backups for up to 30 days after deletion.

## 9. Security

We take security seriously. In summary:

- TLS 1.2+ on all connections (HSTS, 1-year max-age)
- Bcrypt password hashing (cost 12)
- API keys stored as SHA-256 hashes
- JWT-based session authentication
- Strict Content Security Policy on all pages
- Rate limiting on all endpoints
- Database in a private subnet, encrypted at rest
- Regular security audits (currently kept private during the trusted-tier period; may be published in the future)

We are not perfect. If you find a vulnerability, please report it to **security@soup.net**. We commit to acknowledging the report within 5 business days.

## 10. Children

Soup.net is **not directed at children under 13** and we do not knowingly collect data from children under 13 (COPPA). If you are in the EU, you must be at least 16 to use the service without parental consent. If you believe a child has created an account, contact privacy@soup.net and we will delete the account.

## 11. Changes to this policy

We may update this policy. If we make material changes, we will notify users by email. The "Effective date" at the top will reflect the latest version.

## 12. Contact

For privacy questions, requests, or complaints:

- **Email:** privacy@soup.net
- **Mail:** [TO BE SET if required by jurisdiction]

---

**[REVIEW] Items needed before public-tier launch:**

1. Legal review by a Canadian lawyer (PIPEDA compliance)
2. EU/UK GDPR review (especially Article 27 representative question and SCCs)
3. California CCPA review
4. Confirm AWS DPA and Google Cloud DPA are in place and reference them
5. Set effective date
6. Set the postal mail contact if required
7. Verify SES is configured for `privacy@soup.net` and `security@soup.net`
