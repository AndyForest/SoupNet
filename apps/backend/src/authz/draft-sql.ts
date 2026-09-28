/**
 * The draft visibility condition, written once (drafts-and-triage slice 2).
 *
 * The rule (docs/planning/drafts-and-triage.md, "The model"): until verified,
 * a draft is visible only to the person it is about and their agents, and to
 * the person whose agent deposited it. It appears on no shared surface — not
 * in results, counts, clusters, exemplars, the map, or book statistics —
 * except that a person's own agents see their own unverified drafts in their
 * results, labelled. Everywhere else a hidden draft is indistinguishable from
 * a recipe that does not exist.
 *
 * Two expressions of the one rule, both in this module:
 *   - `mayReadTrace` (roles.ts) — single-recipe reads, applied in JS to facts
 *     fetched in one statement (trace-access.ts);
 *   - the fragments below — every set-returning statement. draft-sql.test.ts
 *     checks the two agree on every combination of facts, and fails when any
 *     backend file outside this one writes the condition by hand.
 *
 * Three audiences, one per kind of surface:
 *   - `traceVisibleTo(alias, SHARED_AUDIENCE)` — aggregates and shared views
 *     (book statistics, briefing exemplars, the map): published recipes only,
 *     for every viewer, the person included.
 *   - `traceVisibleTo(alias, { viewerUserId })` — a viewer's result sets
 *     (check and search results, their counts and clusters): published
 *     recipes plus the viewer's own UNVERIFIED drafts. A rejected or
 *     not-chosen draft leaves the person's results too.
 *   - `traceReadableById(alias, viewerUserId)` — by-id reads (lookup, feedback
 *     targets, prefix scans): published recipes plus the viewer's own drafts
 *     in any state, so the person can still open a resolved one.
 *
 * "The viewer's own" means the viewer is the draft's subject (who it is about)
 * or its depositor (whose agent deposited it). In slice 2 both are the author,
 * `user_id`: a draft is always about the key's own user (on-behalf-of is slice
 * 4, and the operator ruled that `user_id` stays the depositing key's owner —
 * recipe 9e663b62 — so slice 4 changes `subjectOf` here and nothing else).
 *
 * Every fragment composes with the caller's book scope (`inBooks`); a draft
 * never widens a key's scope, because the book condition is ANDed separately.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { inBooks } from "./scope-sql";

/**
 * The aliases the fragments may be applied to: `t` and `tr` for statements
 * that read `claimnet.traces`, and `dv`, the alias the id-keyed form gives
 * its own lookup. A closed set, so only these constants reach `sql.raw`.
 */
const ALIASES = {
  t: sql.raw("t"),
  tr: sql.raw("tr"),
  dv: sql.raw("dv"),
} as const;

export type TraceAlias = keyof typeof ALIASES;

function aliasSql(alias: TraceAlias): SQL {
  if (!Object.prototype.hasOwnProperty.call(ALIASES, alias)) {
    throw new Error(`Unknown trace alias: ${String(alias)}`);
  }
  return ALIASES[alias];
}

/** Who a result set is for. */
export type DraftAudience = { viewerUserId: string } | typeof SHARED_AUDIENCE;

/** Shared surfaces: published recipes only, for every viewer. */
export const SHARED_AUDIENCE = Object.freeze({ shared: true as const });

/** The type of the shared audience alone: a viewer audience is not assignable. */
export type SharedAudience = typeof SHARED_AUDIENCE;

/** Runtime check that an audience is the shared one (for values that crossed an `unknown` or a cast). */
export function isSharedAudience(audience: unknown): audience is SharedAudience {
  return typeof audience === "object" && audience !== null && (audience as { shared?: unknown }).shared === true
    && !("viewerUserId" in audience);
}

function isShared(audience: DraftAudience): audience is typeof SHARED_AUDIENCE {
  return "shared" in audience;
}

// ── The facts ───────────────────────────────────────────────────────────────
//
// Internal to the module (not re-exported from index.ts): trace-access.ts
// selects the same two columns to hand `mayReadTrace` its facts.

/** The column naming who a draft is about. Slice 2: the author. */
export function subjectOf(alias: TraceAlias): SQL {
  return sql`${aliasSql(alias)}.user_id`;
}

