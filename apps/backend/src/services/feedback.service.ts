/**
 * Feedback ingestion service — one service, two thin surfaces:
 *   (a) the optional `feedback` array on check_recipe (mid-flow rows about
 *       PRIOR checks riding along with the current check), and
 *   (b) the standalone `log_feedback` MCP tool + REST POST /feedback.
 *
 * Wire format = the field-proven local JSONL schema v1 (strict enums — see
 * @soupnet/domain feedback.ts) extended with server stamps. Validation is
 * per-row: a bad row gets a marker, the rest of the batch still lands
 * (the ride-along surface must never kill the check it rides on).
 *
 * ACL: the referenced trace must be READABLE by the submitting key
 * (trace.group_id ∈ key.readGroupIds). Unknown ids and unreadable ids get
 * the same uniform marker — the write path must not be an existence oracle
 * (same anti-enumeration posture as uploads resolution / F30 register).
 *
 * Rate limit: feedback writes get their own per-key budget, counted on
 * check_feedback via its (api_key_id, created_at DESC) index — mirrors
 * F29's audit-log-count shape WITHOUT adding load to F29's indexed
 * audit_log query path. Defaults 200/hour, 1000/day; env overrides
 * FEEDBACK_RATE_LIMIT_HOURLY / FEEDBACK_RATE_LIMIT_DAILY;
 * DISABLE_RATE_LIMIT=true bypasses (test environments).
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  FEEDBACK_KINDS,
  FEEDBACK_IMPACTS,
  FEEDBACK_DISPOSITIONS,
  FEEDBACK_FULFILLED,
  vocab,
} from "@soupnet/domain";
import { checkFeedback } from "@soupnet/db";

// ── Budget ───────────────────────────────────────────────────────────────────

export const FEEDBACK_HOURLY_DEFAULT = 200;
export const FEEDBACK_DAILY_DEFAULT = 1000;

// ── Types ────────────────────────────────────────────────────────────────────

/** Raw (untrusted) feedback row as it arrives from a tool call or POST body. */
export interface RawFeedbackRow {
  trace_id?: unknown;
  kind?: unknown;
  impact?: unknown;
  disposition?: unknown;
  story_fulfilled?: unknown;
  story?: unknown;
  note?: unknown;
  agent_id?: unknown;
  top_similarity?: unknown;
  model?: unknown;
  harness?: unknown;
  harness_version?: unknown;
  related_trace_ids?: unknown;
}

export interface ValidatedFeedbackRow {
  traceId: string;
  kind: string;
  impact: string;
  disposition: string;
  storyFulfilled: string;
  story: string;
  note: string | null;
  agentId: string | null;
  topSimilarity: number | null;
  model: string | null;
  harness: string | null;
  harnessVersion: string | null;
  relatedTraceIds: string[] | null;
}

export interface FeedbackRowResult {
  /** Position in the submitted batch (0-based). */
  index: number;
  ok: boolean;
  /** Echo of the submitted trace_id (as received) so markers are matchable. */
  traceId: string;
  /** Present on success. */
  feedbackId?: string;
  /** Present on rejection — validation, ACL, or budget. */
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LEN = 4000;
const MAX_RELATED_IDS = 20;

/** Uniform ACL marker — same text for unknown and unauthorized ids. */
export const TRACE_NOT_READABLE =
  "trace_id not found or not readable with this key";

// ── Validation (pure — Layer 1 tested) ──────────────────────────────────────

function optionalString(value: unknown, field: string, out: { error?: string }): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    out.error = `${field} must be a string`;
    return null;
  }
  if (value.length > MAX_TEXT_LEN) {
    out.error = `${field} too long (max ${MAX_TEXT_LEN} chars)`;
    return null;
  }
  return value.trim() || null;
}

