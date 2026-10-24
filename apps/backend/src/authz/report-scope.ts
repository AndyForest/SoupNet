/**
 * Who may read a report row (drafts-and-triage slice 9: read paths for
 * intents and feedback rows).
 *
 * Three questions, each answered once here:
 *
 *   - Whose intent is it? `intentOwnedBy`: the `intents.user_id` it was
 *     registered under. An intent belongs to a person, not to a book.
 *
 *   - Whose feedback row is it? `feedbackOwnedBy`. A row is the user's when
 *     the key that wrote it belongs to them today, or it is a human-origin
 *     row they wrote (a re-filing correction). check_feedback has no user
 *     column: `api_key_id` is the attribution join (the same one account
 *     deletion uses, user-delete.service.ts), so a row whose key has since
 *     been deleted (revoked, or an OAuth key swept after expiry) is no
 *     longer anyone's here. Open question 56 in the build log weighs a
 *     server-stamped column; if it lands, this fragment is the one place
 *     that changes.
 *
 *   - May this viewer read the recipe a row names? `traceReadableByViewer`.
 *     An agent reads through its key: the book must be in the key's
 *     effective scope and the draft read rule must pass, as for every other
 *     key read (recipe-lookup.service.ts). A person on the web reads by the
 *     person's rule, `traceReadableByPerson`. Ownership of the row never
 *     widens what a viewer may read: a feedback row the user's agent wrote
 *     about a recipe the presenting key cannot read now is not listed.
 *
 * Ruling 54 (2026-10-24): the caller's user's rows only. The two ownership
 * fragments are fingerprinted by the seam guard wherever they are called
 * (scripts/check-authz-seam.mjs, MODULE_FRAGMENT), so dropping one from a
 * statement shows up in review like a dropped draft condition.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { inBooks } from "./scope-sql";
import { traceReadableById, traceReadableByPerson } from "./draft-sql";

/** Who is reading a report: an agent's key, or the signed-in person. */
export type ReportViewer =
  | { kind: "key"; userId: string; readGroupIds: readonly string[] }
  | { kind: "person"; userId: string; memberBookIds: readonly string[] };

/** The `claimnet.intents` row aliased `i` belongs to this user. */
export function intentOwnedBy(userId: string): SQL {
  return sql`i.user_id = ${userId}::uuid`;
}

/**
 * The `claimnet.check_feedback` row aliased `cf` belongs to this user. `cf`
 * is the only alias, so nothing from a caller reaches the statement but the
 * bound user id.
 */
export function feedbackOwnedBy(userId: string): SQL {
  // COALESCE keeps it a strict boolean (an agent row's actor_user_id is
  // NULL), so it can be selected as a value as well as filtered on.
  return sql`(COALESCE(cf.actor_user_id = ${userId}::uuid, FALSE)
    OR (cf.api_key_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM claimnet.api_keys own_k
      WHERE own_k.id = cf.api_key_id AND own_k.user_id = ${userId}::uuid)))`;
}

/** The recipe aliased `t` may be read by this viewer now (see the header). */
export function traceReadableByViewer(viewer: ReportViewer): SQL {
  if (viewer.kind === "key") {
    return sql`(${inBooks(sql`t.group_id`, viewer.readGroupIds)} AND ${traceReadableById("t", viewer.userId)})`;
  }
  return traceReadableByPerson("t", viewer.userId, viewer.memberBookIds);
}

/** The books a viewer reads, for resolving a `recipe_book` filter. */
export function viewerBookIds(viewer: ReportViewer): readonly string[] {
  return viewer.kind === "key" ? viewer.readGroupIds : viewer.memberBookIds;
}
