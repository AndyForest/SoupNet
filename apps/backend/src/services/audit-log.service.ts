import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { BOOK_TEXT_ACTIONS, CHECK_LOG_ACTIONS, RECIPE_TEXT_ACTIONS } from "./audit-actions";
import type { AuditAction } from "./audit-actions";

export interface AuditEventInput {
  actorUserId: string | null;
  action: AuditAction;
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

/**
 * Anonymise a departing person's check log (recipe 1d1531da; the September
 * design 569fc2cc: "null `actor_user_id`, redact `metadata.filter`"), and
 * remove their recipe text from the account events that carry it. Run inside
 * the account-deletion cascade's final transaction, and once more after it
 * commits for a row a request in flight wrote meanwhile (F119); it is
 * idempotent.
 *
 * Their check-log rows (CHECK_LOG_ACTIONS) lose what points at them: the
 * actor, the key in `api_key_id` and in `metadata.apiKeyId`, a target that
 * is the key (a briefing's), and a search's free-text `metadata.filter`.
 * Everything else stays, so counts and task groupings survive: the action,
 * the target recipe or search, the time, session and intent ids (the rows
 * they joined to go with the account), result ids, ratings and surface.
 *
 * Other people's check-log rows that name the person as the subject of a
 * deposit keep `subjectUserId` as null: the record that a deposit about
 * someone happened survives without naming them. That match reads metadata
 * across the check log; account deletion is rare, so the scan is accepted.
 *
 * Account events are kept, except that a recipe-text event
 * (RECIPE_TEXT_ACTIONS) the person wrote, or one about a recipe of theirs,
 * loses `claimText`, and a book-text event (BOOK_TEXT_ACTIONS) the person
 * wrote loses the names and descriptions it recorded (F116). Their action,
 * ids, book slug and counts stay.
 */
export async function anonymiseAuditLogOf(db: PostgresJsDatabase, userId: string): Promise<void> {
  const checkLog = sql.join(CHECK_LOG_ACTIONS.map((a) => sql`${a}`), sql`, `);
  await db.execute(sql`
    UPDATE claimnet.audit_log
    SET actor_user_id = NULL,
        api_key_id = NULL,
        target_id = CASE WHEN target_type = 'api_key' THEN NULL ELSE target_id END,
        metadata = CASE WHEN metadata IS NULL THEN NULL ELSE metadata - 'apiKeyId' - 'filter' END
    WHERE actor_user_id = ${userId}::uuid
      AND action IN (${checkLog})
  `);
  await db.execute(sql`
    UPDATE claimnet.audit_log
    SET metadata = jsonb_set(metadata, '{subjectUserId}', 'null'::jsonb)
    WHERE action IN (${checkLog})
      AND metadata->>'subjectUserId' = ${userId}
  `);
  const recipeText = sql.join(RECIPE_TEXT_ACTIONS.map((a) => sql`${a}`), sql`, `);
  await db.execute(sql`
    UPDATE claimnet.audit_log
    SET metadata = metadata - 'claimText'
    WHERE action IN (${recipeText})
      AND metadata ? 'claimText'
      AND (actor_user_id = ${userId}::uuid OR metadata->>'traceUserId' = ${userId})
  `);
  const bookText = sql.join(BOOK_TEXT_ACTIONS.map((a) => sql`${a}`), sql`, `);
  await db.execute(sql`
    UPDATE claimnet.audit_log
    SET metadata = metadata - 'previousDescription' - 'newDescription' - 'previousName' - 'newName' - 'groupName'
    WHERE action IN (${bookText})
      AND actor_user_id = ${userId}::uuid
      AND metadata ?| array['previousDescription', 'newDescription', 'previousName', 'newName', 'groupName']
  `);
}