export function validateFeedbackRow(
  raw: RawFeedbackRow,
): { ok: true; row: ValidatedFeedbackRow } | { ok: false; error: string } {
  const traceId = typeof raw.trace_id === "string" ? raw.trace_id.trim() : "";
  if (!UUID_RE.test(traceId)) {
    return { ok: false, error: "trace_id must be the full recipe UUID from a prior check response" };
  }

  const enums: Array<{ field: string; value: unknown; allowed: readonly string[] }> = [
    { field: "kind", value: raw.kind, allowed: FEEDBACK_KINDS },
    { field: "impact", value: raw.impact, allowed: FEEDBACK_IMPACTS },
    { field: "disposition", value: raw.disposition, allowed: FEEDBACK_DISPOSITIONS },
    { field: "story_fulfilled", value: raw.story_fulfilled, allowed: FEEDBACK_FULFILLED },
  ];
  for (const { field, value, allowed } of enums) {
    if (typeof value !== "string" || !allowed.includes(value)) {
      return {
        ok: false,
        error: `${field} must be one of: ${vocab(allowed)} (got ${JSON.stringify(value ?? null)})`,
      };
    }
  }

  if (typeof raw.story !== "string" || raw.story.trim().length === 0) {
    return { ok: false, error: "story is required — the user story for why this check was made" };
  }
  if (raw.story.length > MAX_TEXT_LEN) {
    return { ok: false, error: `story too long (max ${MAX_TEXT_LEN} chars)` };
  }

  const err: { error?: string } = {};
  const note = optionalString(raw.note, "note", err);
  if (err.error) return { ok: false, error: err.error };
  const agentId = optionalString(raw.agent_id, "agent_id", err);
  if (err.error) return { ok: false, error: err.error };
  const model = optionalString(raw.model, "model", err);
  if (err.error) return { ok: false, error: err.error };
  const harness = optionalString(raw.harness, "harness", err);
  if (err.error) return { ok: false, error: err.error };
  const harnessVersion = optionalString(raw.harness_version, "harness_version", err);
  if (err.error) return { ok: false, error: err.error };

  let topSimilarity: number | null = null;
  if (raw.top_similarity !== undefined && raw.top_similarity !== null) {
    const n = Number(raw.top_similarity);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return { ok: false, error: "top_similarity must be a number between 0 and 1" };
    }
    topSimilarity = n;
  }

  let relatedTraceIds: string[] | null = null;
  if (raw.related_trace_ids !== undefined && raw.related_trace_ids !== null) {
    if (!Array.isArray(raw.related_trace_ids)) {
      return { ok: false, error: "related_trace_ids must be an array of recipe UUIDs" };
    }
    if (raw.related_trace_ids.length > MAX_RELATED_IDS) {
      return { ok: false, error: `related_trace_ids too long (max ${MAX_RELATED_IDS})` };
    }
    const ids: string[] = [];
    for (const id of raw.related_trace_ids) {
      if (typeof id !== "string" || !UUID_RE.test(id.trim())) {
        return { ok: false, error: `related_trace_ids entries must be full recipe UUIDs (got ${JSON.stringify(id)})` };
      }
      ids.push(id.trim());
    }
    relatedTraceIds = ids.length > 0 ? ids : null;
  }

  return {
    ok: true,
    row: {
      traceId,
      kind: raw.kind as string,
      impact: raw.impact as string,
      disposition: raw.disposition as string,
      storyFulfilled: raw.story_fulfilled as string,
      story: raw.story.trim(),
      note,
      agentId,
      topSimilarity,
      model,
      harness,
      harnessVersion,
      relatedTraceIds,
    },
  };
}

// ── Ingestion ────────────────────────────────────────────────────────────────

export interface IngestFeedbackParams {
  db: PostgresJsDatabase;
  /** Validated key context (from validateKey). */
  apiKeyId: string;
  readGroupIds: string[];
  rows: RawFeedbackRow[];
}

