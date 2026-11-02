/**
 * An organization's "require SSO" policy, for the per-request session
 * judgment (session-state.ts) and for sign-in itself.
 *
 * When it holds for an account (a `claimnet.users` row aliased `u`), a
 * session not issued by a Workspace Google sign-in (`idp` other than
 * `google`) is refused with `sso_required`, and so are password sign-in and
 * password reset. It holds for an active member of a company organization
 * whose `require_sso` is on (stream SSO, rubric SSO-M2, SSO-R2 to SSO-R5);
 * guests on its books and personal accounts are untouched. A disabled member
 * is already refused by the account-state check, so the policy reads only
 * active rows, through the same membership predicate Offboarding extends.
 *
 * This fragment is the only change stream SSO makes in this module.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { orgMembershipDisabled } from "./account-state";

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

/** Does the account in `u` have to sign in through its organization's SSO? */
export function ssoRequired(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM claimnet.organization_members om
    JOIN claimnet.organizations o ON o.id = om.organization_id
    WHERE om.user_id = u.id AND o.require_sso AND NOT (${orgMembershipDisabled()})
  )`;
}

/** The same rule for one account, for password sign-in, password reset and the Google callback. */
export async function ssoRequiredFor(db: SqlExecutor, userId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT ${ssoRequired()} AS required FROM claimnet.users u WHERE u.id = ${userId}::uuid
  `);
  return (rows as unknown as Array<{ required: boolean }>)[0]?.required === true;
}
