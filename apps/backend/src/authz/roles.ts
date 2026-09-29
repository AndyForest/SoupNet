/**
 * Role predicates for recipe-book memberships. Pure — no I/O.
 *
 * Each predicate is an explicit allowlist, the same posture as
 * `canWriteToBook` in @soupnet/domain: a role this file has never heard of
 * (a future read-only `viewer`, say) answers false everywhere until someone
 * adds it on purpose. `null` / `undefined` mean "no membership row" and are
 * always false, so a caller that forgets to handle the non-member case still
 * fails closed.
 */

/**
 * What `roleIn` returns: the stored role text (`owner` | `admin` | `member`
 * today), or null when the user has no membership row. Typed as plain text
 * because the column is — the predicates below are what give it meaning.
 */
export type BookRole = string | null;

const OWNER_ROLES: readonly string[] = ["owner"];
const OWNER_OR_ADMIN_ROLES: readonly string[] = ["owner", "admin"];

/** Holds the `owner` role: may edit book details and remove members. */
export function isOwner(role: string | null | undefined): boolean {
  if (!role) return false;
  return OWNER_ROLES.includes(role);
}

/**
 * Holds `owner` or `admin`: may add members, manage invitations, and delete or
 * re-file other members' recipes in the book.
 */
export function isOwnerOrAdmin(role: string | null | undefined): boolean {
  if (!role) return false;
  return OWNER_OR_ADMIN_ROLES.includes(role);
}

/**
 * Is a recipe in this draft state published — an ordinary recipe (no state)
 * or a draft its person verified? Anything else, including a value this file
 * has never heard of, is unpublished: fail closed.
 */
export function isPublishedDraftState(draftState: string | null | undefined): boolean {
  return draftState === null || draftState === undefined || draftState === "verified";
}

/** The facts the trace read rule decides on, for one viewer and one recipe. */
export interface TraceReadFacts {
  /** The viewer wrote this recipe. */
  isAuthor: boolean;
  /** The viewer's role in the recipe's book, or null without a membership. */
  role: string | null | undefined;
  /** The recipe's draft state (null: never a draft). */
  draftState?: string | null | undefined;
  /** The viewer is the person the draft is about. */
  isDraftSubject?: boolean | undefined;
  /** The viewer is the person whose agent deposited the draft. */
  isDraftDepositor?: boolean | undefined;
}

/**
 * THE trace read rule — the only JS copy. A published recipe: the author can
 * always read it, and so can anyone with a membership in the book it lives in
 * (any role: "a membership exists", deliberately not an allowlist). An
 * unpublished draft (drafts-and-triage slice 2): only the person it is about
 * and the person whose agent deposited it, whatever role anyone else holds,
 * book owners included.
 *
 * The DB-bound functions in trace-access.ts fetch the facts and call this.
 * Set-returning statements use the SQL form of the same rule in
 * draft-sql.ts; draft-sql.test.ts proves the two agree.
 */
export function mayReadTrace(viewer: TraceReadFacts): boolean {
  if (!isPublishedDraftState(viewer.draftState)) {
    return viewer.isDraftSubject === true || viewer.isDraftDepositor === true;
  }
  return viewer.isAuthor || (viewer.role !== null && viewer.role !== undefined);
}

/** Roles whose membership may write into a book (the allowlist posture of
 *  the predicates above; the same set as `canWriteToBook` in @soupnet/domain). */
export const WRITE_ROLES: readonly string[] = ["owner", "admin", "member"];

/**
 * Who is asking to resolve a draft, and with what authority over books:
 * an API key (its Principal's EFFECTIVE write scope, already the grant
 * intersected with live membership) or a signed-in person (their live
 * membership role in the draft's book).
 */
export type ResolveAuthority =
  | { kind: "key"; writeGroupIds: readonly string[] }
  | { kind: "member"; role?: string | null | undefined };

