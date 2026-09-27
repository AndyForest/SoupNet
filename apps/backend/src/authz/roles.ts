/**
 * Role predicates for recipe-book memberships. Pure — no I/O.
 *
 * Each predicate is an explicit allowlist, the same posture as
 * `canWriteToBook` in @soupnet/domain: a role this file has never heard of
 * (a future read-only `viewer`, say) answers false everywhere until someone
 * adds it on purpose. `null` / `undefined` mean "no membership row" and are
 * always false, so a caller that forgets to handle the non-member case still
 * fails closed.
 */

/**
 * What `roleIn` returns: the stored role text (`owner` | `admin` | `member`
 * today), or null when the user has no membership row. Typed as plain text
 * because the column is — the predicates below are what give it meaning.
 */
export type BookRole = string | null;

const OWNER_ROLES: readonly string[] = ["owner"];
const OWNER_OR_ADMIN_ROLES: readonly string[] = ["owner", "admin"];

/** Holds the `owner` role: may edit book details and remove members. */
export function isOwner(role: string | null | undefined): boolean {
  if (!role) return false;
  return OWNER_ROLES.includes(role);
}

/**
 * Holds `owner` or `admin`: may add members, manage invitations, and delete or
 * re-file other members' recipes in the book.
 */
export function isOwnerOrAdmin(role: string | null | undefined): boolean {
  if (!role) return false;
  return OWNER_OR_ADMIN_ROLES.includes(role);
}

/**
 * Is a recipe in this draft state published — an ordinary recipe (no state)
 * or a draft its person verified? Anything else, including a value this file
 * has never heard of, is unpublished: fail closed.
 */
export function isPublishedDraftState(draftState: string | null | undefined): boolean {
  return draftState === null || draftState === undefined || draftState === "verified";
}

/** The facts the trace read rule decides on, for one viewer and one recipe. */
export interface TraceReadFacts {
  /** The viewer wrote this recipe. */
  isAuthor: boolean;
  /** The viewer's role in the recipe's book, or null without a membership. */
  role: string | null | undefined;
  /** The recipe's draft state (null: never a draft). */
  draftState?: string | null | undefined;
  /** The viewer is the person the draft is about. */
  isDraftSubject?: boolean | undefined;
  /** The viewer is the person whose agent deposited the draft. */
  isDraftDepositor?: boolean | undefined;
}

/**
 * THE trace read rule — the only JS copy. A published recipe: the author can
 * always read it, and so can anyone with a membership in the book it lives in
 * (any role: "a membership exists", deliberately not an allowlist). An
 * unpublished draft (drafts-and-triage slice 2): only the person it is about
 * and the person whose agent deposited it, whatever role anyone else holds,
 * book owners included.
 *
 * The DB-bound functions in trace-access.ts fetch the facts and call this.
 * Set-returning statements use the SQL form of the same rule in
 * draft-sql.ts; draft-sql.test.ts proves the two agree.
 */
export function mayReadTrace(viewer: TraceReadFacts): boolean {
  if (!isPublishedDraftState(viewer.draftState)) {
    return viewer.isDraftSubject === true || viewer.isDraftDepositor === true;
  }
  return viewer.isAuthor || (viewer.role !== null && viewer.role !== undefined);
}

/**
 * May this viewer resolve (verify or reject) the draft? Only the person it is
 * about, and only while it is unverified: resolution is one-way (DT-VER-03),
 * and a depositor who is not the subject never verifies someone else's draft
 * (DT-OBO-04, for slice 4).
 */
export function mayResolveDraft(facts: { draftState: string | null | undefined; isDraftSubject: boolean }): boolean {
  return facts.draftState === "unverified" && facts.isDraftSubject;
}

/**
 * May a request authenticated by this key verify drafts through the agent
 * operation? Every key may today. Slice 5's headless keys may not (build log
 * open question 13, DT-HDL-04): that is the one line that changes here, so a
 * key's verify authority comes from a property of the key rather than from
 * "any key of the person".
 */
export function keyMayVerifyDrafts(_key: { keyType: string }): boolean {
  return true;
}
