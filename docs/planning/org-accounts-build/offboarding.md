# Organization accounts round 1: stream Offboarding

Build log for stream Offboarding of [org-accounts-round-1.md](../org-accounts-round-1.md): a company's Google Workspace directory, checked lazily, switches off a member the company has suspended or removed. Branch `org/offboarding`, stacked on `org/google-sso` (the same stream session, `org-sso`; stacks are allowed inside a stream), worktree `SoupNet-wt/org-offboarding`.

## Rubric

Written 2026-10-26 by the `org-sso` session (agent `a-org-sso-2026-10-26`, intent `int_qr1i3GMBOcmEK2v8iXfCTMfa`) before implementation. It draws on the round plan's Offboarding row, the program's §0 offboarding ruling (`3650aed9`) and settled simplifications, §3.9 with the research in [offboarding-deprovisioning.md](../org-accounts-research/offboarding-deprovisioning.md), stream Core's account-state fragment (`orgMembershipDisabled`, [core.md](core.md) OC-M2), stream SSO's identities and Google client ([sso.md](sso.md)), and stream Domains' verified domains (PR #158, `domainVerifiedFor`). The security record was read first, as for SSO; the round coordinator's focus list for this stream is answered row by row: one in-flight check per user, a short timeout, the last status served up to a day then fail closed, credentials encrypted and never logged, inferred signals never hard-disabling.

Consumers:
- **Human:** a company's owner or admin connecting the Workspace directory; a departed employee whose sign-in stops working.
- **Agent:** every API-key surface, through the account-state join: a departed employee's keys stop working within the hour.
- **The other streams:** Console shows each member's last directory check and status, and the connection's state, from what this stream records.

Security-relevant: yes. The stream holds a credential that reads a customer's directory, calls Google from inside credential validation, and adds a reason an account is switched off. Every auth change gets a test, and the audit is a separate role.

**Settled before this rubric (not reopened):**
- Lazy and hourly, at the moment a credential is used, with no worker; an admin who needs it faster disables by hand (`3650aed9`).
- The directory status lands in Core's `orgMembershipDisabled(om)` and nowhere else, so it is read by the same join as a manual disable, never by sweeping keys (`92b866ee`).
- Two ways to connect, both feeding one status: the customer's admin marks the app trusted and consents once to read-only directory access, or the customer brings a service account (settled simplifications).
- One in-flight check per user, a short timeout, the last status kept up to a day when Google can't be reached, then fail closed (settled simplifications).
- The Directory API's `suspended` and `archived` flags are the source (research §2.4).

**Calls made here** (each checked in `soupnet-oss` under this intent):

- **Who is checked, and what a 404 means (`88b1b328`).** Only members whose account address, or linked Google identity's `hd`, is on the connection's domain are checked. A member the directory doesn't know (404) is deleted, and switched off like a suspended one. A person who left loses access within the hour, a buyer of a lapsed company domain gets nothing from recreated mailboxes (stream Domains' request), and a member the operator added on another address isn't switched off by a directory that never held them.
- **Connecting (`1a22971a`).** The admin-consent route reuses stream SSO's Google client and its one redirect URI, as a second kind of pending request: the read-only directory scope with offline access, started by an org owner or admin. It completes only when the consenting Google account is the one linked to the person who started, and its `hd` is a domain stream Domains has verified for the organization. The refresh token, or a customer's service-account key, is stored encrypted with AES-256-GCM under a key held only in the deployment's secrets, and never logged. The operator registers nothing new with Google, ordinary members only ever see the sign-in scopes, and a database leak alone exposes no customer's directory.
- **The check inside validation (`6214370b`).** A due check (status older than an hour) is claimed with one conditional update on the member's row, so across server tasks one asks Google per person while the others answer from the last status. Google gets two seconds. When Google can't be reached, the last status stands; once the last successful check is a day old (a never-checked member counts from when the directory was connected), the member is switched off until a check succeeds. Google refusing our own credential is the connection's error, logged for the operator, and never read as a member's status.

