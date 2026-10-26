# Organization accounts round 1: stream Domains

Build log for stream Domains of [org-accounts-round-1.md](../org-accounts-round-1.md) (on `plan/org-accounts-round-1`, PR #149): proof that a company controls its email domains, re-verification, automatic joining on a verified domain, and moving existing accounts on the domain into the organization. Branch `org/domains`, worktree `SoupNet-wt/org-domains`. Migration `0046` (claimed at first push; the cross-round sequence is plugin O `0043`, Core `0044`, SSO `0045`, Domains `0046`, Offboarding `0047`).

## Rubric

Written 2026-10-26 by stream Domains (agent `a-org-domains-2026-10-26`, intent `int_lS0cpvJUC0VlEgNpDLuxf4ns`) before implementation. It draws on the round plan's Domains row, the program's §0 decisions and settled simplifications, §3.2, §3.3 and §3.10, the research's [domain-verification-and-claiming.md](../org-accounts-research/domain-verification-and-claiming.md) (which wins where it and the program's first-pass text disagree), Core's rubric [core.md](core.md) on `org/core` (PR #153), and the code at `main` `f6d4bbb`. The newest audit was read first: the closing record of slices 6 to 10 (companion repo, `audit-2026-10-24-drafts-slices-6-9/closing-2026-10-26.md`, no open finding of P3 or above, none touching domains or sign-up) and this round's coordinator state (`audit-2026-10-26-plugin-and-org-rounds/STATE.md`), whose focus for this stream is "DNS TXT at `_soupnet-challenge.<domain>`; re-verification freezes auto-join; `hd` claim not the email suffix; the lapsed-domain hazard; seat exhaustion fails closed."

Consumers:
- **Human:** the org admin who adds a domain, publishes the record and turns on automatic joining; the employee whose verification email and verify page say the account will belong to the company; the existing account holder told by Core's notice that their account moved.
- **Agent:** none directly. A joined account's keys reach the org default book through Core's daily links.
- **The other streams:**
  - Core: the one `domainVerifiedFor` fragment this stream fills, and calls to `joinOrganization` with `{ kind: 'domain', domain }`;
  - SSO: one sign-in hook it calls with the Google `hd` claim (the password path works without it, so Domains can merge on its own);
  - Offboarding: the lapsed-domain defence rests on its directory check (OD-H1);
  - Console: the domain routes and the copy its Domains page renders.

Security-relevant: yes. Whoever can make a domain count as verified can move every account on that domain, with its books, into a company. Every auth change gets a test, and the audit is a separate role.

**Settled before this rubric (not reopened):**
- Managed accounts, no mixing (`2301b5eb`).
- Auto-join with immediate access to the org default book, as the stated exception to "no auto-accept" (`f653c2f1`; the exception is already written into `design-thinking.md` on `org/core`).
- Existing accounts on the domain are migrated automatically, through the same setup path, and told (`061a7926`).
- One join routine for every way in, which checks its own authority and refuses at the seat limit (`4da95a34`, Core OC-J1, OC-J5).
- DNS TXT is the method; there is nothing more standard (program §3.2, research §5 item 1).
- Seat exhaustion blocks with a clear message in round 1 (round plan).
- Google sign-ups match on `hd`, not the email suffix (round plan); `email_verified` is trusted only for `@gmail.com` or with `hd` (SSO, `5219c09d`).

**Calls made here** (each checked in `soupnet-oss` under this intent):

- **The record (`4d5b5b81`).** DNS TXT only, at `_soupnet-challenge.<domain>`, with the value `soupnet-domain-verification=<token>`. The token is 32 random bytes, base64url, carrying nothing that names the organization, and a claim that has never been verified expires seven days after its token was issued.
- **Persistent validation (`b79cc790`).** The record must stay. A scheduled job re-checks every verified domain once a day. A check that doesn't find the record freezes automatic joining at once and emails the organization's active owners and admins; fourteen days of failed checks turns the domain unverified, releases it, and rotates its token. Nothing is ever done to existing members or their books. The authority Core's join reads also requires a successful check within the last 48 hours, so a stopped worker freezes joins instead of trusting a stale claim.
- **One switch for every automatic join (`58eb66f7`).** `auto_join` is per domain, off by default.
  - With it on, a new account joins after its owner proves the mailbox: our verification click, or a Google sign-in whose `hd` equals both the verified domain and the address's domain.
  - Existing accounts on the domain with a verified email are migrated whenever the domain becomes captured (it verifies with the switch on, the switch is turned on while verified, or a failing claim recovers) and by the daily job.
  - With it off, nothing joins on the domain's authority; the site operator can still add people through Core's operator path.
  - A site-operator account (`users.role = 'system'`) is never joined automatically.
