import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface AuditEventInput {
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Agent-initiated events set the indexed api_key_id column (F29 reads it
   *  for recipe.checked; per-key funnel queries read it for briefing.issued). */
  apiKeyId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeAudit(
  db: PostgresJsDatabase,
  event: AuditEventInput,
): Promise<void> {
  const { actorUserId, action, targetType = null, targetId = null, apiKeyId = null, metadata = null } = event;
  try {
    await db.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, api_key_id, metadata)
      VALUES (
        ${actorUserId}::uuid,
        ${action},
        ${targetType},
        ${targetId ? sql`${targetId}::uuid` : sql`NULL`},
        ${apiKeyId ? sql`${apiKeyId}::uuid` : sql`NULL`},
        ${metadata ? sql`${JSON.stringify(metadata)}::jsonb` : sql`NULL`}
      )
    `);
  } catch (err) {
    console.error("[audit-log] Failed to write audit event:", { action, targetId, err });
  }
}

/** How a person signed in, as recorded on their sign-in row. */
export type SignInMethod = "google" | "password";

/**
 * Record a successful sign-in (session issued), so a person can see their
 * recent sign-ins and an observable account takeover stays observable
 * (organization accounts round 1: stream SSO rubric SSO-A7b, stream Console
 * CN-T2). Actor and target are the person; the metadata is the method and
 * nothing else, never an address or a user agent. Never called on a refusal.
 */
export async function recordSignIn(db: PostgresJsDatabase, userId: string, method: SignInMethod): Promise<void> {
  await writeAudit(db, {
    actorUserId: userId,
    action: "auth.signed_in",
    targetType: "user",
    targetId: userId,
    metadata: { method },
  });
}
