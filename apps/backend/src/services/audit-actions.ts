/**
 * Every audit-log action the backend writes, as one of two kinds (recipe
 * 1d1531da, keeping the September design 569fc2cc):
 *
 * - The CHECK LOG: what a person's agents did against the corpus (a check, a
 *   search, a briefing). Kept while the account exists; on account deletion
 *   the rows are anonymised, not deleted (anonymiseAuditLogOf), so counts and
 *   task groupings survive without naming anyone.
 * - ACCOUNT EVENTS: account and recipe-book changes, sign-up and admin events,
 *   and system events. Kept by account deletion, except that the ones in
 *   RECIPE_TEXT_ACTIONS and BOOK_TEXT_ACTIONS lose the text the person wrote
 *   (F116). A 12-month
 *   sweep of these is a deferred backlog item; it would delete only this list,
 *   never an unlisted action.
 *
 * writeAudit takes an AuditAction, so a new action is classified before it
 * compiles. audit-actions.test.ts scans the backend for the writes that do not
 * go through writeAudit and fails on an action in neither list, in both, or
 * listed but no longer written; audit-anonymise.test.ts checks every action in
 * the table is listed.
 */

export const CHECK_LOG_ACTIONS = ["recipe.checked", "check.searched", "briefing.issued"] as const;

export const ACCOUNT_EVENT_ACTIONS = [
  // The person's account
  "user.self_delete",
  "user.waitlist_approved",
  "user.premium_set",
  "user.suspended",
  "user.unsuspended",
  "auth.signed_in",
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
  "group.made_org_wide",
  "group.made_private",
  "recipe_book.moved_into_organization",
  // Company organizations
  "organization.member_joined",
  "organization.member_disable",
  "organization.member_enable",
  "organization.member_set_role",
  "organization.owner_handed_over",
  "organization.seat_limit_set",
  "organization.sharing_changed",
  // Operators
  "integrity.repaired",
] as const;

export type AuditAction = (typeof CHECK_LOG_ACTIONS)[number] | (typeof ACCOUNT_EVENT_ACTIONS)[number];

/** Account events whose metadata keeps a recipe's text (`claimText`). On
 *  account deletion the text goes from the rows the person wrote and from the
 *  rows about their recipes (F116); the event itself stays. */
export const RECIPE_TEXT_ACTIONS = ["trace.moved", "trace.deleted"] as const satisfies readonly AuditAction[];

/** Account events whose metadata keeps a recipe book's name or description,
 *  old and new. On account deletion the text goes from the rows the person
 *  wrote; the event and the book's ids stay, and so do the book's live name
 *  and description, which belong to the book (F116, extended by the planning
 *  session 2026-10-26). */
export const BOOK_TEXT_ACTIONS = ["group.description_updated", "group.name_updated"] as const satisfies readonly AuditAction[];
