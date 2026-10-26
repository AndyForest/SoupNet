# Organization accounts round 1: stream Core

Build log for stream Core of [org-accounts-round-1.md](../org-accounts-round-1.md): the organization core that SSO, Domains, Offboarding and Console hang on. Branch `org/core`, worktree `a-resolution`.

## Rubric

Written 2026-10-26 by stream Core (agent `a-org-core-2026-10-26`, intent `int_ylZqANi877IJl1lKp15pGE16`) before implementation. It draws on the round plan's Core row, the program's §0 decisions and settled simplifications, §3.1, §3.5, §3.8 and §3.10, the research's [access-control-map.md](../org-accounts-research/access-control-map.md), the research plan's §3 recommendations (which stand under §0b), and the code at `main` `5b81097`. The closing audit of slices 6 to 10 (companion repo, `audit-2026-10-24-drafts-slices-6-9/closing-2026-10-26.md`) was read first; it has no open finding of P3 or above, and none touches account state.

Consumers:
- **Human:** sign-in and session refusals, the SPA's book creation, and the email a migrated account receives.
- **Agent:** every API-key surface, through the account-state predicate.
- **The other streams:**
  - the join routine and seat errors (Domains);
  - the managed-account lookup and the session cut-off (SSO);
  - the disabled state's extension point (Offboarding);
  - the member and role functions and an organization-members fragment (Console).

Security-relevant: yes. The stream changes the account-state predicate every credential passes through, adds org-admin actions, and moves books between organizations. Every auth change gets a test, and the audit is a separate role.

**Settled before this rubric (not reopened):**
- Managed accounts, no mixing (`2301b5eb`).
- Disable by a join at validation, reversible, never a sweep (`92b866ee`).
- Admins see aggregates, never private book names (`57fc1eee`).
- Migration reuses the new-user setup plus linking books, and the person is told (`061a7926`).
- Materialized org-book access (Q13).
- The org default book in daily links (Q8).
- Disabled members free a seat (Q7).
- Org disable kept separate from site suspension (Q11).
- Auto-join's exception to "no auto-accept" (`f653c2f1`, Domains builds it).
- No break-glass for `require_sso` (SSO).

**Calls made here** (each checked in `soupnet-oss` under this intent):

- **An account is managed when it holds a membership row in a company organization (`42044de1`).** At most one such row per account, enforced by a unique index. There is no managed flag on `users`, so the flag can never disagree with membership. A managed account's new books, imports and agent workspaces land in its company organization through one resolver, `homeOrganizationOf`. Today three creation paths each choose an organization their own way.
- **Org disable and site suspension (`85a7b2e8`).** An org admin's disable is `organization_members.disabled_at`. The site operator's suspension is the existing `users.suspended_at`, which its schema comment already describes but nothing enforces. Both are read by `activeUserPredicate`, the one fragment that these all share:
  - key authentication;
  - OAuth refresh;
  - code redemption;
  - workspace binding;
  - book succession;
  - naming.

  The per-request session lookup and login read the same two columns and refuse with copy that says which kind of disable it is. Agent surfaces keep their uniform dead-key response (F15).
- **Org-wide books are ordinary membership rows (`2e1e4624`).** Each row is tagged `via = 'org'`; a membership granted directly carries `'direct'`. The rows are written for every member, disabled members included, so re-enabling rebuilds nothing. Org owners and admins hold the book's `admin` role, and members hold `member`.
  - The organization's default book is opted into daily links (read and write).
  - Other org-wide books start excluded, as every newly joined book does.
  - The research's deactivation timestamp on membership rows is left out. Disable is decided by the account-state join, so the rows can stay as they are.
- **One join routine for every way in (`4da95a34`).** That covers the operator adding someone, a domain sign-up (Domains), and an existing account on a claimed domain (Domains, through this routine). In one transaction, under the organization's row lock, it does four things:
  - writes the membership;
  - moves every book in the person's personal organization under the company as a private book (the slug changes only on a collision, to `<slug>-<email local part>` and then numbered);
  - adds the company's org-wide books;
  - refuses at the seat limit, where disabled members don't count.

  An account that existed before the join is told by email. Books other people shared with the person stay where they are.