- **Seats are the operator's allowance, outside the public cap (`15b767de`; draft `8e468d54` for Andy).** A domain join takes the account off the waitlist in the same transaction, and managed accounts stop counting toward the public signup cap. The program left this open (research plan Q7, against the invitations-count precedent `ff1dcfa2`), so it went to Andy as a draft at the planning session's request; the stream builds on the recommendation meanwhile, and the exposure is bounded because only the site operator sets a seat count. If he rules the other way, each half is one clause to remove.
- **Seat exhaustion blocks the proof step (`5406ed04`).** The verification click on a captured domain is refused with Core's `organization_full` copy and leaves the address unverified, so the same link works once a seat frees. A Google sign-in that would create the account creates nothing (SSO rolls back). An existing account the migration can't seat is left exactly as it is, retried by the daily job, and counted, never listed, for the organization's admins.
- **Domain validation, and one verified claim per domain (`ddb90531`).** A curated list of public email providers is refused at add time, with IP literals, single-label names and anything that doesn't normalize to lowercase ASCII. No public-suffix-list dependency: the DNS proof already can't be met under a registry's or a mail provider's zone. Pending claims by several organizations may coexist; a unique index covers verified claims only.
- **The notice goes to the mailbox, not the public form (`43b6aac9`).** For an address on a domain that is captured right now, the verification email and the verify page say the account will belong to the organization, so the joining click is made after reading it. The register form stays byte-identical for every address (F30), so it can't be used as a directory of customers. A Google Workspace sign-in relies on Google's own managed-account notice.
- **The lapsed-domain hazard is named, not solved (`b6e20885`).** The challenge record is public, so whoever buys a lapsed company domain can republish it before the fourteen days run out and keep the claim alive. Their new mailboxes would then join. The defences are listed in OD-H1; the residual goes to the audit as a stated gap.

**Terms and cast.**
- **Acme:** a company organization, created by the site operator (Core OC-B1), claiming `acme.example`.
- **Olive:** Acme's owner. **Ada:** an Acme admin. **Ann:** an ordinary Acme member.
- **Max:** an account on `max@acme.example` that existed, verified, before Acme claimed the domain.
- **Nia:** a new employee signing up as `nia@acme.example`.
- **Gus:** a personal account outside Acme. **Sys:** the site operator.
- **Globex:** another company organization; **Rex** is its admin.
- **Lex:** whoever acquires `acme.example` after Acme lets it lapse.

"Captured" means a domain whose claim is verified, fresh (checked within 48 hours), not failing, and has `auto_join` on: exactly what `domainVerifiedFor` returns true for.

### Where it lives

| # | Criterion | Evidence |
|---|---|---|
| OD-M1 | Pure rules in `@soupnet/domain` (`org-domains.ts`): domain normalization and refusal reasons, the public-provider list, the record name and value, matching a TXT answer, the claim state machine (pending, verified, failing, lapsed, expired) as one pure transition function, the derived status a console shows, and every piece of copy (instructions, refusals, notices, the published re-check frequency and grace period). Layer 1 covers every branch. | `org-domains.test.ts`, 100% branches. |
| OD-M2 | DNS lives in one backend module (`lib/dns-txt.ts`): one lookup of `_soupnet-challenge.<domain>` with a 5-second timeout and two tries, classified as `found`, `absent` (NXDOMAIN, NODATA, or no matching value) or `error` (anything else). The resolver is injected, so every test runs offline. | `dns-txt.test.ts` with a fake resolver for each class. |
| OD-M3 | Every write to `organization_domains` lives in `services/org-domains.service.ts`, and the only read outside it is Core's `domainVerifiedFor` fragment in `authz/domain-authority.ts`, the one authz edit this stream makes. A static test, in the shape of `intent-link.test.ts`, fails on any other file that names the table (registered: the schema, the migration, the data-model doc, the deletion cascade). | The static test plants a reference in a fixture and sees it fail. |
| OD-M4 | Joins go through Core's `joinOrganization` only, with `{ kind: 'domain', domain }`. This stream writes no `organization_members` or `group_members` row. | Diff review; Core's seam guard (OC-M1) passes unchanged. |

