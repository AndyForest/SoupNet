# Organization accounts round 1: stream Console

Build log for stream Console of [org-accounts-round-1.md](../org-accounts-round-1.md): the org admin console, the shared users table it has in common with the site admin console, the sharing policy, and the end-user page "what your organization's admins can see". Branch `org/console`, worktree `SoupNet-wt/org-console`, cut from `org/core` at `861dbb2`.

## Rubric

Written 2026-10-26 by stream Console (agent `org-console-2026-10-26`, intent `int_9TbWFaBIGb1WwMd7xxZrmkV5`) before implementation. It draws on the round plan's Console row, the program's §0 decisions and settled simplifications, §2, §3.6, §3.7 and §3.12, the research's [admin-ui-and-export-inventory.md](../org-accounts-research/admin-ui-and-export-inventory.md), Core's rubric ([core.md](core.md)) and its work in progress on `org/core`, design-thinking archetypes 6 and 7 as Core revised them, and the code at `861dbb2`. The closing audit of slices 6 to 10 (companion repo, `audit-2026-10-24-drafts-slices-6-9/closing-2026-10-26.md`) was read first; it has no open finding of P3 or above, and none touches the admin console. The round's audit brief for this stream is "aggregates only; no private book names or contents; org scope cannot read another org; site-admin columns never reach the org admin" (companion repo, `audit-2026-10-26-plugin-and-org-rounds/STATE.md`).

Consumers:
- **Human, org admin:** the console at `/org` (members, books and sharing, domains, activity).
- **Human, site operator:** the site admin's Users page, rebuilt on the shared table, and a new Organizations page.
- **Human, member:** the "what your organization's admins can see" page, and the refusal copy when a sharing policy stops an invitation.
- **Agent:** none directly. The sharing policy refuses through the same membership and re-filing paths an agent's person uses on the web; no agent surface changes.

Security-relevant: yes. The stream adds org-scoped reads of member data, a policy that refuses membership grants, and a second consumer of the site admin's user query. Every auth change gets a test, and the audit is a separate role.

**Settled before this rubric (not reopened):**
- Admins see aggregates, never private book contents or names (`57fc1eee`); private book names are sensitive (`2738f7a9`).
- Managed accounts, no mixing (`2301b5eb`); an account is managed when it holds a company membership row (`42044de1`).
- Org disable and site suspension are separate (`85a7b2e8`); org-wide books are materialized membership rows (`2e1e4624`).
- The admin kit is composable primitives, not a configurable mega list view (`e5e9e3f0`); no generic Settings page (`ea5a5dca`).
- Core owns `organization_members`: Console composes `orgMembersOf(orgId)` and `managedOrganizationOf`, and calls Core's member routes (`POST /organizations/:id/members/:userId/disable` and `/enable`, `PATCH /organizations/:id/members/:userId`) and `orgWide` on `POST` and `PATCH /recipe-books`. Console never names the table (OC-M1).

**Calls made here** (each checked in `soupnet-oss` under this intent):

- **One query builder and one table, scoped by principal, with server-side column allowlists (`1fa21e31`).** The site admin's `GET /admin/users` and the org console's member list run through one service that takes a scope (`site`, or `org` with an id) and returns only that scope's columns. The column sets are defined once in `@soupnet/domain`; the org set is a strict subset, with private-book detail reduced to counts. The end-user page renders from the same list, so it can't drift from what the console shows.
- **Two sharing settings, inbound and outbound, both defaulting to allowed (`5c76b5ff`).**
  - Outbound (`blocked`, `admins_only`, `allowed`): who may bring people outside the organization into its books.
  - Inbound (`blocked`, `allowed`): whether members may join books owned outside it.

  The policy is enforced where a membership is granted and where a recipe is re-filed out of an organization book. Tightening it refuses new grants and pending invitations, but leaves existing memberships, which the console counts for the admin. "Org admins can always set sharing on any org book directly" (§3.7) is read as: admins manage the membership of any org-wide book, including removing outsiders. `blocked` still blocks admins too, since otherwise it would be the same as `admins_only`.
