/**
 * Email log — one row per outgoing email, success or failure.
 *
 * Principle (2026-06-11, engineering-principles.md): ALL outgoing email goes
 * through the logged sender in apps/backend/src/services/email.service.ts.
 * The log is the light CRM + security/abuse audit surface: who we emailed,
 * what kind, when, and whether the send succeeded.
 *
 * Deliberately logs METADATA ONLY — never the message body. Bodies carry
 * secrets (verification links, password-reset tokens, invite tokens); a
 * leaked email log must not be a token archive.
 *
 * Retention: 60 days. Purged opportunistically by the logged sender on each
 * send (no scheduler needed; the created_at index keeps the delete cheap).
 * Disclosed in the privacy policy §8.
 */

import {
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const emailLog = claimnetSchema.table(
  "email_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    toEmail: text("to_email").notNull(),
    // 'verification' | 'password_reset' | 'invitation' | 'waitlist_approved' | ...
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),

    // 'sent' | 'failed'
    status: text("status").notNull(),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("email_log_created_at_idx").on(t.createdAt),
    index("email_log_to_email_idx").on(t.toEmail),
  ],
);

export type EmailLogEntry = typeof emailLog.$inferSelect;
export type NewEmailLogEntry = typeof emailLog.$inferInsert;
