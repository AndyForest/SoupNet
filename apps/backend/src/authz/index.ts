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
 *   content-ownership.ts — whose evidence and references a caller may link
 *                        to or reuse by id: only their own [F98]
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
  draftStateShownTo,
  SHARED_AUDIENCE,
  isSharedAudience,
} from "./draft-sql";
export type { DraftAudience, SharedAudience, TraceAlias } from "./draft-sql";
export * from "./draft-resolution";
export * from "./content-ownership";
