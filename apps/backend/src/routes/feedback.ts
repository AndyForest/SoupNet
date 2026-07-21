/**
 * /feedback — REST surface for standalone feedback rows (the same service the
 * log_feedback MCP tool and the check_recipe feedback ride-along use — one
 * validation/ACL path, four thin surfaces counting this route's two verbs).
 *
 * POST /feedback (primary): API-key Bearer auth (agent credential
 * population, same as /mcp and /uploads). Body: either a single feedback row
 * object or { "feedback": [row, ...] }. JSON response only.
 *
 * GET /feedback (backup, 2026-07-21): for web-only agents that can construct
 * a URL but can't POST JSON or set headers — the same population /check
 * serves. Auth is `?key=` first (matching /check), falling back to
 * `Authorization: Bearer` for callers that can set headers but landed here
 * instead of POST. One row per request, as flat query params matching
 * RawFeedbackRow's field names 1:1 (trace_id, kind, impact, disposition,
 * story_fulfilled, story, note, ...); `related_trace_ids` is comma-separated
 * since a query string can't carry an array. Content negotiation mirrors
 * /check: `format=json` or an `Accept: application/json` header returns the
 * same JSON shape as POST; otherwise a minimal HTML confirmation page.
 *
 * Response: per-row markers — a bad row never blocks the rest of the batch
 * (POST) or fails the request (GET's single row still gets a 200/400 with an
 * explicit error, never a silent drop).
 *
 * Rate limiting: per-IP limiter here (defense in depth) on both verbs; the
 * per-key feedback budget lives in the service (counted on check_feedback's
 * own index — NOT audit_log, which is F29's hot path). A fully-over-budget
 * batch returns 429 with Retry-After on both verbs.
 *
 * Idempotency (2026-07-21): identical resubmissions of the same row — most
 * concretely, a link-preview unfurler or URL sanitizer prefetching a GET
 * /feedback URL — dedupe server-side (feedback.service.ts) and return the
 * original row (`dup: true`) instead of inserting a duplicate.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../db";
import { validateKey } from "../services/api-key.service";
import { rateLimit } from "../middleware/rate-limit";
import type { RawFeedbackRow, FeedbackRowResult } from "../services/feedback.service";
import { ingestFeedback } from "../services/feedback.service";

const feedbackRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

// Feedback rows are text-only; 256 KiB is generous for a batch.
const FEEDBACK_BODY_LIMIT_BYTES = 256 * 1024;
const feedbackBodyLimit = bodyLimit({
  maxSize: FEEDBACK_BODY_LIMIT_BYTES,
  onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
});

const feedback = new Hono();

// ── HTML escaping (same tolerant-of-empty style as check.ts's esc()) ───────

function esc(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function wantsJson(c: Context): boolean {
  if (c.req.query("format") === "json") return true;
  const accept = c.req.header("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

// ── Minimal HTML shell (GET surface only — POST is JSON-only) ──────────────

function renderFeedbackPage(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; Feedback</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header>
    <h1>Soup.net &mdash; Feedback</h1>
  </header>
  ${bodyHtml}
</body>
</html>`;
}

function renderFeedbackErrorHtml(message: string): string {
  return renderFeedbackPage(`<div class="error"><strong>Error:</strong> ${esc(message)}</div>`);
}

/** One "recorded" / "error" line per row — same rendering as /check's
 *  feedback_* ride-along confirmation (check.ts renderFeedbackHtml). */
function renderFeedbackResultsHtml(results: FeedbackRowResult[]): string {
  const lines = results
    .map((r) =>
      r.ok
        ? r.dup
          ? `<li>already recorded &mdash; feedback id <code>${esc(r.feedbackId ?? "")}</code> for recipe <code>${esc(r.traceId)}</code></li>`
          : `<li>recorded &mdash; feedback id <code>${esc(r.feedbackId ?? "")}</code> for recipe <code>${esc(r.traceId)}</code></li>`
        : `<li>error &mdash; ${esc(r.error ?? "unknown error")}</li>`,
    )
    .join("\n      ");
  return renderFeedbackPage(`
  <section id="feedback-result">
    <ul>
      ${lines}
    </ul>
  </section>`);
}

// ── GET query row assembly ───────────────────────────────────────────────────

/** Read one RawFeedbackRow's worth of flat query params — every scalar field
 *  on the interface, by its exact name. `related_trace_ids` is the one array
 *  field; a query string can't carry an array, so it's accepted
 *  comma-separated and split here (the service still validates each entry as
 *  a full UUID). */
function readFeedbackQueryRow(c: Context): RawFeedbackRow {
  const q = (name: string) => c.req.query(name);
  const relatedRaw = q("related_trace_ids");
  return {
    trace_id: q("trace_id"),
    recipe_id: q("recipe_id"),
    kind: q("kind"),
    impact: q("impact"),
    disposition: q("disposition"),
    story_fulfilled: q("story_fulfilled"),
    story: q("story"),
    note: q("note"),
    agent_id: q("agent_id"),
    top_similarity: q("top_similarity"),
    model: q("model"),
    harness: q("harness"),
    harness_version: q("harness_version"),
    session_id: q("session_id"),
    related_trace_ids: relatedRaw
      ? relatedRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
  };
}

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

// GET /feedback — backup surface for web-only agents that can construct a
// URL but can't POST JSON or set headers (the failure mode this route
// exists to close: a real agent hand-built `GET /feedback?key=...` and hit
// a 404). No bodyLimit — GET has no body.
feedback.get("/", feedbackRateLimit, async (c) => {
  const jsonMode = wantsJson(c);
  const keyParamMessage = "Provide an API key as ?key=YOUR_KEY (matching /check), or an Authorization: Bearer header.";

  const queryKey = c.req.query("key");
  const authHeader = c.req.header("Authorization");
  const rawKey = queryKey ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
  if (!rawKey) {
    const message = `Missing API key. ${keyParamMessage}`;
    return jsonMode
      ? c.json({ ok: false, error: message }, 401)
      : c.html(renderFeedbackErrorHtml(message), 401);
  }

  const db = getDb();
  const keyResult = await validateKey(db, rawKey);
  if (!keyResult) {
    const message = `Invalid or expired API key. ${keyParamMessage}`;
    return jsonMode
      ? c.json({ ok: false, error: message }, 401)
      : c.html(renderFeedbackErrorHtml(message), 401);
  }

  const row = readFeedbackQueryRow(c);
  if (!row.trace_id && !row.recipe_id) {
    const message = "Missing required param: trace_id (or its alias recipe_id) naming the recipe this feedback is about.";
    return jsonMode
      ? c.json({ ok: false, error: message }, 400)
      : c.html(renderFeedbackErrorHtml(message), 400);
  }

  const results = await ingestFeedback({
    db,
    apiKeyId: keyResult.keyId,
    readGroupIds: keyResult.readGroupIds,
    rows: [row],
  });

  const allBudgetRejected =
    results.length > 0 && results.every((r) => !r.ok && r.error?.includes("budget"));
  if (allBudgetRejected) {
    c.header("Retry-After", "3600");
    return jsonMode
      ? c.json({ ok: false, error: "feedback budget exceeded for this API key", results }, 429)
      : c.html(renderFeedbackErrorHtml("Feedback budget exceeded for this API key — retry later."), 429);
  }

  const okCount = results.filter((r) => r.ok).length;
  const status = okCount > 0 ? 200 : 400;
  if (jsonMode) {
    return c.json({ ok: okCount > 0, data: { recorded: okCount, results } }, status);
  }
  return c.html(renderFeedbackResultsHtml(results), status);
});

export { feedback as feedbackRoutes };