### Schema (migration `0046`)

| # | Criterion | Evidence |
|---|---|---|
| OD-S1 | `organization_domains`: `id`, `organization_id` (FK, company organizations only, checked by the service), `domain` (lowercase ASCII, check constraint `domain = lower(domain)`), `challenge_token`, `token_issued_at`, `verified_at` (null while pending or after a lapse), `last_checked_at`, `last_found_at`, `failing_since`, `auto_join` (boolean, default false), `added_by` (no FK, like the audit log), `created_at`. `UNIQUE (organization_id, domain)`; a partial unique index on `domain WHERE verified_at IS NOT NULL` (one verified claim per domain site-wide); an index on `domain`. | Migration review; `check:data-model`; Layer 3: Globex can add `acme.example` as pending while Acme's is pending, and can't verify it while Acme's is verified. |
| OD-S2 | The migration is `0046`, generated with drizzle-kit on a tree that already holds Core's `0044` and SSO's `0045` (both branches brought in locally first), never against `main` as it stands, where drizzle-kit would mint `0043` and repeat F106/F108 (audit, rubric stage). If the planned sequence shifts, drizzle-kit renumbers it; the journal is never edited by hand. The deletion cascade removes an organization's domain rows with the organization. | The journal on the branch; `auth-delete-cascade` test extended by one row. |

### Verification

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-V1 | Ada adds `Acme.Example.` and gets back `acme.example` with `recordName` `_soupnet-challenge.acme.example`, `recordValue` `soupnet-domain-verification=<token>`, `tokenExpiresAt` (seven days) and the published re-check frequency and grace period. An internationalized name is stored in its ASCII (punycode) form. Adding a domain Acme already holds returns the existing claim, re-issuing the token only if a pending one has expired. | ORG-DOM-01 | Layer 1 on normalization; Layer 3 on the route. |
| OD-V2 | Refused at add time, each with its own plain reason and no row written: an IP literal, a single-label name, a name that doesn't normalize, a public or hosted-mail provider's domain, and a domain another organization holds verified ("This domain is already verified by another organization. Contact Soup.net support.", naming no organization). The provider list (audit, rubric stage) covers exact names (`gmail.com`, `googlemail.com`, `icloud.com`, `me.com`, `mac.com`, `proton.me`, `protonmail.com`, `pm.me`, `aol.com`, `mail.com`, `zoho.com`, `fastmail.com`, `hey.com` and the rest), the hosted-tenant suffix `onmicrosoft.com` and anything under it, and the brands that register many country domains (`yahoo.*`, `hotmail.*`, `live.*`, `outlook.*`, `gmx.*`, `msn.*`, `ymail.*`, `yandex.*`), matched as the brand label followed by a one- or two-label country or generic ending (`yahoo.co.uk`, `gmx.de`), so a company's own `yahoo.acme.example` is not caught. | ORG-DOM-02 | Layer 1 per reason and per list shape; Layer 3 for the taken case. |
| OD-V3 | "Check now" looks the record up once. Found: the claim becomes verified (`verified_at`, `last_checked_at`, `last_found_at` set). Absent or error: it stays pending, and the answer says no matching record was found at the record name, without echoing any TXT value seen there. An expired pending claim is refused with `challenge_expired` and the way forward (add the domain again for a new token). | ORG-DOM-03 | Layer 3 with an injected resolver: found, absent, error, a TXT at the label with the wrong value, and expired. |
| OD-V4 | "Check now" is rate-limited per organization (10 per 15 minutes) so the route can't be used to drive DNS queries. | — | Layer 3: the eleventh call gets 429. |
| OD-V5 | The resolved answer must contain the exact value as one complete string after joining the record's character-strings; a record that merely contains the token as a substring of a longer value, or names the token without the prefix, does not verify. | ORG-DOM-03 | Layer 1. |

