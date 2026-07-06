/**
 * Premium is a state on the user record (premium_at nullable timestamp), not a
 * table — premium ⇔ premium_at IS NOT NULL. Admin-assigned only: no self-serve,
 * no billing (docs/planning/premium-llm-features.md). Mirrors the
 * waitlisted_at / suspended_at nullable-timestamp pattern and its service seam
 * (waitlist.service.ts).
 *
 * The gate itself (premium && feature-flag) is enforced on the LLM-touching
 * path; this service only flips the attribute the gate reads.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { writeAudit } from "./audit-log.service";

/**
 * Set (or clear) a user's premium attribute and write an audit event. Returns
 * false if no user with that id exists (so the route can 404). Idempotent —
 * re-setting to the same state is a harmless no-op update.
 */
export async function setUserPremium(
  db: PostgresJsDatabase,
  userId: string,
  premium: boolean,
  actorUserId: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE claimnet.users
    SET premium_at = ${premium ? sql`now()` : sql`NULL`}, updated_at = now()
    WHERE id = ${userId}::uuid
    RETURNING id
  `);
  if ((rows as unknown as Array<{ id: string }>).length === 0) return false;

  await writeAudit(db, {
    actorUserId,
    action: "user.premium_set",
    targetType: "user",
    targetId: userId,
    metadata: { premium },
  });
  return true;
}