- **A broken connection locks out everyone on the domain, owners and admins too, and recovery is the site operator's (draft `47f9620f`, for Andy).** The stale rule stays for everyone, since exempting admins is exactly the departed-admin case the customer asked to close. Before it bites, the organization's owners and admins get one email when the connection has been refused or unreachable for six hours, naming the hour it fails closed and the fix (reconnect, or switch to a service account). After a lockout the site operator recovers by hand: the connection's DELETE through the admin route, or re-consent with the company's admin on a call. This follows the "no break-glass, the site operator helps by hand" ruling for `require_sso`; the alternative was exempting active owners and admins from the stale clause only.
- **A directory refusal says so (`efa4bbca`).** It has its own reasons beside Core's two: `directory_inactive` ("Your organization's Google Workspace doesn't list this account as active. Ask one of your organization's admins.") for a suspended, archived or unknown member, and `directory_unconfirmed` ("Soup.net couldn't confirm this account with your organization's Google Workspace. Ask one of your organization's admins to check the directory connection.") for a stale check. The console labels them the same way, apart from an admin's disable. Agents still get the uniform dead-key answer.

**Terms and cast.**
- **Acme:** a company organization with the verified domain `acme.example` (stream Domains).
- **Olive:** Acme's owner, a Workspace admin, signed in with Google.
- **Max:** an Acme member on `max@acme.example`.
- **Rae:** an Acme member the operator added on `rae@consultancy.example`.
- **Mal:** someone who created `mallory@acme.example` after buying the lapsed domain.
- **Google:** the Directory API (the fake issuer's directory routes in tests).

"Due" means the member is checked (above) and their `directory_checked_at` is null or more than an hour old. "Stale" means the last successful check (or, never checked, the connection's `connected_at`) is more than a day old. Every time comparison uses the database's clock on both sides (recipe `d3f3f158`'s lesson, the other way round: these stamps are all written by the database).

### Where it lives

| # | Criterion | Evidence |
|---|---|---|
| OB-M1 | The rule is in the authz module: `orgMembershipDisabled()` in `account-state.ts` gains the directory clauses (a suspended, archived or deleted status, or a stale check, for a checked member), and the lazy step lives in `authz/directory-check.ts`, called from `authenticateKey`, the session lookup and OAuth refresh, and nowhere else. `accountDisabledReason()` gains `directory_inactive` and `directory_unconfirmed` (after `suspended` and an admin's `org_disabled`), and the session middleware and login answer them with their own copy. `seam-hooks.test.ts`'s row for the fragment is updated. | `check:authz-seam`; the seam-hooks row; diff review. |
| OB-M2 | Google calls live in `services/google-directory.service.ts`: the access token from a refresh token or a service-account assertion (JWT bearer, RS256, the read-only directory scope, `sub` the stored admin address), cached per organization in memory until a minute before it expires, and `users.get` by the member's stored Soup.net address exactly, the one whose credential is being judged (never a value from the request or another row; see "Settled before building"). The encryption is `lib/secret-box.ts`: AES-256-GCM, a random 96-bit IV per value, the organization id as additional authenticated data (a ciphertext moved to another row fails), the key from `DIRECTORY_CREDENTIALS_KEY` (32 bytes, hex or base64, length checked at startup) with a `key_version` on the row for rotation. | Layer 1 with generated keys and injected fetch; a ciphertext decrypted under another organization's id fails; a test with two similar addresses asserts each check names its own. |
| OB-M3 | Pure rules in `@soupnet/domain` (`directory.ts`): mapping a Directory answer to a status (`active`, `suspended`, `archived`, `deleted`) or to a connection error, whether a member is checked, and the due and stale tests. "Checked" uses stream Domains' exact-domain rule (OD-J8): the address's domain part, normalised as Domains normalises it, equals the connection's domain exactly, with no subdomains (`max@eu.acme.example` is not checked by a connection for `acme.example`); a linked identity's `hd` is compared the same way. 100% branches. | `directory.test.ts`, with the subdomain and case cases. |

### Schema (migration `0047`)

| # | Criterion | Evidence |
|---|---|---|
| OB-S1 | `organization_directory_connections`: `organization_id` (unique FK), `kind` (`admin_consent`, `service_account`; check), `domain`, `admin_email`, `credential_ciphertext`, `credential_iv`, `credential_tag`, `key_version`, `connected_by`, `connected_at`, `last_success_at`, `last_error`, `last_error_at`. | Migration review; `check:data-model`. |
| OB-S2 | `organization_members` gains `directory_status` (null, `active`, `suspended`, `archived`, `deleted`; check), `directory_checked_at` (last successful check) and `directory_check_claimed_at`. | Migration review. |
| OB-S3 | `sso_login_requests.return_kind` gains `directory_connect`. | Migration review. |
| OB-S4 | The migration is `0047`, generated on Domains' `0046`. | The journal. |

### The check

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OB-C1 | Google reports Max suspended: his next request on any surface (any key, the session, OAuth refresh) runs the check, records `suspended`, and is refused through the same join as a manual disable (agents get the uniform dead-key answer; the session 403 `directory_inactive` with its copy). No key row changes. | OFF-DIR-01 | Layer 3 with the fake directory; key rows compared before and after. |
| OB-C2 | Google reports Max active again: the next due check records `active` and the same keys and session work. | OFF-DIR-02 | Layer 3. |
| OB-C3 | A 404 for Max records `deleted` and refuses him; so does `archived`. | OFF-DIR-03 | Layer 3. |
| OB-C4 | Within the hour, no Google call: twenty requests by Max after a check make no further directory request. | OFF-DIR-04 | Layer 3, the fake's request count. |
| OB-C5 | One in flight: twenty concurrent requests by a due Max make one directory request, and every one of them is answered (those that lost the claim from the last status). The claim is one conditional UPDATE that a claim older than 30 seconds also wins, so a task that died mid-check doesn't leave the member unchecked for the hour. No transaction is held across the Google call: claim, call, then one short statement records the result. | OFF-DIR-05 | Layer 3, concurrent requests, the fake's count; a stale claim backdated and reclaimed; diff review for the transaction boundary. |
| OB-C6 | Google slow (over two seconds) or failing (5xx, network): the request is answered from the last status, the claim is released for the next request, and nothing is recorded as Max's status. | OFF-DIR-06 | Layer 3 with the fake delaying and failing. |
| OB-C7 | Stale: with Google failing and Max's last successful check backdated past a day, Max is refused (the session 403 `directory_unconfirmed`); a never-checked member is refused once the connection is a day old with no success; one successful check restores either. | OFF-DIR-07 | Layer 3, timestamps backdated. |
| OB-C8 | Our credential refused (401, 403, `invalid_grant` on the token): the connection's `last_error` is set and logged (the organization id and Google's error code, never the credential), and members are treated as in OB-C6, so the stale rule decides. Six hours after the connection's last success with an error since, its owners and admins get one email (through the logged sender) naming the hour it fails closed and the fix; it is sent once per outage, and a success re-arms it (draft `47f9620f`). | OFF-DIR-08 | Layer 3; the log line read for absence of the secret; `email_log` has one row per outage. |
| OB-C9 | Not checked: Rae (another domain) and every member of an organization with no connection make no directory request and are never refused by this rule, and nor is anyone once the connection's domain claim is no longer current (stream Domains' freshness: a lapsed claim stops the checks rather than switching people off). Mal (on the domain, unknown to the directory) is refused and recorded as `deleted`, which the console shows as "not in the directory", distinctly from "suspended". | OFF-DIR-09 | Layer 3. |
| OB-C10 | Disconnecting (below) stops every check, and members switched off only by the directory work again at once. | OFF-DIR-10 | Layer 3. |
| OB-C11 | A status change writes one audit row (`organization.member_directory_status`, actor null, the member as target, `{ from, to }`). | — | Layer 3. |

### Connecting

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OB-K1 | `POST /organizations/:id/directory/google/start` `{ binding, domain }` by an active owner or admin (anyone else: Core's uniform 404), with `domain` verified for the organization (`domainVerifiedFor`), returns Google's URL with scopes `openid email https://www.googleapis.com/auth/admin.directory.user.readonly`, `access_type=offline`, `prompt=consent` and `hd=<domain>`. | OFF-CON-01 | Layer 3. |
| OB-K2 | The shared callback branches on the request's kind before any account resolution, so a `directory_connect` request never issues a session or links an identity. It completes only when the ID token's `sub` is the Google identity linked to the account that started it and its `hd` equals the requested domain, and Google returned a refresh token. Then a test `users.get` for the consenting admin must answer, and only then is the connection stored. Every other case ends in a closed-list code (`directory_wrong_account` for another Google account, `directory_wrong_domain` for an `hd` other than the requested domain, `directory_no_refresh_token`, `directory_not_admin`, `failed`) and stores nothing. The SPA's completion page shows the outcome and links to the organization's console. | OFF-CON-02 | Layer 3 for each code. |
| OB-K3 | `PUT /organizations/:id/directory/service-account` `{ key, adminEmail }`: the key must be a Google service-account JSON key (`type: "service_account"`, `client_email`, `private_key`), `adminEmail` must be on a domain whose claim is current for this organization (`domainClaimCurrentFor`), and a test `users.get` for `adminEmail` through it must answer before anything is stored. A key whose delegation belongs to another Workspace fails Google's impersonation, which is a connect error and never a member's status. Errors name what is wrong without echoing the key. | OFF-CON-03 | Layer 3 (the fake verifies the assertion's signature). |
| OB-K4 | `GET /organizations/:id/directory` returns `{ connected, kind, domain, connectedAt, lastSuccessAt, lastError }` and never the credential or the admin's token. `DELETE` removes the connection. Both for active owners and admins only. | OFF-CON-04 | Layer 3, body scanned for the credential. |
| OB-K5 | With `DIRECTORY_CREDENTIALS_KEY` unset, the connect routes answer 503 `directory_not_configured`, and the check never runs. | — | Layer 3 in process. |
| OB-K6 | Every connect, failure and disconnect writes an audit row naming actor, organization, kind and domain. | — | Layer 3. |

### Docs and operations

| # | Criterion | Evidence |
|---|---|---|
| OB-D1 | `docs/product-specs/offboarding.feature` holds the scenarios above (`# Requirement:` C01-R03, C01-R09). | The file. |
| OB-D2 | A customer-facing setup guide, `docs/operations/google-workspace-directory.md` (it says every member's address on the domain must be a Workspace user or alias, since a group or a forwarder reads as "not in the directory"): marking Soup.net trusted in the Admin console and consenting, or creating the service account with domain-wide delegation for the one read-only scope (with Google's own caution quoted), and what the promise is ("usually within the hour; at most a day while Google can't be reached"). It says the admin-consent credential is one person's refresh token, which stops working when that admin leaves or loses admin rights, so when offboarding the admin who connected, reconnect as another admin first or use the service-account route. It says what happens when the connection breaks (the six-hour email, the lockout a day after the last success) and that recovery after a lockout is the site operator's, with the same in the companion repo's runbook. | The file; the companion runbook. |
| OB-D3 | `.env.example` and the companion repo's Terraform gain `DIRECTORY_CREDENTIALS_KEY` (in the app secret, behind a flag, the Turnstile precedent). Rotating it (re-encrypting under a new `key_version`) is a backlog item; the runbook doesn't promise it. | Diff review. |
| OB-D4 | `CLAUDE.md`, engineering-principles §7 (the fragment's new clauses), the data-model doc and the build notes' fold list. | Diff review. |
| OB-D5 | `npm run test:ci` green; a separate security audit before merge. | Gate; audit record. |

### Settled before building (the two [verify] items, 2026-10-26)

- **Lookup key: by address only.** Google's `users.get` reference: "The value can be the user's primary email address, alias email address, or unique user ID." ([users.get](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/get)) It does not say the unique user ID is the OpenID Connect `sub`, and a wrong guess would come back as a 404, which switches a member off, so the check sends the member's stored address.
- **Admin consent on an unverified, admin-trusted app: kept, with the service account as the fallback.** Google lists the trusted-app route among the exceptions to verification: "An administrator can add a third-party app to the list of trusted apps in the Google Admin console." ([Exceptions to verification requirements](https://support.google.com/cloud/answer/13464323)) It also says a trusted app "will have access to any Google Workspace APIs (OAuth 2.0 scopes) that you restricted using API controls" ([What is a verified third-party app?](https://knowledge.workspace.google.com/admin/apps/what-is-a-verified-third-party-app)). Neither page says how an unverified app's sensitive scope is consented to, so whether the consenting admin sees Google's unverified-app screen (and counts toward its 100-user cap) is confirmed only by doing it with the first customer's admin. If Google refuses the consent, the service-account route needs nothing from Google's side and becomes the round's path; the setup guide leads with whichever works.

### Out of this stream

- The console's directory tab and the member list's last-checked column (Console, from OB-K4 and the member columns).
- SCIM, push notifications (`users.watch`), and Google's own app verification.
- Refresh-token liveness probing (option C), which the ruling dropped.

## Build notes

- **To measure before merge:** the latency of a request that carries a check (the claim, the Google call with its two-second ceiling, and the record), as a p99 over the Layer 3 runs against the fake, and the added cost on a request that carries none (the due column in the one validation statement).
- **Console (org-console) to agree before CN-U5:** the member list's labels for `directory_status` (`suspended`, `archived`, and `deleted` shown as "not in the directory") and for a stale check ("directory check failed"), and `organization.member_directory_status` on the Activity allowlist.