### Re-verification

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-R1 | A pg-boss schedule (`org-domains.recheck`, daily) re-checks every claim with `verified_at` set. Each claim's result is applied under a row lock on that claim, so "check now" and the job can't interleave. | ORG-DOM-04 | Layer 1 on the transition function; Layer 3 by invoking the job's handler with an injected resolver. |
| OD-R2 | A failed check (absent or error) on a verified claim sets `failing_since` (kept from the first failure), which freezes automatic joining at once: `domainVerifiedFor` is false from that moment. On the transition to failing, Acme's active owners and admins get one email through the logged sender saying which record is missing (by its name), what is frozen, and the date the domain becomes unverified. Neither this email nor the lapse email carries a token value; the token appears only in the console (audit, rubric stage). | ORG-DOM-04 | Layer 3: after one failing check, Nia's verification click verifies her address and joins nothing (OD-J2); `email_log` holds one row per recipient. |
| OD-R3 | A successful check clears `failing_since`, and joining resumes; no email is sent. | ORG-DOM-05 | Layer 3. |
| OD-R4 | Fourteen days after `failing_since`, the next failed check lapses the claim: `verified_at` and `failing_since` cleared, the token rotated and re-issued (seven days to publish the new one), the unique index released, and a second email to the owners and admins. `auto_join` keeps its value, so re-verifying with the new token resumes it. | ORG-DOM-06 | Layer 1 on the boundary (13 days 23 hours, 14 days); Layer 3. |
| OD-R5 | Nothing in OD-R2 to R4 touches members, roles, books or keys. Max, Nia and Ann are exactly as they were after a lapse. | ORG-DOM-06 | Layer 3: membership rows and book rows compared before and after. |
| OD-R6 | `domainVerifiedFor(orgId, domain)` is true only when the claim exists for that organization and domain, `last_checked_at` is within 48 hours, `verified_at` is set, `failing_since` is null, and `auto_join` is on (Core agreed the switch sits inside the fragment). A stopped job therefore freezes joins within two days. | ORG-DOM-07 | Layer 3 for each clause turned false in turn, the 48-hour freshness clause first (it is what makes the daily schedule safe), through Core's join with a domain authority. |
| OD-R7 | After Acme's claim lapses, Globex can verify `acme.example` and starts with nobody: Max, Nia and Ann stay in Acme (Core refuses `already_in_an_organization`), and nothing of Acme's is visible to Globex. | ORG-DOM-08 | Layer 3. |

