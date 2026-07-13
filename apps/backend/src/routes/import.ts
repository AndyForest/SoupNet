/**
 * POST /import — corpus import, the inverse of GET /auth/me/export.
 * Brief: docs/planning/corpus-import.md. Core logic: services/import.service.ts.
 *
 * Usage (the body is the export file, unwrapped):
 *
 *   curl -X POST "$BACKEND/import" \
 *     -H "Authorization: Bearer $JWT" \
 *     -H "Content-Type: application/json" \
 *     --data-binary @soupnet-export-you-2026-07-12.json
 *
 * Query parameters (server-side options stay minimal — subsetting/filtering
 * an export is the client's job on the JSON before upload, design point 5):
 *   book=<slug|uuid>   import into an existing book you're a member of
 *                      (default: create a new book, lazily — only if the
 *                      import inserts anything)
 *   book_name=<text>   name for the created book (default "Imported <date>")
 *   overwrite=true     replace owned traces whose content differs
 *                      (default: existing rows win; conflicts are reported)
 *
 * Auth surface (design point 8): signed-in human — JWT + verified email,
 * same posture as recipe re-filing and deletion. API keys are rejected with
 * 403 before JWT verification (agents must not import).
 *
 * Size limit: request bodies over IMPORT_MAX_BYTES (default 64 MiB — ~3× the
 * largest real export today at ~20 MB / 40k traces) are rejected with 413.
 * The body is read with an incremental cap (an unfaithful Content-Length
 * can't oversize the buffer), then parsed in one JSON.parse — measured at
 * well under a second at the 20 MB scale, and bounded by the byte cap.
 * Failed imports roll back completely (single transaction); re-uploading the
 * same file is the resume path (idempotent upsert-on-id).
 */

import { Hono } from "hono";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import { parseExportPayload } from "../services/import-validate";
import { importCorpus, ImportError } from "../services/import.service";
import { auditLog } from "@soupnet/db";
import type { AppEnv } from "../types";

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export const importRoutes = new Hono<AppEnv>();

// Human-only control: an API key (cn_* Bearer) gets an explicit 403 with
// remediation, not a generic 401 from JWT verification (acceptance
// criterion 7 — same reasoning as recipe re-filing and deletion).
importRoutes.use("/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer cn_")) {
    return c.json(
      {
        ok: false,
        error:
          "Corpus import is a human-only control. Sign in on the dashboard and use your account (JWT) — API keys cannot import.",
      },
      403,
    );
  }
  return next();
});
importRoutes.use("/*", requireAuth, requireVerifiedEmail);

importRoutes.post("/", async (c) => {
  const user = c.get("user");
  const maxBytes = parsePositiveInt(process.env["IMPORT_MAX_BYTES"]) ?? DEFAULT_MAX_BYTES;

  // Fast reject on declared size; the streaming cap below is the real guard.
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return c.json(
      { ok: false, error: `Import file too large (${declared} bytes; limit ${maxBytes}). Split the export client-side and import in parts.` },
      413,
    );
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json({ ok: false, error: "Request body is required — POST the JSON file from GET /auth/me/export." }, 400);
  }

  // Bounded incremental read — never buffers more than maxBytes + one chunk.
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return c.json(
          { ok: false, error: `Import file too large (over ${maxBytes} bytes). Split the export client-side and import in parts.` },
          413,
        );
      }
      parts.push(value);
    }
  } catch {
    return c.json({ ok: false, error: "Failed to read request body." }, 400);
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    return c.json({ ok: false, error: "Body is not valid JSON — upload the export file exactly as downloaded from GET /auth/me/export." }, 400);
  }

  const parsed = parseExportPayload(json);
  if (!parsed.ok) {
    return c.json({ ok: false, error: parsed.error }, 400);
  }

  const db = getDb();
  try {
    const result = await importCorpus(db, parsed.data, {
      userId: user.id,
      targetBook: c.req.query("book") || undefined,
      newBookName: c.req.query("book_name") || undefined,
      overwrite: c.req.query("overwrite") === "true",
    });

    // Audit trail: one row per import with the summary + book mapping, so the
    // original-book structure the file carried stays reconstructable even if
    // the response is lost (design point 5's "preserved as metadata").
    try {
      await db.insert(auditLog).values({
        actorUserId: user.id,
        action: "corpus.imported",
        targetType: "group",
        targetId: result.book?.id ?? null,
        metadata: {
          schemaVersion: parsed.data.schemaVersion,
          counts: result.counts,
          conflictsTotal: result.conflictsTotal,
          overwrite: c.req.query("overwrite") === "true",
          originalBooks: result.originalBooks,
          embeddings: {
            evidenceQueued: result.embeddings.evidenceQueued,
            tracesPendingBackfill: result.embeddings.tracesPendingBackfill,
          },
        },
      });
    } catch (err) {
      // Non-blocking — the import committed; don't fail the response.
      console.error("[import] audit log write failed:", err);
    }

    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ImportError) {
      return c.json({ ok: false, error: err.message }, err.status);
    }
    console.error("[import] failed:", err);
    return c.json({ ok: false, error: "Import failed — no changes were applied (the transaction rolled back). Retry with the same file." }, 500);
  }
});

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
