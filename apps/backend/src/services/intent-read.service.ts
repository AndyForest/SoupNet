/**
 * Read paths for reports (drafts-and-triage slice 9): a person's intents with
 * their lineage, and their feedback rows across recipes.
 *
 * The operator, 2026-10-24: "a read path for intents and feedback would be
 * very useful for creating reports". Until this slice no agent could read
 * either, and nobody could read intents at all. Three surfaces sit on this
 * service: GET /intents and GET /intents/:id and GET /feedback/rows under an
 * API key, and GET /me/intents/:id for the web intent page.
 *
 * Who sees what (ruling 54, the caller's user's rows only; the scope rules
 * are in authz/report-scope.ts):
 *   - intents: `intentOwnedBy`, the viewer's own. Not narrowed by book: an
 *     intent belongs to the person, not to a book (open question 57).
 *   - feedback rows: `feedbackOwnedBy`, and when the row is about a recipe,
 *     the viewer may read that recipe now. A row about a search names no
 *     recipe and is always listed.
 *   - every recipe id in a response (shown, deposited, related) passes the
 *     same read rule; one that does not is dropped and not counted ([F82]'s
 *     render rule).
 * An intent that is not the viewer's, one that never existed, and a
 * malformed id are the same not-found, and none of them is touched.
 *
 * Deposits: recipes whose `traces.intent_id` is the intent (slice 6a writes
 * it at deposit, from the depositing check's resolved intent). A verified
 * on-behalf recipe keeps its depositor's intent id while it becomes the
 * subject's, so it is counted here only while the viewer may read it, like
 * every other recipe a report names.
 *
 * Reads only. Nothing here writes, audits, or touches `last_used_at` (that
 * stamp is set by checks, in intent.service.ts, and a report reading an
 * intent is not a check).
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { feedbackOwnedBy, intentOwnedBy, traceReadableByViewer, viewerBookIds, inBooks, draftStateShownTo, draftLive, draftExpired } from "../authz";
import type { ReportViewer } from "../authz";
import { INTENT_ID_RE } from "./intent.service";
import type { FeedbackFilters, ReportPaging } from "./report-params";
import { pageInfo } from "./report-params";

export interface IntentCounts {
  shown: number;
  deposits: number;
  feedback: number;
  /** Slice 10 (S10-K3): the deposits that are drafts, as this viewer sees
   *  their state (`draftStateShownTo`, so a depositor never learns that a
   *  colleague verified one): still live, expired unanswered, or resolved. */
  drafts: { live: number; expired: number; resolved: number };
}

export interface IntentSummary {
  id: string;
  story: string;
  agentId: string | null;
  apiKeyLabel: string | null;
  createdAt: string;
  lastUsedAt: string;
  counts: IntentCounts;
}

/** One feedback row, as GET /traces/:id/feedback shapes it plus its target. */
export interface FeedbackRowOut {
  id: string;
  traceId: string | null;
  searchId: string | null;
  briefingId: string | null;
  agentId: string | null;
  kind: string;
  impact: string;
  disposition: string;
  storyFulfilled: string;
  story: string;
  note: string | null;
  topSimilarity: number | null;
  model: string | null;
  harness: string | null;
  harnessVersion: string | null;
  relatedTraceIds: string[] | null;
  sessionId: string | null;
  intentId: string | null;
  createdAt: string;
  apiKeyLabel: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  starCount: number;
  starredByMe: boolean;
  /** The row is the viewer's own (written by their key or by them). */
  isMine: boolean;
}

export type LineageEntry =
  | { type: "shown"; traceId: string; at: string }
  | { type: "deposit"; traceId: string; at: string; draftState: string | null }
  | { type: "feedback"; at: string; feedback: FeedbackRowOut };

type Page = ReturnType<typeof pageInfo>;

// ── Shared conditions ───────────────────────────────────────────────────────

/** A feedback row (aliased `cf`, with its recipe LEFT JOINed as `t`) this viewer may see. */
function feedbackVisible(viewer: ReportViewer): SQL {
  return sql`${feedbackOwnedBy(viewer.userId)}
    AND (cf.trace_id IS NULL OR (t.id IS NOT NULL AND ${traceReadableByViewer(viewer)}))`;
}

/** Recipes deposited under intent `intentId` that this viewer may read (rows of `t`). */
function depositsFrom(intentId: SQL, viewer: ReportViewer): SQL {
  return sql`FROM claimnet.traces t
    WHERE t.intent_id = ${intentId} AND ${traceReadableByViewer(viewer)}`;
}