/**
 * Write authority on a book at this moment ([F78], [F79]). Publishing a
 * draft changes what a book's members see, so it is a write: a key needs
 * the book in its effective write scope, and a person needs a live
 * membership with a write-capable role. Allowlist: an unknown role is false.
 */
export function hasWriteAuthority(authority: ResolveAuthority, bookId: string): boolean {
  if (authority.kind === "key") return authority.writeGroupIds.includes(bookId);
  const role = authority.role;
  return !!role && WRITE_ROLES.includes(role);
}

/**
 * May this viewer resolve (verify or reject) the draft? Only the person it is
 * about, only while it is unverified, and only with write authority on the
 * draft's book at that moment ([F78], [F79]; `hasWriteAuthority`). Resolution
 * is one-way (DT-VER-03), and a depositor who is not the subject never
 * verifies someone else's draft (DT-OBO-04, for slice 4). The resolving
 * statement (draft-resolution.ts) enforces the same three conditions itself.
 */
export function mayResolveDraft(facts: {
  draftState: string | null | undefined;
  isDraftSubject: boolean;
  canWriteBook: boolean;
}): boolean {
  return facts.draftState === "unverified" && facts.isDraftSubject && facts.canWriteBook;
}

/**
 * Move and delete of an UNPUBLISHED draft (slice 4, S4-M5; build log open
 * question 30, recipes 5f0717b7 and b89db1f0). The subject may move or delete
 * it (slice 2's rule). The depositor, who is its author until it is verified,
 * may delete it (withdrawing a wrong attribution is the accountable person's
 * job) but may not move it: the subject needs write access where it lives to
 * review it, so a depositor's move could strand it. Everyone else, a book
 * owner and a system user included, gets neither (the route's uniform 404).
 *
 * Null for a published recipe (never a draft, or verified): the ordinary
 * author, book owner or admin, and system rules apply, and after a subject
 * verifies an on-behalf draft its author is the subject.
 */
export function unpublishedDraftManagement(facts: {
  draftState: string | null | undefined;
  isDraftSubject: boolean;
  isDraftDepositor: boolean;
}): { move: boolean; delete: boolean } | null {
  if (isPublishedDraftState(facts.draftState)) return null;
  if (facts.isDraftSubject) return { move: true, delete: true };
  if (facts.isDraftDepositor) return { move: false, delete: true };
  return { move: false, delete: false };
}

// ── The key's deposit level (drafts-and-triage slice 5) ─────────────────────
//
// The key's deposit level (an api_keys column) is the ladder of what it may write: 'full',
// 'drafts' (a headless key), and 'none' (reserved for the no-deposit
// principal; not mintable). It is read once, by `authenticateKey`, and what it
// means is decided here and nowhere else (rubric S5-M2). Both predicates fail
// closed: only the exact value 'full' is an ordinary key, so a reserved level,
// an empty string, or a value this code has never seen deposits drafts and
// cannot verify.

/**
 * Does every deposit through this key become an unverified draft, whatever the
 * call's `draft` parameter says? True for a headless key and for anything that
 * is not exactly 'full'. Read by the one deposit statement (trace.service.ts).
 */
export function keyForcesDrafts(key: { depositLevel: string }): boolean {
  return key.depositLevel !== "full";
}

/**
 * May a request authenticated by this key resolve drafts through an agent
 * operation? Only an ordinary ('full') key may (build log open question 13,
 * DT-HDL-04): otherwise the agent whose deposits were forced to drafts could
 * publish them a moment later.
 *
 * Every agent operation that publishes or resolves a draft takes its authority
 * from THIS predicate, decided before any lookup so the refusal is not an
 * oracle: `verify_draft` and its REST twin POST /recipes/:id/verify today;
 * option-set resolution (slice 6) and any agent reject or not-chosen outcome
 * later (docs/planning/pr-review-helpers.md §6).
 */
export function keyMayVerifyDrafts(key: { depositLevel: string }): boolean {
  return key.depositLevel === "full";
}
