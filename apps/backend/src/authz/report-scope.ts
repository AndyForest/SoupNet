/**
 * Who may read a report row (drafts-and-triage slice 9: read paths for
 * intents and feedback rows).
 *
 * Two questions, each answered once here:
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
 * Ruling 54 (2026-10-24): the caller's user's rows only.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { inBooks } from "./scope-sql";
import { traceReadableById, traceReadableByPerson } from "./draft-sql";

/** Who is reading a report: an agent's key, or the signed-in person. */
export type ReportViewer =
  | { kind: "key"; userId: string; readGroupIds: readonly string[] }
  | { kind: "person"; userId: string; memberBookIds: readonly string[] };

/**
 * The `claimnet.check_feedback` row aliased `cf` belongs to this user. `cf`
 * is the only alias, so nothing from a caller reaches the statement but the
 * bound user id.
 */
export function feedbackOwnedBy(userId: string): SQL {
  return sql`(cf.actor_user_id = ${userId}::uuid
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
