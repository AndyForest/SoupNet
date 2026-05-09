/**
 * Content-addressed file storage for uploaded artifacts (images, etc.).
 *
 * Files are saved as `uploads/artifacts/{sha256}.{ext}` and served
 * at `/uploads/artifacts/...`. Content-addressing means duplicate files
 * are automatically deduplicated (same bytes = same hash = same file).
 *
 * This module is the single place to swap for S3 later.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { ALLOWED_MIME_TYPES, MIME_TO_EXT, MAX_UPLOAD_BYTES } from "@soupnet/domain";

const UPLOADS_DIR = resolve(process.cwd(), "uploads", "artifacts");

export interface FileStoreResult {
  /** Relative path from uploads root (e.g., "artifacts/abc123.png") */
  filePath: string;
  /** SHA-256 hex of the file bytes */
  contentHash: string;
  /** URL path to serve the file (e.g., "/uploads/artifacts/abc123.png") */
  publicUrl: string;
}

export class FileStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileStoreError";
  }
}

/**
 * Store a file buffer. Returns the public URL and content hash.
 * Deduplicates automatically via content-addressed naming.
 */
export async function storeFile(
  buffer: Buffer,
  mimeType: string,
): Promise<FileStoreResult> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new FileStoreError(
      `Unsupported file type: ${mimeType}. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
    );
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new FileStoreError(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`,
    );
  }

  if (buffer.length === 0) {
    throw new FileStoreError("Empty file");
  }

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const ext = MIME_TO_EXT[mimeType] ?? extname(mimeType);
  const filename = `${contentHash}${ext}`;
  const filePath = `artifacts/${filename}`;
  const fullPath = resolve(UPLOADS_DIR, filename);
  const publicUrl = `/uploads/${filePath}`;

  // Skip write if file already exists (content-addressed dedup)
  try {
    await access(fullPath);
    return { filePath, contentHash, publicUrl };
  } catch {
    // File doesn't exist, write it
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(fullPath, buffer);

  return { filePath, contentHash, publicUrl };
}
