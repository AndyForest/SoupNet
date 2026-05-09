/**
 * References — cited sources backing traces and evidence.
 *
 * source is a markdown-formatted citation string.
 */

import {
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const references = claimnetSchema.table(
  "references",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    quote: text("quote").notNull(),
    source: text("source").notNull(), // markdown citation format

    // Multimodal file attachment (nullable — text-only references have no file)
    // Supports all Gemini embedding modalities: images, video, audio, PDF
    fileUrl: text("file_url"),
    fileMimeType: text("file_mime_type"),
    fileHash: varchar("file_hash", { length: 64 }), // SHA-256 for vector cache + dedup

    // Original filename as the agent provided it. Surfaced to recipe viewers
    // alongside fileHash + regionMeta so they can verify the recipe against
    // their own copy of the source artifact — we don't serve the file itself
    // (uploads are opaque references, see /uploads endpoint), so the filename
    // + hash + ROI is the audit trail.
    originalFilename: text("original_filename"),

    // Region of interest metadata for the attached file. JSONB to extend
    // across media types without schema migration:
    //   { image_box: {x0, y0, x1, y1} }                  // normalized 0-1, top-left origin
    //   { time_range: {start_seconds, end_seconds} }     // future: video/audio
    //   { page_range: {first_page, last_page} }          // future: PDF (1-indexed)
    // See ADR-0019 for the visual-cue pipeline applied at embed time.
    regionMeta: jsonb("region_meta"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export type Reference = typeof references.$inferSelect;
export type NewReference = typeof references.$inferInsert;
