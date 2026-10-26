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
- **Seats are the operator's allowance, outside the public cap (`15b767de`).** A domain join takes the account off the waitlist in the same transaction, and managed accounts stop counting toward the public signup cap.
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
| OD-S2 | The migration is `0046`, generated with drizzle-kit on top of whatever `main` holds when the branch first carries schema, renumbered by drizzle-kit (never by editing the journal) if the planned sequence shifts. The deletion cascade removes an organization's domain rows with the organization. | The journal on the branch; `auth-delete-cascade` test extended by one row. |

### Verification

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-V1 | Ada adds `Acme.Example.` and gets back `acme.example` with `recordName` `_soupnet-challenge.acme.example`, `recordValue` `soupnet-domain-verification=<token>`, `tokenExpiresAt` (seven days) and the published re-check frequency and grace period. An internationalized name is stored in its ASCII (punycode) form. Adding a domain Acme already holds returns the existing claim, re-issuing the token only if a pending one has expired. | ORG-DOM-01 | Layer 1 on normalization; Layer 3 on the route. |
| OD-V2 | Refused at add time, each with its own plain reason and no row written: an IP literal, a single-label name, a name that doesn't normalize, a public email provider (`gmail.com`, `outlook.com` and the rest of the list), and a domain another organization holds verified ("This domain is already verified by another organization. Contact Soup.net support.", naming no organization). | ORG-DOM-02 | Layer 1 per reason; Layer 3 for the taken case. |
| OD-V3 | "Check now" looks the record up once. Found: the claim becomes verified (`verified_at`, `last_checked_at`, `last_found_at` set). Absent or error: it stays pending, and the answer says no matching record was found at the record name, without echoing any TXT value seen there. An expired pending claim is refused with `challenge_expired` and the way forward (add the domain again for a new token). | ORG-DOM-03 | Layer 3 with an injected resolver: found, absent, error, a TXT at the label with the wrong value, and expired. |
| OD-V4 | "Check now" is rate-limited per organization (10 per 15 minutes) so the route can't be used to drive DNS queries. | — | Layer 3: the eleventh call gets 429. |
| OD-V5 | The resolved answer must contain the exact value as one complete string after joining the record's character-strings; a record that merely contains the token as a substring of a longer value, or names the token without the prefix, does not verify. | ORG-DOM-03 | Layer 1. |

### Re-verification

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-R1 | A pg-boss schedule (`org-domains.recheck`, daily) re-checks every claim with `verified_at` set. Each claim's result is applied under a row lock on that claim, so "check now" and the job can't interleave. | ORG-DOM-04 | Layer 1 on the transition function; Layer 3 by invoking the job's handler with an injected resolver. |
| OD-R2 | A failed check (absent or error) on a verified claim sets `failing_since` (kept from the first failure), which freezes automatic joining at once: `domainVerifiedFor` is false from that moment. On the transition to failing, Acme's active owners and admins get one email through the logged sender saying which record is missing, what is frozen, and the date the domain becomes unverified. | ORG-DOM-04 | Layer 3: after one failing check, Nia's verification click verifies her address and joins nothing (OD-J2); `email_log` holds one row per recipient. |
| OD-R3 | A successful check clears `failing_since`, and joining resumes; no email is sent. | ORG-DOM-05 | Layer 3. |
| OD-R4 | Fourteen days after `failing_since`, the next failed check lapses the claim: `verified_at` and `failing_since` cleared, the token rotated and re-issued (seven days to publish the new one), the unique index released, and a second email to the owners and admins. `auto_join` keeps its value, so re-verifying with the new token resumes it. | ORG-DOM-06 | Layer 1 on the boundary (13 days 23 hours, 14 days); Layer 3. |
| OD-R5 | Nothing in OD-R2 to R4 touches members, roles, books or keys. Max, Nia and Ann are exactly as they were after a lapse. | ORG-DOM-06 | Layer 3: membership rows and book rows compared before and after. |
| OD-R6 | `domainVerifiedFor(orgId, domain)` is true only when the claim exists for that organization and domain, `verified_at` is set, `failing_since` is null, `last_checked_at` is within 48 hours, and `auto_join` is on. A stopped job therefore freezes joins within two days. | ORG-DOM-07 | Layer 3 for each clause turned false in turn, through Core's `joinOrganization` with a domain authority. |
| OD-R7 | After Acme's claim lapses, Globex can verify `acme.example` and starts with nobody: Max, Nia and Ann stay in Acme (Core refuses `already_in_an_organization`), and nothing of Acme's is visible to Globex. | ORG-DOM-08 | Layer 3. |