- **A per-account `sessions_valid_after` timestamp (`a8003678`).** The session lookup refuses any session issued before it. SSO sets it when account linking discards an unverified password, so the pre-registrant's session dies with the password. Core builds the column, the check and `invalidateSessions`; it sets nothing itself.
- **Scoped keys minted by a managed account are capped at 90 days (`d5d0f730`).** The cap is enforced at mint as one fixed rule and is not retroactive. The planning session's draft `4cd71080` also proposes a per-organization minimum. That part is deferred, because the settled simplifications rule out an org-level cap policy in the first release. Daily keys (24 hours) and OAuth connections (30-day refresh) are already inside the cap.
- **A managed account can't delete itself (recipe `1c7621d2`, verified 2026-10-26).** `DELETE /auth/me` refuses it with a pointer to the org's admins, and a personal account keeps self-service deletion.

**Terms and cast.**
- **Acme:** a company organization.
- **Olive:** Acme's owner, an existing account the operator names.
- **Ada:** an Acme admin.
- **Max:** an Acme member who had an account before Acme existed, with a "Personal" book and a book shared with Gus.
- **Gus:** a personal account outside Acme.
- **Sys:** the site operator.

"Active member" means a member whose row has no `disabled_at`. "Managed" means holding an Acme row, disabled or not.

### Where it lives

| # | Criterion | Evidence |
|---|---|---|
| OC-M1 | Every statement that reads or writes `organization_members`, and every write of an org-provenance membership row, lives in `apps/backend/src/authz/`. `check:authz-seam` gains the table as a guarded name: any other file that names it fails the build unless registered with a reason (the schema, the migration, the deletion cascade). Console composes an exported fragment, `orgMembersOf(orgId)`, rather than naming the table. | The seam guard's own test plants a reference in a fixture file and sees it fail; diff review. |
| OC-M2 | The account-state rule is still one fragment. `activeUserPredicate` composes `accountDisabled(u)` (site suspension, or a disabled org membership), and the session lookup and login call the same `accountDisabled` through `authz/session-state.ts`. Offboarding's directory status lands in `orgMembershipDisabled(om)`, the documented extension point, and nowhere else. | `key-auth.test.ts`: the fragment over every combination of verified, waitlisted, suspended and org-disabled; static: no file outside `authz/` reads `suspended_at` or `disabled_at` in an authorization decision (the admin list's display filter is registered). |
| OC-M3 | Pure rules live in `@soupnet/domain` (`organizations.ts`): the role ladder, who may act on whom, the seat arithmetic, the key-lifetime cap and the refusal copy. Layer 1 covers every branch. | `organizations.test.ts`, 100% branches. |

### Schema (migration `0044`)

