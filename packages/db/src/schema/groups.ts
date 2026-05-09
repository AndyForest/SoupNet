/**
 * Groups and group membership.
 *
 * Groups belong to an organization and contain members (users).
 * They are the primary access-control unit — traces and API keys
 * are scoped to groups.
 *
 * Group member roles:
 *   'owner'  — can delete the group, manage all members
 *   'admin'  — can invite/remove members, manage group settings
 *   'member' — can read/write traces within the group
 */

import {
  uuid,
  text,
  timestamp,
  index,
  unique,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { users } from "./users";
import { organizations } from "./organizations";

// ── groups ───────────────────────────────────────────────────────────────────

export const groups = claimnetSchema.table(
  "groups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    description: text("description"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("groups_org_slug_unique").on(t.organizationId, t.slug),
    index("groups_organization_id_idx").on(t.organizationId),
  ]
);

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;

// ── group_members ────────────────────────────────────────────────────────────

export const groupMembers = claimnetSchema.table(
  "group_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    groupId: uuid("group_id").notNull().references(() => groups.id),
    userId: uuid("user_id").notNull().references(() => users.id),

    role: text("role").notNull().default("member"), // 'owner' | 'admin' | 'member'

    // Per-user daily-link preferences (see design-thinking.md §Configurable
    // defaults for the "daily agent link" buttons). When the dashboard's
    // Copy-briefing / Open-recipe-check-page buttons mint a 24-hour key
    // without explicit read/write scope in the request, these flags decide
    // which of the user's groups are in the default read set and write set.
    // Default false satisfies "new groups default to excluded" — an invitee
    // who accepts lands opted-out of both until they explicitly opt in.
    // The 0016-groups migration (2026-04-19) grandfathers existing rows to
    // true/true so current users' behavior doesn't silently narrow.
    dailyRead: boolean("daily_read").notNull().default(false),
    dailyWrite: boolean("daily_write").notNull().default(false),

    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("group_members_group_user_unique").on(t.groupId, t.userId),
    index("group_members_group_id_idx").on(t.groupId),
    index("group_members_user_id_idx").on(t.userId),
  ]
);

export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