### Automatic joining

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-J1 | With `acme.example` captured, Nia registers with a password. The register response is byte-identical to any other registration (F30). Her verification email says the account will belong to Acme and Acme's admins will manage it. Her verification click verifies the address and joins her to Acme in one transaction (`via = 'domain'`, Core's org-wide books, the default book in her daily links), and the verify response and page say so. | ORG-JOIN-D01 | Layer 3: the two register bodies compared; the verify response; her membership and default-book row. |
| OD-J2 | With the domain verified but `auto_join` off, or failing, or stale, Nia's click verifies her address and joins nothing. With `auto_join` off she has a personal account by the organization's choice; while failing or stale she joins with the next migration once the domain is captured again (OD-X1). | ORG-JOIN-D02 | Layer 3, one case per reason. |
| OD-J3 | `onGoogleSignIn(tx, { userId, email, hd })`, exported for SSO, joins when `hd` is present and equals both the captured domain and the address's domain, inside SSO's transaction, and returns `joined`, `full` or `none`. A Google account with no `hd` on a company address joins nothing here; SSO sends it our verification email (`5219c09d`), and the click joins it under OD-J1. | ORG-JOIN-D03 | Layer 3 calling the hook directly (SSO merges after this stream). |
| OD-J4 | A join at the proof step (the verification click, or a Google sign-in) records `via = 'domain'`, and the verification email or Google's notice was its notice. Every join by the migration (OD-X1) records `via = 'migrated'` and gets Core's notice, since that person proved the mailbox earlier and wasn't told then. | ORG-JOIN-D01, ORG-MIG-01 | Layer 3 on the audit row's `via` and `noticeOwed`. |
| OD-J5 | A site-operator account on a captured domain is never joined automatically, on any path. | ORG-JOIN-D04 | Layer 3. |
| OD-J6 | An account already in another company organization (Globex, by the operator's hand) verifies normally and stays where it is (Core's `already_in_an_organization`, not an error to the person). | ORG-JOIN-D05 | Layer 3. |
| OD-J7 | A second click on the same verification link after joining succeeds and changes nothing. | ORG-JOIN-D01 | Layer 3. |

### Existing accounts on the domain

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-X1 | The migration runs whenever a domain becomes captured (Acme's claim verifies with `auto_join` on, Ada turns it on while verified, or a failing claim recovers) and on every run of the daily job. It joins every account whose verified email is on `acme.example`, that is in no company organization and is not a site-operator account, through Core's routine with `via = 'migrated'`. Max's books move under Acme (Core OC-J2) and he is told by email (OC-J4). A request that made the domain captured returns `{ joined, awaitingSeat }` counts. | ORG-MIG-01 | Layer 3: before and after for Max; a person who verified while the claim was failing joins on recovery. |
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
| OD-C5 | `getVerifiedUserCount` no longer counts managed accounts, through a Core-exported fragment rather than naming `organization_members`. | ORG-SEAT-D04 | Layer 3: Acme gaining a member leaves the public count unchanged. |

### Admin routes

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OD-A1 | `GET /organizations/:id/domains`, `POST /organizations/:id/domains` (`domain`), `POST /organizations/:id/domains/:domainId/check`, `PATCH /organizations/:id/domains/:domainId` (`autoJoin`) and `DELETE /organizations/:id/domains/:domainId`, for an active owner or admin of that organization (JWT, verified email). Anyone else, including Rex and a disabled Acme admin, gets Core's uniform 404, byte-identical to the 404 for an organization or domain id that doesn't exist. A domain id belonging to another organization is that same 404. | ORG-DOM-09 | Layer 3, bodies compared byte for byte. |
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

- **Core.** (1) `domainVerifiedFor` gains the `auto_join` clause as well as verification (OD-R6), so no future caller can join on a domain's authority with the switch off. (2) An exported fragment for "this account is managed" over a user-id column, for the signup cap count (OD-C5). (3) `joinOrganization` usable inside a caller's transaction (the verify click and SSO's hook both roll back on `organization_full`); a savepoint through Drizzle's nested transaction is enough if the routine accepts a transaction handle. (4) The active-owner-or-admin check and uniform 404 from OC-R1, exported for the domain routes.
- **SSO.** Call `onGoogleSignIn` inside the transaction that creates or links an account from a Google sign-in, after the account row exists; on `full` for a new account, roll back and show the `organization_full` copy. The hook does nothing when `hd` is absent.
- **Offboarding.** Treat a user the customer's directory doesn't know (Directory API 404) like a deleted user: disabled. That is OD-H1(d).
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