### Automatic joining

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-J1 | With `acme.example` captured, Nia registers with a password. The register response is byte-identical to any other registration (F30). Her verification email says the account will belong to Acme and Acme's admins will manage it. Her verification click verifies the address and joins her to Acme in one transaction (`via = 'domain'`, Core's org-wide books, the default book in her daily links), and the verify response and page say so, on that click and on any later visit of the link (the response names the organization that manages the account). | ORG-JOIN-D01 | Layer 3: the two register bodies compared; the verify response; her membership and default-book row. |
| OD-J2 | With the domain verified but `auto_join` off, or failing, or stale, Nia's click verifies her address and joins nothing. With `auto_join` off she has a personal account by the organization's choice; while failing or stale she joins with the next migration once the domain is captured again (OD-X1). | ORG-JOIN-D02 | Layer 3, one case per reason. |
| OD-J3 | SSO merges first and ships a named hook, `afterGoogleSignIn(tx, { userId, email, hd, created })` in `services/google-sign-in.service.ts`, returning `none`; it calls the hook inside the transaction that creates or links the account, before the session is issued, rolls back on `full` when `created`, and evaluates the waitlist after the hook returns. This stream replaces the hook's body with a call to `onGoogleSignIn(tx, { userId, email, hd })` and touches nothing else in the callback. `onGoogleSignIn` joins when `hd` is present and equals both the captured domain and the address's domain, and returns `joined`, `full` or `none`. A Google account with no `hd` (SSO passes null) joins nothing here; SSO sends it our verification email (`5219c09d`), and the click joins it under OD-J1. | ORG-JOIN-D03 | Layer 3 calling `onGoogleSignIn` directly, and through `afterGoogleSignIn` (filled; SSO's `57780e1`): a new account joins via `domain`, an existing one via `migrated` with Core's notice, and no `hd` does nothing. The callback's rollback on `full` is SSO's test. |
| OD-J4 | A join at the proof step (the verification click, or a Google sign-in) records `via = 'domain'`, and the verification email or Google's notice was its notice. Every join by the migration (OD-X1) records `via = 'migrated'` and gets Core's notice, since that person proved the mailbox earlier and wasn't told then. | ORG-JOIN-D01, ORG-MIG-01 | Layer 3 on the audit row's `via` and `noticeOwed`. |
| OD-J5 | A site-operator account on a captured domain is never joined automatically, on any path. | ORG-JOIN-D04 | Layer 3. |
| OD-J6 | An account already in another company organization (Globex, by the operator's hand) verifies normally and stays where it is (Core's `already_in_an_organization`, not an error to the person). | ORG-JOIN-D05 | Layer 3. |
| OD-J7 | A second click on the same verification link after joining succeeds and changes nothing. | ORG-JOIN-D01 | Layer 3. |
| OD-J8 | Domain equality everywhere, never a suffix (verification and audit coordinators, rubric stage). Subdomains are verified separately: an address on `mail.acme.example` is not on `acme.example`, so a claim on the parent neither joins nor migrates it, and the console copy says so. The address's domain part is normalized exactly as a claim is (lowercase, punycode), so `nia@BÜCHER.example` is on `xn--bcher-kva.example`. | ORG-JOIN-D06 | Layer 1 on `addressDomain` and the equality helper; Layer 3: `nia@mail.acme.example` neither joins on her click (OD-J1) nor migrates (OD-X1), and `hd = acme.example` with that address returns `none` (OD-J3). |

### Existing accounts on the domain

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-X1 | The migration is the account-capture surface of the round, so it is one function, `migrateDomainAccounts(db, claimId)`, and every trigger calls it: the claim verifying with `auto_join` on, Ada turning it on while verified, a failing claim recovering, and every run of the daily job. Its precondition is `domainVerifiedFor` itself, read in the same transaction as each join, so no trigger can migrate on a domain that isn't captured. It joins every account whose verified email is on `acme.example` (OD-J8), that is in no company organization and is not a site-operator account, through Core's `joinOrganizationInTx` with `via = 'migrated'`, one transaction per account. Each migrated account gets its own audit row (`organization_domain.migrated`) naming the claim id and domain that authorised it, beside Core's join row. Max's books move under Acme (Core OC-J2) and he is told by email after commit (Core's `sendJoinNotice`, OC-J4). A request that made the domain captured returns `{ joined, awaitingSeat }` counts. | ORG-MIG-01 | Diff review: one caller per trigger, all into the one function; Layer 3: before and after for Max, the audit row naming the claim, and a person who verified while the claim was failing joining on recovery. |
| OD-X2 | An account with an unverified email is never migrated; it joins on its own verification click under OD-J1. | ORG-MIG-02 | Layer 3. |
| OD-X3 | The migration runs at most 200 accounts in the triggering request; the daily job continues any remainder and retries accounts left waiting for a seat. | ORG-MIG-03 | Layer 3 with the batch size lowered in the test. |
| OD-X4 | The domain list shows `accountsAwaitingJoin` for a verified claim: a count, never a list, of verified accounts on the domain in no company organization. The count isn't shown for a pending claim, so adding a domain without the record proves nothing about who is on it. | ORG-MIG-04 | Layer 3: the field is absent on a pending claim. |

### Seats and the signup cap

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-C1 | At Acme's seat limit, Nia's verification click is refused with 409 `organization_full` ("This organization has no free seats. Ask one of its admins."), and her address stays unverified, so she can't sign in. Once a seat frees, the same link (inside its 24 hours) or a resent one verifies and joins her. | ORG-SEAT-D01 | Layer 3: the refused click; `email_verified_at` still null; a disable frees a seat; the retried click joins. |
| OD-C2 | At the seat limit, `onGoogleSignIn` returns `full` and SSO creates no account (the transaction rolls back). For an existing account that Google links, `full` leaves the account as it is. | ORG-SEAT-D02 | Layer 3 on the hook's return; the rollback is SSO's test. |
| OD-C3 | At the seat limit the migration leaves Max exactly as he is and counts him in `awaitingSeat` and `accountsAwaitingJoin`; the daily job joins him once a seat frees. | ORG-SEAT-D03 | Layer 3. |
| OD-C4 | A domain join clears the account's `waitlisted_at` in the join's transaction, so Nia isn't left on the public waitlist when the public cap is full. | ORG-SEAT-D04 | Layer 3 with the cap at its limit. |
| OD-C5 | `getVerifiedUserCount` no longer counts managed accounts, through Core's `accountIsManaged(sql\`u.id\`)` fragment rather than naming `organization_members`. | ORG-SEAT-D04 | Layer 3: Acme gaining a member leaves the public count unchanged. |

### Admin routes

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-A1 | `GET /organizations/:id/domains`, `POST /organizations/:id/domains` (`domain`), `POST /organizations/:id/domains/:domainId/check`, `PATCH /organizations/:id/domains/:domainId` (`autoJoin`) and `DELETE /organizations/:id/domains/:domainId`, for an active owner or admin of that organization (JWT, verified email; Core's `activeOrgManagerRole`). Anyone else, including Rex and an ordinary Acme member, gets Core's uniform 404 (`ORGANIZATION_NOT_FOUND` from `@soupnet/domain`), byte-identical to the 404 for an organization or domain id that doesn't exist or is malformed. A domain id belonging to another organization is that same 404. A disabled Acme admin never reaches the gate: Core's session lookup refuses every JWT route for a disabled account with 403 `account_disabled` (OC-A1). | ORG-DOM-09 | Layer 3, bodies compared byte for byte; the disabled admin's 403. |
| OD-A2 | Each listed claim carries `id`, `domain`, `status` (`pending`, `verified`, `failing`, `expired`), `recordName`, `recordValue`, `tokenExpiresAt` (pending only), `verifiedAt`, `lastCheckedAt`, `failingSince`, `lapsesAt` (failing only), `autoJoin`, and `accountsAwaitingJoin` (verified only). | ORG-DOM-01 | Layer 3 response shape. |
| OD-A3 | Deleting a claim stops automatic joining on it at once and touches no member. | ORG-DOM-10 | Layer 3. |
| OD-A4 | Every add, verification, failure, lapse, auto-join change and removal writes an audit row naming the organization, the domain and the actor (null for the job). | — | Layer 3 on the rows. |

### The lapsed-domain hazard

| # | Criterion | Evidence |
|---|---|---|
| OD-H1 | The rubric and the console copy state the residual plainly (`b6e20885`): Lex can republish Acme's record and keep the claim alive, and new mailboxes on the domain would join. The defences: (a) the token rotates at lapse, so Lex has to act within the fourteen days; (b) the console tells admins to remove a domain before giving it up (Linear's instruction); (c) a re-verification by another organization never inherits anyone (OD-R7); (d) for an organization with a directory connection, Offboarding's lazy check disables an account the company's Google directory doesn't hold, which a mailbox in Lex's new Workspace isn't. Item (d) is a request to Offboarding, below. | The copy (Layer 1); the request acknowledged by Offboarding. |

### Docs

| # | Criterion | Evidence |
|---|---|---|
| OD-D1 | `docs/product-specs/organization-domains.feature` holds the scenarios above with `# Requirement:` comments (C01-R02, R05, R12) and `# Guards:` lines to design-thinking archetypes 6 and 7, `@unreleased` until the PR that ships each one. | The file. |
| OD-D2 | The admin instructions publish the re-check frequency (daily), the grace period (fourteen days), the challenge lifetime (seven days), how to revoke (remove the record, or delete the domain in the console), and the propagation note ("up to 72 hours"), since the IETF draft makes the first two a MUST for persistent validation. | Layer 1 on the copy. |
| OD-D3 | `CLAUDE.md` (the table and routes), the data-model doc (regenerated), the backlog, and this build log say what landed. The shared docs are folded in by the last stream to merge; this stream appends only here. | Diff review. |

### Requests to other streams

Agreed by each stream on 2026-10-26:

- **Core** (all four, landing in Core's next push): (1) `domainVerifiedFor` includes the `auto_join` switch (OD-R6). (2) `accountIsManaged(userIdColumn)`, a boolean EXISTS exported from `authz`, for the cap count (OD-C5). (3) `joinOrganizationInTx(tx, input)`, exported: it takes the organization row lock (so call it before anything else that could block on that row), returns refusals without throwing, and leaves the notice to the caller, who calls `sendJoinNotice(result)` after commit (nothing for `via: 'domain'`). (4) `activeOrgManagerRole(db, orgId, userId)` and `ORGANIZATION_NOT_FOUND` for the domain routes (OD-A1).
- **SSO**: the `afterGoogleSignIn` hook (OD-J3).
- **Offboarding** (the `org-sso` session): a Directory API 404 for a managed member means deleted, so disabled, through the same `orgMembershipDisabled` path; recorded in `offboarding.md`. That is OD-H1(d).
- **Console.** The Domains page renders OD-A2 and the OD-D2 copy from `@soupnet/domain`.

### Out of this stream

- The console's Domains page (Console).
- Google sign-in and `hd` itself (SSO); the directory check (Offboarding).
- HTTPS-file or meta-tag verification, and any second method (research Q7: DNS only at launch).
- A waiting period before migration (Notion's 14 days): dropped with notify-and-choose by the settled simplification; site-operator-created organizations are the only kind this round.
- A site-operator manual override for verification: not needed while the customer's admin publishes the record (round plan, "What the operator does" step 3).
- An educational-domain carve-out (research Q6): no customer needs it this round.

## Log

- 2026-10-26: worktree from `main` `f6d4bbb`; rubric written and recipe-checked (`4d5b5b81`, `b79cc790`, `58eb66f7`, `15b767de`, `5406ed04`, `ddb90531`, `43b6aac9`, `b6e20885`). Next: the DNS code (OD-M1, OD-M2), which needs no schema; the schema and routes follow Core's implementation on `org/core`.
- 2026-10-26: rubric-stage notes folded in. Audit coordinator (record `audit-2026-10-26-plugin-and-org-rounds/domains-rubric.md`): domain equality, never suffix (OD-J8); migration generated on top of Core's and SSO's files (OD-S2); one migration function behind `domainVerifiedFor` with an audit row per account (OD-X1); the hosted-mail provider list (OD-V2); no token value in emails (OD-R2). Verification coordinator: the subdomain rule as its own row and in the copy, and the address's domain normalized like a claim (OD-J8); the freshness clause first in OD-R6's tests. Planning session: the seats-outside-the-cap call went to Andy as draft `8e468d54`. Core and SSO agreed the shapes under "Requests to other streams".
- 2026-10-26: implementation. Merged `org/core` (`0916b54`) and `org/google-sso` (`8af81ad`): the migration has to be generated on SSO's `0045`, and transplanting only the files left the data-model generator describing SSO's tables without their schema, so the branch carries both until they merge (recipe `3530ba35`; diff against `origin/org/google-sso` to see only Domains). `0046_organization_domains` generated on that tree; drizzle-kit reports no further changes; the journal has the gap at `0043` that Core's has.
  - Built: the table and migration (OD-S1, OD-S2); `domainVerifiedFor` filled, plus `domainClaimCurrentFor`, the same claim test without the switch, which Core asked for its bounded operator join (OC-F1); `services/org-domains.service.ts` with add, list, check now, the switch, delete, the daily `recheckDomains`, the one `migrateDomainAccounts`, `joinOnVerification` and `onGoogleSignIn`; the `/organizations/:id/domains` routes; the `org-domains.recheck` pg-boss schedule (daily, 04:17 UTC) and its queue description; the verify click joining in the same transaction as the verification, refused and rolled back at the seat limit; the join notice in the verification email; the managed-account exclusion from the public cap count; the domain rows in the deletion cascade; the verify page's joined line and no-free-seats state.
  - Tests: Layer 1 `org-domains.test.ts` (38), `dns-txt.test.ts` (5), `seam-hooks.test.ts` (Domains' two rows), `org-domains-seam.test.ts` (OD-M3, plant-tested), `organization-domains-limit.test.ts` (OD-V4: the gate runs with rate limits off, so the limiter instance is tested on its own); Layer 3 `routes/org-domains.test.ts` (21 tests).
  - Test harness: over HTTP, DNS for the reserved `.test` TLD is a deterministic stub in test mode only (`ALLOW_AUTO_SETUP=true` outside production, the switch that already surfaces verification tokens); first label `dns-ok…` publishes every claim's record, `dns-error…` times out, anything else doesn't exist. Service calls take an injected resolver, and the daily job runs narrowed to the test's organization so parallel test files can't touch each other's claims.
  - Harness note (verification coordinator): `dns-txt.ts` takes the challenge label from `@soupnet/domain`, so a by-file vitest run against a stale `packages/domain/dist` fails four of its five tests with `bad_record_name`. Run `npm run build:packages` first; the gate rebuilds.
  - Corrections found by the tests: a disabled Acme admin gets Core's 403 `account_disabled` before reaching the domain routes, not their 404 (OD-A1 and ORG-DOM-09 updated); the lapse test sits an hour past the fourteen-day boundary because the database container's clock and the test host's can differ by seconds.
  - Open: SSO's `afterGoogleSignIn` hook isn't on its branch yet; when it lands this stream fills its body with `onGoogleSignIn` and adds the hook-level Layer 3 (OD-J3). Core swaps its authority check's email comparison for `isAddressOnDomain` in OC-F1, so an internationalized address on an IDN claim can join (until then it fails closed). Core adds `domain-authority` to the authz index in its next push; the service's direct import switches then.
- 2026-10-26: static audit of `5b68cd3` (audit coordinator; record `audit-2026-10-26-plugin-and-org-rounds/domains-5b68cd3.md` in the companion repo): no finding; #158 can merge on its gate after Core and SSO. Cost note for later, not this PR: `accountsAwaitingJoin` loads every eligible account per verified claim on list and on the switch; a count with the same predicate, or a materialized domain-part column on `users`, avoids the scan. To fold into the backlog with the shared docs.
- 2026-10-26: browser verification of the verify page found the SPA blank on every page: `VerifyPage` imported `@soupnet/domain`, whose Node-only modules (`stub-embeddings.ts` imports `node:crypto`) crash the browser bundle, and the SPA deliberately doesn't depend on that package. Fixed at `48ac898`: `POST /auth/verify` sends `organization.notice` and, at the seat limit, `detail`, and the page renders them. The gate didn't catch it because no gate step loads the SPA in a browser; that is what the browser-verify step is for.
- 2026-10-26: browser verification of PR #158 (skill `browser-verify`; a separate verifier agent, Playwright, on a throwaway stack: this worktree's backend on 3471 against database `soupnet_domains_verify`, the SPA on 5471, never the shared dev stack). First run at `48ac898`: E1 to E5 met. It also found that the organization line showed only on the joining click, and that the no-free-seats view offered no way to sign in. Both were fixed, and the second run met E1 to E6 and the reload, 9 of 9 on desktop and mobile; axe reported no serious or critical violation. The spec is `tests/e2e/pr-158.spec.ts`, offered for the suite in the PR.
- 2026-10-26: merged Core `73b960f` (the `domain-authority` index export; the service now imports from `../authz`) and SSO `d560692`; filled SSO's `afterGoogleSignIn` with `onGoogleSignIn`. An existing account that Google links on a captured domain joins via `migrated` with Core's notice, a new one via `domain`. Test addresses take the `test-orgdom-` prefix: GitHub CI on `5b68cd3` failed "GET /admin/users sorts by email asc", which compares Postgres's collation order with a code-point sort over the first 20 addresses, and my short `a-`/`b-` local parts sorted to the front, where the two orders differ. That test stays fragile for any suite that adds early-sorting addresses (backlog note for the fold-in). CLAUDE.md names the table and the routes (OD-D3).
- 2026-10-26: GitHub CI green on `850317d` (Typecheck + Lint + Test, ranking eval, embeddings smoke); "GET /admin/users sorts by email asc" passes with the prefixed addresses. Audit read of `5b68cd3..850317d`: the hook's transaction boundary holds, and #158 stays clear to merge after Core and SSO. Follow-up once SSO and Domains are both on `main` (observation, not a finding): the existing-account notice is dispatched from inside SSO's transaction, so a failure at commit could send "you joined" for a join that didn't persist. The clean shape is for `resolveAccount` to return the join result and SSO to call `sendJoinNotice` after commit, matching that function's contract. It's one line on each side.
