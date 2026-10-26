/**
 * The authorization seam: who a caller is allowed to be, and which recipe
 * books they may touch.
 *
 *   key-auth.ts        — AGENT (Bearer-path) callers: authenticate an API key
 *                        and resolve its effective scope; the statements that
 *                        mint a credential from another one
 *   book-access.ts     — HUMAN (JWT-path) callers: who can see which books,
 *                        role lookup
 *   trace-access.ts    — a viewer's standing on one recipe, in one statement
 *   memberships.ts     — the membership rows themselves
 *   book-succession.ts — membership questions account deletion asks
 *   roles.ts           — pure role predicates, and the trace read rule
 *   membership-sql.ts  — the membership condition, written once (internal:
 *                        deliberately not re-exported)
 *   scope-sql.ts       — a caller's book scope as a SQL condition; an empty
 *                        scope reads nothing
 *   draft-sql.ts       — the draft visibility condition, written once, for
 *                        every set-returning statement (the JS form is
 *                        mayReadTrace in roles.ts); its facts helpers stay
 *                        internal
 *   draft-resolution.ts — the one statement that verifies or rejects a draft
 *   naming.ts          — who may be named as the subject of a draft deposited
 *                        on their behalf (slice 4)
 *   report-scope.ts    — whose feedback row it is, and whether a report's
 *                        viewer may read the recipe a row names (slice 9)
 *   account-state.ts   — may this account act at all: the site operator's
 *                        suspension and an org admin's disable, composed by
 *                        every credential check (org round 1)
 *   session-state.ts   — the per-request session (JWT) judgment and login's
 *                        account check; the session cut-off
 *   organizations.ts   — company organizations: membership, the join,
 *                        org-wide books, the org admin's actions
 *   domain-authority.ts — whether an organization has verified a domain
 *                        (stream Domains fills it)
 *   sso-policy.ts      — whether an account must sign in through its
 *                        organization's SSO (stream SSO fills it)
 *   sharing-policy.ts  — whether a membership grant crosses an
 *                        organization's sharing policy (stream Console fills it)
 *
 * Import from here. See docs/engineering-principles.md §7.
 */

export * from "./roles";
export * from "./book-access";
export * from "./trace-access";
export * from "./memberships";
export * from "./book-succession";
export * from "./key-auth";
export * from "./scope-sql";
export {
  publishedTrace,
  traceVisibleTo,
  traceIdVisibleTo,
  traceReadableById,
  traceReadableByPerson,
  draftAwaitingReviewBy,
  draftLive,
  draftExpired,
  draftExpiryReason,
  draftExpiryShownTo,
  draftRecentlyExpiredAwaitingReviewBy,
  draftLiveAwaitingReviewBy,
  draftExpiredAwaitingReviewBy,
  draftStateShownTo,
  viewerIsDraftSubject,
  onBehalfSubjectOf,
  onBehalfPartyFor,
  onBehalfSideFor,
  SHARED_AUDIENCE,
  isSharedAudience,
} from "./draft-sql";
export type { DraftAudience, SharedAudience, TraceAlias } from "./draft-sql";
export * from "./draft-resolution";
export * from "./naming";
export * from "./report-scope";
export * from "./account-state";
export * from "./session-state";
export * from "./organizations";
export * from "./sharing-policy";
export * from "./domain-authority";
export * from "./sso-policy";
