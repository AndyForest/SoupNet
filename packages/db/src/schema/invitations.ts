/**
 * Invitations — signup links scoped to a group.
 *
 * When a user tries to add a member whose email isn't in the system,
 * an invitation is created. The invitee registers through the link
 * and is automatically added to the group.
 *
 * Invitations reserve a slot against the global signup cap.
 * System admin invitations bypass the cap check.
 */

import {
  uuid,
  text,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { users } from "./users";
import { groups } from "./groups";

export const invitations = claimnetSchema.table(
  "invitations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    // F18 (security-audit-2026-04-09): both FKs cascade on delete so
    // orphaned invitations cannot survive a user/group teardown.
    inviterId: uuid("inviter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    token: text("token").notNull(), // URL-safe random token

    // System admin invitations bypass the signup cap
    bypassCap: boolean("bypass_cap").notNull().default(false),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("invitations_token_unique").on(t.token),
    index("invitations_email_idx").on(t.email),
    index("invitations_group_id_idx").on(t.groupId),
  ]
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
