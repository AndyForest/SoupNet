/**
 * Every audit-log action the backend writes, as one of two kinds (recipe
 * 1d1531da, keeping the September design 569fc2cc):
 *
 * - The CHECK LOG: what a person's agents did against the corpus (a check, a
 *   search, a briefing). Kept while the account exists; on account deletion
 *   the rows are anonymised, not deleted (anonymiseCheckLogOf), so counts and
 *   task groupings survive without naming anyone.
 * - ACCOUNT EVENTS: account and recipe-book changes, sign-up and admin events,
 *   and system events. Left as they are by account deletion. A 12-month sweep
 *   of these is a deferred backlog item; it would delete only this list, never
 *   an unlisted action.
 *
 * audit-actions.test.ts scans the backend for every action written and fails
 * on one that is in neither list, in both, or listed but no longer written,
 * so a new action is classified when it is added.
 */

export const CHECK_LOG_ACTIONS = ["recipe.checked", "check.searched", "briefing.issued"] as const;

export const ACCOUNT_EVENT_ACTIONS = [
  // The person's account
  "user.self_delete",
  "user.waitlist_approved",
  "user.premium_set",
  // Recipe books and the recipes in them
  "group.description_updated",
  "group.name_updated",
  "group.member_removed",
  "recipe_book.created_ephemeral",
  "recipe_book.expire_requested",
  "recipe_book.reaped",
  "recipe_book.ownership_transferred",
  "recipe_book.left_without_members",
  "trace.moved",
  "trace.deleted",
  "recipe.draft_verified",
  "recipe.draft_rejected",
  "recipe.draft_not_chosen",
  "corpus.imported",
  // Operators
  "integrity.repaired",
] as const;
