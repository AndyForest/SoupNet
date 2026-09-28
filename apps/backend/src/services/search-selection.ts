/**
 * The search grammar's selections that are not ranking inputs
 * (drafts-and-triage slice 3): `is:draft` / `-is:draft`, and `impact:` /
 * `uncertainty:` over the stored triage ratings. Plus the review queue's
 * triage order.
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
import { draftAwaitingReviewBy } from "../authz";
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
 * `is:draft`: the viewer's own unresolved drafts, through the module's one
 * expression of that set (authz/draft-sql.ts). `-is:draft`: everything else;
 * `IS NOT TRUE` keeps rows whose draft state is null (the fragment is NULL,
 * not FALSE, for them).
 */
export function draftSelection(isDraft: boolean, viewerUserId: string): TraceSelection {
  return (alias) => (isDraft
    ? draftAwaitingReviewBy(alias, viewerUserId)
    : sql`(${draftAwaitingReviewBy(alias, viewerUserId)}) IS NOT TRUE`);
}

/** Every non-ranking selection a parsed query asks for, for this viewer. */
export function searchSelections(parsed: ParsedSearchQuery, viewerUserId: string): TraceSelection[] {
  const out: TraceSelection[] = [];
  if (parsed.isDraft !== undefined) out.push(draftSelection(parsed.isDraft, viewerUserId));
  if (parsed.impact) out.push(ratingSelection("impact", parsed.impact));
  if (parsed.uncertainty) out.push(ratingSelection("uncertainty", parsed.uncertainty));
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
