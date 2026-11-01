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

    // Site suspension by the site operator. When set, sign-in and every
    // credential are refused through the account-state predicate
    // (apps/backend/src/authz/account-state.ts), reversibly. Separate from an
    // org admin's disable (organization_members.disabled_at), so an org admin
    // can't lift it.
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),

    // Sessions (JWTs) issued before this moment are refused by the per-request
    // session lookup (apps/backend/src/authz/session-state.ts). Set when an
    // account's sign-in credentials change hands, e.g. account linking
    // discarding an unverified password (recipe a8003678). Null: no cut-off.
    sessionsValidAfter: timestamp("sessions_valid_after", { withTimezone: true }),

    // Waitlist — when set, the account exists (password + ToS captured at
    // registration, email verifiable) but sign-in is blocked with a
    // "you're on the waitlist" message and no JWT is issued. Mirrors the
    // suspended_at pattern. Cleared by admin approval or by top-of-queue
    // auto-promotion when the signup cap rises. Waitlisted users do NOT
    // count toward the signup cap.
    waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),

    // Optional free-text answer to "What would you use Soup.net for?" on the
    // register form — collected for every signup, waitlisted or not.
    signupReason: text("signup_reason"),

    // Premium — gates server-side LLM features (e.g. retrieval synthesis).
    // Admin-assigned only; no self-serve, no billing. Premium ⇔ this IS NOT
    // NULL. Mirrors the suspended_at/waitlisted_at nullable-timestamp pattern.
    // See docs/planning/premium-llm-features.md.
    premiumAt: timestamp("premium_at", { withTimezone: true }),

    // The user's personal owned organization — the one created first at
    // registration/auto-setup (is_personal = true). Pinned as an authoritative
    // pointer (rather than re-deriving from organizations.is_personal each time)
    // so agent-created ephemeral workspaces have one unambiguous org to attach
    // to even for a user who owns several orgs (security-audit-2026-07-21,
    // operator answer to open question 3). Nullable + no cascade: it's a soft
    // reference set after the org exists; backfilled for existing users to
    // their oldest owned org. No FK to organizations to avoid a hard circular
    // constraint with organizations.owner_id → users.id at insert time.
    personalOrganizationId: uuid("personal_organization_id"),

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
