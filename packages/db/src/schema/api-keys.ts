/**
 * API keys — authentication tokens for agent and user API access.
 *
 * userId references claimnet.users.id.
 * groupIds is an array of group UUIDs this key is authorized for.
 *
 * keyType:
 *   'daily'  — auto-generated daily rotating key
 *   'scoped' — manually created key with specific group scope
 */

import {
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const apiKeys = claimnetSchema.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    key: text("key").notNull(),
    keyPrefix: text("key_prefix").notNull(), // first 10 chars for display

    userId: uuid("user_id").notNull(), // ref -> users.id

    readGroupIds: uuid("read_group_ids").array().notNull(), // groups this key can search
    writeGroupIds: uuid("write_group_ids").array().notNull(), // groups this key can write traces to
    defaultWriteGroupId: uuid("default_write_group_id").notNull(), // where traces go when no group specified

    label: text("label"),

    keyType: text("key_type").notNull(), // 'daily' | 'scoped'

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("api_keys_key_unique").on(t.key),
    index("api_keys_user_id_idx").on(t.userId),
    index("api_keys_expires_at_idx").on(t.expiresAt),
  ]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
