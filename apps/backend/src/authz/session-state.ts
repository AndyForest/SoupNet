/**
 * Session (JWT) state: the human half of credential judgment.
 *
 * Sessions are stateless seven-day JWTs with no revocation list, so whether
 * one still works is decided per request by looking its user up (the lookup
 * `requireVerifiedEmail` has always done). That lookup reads the same
 * account-state fragment API keys are judged by (account-state.ts), plus the
 * session cut-off, `users.sessions_valid_after`.
 *
 * Every JWT router mounts the check through auth.ts's middleware; the
 * routes that must stay reachable before verification mount the half that
 * skips the verification test, never neither.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { accountDisabledReason } from "./account-state";
import type { AccountDisabledReason } from "./account-state";
import { ssoRequired } from "./sso-policy";

/** Why a presented session can't be used, or null when it can. */
export type SessionRefusal =
  /** The user row is gone. */
  | "unknown_account"
  /** Issued before the account's sessions_valid_after. */
  | "session_expired"
  | AccountDisabledReason
  /** Not signed in through the organization's identity provider, which its
   *  policy requires (sso-policy.ts; stream SSO fills it). */
  | "sso_required";

export interface SessionState {
  refusal: SessionRefusal | null;
  emailVerified: boolean;
}

/**
 * Judge a session for `userId` issued at `issuedAtSeconds` (the JWT's `iat`),
 * signed in through `identityProvider` (the JWT's `idp`; absent for a
 * password sign-in).
 *
 * The cut-off compares whole seconds, the resolution `iat` carries: a session
 * issued in an earlier second than `sessions_valid_after` is refused, one from
 * the same second or later is not. A token with no `iat` predates nothing it
 * could be compared with, so it is refused whenever a cut-off is set.
 */
export async function sessionState(
  db: PostgresJsDatabase,
  userId: string,
  issuedAtSeconds: number | undefined,
  identityProvider?: string | undefined,
): Promise<SessionState> {
  const iat = typeof issuedAtSeconds === "number" && Number.isFinite(issuedAtSeconds) ? Math.floor(issuedAtSeconds) : null;
  const rows = await db.execute(sql`
    SELECT u.email_verified_at IS NOT NULL AS verified,
           ${accountDisabledReason()} AS disabled,
           (u.sessions_valid_after IS NOT NULL
             AND (${iat}::bigint IS NULL OR ${iat}::bigint < floor(extract(epoch FROM u.sessions_valid_after))::bigint)) AS expired,
           (${identityProvider ?? null}::text IS DISTINCT FROM 'google' AND ${ssoRequired()}) AS sso_required
    FROM claimnet.users u
    WHERE u.id = ${userId}::uuid
  `);
  const row = (rows as unknown as Array<{ verified: boolean; disabled: AccountDisabledReason | null; expired: boolean; sso_required: boolean }>)[0];
  if (!row) return { refusal: "unknown_account", emailVerified: false };
  if (row.expired) return { refusal: "session_expired", emailVerified: row.verified };
  if (row.disabled) return { refusal: row.disabled, emailVerified: row.verified };
  if (row.sso_required) return { refusal: "sso_required", emailVerified: row.verified };
  return { refusal: null, emailVerified: row.verified };
}

/**
 * At sign-in, after the password checks: is this account switched off?
 * Login issues no session to one that is (the waitlist precedent).
 */
export async function accountRefusal(db: PostgresJsDatabase, userId: string): Promise<AccountDisabledReason | null> {
  const rows = await db.execute(sql`
    SELECT ${accountDisabledReason()} AS disabled FROM claimnet.users u WHERE u.id = ${userId}::uuid
  `);
  return (rows as unknown as Array<{ disabled: AccountDisabledReason | null }>)[0]?.disabled ?? null;
}

/** Well beyond the clock skew expected between backend tasks; unmeasured on Fargate. */
const CUT_OFF_MARGIN_SECONDS = 5;

/**
 * Refuse every session issued before now (recipe a8003678). For SSO's account
 * linking, which discards an unverified password: a session the
 * pre-registrant already holds dies with it. Keys are untouched; an
 * unverified account has none. A Google handoff code already issued for the
 * account goes too, since it would otherwise produce a session past the
 * cut-off (F143, F149).
 *
 * The cut-off sits a few seconds ahead: a session someone was minting as this
 * ran would otherwise survive for its seven days. `iat` can't tell the two
 * parts of this second apart (F145), and the task minting it may have a clock
 * ahead of this one (F147). A sign-in that follows the cut-off dates its session
 * no earlier than it, so it isn't refused: `exchangeHandoff` and `loginUser`.
 * Each reads the cut-off with what it checks, so one that won the race against
 * this doesn't see it.
 *
 * The cut-off is stamped from this process's clock, not the database's
 * NOW(): it is compared with a JWT's `iat`, which this process's clock
 * signed, and the database host's clock can run ahead of it (recipe
 * 2f40fb9f). With NOW(), a session signed a moment after the cut-off could
 * read as issued before it and be refused.
 */
export async function invalidateSessions(db: PostgresJsDatabase, userId: string): Promise<void> {
  const cutOffSeconds = Math.floor(Date.now() / 1000) + CUT_OFF_MARGIN_SECONDS;
  // Two statements, in this order: the first takes the row lock `issueHandoff`
  // waits on, so the second's fresh snapshot finds any code it just committed.
  // The transaction holds that lock across both (a savepoint, inside a caller's).
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE claimnet.users SET sessions_valid_after = to_timestamp(${cutOffSeconds}) WHERE id = ${userId}::uuid
    `);
    await tx.execute(sql`
      UPDATE claimnet.sso_login_requests SET handoff_consumed_at = now()
      WHERE user_id = ${userId}::uuid AND handoff_hash IS NOT NULL AND handoff_consumed_at IS NULL
    `);
  });
}
