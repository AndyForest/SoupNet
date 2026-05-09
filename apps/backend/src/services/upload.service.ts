/**
 * Upload service — opaque file references for agent-attached evidence.
 *
 * Backs the POST /uploads endpoint and the own-hostname resolution path
 * inside check_recipe. See docs/planning/uploads-endpoint.md for the
 * full design.
 *
 * Security boundary: every upload is owned by an api_key_id. Resolution
 * verifies the *current* request's api_key_id matches the upload's; mismatch
 * is treated as a generic unreachable-URL error so we don't leak whether the
 * upload exists.
 *
 * Physical bytes are stored content-addressed via lib/file-store.ts; multiple
 * uploads sharing the same content_hash dedup to one file on disk while each
 * keeps its own row (and resolves only for its owning key).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, MIME_TO_EXT } from "@soupnet/domain";
import { storeFile, FileStoreError } from "../lib/file-store";

export class UploadResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadResolutionError";
  }
}

export interface CreatedUpload {
  id: string;
  fileUrl: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ResolvedUpload {
  id: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

interface ParsedOwnHostnameUpload {
  id: string;
}

/**
 * Pure helper: extract an upload UUID from a URL that targets our own host.
 * Returns null for any URL that isn't ours, isn't well-formed, or doesn't
 * match the /uploads/<uuid>(.<ext>)? path pattern.
 *
 * Strict: matches `parsed.hostname` case-insensitively against `ownHostname`.
 * No substring tricks (e.g. https://evil.com/mcp.soup.net/...). The path must
 * start with `/uploads/` followed by a UUID and an optional extension.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_PATH_RE = /^\/uploads\/([^/]+?)(?:\.[a-z0-9]+)?\/?$/i;

export function parseOwnHostnameUpload(
  url: string,
  ownHostname: string,
): ParsedOwnHostnameUpload | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname.toLowerCase() !== ownHostname.toLowerCase()) return null;

  const match = UPLOAD_PATH_RE.exec(parsed.pathname);
  if (!match) return null;
  const id = match[1] ?? "";
  if (!UUID_RE.test(id)) return null;
  return { id };
}

/**
 * Get the configured public hostname for own-URL detection. Reads BACKEND_URL
 * (set in dev .env and prod ECS task def). Falls back to "localhost" so tests
 * without env still work.
 */
export function getOwnHostname(): string {
  const url = process.env["BACKEND_URL"];
  if (!url) return "localhost";
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

/**
 * Build the public file_url that the agent should pass back to check_recipe.
 * Uses BACKEND_URL as the base so the URL the agent sees matches what they
 * would type in a browser. Ext comes from the MIME type so it's predictable.
 */
function buildFileUrl(uploadId: string, mimeType: string): string {
  const base = process.env["BACKEND_URL"] ?? "http://localhost:3001";
  const ext = MIME_TO_EXT[mimeType] ?? "";
  return `${base.replace(/\/$/, "")}/uploads/${uploadId}${ext}`;
}

/**
 * Persist a file uploaded by an agent. Validates MIME and size (defense in
 * depth — the route also checks), writes bytes via the content-addressed
 * file-store, inserts a uploads row keyed to the api_key_id, and returns
 * the public reference URL.
 */
export async function createUpload(
  db: PostgresJsDatabase,
  apiKeyId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename: string | null,
): Promise<CreatedUpload> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new FileStoreError(`Unsupported file type: ${mimeType}`);
  }
  if (buffer.length === 0) {
    throw new FileStoreError("Empty file");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new FileStoreError(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`,
    );
  }

  const stored = await storeFile(buffer, mimeType);

  const inserted = await db.execute(sql`
    INSERT INTO claimnet.uploads
      (api_key_id, content_hash, mime_type, size_bytes, original_filename)
    VALUES
      (${apiKeyId}::uuid, ${stored.contentHash}, ${mimeType}, ${buffer.length}, ${originalFilename})
    RETURNING id
  `);

  const row = (inserted as unknown as Array<{ id: string }>)[0];
  if (!row) throw new Error("Failed to insert upload row");

  return {
    id: row.id,
    fileUrl: buildFileUrl(row.id, mimeType),
    contentHash: stored.contentHash,
    mimeType,
    sizeBytes: buffer.length,
  };
}

/**
 * Resolve a file_url that targets our own host. Verifies the upload belongs
 * to the requesting api key, reads the bytes off disk, and returns them as
 * an attachment-shaped record.
 *
 * Throws UploadResolutionError on every failure mode (no upload, mismatched
 * key, missing file on disk) with a uniform message — this matches the
 * "treat as unreachable URL" error shape the design doc specifies, so we
 * don't leak whether the upload exists.
 */
export async function resolveUpload(
  db: PostgresJsDatabase,
  apiKeyId: string,
  fileUrl: string,
): Promise<ResolvedUpload> {
  const ownHostname = getOwnHostname();
  const parsed = parseOwnHostnameUpload(fileUrl, ownHostname);
  if (!parsed) {
    throw new UploadResolutionError(`Not a recognized upload URL: ${fileUrl}`);
  }

  const rows = await db.execute(sql`
    SELECT id, api_key_id, content_hash, mime_type, original_filename
    FROM claimnet.uploads
    WHERE id = ${parsed.id}::uuid
    LIMIT 1
  `);

  interface UploadRow {
    id: string;
    api_key_id: string;
    content_hash: string;
    mime_type: string;
    original_filename: string | null;
  }
  const row = (rows as unknown as UploadRow[])[0];
  if (!row) {
    throw new UploadResolutionError(`Upload not found: ${fileUrl}`);
  }
  if (row.api_key_id !== apiKeyId) {
    // Same error message as not-found — don't leak existence to the wrong key.
    throw new UploadResolutionError(`Upload not found: ${fileUrl}`);
  }

  const ext = MIME_TO_EXT[row.mime_type] ?? "";
  const filename = `${row.content_hash}${ext}`;
  // file-store writes to <cwd>/uploads/artifacts/<sha256>.<ext>
  const fullPath = resolve(process.cwd(), "uploads", "artifacts", filename);
  let buffer: Buffer;
  try {
    buffer = await readFile(fullPath);
  } catch {
    throw new UploadResolutionError(`Upload file missing on disk: ${fileUrl}`);
  }

  return {
    id: row.id,
    buffer,
    mimeType: row.mime_type,
    filename: row.original_filename ?? `${row.id}${ext}`,
  };
}
