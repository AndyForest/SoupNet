/**
 * REST upload endpoint for multimodal recipe evidence.
 *
 * POST /uploads — multipart/form-data, Bearer-token auth (Soup.net api key).
 *   Returns { file_url } — an opaque reference URL for use as `file_url`
 *   on a subsequent check_recipe call. The URL targets our own host but is
 *   not publicly servable; GET against it always 404s.
 *
 * GET /uploads/:filename — always 404. The URL is a reference token, not
 *   a file. Matches Gemini File API semantics.
 *
 * See docs/planning/uploads-endpoint.md for the full design.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import { getDb } from "../db";
import { validateKey } from "../services/api-key.service";
import { createUpload } from "../services/upload.service";
import { FileStoreError } from "../lib/file-store";
import { ALLOWED_MIME_TYPES, EXT_TO_MIME, MAX_UPLOAD_BYTES } from "@soupnet/domain";
import { getClientIp, hashApiKey, rateLimit } from "../middleware/rate-limit";

const uploadsRouter = new Hono();

// ── Per-API-key rate limit ─────────────────────────────────────────────────
// 100 uploads per hour per key. A compromised key still has a budget but it
// can't run the disk dry. Keys are extracted from the Authorization header;
// requests without a Bearer token fall back to the IP, so anonymous flood
// attempts are still bounded.
const uploadRateLimit = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  // F36: anonymous fallback uses the trusted-hop client IP, not the raw
  // (spoofable) X-Forwarded-For header. F43: bucket by credential HASH so
  // raw API keys don't sit in memory as map keys. (Durable audit-log-backed
  // counting for uploads is a backlog item — see the infra repo.)
  keyFn: (c) => {
    const token = extractBearerToken(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

function extractBearerToken(c: Context): string | null {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? (match[1] ?? null) : null;
}

// F41 (security-audit-2026-06-11): reject oversized bodies at the framework
// layer BEFORE parseBody() buffers the whole multipart payload into memory —
// same rationale and size as the F28 fix on /check (21 MiB = MAX_UPLOAD_BYTES
// + multipart envelope slack). The fileField.size check below stays as the
// precise per-file limit; this is the memory-pressure guard.
const UPLOAD_BODY_LIMIT_BYTES = 21 * 1024 * 1024;
const uploadBodyLimit = bodyLimit({
  maxSize: UPLOAD_BODY_LIMIT_BYTES,
  onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
});

// ── POST /uploads ───────────────────────────────────────────────────────────

uploadsRouter.post("/", uploadBodyLimit, uploadRateLimit, async (c) => {
  const apiKey = extractBearerToken(c);
  if (!apiKey) {
    return c.json({ ok: false, error: "Missing or malformed Authorization header. Expected 'Bearer <api-key>'." }, 401);
  }

  const db = getDb();
  const keyResult = await validateKey(db, apiKey);
  if (!keyResult) {
    return c.json({ ok: false, error: "Invalid or expired API key." }, 401);
  }

  // Parse multipart body. Hono's parseBody handles multipart/form-data and
  // returns File for binary fields.
  let formData: Record<string, unknown>;
  try {
    formData = await c.req.parseBody();
  } catch (err) {
    // F47: parse errors bubble up from the framework with internal detail —
    // log the raw error, return a generic body.
    console.error("[uploads] Could not parse multipart body:", err);
    return c.json({ ok: false, error: "Could not parse multipart body." }, 400);
  }

  const fileField = formData["file"];
  if (!(fileField instanceof File)) {
    return c.json({ ok: false, error: "No 'file' field in multipart body." }, 400);
  }
  if (fileField.size === 0) {
    return c.json({ ok: false, error: "Empty file." }, 400);
  }
  if (fileField.size > MAX_UPLOAD_BYTES) {
    return c.json(
      {
        ok: false,
        error: `File too large: ${(fileField.size / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`,
      },
      413,
    );
  }

  // Resolve MIME: trust the form field's type if it's in our allowlist; else
  // fall back to the filename extension. This mirrors the existing imageFromUrl
  // / imageFromBase64 logic in routes/mcp.ts.
  let mimeType = fileField.type || "";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const ext = (fileField.name?.split(".").pop() ?? "").toLowerCase();
    const extMime = EXT_TO_MIME[ext];
    if (extMime) mimeType = extMime;
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return c.json(
      {
        ok: false,
        error: `Unsupported MIME type (got '${fileField.type || "none"}'). Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
      },
      415,
    );
  }

  const buffer = Buffer.from(await fileField.arrayBuffer());

  try {
    const created = await createUpload(db, keyResult.keyId, buffer, mimeType, fileField.name || null);
    return c.json({
      ok: true,
      file_url: created.fileUrl,
      content_hash: created.contentHash,
      mime_type: created.mimeType,
      size_bytes: created.sizeBytes,
    });
  } catch (err) {
    if (err instanceof FileStoreError) {
      // FileStoreError covers oversize / unsupported MIME / empty — already
      // checked above, but defense in depth means we surface the message.
      return c.json({ ok: false, error: err.message }, 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[uploads] Failed to create upload: ${message}`);
    return c.json({ ok: false, error: "Failed to store upload." }, 500);
  }
});

// ── GET /uploads/:filename ──────────────────────────────────────────────────
// Always 404. The URL is a reference token, not a file. Even the uploading
// key can't fetch it back — they have the bytes already, this is for
// check_recipe resolution only.
uploadsRouter.get("/:filename", (c) => {
  return c.json({ ok: false, error: "Not found." }, 404);
});

export { uploadsRouter as uploadsRoutes };
