/**
 * Authorization and vocabulary for re-filing a recipe into a different recipe
 * book (a "move"). Pure — no I/O. See docs/backlog.md §Corpus curation.
 *
 * A move touches TWO recipe books, unlike a delete which touches one. That
 * asymmetry is the whole reason this lives here rather than inline in the
 * route: the source gate and the destination gate answer different questions
 * and must not be collapsed into a single membership lookup.
 *
 * Human-only by design (recipes aaad8fdf, 4b97ba86). Agent-facing surfaces
 * stay append-only and idempotent so that an agent facing an uncertain call
 * asks the human, rather than proceeding on a thin assumption it expects to
 * correct later — and often won't.
 */

import type {
  FeedbackKind,
  FeedbackImpact,
  FeedbackDisposition,
  FeedbackFulfilled,
} from "./feedback";

/** Roles a `group_members` row can carry today. */
export type GroupRole = "owner" | "admin" | "member";

/**
 * Roles permitted to write traces into a recipe book.
 *
 * Deliberately an explicit allowlist rather than "a group_members row exists".
 * A read-only `viewer` role is a live backlog proposal; when it lands, it must
 * fail CLOSED here without anyone remembering to revisit this file. Note the
 * asymmetry that makes that likely: `api_keys` already splits read from write
 * (read_group_ids / write_group_ids), but `group_members.role` does not.
 */
const WRITE_ROLES: readonly string[] = ["owner", "admin", "member"];

/** May a member holding `role` write traces into that recipe book? */
export function canWriteToBook(role: string | null | undefined): boolean {
  if (!role) return false;
  return WRITE_ROLES.includes(role);
}

/** Roles that may re-file or delete another user's trace out of a book. */
const BOOK_MODERATOR_ROLES: readonly string[] = ["owner", "admin"];

export interface MoveAuthzInput {
  /** Viewer authored the trace. */
  isTraceOwner: boolean;
  /** Viewer's role in the book the trace currently lives in, if any. */
  sourceRole: string | null | undefined;
  /** Viewer's role in the destination book, if any. */
  destRole: string | null | undefined;
  /** Viewer holds the global `system` role. */
  isSystem: boolean;
}

export type MoveAuthzResult =
  | { allowed: true; actorRelation: "owner" | "book_admin" | "system" }
  | { allowed: false; reason: "forbidden_source" | "forbidden_destination" };

/**
 * Decide whether a viewer may move a trace from its source book to `destRole`'s
 * book.
 *
 * Source gate mirrors DELETE /traces/:id — trace author, source-book
 * owner/admin, or system. Destination gate is separate: authority to take a
 * recipe OUT of a book says nothing about authority to put it INTO another, or
 * a move becomes a way to inject recipes into books you don't belong to.
 *
 * `system` bypasses both gates, matching every other trace-mutating route.
 */
export function authorizeTraceMove(input: MoveAuthzInput): MoveAuthzResult {
  const { isTraceOwner, sourceRole, destRole, isSystem } = input;

  if (isSystem) return { allowed: true, actorRelation: "system" };

  const isBookModerator =
    !!sourceRole && BOOK_MODERATOR_ROLES.includes(sourceRole);

  if (!isTraceOwner && !isBookModerator) {
    return { allowed: false, reason: "forbidden_source" };
  }

  if (!canWriteToBook(destRole)) {
    return { allowed: false, reason: "forbidden_destination" };
  }

  return {
    allowed: true,
    actorRelation: isTraceOwner ? "owner" : "book_admin",
  };
}

// ── The human-origin feedback row ────────────────────────────────────────────

/**
 * A move writes a first-class feedback row against the ORIGINAL check, not just
 * an audit event (recipe 465df879). A misfile is an agent misapplying a routing
 * rule the corpus already holds recipes about, so the human's correction is
 * calibration signal — and it renders on the recipe's own detail page, where
 * agents and humans read it.
 *
 * The vocabulary is agent-shaped (@soupnet/domain feedback.ts). Mapping a human
 * re-file onto it:
 *   kind: "operational"    — a finding about the system, not about what the
 *                            check surfaced.
 *   impact: "operational"  — the recipe's content is untouched; only its filing
 *                            changed.
 *   disposition: "corrected"
 *   story_fulfilled: "unknown" — a re-file says nothing about whether the
 *                            original check's story was fulfilled. Asserting
 *                            "partial" would fabricate a judgment the human
 *                            never made.
 */
export const MOVE_FEEDBACK: {
  kind: FeedbackKind;
  impact: FeedbackImpact;
  disposition: FeedbackDisposition;
  storyFulfilled: FeedbackFulfilled;
} = {
  kind: "operational",
  impact: "operational",
  disposition: "corrected",
  storyFulfilled: "unknown",
};

/**
 * The pre-filled story for the human's correction note.
 *
 * Names ONLY the destination book. Moving from a more private book to a more
 * shared one is the common direction, and the source book's name is itself
 * sensitive — the note renders to everyone who can read the destination book
 * (recipe 2738f7a9). The trailing " so that " invites the human to complete the
 * recipe format without forcing them to.
 */
export function moveFeedbackStory(destBookName: string): string {
  return `As the owner of this recipe book, I re-filed this recipe into ${destBookName} so that `;
}
