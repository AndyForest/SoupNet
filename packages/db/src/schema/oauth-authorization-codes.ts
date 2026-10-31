/**
 * OAuth 2.1 authorization codes — short-lived (5 min) one-time-use tokens
 * issued by /oauth/authorize and redeemed at /oauth/token.
 *
 * The raw code is stored only as a SHA-256 hash. PKCE binding: code_challenge
 * is captured at issuance, and /oauth/token verifies that
 * SHA256(code_verifier) == code_challenge before redeeming. Only S256 is
 * accepted (code_challenge_method is recorded for future-proofing).
 *
 * Scope is captured as the three recipe-book arrays that match the existing
 * scoped-key shape (read/write/default-write), so /oauth/token can mint the
 * resulting api_keys row directly without a second consent step.
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

export const oauthAuthorizationCodes = claimnetSchema.table(
  "oauth_authorization_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    codeHash: text("code_hash").notNull(),

    clientId: text("client_id").notNull(),
    userId: uuid("user_id").notNull(),

    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull(),

    // Granted scope, captured at consent time. Mirrors the scoped-key shape
    // so /oauth/token can call the same generateScopedKey() service.
    scopeReadGroupIds: uuid("scope_read_group_ids").array().notNull(),
    scopeWriteGroupIds: uuid("scope_write_group_ids").array().notNull(),
    scopeDefaultWriteGroupId: uuid("scope_default_write_group_id").notNull(),

    // The canonical resource the code was granted for (RFC 8707; migration
    // 0043). The token exchange refuses a `resource` that normalizes to
    // anything else, and the minted key carries it as its audience.
    resource: text("resource"),
    // OpenID scopes granted at consent ('openid', 'email'); copied onto the
    // minted key for GET /oauth/userinfo.
    oidcScopes: text("oidc_scopes").array(),

    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("oauth_authorization_codes_code_hash_unique").on(t.codeHash),
    index("oauth_authorization_codes_expires_at_idx").on(t.expiresAt),
  ]
);

export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type NewOAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferInsert;
