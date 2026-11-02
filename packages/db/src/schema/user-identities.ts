/**
 * Sign in with Google (organization accounts round 1, stream SSO; rubric
 * docs/planning/org-accounts-build/sso.md, SSO-S1 and SSO-S2).
 *
 * user_identities — a Google account linked to a Soup.net account, keyed on
 * the issuer and Google's `sub`, never on email: Google and OpenID Connect
 * both say `sub` is the only stable identifier, and a buyer of a lapsed
 * domain inherits the email and `hd` but gets a new `sub`. The email, its
 * verified flag and `hd` are what the last sign-in asserted, kept for the
 * account page, the directory check (Offboarding) and auto-join (Domains),
 * and never used to find an existing identity.
 *
 * sso_login_requests — one in-flight Google sign-in. Keyed by the SHA-256 of
 * the opaque `state` put on the wire; holds the nonce and PKCE verifier for
 * the Google leg, the SHA-256 of the secret the starting browser tab holds,
 * and where to return (validated parameters, never a URL). The callback
 * consumes it once and mints a single-use handoff code, also stored hashed,
 * which the SPA exchanges for a session together with its secret.
 */

import { uuid, text, boolean, timestamp, jsonb, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { users } from "./users";

export const userIdentities = claimnetSchema.table(
  "user_identities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(), // 'google'
    // The validated `iss`, normalized to https://accounts.google.com.
    issuer: text("issuer").notNull(),
    // Google's `sub`: at most 255 case-sensitive ASCII characters, compared
    // byte for byte.
    subject: text("subject").notNull(),

    // As asserted at the last sign-in; never a lookup key.
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull(),
    // The `hd` claim; null means a consumer Google account.
    hostedDomain: text("hosted_domain"),

    // 'signup' (the sign-in created the account) or 'email_match' (it linked
    // an existing account holding the address).
    linkedVia: text("linked_via").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
    // When a Google sign-in through this identity last completed: the
    // freshness test for confirming a password-less account's deletion.
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("user_identities_issuer_subject_unique").on(t.issuer, t.subject),
    unique("user_identities_user_provider_unique").on(t.userId, t.provider),
    check("user_identities_provider_check", sql`${t.provider} IN ('google')`),
    check("user_identities_linked_via_check", sql`${t.linkedVia} IN ('signup', 'email_match')`),
  ]
);

export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;

export const ssoLoginRequests = claimnetSchema.table(
  "sso_login_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    stateHash: text("state_hash").notNull(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    // SHA-256 (base64url) of the secret the starting tab keeps in sessionStorage.
    bindingHash: text("binding_hash").notNull(),

    // 'app' (an in-app path) or 'oauth_authorize' (the consent page's
    // validated parameters).
    returnKind: text("return_kind").notNull(),
    returnParams: jsonb("return_params").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),

    // Set when the callback signs someone in. Cascade, so deleting an
    // account never fails on a request row.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    // The session's idp claim, decided at the callback.
    sessionIdp: text("session_idp"),
    handoffHash: text("handoff_hash"),
    handoffExpiresAt: timestamp("handoff_expires_at", { withTimezone: true }),
    handoffConsumedAt: timestamp("handoff_consumed_at", { withTimezone: true }),
  },
  (t) => [
    unique("sso_login_requests_state_hash_unique").on(t.stateHash),
    unique("sso_login_requests_handoff_hash_unique").on(t.handoffHash),
    index("sso_login_requests_created_at_idx").on(t.createdAt),
    check("sso_login_requests_return_kind_check", sql`${t.returnKind} IN ('app', 'oauth_authorize')`),
  ]
);

export type SsoLoginRequest = typeof ssoLoginRequests.$inferSelect;
export type NewSsoLoginRequest = typeof ssoLoginRequests.$inferInsert;
