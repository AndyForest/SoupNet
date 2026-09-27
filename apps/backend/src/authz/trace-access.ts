/**
 * A viewer's access to one recipe, answered in ONE statement: does the trace
 * exist, did this user write it, which book is it in, and what role does the
 * user hold in that book.
 *
 * One statement rather than "fetch the trace, then look the role up": the
 * facts a route authorizes on and the row it goes on to use are read together,
 * so they describe the same trace in the same book at the same moment, and a
 * request costs one round trip instead of two.
 *
 * The statement reports facts. It does not decide. The read rule is
 * `mayReadTrace` (roles.ts) and is applied here in JS, in one place, by every
 * function that answers "may they read it" — there is no SQL copy of the rule
 * to keep in step with it.
 *
 * Posture as in book-access.ts: fail closed, `userId` from the verified JWT,
 * no caching, bound parameters only.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mayReadTrace } from "./roles";
import type { BookRole } from "./roles";
import { membershipOf } from "./membership-sql";

/** The facts about one viewer and one trace. */
export interface TraceAccess {
  traceId: string;
  /** The book the trace was in when the facts were read. */
  bookId: string;
  authorId: string;
  claimText: string;
  /** The viewer wrote this recipe. */
  isAuthor: boolean;
  /** The viewer's role in the trace's book, or null without a membership. */
  role: BookRole;
}

/** The trace columns GET /traces/:id returns. Column names are its wire shape. */
export interface TraceDetail {
  id: string;
  claimText: string;
  userId: string;
  groupId: string;
  apiKeyId: string | null;
  formatAdherenceScore: number | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  groupName: string | null;
  apiKeyLabel: string | null;
  userEmail: string | null;
}

export interface ReadableTrace {
  access: TraceAccess;
  trace: TraceDetail;
}

/** How the statement finds its trace: by the trace's id, or by a feedback row about it. */
type Locator = { traceId: string } | { feedbackId: string };

type Row = Partial<TraceAccess> & Partial<Omit<TraceDetail, "id" | "claimText" | "userId" | "groupId">>;

const DETAIL_COLUMNS: SQL = sql`,
      t.api_key_id AS "apiKeyId",
      t.format_adherence_score AS "formatAdherenceScore",
      t.decided_at AS "decidedAt",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      g.name AS "groupName",
      ak.label AS "apiKeyLabel",
      u.email AS "userEmail"`;

const DETAIL_JOINS: SQL = sql`
    LEFT JOIN claimnet.groups g ON g.id = t.group_id
    LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
    LEFT JOIN claimnet.users u ON u.id = t.user_id`;

/**
 * The one statement. `(group_id, user_id)` is unique on the membership table,
 * so the LEFT JOIN yields at most one row per trace: the viewer's membership
 * in the trace's book, or NULLs.
 */
async function fetchAccess(
  db: PostgresJsDatabase,
  userId: string,
  locator: Locator,
  withDetail: boolean,
): Promise<Row | null> {
  // A feedback row about a search has no trace; the inner join drops it, which
  // is the same "nothing here" as a feedback id that does not exist.
  const from =
    "traceId" in locator
      ? sql`FROM claimnet.traces t`
      : sql`FROM claimnet.check_feedback cf JOIN claimnet.traces t ON t.id = cf.trace_id`;
  const where =
    "traceId" in locator
      ? sql`WHERE t.id = ${locator.traceId}::uuid`
      : sql`WHERE cf.id = ${locator.feedbackId}::uuid`;

  const rows = await db.execute(sql`
    SELECT
      t.id AS "traceId",
      t.group_id AS "bookId",
      t.user_id AS "authorId",
      t.claim_text AS "claimText",
      (t.user_id = ${userId}::uuid) AS "isAuthor",
      gm.role AS "role"${withDetail ? DETAIL_COLUMNS : sql``}
    ${from}
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND ${membershipOf("gm", userId)}${withDetail ? DETAIL_JOINS : sql``}
    ${where}
  `);
  return (rows as unknown as Row[])[0] ?? null;
}

function toAccess(row: Row): TraceAccess {
  return {
    traceId: row.traceId ?? "",
    bookId: row.bookId ?? "",
    authorId: row.authorId ?? "",
    claimText: row.claimText ?? "",
    // Strictly `true`: anything else the driver might hand back is "not the author".
    isAuthor: row.isAuthor === true,
    role: row.role ?? null,
  };
}

/**
 * The viewer's standing on a trace, or null when the trace does not exist.
 *
 * Returns facts for a viewer with NO access as well — move and delete need to
 * tell "not yours" from "not there", and a system user acts without a
 * membership. Callers that only need "may they read it" use `canReadTrace` or
 * `readableTraceFor`, which apply the rule for them.
 */
export async function roleInBookOfTrace(
  db: PostgresJsDatabase,
  userId: string,
  traceId: string,
): Promise<TraceAccess | null> {
  const row = await fetchAccess(db, userId, { traceId }, false);
  return row ? toAccess(row) : null;
}

/**
 * May this user read this recipe? True when they wrote it or are a member of
 * the book it lives in. A missing trace is `false`, the same answer as an
 * unreadable one, so callers can return one uniform 404.
 */
export async function canReadTrace(
  db: PostgresJsDatabase,
  traceId: string,
  userId: string,
): Promise<boolean> {
  const row = await fetchAccess(db, userId, { traceId }, false);
  return row !== null && mayReadTrace(toAccess(row));
}

/**
 * May this user read the recipe a feedback row is about? A feedback id that
 * does not exist, a feedback row with no trace (feedback about a search), and
 * an unreadable trace are all `false`.
 */
export async function canReadTraceOfFeedback(
  db: PostgresJsDatabase,
  feedbackId: string,
  userId: string,
): Promise<boolean> {
  const row = await fetchAccess(db, userId, { feedbackId }, false);
  return row !== null && mayReadTrace(toAccess(row));
}

/**
 * The trace's detail row together with the viewer's facts — or null when the
 * trace does not exist OR the viewer may not read it. The two are one answer
 * by construction, so a handler cannot return the row to someone who fails
 * the read rule, and cannot tell them the trace exists.
 */
export async function readableTraceFor(
  db: PostgresJsDatabase,
  userId: string,
  traceId: string,
): Promise<ReadableTrace | null> {
  const row = await fetchAccess(db, userId, { traceId }, true);
  if (!row) return null;
  const access = toAccess(row);
  if (!mayReadTrace(access)) return null;
  return {
    access,
    trace: {
      id: access.traceId,
      claimText: access.claimText,
      userId: access.authorId,
      groupId: access.bookId,
      apiKeyId: row.apiKeyId ?? null,
      formatAdherenceScore: row.formatAdherenceScore ?? null,
      decidedAt: row.decidedAt ?? null,
      createdAt: row.createdAt ?? "",
      updatedAt: row.updatedAt ?? "",
      groupName: row.groupName ?? null,
      apiKeyLabel: row.apiKeyLabel ?? null,
      userEmail: row.userEmail ?? null,
    },
  };
}
