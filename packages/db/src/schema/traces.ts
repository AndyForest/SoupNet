/**
 * Traces — the core content unit in the search-as-logging model.
 *
 * A trace is a structured knowledge claim submitted by an agent or user.
 * userId and groupId are UUID references to claimnet.users and claimnet.groups.
 *
 * The tsvector column for full-text search is added via migration SQL
 * (Drizzle does not support generated columns natively).
 */

import {
  pgSchema,
  uuid,
  text,
  real,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const claimnetSchema = pgSchema("claimnet");

// Forward-declare users and groups tables to avoid circular imports.
// FK constraints for these are established in users.ts and groups.ts respectively.
// We use uuid columns here without .references() to break the circular dependency.
export const traces = claimnetSchema.table(
  "traces",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    userId: uuid("user_id").notNull(),   // FK -> users.id
    groupId: uuid("group_id").notNull(), // FK -> groups.id
    apiKeyId: uuid("api_key_id"), // which agent session created this trace (nullable for pre-existing data)

    claimText: text("claim_text").notNull(),
    claimTextHash: text("claim_text_hash"), // SHA-256 for idempotency check (nullable for pre-existing data)
    formatAdherenceScore: real("format_adherence_score"),

    // When the human originally made this taste/judgment call, if it predates
    // the check (e.g. a decision mined from git history or an old ADR).
    // NULL = the judgment is contemporaneous with the check. created_at stays
    // the insertion time, so the record never claims to have been logged
    // earlier than it was; agent-facing surfaces show
    // COALESCE(decided_at, created_at) as the judgment date.
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("traces_user_id_idx").on(t.userId),
    index("traces_group_id_idx").on(t.groupId),
    index("traces_api_key_id_idx").on(t.apiKeyId),
    index("traces_created_at_idx").on(t.createdAt),
    // Idempotency: same agent + group + claim text = same trace
    unique("traces_api_key_group_claim_unique").on(t.apiKeyId, t.groupId, t.claimTextHash),
    // tsvector GIN index defined in migration SQL
  ]
);

export type Trace = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;
