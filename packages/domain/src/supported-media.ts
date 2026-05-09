/**
 * Supported media types for multimodal evidence attachments.
 *
 * Single source of truth — used by file-store (backend), check form (HTML),
 * MCP tool (file detection), and any future upload endpoints.
 *
 * Based on Gemini embedding-2-preview supported modalities.
 * See: docs/adr/0005-embedding-models.md
 */

export interface MediaTypeInfo {
  mimeType: string;
  extension: string;
  category: "image" | "video" | "audio" | "document";
}

export const SUPPORTED_MEDIA: MediaTypeInfo[] = [
  // Images
  { mimeType: "image/png", extension: ".png", category: "image" },
  { mimeType: "image/jpeg", extension: ".jpg", category: "image" },
  { mimeType: "image/webp", extension: ".webp", category: "image" },
  // Video (≤120s per Gemini limit)
  { mimeType: "video/mp4", extension: ".mp4", category: "video" },
  { mimeType: "video/quicktime", extension: ".mov", category: "video" },
  // Audio
  { mimeType: "audio/mpeg", extension: ".mp3", category: "audio" },
  { mimeType: "audio/wav", extension: ".wav", category: "audio" },
  { mimeType: "audio/flac", extension: ".flac", category: "audio" },
  { mimeType: "audio/ogg", extension: ".ogg", category: "audio" },
  // Documents (≤6 pages per Gemini limit)
  { mimeType: "application/pdf", extension: ".pdf", category: "document" },
];

/** Set of allowed MIME types for validation. */
export const ALLOWED_MIME_TYPES = new Set(SUPPORTED_MEDIA.map((m) => m.mimeType));

/** Map from MIME type to file extension. */
export const MIME_TO_EXT: Record<string, string> = Object.fromEntries(
  SUPPORTED_MEDIA.map((m) => [m.mimeType, m.extension]),
);

/** Map from file extension (without dot) to MIME type. */
export const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  SUPPORTED_MEDIA.map((m) => [m.extension.slice(1), m.mimeType]),
);

/** Comma-separated MIME types for HTML file input accept attribute. */
export const HTML_ACCEPT_TYPES = SUPPORTED_MEDIA.map((m) => m.mimeType).join(",");

/** Max upload size in bytes. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB (video needs more room)
