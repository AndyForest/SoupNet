/**
 * Artifact type allowlist.
 *
 * Only explicitly permitted MIME types are accepted. No binary blobs.
 * Every type here must have a corresponding sanitization strategy.
 *
 * Design decisions:
 * - No arbitrary binaries — reduces moderation surface and embedding complexity
 * - Each allowed type maps to a known sanitization path
 * - Images are allowed for diagram/screenshot artifacts; sanitized via re-encoding
 * - Code files are stored as text regardless of extension
 *
 * See: docs/adr/0006-artifact-allowlist.md
 */
import { z } from "zod";

/** Permitted MIME types for artifact payloads */
export const ALLOWED_MIME_TYPES = [
  // Plain text
  "text/plain",
  "text/markdown",

  // Structured data
  "application/json",
  "application/yaml",
  "text/csv",

  // Code (all stored/transmitted as text)
  "text/x-python",
  "text/x-javascript",
  "text/x-typescript",
  "text/x-rust",
  "text/x-go",
  "text/x-java",
  "text/x-c",
  "text/x-cpp",
  "text/x-ruby",
  "text/x-php",
  "text/x-shell",
  "text/x-lua",
  "text/html",
  "text/css",
  "text/xml",
  "application/xml",
  "application/toml",
  "application/x-ndjson",

  // Diffs and patches (text)
  "text/x-diff",
  "text/x-patch",

  // Images (sanitized via re-encoding)
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;

export const AllowedMimeTypeSchema = z.enum(ALLOWED_MIME_TYPES);
export type AllowedMimeType = z.infer<typeof AllowedMimeTypeSchema>;

/** High-level artifact category — used for embedding model routing */
export const ArtifactCategorySchema = z.enum([
  "text",      // plain text, markdown, notes → Gemini embedding-001
  "code",      // source code, diffs, patches → Gemini embedding-001 (code variant)
  "data",      // JSON, YAML, CSV, XML → Gemini embedding-001
  "image",     // images → Cohere Embed v4 (multimodal)
]);
export type ArtifactCategory = z.infer<typeof ArtifactCategorySchema>;

/** Maps MIME type to artifact category for embedding routing */
export const MIME_TO_CATEGORY: Record<typeof ALLOWED_MIME_TYPES[number], ArtifactCategory> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "data",
  "text/html": "code",
  "text/css": "code",
  "text/xml": "data",
  "text/x-python": "code",
  "text/x-javascript": "code",
  "text/x-typescript": "code",
  "text/x-rust": "code",
  "text/x-go": "code",
  "text/x-java": "code",
  "text/x-c": "code",
  "text/x-cpp": "code",
  "text/x-ruby": "code",
  "text/x-php": "code",
  "text/x-shell": "code",
  "text/x-lua": "code",
  "text/x-diff": "code",
  "text/x-patch": "code",
  "application/json": "data",
  "application/yaml": "data",
  "application/xml": "data",
  "application/toml": "data",
  "application/x-ndjson": "data",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",
};

/** Max allowed payload size per MIME category */
export const MAX_PAYLOAD_BYTES: Record<ArtifactCategory, number> = {
  text: 500_000,    // 500 KB
  code: 1_000_000,  // 1 MB
  data: 2_000_000,  // 2 MB
  image: 5_000_000, // 5 MB
};

/** Artifact upload request — sent by client node to initiate upload */
export const ArtifactUploadRequestSchema = z.object({
  claimId: z.string().uuid(),
  mimeType: AllowedMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ArtifactUploadRequest = z.infer<typeof ArtifactUploadRequestSchema>;
