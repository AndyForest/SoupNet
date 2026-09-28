/**
 * The review queue (drafts-and-triage slice 3): the signed-in person's list
 * of unresolved drafts about them, and the id-list link an agent hands them.
 * Served by GET /traces/drafts and GET /traces/drafts/count (JWT); the SPA
 * page is /app/drafts.
 *
 * The first piece of the planned human search page, not a second engine
 * (build log ruling 21, recipe d7319191): the query is the agents' search
 * grammar (@soupnet/domain parseSearchQuery), the drafts set is the authz
 * module's one expression of it (`draftAwaitingReviewBy`), the book scope is
 * the person's live memberships (`booksFor`), and semantic text runs through
 * the same search pipeline as agent search. Only two things are the queue's
 * own: `is:draft` is always applied, so the page narrows the queue but
 * cannot turn into a general search (S3-Q6); and a qualifier-only listing
 * is ordered for triage (impact × uncertainty, S3-O1), which never enters
 * the ranking pipeline (S3-M3).
 *
 * The id-list form (`?ids=a,b,…`, S3-L1 to S3-L4) lists exactly the named
 * recipes the person may read, in the order given, at most 20. Every id that
 * does not resolve to one readable recipe (unreadable, missing, malformed,
 * or an ambiguous prefix) is dropped into one count, so the response for a
 * collaborator's hidden draft and for a random UUID is the same (S3-L2).
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { parseSearchQuery, onlySubjectReviewsReason } from "@soupnet/domain";
import type { ParsedSearchQuery } from "@soupnet/domain";
import {
  booksFor,
  inBooks,
  traceVisibleTo,
  traceReadableById,
  draftAwaitingReviewBy,
  draftStateShownTo,
  onBehalfSideFor,
  onBehalfPartyFor,
  hasWriteAuthority,
  resolveReadableTraceRefs,
} from "../authz";
import type { TraceRef } from "../authz";
import { buildStructuredTracePredicates } from "./vector-search.service";
import { runSearchPipeline } from "./search-pipeline";
import { resolveStructuredFilters } from "./trace.service";
import { triageOrderSql } from "./search-selection";
import { isTraceIdPrefix, uuidPrefixRange } from "./feedback.service";
import { RECIPE_LOOKUP_MAX_IDS } from "./recipe-lookup.service";
import { draftQueueUrl } from "../lib/key-remediation";

/** Drafts per page of the queue. */
export const DRAFT_QUEUE_PAGE_SIZE = 20;
/** Highest page number served: past it the page is empty, and no page number
 *  can overflow the OFFSET (fix pass after the slice 3 verification). */
export const DRAFT_QUEUE_MAX_PAGE = 100_000;

const DRAFT_ITEM_STATES = ["unverified", "verified", "rejected", "not_chosen"] as const;
/** At most this many ids in a link: the /recipes batch size (S3-L1, S3-L4). */
export const DRAFT_QUEUE_MAX_IDS = RECIPE_LOOKUP_MAX_IDS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where a listed recipe stands. `verified` is shown only to the draft's own
 * person (`draftStateShownTo`); to anyone else a verified draft is an
 * ordinary recipe, `published` ([F83]).
 */
export type QueueItemState = "unverified" | "verified" | "rejected" | "not_chosen" | "published";

export interface DraftQueueItem {
  id: string;
  recipe: string;
  recipeBook: { id: string; name: string; slug: string };
  /** The depositing agent's triage ratings; null = not rated. */
  impact: string | null;
  uncertainty: string | null;
  /** When the draft was deposited. */
  depositedAt: string;
  /** The judgment date, when it differs from the deposit (a backfilled decision). */
  decidedAt: string | null;
  /** The label of the key whose agent deposited it, when that key belongs to
   *  the recipe's author (slice 4, open question 40). */
  keyLabel: string | null;
  /** Slice 4 (S4-Q2): on a draft about the viewer that someone else's agent
   *  deposited, that person's email; the ratings are their agent's. */
  depositedBy: string | null;
  /** Slice 4 (S4-Q5): on a draft the viewer's agent deposited about someone
   *  else, that person's email; only they can review it. */
  about: string | null;
  /** The first evidence entry's interpretation: why the agent couldn't ask
   *  and what would settle it, shown without opening the recipe (DT-QUE-05). */
  firstInterpretation: string | null;
  state: QueueItemState;
  /** The three actions are available: an unresolved draft whose book the
   *  person may write at this moment (S3-A4). */
  canResolve: boolean;
  /** Why an unresolved draft's actions are unavailable: the book the person
   *  cannot write, or (for its depositor) who alone can review it. */
  blockedReason?: string;
}

