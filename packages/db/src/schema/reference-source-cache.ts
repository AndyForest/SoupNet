/**
 * Reference source cache — cached fetched content for reference URLs.
 *
 * When a reference cites a URL, the worker fetches and caches the content
 * for embedding and display. Multiple fetch strategies are supported.
 */

import {
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { references } from "./references";

export const referenceSourceCache = claimnetSchema.table(
  "reference_source_cache",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    referenceId: uuid("reference_id").notNull().references(() => references.id),

    url: text("url").notNull(),
    contentType: text("content_type").notNull(),
    cachedContent: text("cached_content"),
    s3Key: text("s3_key"),

    fetchStrategy: text("fetch_strategy").notNull(),
    // e.g. 'cloudflare_markdown' | 'html_sanitized' | 'direct_download'

    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export type ReferenceSourceCache = typeof referenceSourceCache.$inferSelect;
export type NewReferenceSourceCache = typeof referenceSourceCache.$inferInsert;
