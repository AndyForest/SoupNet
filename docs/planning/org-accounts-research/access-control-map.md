# Access-control map

Source: read-only code sweep by a research sub-agent, 2026-09-19, condensed by the orchestrator. Citations are `file:line` at the commit current on that date and will drift. Feeds the program doc §3.5 (book scopes), §3.8 (disable user), and the scoped-sessions notes. Security-relevant leads from the same sweep are filed in the private deployment repo per `docs/workflows/security.md` and are not repeated here.

## How book access is decided today

**For humans (JWT paths), there is no central function.** Around 32 hand-written SQL sites gate on `claimnet.group_members` directly: about fifteen in `routes/groups.ts`, eight in `routes/traces.ts` (where `canReadTrace`, `:28-42`, is the only shared helper), and the rest across `routes/keys.ts`, `routes/oauth.ts`, `routes/invitations.ts`, `routes/auth.ts`, `routes/mcp.ts:1057-1066`, `services/import.service.ts`, `services/ephemeral-workspace.service.ts`, `services/briefing.ts`, `routes/admin.ts`, and `services/user-delete.service.ts`.

**For agents (API keys), scope is two arrays frozen at mint.** `validateKey` (`services/api-key.service.ts:212`) has 21 call sites. Per-call parameters only ever narrow: `resolveGroupSlug` (`services/trace.service.ts:1242-1265`) resolves strictly within the allowlist it is given. The one place a live key's scope grows is ephemeral workspace creation (`services/ephemeral-workspace.service.ts:162-174`), restricted to the book the same call just created.

**Scope is computed once**, from `group_members.daily_read` / `daily_write` for daily keys (`routes/keys.ts:52-105`), from a membership-validated request body for scoped keys (`:154-163`), and from the consent screen for OAuth (`routes/oauth.ts:212-220`), then copied forward on refresh. Membership isn't consulted again at validation.

**Key validation has more than one path.** Besides `validateKey`, the briefing service does its own hashed key lookup (`services/briefing.ts:259-268`) and the OAuth refresh is its own statement (`services/oauth.service.ts:540-550`). A disabled-user predicate has to reach all of them, which argues for one shared validation primitive before adding the predicate.

## Where a "disabled" predicate goes

| Checkpoint | Location | Already hits the DB per request? | Change |
|---|---|---|---|
| `requireAuth` | `auth.ts:65-81` | No, pure JWT verify | None; leave stateless |
| `requireVerifiedEmail` | `auth.ts:113-130` | Yes, one SELECT on `users` | Add the predicate to this SELECT. Covers every router that mounts it (keys, recipe books, traces, invitations, me, import, admin, OAuth grant) at no extra round trip |
| Routes mounting `requireAuth` only | `GET /auth/me`, resend-verification, `DELETE /auth/me` | No | Each needs an explicit decision |
| API-key surfaces | `api-key.service.ts:229-238` | Yes | One predicate on the existing `JOIN users` |
| Briefing key lookup, OAuth refresh | see above | Yes | Route through the shared primitive |
| Login, password reset | `auth.ts:221-247`, `routes/auth.ts:819-855` | Yes | Predicate in each |

Human sessions are 7-day stateless JWTs, so the per-request lookup in `requireVerifiedEmail` is what makes disable take effect promptly.

## Organizations today

- Writes: personal org created at registration (`auth.ts:167-172`), the `personal_organization_id` pointer, and teardown in `user-delete.service.ts`. Nothing creates a non-personal org. "Membership" in an org means `organizations.owner_id` and nothing else.
- The account-deletion guard `owned_shared_orgs_exist` (`routes/auth.ts:584-608`) is unreachable today for that reason and goes live the day shared orgs exist. It and the delete cascade need reviewing together as part of the org work.
- `personal_organization_id` has no foreign key (`users.ts:88-91`). Fine while only the owner points at an org; needs thought once several users belong to one.
- Ephemeral workspaces attach to the creator's personal org (`ephemeral-workspace.service.ts:115-121`). Whether org members should ever see them is an explicit decision to make.
- The published OpenAPI registry describes an `/api/v1/organizations` CRUD that no route implements (`packages/contracts/src/openapi-registry.ts:135, 150`). The org program should reconcile that contract rather than inherit it.

## Where verified-domain auto-join hooks in

