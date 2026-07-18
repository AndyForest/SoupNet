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
 * Short-id prefixes (2026-07-12): trace_id also accepts an unambiguous
 * UUID prefix of ≥ 8 hex chars — the short-id form check responses and
 * briefings print (e.g. `18912fbd`). Resolution happens strictly WITHIN
 * the key's readable scope (the ACL group filter is in the resolution
 * query), so a prefix over someone else's trace behaves exactly like an
 * unknown id: uniform marker, no existence oracle. An ambiguous prefix
 * (≥ 2 readable matches, detected with LIMIT 2) is rejected with an
 * actionable error naming the readable candidates — safe to name because
 * both are already within the caller's read scope. related_trace_ids
 * stays full-UUID-only: it's a capture-only lineage field, stored
 * unresolved and never ACL-checked, so prefix resolution there would turn
 * capture into validation (deliberate v1 scoping, backlog 2026-07-08).
 * The prefix lookup uses a pkey range scan (id >= lo AND id <= hi bounds
 * computed from the hex prefix) rather than `id::text LIKE`, which would
 * force a full scan past the uuid index.
 *
 * session_id (2026-07-17): optional capture-only token joining a feedback
 * row to the check lineage its session produced (session_shown, traces).
 * Shape-validated (see SESSION_ID_RE), stored as NULL when absent or
 * malformed — never minted, never a rejection.
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
  /** Alias for trace_id (canonical wire vocabulary prints recipeId). */
  recipe_id?: unknown;
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
  session_id?: unknown;
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
  sessionId: string | null;
}

export interface FeedbackRowResult {
  /** Position in the submitted batch (0-based). */
  index: number;
  ok: boolean;
  /** On success: the RESOLVED full trace UUID (a submitted short-id prefix
   *  is expanded). On rejection: the submitted trace_id (lowercased if it
   *  validated) so markers are matchable. */
  traceId: string;
  /** Present on success. */
  feedbackId?: string;
  /** Present on rejection — validation, ACL, or budget. */
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LEN = 4000;
const MAX_RELATED_IDS = 20;

/** Minimum accepted trace_id prefix length — the 8-char short id check
 *  responses print. Shorter fragments aren't a citation format any surface
 *  emits, so accepting them would only serve probing or typos. */
export const MIN_TRACE_ID_PREFIX = 8;

/** Canonical UUID text shape — hex everywhere except hyphens at 8/13/18/23. */
const UUID_TEMPLATE = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";

/** Uniform ACL marker — same text for unknown and unauthorized ids. */
export const TRACE_NOT_READABLE =
  "trace_id not found or not readable with this key";

/** Session-token shape — same rule as trace.service's resolveSessionId
 *  (8-64 url-safe chars), but with capture-only leniency: a malformed or
 *  missing value stores NULL. Never minted here — feedback joins a session
 *  a check response already named; it never starts one — and never a row
 *  rejection, so a mangled token can't cost the feedback it rides with. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// ── Short-id prefixes (pure helpers — Layer 1 tested) ────────────────────────

/**
 * True iff `value` is a proper prefix of a canonical UUID string, at least
 * MIN_TRACE_ID_PREFIX chars long (full 36-char UUIDs are handled by UUID_RE,
 * not here). Case-insensitive; hyphens must sit at the canonical positions.
 */
export function isTraceIdPrefix(value: string): boolean {
  if (value.length < MIN_TRACE_ID_PREFIX || value.length >= UUID_TEMPLATE.length) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    if (UUID_TEMPLATE[i] === "-") {
      if (value[i] !== "-") return false;
    } else if (!/[0-9a-f]/i.test(value[i]!)) {
      return false;
    }
  }
  return true;
}

/**
 * Inclusive UUID range [lo, hi] covering every UUID that starts with the
 * given prefix: hex digits padded with 0s (lo) and fs (hi) to 32, formatted
 * canonically. Lets the resolver use a pkey range scan instead of
 * `id::text LIKE`, which cannot use the uuid index.
 */
