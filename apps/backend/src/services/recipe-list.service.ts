/**
 * The flat list (drafts-and-triage slice 8b, items 1 and 2): what a
 * qualifier-only search returns on the agent search surfaces.
 *
 * With no semantic text there is nothing to cluster on, and an unattended
 * sweep needs every id that arrived or moved since it last looked, not the
 * 200 newest folded into exemplars. So a qualifier-only search lists every
 * match, 50 to a page, in an order that ends in the id so paging is total:
 * newest judgment date first; the review queue's triage order for
 * `is:draft` and `is:expired` (without the queue's intent grouping, which is
 * the person's page); latest change first with `changed-after:`.
 *
 * Outside the ranking files, like every selection (ranking-isolation.test.ts):
 * the order and the changed time are display, never a relevance signal. The
 * listing composes the authz module's fragments (`inBooks`, `traceVisibleTo`)
 * so rows and the total share one draft condition (RP-03, S8b-L4), and the
 * structured predicates are the same ones every search applies.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ParsedSearchQuery } from "@soupnet/domain";
import { inBooks, traceVisibleTo } from "../authz";
import type { DraftAudience } from "../authz";
import { buildStructuredTracePredicates } from "./vector-search.service";
import type { StructuredTraceFilters } from "./vector-search.service";
import { triageOrderSql, changedAtSql } from "./search-selection";

/** Rows per page of the flat list: fixed, so the tool roster takes no size parameter (recipe ded7f5ed). */
export const FLAT_LIST_PAGE_SIZE = 50;

export type FlatListOrder = "judgment" | "triage" | "changed";

/** The order a parsed qualifier-only query lists in (rubric decision 3). */
export function flatListOrderFor(query: ParsedSearchQuery): FlatListOrder {
  if (query.changedAfter !== undefined) return "changed";
  if (query.isDraft === true || query.isExpired === true) return "triage";
  return "judgment";
}

export interface FlatListRow {
  id: string;
  claimText: string;
  /** The judgment date: decided_at, or the deposit time when unset. */
  judgedAt: Date;
  depositedAt: Date;
  /** The latest of the deposit, a resolution or move, and the newest feedback row or reaction. */
  changedAt: Date;
}

export interface FlatListPage {
  rows: FlatListRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  order: FlatListOrder;
}

function orderSql(order: FlatListOrder): SQL {
  switch (order) {
    case "triage": return triageOrderSql("t");
    case "changed": return sql`${changedAtSql("t")} DESC, t.id ASC`;
    case "judgment": return sql`COALESCE(t.decided_at, t.created_at) DESC, t.id ASC`;
  }
}

/**
 * Normalize a requested page: floored, at least 1, and page 1 for anything
 * unusable (/check reads `page` leniently). How deep a page may reach is
 * the caller's check against the listing depth (`pageBeyondReach`, F110),
 * made before this listing runs.
 */
export function clampFlatListPage(requested: number | undefined): number {
  const n = Math.floor(requested ?? 1);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/** One page of the flat list over books the caller already validated. */
export async function listRecipesFlat(
  db: PostgresJsDatabase,
  params: {
    groupIds: string[];
    audience: DraftAudience;
    structured: StructuredTraceFilters;
    order: FlatListOrder;
    page?: number | undefined;
  },
): Promise<FlatListPage> {
  const page = clampFlatListPage(params.page);
  const perPage = FLAT_LIST_PAGE_SIZE;
  if (params.groupIds.length === 0) {
    return { rows: [], total: 0, page, perPage, totalPages: 0, order: params.order };
  }
  const where = sql`${inBooks(sql`t.group_id`, params.groupIds)}
      AND ${traceVisibleTo("t", params.audience)}
      ${buildStructuredTracePredicates(params.structured, "t")}`;
  const countRows = await db.execute(sql`
    SELECT count(*)::int AS n FROM claimnet.traces t WHERE ${where}
  `);
  const total = Number((countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  const rows = await db.execute(sql`
    SELECT t.id, t.claim_text AS "claimText",
           COALESCE(t.decided_at, t.created_at) AS "judgedAt",
           t.created_at AS "depositedAt",
           ${changedAtSql("t")} AS "changedAt"
    FROM claimnet.traces t
    WHERE ${where}
    ORDER BY ${orderSql(params.order)}
    LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
  `);
  const asDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));
  type Row = { id: string; claimText: string; judgedAt: string | Date; depositedAt: string | Date; changedAt: string | Date };
  return {
    rows: (rows as unknown as Row[]).map((r) => ({
      id: r.id,
      claimText: r.claimText,
      judgedAt: asDate(r.judgedAt),
      depositedAt: asDate(r.depositedAt),
      changedAt: asDate(r.changedAt),
    })),
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
    order: params.order,
  };
}