| # | Criterion | Evidence |
|---|---|---|
| OC-S1 | `organization_members`: `id`, `organization_id` (FK), `user_id` (FK), `role` (`owner`, `admin`, `member`; check constraint), `joined_via` (`created`, `operator`, `domain`, `migrated`; check constraint), `disabled_at`, `disabled_by` (no FK, like the audit log), `joined_at`. `UNIQUE (user_id)` (one company organization per account), index on `organization_id`. Rows exist only for company organizations; personal organizations keep `owner_id` as their only membership. | Migration review; `check:data-model`; a Layer 3 test that a second join is refused. |
| OC-S2 | `organizations.seat_limit` (nullable integer, null = unlimited, set only by the site operator). | Migration review. |
| OC-S3 | `groups.org_wide` and `groups.org_default` (booleans, default false), a check that a default book is org-wide, and a partial unique index allowing one default per organization. | Migration review; Layer 3: a second default is refused by the index. |
| OC-S4 | `group_members.via` (`direct` or `org`, default `direct`, check constraint); every existing row is `direct`. | Migration review. |
| OC-S5 | `users.sessions_valid_after` (nullable timestamp). | Migration review. |
| OC-S6 | The migration is `0044`. The cross-round sequence (planning session, after the audit's F108) is plugin stream O `0043`, Core `0044`, SSO `0045`, Domains `0046`, Offboarding `0047`. O merges first, and its `0043` is not on any pushed branch yet, so this branch carries `0044` with a gap in the journal. After O merges, the branch merges `main` and regenerates its migration with drizzle-kit, so the snapshot chains onto O's; the journal is never edited by hand to fake the chain. | `packages/db/migrations/meta/_journal.json` on the branch, and again after O merges. |

### Account state

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OC-A1 | When Ada disables Max: every key of his (daily, scoped, OAuth access) is refused on its next request, his OAuth refresh is refused and not consumed, his sessions get 403 `account_disabled` on every JWT route and on `GET /auth/me`, and login refuses him with the same error after the password checks. No key row changes. | ORG-OFF-01 | Layer 3 `org-core.test.ts`: one key of each type, then the disable, then each surface; key rows compared before and after. |
| OC-A2 | Re-enabling restores the same keys, sessions and refresh token, with nothing re-minted. | ORG-OFF-02 | Same test, after the re-enable. |
| OC-A3 | A site suspension (`users.suspended_at`) refuses the same surfaces with its own copy, and an org admin's re-enable does not lift it. Sys suspends and unsuspends through `POST /admin/users/:id/suspend` and `/unsuspend`. | ORG-OFF-03 | Layer 3: Sys suspends Max, Ada re-enables his org membership, Max is still refused; Sys unsuspends and he works. |
| OC-A4 | A disabled or suspended account is never preferred by book succession and is never named as eligible (it is already in the shared predicate). | — | Amended at build: both consumers embed `activeUserPredicate` unchanged, so the property is the predicate's, carried by OC-A1 and OC-A3 through `authenticateKey` (the same fragment, by import). A per-consumer row would test the import, not the rule. |
| OC-A5 | A session issued before `sessions_valid_after` gets 401 `session_expired` on JWT routes and `GET /auth/me`, and a session issued after it works. `invalidateSessions(db, userId)` sets it. The comparison is whole seconds with a strict `<` on purpose: a session issued in the same second as the cut-off survives, so the new owner's own session minted right after a link (SSO's takeover path) isn't refused. Don't tighten it to `<=`. | ORG-OFF-04 | Layer 3 with a session signed one second before the stamp. |
| OC-A6 | Refusal copy names the cause and the next step, in plain words: "Your organization has disabled this account. Ask one of its admins to turn it back on." and "This account is suspended. Contact Soup.net support." Agent surfaces keep the uniform dead-key response. | ORG-OFF-01, 03 | Layer 1 on the copy; Layer 3 that a disabled user's key gets exactly the unknown-key response. |

