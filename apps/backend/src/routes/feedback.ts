/**
 * POST /feedback — REST surface for standalone feedback rows (the same
 * service the log_feedback MCP tool and the check_recipe feedback ride-along
 * use — one validation/ACL path, three thin surfaces).
 *
 * Auth: API-key Bearer (agent credential population, same as /mcp and
 * /uploads). Body: either a single feedback row object or
 * { "feedback": [row, ...] }. Response: per-row markers — a bad row never
 * blocks the rest of the batch.
 *
 * Rate limiting: per-IP limiter here (defense in depth); the per-key
 * feedback budget lives in the service (counted on check_feedback's own
 * index — NOT audit_log, which is F29's hot path). A fully-over-budget
 * batch returns 429.
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../db";
import { validateKey } from "../services/api-key.service";
import { rateLimit } from "../middleware/rate-limit";
import type { RawFeedbackRow } from "../services/feedback.service";
import { ingestFeedback } from "../services/feedback.service";

const feedbackRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

// Feedback rows are text-only; 256 KiB is generous for a batch.
const FEEDBACK_BODY_LIMIT_BYTES = 256 * 1024;
const feedbackBodyLimit = bodyLimit({
  maxSize: FEEDBACK_BODY_LIMIT_BYTES,
  onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
});

const feedback = new Hono();

feedback.post("/", feedbackBodyLimit, feedbackRateLimit, async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      { ok: false, error: "Missing or invalid Authorization header. Use: Bearer <api-key>" },
      401,
    );
  }
  const rawKey = authHeader.slice(7);

  const db = getDb();
  const keyResult = await validateKey(db, rawKey);
  if (!keyResult) {
    return c.json({ ok: false, error: "Invalid or expired API key." }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Body must be JSON" }, 400);
  }

  // Accept a single row object or { feedback: [rows] }.
  let rows: RawFeedbackRow[];
  if (Array.isArray((body as { feedback?: unknown }).feedback)) {
    rows = (body as { feedback: RawFeedbackRow[] }).feedback;
  } else if (body && typeof body === "object" && "trace_id" in (body as Record<string, unknown>)) {
    rows = [body as RawFeedbackRow];
  } else {
    return c.json(
      { ok: false, error: "Body must be a feedback row object (with trace_id) or { \"feedback\": [rows] }" },
      400,
    );
  }

  const MAX_BATCH = 50;
  if (rows.length > MAX_BATCH) {
    return c.json({ ok: false, error: `Too many rows in one batch (max ${MAX_BATCH})` }, 400);
  }

  const results = await ingestFeedback({
    db,
    apiKeyId: keyResult.keyId,
    readGroupIds: keyResult.readGroupIds,
    rows,
  });

  const allBudgetRejected =
    results.length > 0 && results.every((r) => !r.ok && r.error?.includes("budget"));
  if (allBudgetRejected) {
    c.header("Retry-After", "3600");
    return c.json({ ok: false, error: "feedback budget exceeded for this API key", results }, 429);
  }

  const okCount = results.filter((r) => r.ok).length;
  return c.json({ ok: okCount > 0 || results.length === 0, data: { recorded: okCount, results } }, okCount > 0 || results.length === 0 ? 200 : 400);
});

export { feedback as feedbackRoutes };