export async function ingestFeedback(
  params: IngestFeedbackParams,
): Promise<FeedbackRowResult[]> {
  const { db, apiKeyId, readGroupIds, rows } = params;
  const results: FeedbackRowResult[] = [];

  if (rows.length === 0) return results;

  // Per-key budget — counted on check_feedback's own index, not audit_log.
  if (process.env["DISABLE_RATE_LIMIT"] !== "true") {
    const hourlyMax = Number(process.env["FEEDBACK_RATE_LIMIT_HOURLY"] ?? FEEDBACK_HOURLY_DEFAULT);
    const dailyMax = Number(process.env["FEEDBACK_RATE_LIMIT_DAILY"] ?? FEEDBACK_DAILY_DEFAULT);
    const countRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS hourly,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS daily
      FROM claimnet.check_feedback
      WHERE api_key_id = ${apiKeyId}::uuid
        AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const counts = (countRows as unknown as Array<{ hourly: number; daily: number }>)[0];
    if ((counts?.hourly ?? 0) >= hourlyMax || (counts?.daily ?? 0) >= dailyMax) {
      return rows.map((raw, index) => ({
        index,
        ok: false,
        traceId: typeof raw.trace_id === "string" ? raw.trace_id : "",
        error: "feedback budget exceeded for this API key — retry later",
      }));
    }
  }

  // Validate all rows first, collecting the trace ids that need ACL checks.
  const validated: Array<{ index: number; row: ValidatedFeedbackRow } | { index: number; error: string; traceId: string }> = [];
  const idsToCheck = new Set<string>();
  rows.forEach((raw, index) => {
    const v = validateFeedbackRow(raw);
    if (v.ok) {
      validated.push({ index, row: v.row });
      idsToCheck.add(v.row.traceId);
    } else {
      validated.push({ index, error: v.error, traceId: typeof raw.trace_id === "string" ? raw.trace_id : "" });
    }
  });

  // ACL: batch-resolve which of the referenced traces are readable by this
  // key. Unknown and unreadable collapse into the same absent-set → uniform
  // marker (no existence oracle).
  const readable = new Set<string>();
  if (idsToCheck.size > 0 && readGroupIds.length > 0) {
    const traceRows = await db.execute(sql`
      SELECT id FROM claimnet.traces
      WHERE id IN (${sql.join([...idsToCheck].map((id) => sql`${id}::uuid`), sql`, `)})
        AND group_id IN (${sql.join(readGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    for (const r of traceRows as unknown as Array<{ id: string }>) {
      readable.add(r.id);
    }
  }

  for (const entry of validated) {
    if ("error" in entry) {
      results.push({ index: entry.index, ok: false, traceId: entry.traceId, error: entry.error });
      continue;
    }
    const { row, index } = entry;
    if (!readable.has(row.traceId)) {
      results.push({ index, ok: false, traceId: row.traceId, error: TRACE_NOT_READABLE });
      continue;
    }
    const inserted = await params.db
      .insert(checkFeedback)
      .values({
        traceId: row.traceId,
        apiKeyId,
        agentId: row.agentId,
        kind: row.kind,
        impact: row.impact,
        disposition: row.disposition,
        storyFulfilled: row.storyFulfilled,
        story: row.story,
        note: row.note,
        topSimilarity: row.topSimilarity,
        model: row.model,
        harness: row.harness,
        harnessVersion: row.harnessVersion,
        relatedTraceIds: row.relatedTraceIds,
      })
      .returning({ id: checkFeedback.id });
    const feedbackId = inserted[0]?.id;
    if (feedbackId) {
      results.push({ index, ok: true, traceId: row.traceId, feedbackId });
    } else {
      results.push({ index, ok: false, traceId: row.traceId, error: "insert failed" });
    }
  }

  return results;
}

/** One-line summary of a batch's results for MCP text responses. */
export function summarizeFeedbackResults(results: FeedbackRowResult[]): string {
  if (results.length === 0) return "";
  const okCount = results.filter((r) => r.ok).length;
  const lines = [`Feedback: ${okCount}/${results.length} row(s) recorded.`];
  for (const r of results) {
    if (!r.ok) {
      lines.push(`  - row ${r.index + 1} (${r.traceId || "no trace_id"}): ${r.error}`);
    }
  }
  return lines.join("\n");
}
