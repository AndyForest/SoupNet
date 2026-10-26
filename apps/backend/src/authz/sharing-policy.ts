/**
 * An organization's sharing policy, for the moment a recipe-book membership
 * is granted (organization accounts round 1).
 *
 * Every grant of a membership to a person goes through the module
 * (`addMember`) or the invitation accept, and both ask this first. Stream
 * Console owns the policy (inbound and outbound settings, program §3.7) and
 * fills this one function; it is the only change Console makes in this
 * module. It also calls it earlier itself, at invitation creation and when a
 * recipe is re-filed.
 *
 * Until then it allows everything: no grant is refused for crossing an
 * organization's boundary.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/** Runs on the root connection or inside a transaction. */
type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

/**
 * May `userId` be granted a membership in `bookId` under the sharing policy
 * of the organizations on either side? Membership as such (who may invite,
 * roles) is decided by the caller; this only answers the boundary question.
 */
export async function sharingPolicyAllows(
  _db: SqlExecutor,
  _grant: { bookId: string; userId: string },
): Promise<boolean> {
  return true;
}
