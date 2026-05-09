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
  timestamp,
  index,
  unique,
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
