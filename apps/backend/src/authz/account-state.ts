/**
 * Account state: may this account act at all? The rule every credential is
 * judged by, written once (organization accounts round 1, stream Core).
 *
 * Two switches turn an account off, reversibly, and are kept apart so neither
 * party can undo the other's:
 *   - the site operator's suspension, `users.suspended_at`;
 *   - an org admin's disable, `organization_members.disabled_at` on the
 *     person's one company membership.
 *
 * Nothing is swept: no key, refresh token or session is changed when either
 * is set (recipe 92b866ee). Every statement that authorizes on a credential
 * embeds `activeUserPredicate` (key-auth.ts), which composes `accountDisabled`
 * below; the per-request session lookup and login read the same fragment
 * through `sessionState` and `accountRefusal` (session-state.ts). So setting
 * either column refuses every surface on its next request, and clearing it
 * restores the same credentials.
 *
 * OFFBOARDING'S DIRECTORY STATUS LANDS IN `orgMembershipDisabled`, and only
 * there: a member the company's directory reports suspended is disabled the
 * same way a manual disable is, through the same join.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { directoryInactive, directoryUnconfirmed } from "./directory-sql";

/**
 * Is this `organization_members` row (aliased `om`) switched off? An org
 * admin's disable, or, for a member checked against the company's Google
 * Workspace directory, a directory that says they aren't active or a check
 * that hasn't succeeded for a day (stream Offboarding, directory-sql.ts).
 */
export function orgMembershipDisabled(): SQL {
  return sql`(om.disabled_at IS NOT NULL OR ${directoryInactive()} OR ${directoryUnconfirmed()})`;
}

/**
 * Is the account (a `claimnet.users` row aliased `u`) switched off, by the
 * site operator or by its organization? Composed by `activeUserPredicate`.
 */
export function accountDisabled(): SQL {
  return sql`(u.suspended_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM claimnet.organization_members om
    WHERE om.user_id = u.id AND ${orgMembershipDisabled()}
  ))`;
}

/**
 * Which switch is off, for copy that tells a person the cause: 'suspended'
 * (the site operator's) wins over 'org_disabled', since an org admin's
 * re-enable can't lift it, and an admin's disable wins over the directory's
 * two reasons, 'directory_inactive' and 'directory_unconfirmed' (recipe
 * efa4bbca). NULL when the account is on. Against `u`.
 */
export function accountDisabledReason(): SQL {
  const member = (condition: SQL) => sql`EXISTS (
      SELECT 1 FROM claimnet.organization_members om
      WHERE om.user_id = u.id AND ${condition}
    )`;
  return sql`(CASE
    WHEN u.suspended_at IS NOT NULL THEN 'suspended'
    WHEN ${member(sql`om.disabled_at IS NOT NULL`)} THEN 'org_disabled'
    WHEN ${member(directoryInactive())} THEN 'directory_inactive'
    WHEN ${member(directoryUnconfirmed())} THEN 'directory_unconfirmed'
  END)`;
}

export type AccountDisabledReason = "suspended" | "org_disabled" | "directory_inactive" | "directory_unconfirmed";
