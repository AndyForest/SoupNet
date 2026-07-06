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
