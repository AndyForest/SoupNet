/**
 * The search grammar's selections that are not ranking inputs
 * (drafts-and-triage slice 3): `is:draft` / `-is:draft`, and `impact:` /
 * `uncertainty:` over the stored triage ratings; and from slice 6a
 * `intent:`, the recipes deposited under one of the viewer's own intents;
 * and from slice 8b `created-after:` and `changed-after:`, which read when a
 * recipe arrived and when it last changed. Plus the review queue's triage
 * order and the changed time a sweep's list is ordered by.
 *
 * Why a separate file: the five ranking files (vector-search.service.ts,
 * search-pipeline.ts, clustering.service.ts, mmr.ts, ranking-config.ts) may
 * never name a rating or the draft columns (ranking-isolation.test.ts, rubric
 * S3-M3). A rating qualifier is a selection the viewer asked for, not a
 * score, so it is built here and handed to those files as an opaque
 * predicate (`StructuredTraceFilters.selections`), the way the authz
 * module's `traceIdVisibleTo` reaches `hybridSearch`. A selection only
 * removes rows; with semantic text the pipeline's order is untouched
 * (S3-G7). The triage order applies only to the queue's qualifier-only
 * listing (services/draft-queue.service.ts), which never enters the
 * ranking pipeline.
 *
 * SECURITY (secure by default, recipe 446bac9f): the parser hands over
 * values from a closed vocabulary only (low | medium | high; the draft
 * qualifier is a boolean). Every value still binds as a parameter; the only
 * raw SQL is the table alias and the column name, both compile-time
 * constants chosen here.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { TRIAGE_WEIGHTS, UNRATED_TRIAGE_WEIGHT } from "@soupnet/domain";
import type { ParsedSearchQuery, RatingSelector } from "@soupnet/domain";
import { draftLiveAwaitingReviewBy, draftExpiredAwaitingReviewBy } from "../authz";
import type { TraceSelection } from "./vector-search.service";

type Alias = "t" | "tr";

const ALIASES: Readonly<Record<Alias, SQL>> = { t: sql.raw("t"), tr: sql.raw("tr") };
const RATING_COLUMNS = { impact: sql.raw("impact"), uncertainty: sql.raw("uncertainty") } as const;
type RatingColumn = keyof typeof RATING_COLUMNS;

function aliasSql(alias: Alias): SQL {
  if (alias !== "t" && alias !== "tr") throw new Error(`Unknown trace alias: ${String(alias)}`);
  return ALIASES[alias];
}

/**
 * `impact:high` keeps rows whose stored rating is high: an unrated row never
 * matches a positive qualifier (DT-QUE-03). `-impact:low` drops rows rated
 * low and keeps unrated ones.
 */
export function ratingSelection(column: RatingColumn, selector: RatingSelector): TraceSelection {
  const col = RATING_COLUMNS[column];
  return (alias) => {
    const a = aliasSql(alias);
    const parts: SQL[] = [];
    if (selector.equals !== undefined) parts.push(sql`${a}.${col} = ${selector.equals}`);
    if (selector.excluded.length > 0) {
      parts.push(sql`(${a}.${col} IS NULL OR ${a}.${col} NOT IN (${sql.join(selector.excluded.map((v) => sql`${v}`), sql`, `)}))`);
    }
    return parts.length > 0 ? sql.join(parts, sql` AND `) : sql`TRUE`;
  };
}

/**
 * `is:draft`: the viewer's own unresolved drafts that are still live, through
 * the module's one expression of that set (authz/draft-sql.ts; slice 10 left
 * expired ones out). `-is:draft`: everything else; `IS NOT TRUE` keeps rows
 * whose draft state is null (the fragment is NULL, not FALSE, for them).
 */
export function draftSelection(isDraft: boolean, viewerUserId: string): TraceSelection {
  return (alias) => (isDraft
    ? draftLiveAwaitingReviewBy(alias, viewerUserId)
    : sql`(${draftLiveAwaitingReviewBy(alias, viewerUserId)}) IS NOT TRUE`);
}

/** `is:expired` (slice 10, S10-X3): the viewer's unresolved drafts whose task went quiet. */
export function expiredSelection(viewerUserId: string): TraceSelection {
  return (alias) => draftExpiredAwaitingReviewBy(alias, viewerUserId);
}

