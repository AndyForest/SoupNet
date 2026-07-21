/**
 * ephemeral_books — the write-once birth record for a born-ephemeral recipe
 * book (the eval-reset destructive tier, security-audit-2026-07-21 F56).
 *
 * PRESENCE OF A ROW = the book is ephemeral. ABSENCE = the book is durable.
 * This is the tamper-evident anchor the whole destructive tier hangs off:
 *
 *   - The reaper's WHERE JOINs groups THROUGH this table, so it *structurally
 *     cannot* select a book that has no birth record — misclassifying a durable
 *     book as reapable would require forging an INSERT here (with a real
 *     group_id FK), not flipping a nullable flag on `groups`. Durable books have
 *     no write path to any expiry field anywhere.
 *   - The tombstone (search/briefing/counts invisibility + write refusal) reads
 *     `expires_at <= NOW()` from this table.
 *   - expire-now / extend gate on `created_by_key_id` matching the presenting
 *     key — only the creating key may shorten or extend its own workspace.
 *
 * No `max_expires_at` cap column: the operator waived a max TTL and
 * extension-specific limits deliberately, because this feature is only ever
 * enabled in controlled benchmark environments (ALLOW_BENCHMARK_OPS), never on
 * prod with third-party access. Extending is a plain metadata write.
 *
 * group_id ON DELETE CASCADE: a group deleted by any path (the reaper's own
 * teardown, or deleteUserCascade tearing down an owner's orgs) takes its birth
 * record with it, so no dangling ephemeral_books row can outlive its book.
 */

import { uuid, timestamp, index } from "drizzle-orm/pg-core";
import { claimnetSchema } from "./traces";
import { groups } from "./groups";

export const ephemeralBooks = claimnetSchema.table(
  "ephemeral_books",
  {
    // PK *and* FK to groups — one birth record per book, keyed by the book.
    groupId: uuid("group_id")
      .primaryKey()
      .references(() => groups.id, { onDelete: "cascade" }),

    // The api_keys.id that created this workspace. No FK (keys rotate/expire
    // and the birth record must outlive the creating key so the reaper can
    // still reap). expire-now/extend require the presenting key's id to equal
    // this value — capability self-binding, never a caller-supplied target.
    createdByKeyId: uuid("created_by_key_id").notNull(),

    // The creating key's owning user. Recorded for the audit trail and so the
    // book's org placement (the user's personal org) is attributable.
    createdByUserId: uuid("created_by_user_id").notNull(),

    // Declared expiry. The moment this passes, the book is tombstoned
    // (retrieval-invisible + write-refusing) even before the reaper physically
    // deletes it. Shortened by expire-now, moved either direction by set-expiry.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The reaper scans by expiry; the create live-cap counts by creator key.
    index("ephemeral_books_expires_at_idx").on(t.expiresAt),
    index("ephemeral_books_created_by_key_id_idx").on(t.createdByKeyId),
  ]
);

export type EphemeralBook = typeof ephemeralBooks.$inferSelect;
export type NewEphemeralBook = typeof ephemeralBooks.$inferInsert;
