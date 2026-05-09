/**
 * Uploads — opaque file references for agent-attached evidence.
 *
 * Agents POST /uploads with a multipart file and receive back an opaque
 * file URL of the form `https://mcp.soup.net/uploads/<id>.<ext>`. They then
 * pass that URL to `check_recipe` as the `file_url` parameter. The MCP
 * handler detects own-hostname URLs and resolves them through this table
 * instead of HTTP-fetching them.
 *
 * Security boundary: the api key IS the user identity for AI agents, so
 * uploads are owned by api_key_id (not user_id). When the key expires or
 * is revoked, every upload referenced through that key becomes unreachable
 * — by design.
 *
 * Physical bytes are stored content-addressed via apps/backend/src/lib/file-store.ts
 * keyed by content_hash, so two different keys uploading the same bytes share
 * one disk file but get separate uploads rows (and each only resolves its own).
 *
 * Retention: no TTL column today; authorization is gated by the api key's
 * expires_at. Future: add an explicit retention policy if disk usage grows
 * unbounded — sweep `uploads` rows whose `api_key_id` is expired and whose
 * `content_hash` is not referenced from any `references` row, then unlink
 * the underlying file.
 */

import {
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const uploads = claimnetSchema.table(
  "uploads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    apiKeyId: uuid("api_key_id").notNull(), // FK -> api_keys.id (security boundary)

    contentHash: text("content_hash").notNull(), // sha256 hex; matches file-store
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalFilename: text("original_filename"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("uploads_api_key_id_idx").on(t.apiKeyId),
    index("uploads_content_hash_idx").on(t.contentHash),
  ],
);

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