/**
 * `intent:<id>` (slice 6a): the recipes whose stored intent link is this id.
 * The caller passes the id only once it is known to be one of the viewer's
 * own intents (`ownedIntentIds`); null selects nothing, which is the answer
 * for an unknown id and for someone else's alike. The id binds as a
 * parameter like every other value here.
 */
export function intentSelection(ownIntentId: string | null): TraceSelection {
  return (alias) => (ownIntentId === null ? sql`FALSE` : sql`${aliasSql(alias)}.intent_id = ${ownIntentId}`);
}

/**
 * When a recipe last changed (slice 8b, decision 6): the latest of its
 * deposit, `updated_at` (a draft's resolution and a move to another book
 * set it), its newest feedback row and its newest reaction, whoever wrote
 * them. A reader of the recipe already sees every feedback row and its date
 * on the recipe's page, so this discloses nothing new. GREATEST skips the
 * NULL of a recipe with no feedback or no reaction. Both subqueries use
 * their table's trace_id index.
 */
export function changedAtSql(alias: Alias): SQL {
  const a = aliasSql(alias);
  return sql`GREATEST(${a}.created_at, ${a}.updated_at,
    (SELECT max(cf.created_at) FROM claimnet.check_feedback cf WHERE cf.trace_id = ${a}.id),
    (SELECT max(rx.updated_at) FROM claimnet.trace_reactions rx WHERE rx.trace_id = ${a}.id))`;
}

/** `created-after:<t>` (slice 8b): deposited at or after t. */
export function createdAfterSelection(since: string): TraceSelection {
  return (alias) => sql`${aliasSql(alias)}.created_at >= ${since}::timestamptz`;
}

/** `changed-after:<t>` (slice 8b): changed at or after t (`changedAtSql`). */
export function changedAfterSelection(since: string): TraceSelection {
  return (alias) => sql`${changedAtSql(alias)} >= ${since}::timestamptz`;
}

/**
 * Every non-ranking selection a parsed query asks for, for this viewer.
 * `intentOwned` says whether the query's intent: id is one of the viewer's
 * intents, which the caller has looked up (this module does no I/O).
 */
export function searchSelections(parsed: ParsedSearchQuery, viewerUserId: string, intentOwned = false): TraceSelection[] {
  const out: TraceSelection[] = [];
  if (parsed.isExpired) out.push(expiredSelection(viewerUserId));
  else if (parsed.isDraft !== undefined) out.push(draftSelection(parsed.isDraft, viewerUserId));
  if (parsed.impact) out.push(ratingSelection("impact", parsed.impact));
  if (parsed.uncertainty) out.push(ratingSelection("uncertainty", parsed.uncertainty));
  if (parsed.intent !== undefined) out.push(intentSelection(intentOwned ? parsed.intent : null));
  if (parsed.createdAfter !== undefined) out.push(createdAfterSelection(parsed.createdAfter));
  if (parsed.changedAfter !== undefined) out.push(changedAfterSelection(parsed.changedAfter));
  return out;
}

function weightSql(a: SQL, column: RatingColumn): SQL {
  const col = RATING_COLUMNS[column];
  return sql`(CASE ${a}.${col} WHEN 'low' THEN ${TRIAGE_WEIGHTS.low}::int WHEN 'medium' THEN ${TRIAGE_WEIGHTS.medium}::int WHEN 'high' THEN ${TRIAGE_WEIGHTS.high}::int ELSE ${UNRATED_TRIAGE_WEIGHT}::int END)`;
}

/**
 * The review queue's order (rubric S3-O1): impact × uncertainty, unrated as
 * medium; then higher impact; then most recently deposited; then id. The SQL
 * twin of `compareForTriage` in @soupnet/domain (a Layer 3 test checks they
 * agree). Display only: used by the queue's qualifier-only listing alone.
 */
export function triageOrderSql(alias: Alias): SQL {
  const a = aliasSql(alias);
  return sql`${weightSql(a, "impact")} * ${weightSql(a, "uncertainty")} DESC, ${weightSql(a, "impact")} DESC, ${a}.created_at DESC, ${a}.id ASC`;
}
