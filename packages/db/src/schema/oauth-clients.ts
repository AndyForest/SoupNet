/**
 * OAuth 2.1 client registrations — third-party apps that have completed
 * Dynamic Client Registration against /oauth/register. The directory-eligible
 * "Add custom connector" flow in claude.ai is the primary consumer.
 *
 * client_secret is stored only as a SHA-256 hash, matching the api_keys pattern.
 * redirect_uris is an array of exact-match URIs; /authorize validates the
 * inbound `redirect_uri` against this list without partial-match or port flex.
 */
import {
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const oauthClients = claimnetSchema.table(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    clientId: text("client_id").notNull(),
    clientSecretHash: text("client_secret_hash").notNull(),

    clientName: text("client_name"),
    redirectUris: text("redirect_uris").array().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    unique("oauth_clients_client_id_unique").on(t.clientId),
  ]
);

export type OAuthClient = typeof oauthClients.$inferSelect;
export type NewOAuthClient = typeof oauthClients.$inferInsert;
