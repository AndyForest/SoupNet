# Privacy Policy — Soup.net

**Effective date:** 2026-05-12 (retention wording clarified 2026-06-11; third parties updated 2026-09-27; retention timelines, connected AI apps and the check log added 2026-10-26)
**Service:** Soup.net — a stigmergic search engine for taste and judgment
**Operated by:** Andy Forest, in Canada
**Contact:** admin@soup.net

---

## Summary

- We collect the minimum needed to run the service: your email, your password (hashed), the recipes you check, and the evidence you attach.
- We use Google Gemini to generate vector embeddings of your text. Your text is sent to Google for processing. We don't send your email or identity with it.
- We don't sell your data. We don't advertise. We don't use third-party trackers. We use localStorage only to keep you signed in.
- When you connect an AI app (ChatGPT, Codex, Claude, or any other app that speaks MCP), it sends us the recipes and evidence its agent writes and reads back recipes from the books you chose. That app's own policy covers your conversation on its side.
- You can see every check made through your account in the check log, export everything we have on you at any time (`Settings → Export my data`), and delete your account from `Settings → Account`. Each kind of data has a retention timeline in Section 8.
- If anything material about how we handle your data changes, we'll notify you by reasonable means before the change takes effect.

---

## 1. Who we are

Soup.net is run by whoever the "Operated by" line at the top of this policy names ("we"). For privacy questions or requests: **admin@soup.net**.

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
- **Drafts** — recipes an agent deposits as a hypothesis it can't yet settle. Only you and your agents see a draft until it's resolved in your review queue.
- **Intents** — the short task descriptions your agents declare, so that their checks for one task are grouped together.
- **The check log and feedback** — a record of each recipe check, search and briefing made through your account (when, which key or connection, and which recipe it concerned), and the feedback rows your agents leave about what a check's results were worth.
- **Display history** — which recipes a check session, or an intent, has already been shown, so later checks don't repeat them in full. It's keyed by an opaque session token or the intent, not by your name or email.

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

### 2.6 Connected AI apps

You can connect an AI app to Soup.net (ChatGPT, Codex, Claude, Mistral, Perplexity, or any other app that speaks the Model Context Protocol). When you connect, you sign in to Soup.net and choose which recipe books the app may read and write. Then:

- **What the app sends us:** what its agent puts in each tool call, which is the recipe text, evidence and references it writes, the searches it runs, and optional labels such as an agent name or a task description. We don't receive your conversation with the app, only what its agent chooses to send.
- **What the app receives:** recipes, evidence and authors' names from the books you granted, your recipe-book names and descriptions, and the members of those books. It never receives your password, and it receives nothing from books you didn't grant.
- **What we keep about the connection:** the app's registration (its name and where it returns after sign-in), and its access tokens as hashes, on the timelines in Section 8.
- **The app's side:** what the app's provider does with your conversation, including whatever it receives from Soup.net, is governed by that provider's terms and privacy policy, not this one.

## 3. What we do with it

- **Run the service.** Authentication, recipe storage, search, recipe-book access control, and showing you your check log and review queue.
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
- **Amazon Web Services (AWS)** — Hosting and infrastructure (database, file storage, application servers, logs, backups). All service data is hosted in AWS regions in the United States; backup copies are kept in a second US region.
- **AWS Simple Email Service (SES)** — Sends transactional email (verification, password reset, invitations).
- **Cloudflare Turnstile** — Checks that a person, not a bot, is creating an account or asking us to send an email (sign-up, password reset, a new verification link). Those pages load Cloudflare's check, which processes signals from your browser and your IP address; we receive only whether the check passed.

- **AI apps you connect** — receive what Section 2.6 describes, at your direction, for the recipe books you choose. You can end a connection at any time (Section 7).

We don't share data with any other third party. We don't use any analytics, advertising, or social-media third-party services.

## 7. Your rights

Wherever you are, you can:

- **Access** all the data we have about you — use `Settings → Export my data` (or call `GET /auth/me/export`).
- **Correct** your email address by contacting admin@soup.net.
- **Delete** your account and all your content from **Settings → Account → Delete account** in the app. Deletion is irreversible and happens immediately. If you'd prefer to delete by email, send a request from your registered email address to **admin@soup.net** with the subject "Delete my account".
- **Export** your data in machine-readable JSON format.
- **See what your agents did** in the check log (`/app/checks`): every recipe check made through your account, with when it happened and which recipe it concerned.
- **Review drafts** your agents left in the review queue (`/app/drafts`): confirm, reject, or mark not chosen.
- **End a connection** from an AI app at any time, on the API Keys page (`/app/keys`) or in the app's own settings. Revoking it stops the app's access at once.
- **Choose what an app can reach** when you connect it: which recipe books, and whether each is read-only or writable.
- **Withdraw consent** to data processing — by requesting account deletion as above.

We aim to respond to all requests within the time required by applicable law and as soon as we reasonably can.

## 8. Data retention

Deleting something in the app removes it from the live service immediately. Copies in our database backups then expire on the schedule at the end of this list.

- **Account data, recipes, evidence, references, drafts, intents, feedback and recipe-book memberships:** kept until you delete the item or your account.
- **Uploaded files:** kept until you delete the recipe they support or your account.
- **API keys:** stored as hashes until you delete your account. A daily key stops working at midnight UTC, and a revoked key stops working at once.
- **Connections from AI apps:** an access token works for one hour, and the app renews it with a refresh token that lasts up to 30 days. Expired tokens are deleted 30 days after they expire, and sign-in codes one day after they expire. An app registration that never completes a sign-in is deleted after 30 days.
- **Display history:** what an intent has been shown is deleted with the intent or your account. What a check session has been shown is stored under an opaque session token rather than your account, and isn't deleted today.
- **Audit log entries:** retained for security and operational purposes (e.g., abuse investigation, rate limiting).
- **Email records:** we keep a metadata-only log of each email we send (recipient, type, subject, delivery status — never the message body) for 60 days, then delete it.
- **Waitlist accounts:** an account created while we're at capacity waits on the waitlist. If it never verifies its email address, we delete the account after 30 days. Verified waitlist accounts are kept until they're let in (or you ask us to delete them).
- **Application logs** (request method, status, timing, the calling app's user agent and origin, and error messages): 14 days.
- **Load balancer access logs** (IP address, time, user agent and the requested URL; for a check made through a web link, the URL includes the recipe text): 30 days.
- **Vector cache (content-hashed):** indefinite. Contains no identifiers; cannot be linked to you after account deletion.
- **Backups:** the database can be restored to any point in the last 35 days, and snapshots are kept daily for 14 days, weekly for 35 days and monthly for 12 months, each with a copy in a second US region on the same schedule. Data you delete can therefore remain in backups for up to 12 months, until the last snapshot holding it expires. Backups exist to recover the service after a failure.

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
