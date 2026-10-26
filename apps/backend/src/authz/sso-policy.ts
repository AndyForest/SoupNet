/**
 * An organization's "require SSO" policy, for the per-request session
 * judgment (session-state.ts).
 *
 * When it holds for an account (a `claimnet.users` row aliased `u`), a
 * session not issued by the organization's identity provider is refused with
 * `sso_required`. Stream SSO owns the policy column and fills this one
 * fragment; it is the only change SSO makes in this module.
 *
 * Until then it is FALSE: no session is refused for how it was signed in.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** Does the account in `u` have to sign in through its organization's SSO? */
export function ssoRequired(): SQL {
  return sql`FALSE`;
}