- **Aggregates over the organization's own books, and an activity view with no free text (`e36bbef8`).**
  - Recipe counts are published recipes in Acme's books only. A book owned outside the company isn't company data, and an unresolved draft is private to its subject.
  - "Last active" is the later of last sign-in and last key use.
  - The activity view lists admin-action events (actor, target, action, time) and never an audit row's metadata. Core's join row carries moved books' old slugs, which are private book names.
  - Each member sees the admin actions that touched their own account.
- **The console's layout (`b66536c5`).** It has its own route group, `/org`, built from the site admin kit with a parameterized gate and nav. Its pages are named for what they govern:
  - Members: disable, re-enable and roles;
  - Books: the default book, org-wide books, and the sharing policy beside them;
  - Domains;
  - Activity.

  There is no Settings page.
- **Sign-ins recorded so a takeover is observable (draft `6c5c04e8`, for Andy).** The page tells members the company's one path to their data, which is taking the account over (`57fc1eee`). For that to be observable, each successful sign-in is recorded as an audit row (time and method), and the page lists the most recent ones. Built on the recommendation. If Andy rules otherwise, the page says only what is recorded (the last sign-in time).

**Departures from the planning brief, and what Console needs from other streams** (the migration, the hook's shape and the sign-in record were confirmed by the planning session on 2026-10-26):
- **A migration, `0048` (planning session, 2026-10-26).** The brief said Console needs none, but the sharing policy has to live somewhere. It goes in two text columns on `organizations` (`outbound_sharing`, `inbound_sharing`, check constraints, default `'allowed'`), set only through the console's route. `system_settings` is site-wide and reserved for operational switches (`8ee8e3ab`). The planning session confirmed the shape and assigned `0048`, after Offboarding's `0047`; E's slice 9 follow-up moves to `0049`.
- **A policy hook in the seam (Core).** The round plan keeps `apps/backend/src/authz/` to Core and Offboarding. Following Core's `domainVerifiedFor` pattern, Console asks Core for a stub fragment, `sharingPolicyAllows`. It would be called inside `addMember` and the invitation accept, and return `TRUE` until Console fills it in its own file, the way Domains fills `domain-authority.ts`. Console then fills that one file and touches nothing else in `authz/`. Console calls the same exported check early, at invitation creation and in trace re-filing, both of which are outside `authz/`.
- **Seam fragments for counts (Core).** The per-member counts need books by scope (private or org-wide) and live keys. Those read guarded tables (`group_members`, `api_keys`). Where Core exports no fragment, Console asks Core for one rather than writing that SQL itself. New reads of `traces` outside the module are registered in the seam guard with a reason, and they compose the draft fragments from `authz/draft-sql.ts`.
- **Domains' API (Domains).** The Domains page is a UI over the routes stream Domains builds. It lands after Domains merges, against whatever routes Domains ships.
- **The last-checked column (Offboarding).** It lands last, after Offboarding merges, reading Offboarding's stored check time.

**Terms and cast.** These are Core's:
- **Acme:** a company organization.
- **Olive:** Acme's owner.
- **Ada:** an Acme admin.
- **Max:** an Acme member, with a private "Personal" book.
- **Gus:** a personal account outside Acme, who owns a book.
- **Sys:** the site operator.

Added here:
- **Beta:** a second company organization.
- **Bea:** Beta's admin.

### Where it lives

| # | Criterion | Evidence |
|---|---|---|
| CN-M1 | One users-list service, `services/users-list.service.ts`, holds the predicate array, the sort whitelist, the count query and pagination for both scopes. The site route and the org route call it, and neither writes its own list SQL. The org scope anchors on Core's `orgMembersOf(orgId)` and never names `organization_members`. | Diff review; `check:authz-seam` green with the table guarded. |
| CN-M2 | The column sets live in `@soupnet/domain` (`admin-columns.ts`). Each column carries its key, its plain-language label and its scopes. The service selects only the requested scope's columns, so a column outside the org set is never computed for an org request. Layer 1 tests the sets: the org set is a strict subset of the site set, and it contains no site-only column (`suspendedReason`, `signupReason`, `premiumAt`, `waitlistedAt`, site `role`) and no book name. | `admin-columns.test.ts`, 100% branches. |
| CN-M3 | The sharing rule is pure and lives in `@soupnet/domain` (`sharing-policy.ts`). Given the policy, whether the inviter is an admin, and whether the book and the invitee are inside or outside the organization, it returns allowed or a refusal. It also holds the refusal copy. The SQL that finds who is inside lives in the authz hook (CN-P2). | `sharing-policy.test.ts`, 100% branches. |
| CN-M4 | The frontend has one `AdminUsersTable`, which takes a scope, its columns from the domain set, and its row actions. It has one `useAdminListQuery` for filter state and response unwrapping. `useAdminGate` and `AdminLayout`'s nav take a scope (`site`, or `org` from `/auth/me`'s `organization`). The site Users page moves onto the shared table with no visible change. | Diff review; the site Users page in the browser before and after (Layer 3b). |