`POST /auth/verify` (`routes/auth.ts:636`) is the moment mailbox control is proven, so it is the natural place to match the domain and create org membership for password signups. For Google sign-in the equivalent moment is the first successful SSO with a matching hosted-domain claim. The pending-invitations query already excludes books the user belongs to (`routes/invitations.ts:16-45`), so auto-joined books won't also appear as invitations. Cap logic lives in `services/system-settings.service.ts:78-166` (`mayRegister`).

## Session tokens and intent ids are identifiers, by construction

Every place they are persisted, logged, or echoed:

- **Session token**: `traces.session_id`, `session_shown.session_id`, `check_feedback.session_id`; `audit_log.metadata.sessionId` on every check; echoed in check responses (`routes/check.ts:315`, `routes/mcp.ts:1307`); accepted from and round-tripped into URL query strings and HTML forms (`check.ts:133`, `roundTrip: "carry"`).
- **Intent id**: `intents.id` (primary key), `intent_shown.intent_id`, `check_feedback.intent_id`; `audit_log.metadata.intentId` on checks and briefings; echoed in responses and printed in agent-facing prose by `intentEchoLine` (`services/intent.service.ts:178-193`); accepted from URL parameters. Ownership (`AND user_id = ...`) is its only protection, which is appropriate for an identifier.
- `audit_log` is deliberately retained past account deletion.

Conclusion for the scoped-sessions design: neither value can ever carry secret weight. A scoped session needs a separate secret token alongside a public id, as Option B in [../derived-agent-keys.md](../derived-agent-keys.md) proposes.

## What links a recipe to its context

`traces.api_key_id` and `traces.session_id` are real columns. There is no `intent_id` or `agent_id` on `traces`, and no link table between intents and deposited recipes. The only intent-to-recipe connection is `audit_log.metadata.intentId` on the check's audit row, plus `intent_shown`, which records deliveries rather than deposits. `agent_id` lives on `intents`, `check_feedback`, and audit metadata only.

Consequence for the repo/branch/PR idea (program doc §4.4): "recipes deposited under this intent" is not queryable today without reading the audit log. Whichever home repo context gets, deposits need a first-class link to it (an `intent_id` column on `traces`, or under scoped sessions the existing `api_key_id`, since a session is a key row).

## Implicit or materialized org-book access

The program doc leaned toward implicit access (resolve org-wide books at query time through an org-membership join) and asked for a call-site count before committing. The count reverses that lean.

- **Implicit: about 41 sites.** All ~32 membership gates need a second membership source, and several are `LEFT JOIN ... WHERE t.user_id = ? OR gm.user_id IS NOT NULL` shapes where a second source changes row cardinality and affects role projections (`traces.ts:613`, `:738-760`, `:850`). On the key path, frozen scope arrays would diverge from live truth in both directions, requiring about nine new reconciliation passes that don't exist today. And `group_members` carries per-user state (`role`, `daily_read`, `daily_write`) that an implicit join has no row to hold: daily-key minting reads those flags, and the daily-prefs endpoint is an UPDATE on the membership row.
- **Materialized: about 6 write sites plus a backfill.** Insert memberships on org join, remove or deactivate them on leave or disable, and fan out on book creation in an org (three existing creation paths: `groups.ts:86`, `import.service.ts:794`, `ephemeral-workspace.service.ts:147`). No change to the read gates, key minting, or `validateKey`. Invitation acceptance already works this way (`invitations.ts:73-77`).

**Recommendation: materialized**, with two additions to `group_members`: a provenance discriminator (`direct` or `org`) so leaving an org doesn't remove an explicitly granted membership, and a nullable deactivation timestamp so disabling a user doesn't destroy rows that re-enabling needs.

This doesn't conflict with the operator's join-over-sweep ruling for disable. That ruling is about credentials: whether a disabled user's keys work is decided by a join at validation and never by mutating keys. Materialized rows decide which books a membership covers, which is slower-moving state with an existing write path.

One interaction to settle alongside: daily-key minting falls back to all memberships when a user has every book toggled off (`routes/keys.ts:101-105`). With org books materialized, that fallback would put the whole org corpus into a daily key, so it should become an explicit choice.

## SSO schema blockers

`users.provider` and `users.external_id` exist with an index, but `password_hash` is NOT NULL (`users.ts:27`) and `loginUser` compares unconditionally (`auth.ts:234`). SSO-only accounts need a nullable column plus a branch in `loginUser`, or a sentinel hash. The program doc proposes a separate `user_identities` table rather than extending the single provider pair.