export function uuidPrefixRange(prefix: string): { lo: string; hi: string } {
  const hex = prefix.toLowerCase().replace(/-/g, "");
  const lo = hex.padEnd(32, "0");
  const hi = hex.padEnd(32, "f");
  const fmt = (h: string) =>
    `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return { lo: fmt(lo), hi: fmt(hi) };
}

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
  // Full UUID or an unambiguous short-id prefix (≥ MIN_TRACE_ID_PREFIX hex
  // chars — the form check responses print). Normalized to lowercase so the
  // resolved-set membership checks below compare canonically. `recipe_id` is
  // an accepted alias (canonical wire vocabulary, recipe 7945fd8a — check
  // responses print recipeId, so rows citing it verbatim must join);
  // trace_id wins when both are present (the historical field name).
  const rawId = typeof raw.trace_id === "string" && raw.trace_id.trim() !== ""
    ? raw.trace_id
    : typeof raw.recipe_id === "string" ? raw.recipe_id : "";
  const traceId = rawId.trim().toLowerCase();
  if (!UUID_RE.test(traceId) && !isTraceIdPrefix(traceId)) {
    return {
      ok: false,
      error: `trace_id (alias: recipe_id) must be the full recipe UUID from a prior check response, or an unambiguous prefix of at least ${MIN_TRACE_ID_PREFIX} characters (the short id check responses print)`,
    };
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

  // Capture-only (see SESSION_ID_RE note): valid shape → stored, anything
  // else → NULL. Deliberately not an error path.
  const sessionIdCandidate = typeof raw.session_id === "string" ? raw.session_id.trim() : "";
  const sessionId = SESSION_ID_RE.test(sessionIdCandidate) ? sessionIdCandidate : null;

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
      sessionId,
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
  // Full UUIDs go to the batch ACL query; short-id prefixes go to the
  // scope-filtered prefix resolver below.
  const validated: Array<{ index: number; row: ValidatedFeedbackRow } | { index: number; error: string; traceId: string }> = [];
  const idsToCheck = new Set<string>();
  const prefixesToResolve = new Set<string>();
  rows.forEach((raw, index) => {
    const v = validateFeedbackRow(raw);
    if (v.ok) {
      validated.push({ index, row: v.row });
      if (UUID_RE.test(v.row.traceId)) {
        idsToCheck.add(v.row.traceId);
      } else {
        prefixesToResolve.add(v.row.traceId);
      }
    } else {
      validated.push({ index, error: v.error, traceId: typeof raw.trace_id === "string" ? raw.trace_id : "" });
    }
  });

  // Resolve short-id prefixes strictly WITHIN the key's readable scope: the
  // group filter is in the query, so an out-of-scope trace can never
  // influence the outcome — a prefix over someone else's trace is
  // indistinguishable from an unknown one (uniform marker, no existence
  // oracle). Pkey range scan (see uuidPrefixRange); LIMIT 2 detects
  // ambiguity without counting.
  type PrefixResolution =
    | { kind: "resolved"; id: string }
    | { kind: "ambiguous"; candidates: [string, string] }
    | { kind: "none" };
  const prefixResolutions = new Map<string, PrefixResolution>();
  if (readGroupIds.length > 0) {
    for (const prefix of prefixesToResolve) {
      const { lo, hi } = uuidPrefixRange(prefix);
      const matchRows = await db.execute(sql`
        SELECT id FROM claimnet.traces
        WHERE id >= ${lo}::uuid AND id <= ${hi}::uuid
          AND group_id IN (${sql.join(readGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
        LIMIT 2
      `);
      const matches = (matchRows as unknown as Array<{ id: string }>).map((r) => r.id);
      if (matches.length === 1) {
        prefixResolutions.set(prefix, { kind: "resolved", id: matches[0]! });
      } else if (matches.length >= 2) {
        prefixResolutions.set(prefix, { kind: "ambiguous", candidates: [matches[0]!, matches[1]!] });
      } else {
        prefixResolutions.set(prefix, { kind: "none" });
      }
    }
  }

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
    let effectiveTraceId = row.traceId;
    if (!UUID_RE.test(row.traceId)) {
      // Short-id prefix — consume the scope-filtered resolution.
      const resolution = prefixResolutions.get(row.traceId);
      if (resolution?.kind === "ambiguous") {
        // Naming the candidates is safe: both are within the caller's read
        // scope (the resolution query filtered on it).
        results.push({
          index,
          ok: false,
          traceId: row.traceId,
          error: `trace_id prefix "${row.traceId}" is ambiguous — it matches at least ${resolution.candidates[0]} and ${resolution.candidates[1]} among the recipes readable by this key. Add more characters or use the full UUID.`,
        });
        continue;
      }
      if (resolution?.kind !== "resolved") {
        // No readable match (or empty read scope) — same uniform marker as
        // an unknown full UUID.
        results.push({ index, ok: false, traceId: row.traceId, error: TRACE_NOT_READABLE });
        continue;
      }
      // Readability was enforced inside the resolution query itself.
      effectiveTraceId = resolution.id;
    } else if (!readable.has(row.traceId)) {
      results.push({ index, ok: false, traceId: row.traceId, error: TRACE_NOT_READABLE });
      continue;
    }
    const inserted = await params.db
      .insert(checkFeedback)
      .values({
        traceId: effectiveTraceId,
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
        sessionId: row.sessionId,
      })
      .returning({ id: checkFeedback.id });
    const feedbackId = inserted[0]?.id;
    if (feedbackId) {
      // On success the RESOLVED full UUID is echoed (not the submitted
      // prefix) so the caller learns the canonical id for future rows.
      results.push({ index, ok: true, traceId: effectiveTraceId, feedbackId });
    } else {
      results.push({ index, ok: false, traceId: effectiveTraceId, error: "insert failed" });
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
