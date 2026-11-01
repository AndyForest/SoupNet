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
    // A personal organization's account; a company organization's accountable
    // owner, always a current owner (it moves on demotion and on deletion).
    ownerId: uuid("owner_id").notNull().references(() => users.id),

    isPersonal: boolean("is_personal").notNull().default(false),

    // Company organizations only: how many active (not disabled) members the
    // organization may hold. Null means no limit. Set by the site operator,
    // never by an org admin (program §3.1; recipe 61adb152).
    seatLimit: integer("seat_limit"),

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
  },
  (t) => [
    unique("organization_members_user_unique").on(t.userId),
    index("organization_members_organization_id_idx").on(t.organizationId),
    check("organization_members_role_check", sql`${t.role} IN ('owner', 'admin', 'member')`),
    check("organization_members_joined_via_check", sql`${t.joinedVia} IN ('created', 'operator', 'domain', 'migrated')`),
  ]
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