### Organizations and their books

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OC-B1 | Sys creates Acme with `POST /admin/organizations` (`name`, `slug`, `ownerEmail`, optional `seatLimit`). In one transaction this creates Acme, then its default book (named after Acme, org-wide, default, with Olive as owner and opted into daily links), then joins Olive (`created`). | ORG-SETUP-01 | Layer 3. |
| OC-B2 | A managed account's new book lands in its company organization: `POST /recipe-books` resolves the organization through `homeOrganizationOf` when the body names none, and accepts a named organization only when the caller may create there (owns it, or is an active member). The same applies to import's destination book and to agent workspaces. The SPA stops choosing an organization. | ORG-BOOK-01 | Layer 3: Max creates a book with no `organizationId`, and it is in Acme; Gus's lands in his personal organization; Max naming Gus's organization is refused, and so is a guest who belongs to one of Acme's books but not to Acme. |
| OC-B3 | `orgWide: true` on create, or `PUT /recipe-books/:id/org-wide` by a book owner or admin (amended at build: the existing `PUT /recipe-books/:id` is owner-only for name and description, and org admins hold an org-wide book's admin role, so the toggle is its own owner-or-admin route), writes `via = 'org'` rows for every Acme member (members as `member`, owners and admins as `admin`), leaving any existing row as it is. `orgWide: false` deletes the `org` rows and keeps `direct` ones. The default book can't be made private, and a book in a personal organization can't be org-wide (400 each). | ORG-BOOK-02, 03 | Layer 3: Gus invited directly to an org-wide book keeps access after it goes private; Max loses his. |
| OC-B4 | Changing a member's org role rewrites the role on their `org` rows only. A book role granted directly is untouched. | ORG-ROLE-01 | Layer 3. |
| OC-B5 | Daily links: the default book's `org` row has `daily_read` and `daily_write` true, and other org-wide books false. | ORG-SETUP-01 | Layer 3: a new member's daily key reads the default book. |

### Joining

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OC-J1 | `joinOrganization(db, { organizationId, userId, role, authority })` is the one join, used by org creation, by Sys's `POST /admin/organizations/:id/members`, and by Domains. It returns the moved books. Because a join moves every book a person owns into the company, the routine itself checks its authority and refuses without it (security audit, at rubric stage). `authority` is either the site operator (`{ kind: 'operator', actorUserId }`, checked against `users.role = 'system'` in the same transaction) or a verified domain (`{ kind: 'domain', domain }`). For a domain, the joining account's email domain must equal it, and `domainVerifiedFor(organizationId, domain)` must hold. That fragment lives in the authz module and is `FALSE` until Domains supplies the verification table: Domains fills that one fragment and touches nothing else. | ORG-JOIN-04 | Diff review: one caller per entry point, and no other insert into the table (OC-M1). Layer 3: a non-system actor is refused, and a domain authority is refused while the fragment is `FALSE` and when the email domain differs. |
| OC-J2 | Max's books in his personal organization move under Acme as private books, keeping their ids, memberships, keys and recipes. Their slugs change only on a collision (`personal` becomes `personal-max`, then numbered). Gus's book shared with Max stays in Gus's organization. An audit row names each moved book and its old slug. | ORG-JOIN-01 | Layer 3: before and after the join, Max's key reaches the same books, his recipes are unchanged, and the book shared by Gus is still Gus's. |
| OC-J3 | After the join, Max holds `org` rows on every Acme org-wide book, and his managed state reads from the membership row. | ORG-JOIN-01 | Layer 3. |
| OC-J4 | An account that existed before the join (every `via` but `domain`) is told by email that it joined Acme, which books moved, and that the organization's admins manage the account. The join's audit row, written in the same transaction as the move, records that the notice is owed. The send runs after commit through the logged sender, so its outcome (`sent` or `failed`) is in `email_log`, and a failure is logged, never dropped silently. The join is not rolled back for an SMTP outage: the notice is a courtesy, the audit row is the record, and a failed row is visible to the site operator. | ORG-JOIN-02 | Layer 3: the audit row carries `noticeOwed`, and `email_log` gets the row; Layer 1 on the copy. |
| OC-J5 | At the seat limit the join is refused with `organization_full` ("This organization has no free seats. Ask one of its admins."), and so is a re-enable. Disabled members don't count. Two joins racing for the last seat can't both succeed (organization row lock). | ORG-SEAT-01 | Layer 3, including a concurrent pair. |
| OC-J6 | An account already in a company organization is refused with `already_in_an_organization`; an account in Acme is refused with `already_a_member`. | ORG-JOIN-03 | Layer 3. |

### Org admin actions

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OC-R1 | `POST /organizations/:id/members/:userId/disable` and `/enable`, and `PATCH /organizations/:id/members/:userId` with `role`, for an active owner or admin of that organization. Anyone else gets a uniform 404, byte-identical to the 404 for an organization id that doesn't exist and for a user id outside the organization, so a non-member can't learn who is in Acme or whether it exists. | ORG-OFF-01, ORG-ROLE-01 | Layer 3, with a non-member and a disabled admin as callers, comparing response bodies byte for byte against a random organization id. |
| OC-R2 | The rules (domain, Layer 1): nobody acts on themselves; an admin can't act on an owner or make an owner; an owner can do anything else. Every action writes an audit row naming actor, target and action. | ORG-ROLE-02 | `organizations.test.ts`; Layer 3 one refusal per rule. |
| OC-R3 | `GET /auth/me` adds `organization: { id, name, role } \| null` for the signed-in account, so the SPA and the other streams can tell a managed account. Its `user` object is now an explicit field list (`id`, `email`, `role`, `emailVerified`, `premium`, `organization`) rather than a spread of the session's fields, deliberately: the session now carries internal fields (`issuedAt`, `identityProvider`) that the response must not echo. A stream that adds a field adds it to that list. | — | Layer 3. |
| OC-R4 | `DELETE /auth/me` for a managed account is refused with 409 `managed_account` ("Your organization manages this account. Ask one of its admins.") (recipe `1c7621d2`). | ORG-DEL-01 | Layer 3. |
| OC-R6 | A managed account can't change its email away from its organization's domain (program §3.4; the verification coordinator found it in neither Core's rubric nor SSO's, added 2026-10-26). No route changes an account's email today, since an address is only inserted at registration. So the rule is `emailChangeAllowed(managed, current, next)` in `@soupnet/domain`, with its copy `MANAGED_EMAIL_CHANGE_MESSAGE` pointing at the admins, and a static guard that fails the day any file changes `users.email` until it is registered and asks the rule. | — | `organizations.test.ts` (the rule); `authz/managed-email.test.ts` (the guard, with a plant). |
| OC-R5 | Sys's `PATCH /admin/organizations/:id` sets `seatLimit`; `GET /admin/organizations` adds members, active members and seat limit. | — | Layer 3. |

### Keys

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| OC-K1 | `POST /keys/scoped` by a managed account refuses an expiry past 90 days with 400 `key_lifetime_cap`, naming the cap. Keys minted earlier are untouched; personal accounts keep the one-year ceiling. The SPA's scoped-key form offers no preset past the cap for a managed account. | ORG-KEY-01 | Layer 3; Layer 1 on the cap. |

### Docs and follow-ups

| # | Criterion | Evidence |
|---|---|---|
| OC-D1 | `docs/product-specs/organizations.feature` holds the scenarios named above, with `# Requirement:` comments (C01-R01, R03, R07, R09, R12) and `# Guards:` lines to design-thinking archetypes 6 and 7. | The file. |
| OC-D2 | `CLAUDE.md` (tables, routes), `engineering-principles.md` §7 (the guarded table and the predicate's two columns), the data-model doc (regenerated), and the backlog say what landed. Open items go to the backlog: the SPA's private/org-wide choice and the members page (Console), the per-org key-cap minimum (deferred by ruling), and seat tier. | Diff review. |
| OC-D3 | Slice 10's record follow-ups (closing audit item 5) ride in the first commit: the verification table's deferred rows are superseded, S10-L3 and S10-M2 are corrected, and a Layer 3 test pins the corrected S10-L3 (`drafts-and-triage-build.md`, "Slice 10 record on `main`"). | The note; the test. |

### Out of this stream

These belong to other streams:
- Google sign-in and identities (SSO);
- `require_sso` (SSO);
- domain verification and auto-join's trigger (Domains, calling OC-J1);
- the directory check (Offboarding, through OC-M2's extension point);
- every console page and the "what your admins can see" page (Console);
- sharing policy (Console).

## Build notes

Built 2026-10-26 on `org/core` by the same agent and intent. The calls made during the build, each recipe-checked:

- **Account deletion of a company organization's owner (`a42479b6`).** `organization_members.user_id` has no cascade, so the deletion cascade removes the account's row before the user row (`removeOrganizationMembershipOf`). A company organization the departing account owns passes first to its longest-standing remaining owner, then admin, then member, who is promoted to owner. Only after that does book succession run, so the company's books are never handed into one member's personal organization. A company organization with nobody else in it is deleted with the account's own books. Self-service deletion never gets here for a managed account (OC-R4); test-data cleanup does.
- **The session cut-off is stamped from the app's clock (`d3f3f158`).** The first Layer 3 run failed ORG-OFF-04: the database host's clock ran ahead of the backend's, so a session signed just after a `NOW()` cut-off read as issued before it. `invalidateSessions` now writes `to_timestamp` of the process clock, the clock that signs `iat`, and the comparison is in whole seconds.
- **The join notice is sent without blocking the request.** `services/organization.service.ts` runs the join, then sends after commit through the logged sender, like every other email the backend sends from a request. The planning session confirmed OC-J4 as designed: the notice doesn't block the join.
- **A mid-session refusal ends the SPA session.** `authFetch` treats a 403 `account_disabled` or `account_suspended` as a 401: every request would fail the same way, and signing in again shows the person which kind of disable it is. The login page shows the refusal's message instead of its code.

Where each module landed:
- `authz/account-state.ts`: `accountDisabled`, `accountDisabledReason`, and the extension point `orgMembershipDisabled`.
- `authz/session-state.ts`: `sessionState`, `accountRefusal`, `invalidateSessions`.
- `authz/organizations.ts`:
  - the fragments `orgMembersOf`, `orgMemberCount` and `homeOrganizationIdOf`;
  - the lookups `managedOrganizationOf`, `homeOrganizationOf` and `mayCreateBookIn`;
  - `joinOrganization` and `createOrganization`;
  - `setBookOrgWide` and `actOnMember`;
  - the cascade's two steps.
- `authz/domain-authority.ts`: `domainVerifiedFor`, which is `FALSE` until Domains fills it.
- `services/organization.service.ts`: the join with its notice.
- `routes/organizations.ts`: the org admin's actions.
- `routes/admin.ts`: the site operator's create, seats, add-member, suspend and unsuspend routes, and the list counts.
- `@soupnet/domain` `organizations.ts`: the rules and copy.
- The seam guard's fourth register, `ORG_MEMBERSHIP_MENTIONS` (whole-word match, so a function named for the table isn't a mention), with three plant tests.

Tests:
- **Layer 1:** `packages/domain/src/organizations.test.ts`, 17 tests.
- **Layer 3:** `apps/backend/src/routes/org-core.test.ts`, 16 tests, one per scenario group in `docs/product-specs/organizations.feature`, plus the deletion cascade. All passed against a worktree stack: backend 127.0.0.1:3145, throwaway database `soupnet_e2e_core`.
- **Seam guard:** 25 tests.

**Seam hooks for the other streams, added 2026-10-26.** Each is one function or fragment in its own file, so a stream fills one body and touches nothing else in the module, the pattern `domainVerifiedFor` set:
- `authz/sso-policy.ts` `ssoRequired()`, `FALSE` until SSO fills it. `sessionState` takes the session's `idp` (`JwtPayload.idp`, passed through `requireAuth`) and refuses `sso_required`, which the middleware answers with 403 and `SSO_REQUIRED_MESSAGE`, a placeholder SSO rewords.
- `authz/sharing-policy.ts` `sharingPolicyAllows(db, { bookId, userId, actorUserId })`, `TRUE` until Console fills it. It is asked by `addMember` (the actor is the person adding; the route answers 403 `sharing_blocked`) and by the invitation accept (the actor is the invitation's inviter, since an outbound "admins only" policy is about who shares; it refuses and leaves the invitation pending). At Console's request, and with the planning session's rule that a stream needing a second hook asks Core, Console owns this file whole. It adds the siblings for invitation creation (`outboundSharingAllowsInvitation`) and re-filing (`sharingAllowsRefile`), both of which read `organization_members`, and nothing else in the module changes for the policy.
- `orgMemberBookCounts(orgId)`, a derived table of each member's private and org-wide book counts in the organization, for the console's member list.

Resend-verification runs the account-state check after its Turnstile check, which the route has always run before touching the database (`auth-turnstile.test.ts` pins that order).

**Follow-up after Domains merges (OC-F1, from the audit of `9a9c4d3`, no finding).** Today the operator authority can move any existing account into a company on the site operator's say-so: the site operator naming the owner at creation, or adding an account by email. Once Domains lands, bound it:
- An operator join requires the account's email domain to be verified for that organization.
- This needs a verified-domain fragment without the auto-join switch, since `domainVerifiedFor` as Domains fills it includes `auto_join = true`, and an operator add shouldn't depend on that switch. It would be a second fragment Domains adds beside it.
- The unbounded form stays only behind the existing system-role check, for the concierge first customer, and is always audit-logged with the operator as the actor (the join's audit row already names the actor and `authority`).
- Domains supplies the sibling as `domainClaimCurrentFor(orgId, domain)`: the same claim test without `auto_join`, pinned in seam-hooks.test.ts as differing from `domainVerifiedFor` by exactly that clause.
- The same change swaps `authorityHolds`'s email-domain comparison for Domains' `isAddressOnDomain`, which normalizes an address the way a claim is stored (ASCII/punycode, Domains' OD-V1). Today's `lastIndexOf("@")` slice fails closed on an internationalized address on a verified IDN domain. That's safe, but it disagrees with the claim.
- Tests: an operator add of an off-domain account is refused unless the unbounded form is asked for explicitly, and an IDN address on its verified domain joins.

**Not built here, by design:** the console pages, the SPA's private or org-wide choice when creating a book, and the member list (Console), and the verified-domain check (Domains).
