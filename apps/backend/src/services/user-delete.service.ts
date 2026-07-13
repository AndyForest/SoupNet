import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { deleteTraceCascade } from "./trace-delete.service";

export interface UserDeleteResult {
  ok: true;
  userId: string;
  tracesDeleted: number;
  evidenceDeleted: number;
  referencesDeleted: number;
}

/**
 * Hard-delete a user account and ALL data attributable to it — the single
 * teardown path for account deletion. Both DELETE /auth/me and the waitlist
 * purge route through here so the deletion list can't drift per call site
 * (the drift already happened once: the old hand-rolled list in auth.ts
 * removed traces + link rows but left the evidence, references, and
 * embedding_sources/chunks/vectors those traces spawned — cleartext recipe
 * and evidence text surviving account deletion).
 *
 * What this covers, via deleteTraceCascade per trace:
 *   - traces (the user's own, plus any traces in books of orgs the user
 *     owns — only possible when a previously-shared org is now sole-member;
 *     the caller's guard blocks deletion while other members remain)
 *   - trace_evidence / trace_references link rows
 *   - evidence + references no longer linked from any surviving trace
 *   - embedding_sources / embedding_chunk_strategies / embedding_chunks /
 *     embedding_vectors for each deleted trace/evidence/reference (these
 *     hold source_text and chunk_text in CLEARTEXT)
 *   - reference_source_cache rows for pruned references
 *   - check_feedback about the user's traces (FK ON DELETE CASCADE)
 * and directly in the final transaction:
 *   - check_feedback authored by the user's api keys about OTHER users'
 *     traces — must go BEFORE api_keys: api_key_id has no FK, so once the
 *     api_keys rows are gone the api_key_id → user attribution join breaks
 *     and the rows become undeletable orphans
 *   - uploads owned by the user's api keys, then api_keys
 *   - oauth_authorization_codes
 *   - group_members / groups / organizations the user owns, remaining
 *     memberships, then the users row (FK cascades: invitations.inviter_id,
 *     trace_reactions.user_id, check_feedback_stars.user_id)
 *
 * Deliberately preserved:
 *   - vector_cache — content-hash keyed, stores no source text and no FKs
 *     back to any entity; genuinely PII-free (see enqueue.ts header)
 *   - audit_log — append-only trail outlives the actor per privacy policy
 *     §5 retention (actor_user_id is nullable, no FK)
 *
 * Transaction strategy (checked on Soup.net, recipe 9517f6f4): one
 * transaction PER TRACE (reusing deleteTraceCascade, the audited path for
 * DELETE /traces/:id), then one small final transaction for the identity
 * teardown that removes the users row LAST. A single wrapping transaction
 * over thousands of traces would hold row locks across the per-row
 * orphan-pruning loops; batching leaves no invisible partial state because
 * the account visibly exists until everything else is gone and deletion is
 * idempotent — a crash mid-way leaves a retryable account, and re-running
 * cleans whatever remains. The final transaction re-collects any traces
 * that landed between the loop and the teardown (an agent key is valid
 * until api_keys rows go), shrinking that race to a single snapshot.
 *
 * The audit_log entry is written by the caller (route handler) BEFORE
 * calling this, so actor_user_id is still valid — matching the
 * trace-delete pattern where the caller owns the audit perspective.
 */
export async function deleteUserCascade(
  db: PostgresJsDatabase,
  userId: string,
): Promise<UserDeleteResult> {
  let tracesDeleted = 0;
  let evidenceDeleted = 0;
  let referencesDeleted = 0;

  // Phase 1: cascade the user's traces, one transaction per trace.
  const traceIds = await collectUserTraceIds(db, userId);
  for (const traceId of traceIds) {
    const result = await deleteTraceCascade({ db, traceId, actorUserId: userId });
    tracesDeleted++;
    evidenceDeleted += result.evidenceDeleted;
    referencesDeleted += result.referencesDeleted;
  }

  // Phase 2: identity teardown in one small transaction, users row last.
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as PostgresJsDatabase;

    // check_feedback written by this user's keys about OTHER users' traces.
    // Ordering invariant: BEFORE the api_keys delete — api_key_id is the
    // only attribution join and it has no FK.
    await tx.execute(sql`
      DELETE FROM claimnet.check_feedback
      WHERE api_key_id IN (SELECT id FROM claimnet.api_keys WHERE user_id = ${userId}::uuid)
    `);

    // Uploads belong to api_keys, not directly to users. Drop them first.
    await tx.execute(sql`
      DELETE FROM claimnet.uploads
      WHERE api_key_id IN (SELECT id FROM claimnet.api_keys WHERE user_id = ${userId}::uuid)
    `);
    await tx.execute(sql`DELETE FROM claimnet.api_keys WHERE user_id = ${userId}::uuid`);

    // OAuth in-flight authorization codes for this user.
    await tx.execute(sql`
      DELETE FROM claimnet.oauth_authorization_codes WHERE user_id = ${userId}::uuid
    `);

    // Stragglers: traces created between phase 1 and this transaction
    // (the user's agents held valid keys until the delete above). Usually
    // zero; cascaded here via savepoints so the teardown stays atomic.
    const stragglers = await collectUserTraceIds(txDb, userId);
    for (const traceId of stragglers) {
      const result = await deleteTraceCascade({ db: txDb, traceId, actorUserId: userId });
      tracesDeleted++;
      evidenceDeleted += result.evidenceDeleted;
      referencesDeleted += result.referencesDeleted;
    }

    // Owned organizations bottom-up: memberships in their groups (catches
    // the user's own memberships in those orgs too), the groups, the orgs.
    // Their traces are already gone via the cascade above.
    await tx.execute(sql`
      DELETE FROM claimnet.group_members
      WHERE group_id IN (
        SELECT g.id FROM claimnet.groups g
        WHERE g.organization_id IN (
          SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
        )
      )
    `);
    await tx.execute(sql`
      DELETE FROM claimnet.groups
      WHERE organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
    `);
    await tx.execute(sql`
      DELETE FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
    `);

    // Remaining memberships (orgs the user doesn't own) — must go before
    // the users delete because of the FK.
    await tx.execute(sql`DELETE FROM claimnet.group_members WHERE user_id = ${userId}::uuid`);

    // invitations.inviter_id, trace_reactions.user_id, and
    // check_feedback_stars.user_id are FKs with ON DELETE CASCADE (F18 for
    // invitations) — handled by this delete. audit_log.actor_user_id is
    // nullable with no FK — historical entries are kept (§5 retention).
    await tx.execute(sql`DELETE FROM claimnet.users WHERE id = ${userId}::uuid`);
  });

  return { ok: true, userId, tracesDeleted, evidenceDeleted, referencesDeleted };
}

/**
 * Trace ids to cascade for a user: their own traces, plus traces living in
 * recipe books of organizations they own. The latter can only be other
 * users' traces when a previously-shared org is now sole-member — the
 * owned-shared-orgs-with-members guard in the route blocks deletion
 * otherwise, and those orgs are torn down with the account.
 */
async function collectUserTraceIds(
  db: PostgresJsDatabase,
  userId: string,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT id FROM claimnet.traces WHERE user_id = ${userId}::uuid
    UNION
    SELECT t.id FROM claimnet.traces t
    JOIN claimnet.groups g ON g.id = t.group_id
    WHERE g.organization_id IN (
      SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
    )
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}
