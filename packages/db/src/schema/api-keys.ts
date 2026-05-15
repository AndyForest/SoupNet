/**
 * API keys — authentication tokens for agent and user API access.
 *
 * userId references claimnet.users.id.
 * groupIds is an array of group UUIDs this key is authorized for.
 *
 * keyType:
 *   'daily'  — auto-generated daily rotating key
 *   'scoped' — manually created key with specific group scope
 *   'oauth'  — issued via the OAuth 2.1 /oauth/token endpoint. Carries a
 *              refresh_token_hash + refresh_token_expires_at and an
 *              oauth_client_id linking back to oauth_clients. Functionally
 *              identical to 'scoped' at the validation layer — same Bearer
 *              path, same recipe-book scope fields — only the issuance flow
 *              differs.
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

    keyType: text("key_type").notNull(), // 'daily' | 'scoped' | 'oauth'

    // OAuth fields — null for 'daily' and 'scoped'. Populated for 'oauth' keys.
    // refreshTokenHash + refreshTokenExpiresAt: SHA-256 of the refresh token
    // and its expiry. Rotation (OAuth 2.1 §6.1) issues a new api_keys row on
    // each use and revokes the old. oauthClientId references oauth_clients.client_id.
    refreshTokenHash: text("refresh_token_hash"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    oauthClientId: text("oauth_client_id"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("api_keys_key_unique").on(t.key),
    index("api_keys_user_id_idx").on(t.userId),
    index("api_keys_expires_at_idx").on(t.expiresAt),
    index("api_keys_refresh_token_hash_idx").on(t.refreshTokenHash),
  ]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