/** The column naming whose agent deposited a draft: always the author (ruling 9e663b62). */
export function depositorOf(alias: TraceAlias): SQL {
  return sql`${aliasSql(alias)}.user_id`;
}

function ownDraft(alias: TraceAlias, viewerUserId: string): SQL {
  // In slice 2 the two columns are the same one, so this reads
  // `(t.user_id = $1 OR t.user_id = $2)`; the planner folds the duplicate.
  return sql`(${subjectOf(alias)} = ${viewerUserId}::uuid OR ${depositorOf(alias)} = ${viewerUserId}::uuid)`;
}

// ── The fragments ───────────────────────────────────────────────────────────

/** An ordinary recipe, or a draft its person verified. */
export function publishedTrace(alias: TraceAlias): SQL {
  const a = aliasSql(alias);
  return sql`(${a}.draft_state IS NULL OR ${a}.draft_state = 'verified')`;
}

/** The row belongs in this audience's result sets (see the header). */
export function traceVisibleTo(alias: TraceAlias, audience: DraftAudience): SQL {
  if (isShared(audience)) return publishedTrace(alias);
  const a = aliasSql(alias);
  return sql`(${publishedTrace(alias)} OR (${a}.draft_state = 'unverified' AND ${ownDraft(alias, audience.viewerUserId)}))`;
}

/** The row may be read by id by this viewer (see the header). */
export function traceReadableById(alias: TraceAlias, viewerUserId: string): SQL {
  return sql`(${publishedTrace(alias)} OR ${ownDraft(alias, viewerUserId)})`;
}

/**
 * The whole read rule for a signed-in person, in SQL: the SQL form of
 * `mayReadTrace` (roles.ts) for a viewer whose live books are `memberBookIds`.
 * A published recipe: its author, or a member of its book. An unpublished
 * draft: its subject or depositor, whatever their membership.
 *
 * For a statement that must decide readability before it limits rows, so a
 * row the viewer cannot read never takes a slot (the review queue's id-list
 * prefixes, [F85]; the house LIMIT 2 ambiguity pattern, recipe b1b747d5).
 * draft-sql.test.ts proves it equals `mayReadTrace` on every combination.
 */
export function traceReadableByPerson(alias: TraceAlias, viewerUserId: string, memberBookIds: readonly string[]): SQL {
  const a = aliasSql(alias);
  return sql`((${publishedTrace(alias)} AND (${a}.user_id = ${viewerUserId}::uuid OR ${inBooks(sql`${a}.group_id`, memberBookIds)}))
    OR (NOT ${publishedTrace(alias)} AND ${ownDraft(alias, viewerUserId)}))`;
}

/**
 * The row's draft state as this viewer may see it ([F83]): the state for the
 * person the draft is about, NULL for everyone else, so a verified draft is
 * an ordinary recipe on shared surfaces and nobody else learns it was one.
 * (Others never receive an unpublished draft's row at all.)
 */
export function draftStateShownTo(alias: TraceAlias, viewerUserId: string): SQL {
  const a = aliasSql(alias);
  return sql`(CASE WHEN ${subjectOf(alias)} = ${viewerUserId}::uuid THEN ${a}.draft_state ELSE NULL END)`;
}

/**
 * An unverified draft about this person — the ones awaiting their review.
 * Counted for the person's own agents only (the briefing's Drafts line,
 * DT-VIS-09); every shared figure uses `publishedTrace` instead.
 */
export function draftAwaitingReviewBy(alias: TraceAlias, personUserId: string): SQL {
  const a = aliasSql(alias);
  return sql`(${a}.draft_state = 'unverified' AND ${subjectOf(alias)} = ${personUserId}::uuid)`;
}

/**
 * `traceVisibleTo` for a statement whose rows carry only a trace id — vector
 * search runs over `embedding_sources`, whose `source_id` is the trace's id.
 * The draft state is read from `claimnet.traces` itself, never from a copy on
 * the embedding rows: a copy would be a second hand-synchronized
 * denormalization beside `embedding_sources.group_id` (S2-M4).
 *
 * `idColumn` is SQL the calling statement writes itself (for example
 * sql`es.source_id`), never request input.
 */
export function traceIdVisibleTo(idColumn: SQL, audience: DraftAudience): SQL {
  return sql`EXISTS (SELECT 1 FROM claimnet.traces dv WHERE dv.id = ${idColumn} AND ${traceVisibleTo("dv", audience)})`;
}
