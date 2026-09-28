/**
 * Per-book index stats for the briefing's recipe-book index lines
 * (cold-start v2 Phase B). Deterministic SQL only — zero server LLM, per the
 * cheap-math architecture; the qualitative half of the index lives in the
 * agent-maintained book description (nightly scribe,
 * docs/briefings/nightly-scribe-brief.md).
 *
 * Three GROUP BY queries over existing indexes (traces_group_id_idx,
 * traces_judgment_date_idx, check_feedback_trace_id_idx,
 * trace_reactions_trace_id_idx) — the first aggregation surface in the
 * codebase, kept to one narrow function so the cost is measurable in one
 * place. Runs only for MCP-surface briefings today (the web/paste briefing
 * stays byte-identical to its pre-index shape), so the web copy-briefing
 * path pays nothing.
 *
 * The judgment date is COALESCE(decided_at, created_at) — the same cascade
 * every other surface uses — so a backfilled decision-archaeology import
 * never reads as fresh activity; lastLogged (max created_at) carries the
 * append recency separately.
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { BriefingBookStats } from "@soupnet/domain";
import { inBooks, publishedTrace, draftAwaitingReviewBy } from "../authz";

interface TraceAggRow {
  groupId: string;
  recipeCount: number;
  newestJudgment: string | null;
  lastLogged: string | null;
  authorCount: number;
}

interface FeedbackAggRow {
  groupId: string;
  feedbackCount: number;
  feedbackFulfilled: number;
}

interface ReactionAggRow {
  groupId: string;
  reaction: string;
  n: number;
}

/** YYYY-MM-DD from a raw postgres timestamp string (or Date). */
function shortDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  return undefined;
}

/**
 * Fetch index stats for the given books in batched queries.
 * Books with zero traces get no map entry — callers render no index line
 * for them (an empty book's absence of stats is itself legible).
 *
 * Drafts (drafts-and-triage slice 2): every shared figure — recipe and author
 * counts, both dates, feedback and reaction counts — is of PUBLISHED recipes
 * only, so a collaborator's Index line never moves when someone's draft
 * lands or is annotated (DT-VIS-08, DT-VIS-18). `personUserId` (the key's
 * user) adds one figure only their own agents see: their unverified drafts
 * awaiting review, rendered on a separate line (DT-VIS-09).
 */
export async function fetchBookStats(
  db: PostgresJsDatabase,
  groupIds: string[],
  personUserId: string,
): Promise<Map<string, BriefingBookStats>> {
  const out = new Map<string, BriefingBookStats>();
  if (groupIds.length === 0) return out;
  const inScope = sql`${inBooks(sql`t.group_id`, groupIds)} AND ${publishedTrace("t")}`;

  const traceRows = await db.execute(sql`
    SELECT
      t.group_id::text AS "groupId",
      count(*)::int AS "recipeCount",
      max(COALESCE(t.decided_at, t.created_at))::text AS "newestJudgment",
      max(t.created_at)::text AS "lastLogged",
      count(DISTINCT t.user_id)::int AS "authorCount"
    FROM claimnet.traces t
    WHERE ${inScope}
    GROUP BY t.group_id
  `);
  for (const row of traceRows as unknown as TraceAggRow[]) {
    const stats: BriefingBookStats = {
      recipeCount: Number(row.recipeCount),
      authorCount: Number(row.authorCount),
    };
    const newest = shortDate(row.newestJudgment);
    const logged = shortDate(row.lastLogged);
    if (newest) stats.newestJudgment = newest;
    if (logged) stats.lastLogged = logged;
    out.set(row.groupId, stats);
  }

  // The person's own unverified drafts, per book (their agents only).
  const draftRows = await db.execute(sql`
    SELECT t.group_id::text AS "groupId", count(*)::int AS n
    FROM claimnet.traces t
    WHERE ${inBooks(sql`t.group_id`, groupIds)}
      AND ${draftAwaitingReviewBy("t", personUserId)}
    GROUP BY t.group_id
  `);
  for (const row of draftRows as unknown as Array<{ groupId: string; n: number }>) {
    const existing = out.get(row.groupId);
    if (existing) existing.ownDraftsAwaitingReview = Number(row.n);
    else out.set(row.groupId, { recipeCount: 0, authorCount: 0, ownDraftsAwaitingReview: Number(row.n) });
  }
  if (out.size === 0) return out;

  const feedbackRows = await db.execute(sql`
    SELECT
      t.group_id::text AS "groupId",
      count(*)::int AS "feedbackCount",
      count(*) FILTER (WHERE cf.story_fulfilled = 'yes')::int AS "feedbackFulfilled"
    FROM claimnet.check_feedback cf
    JOIN claimnet.traces t ON t.id = cf.trace_id
    WHERE ${inScope}
    GROUP BY t.group_id
  `);
  for (const row of feedbackRows as unknown as FeedbackAggRow[]) {
    const stats = out.get(row.groupId);
    if (!stats) continue;
    stats.feedbackCount = Number(row.feedbackCount);
    stats.feedbackFulfilled = Number(row.feedbackFulfilled);
  }

  const reactionRows = await db.execute(sql`
    SELECT
      t.group_id::text AS "groupId",
      tr.reaction,
      count(*)::int AS n
    FROM claimnet.trace_reactions tr
    JOIN claimnet.traces t ON t.id = tr.trace_id
    WHERE ${inScope}
    GROUP BY t.group_id, tr.reaction
  `);
  for (const row of reactionRows as unknown as ReactionAggRow[]) {
    const stats = out.get(row.groupId);
    if (!stats) continue;
    const n = Number(row.n);
    if (row.reaction === "still_true") stats.reactionsStillTrue = n;
    else if (row.reaction === "stale") stats.reactionsStale = n;
    else if (row.reaction === "wrong") stats.reactionsWrong = n;
  }

  return out;
}
