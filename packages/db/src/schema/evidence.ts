/**
 * Evidence — supporting or refuting content linked to traces.
 */

import {
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const evidence = claimnetSchema.table(
  "evidence",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    content: text("content").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
