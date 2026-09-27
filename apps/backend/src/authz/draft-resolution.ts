/**
 * Resolving a draft: the one statement that moves a recipe's draft state out
 * of `unverified` (drafts-and-triage slice 2).
 *
 * Who may: the person the draft is about, and nobody else — not a collaborator,
 * not a book owner, not (from slice 4) the depositor of a draft about someone
 * else. The check is inside the UPDATE (the subject column from draft-sql.ts
 * must equal the actor), so a caller that forgot to ask `mayResolveDraft`
 * first still cannot resolve someone else's draft.
 *
 * One-way (DT-VER-03): the statement only matches a row still `unverified`,
 * and the resolver columns are COALESCE-guarded, so a repeat is a no-op that
 * reports "nothing changed" — the shape of the email-verification fix (recipe
 * e136701f). Clearing or changing the reaction that verified a draft never
 * un-verifies it: the reaction row stays the per-reader calibration record it
 * always was (recipe f1347b19), and this state is separate from it.
 *
 * Ranking inputs are untouched (DT-VER-09): text, embeddings, judgment date,
 * and ratings are not in the SET list.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { subjectOf } from "./draft-sql";

/** Anything that can run a statement: the pool or a transaction. */
type Executor = Pick<PostgresJsDatabase, "execute">;

export type DraftResolution = "verified" | "rejected";

/**
 * Which resolution a human reaction writes, if any: `still_true` verifies,
 * `wrong` rejects, `stale` says nothing about a draft. Pure.
 */
export function resolutionForReaction(reaction: string): DraftResolution | null {
  if (reaction === "still_true") return "verified";
  if (reaction === "wrong") return "rejected";
  return null;
}

/**
 * Resolve the draft if `actorUserId` is the person it is about and it is still
 * unverified. `byKeyId` is the verifying agent's key, or null when the person
 * resolved it themselves. Returns null when nothing changed; otherwise the key
 * that deposited the draft, so a caller can record whether the depositing
 * agent verified its own draft (build log open question 14).
 */
export async function resolveDraft(
  db: Executor,
  params: { traceId: string; actorUserId: string; resolution: DraftResolution; byKeyId: string | null },
): Promise<{ depositingKeyId: string | null } | null> {
  const rows = await db.execute(sql`
    UPDATE claimnet.traces t
    SET draft_state = ${params.resolution},
        draft_resolved_at = COALESCE(t.draft_resolved_at, NOW()),
        draft_resolved_by_user_id = COALESCE(t.draft_resolved_by_user_id, ${params.actorUserId}::uuid),
        draft_resolved_by_key_id = COALESCE(t.draft_resolved_by_key_id, ${params.byKeyId}::uuid),
        updated_at = NOW()
    WHERE t.id = ${params.traceId}::uuid
      AND t.draft_state = 'unverified'
      AND ${subjectOf("t")} = ${params.actorUserId}::uuid
    RETURNING t.id, t.api_key_id AS "depositingKeyId"
  `);
  const row = (rows as unknown as Array<{ depositingKeyId: string | null }>)[0];
  return row ? { depositingKeyId: row.depositingKeyId ?? null } : null;
}
