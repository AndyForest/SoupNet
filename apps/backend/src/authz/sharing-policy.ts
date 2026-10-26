/**
 * An organization's sharing policy, for the moment a recipe-book membership
 * is granted (organization accounts round 1).
 *
 * Every grant of a membership to a person goes through the module
 * (`addMember`) or the invitation accept, and both ask this first, naming who
 * is doing the sharing: the person adding, or the invitation's inviter (an
 * outbound "admins only" policy is about who shares, not who accepts).
 * Stream Console owns the policy (inbound and outbound settings, program
 * §3.7) and owns this file: it fills this function and adds the siblings its
 * earlier checks need (invitation creation, re-filing a recipe). No other
 * file in the module changes for the policy.
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
  _grant: { bookId: string; userId: string; actorUserId: string },
): Promise<boolean> {
  return true;
}
