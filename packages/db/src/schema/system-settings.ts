/**
 * System settings — global configuration managed by system admins.
 *
 * Key-value store for platform-wide settings like signup cap.
 * Only system-role users can read/write.
 */

import {
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const systemSettings = claimnetSchema.table(
  "system_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    key: text("key").notNull().unique(),
    value: text("value").notNull(), // JSON-encoded value

    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
