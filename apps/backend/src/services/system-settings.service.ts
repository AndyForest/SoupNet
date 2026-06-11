import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { systemSettings } from "@soupnet/db";

export interface SystemSettingsMap {
  signupCap: number;
  embeddingsEnabled: boolean;
}

const DEFAULTS: SystemSettingsMap = {
  signupCap: 0, // No self-signups until admin sets it
  embeddingsEnabled: true, // Gemini API calls enabled by default
};

export async function getSetting<K extends keyof SystemSettingsMap>(
  db: PostgresJsDatabase,
  key: K,
): Promise<SystemSettingsMap[K]> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(sql`${systemSettings.key} = ${key}`)
    .limit(1);

  const row = rows[0];
  if (!row) return DEFAULTS[key];

  return JSON.parse(row.value) as SystemSettingsMap[K];
}

export async function setSetting<K extends keyof SystemSettingsMap>(
  db: PostgresJsDatabase,
  key: K,
  value: SystemSettingsMap[K],
): Promise<void> {
  const jsonValue = JSON.stringify(value);

  // Upsert
  await db.execute(sql`
    INSERT INTO claimnet.system_settings (key, value, updated_at)
    VALUES (${key}, ${jsonValue}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${jsonValue}, updated_at = now()
  `);
}

export async function getAllSettings(
  db: PostgresJsDatabase,
): Promise<SystemSettingsMap> {
  const rows = await db.select().from(systemSettings);

  const result = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) {
      (result as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    }
  }
  return result;
}

export async function getVerifiedUserCount(db: PostgresJsDatabase): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total FROM claimnet.users
    WHERE email_verified_at IS NOT NULL OR role = 'system'
  `);
  return ((rows[0] as Record<string, unknown>)?.["total"] as number) ?? 0;
}

export interface CapCheckOptions {
  /**
   * Exclude this invitation from the pending count. Used when the holder of
   * a reservation is the one registering — their own reserved slot must not
   * be counted against them.
   */
  excludeInvitationId?: string;
}

/**
 * Pending non-bypass invitations = reservations against the cap.
 *
 * A reservation stops counting once its email belongs to a registered user
 * — otherwise an invitee who registered but hasn't yet clicked Accept on the
 * recipe-book invite would hold a phantom slot (counted once as a user AND
 * once as a pending invitation) for up to 7 days.
 */
export async function getPendingInvitationCount(
  db: PostgresJsDatabase,
  opts?: CapCheckOptions,
): Promise<number> {
  const excludeId = opts?.excludeInvitationId ?? null;
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total FROM claimnet.invitations i
    WHERE i.accepted_at IS NULL
      AND i.expires_at > now()
      AND i.bypass_cap = false
      AND (${excludeId}::uuid IS NULL OR i.id != ${excludeId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.users u WHERE u.email = i.email
      )
  `);
  return ((rows[0] as Record<string, unknown>)?.["total"] as number) ?? 0;
}

/**
 * Check if a new signup would exceed the cap.
 * Counts verified users + pending non-bypass invitations against the cap.
 */
export async function isSignupCapReached(
  db: PostgresJsDatabase,
  opts?: CapCheckOptions,
): Promise<boolean> {
  const cap = await getSetting(db, "signupCap");
  if (cap === 0) return true; // Cap of 0 means no self-signups

  const verifiedCount = await getVerifiedUserCount(db);
  const pendingCount = await getPendingInvitationCount(db, opts);

  return (verifiedCount + pendingCount) >= cap;
}

/**
 * Atomically check and consume a signup slot using an advisory lock.
 * Prevents race conditions where concurrent registrations both pass the cap check.
 * Returns true if signup is allowed (slot consumed), false if cap is actually reached.
 *
 * Uses pg_advisory_xact_lock (blocking) rather than pg_try_advisory_xact_lock
 * (non-blocking). The non-blocking variant surfaces brief contention as a
 * "waitlist" 403 — a real bug for concurrent users and the source of flaky
 * parallel-test failures (traces.test.ts and others). The blocking variant
 * preserves the no-overshoot guarantee while serializing concurrent attempts
 * for microseconds rather than failing them.
 */
export async function tryConsumeSignupSlot(
  db: PostgresJsDatabase,
  opts?: CapCheckOptions,
): Promise<boolean> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('signup_cap'))`);
  return !(await isSignupCapReached(db, opts));
}

/**
 * Decide whether a registration may proceed under the signup cap.
 *
 * Invite semantics (operator decision, 2026-06-11): a member invitation puts
 * the invitee at the TOP of the waitlist, it does not bypass it. The
 * invitation reserves a slot (counted in getPendingInvitationCount), and the
 * invitee can register only while that reservation fits within the cap —
 * their own pending invitation is excluded from the count so the reservation
 * doesn't block its own holder. When the cap is genuinely full, they wait
 * like everyone else, first in line when the cap rises.
 *
 * Admin invitations (bypassCap) skip the cap entirely — the admin-only
 * full-bypass tool.
 */
export async function mayRegister(
  db: PostgresJsDatabase,
  invitation: { id: string; bypassCap: boolean } | null,
): Promise<boolean> {
  if (invitation?.bypassCap) return true;
  if (invitation) {
    return tryConsumeSignupSlot(db, { excludeInvitationId: invitation.id });
  }
  return tryConsumeSignupSlot(db);
}
