/**
 * Waitlist v2 — the waitlist is a state on the user record, not a table.
 *
 * Registration at a full cap creates a normal user row with waitlisted_at
 * set (password + ToS captured, email verifiable while waiting). Sign-in is
 * blocked with a "you're on the waitlist" message until the flag clears.
 * Mirrors the suspended_at pattern.
 *
 * Promotion paths:
 *   - Admin "Approve" on the Signups page → approveWaitlistedUser
 *   - Signup-cap increase → promoteTopWaitlisted(headroom): verified
 *     accounts only, invitation-holders first, then oldest-first.
 * Both send the "you're in" email (logged like all outgoing mail).
 *
 * Hygiene: waitlisted accounts that never verify their email are purged
 * after WAITLIST_UNVERIFIED_PURGE_DAYS (storage-abuse guard; disclosed in
 * the privacy policy §8). Verified waitlisted accounts are never purged.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sendWaitlistApprovedEmail } from "./email.service";
import { writeAudit } from "./audit-log.service";
import { deleteUserCascade } from "./user-delete.service";

export const WAITLIST_UNVERIFIED_PURGE_DAYS = 30;

/**
 * Clear the waitlist flag on one user (DB-only — no email). Returns the
 * user's email, or null if the user wasn't waitlisted.
 */
async function clearWaitlistFlag(
  db: PostgresJsDatabase,
  userId: string,
  actorUserId: string | null,
): Promise<string | null> {
  const rows = await db.execute(sql`
    UPDATE claimnet.users
    SET waitlisted_at = NULL, updated_at = now()
    WHERE id = ${userId}::uuid AND waitlisted_at IS NOT NULL
    RETURNING email
  `);
  const email = (rows as unknown as Array<{ email: string }>)[0]?.email;
  if (!email) return null;

  await writeAudit(db, {
    actorUserId,
    action: "user.waitlist_approved",
    targetType: "user",
    targetId: userId,
    metadata: actorUserId ? { source: "admin_approve" } : { source: "cap_increase_auto_promote" },
  });
  return email;
}

/**
 * Admin approval: clear the flag and send the "you're in" email. Returns
 * the user's email, or null if the user wasn't waitlisted. The email send
 * is best-effort — a failed send (visible in email_log) never rolls back
 * the approval.
 */
export async function approveWaitlistedUser(
  db: PostgresJsDatabase,
  userId: string,
  actorUserId: string | null,
): Promise<string | null> {
  const email = await clearWaitlistFlag(db, userId, actorUserId);
  if (!email) return null;

  try {
    await sendWaitlistApprovedEmail(email);
  } catch (err) {
    console.error(`[waitlist] Approved ${userId} but the notification email failed:`, err);
  }
  return email;
}

/**
 * Promote up to maxCount waitlisted accounts: verified email only (we only
 * admit demonstrated-real addresses automatically), invitation-holders
 * first ("an invite puts you at the top of the waitlist"), then oldest
 * first. Returns the promoted emails in order.
 *
 * DB-ONLY — deliberately sends no email. The caller (PUT /admin/settings)
 * runs this inside a transaction holding the signup_cap advisory lock so
 * concurrent registrations can't double-spend the new headroom; SMTP calls
 * inside that lock would stall every registration behind a slow mail
 * server. The caller sends the "you're in" emails after commit.
 */
export async function promoteTopWaitlisted(
  db: PostgresJsDatabase,
  maxCount: number,
): Promise<string[]> {
  if (maxCount <= 0) return [];

  const rows = await db.execute(sql`
    SELECT u.id
    FROM claimnet.users u
    WHERE u.waitlisted_at IS NOT NULL
      AND u.email_verified_at IS NOT NULL
    ORDER BY
      EXISTS (
        SELECT 1 FROM claimnet.invitations i
        WHERE i.email = u.email
          AND i.accepted_at IS NULL
          AND i.declined_at IS NULL
          AND i.expires_at > now()
      ) DESC,
      u.created_at ASC
    LIMIT ${maxCount}
  `);

  const promoted: string[] = [];
  for (const row of rows as unknown as Array<{ id: string }>) {
    const email = await clearWaitlistFlag(db, row.id, null);
    if (email) promoted.push(email);
  }
  return promoted;
}

/**
 * Delete waitlisted accounts that never verified their email within the
 * purge window. These accounts have never held a JWT or an API key, so in
 * practice only the personal org scaffolding registerUser created exists —
 * but the teardown routes through deleteUserCascade (the single audited
 * account-teardown path) rather than a hand-rolled list, so it stays
 * complete if waitlisted accounts ever gain content. Each user is its own
 * cascade (not one wrapping transaction): purge is idempotent — a failure
 * partway leaves the remaining stale accounts for the next opportunistic
 * run. Runs from the register handler's waitlist branch — no scheduler.
 */
export async function purgeStaleWaitlistedUsers(db: PostgresJsDatabase): Promise<number> {
  const stale = await db.execute(sql`
    SELECT id FROM claimnet.users
    WHERE waitlisted_at IS NOT NULL
      AND email_verified_at IS NULL
      AND created_at < now() - make_interval(days => ${WAITLIST_UNVERIFIED_PURGE_DAYS})
  `);
  const ids = (stale as unknown as Array<{ id: string }>).map((r) => r.id);

  for (const id of ids) {
    await deleteUserCascade(db, id);
  }
  return ids.length;
}
