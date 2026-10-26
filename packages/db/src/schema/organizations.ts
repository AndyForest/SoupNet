/**
 * Organizations — multi-tenant container for groups and resources.
 *
 * Each user gets a personal organization (isPersonal=true) on signup.
 * Additional organizations can be created for teams/companies.
 * The owner is the user who created the organization.
 */

import {
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { users } from "./users";

export const organizations = claimnetSchema.table(
  "organizations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerId: uuid("owner_id").notNull().references(() => users.id),

    isPersonal: boolean("is_personal").notNull().default(false),

    // Company organizations only: how many active (not disabled) members the
    // organization may hold. Null means no limit. Set by the site operator,
    // never by an org admin (program §3.1; recipe 61adb152).
    seatLimit: integer("seat_limit"),

    // Company organizations only: members must sign in with their Google
    // Workspace account. Password sign-in and reset are refused for active
    // members, and a session not issued by a Workspace Google sign-in is
    // refused per request (apps/backend/src/authz/sso-policy.ts). Set by an
    // owner or admin from a Google session of their own, or by the site
    // operator. No break-glass (program, settled simplifications).
    requireSso: boolean("require_sso").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("organizations_slug_unique").on(t.slug),
    index("organizations_owner_id_idx").on(t.ownerId),
  ]
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

// ── organization_members ─────────────────────────────────────────────────────

/**
 * Membership of a COMPANY organization (is_personal = false). Personal
 * organizations keep owner_id as their only notion of membership and have no
 * rows here.
 *
 * Holding a row is what makes an account managed: the account belongs wholly
 * to that company (program §0, recipe 2301b5eb), so an account holds at most
 * one row (the unique index on user_id). There is no separate managed flag
 * on users to drift from it (recipe 42044de1).
 *
 * disabled_at is the org admin's reversible switch. It is read by the
 * account-state predicate every credential passes through
 * (apps/backend/src/authz/account-state.ts), never by sweeping keys (recipe
 * 92b866ee), and it is separate from the site operator's users.suspended_at so
 * an org admin can't lift a site suspension.
 *
 * Every statement on this table lives in apps/backend/src/authz/; the seam
 * guard (scripts/check-authz-seam.mjs) fails the build on any other reader.
 */
export const organizationMembers = claimnetSchema.table(
  "organization_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),

    role: text("role").notNull().default("member"), // 'owner' | 'admin' | 'member'
    // How the person arrived: 'created' (named owner when the organization was
    // made), 'operator' (added by the site operator), 'domain' (a new account
    // on a verified domain), 'migrated' (an existing account on a claimed
    // domain).
    joinedVia: text("joined_via").notNull(),

    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    // Who disabled them. No foreign key, like audit_log.actor_user_id: the
    // record outlives the actor's account.
    disabledBy: uuid("disabled_by"),

    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),

    // The company's Google Workspace directory's word on this member (stream
    // Offboarding), read with disabled_at by the account-state check
    // (authz/account-state.ts): null (never checked), 'active', 'suspended',
    // 'archived', or 'deleted' (the directory doesn't know them).
    directoryStatus: text("directory_status"),
    // The last successful check; a checked member with none for a day is
    // switched off until one succeeds.
    directoryCheckedAt: timestamp("directory_checked_at", { withTimezone: true }),
    // A task's claim on the next check (one Google call per person at a time);
    // a claim older than 30 seconds may be taken over.
    directoryCheckClaimedAt: timestamp("directory_check_claimed_at", { withTimezone: true }),
  },
  (t) => [
    unique("organization_members_user_unique").on(t.userId),
    check("organization_members_directory_status_check", sql`${t.directoryStatus} IS NULL OR ${t.directoryStatus} IN ('active', 'suspended', 'archived', 'deleted')`),
    index("organization_members_organization_id_idx").on(t.organizationId),
    check("organization_members_role_check", sql`${t.role} IN ('owner', 'admin', 'member')`),
    check("organization_members_joined_via_check", sql`${t.joinedVia} IN ('created', 'operator', 'domain', 'migrated')`),
  ]
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

// ── organization_directory_connections ──────────────────────────────────────

/**
 * A company organization's connection to its Google Workspace directory, for
 * offboarding (stream Offboarding; rubric docs/planning/org-accounts-build/
 * offboarding.md). One per organization, on one of its claimed domains.
 *
 * kind 'admin_consent': an org owner or admin who is a Workspace admin
 * consented once to read-only directory access; the credential is their
 * refresh token. kind 'service_account': the customer's own service account
 * with domain-wide delegation for that one scope; the credential is its JSON
 * key, and admin_email is the admin it acts as.
 *
 * The credential is sealed by apps/backend/src/lib/secret-box.ts (AES-256-GCM,
 * the organization id as additional data, key_version for rotation) and never
 * logged or returned. Every statement on this table lives in
 * apps/backend/src/authz/directory-check.ts.
 */
export const organizationDirectoryConnections = claimnetSchema.table(
  "organization_directory_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

    kind: text("kind").notNull(), // 'admin_consent' | 'service_account'
    // The claimed domain, lowercase ASCII as a claim is stored, and its
    // Unicode form, so members on an internationalized domain match in SQL.
    domain: text("domain").notNull(),
    domainUnicode: text("domain_unicode").notNull(),
    // The consenting admin, or the admin a service account acts as.
    adminEmail: text("admin_email").notNull(),
    // A service account's client_email, shown as the connection's identity.
    serviceAccountEmail: text("service_account_email"),

    credentialCiphertext: text("credential_ciphertext").notNull(),
    credentialIv: text("credential_iv").notNull(),
    credentialTag: text("credential_tag").notNull(),
    keyVersion: integer("key_version").notNull(),

    // No foreign key, like audit_log.actor_user_id.
    connectedBy: uuid("connected_by"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    // Google's refusal of our credential, or a renamed member, for the admin.
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    // When the six-hour warning went out for the current outage; cleared by a success.
    warnedAt: timestamp("warned_at", { withTimezone: true }),
  },
  (t) => [
    unique("organization_directory_connections_org_unique").on(t.organizationId),
    check("organization_directory_connections_kind_check", sql`${t.kind} IN ('admin_consent', 'service_account')`),
  ]
);

export type OrganizationDirectoryConnection = typeof organizationDirectoryConnections.$inferSelect;
