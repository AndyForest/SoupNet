/**
 * Waitlist — emails collected when the signup cap is full.
 *
 * Rows are created by the public POST /auth/waitlist endpoint (rate-limited;
 * the response is identical for new and already-listed emails so the endpoint
 * can't be used to probe membership). invited_at is stamped when a system
 * admin sends a cap-bypass invitation to the entry's email via POST
 * /admin/invite. Entries are never auto-deleted — a registered user's row
 * stays as a record of the conversion.
 */

import {
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const waitlist = claimnetSchema.table(
  "waitlist",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    email: text("email").notNull(),
    // Free-text answer to "What would you use Soup.net for?" — optional.
    reason: text("reason"),

    // Set when a system admin sends this entry a cap-bypass invitation.
    invitedAt: timestamp("invited_at", { withTimezone: true }),

    // Set when a "spot opened" notification email was sent to this entry.
    // Waitlist signups consented to exactly this email ("we'll notify you"),
    // so it doesn't cross the no-emails-to-non-users policy (ADR-0016).
    notifiedAt: timestamp("notified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("waitlist_email_unique").on(t.email)]
);

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
