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
import { mayReadTrace, isPublishedDraftState } from "./roles";
import type { BookRole } from "./roles";
import { membershipOf } from "./membership-sql";
import { subjectOf, depositorOf } from "./draft-sql";

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
  /** The recipe's draft state; null when it was never a draft. */
  draftState: string | null;
  /** The viewer is the person the draft is about (slice 2: its author). */
  isDraftSubject: boolean;
  /** The viewer is the person whose agent deposited it (always its author). */
  isDraftDepositor: boolean;
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
  /** Triage ratings (slice 1): the depositing agent's, null = not rated. */
  impact: string | null;
  uncertainty: string | null;
  /** Draft state (slice 2); null when the recipe was never a draft. Readable
   *  here only by someone `mayReadTrace` admits, so an unpublished state
   *  reaches only the draft's own people. */
  draftState: string | null;
  /** When and by whom the draft was resolved; the key is null when the
   *  person resolved it themselves, and equals `apiKeyId` when the key that
   *  deposited the draft also verified it. */
  draftResolvedAt: string | null;
  draftResolvedByKeyId: string | null;
  draftResolvedByEmail: string | null;
  /** The viewer is the one who resolved the draft (the "by you" label). */
  draftResolvedByViewer: boolean;
}

export interface ReadableTrace {
  access: TraceAccess;
  trace: TraceDetail;
}

/** How the statement finds its trace: by the trace's id, or by a feedback row about it. */
type Locator = { traceId: string } | { feedbackId: string };

type Row = Partial<TraceAccess> & Partial<Omit<TraceDetail, "id" | "claimText" | "userId" | "groupId">> & {
  draftResolvedByUserId?: string | null;
};

const DETAIL_COLUMNS: SQL = sql`,
      t.api_key_id AS "apiKeyId",
      t.format_adherence_score AS "formatAdherenceScore",
      t.decided_at AS "decidedAt",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      g.name AS "groupName",
      ak.label AS "apiKeyLabel",
      u.email AS "userEmail",
      t.impact AS "impact",
      t.uncertainty AS "uncertainty",
      t.draft_resolved_at AS "draftResolvedAt",
      t.draft_resolved_by_key_id AS "draftResolvedByKeyId",
      ru.email AS "draftResolvedByEmail",
      t.draft_resolved_by_user_id AS "draftResolvedByUserId"`;

const DETAIL_JOINS: SQL = sql`
    LEFT JOIN claimnet.groups g ON g.id = t.group_id
    LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
    LEFT JOIN claimnet.users u ON u.id = t.user_id
    LEFT JOIN claimnet.users ru ON ru.id = t.draft_resolved_by_user_id`;

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
      gm.role AS "role",
      t.draft_state AS "draftState",
      (${subjectOf("t")} = ${userId}::uuid) AS "isDraftSubject",
      (${depositorOf("t")} = ${userId}::uuid) AS "isDraftDepositor"${withDetail ? DETAIL_COLUMNS : sql``}
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
    draftState: row.draftState ?? null,
    isDraftSubject: row.isDraftSubject === true,
    isDraftDepositor: row.isDraftDepositor === true,
  };
}

/**
 * The viewer's standing on a trace, or null when the trace does not exist —
 * or is an unpublished draft this viewer may not manage. Move and delete of a
 * draft belong to the person it is about alone (build log open question 11,
 * DT-VIS-15): for anyone else, a book owner or a system user included, the
 * draft is the same null, and the route's uniform 404, as a missing id.
 *
 * Returns facts for a viewer with NO access to a published recipe as well —
 * move and delete need to tell "not yours" from "not there" there, and a
 * system user acts without a membership. Callers that only need "may they
 * read it" use `canReadTrace` or `readableTraceFor`, which apply the rule.
 */