/** Shown ids of intent `intentId` this viewer may read (rows of `intent_shown s` joined to `t`). */
function shownFrom(intentId: SQL, viewer: ReportViewer): SQL {
  return sql`FROM claimnet.intent_shown s
    JOIN claimnet.traces t ON t.id = s.trace_id
    WHERE s.intent_id = ${intentId} AND ${traceReadableByViewer(viewer)}`;
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

// ── Feedback rows ───────────────────────────────────────────────────────────

/** The row shape, selected once for the listing and the lineage. */
function feedbackSelect(viewer: ReportViewer): SQL {
  return sql`
    SELECT
      cf.id,
      cf.trace_id AS "traceId",
      cf.search_audit_id AS "searchId",
      cf.briefing_audit_id AS "briefingId",
      cf.agent_id AS "agentId",
      cf.kind,
      cf.impact,
      cf.disposition,
      cf.story_fulfilled AS "storyFulfilled",
      cf.story,
      cf.note,
      cf.top_similarity AS "topSimilarity",
      cf.model,
      cf.harness,
      cf.harness_version AS "harnessVersion",
      cf.related_trace_ids AS "relatedTraceIds",
      cf.session_id AS "sessionId",
      cf.intent_id AS "intentId",
      cf.created_at AS "createdAt",
      -- Display label only; the row is already the viewer's by feedbackVisible.
      ak.label AS "apiKeyLabel",
      -- Always true here; carried so a row reads the same as on the detail page.
      ${feedbackOwnedBy(viewer.userId)} AS "isMine",
      cf.actor_user_id AS "actorUserId",
      au.email AS "actorEmail",
      (SELECT COUNT(*) FROM claimnet.check_feedback_stars s WHERE s.feedback_id = cf.id)::int AS "starCount",
      EXISTS (SELECT 1 FROM claimnet.check_feedback_stars my
              WHERE my.feedback_id = cf.id AND my.user_id = ${viewer.userId}::uuid) AS "starredByMe"
    FROM claimnet.check_feedback cf
    LEFT JOIN claimnet.traces t ON t.id = cf.trace_id
    LEFT JOIN claimnet.api_keys ak ON ak.id = cf.api_key_id
    LEFT JOIN claimnet.users au ON au.id = cf.actor_user_id`;
}

type RawFeedbackRow = Omit<FeedbackRowOut, "createdAt" | "topSimilarity"> & { createdAt: unknown; topSimilarity: number | string | null };

/** Which of these recipe ids may the viewer read now? Input order kept. */
async function readableIds(db: PostgresJsDatabase, viewer: ReportViewer, ids: readonly string[]): Promise<Set<string>> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const wanted = [...new Set(ids.filter((id) => uuid.test(id)).map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return new Set();
  const rows = await db.execute(sql`
    SELECT t.id::text AS id FROM claimnet.traces t
    WHERE t.id IN (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)})
      AND ${traceReadableByViewer(viewer)}
  `);
  return new Set((rows as unknown as Array<{ id: string }>).map((r) => r.id.toLowerCase()));
}

/** Finish raw rows: dates as ISO strings, related ids filtered to what the viewer may read. */
async function finishFeedbackRows(db: PostgresJsDatabase, viewer: ReportViewer, raw: RawFeedbackRow[]): Promise<FeedbackRowOut[]> {
  const readable = await readableIds(db, viewer, raw.flatMap((r) => r.relatedTraceIds ?? []));
  return raw.map((r) => ({
    ...r,
    topSimilarity: r.topSimilarity === null ? null : Number(r.topSimilarity),
    createdAt: toIso(r.createdAt),
    relatedTraceIds: r.relatedTraceIds ? r.relatedTraceIds.filter((id) => readable.has(id.toLowerCase())) : null,
  }));
}

/** The `recipe_book` filter, resolved among the viewer's books; null when it names none of them. */
async function resolveBook(db: PostgresJsDatabase, viewer: ReportViewer, slugOrId: string): Promise<string | null> {
  const books = viewerBookIds(viewer);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const rows = await db.execute(sql`
    SELECT g.id::text AS id FROM claimnet.groups g
    WHERE ${inBooks(sql`g.id`, books)}
      AND ${isUuid ? sql`g.id = ${slugOrId}::uuid` : sql`g.slug = ${slugOrId}`}
    LIMIT 1
  `);
  return (rows as unknown as Array<{ id: string }>)[0]?.id ?? null;
}

/**
 * GET /feedback/rows: the viewer's feedback rows, newest first, filtered and
 * paged. A filter that names something not the viewer's (another person's
 * intent or search, an unreadable recipe or book) matches nothing, the same
 * as an id that never existed.
 */
export async function listFeedbackRows(
  db: PostgresJsDatabase,
  viewer: ReportViewer,
  filters: FeedbackFilters,
  paging: ReportPaging,
): Promise<{ items: FeedbackRowOut[] } & Page> {
  const conds: SQL[] = [feedbackVisible(viewer)];
  if (filters.intentId) conds.push(sql`cf.intent_id = ${filters.intentId}`);
  if (filters.traceId) conds.push(sql`cf.trace_id = ${filters.traceId}::uuid`);
  if (filters.searchId) conds.push(sql`cf.search_audit_id = ${filters.searchId}::uuid`);
  if (filters.agentId) conds.push(sql`cf.agent_id = ${filters.agentId}`);
  if (filters.since) conds.push(sql`cf.created_at >= ${filters.since.toISOString()}::timestamptz`);
  if (filters.recipeBook !== undefined) {
    const bookId = await resolveBook(db, viewer, filters.recipeBook);
    conds.push(bookId ? sql`t.group_id = ${bookId}::uuid` : sql`FALSE`);
  }
  const where = sql.join(conds, sql` AND `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM claimnet.check_feedback cf
    LEFT JOIN claimnet.traces t ON t.id = cf.trace_id
    WHERE ${where}
  `);
  const total = (countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  const raw = total === 0 ? [] : await db.execute(sql`
    ${feedbackSelect(viewer)}
    WHERE ${where}
    ORDER BY cf.created_at DESC, cf.id DESC
    LIMIT ${paging.perPage} OFFSET ${paging.offset}
  `);
  const items = await finishFeedbackRows(db, viewer, raw as unknown as RawFeedbackRow[]);
  return { items, ...pageInfo(total, paging) };
}

// ── Intents ─────────────────────────────────────────────────────────────────

/** The summary columns for intents aliased `i`, counts under the viewer's rules. */
function intentSummarySelect(viewer: ReportViewer): SQL {
  return sql`
    SELECT
      i.id,
      i.story,
      i.agent_id AS "agentId",
      -- Display label only; the intent is already the viewer's by intentOwnedBy.
      ik.label AS "apiKeyLabel",
      i.created_at AS "createdAt",
      i.last_used_at AS "lastUsedAt",
      (SELECT COUNT(*) ${shownFrom(sql`i.id`, viewer)})::int AS "shownCount",
      (SELECT COUNT(*) ${depositsFrom(sql`i.id`, viewer)})::int AS "depositCount",
      (SELECT COUNT(*) ${depositsFrom(sql`i.id`, viewer)}
         AND ${draftStateShownTo("t", viewer.userId)} IS NOT NULL AND ${draftLive("t")})::int AS "draftsLive",
      (SELECT COUNT(*) ${depositsFrom(sql`i.id`, viewer)}
         AND ${draftStateShownTo("t", viewer.userId)} IS NOT NULL AND ${draftExpired("t")})::int AS "draftsExpired",
      (SELECT COUNT(*) ${depositsFrom(sql`i.id`, viewer)}
         AND ${draftStateShownTo("t", viewer.userId)} IS NOT NULL
         AND NOT ${draftLive("t")} AND NOT ${draftExpired("t")})::int AS "draftsResolved",
      (SELECT COUNT(*) FROM claimnet.check_feedback cf
         LEFT JOIN claimnet.traces t ON t.id = cf.trace_id
         WHERE cf.intent_id = i.id AND ${feedbackVisible(viewer)})::int AS "feedbackCount"
    FROM claimnet.intents i
    LEFT JOIN claimnet.api_keys ik ON ik.id = i.api_key_id`;
}

interface RawIntent {
  id: string;
  story: string;
  agentId: string | null;
  apiKeyLabel: string | null;
  createdAt: unknown;
  lastUsedAt: unknown;
  shownCount: number;
  depositCount: number;
  feedbackCount: number;
  draftsLive: number;
  draftsExpired: number;
  draftsResolved: number;
}

function toSummary(r: RawIntent): IntentSummary {
  return {
    id: r.id,
    story: r.story,
    agentId: r.agentId,
    apiKeyLabel: r.apiKeyLabel,
    createdAt: toIso(r.createdAt),
    lastUsedAt: toIso(r.lastUsedAt),
    counts: {
      shown: Number(r.shownCount),
      deposits: Number(r.depositCount),
      feedback: Number(r.feedbackCount),
      drafts: { live: Number(r.draftsLive), expired: Number(r.draftsExpired), resolved: Number(r.draftsResolved) },
    },
  };
}

/** GET /intents: the viewer's intents, newest first, paged. */
export async function listIntents(
  db: PostgresJsDatabase,
  viewer: ReportViewer,
  paging: ReportPaging,
): Promise<{ items: IntentSummary[] } & Page> {
  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM claimnet.intents i WHERE ${intentOwnedBy(viewer.userId)}
  `);
  const total = (countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  const raw = total === 0 ? [] : await db.execute(sql`
    ${intentSummarySelect(viewer)}
    WHERE ${intentOwnedBy(viewer.userId)}
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${paging.perPage} OFFSET ${paging.offset}
  `);
  const items = (raw as unknown as RawIntent[]).map(toSummary);
  return { items, ...pageInfo(total, paging) };
}

/**
 * GET /intents/:id: the summary and one page of the lineage, oldest first.
 * Null for an intent that is not the viewer's, one that never existed, and a
 * malformed id alike.
 */
export async function getIntent(
  db: PostgresJsDatabase,
  viewer: ReportViewer,
  intentId: string,
  paging: ReportPaging,
): Promise<({ intent: IntentSummary; lineage: LineageEntry[] } & Page) | null> {
  if (!INTENT_ID_RE.test(intentId)) return null;
  const rows = await db.execute(sql`
    ${intentSummarySelect(viewer)}
    WHERE i.id = ${intentId} AND ${intentOwnedBy(viewer.userId)}
  `);
  const row = (rows as unknown as RawIntent[])[0];
  if (!row) return null;
  const intent = toSummary(row);
  const total = intent.counts.shown + intent.counts.deposits + intent.counts.feedback;

  // One timeline over the three sources, ordered and paged in the database.
  // `ref` is the trace id for a shown or deposit entry, the feedback id for a
  // feedback entry; ties break on type then ref so pages are stable.
  const timeline = total === 0 ? [] : await db.execute(sql`
    SELECT type, ref, at, draft_state AS "draftState" FROM (
      SELECT 'shown' AS type, s.trace_id::text AS ref, s.shown_at AS at, NULL::text AS draft_state
        ${shownFrom(sql`${intentId}`, viewer)}
      UNION ALL
      SELECT 'deposit' AS type, t.id::text AS ref, t.created_at AS at, ${draftStateShownTo("t", viewer.userId)} AS draft_state
        ${depositsFrom(sql`${intentId}`, viewer)}
      UNION ALL
      SELECT 'feedback' AS type, cf.id::text AS ref, cf.created_at AS at, NULL::text AS draft_state
        FROM claimnet.check_feedback cf
        LEFT JOIN claimnet.traces t ON t.id = cf.trace_id
        WHERE cf.intent_id = ${intentId} AND ${feedbackVisible(viewer)}
    ) lineage
    ORDER BY at ASC, type ASC, ref ASC
    LIMIT ${paging.perPage} OFFSET ${paging.offset}
  `);
  const entries = timeline as unknown as Array<{ type: "shown" | "deposit" | "feedback"; ref: string; at: unknown; draftState: string | null }>;

  const feedbackIds = entries.filter((e) => e.type === "feedback").map((e) => e.ref);
  const feedbackById = new Map<string, FeedbackRowOut>();
  if (feedbackIds.length > 0) {
    const raw = await db.execute(sql`
      ${feedbackSelect(viewer)}
      WHERE cf.id IN (${sql.join(feedbackIds.map((id) => sql`${id}::uuid`), sql`, `)})
        AND ${feedbackVisible(viewer)}
    `);
    for (const f of await finishFeedbackRows(db, viewer, raw as unknown as RawFeedbackRow[])) feedbackById.set(f.id, f);
  }

  const lineage: LineageEntry[] = [];
  for (const e of entries) {
    if (e.type === "shown") {
      lineage.push({ type: "shown", traceId: e.ref, at: toIso(e.at) });
    } else if (e.type === "deposit") {
      lineage.push({ type: "deposit", traceId: e.ref, at: toIso(e.at), draftState: e.draftState });
    } else {
      const feedback = feedbackById.get(e.ref);
      if (feedback) lineage.push({ type: "feedback", at: toIso(e.at), feedback });
    }
  }
  return { intent, lineage, ...pageInfo(total, paging) };
}
