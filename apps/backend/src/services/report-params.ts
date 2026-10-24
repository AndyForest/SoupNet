/**
 * Query parameters for the report read paths (drafts-and-triage slice 9):
 * GET /intents, GET /intents/:id, GET /feedback/rows.
 *
 * Strict by design: an unknown parameter name, a repeated one, or a value
 * that does not parse is refused, and the refusal names every failing
 * parameter at once (the slice 8 rule, item 5, applied to new REST from the
 * start). A mistyped filter that was silently ignored would widen a report
 * without saying so, which is the failure a report must not have.
 *
 * Pure: no I/O. The routes hand in `c.req.queries()`.
 */

import { INTENT_ID_RE } from "./intent.service";

export const REPORT_PER_PAGE_DEFAULT = 50;
export const REPORT_PER_PAGE_MAX = 200;
/** A page number past any real report; keeps OFFSET arithmetic small. */
export const REPORT_PAGE_MAX = 100_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A date, or a date-time with an explicit offset or Z (a bare local time is ambiguous). */
const SINCE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))?$/;
const TEXT_MAX = 200;

export type FeedbackFilterName = "intent_id" | "trace_id" | "search_id" | "agent_id" | "since" | "recipe_book";

export interface ReportPaging {
  page: number;
  perPage: number;
  offset: number;
}

export interface FeedbackFilters {
  intentId?: string;
  traceId?: string;
  searchId?: string;
  agentId?: string;
  since?: Date;
  recipeBook?: string;
}

export type ReportQueryResult =
  | { ok: true; paging: ReportPaging; filters: FeedbackFilters }
  | { ok: false; error: string; fields: string[] };

const PAGING_PARAMS = ["page", "per_page"] as const;
/** `recipe_id` is the alias the feedback write surfaces already accept for `trace_id`. */
const ALIASES: Record<string, FeedbackFilterName> = { recipe_id: "trace_id" };

function parsePositiveInt(raw: string, max: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

/**
 * Parse a report's query. `allowedFilters` is the set the path takes (none
 * for the intent paths); paging is always allowed.
 */
export function parseReportQuery(
  query: Record<string, string[]>,
  allowedFilters: readonly FeedbackFilterName[],
): ReportQueryResult {
  const problems: Array<{ field: string; message: string }> = [];
  const values = new Map<string, string>();

  for (const [rawName, list] of Object.entries(query)) {
    const name = ALIASES[rawName] && allowedFilters.includes(ALIASES[rawName]!) ? ALIASES[rawName]! : rawName;
    const known = (PAGING_PARAMS as readonly string[]).includes(name) || (allowedFilters as readonly string[]).includes(name);
    if (!known) {
      const hint = rawName === "key"
        ? "this path takes the key only as an Authorization: Bearer header"
        : `unknown parameter; this path takes ${[...allowedFilters, ...PAGING_PARAMS].join(", ")}`;
      problems.push({ field: rawName, message: hint });
      continue;
    }
    if (list.length !== 1 || values.has(name)) {
      problems.push({ field: rawName, message: "given more than once" });
      continue;
    }
    values.set(name, list[0]!.trim());
  }

  let page = 1;
  let perPage = REPORT_PER_PAGE_DEFAULT;
  const filters: FeedbackFilters = {};

  for (const [name, value] of values) {
    switch (name) {
      case "page": {
        const n = parsePositiveInt(value, REPORT_PAGE_MAX);
        if (n === null) problems.push({ field: name, message: `a whole number from 1 to ${REPORT_PAGE_MAX}` });
        else page = n;
        break;
      }
      case "per_page": {
        const n = parsePositiveInt(value, REPORT_PER_PAGE_MAX);
        if (n === null) problems.push({ field: name, message: `a whole number from 1 to ${REPORT_PER_PAGE_MAX}` });
        else perPage = n;
        break;
      }
      case "intent_id":
        if (!INTENT_ID_RE.test(value)) problems.push({ field: name, message: "an intent id: int_ followed by 24 letters or digits" });
        else filters.intentId = value;
        break;
      case "trace_id":
        if (!UUID_RE.test(value)) problems.push({ field: name, message: "a full recipe id (UUID)" });
        else filters.traceId = value.toLowerCase();
        break;
      case "search_id":
        if (!UUID_RE.test(value)) problems.push({ field: name, message: "a full search id (UUID), as a search response gives it" });
        else filters.searchId = value.toLowerCase();
        break;
      case "agent_id":
        if (value.length === 0 || value.length > TEXT_MAX) problems.push({ field: name, message: `the agent id as the agent sent it, 1 to ${TEXT_MAX} characters` });
        else filters.agentId = value;
        break;
      case "recipe_book":
        if (value.length === 0 || value.length > TEXT_MAX) problems.push({ field: name, message: "a recipe book's slug or id" });
        else filters.recipeBook = value;
        break;
      case "since": {
        const d = SINCE_RE.test(value) ? new Date(value) : null;
        if (!d || Number.isNaN(d.getTime())) problems.push({ field: name, message: "an ISO 8601 date (2026-10-24) or date-time with an offset (2026-10-24T09:30:00Z)" });
        else filters.since = d;
        break;
      }
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      fields: problems.map((p) => p.field),
      error: `Invalid query parameters: ${problems.map((p) => `${p.field} (${p.message})`).join("; ")}.`,
    };
  }
  return { ok: true, paging: { page, perPage, offset: (page - 1) * perPage }, filters };
}

/** The paging block every report list answers with. */
export function pageInfo(total: number, paging: ReportPaging): { total: number; page: number; perPage: number; totalPages: number } {
  return { total, page: paging.page, perPage: paging.perPage, totalPages: Math.ceil(total / paging.perPage) };
}