export type DraftQueueResult =
  | {
    ok: true;
    items: DraftQueueItem[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    /** "triage" for a qualifier-only listing, "similarity" with semantic text. */
    order: "triage" | "similarity";
  }
  | { ok: false; error: string };

export interface LinkedRecipesResult {
  items: DraftQueueItem[];
  /** How many ids in the link are not shown: one figure whatever the reason (S3-L2). */
  notShown: number;
  /** The link named more than DRAFT_QUEUE_MAX_IDS distinct ids; only the first are shown (S3-L4). */
  truncated: boolean;
}

/** The person's live books with their role in each: the queue's scope. */
async function scopeFor(db: PostgresJsDatabase, userId: string): Promise<{ bookIds: string[]; roleOf: Map<string, string> }> {
  const books = await booksFor(db, userId);
  return { bookIds: books.map((b) => b.id), roleOf: new Map(books.map((b) => [b.id, b.member_role])) };
}

/**
 * Parse the queue's search box with the agents' grammar and pin `is:draft`
 * on. `-is:draft` contradicts the page, so it is an error rather than a
 * silent override.
 */
export function parseQueueQuery(q: string | undefined): { ok: true; query: ParsedSearchQuery } | { ok: false; error: string } {
  const text = (q ?? "").trim();
  if (text === "") return { ok: true, query: forceDraft(parseOk("is:draft")) };
  const parsed = parseSearchQuery(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.query.isDraft === false) {
    return { ok: false, error: "the review queue always lists your unresolved drafts (is:draft); remove -is:draft" };
  }
  return { ok: true, query: forceDraft(parsed.query) };
}

function parseOk(text: string): ParsedSearchQuery {
  const r = parseSearchQuery(text);
  if (!r.ok) throw new Error(r.error);
  return r.query;
}

function forceDraft(query: ParsedSearchQuery): ParsedSearchQuery {
  return { ...query, isDraft: true };
}

/** The unresolved drafts about this person, in their live books: the dashboard's figure (S3-Q3). */
export async function countDraftsAwaitingReview(db: PostgresJsDatabase, userId: string): Promise<number> {
  const { bookIds } = await scopeFor(db, userId);
  if (bookIds.length === 0) return 0;
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n FROM claimnet.traces t
    WHERE ${inBooks(sql`t.group_id`, bookIds)}
      AND ${traceVisibleTo("t", { viewerUserId: userId })}
      AND ${draftAwaitingReviewBy("t", userId)}
  `);
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
}

/** One page of the queue. */
export async function listDraftQueue(
  db: PostgresJsDatabase,
  userId: string,
  params: { q?: string | undefined; page?: number | undefined },
): Promise<DraftQueueResult> {
  const parsed = parseQueueQuery(params.q);
  if (!parsed.ok) return parsed;
  const perPage = DRAFT_QUEUE_PAGE_SIZE;
  const requested = Math.floor(params.page ?? 1);
  const page = Number.isFinite(requested) ? Math.min(Math.max(1, requested), DRAFT_QUEUE_MAX_PAGE) : 1;
  const { bookIds, roleOf } = await scopeFor(db, userId);
  const structured = await resolveStructuredFilters(db, parsed.query, { callerUserId: userId, excludeOwnDefault: false });
  const semantic = parsed.query.semanticText.length > 0;

  if (bookIds.length === 0) {
    return { ok: true, items: [], total: 0, page, perPage, totalPages: 0, order: semantic ? "similarity" : "triage" };
  }

  let ids: string[];
  let total: number;
  if (semantic) {
    // Semantic text: the search pipeline's order (S3-O2), a flat list (no
    // clustering, MMR, or verbosity collapse: none of those levers is
    // passed, S3-Q5), paged by the pipeline with its honest total.
    const result = await runSearchPipeline({
      db,
      groupIds: bookIds,
      audience: { viewerUserId: userId },
      query: parsed.query.semanticText,
      structured,
      page,
      perPage,
    });
    ids = result.results.map((r) => r.id);
    total = result.totalResults;
  } else {
    // Qualifier-only: the triage order (S3-O1), total because it ends in the id.
    const where = sql`${inBooks(sql`t.group_id`, bookIds)}
      AND ${traceVisibleTo("t", { viewerUserId: userId })}
      AND ${draftAwaitingReviewBy("t", userId)}
      ${buildStructuredTracePredicates(structured, "t")}`;
    const countRows = await db.execute(sql`
      SELECT count(*)::int AS n FROM claimnet.traces t WHERE ${where}
    `);
    total = Number((countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
    const rows = await db.execute(sql`
      SELECT t.id FROM claimnet.traces t WHERE ${where}
      ORDER BY ${triageOrderSql("t")}
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
    `);
    ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
  }

  const items = await loadItems(db, userId, ids, roleOf);
  return {
    ok: true,
    items,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
    order: semantic ? "similarity" : "triage",
  };
}

/** Split a link's `ids` value into distinct references, in order. */
export function parseIdList(raw: string): { refs: Array<{ text: string; ref: TraceRef | null }>; truncated: boolean } {
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const text = part.trim().toLowerCase();
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    distinct.push(text);
  }
  const truncated = distinct.length > DRAFT_QUEUE_MAX_IDS;
  const refs = distinct.slice(0, DRAFT_QUEUE_MAX_IDS).map((text) => {
    if (UUID_RE.test(text)) return { text, ref: { kind: "id" as const, id: text } };
    if (isTraceIdPrefix(text)) return { text, ref: { kind: "range" as const, ...uuidPrefixRange(text) } };
    return { text, ref: null };
  });
  return { refs, truncated };
}

/** The recipes a link names that this person may read, in the link's order. */
export async function listLinkedRecipes(
  db: PostgresJsDatabase,
  userId: string,
  rawIds: string,
): Promise<LinkedRecipesResult> {
  const { refs, truncated } = parseIdList(rawIds);
  const valid = refs.filter((r): r is { text: string; ref: TraceRef } => r.ref !== null);
  const resolved = await resolveReadableTraceRefs(db, userId, valid.map((r) => r.ref));
  // A prefix and a full id can name the same recipe: show it once.
  const ids = [...new Set(resolved.filter((id): id is string => id !== null))];
  const { roleOf } = await scopeFor(db, userId);
  const items = await loadItems(db, userId, ids, roleOf);
  // Not shown: every reference that did not lead to a shown recipe (a
  // malformed one included). Two references to one shown recipe are both shown.
  const shown = new Set(items.map((i) => i.id));
  const notShown = refs.length - valid.filter((_, i) => resolved[i] !== null && shown.has(resolved[i]!)).length;
  return { items, notShown, truncated };
}

/**
 * What the queue shows for each id, in the order given. Callers pass ids
 * the person may read (the listing's own statement, or
 * `resolveReadableTraceRefs`); the by-id rule is applied here again so a
 * caller mistake cannot widen what is shown.
 */
async function loadItems(
  db: PostgresJsDatabase,
  userId: string,
  ids: readonly string[],
  roleOf: Map<string, string>,
): Promise<DraftQueueItem[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT
      t.id,
      t.claim_text AS "recipe",
      t.group_id AS "bookId",
      g.name AS "bookName",
      g.slug AS "bookSlug",
      t.impact,
      t.uncertainty,
      t.created_at AS "depositedAt",
      t.decided_at AS "decidedAt",
      (CASE WHEN ak.user_id = t.user_id THEN ak.label ELSE NULL END) AS "keyLabel",
      ${draftStateShownTo("t", userId)} AS "draftState",
      ${onBehalfSideFor("t", userId)} AS "onBehalfSide",
      ou.email AS "onBehalfEmail",
      (SELECT e.content FROM claimnet.trace_evidence te
         JOIN claimnet.evidence e ON e.id = te.evidence_id
        WHERE te.trace_id = t.id
        ORDER BY e.created_at ASC, e.id ASC
        LIMIT 1) AS "firstInterpretation"
    FROM claimnet.traces t
    JOIN claimnet.groups g ON g.id = t.group_id
    LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
    LEFT JOIN claimnet.users ou ON ou.id = ${onBehalfPartyFor("t", userId)}
    WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      AND ${traceReadableById("t", userId)}
  `);
  type Row = {
    id: string; recipe: string; bookId: string; bookName: string; bookSlug: string;
    impact: string | null; uncertainty: string | null; depositedAt: string | Date; decidedAt: string | Date | null;
    keyLabel: string | null; draftState: string | null; firstInterpretation: string | null;
    onBehalfSide: string | null; onBehalfEmail: string | null;
  };
  const byId = new Map((rows as unknown as Row[]).map((r) => [r.id, r]));
  const iso = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString());
  const out: DraftQueueItem[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    // The state as draftStateShownTo gave it: a draft state for the draft's
    // own person, NULL (published) for everyone else.
    const state: QueueItemState = (DRAFT_ITEM_STATES as readonly string[]).includes(r.draftState ?? "")
      ? (r.draftState as QueueItemState)
      : "published";
    const writable = hasWriteAuthority({ kind: "member", role: roleOf.get(r.bookId) ?? null }, r.bookId);
    const depositedBy = r.onBehalfSide === "depositedBy" ? r.onBehalfEmail : null;
    const about = r.onBehalfSide === "about" ? r.onBehalfEmail : null;
    // The depositor of a draft about someone else reads it but never
    // resolves it (slice 4, S4-Q5): only its subject does.
    const isDepositorOnly = r.onBehalfSide === "about";
    const canResolve = state === "unverified" && writable && !isDepositorOnly;
    out.push({
      id: r.id,
      recipe: r.recipe,
      recipeBook: { id: r.bookId, name: r.bookName, slug: r.bookSlug },
      impact: r.impact,
      uncertainty: r.uncertainty,
      depositedAt: iso(r.depositedAt) ?? "",
      decidedAt: iso(r.decidedAt),
      keyLabel: r.keyLabel,
      depositedBy,
      about,
      firstInterpretation: r.firstInterpretation,
      state,
      canResolve,
      ...(state === "unverified" && isDepositorOnly
        ? { blockedReason: onlySubjectReviewsReason(about, draftQueueUrl([r.id])) }
        : state === "unverified" && !writable
          ? { blockedReason: needsWriteAccessReason(r.bookName) }
          : {}),
    });
  }
  return out;
}

/** The honest refusal for the draft's own person (build log ruling 25). */
export function needsWriteAccessReason(bookName: string): string {
  return `Confirming, rejecting, or marking this draft not chosen needs write access to this recipe book ("${bookName}"), which you do not have.`;
}
