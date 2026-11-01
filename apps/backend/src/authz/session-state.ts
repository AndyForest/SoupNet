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

/**
 * Refuse every session issued before now (recipe a8003678). For SSO's account
 * linking, which discards an unverified password, and for a password reset
 * (recipe 450a107b): a session the pre-registrant already holds dies with it.
 * Keys are untouched; an unverified account has none.
 *
 * The cut-off is stamped from this process's clock, not the database's
 * NOW(): it is compared with a JWT's `iat`, which this process's clock
 * signed, and the database host's clock can run ahead of it (recipe
 * 2f40fb9f). With NOW(), a session signed a moment after the cut-off could
 * read as issued before it and be refused.
 */
export async function invalidateSessions(db: Pick<PostgresJsDatabase, "execute">, userId: string): Promise<void> {
  const cutOffSeconds = Math.floor(Date.now() / 1000);
  await db.execute(sql`
    UPDATE claimnet.users SET sessions_valid_after = to_timestamp(${cutOffSeconds}) WHERE id = ${userId}::uuid
  `);
}

/**
 * What outlives a session cut-off. Keys and connected apps survive a reset,
 * because a person who only forgot a password shouldn't lose them and the two
 * cases can't be told apart. So whoever just proved the mailbox is told what's
 * running, to review and end (F151). A connected app counts while its refresh
 * token can still renew it.
 */
export async function credentialsStillRunning(
  db: Pick<PostgresJsDatabase, "execute">,
  userId: string,
): Promise<{ apiKeys: number; connectedApps: number }> {
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE key_type <> 'oauth' AND expires_at > now())::int AS "apiKeys",
      count(*) FILTER (WHERE key_type = 'oauth' AND (expires_at > now() OR refresh_token_expires_at > now()))::int AS "connectedApps"
    FROM claimnet.api_keys WHERE user_id = ${userId}::uuid
  `);
  return (rows as unknown as Array<{ apiKeys: number; connectedApps: number }>)[0] ?? { apiKeys: 0, connectedApps: 0 };
}