export async function roleInBookOfTrace(
  db: PostgresJsDatabase,
  userId: string,
  traceId: string,
): Promise<TraceAccess | null> {
  const row = await fetchAccess(db, userId, { traceId }, false);
  if (!row) return null;
  const access = toAccess(row);
  if (!isPublishedDraftState(access.draftState) && !access.isDraftSubject) return null;
  return access;
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
      impact: row.impact ?? null,
      uncertainty: row.uncertainty ?? null,
      // Draft state and verification details are the draft subject's alone
      // ([F83]): to anyone else a verified draft is an ordinary recipe, with
      // no state, verifier, key, or dates.
      ...(access.isDraftSubject
        ? {
          draftState: access.draftState,
          draftResolvedAt: row.draftResolvedAt ?? null,
          draftResolvedByKeyId: row.draftResolvedByKeyId ?? null,
          draftResolvedByEmail: row.draftResolvedByEmail ?? null,
          draftResolvedByViewer: (row.draftResolvedByUserId ?? null) === userId,
        }
        : {
          draftState: null,
          draftResolvedAt: null,
          draftResolvedByKeyId: null,
          draftResolvedByEmail: null,
          draftResolvedByViewer: false,
        }),
    },
  };
}

/**
 * Which of these recipe ids may this user read? ([F82]) One statement fetches
 * the facts for every id, and `mayReadTrace` decides each one in JS, so ids a
 * viewer may not read (a collaborator's hidden draft, someone else's book, an
 * id that never existed) drop out, indistinguishably. Returns the readable
 * ids in input order, without duplicates. Used to render stored id lists that
 * were captured unchecked, such as feedback lineage (`related_trace_ids`).
 */
export async function readableTraceIds(
  db: PostgresJsDatabase,
  userId: string,
  traceIds: readonly string[],
): Promise<string[]> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set(traceIds.filter((id) => uuid.test(id)).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT
      t.id AS "traceId",
      (t.user_id = ${userId}::uuid) AS "isAuthor",
      gm.role AS "role",
      t.draft_state AS "draftState",
      (${subjectOf("t")} = ${userId}::uuid) AS "isDraftSubject",
      (${depositorOf("t")} = ${userId}::uuid) AS "isDraftDepositor"
    FROM claimnet.traces t
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND ${membershipOf("gm", userId)}
    WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  const readable = new Set(
    (rows as unknown as Row[]).map(toAccess).filter((a) => mayReadTrace(a)).map((a) => a.traceId.toLowerCase()),
  );
  return ids.filter((id) => readable.has(id));
}

/** One reference to a recipe in a link a person opens: a full id, or the
 *  inclusive UUID range of a short-id prefix (a primary-key range scan). */
export type TraceRef = { kind: "id"; id: string } | { kind: "range"; lo: string; hi: string };

/**
 * Resolve recipe references for a signed-in person (drafts-and-triage slice
 * 3: the review queue's `?ids=` link). Each reference resolves to the full
 * id of the ONE recipe it names that this person may read, or null: a
 * missing id, an unreadable one (a collaborator's hidden draft, a book the
 * person is not in), and a prefix that matches no readable recipe or more
 * than one are the same null, so the link is never an existence oracle
 * (recipe 507d3c9c: prefixes resolve within the viewer's readable scope
 * only). The rule is `mayReadTrace`, applied in JS to facts fetched in one
 * statement per reference, the pattern of `readableTraceIds`.
 */
const REF_CANDIDATES_MAX = 50;

export async function resolveReadableTraceRefs(
  db: PostgresJsDatabase,
  userId: string,
  refs: readonly TraceRef[],
): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (const ref of refs) {
    const where = ref.kind === "id"
      ? sql`t.id = ${ref.id}::uuid`
      : sql`t.id >= ${ref.lo}::uuid AND t.id <= ${ref.hi}::uuid`;
    // The facts for every row the reference names (a full id names one; an
    // 8-character prefix names about one in four billion ids), decided in JS
    // by the one rule. The bound keeps a crowded prefix range cheap; past it
    // the reference is not resolved, which reads as "not shown".
    const rows = await db.execute(sql`
      SELECT
        t.id AS "traceId",
        (t.user_id = ${userId}::uuid) AS "isAuthor",
        gm.role AS "role",
        t.draft_state AS "draftState",
        (${subjectOf("t")} = ${userId}::uuid) AS "isDraftSubject",
        (${depositorOf("t")} = ${userId}::uuid) AS "isDraftDepositor"
      FROM claimnet.traces t
      LEFT JOIN claimnet.group_members gm
        ON gm.group_id = t.group_id AND ${membershipOf("gm", userId)}
      WHERE ${where}
      LIMIT ${REF_CANDIDATES_MAX}
    `);
    const readable = (rows as unknown as Row[]).map(toAccess).filter((a) => mayReadTrace(a));
    out.push(readable.length === 1 ? readable[0]!.traceId : null);
  }
  return out;
}