### Scope and gate

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-G1 | Every `/organizations/:id/*` read added here requires the caller's managed organization to be `:id` with role owner or admin, read through `managedOrganizationOf`. A disabled caller never gets this far. Every other caller, an id that doesn't exist, and a malformed id get Core's not-found body byte for byte: Max (a member), Bea (admin of Beta), Gus, and Sys too, who uses `/admin`. | ORG-CON-01 | Layer 3, comparing bodies byte for byte against Core's 404 for a random id. |
| CN-G2 | Org scope can't read another organization. Bea's request for Acme's members, books or activity is CN-G1's 404. The member list holds exactly Acme's members, never another organization's guests in Acme's books. | ORG-CON-01 | Layer 3 with Acme and Beta both seeded. |
| CN-G3 | `GET /admin/users` keeps its contract (fields, filters, sort, paging) through the shared service and gains an `organization` column. `GET /admin/organizations/:id/members` serves the same list at org scope, with the site column set, for Sys. | — | The existing `admin-users.test.ts` passes unchanged; Layer 3 for the new route. |

### Members

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-U1 | The org member list returns, per member, the org column set and nothing else: email, display name, org role, status, joined via, joined at, last active, published recipes in Acme's books, private books in Acme (a count), org-wide books, and live keys. Status is one of active, disabled by the organization, or suspended by Soup.net; a site suspension shows with no reason. | ORG-CON-02 | Layer 3: the response's keys for each row equal the domain org set exactly; a seeded private book named `max-secret-plans` appears nowhere in any org-scope response body. |
| CN-U2 | Counts compose the seam's fragments. Recipes count only published recipes in Acme's books, composing `authz/draft-sql.ts`, so Max's unresolved draft about Olive and his recipe in Gus's book are not counted. Live keys are keys not yet expired. Last active is the later of `last_login_at` and the newest `api_keys.last_used_at`. | ORG-CON-02 | Layer 3 with a draft, an external-book recipe and a key used after the last sign-in. |
| CN-U3 | Filters (email search, status, role) and sorts (joined, last active, email) go through the service's whitelists, and an unknown sort key falls back to the default. Paging uses the kit's limits (default 50, max 200). | — | Layer 3. |
| CN-U4 | Row actions call Core's member routes and show Core's refusal copy as returned. The UI offers only actions the domain role rules allow the caller: no action on oneself, and an admin can't act on an owner or make one. The table refreshes after an action. | ORG-OFF-01, ORG-ROLE-02 | Layer 3b (browser): Ada disables Max, Max's status changes, and the self row has no actions. |
| CN-U5 | The last-directory-check column is added last, after Offboarding merges. It reads Offboarding's stored check time for members of an organization with a directory connection, and is empty otherwise. | ORG-CON-03 | Layer 3 once Offboarding's schema is on `main`. |
| CN-U6 | The directory connection, after Offboarding merges (agreed with that stream, 2026-10-26; Offboarding's PR #160):
  - a Directory section on `/org` (anchor `#directory`, which Offboarding's completion page links to) reads `GET /organizations/:id/directory` and drives its start, service-account and disconnect writes;
  - the member status adds Offboarding's `directory_inactive` and `directory_unconfirmed` with labels of their own ("Suspended in Google Workspace", "Archived in Google Workspace", "Not in the directory", "Directory check failed"), never "Disabled by the organization";
  - Activity adds `organization.member_directory_status` (both views, with the `to` value checked against Offboarding's five values) and the three connection actions (org view only, kind and domain at most). A failed admin-consent connection also shows its reason, a closed set labelled in the domain (`directory_wrong_account`, `directory_wrong_domain`, `directory_no_refresh_token`, `directory_not_admin`). A failed service-account connection shows none, because its reason is derived from Google's answer and is not a closed set.

  In the Directory section itself, which only the organization's owners and admins see:
  - the connect button says that it opens Google, where a Workspace admin's account is asked once for read-only access to the directory;
  - the connection's last error shows as its code and time only, labelled where the code is one of the closed set, never a token or a Google response body. This follows the planning session, 2026-10-26.

  Read through `orgMembersOf`'s added `directory_status` and `directory_checked_at`. | ORG-CON-03 | Layer 1 on the allowlist and labels; Layer 3 that a directory status change appears in Activity; Layer 3b on the section. |

### Books and sharing

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-B1 | `GET /organizations/:id/books` returns Acme's org-wide books with name, whether it is the default, member count, members from outside Acme, and published recipes. Private books come back as one total count, with no names, ids or per-book counts. | ORG-CON-04 | Layer 3: no private book's id or name in the body. |
| CN-B2 | The Books page shows the default book and lets an owner or admin make an org-wide book private, or a book of their own org-wide, through Core's `PATCH /recipe-books/:id`, showing Core's refusals (the default book can't be made private). The SPA's book-creation form gains the private or org-wide choice for a managed account (Core's backlog item). | ORG-BOOK-02 | Layer 3b. |
| CN-P1 | `organizations.outbound_sharing` (`blocked`, `admins_only`, `allowed`) and `inbound_sharing` (`blocked`, `allowed`), both defaulting to `allowed`, are added with check constraints, in migration `0048`. `PATCH /organizations/:id/sharing` (CN-G1's gate) sets either one and writes an audit row. | ORG-SHARE-01 | Migration review; Layer 3. |
| CN-P2 | Outbound: with `blocked`, an invitation to anyone outside Acme into any Acme book is refused at creation with 403 `sharing_blocked`, whether the book is private or org-wide and whoever sends it. With `admins_only`, Ada may send one and Max may not. The same rule refuses accepting a pending invitation and a direct add. Inside is an Acme member, read through Core's `orgMembersOf`. At creation only, it is also an email on a domain Acme has verified, read through the verified-domain fragment Domains fills (`domainVerifiedFor` in `authz/domain-authority.ts`, or its successor), never an email suffix. The check fills Core's `sharingPolicyAllows` stub (`authz/sharing-policy.ts`, its body only), which `addMember` and the invitation accept already call. | ORG-SHARE-02, 03 | Layer 3: one row per policy value × inviter role × private or org-wide book, plus a pending invitation sent while allowed and accepted after tightening (it stays pending). The fill lands on `org/console` before merge. |
| CN-P3 | Inbound: with `blocked`, Max can't accept Gus's invitation to Gus's book. The refusal goes to Max, with copy naming his organization's policy. Gus's invitation is created normally, so Gus learns nothing about Max's organization. Gus adding Max directly gets the same 404 as for an email with no account ("try sending an invitation instead"), so the direct add doesn't tell him either, and the invitation it suggests reaches Max with the reason. | ORG-SHARE-04 | Layer 3: Gus's creation response is identical under both inbound values; the direct add's body equals the no-account body byte for byte. |
| CN-P4 | With outbound `blocked`, or `admins_only` and the caller not an admin, re-filing a recipe from an Acme book into a book outside Acme is refused with `sharing_blocked`. | ORG-SHARE-05 | Layer 3 on `PATCH /traces/:id`. |
| CN-P5 | Tightening removes nothing. Existing memberships stay, and the Books page shows how many people from outside Acme belong to each org-wide book and, as one number, to private books. An admin removes an outsider from an org-wide book on that book's existing members page. | ORG-SHARE-06 | Layer 3: memberships unchanged after tightening, and the counts are correct. |
| CN-P6 | The refusal copy names the cause and the next step, in plain words. For example: "Your organization doesn't allow sharing recipe books with people outside it. Ask one of its admins." | — | Layer 1 on the copy. |

### Domains

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-D1 | The Domains page lists Acme's domains with their verification state, the TXT record to add, and the automatic-joining switch, calling stream Domains' routes. It lands after Domains merges. | ORG-DOM-* (Domains') | Layer 3b. |

### Activity and the member's view

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-L1 | `GET /organizations/:id/activity` returns admin-action events on Acme and its members: actor, target email, action, and time. The actions are an allowlist of org-admin actions, pinned by a test: member disable, enable and role change, joins, sharing changes, and domain changes. So a member's own activity rows and the site operator's other actions never appear, even if audit action names change. When the actor is the site operator, the actor shows as "Soup.net", never Sys's address. Metadata is never returned: a join's moved-book names and slugs (`movedBooks`, `previousSlug`) and any agent-authored text never leave. | ORG-CON-05 | Layer 1: the allowlist pinned; Layer 3: Max's join row, whose metadata holds his old slug `personal`, is listed with actor "Soup.net", the slug and Sys's email appear nowhere in the body, and Max's own `recipe.checked` rows are absent. |
| CN-L2 | `GET /me/organization` (the JWT `me` router, beside preferences and intents) returns, for a managed account: the organization's name, the member's role, the current sharing policy, the admin actions that touched this account (as in CN-L1), and its recent sign-ins (CN-T2). It returns `null` for a personal account. | ORG-CON-06 | Layer 3. |

### The end-user page

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-T1 | `/app/settings/organization`, a tab shown to managed accounts, is titled "What your organization's admins can see". It lists what admins see, rendered from the domain org column set's labels, and what they can't (private book names and contents, recipe text, search and intent text). It states the one path the company has to the data: taking over the account, for example by resetting the Google password and signing in. It also says plainly that the organization owns the account. | ORG-CON-06 | Layer 1: the page's "can see" list equals the org column set; Layer 3b. |
| CN-T2 | Each successful sign-in writes an append-only audit row (`auth.signed_in`, with the method) and the page lists the most recent ten, so a takeover is visible to the person. Only the account's own person sees the list. Org admins see sign-ins only in aggregate, as last active (CN-U2), never the list or the method. The row holds the time and method only, never an IP address or user agent. The person reads it only through `GET /me/organization`. This follows draft `6c5c04e8`, which the planning session said to proceed on. The Google path calls SSO's `recordSignIn(db, userId, method)` (SSO-A7b on `org/google-sso`), and Console calls it with `"password"` in `POST /auth/login`. If Andy rules otherwise, the page shows `last_login_at` only and says so. | ORG-CON-07 | Layer 3: two sign-ins, both listed for the person; no org-scope response carries a sign-in row. |
| CN-T3 | The page states the honest limit from §3.7: a sharing policy governs sharing, but an API key is a credential anyone holding it can use. | — | Diff review of the copy. |

### Site admin

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| CN-S1 | `/admin/organizations` lists organizations (name, owner, members, active members, seat limit), creates one through Core's `POST /admin/organizations`, and sets the seat limit. Each row drills into its members through the shared table at site columns. | ORG-SETUP-01 | Layer 3b. |
| CN-S2 | The org console isn't linked from, and doesn't reuse, any site-only page. Sys sees `/admin`, and an org admin who is also Sys sees both navs separately. | — | Layer 3b. |

### Docs and follow-ups

| # | Criterion | Evidence |
|---|---|---|
| CN-X1 | `docs/product-specs/organization-console.feature` holds the ORG-CON and ORG-SHARE scenarios named above, with `# Requirement:` comments and `# Guards:` lines to archetypes 6 and 7. It is a file of its own beside Core's `organizations.feature`, so the two streams don't edit one file. | The file. |
| CN-X2 | `docs/architecture/admin-dashboards.md` gains the org console and the documented exception to engineering-principles §12's "no hiding fields": the org view shows only what its viewer is entitled to. `ea5a5dca`'s rule gets its doc home there. The doc's promise of a `/admin/workers` landing page is corrected. `CLAUDE.md` (routes) and the backlog say what landed. | Diff review. |
| CN-X4 | `docs/legal/privacy-policy.md` §2.1 names the sign-in record in its list of account events, in stream L's words: "each successful sign-in, with its time and whether it was by password or Google", and says where the person sees it. The effective-date note says it was added. Retention follows the audit log's (L's draft `30c5a224`). The audit made this F112 (P4, fix in this PR). The line is L's corrected wording of §2.1 with the sign-in clause added, so merging L's #151 conflicts on that line and the effective-date line; take this PR's version of the first, and join both notes on the second. | The policy diff in this PR. |
| CN-X3 | Not in this stream: the two hand-rolled admin pages (`AdminQueuesPage`, `AdminEmbeddingsPage`) move onto the kit only if the shared table touches them. Otherwise they stay as a backlog item. | Backlog entry. |

### Built differently from the rubric, and observations for the audit

Recorded 2026-10-26 during the build.
- **`/me/organization`, not `/auth/me/organization`** (CN-L2, CN-T2). The JWT `me` router already holds the person's own non-identity reads (preferences, intents), and this keeps `routes/auth.ts`, which SSO is also editing, untouched.
- **The Domains page lands with CN-D1.** The org nav has no Domains entry until stream Domains merges, so nothing links to a page that doesn't exist yet.
- **The Books page's counts live in `authz/sharing-policy.ts`** (`orgBookSummary`). They read memberships, which only the authz module may, and they're the review surface for the sharing policy (CN-P5). Core agreed the file is Console's whole.
- **An invitation reveals whether an off-domain email is a colleague.** With outbound `blocked`, Max can learn whether an email outside Acme's verified domains belongs to an Acme member: an invitation to it is created rather than refused. It reveals only membership of his own organization, to one of its members. Recorded for the auditor rather than closed with a uniform answer, because refusing a colleague's invitation would break ordinary sharing inside the company.
- **Making an existing book org-wide is on the book's own page** (CN-B2, from the verification coordinator's review of `42ec7e4`). The Recipe Books page offers "Make org-wide" or "Make private" to an owner or admin of a company book, except the organization's default book. It calls Core's `PUT /recipe-books/:id/org-wide`, and `GET /recipe-books` now says whether each book is in a company organization, org-wide, or the default. The Books page keeps "Make private" for org-wide books. Putting the control on the book's own page lets any book owner use it, not only an org admin, which matches archetype 7's "I make a recipe book org-wide".
- **Fixed after the browser verification of `42ec7e4`:**
  - The Recipe Books page showed a sharing refusal as the raw code (`sharing_blocked`) on an invitation, and showed nothing on an accept. These were pre-existing: both read `error` and never `message`, and the accept error was never rendered. They now show the plain sentence.
  - The console's role select and the book form's radios were stretched by the global form rule.
  - A row's actions on Members now sit right after the email, so they stay in view when the table is wider than its box. Organizations shows its seat limit next to the name.
  - Org console pages say "Organization" rather than "Admin".
  - The admin layout no longer nests a second `<main>`.
  - The site operator's per-organization member list shows labels rather than codes.
  - The member page's takeover sentence now holds for an account that signs in with a password.
- **The site operator is held to a company's outbound policy when re-filing** (CN-P4), unlike the trace gates, which let the system role through. The policy is the company's, and the operator's tools for a company go through `/admin`.

### Out of this stream

These belong elsewhere:
- the member routes and their rules (Core);
- domain verification itself (Domains);
- the directory connection and check (Offboarding);
- org data export, and transfer of a departed member's private books (program §3.13 and §3.6, later rounds);
- a domain allowlist for outbound sharing (§3.7, later).
