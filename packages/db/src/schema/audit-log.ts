/**
 * Append-only audit trail for all significant system actions.
 * Never updated or deleted — only inserted.
 *
 * actor_user_id: set for human-initiated actions
 * actor_node_id: set for client-node-initiated actions
 */

import {
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const auditLog = claimnetSchema.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    actorUserId: uuid("actor_user_id"),   // ref -> public.users.id. Null = system action.
    actorNodeId: uuid("actor_node_id"),   // ref -> public.client_nodes.id. Null = user action.

    // Set on agent-initiated actions (recipe.checked, upload.received, etc.).
    // F29 (security-audit-2026-04-09) reads this column to enforce per-key
    // rate limits without maintaining a parallel counter.
    apiKeyId: uuid("api_key_id"),

    action: text("action").notNull(),
    // e.g. trace.created | evidence.linked | moderation.flagged

    targetType: text("target_type"),
    targetId: uuid("target_id"),

    metadata: jsonb("metadata"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_actor_user_id_idx").on(t.actorUserId),
    index("audit_log_target_id_idx").on(t.targetId),
    index("audit_log_occurred_at_idx").on(t.occurredAt),
    // Composite index drives F29's per-key rate-limit COUNT queries
    // (WHERE api_key_id = $1 AND occurred_at > NOW() - INTERVAL ...).
    index("audit_log_api_key_id_occurred_at_idx").on(t.apiKeyId, t.occurredAt.desc()),
  ]
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
