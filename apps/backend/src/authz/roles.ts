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
 * The trace read rule, for callers that already hold the trace row and the
 * viewer's role in its book: the author can always read their own recipe, and
 * so can anyone with a membership row in the book it lives in. Any role counts
 * — this is "a membership exists", deliberately not an allowlist, because it
 * mirrors the SQL form in `canReadTrace` (book-access.ts). The two are tested
 * against each other; change them together.
 */
export function mayReadTrace(viewer: { isAuthor: boolean; role: string | null | undefined }): boolean {
  return viewer.isAuthor || (viewer.role !== null && viewer.role !== undefined);
}
