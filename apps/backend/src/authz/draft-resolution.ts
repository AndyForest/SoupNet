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
 * so a repeat is a no-op that reports "nothing changed" — the shape of the
 * email-verification fix (recipe e136701f).
 *
 * Write authority ([F78], [F79]): publishing a draft changes what a book's
 * members see, so the resolving statement also requires write authority on
 * the draft's book at that moment — the key's effective write scope, or the
 * person's live write-capable membership. Clearing or changing the reaction that verified a draft never
 * un-verifies it: the reaction row stays the per-reader calibration record it
 * always was (recipe f1347b19), and this state is separate from it.
 *
 * Ranking inputs are untouched (DT-VER-09): text, embeddings, judgment date,
 * and ratings are not in the SET list.
 *
 * Ownership moves at verification (slice 4, recipe b89db1f0): a draft one
 * person's agent deposited about another belongs to the depositor until its
 * subject verifies it, and from then on is the subject's recipe. So a
 * verification sets `user_id` to the subject and clears `subject_user_id`
 * in the same UPDATE; a rejection or not chosen changes neither, and those
 * drafts stay the depositor's. For a draft about its own author both SET
 * expressions leave the row as it was. This is the only statement that
 * changes an existing recipe's author.
 *
 * The audit row is written by this same statement (a data-modifying CTE), so
 * no caller can resolve a draft without it, and it is the durable record of
 * the depositor once the author has moved: a verification that changed the
 * author names the previous one in `metadata.previousAuthorId` (S4-S4,
 * S4-R4; recipe c6aa9587).
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { subjectOf } from "./draft-sql";
import { inBooks } from "./scope-sql";
import { membershipOf } from "./membership-sql";
import { WRITE_ROLES } from "./roles";
import type { ResolveAuthority } from "./roles";

const RESOLUTION_ACTIONS: Record<DraftResolution, string> = {
  verified: "recipe.draft_verified",
  rejected: "recipe.draft_rejected",
  not_chosen: "recipe.draft_not_chosen",
};

/** Anything that can run a statement: the pool or a transaction. */
type Executor = Pick<PostgresJsDatabase, "execute">;

/**
 * Where a resolution leaves a draft. `not_chosen` (slice 3) is the review
 * queue's third action: the option was viable and lost, which is not the
 * same as `wrong`. It has no reaction; the reaction vocabulary is unchanged
 * (build log open question 6).
 */
export type DraftResolution = "verified" | "rejected" | "not_chosen";

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
 * The SQL form of `hasWriteAuthority` for the draft's book, evaluated inside
 * the resolving statement so the book is the one the row is in at that
 * moment ([F78], [F79]). A key: the row's book is in its effective write
 * scope (`inBooks`; an empty scope is FALSE). A person: a live membership in
 * the row's book with a write-capable role (the module's membership
 * fragment).
 */
export function writeAuthoritySql(_alias: "t", authority: ResolveAuthority, actorUserId: string): SQL {
  const bookCol = sql`t.group_id`;
  if (authority.kind === "key") return inBooks(bookCol, authority.writeGroupIds);
  return sql`EXISTS (
    SELECT 1 FROM claimnet.group_members me
    WHERE me.group_id = ${bookCol}
      AND ${membershipOf("me", actorUserId)}
      AND me.role IN (${sql.join(WRITE_ROLES.map((r) => sql`${r}`), sql`, `)})
  )`;
}

/**
 * Resolve the draft if `actorUserId` is the person it is about and it is still
 * unverified. `byKeyId` is the verifying agent's key, or null when the person
 * resolved it themselves. Returns null when nothing changed (and no audit row
 * is written); otherwise the key that deposited the draft, so a caller can
 * record whether the depositing agent verified its own draft (build log open
 * question 14), and the author before the statement ran.
 */
export async function resolveDraft(
  db: Executor,
  params: {
    traceId: string;
    actorUserId: string;
    resolution: DraftResolution;
    byKeyId: string | null;
    /** Write authority on the draft's book, checked in this statement ([F78], [F79]). */
    authority: ResolveAuthority;
    /** The audit row's metadata (how it was resolved: `via`, and anything the
     *  caller adds). `previousAuthorId` and, for an agent, whether the
     *  depositing key verified its own draft, are added here. */
    auditMetadata: Record<string, unknown>;
  },
): Promise<{ depositingKeyId: string | null; previousAuthorId: string } | null> {
  const verified = params.resolution === "verified";
  // The resolution columns are written outright, not COALESCEd: the WHERE
  // already makes resolution one-way (only an unverified row matches), and a
  // value that came from anywhere else (an import) must never survive a real
  // resolution ([F83]). `prev` is the row as it was before this statement
  // (the self-join reads the statement's snapshot), so the audit row can name
  // the author a verification replaced.
  const rows = await db.execute(sql`
    WITH upd AS (
      UPDATE claimnet.traces t
      SET draft_state = ${params.resolution},
          draft_resolved_at = NOW(),
          draft_resolved_by_user_id = ${params.actorUserId}::uuid,
          draft_resolved_by_key_id = ${params.byKeyId}::uuid,
          user_id = ${verified ? sql`${subjectOf("t")}` : sql`t.user_id`},
          subject_user_id = ${verified ? sql`NULL` : sql`t.subject_user_id`},
          updated_at = NOW()
      FROM claimnet.traces prev
      WHERE t.id = ${params.traceId}::uuid
        AND prev.id = t.id
        AND t.draft_state = 'unverified'
        AND ${subjectOf("t")} = ${params.actorUserId}::uuid
        AND ${writeAuthoritySql("t", params.authority, params.actorUserId)}
      RETURNING t.id, t.api_key_id, prev.user_id AS prev_author, t.user_id AS new_author
    ), audit AS (
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, api_key_id, metadata)
      SELECT ${params.actorUserId}::uuid, ${RESOLUTION_ACTIONS[params.resolution]}, 'trace', upd.id,
        ${params.byKeyId}::uuid,
        ${JSON.stringify(params.auditMetadata)}::jsonb
          || CASE WHEN upd.prev_author <> upd.new_author
               THEN jsonb_build_object('previousAuthorId', upd.prev_author) ELSE '{}'::jsonb END
          || CASE WHEN ${params.byKeyId}::uuid IS NOT NULL
               THEN jsonb_build_object('verifiedByDepositingKey', upd.api_key_id IS NOT DISTINCT FROM ${params.byKeyId}::uuid) ELSE '{}'::jsonb END
      FROM upd
      RETURNING id
    )
    SELECT upd.api_key_id AS "depositingKeyId", upd.prev_author AS "previousAuthorId" FROM upd
  `);
  const row = (rows as unknown as Array<{ depositingKeyId: string | null; previousAuthorId: string }>)[0];
  return row ? { depositingKeyId: row.depositingKeyId ?? null, previousAuthorId: row.previousAuthorId } : null;
}
