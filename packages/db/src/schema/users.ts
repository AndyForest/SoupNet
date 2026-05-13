/**
 * Users — identity table for all ClaimNet users.
 *
 * Supports local JWT auth and future OIDC providers (Zitadel, etc).
 * System-level role determines platform-wide access:
 *   'system' — root/admin with full platform access
 *   'tenant' — normal user scoped to their organizations
 */

import {
  uuid,
  text,
  timestamp,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const users = claimnetSchema.table(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),

    // Auth provider — 'local' for our JWT auth, 'oidc' for future Zitadel/etc
    provider: text("provider").notNull().default("local"),
    // External ID from OIDC provider — null for local auth
    externalId: text("external_id"),

    // System-level role: 'system' = root/admin, 'tenant' = normal user
    role: text("role").notNull().default("tenant"),

    // Email verification — null means unverified
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    // Verification token (cleared after verification)
    emailVerificationToken: text("email_verification_token"),
    // When the verification token was generated (for 24h expiry)
    emailVerificationTokenCreatedAt: timestamp("email_verification_token_created_at", { withTimezone: true }),

    // Password reset — token is stored as SHA-256 hex hash, not plaintext.
    // Mirrors the api_keys hashing pattern so a leaked DB cannot be replayed
    // into account takeover. Cleared on successful reset (single-use).
    passwordResetTokenHash: text("password_reset_token_hash"),
    passwordResetTokenCreatedAt: timestamp("password_reset_token_created_at", { withTimezone: true }),

    // Terms of Service / Privacy Policy acceptance — timestamp set on register.
    // Required field on the register form. The /terms and /privacy pages are
    // currently placeholder content pending real legal review (see backlog
    // "Legal and compliance" section).
    tosAcceptedAt: timestamp("tos_accepted_at", { withTimezone: true }),

    // Last successful login — populated by /auth/login on success. Null = never logged in.
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    // Admin suspension — when set, user cannot log in and existing API keys return 403.
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),

    // User-level preferences (briefing cluster count, etc). Sparse JSONB —
    // stored object may contain only the keys the user has overridden; the
    // domain layer merges with defaults before use. Shape is validated by
    // the Zod schema in @soupnet/domain/user-preferences. Single JSONB column
    // (vs separate table) keeps it transactional with the user row; split
    // later if a per-key or per-recipe-book preference shows up.
    preferences: jsonb("preferences").notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("users_email_unique").on(t.email),
    index("users_provider_external_id_idx").on(t.provider, t.externalId),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
