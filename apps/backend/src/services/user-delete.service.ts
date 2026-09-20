import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { deleteTraceCascade } from "./trace-delete.service";

export interface UserDeleteResult {
  ok: true;
  userId: string;
  tracesDeleted: number;
  evidenceDeleted: number;
  referencesDeleted: number;
  /** Shared books that were handed on to another member instead of deleted. */
  booksHandedOver: BookHandover[];
}

export type SuccessionRule =
  | "existing_owner"
  | "longest_standing_admin"
  | "longest_standing_member";

export interface BookHandover {
  recipeBookId: string;
  newOwnerUserId: string;
  successionRule: SuccessionRule;
  previousOrganizationId: string;
  newOrganizationId: string;
  previousSlug: string;
  newSlug: string;
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
 *   - traces the user AUTHORED, in any book — plus whatever is left in a
 *     book the user owns that has NO other members, because that book is
 *     deleted with the account (see "Recipe books" below)
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
 *   - owned books that have no other members (their memberships, the book
 *     ids purged from any remaining key's scope arrays, the groups rows),
 *     the user's organizations, remaining memberships, then the users row
 *     (FK cascades: invitations.inviter_id, trace_reactions.user_id,
 *     check_feedback_stars.user_id)
 *
 * Recipe books [F70] (operator ruling 2026-09-19, Soup.net recipe 52bbbdc8:
 * an owner leaving never takes co-authors' recipes with them). The cascade
 * itself guarantees this — it does not rely on any caller-side guard:
 *   - A book the user owns that still has other members is HANDED ON by
 *     handOverSharedBooks before anything is deleted. It keeps its id, so
 *     other members' recipes, memberships, invitations and already-issued
 *     API keys (whose scope arrays hold book ids) are untouched.
 *   - Books the user merely belongs to lose the membership and the user's
 *     authored recipes, nothing else.
 *   - Only books with no other members are deleted.
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
 * until api_keys rows go), shrinking that race to a single snapshot. The
 * book hand-over follows the same discipline: once up front in its own
 * small transaction (idempotent — a re-run finds nothing left to hand on),
 * and once more inside the final transaction after locking the books that
 * are about to go, so a member who joined mid-deletion inherits the book
 * instead of losing it.
 *
 * The user.self_delete audit_log entry is written by the caller (route
 * handler) BEFORE calling this, so actor_user_id is still valid — matching
 * the trace-delete pattern where the caller owns the audit perspective.
 * Each book hand-over writes its own recipe_book.ownership_transferred row
 * INSIDE the hand-over transaction (the reaper's F58 pattern), so a book
 * can never change hands without a trail.
 */
export async function deleteUserCascade(
  db: PostgresJsDatabase,
  userId: string,
): Promise<UserDeleteResult> {
  let tracesDeleted = 0;
  let evidenceDeleted = 0;
  let referencesDeleted = 0;

  // Phase 0: hand shared books on to a remaining member BEFORE anything is
  // deleted, so from here on every book still in the user's organizations is
  // one nobody else belongs to.
  const booksHandedOver = await db.transaction((tx) =>
    handOverSharedBooks(tx as unknown as PostgresJsDatabase, userId),
  );

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

    // Lock the books that are about to be deleted. A concurrent membership
    // insert takes a key-share lock on its groups row, so it now waits for
    // this transaction — nobody can join a book between the hand-over
    // re-check below and the delete. Then hand on any book that gained a
    // member since phase 0.
    await tx.execute(sql`
      SELECT g.id FROM claimnet.groups g
      WHERE g.organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
      ORDER BY g.id
      FOR UPDATE OF g
    `);
    booksHandedOver.push(...(await handOverSharedBooks(txDb, userId)));

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

    // Owned organizations bottom-up. Every book still here has no member
    // other than the user (shared ones were handed on above): memberships in
    // those books, the book ids purged from any remaining key's scope, the
    // books, the orgs. Their traces are already gone via the cascade above.
    //
    // Scope purge: a FORMER member's still-live key can carry a deleted
    // book's id. Same repair the ephemeral-book reaper applies (recipe
    // 11d5490e): drop the id from both arrays and point a dangling
    // default_write_group_id at the first remaining write id; if none
    // remains, COALESCE keeps the old value rather than inventing a target.
    const doomedRows = await tx.execute(sql`
      SELECT g.id FROM claimnet.groups g
      WHERE g.organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
    `);
    for (const { id: groupId } of doomedRows as unknown as Array<{ id: string }>) {
      await tx.execute(sql`
        UPDATE claimnet.api_keys
        SET read_group_ids = array_remove(read_group_ids, ${groupId}::uuid),
            write_group_ids = array_remove(write_group_ids, ${groupId}::uuid),
            default_write_group_id = CASE
              WHEN default_write_group_id = ${groupId}::uuid
                THEN COALESCE((array_remove(write_group_ids, ${groupId}::uuid))[1], default_write_group_id)
              ELSE default_write_group_id
            END
        WHERE ${groupId}::uuid = ANY(read_group_ids)
           OR ${groupId}::uuid = ANY(write_group_ids)
           OR default_write_group_id = ${groupId}::uuid
      `);
    }
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

  return { ok: true, userId, tracesDeleted, evidenceDeleted, referencesDeleted, booksHandedOver };
}

/**
 * Trace ids to cascade for a user: the traces they authored (in any book),
 * plus whatever remains in books of organizations they own that have NO
 * member other than them — those books are deleted with the account, so
 * nothing in them can outlive it. A book with another member never
 * contributes another author's trace here [F70]; the NOT EXISTS is the
 * cascade's own guarantee and holds even if a hand-over was somehow missed.
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
    AND NOT EXISTS (
      SELECT 1 FROM claimnet.group_members gm
      WHERE gm.group_id = g.id AND gm.user_id <> ${userId}::uuid
    )
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Hand every shared book the departing user is responsible for on to a
 * remaining member [F70]. Must run inside a transaction (`db` is the
 * transaction handle): each book's row is locked, changed and audited
 * atomically.
 *
 * Which books: those with at least one OTHER member that either live in an
 * organization the user owns, or have the user as a role-'owner' member.
 *
 * Succession: another existing owner if there is one; else the
 * longest-standing admin; else the longest-standing member (joined_at, id
 * as the tie-break). The successor is promoted to 'owner' unless they
 * already are one.
 *
 * Re-homing: books live inside an organization and the departing user's
 * organizations are removed with the account, so a book in one of them moves
 * into the new owner's personal organization (users.personal_organization_id,
 * falling back to the oldest organization they own — the same resolution
 * ephemeral workspaces and imports use, recipe 525c1a59). The book id does
 * not change, so everything keyed by it keeps working: traces,
 * embedding_sources.group_id, memberships, invitations, ephemeral_books, and
 * other users' api_keys / oauth scope arrays. `groups (organization_id, slug)`
 * is unique, so the slug is kept unless the new organization already uses
 * it, in which case the first free `-2`, `-3`, … suffix is taken. A book in
 * an organization the user does not own stays where it is.
 *
 * The departing user's own membership row is left for the final teardown, so
 * a crash between phases leaves them a co-owner of a book they can still see
 * — a retryable account, never a lost book.
 */
async function handOverSharedBooks(
  db: PostgresJsDatabase,
  userId: string,
): Promise<BookHandover[]> {
  const bookRows = await db.execute(sql`
    SELECT g.id, g.slug, g.organization_id AS "organizationId",
           (o.owner_id = ${userId}::uuid) AS "inOwnedOrg"
    FROM claimnet.groups g
    JOIN claimnet.organizations o ON o.id = g.organization_id
    WHERE (
        o.owner_id = ${userId}::uuid
        OR EXISTS (
          SELECT 1 FROM claimnet.group_members me
          WHERE me.group_id = g.id AND me.user_id = ${userId}::uuid AND me.role = 'owner'
        )
      )
      AND EXISTS (
        SELECT 1 FROM claimnet.group_members other
        WHERE other.group_id = g.id AND other.user_id <> ${userId}::uuid
      )
    ORDER BY g.created_at ASC, g.id ASC
    FOR UPDATE OF g
  `);
  const books = bookRows as unknown as Array<{
    id: string;
    slug: string;
    organizationId: string;
    inOwnedOrg: boolean;
  }>;

  const handovers: BookHandover[] = [];
  for (const book of books) {
    const successorRows = await db.execute(sql`
      SELECT gm.user_id AS "userId", gm.role
      FROM claimnet.group_members gm
      WHERE gm.group_id = ${book.id}::uuid AND gm.user_id <> ${userId}::uuid
      ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
               gm.joined_at ASC, gm.id ASC
      LIMIT 1
      FOR UPDATE OF gm
    `);
    const successor = (successorRows as unknown as Array<{ userId: string; role: string }>)[0];
    if (!successor) continue; // the last other member left since the select above

    const successionRule: SuccessionRule =
      successor.role === "owner"
        ? "existing_owner"
        : successor.role === "admin"
          ? "longest_standing_admin"
          : "longest_standing_member";

    // A co-owner already holds a book that lives in someone else's
    // organization: nothing changes hands.
    if (successionRule === "existing_owner" && !book.inOwnedOrg) continue;

    if (successor.role !== "owner") {
      await db.execute(sql`
        UPDATE claimnet.group_members SET role = 'owner'
        WHERE group_id = ${book.id}::uuid AND user_id = ${successor.userId}::uuid
      `);
    }

    let newOrganizationId = book.organizationId;
    let newSlug = book.slug;
    if (book.inOwnedOrg) {
      newOrganizationId = await resolvePersonalOrganization(db, successor.userId);
      newSlug = await freeSlugIn(db, newOrganizationId, book.slug);
      await db.execute(sql`
        UPDATE claimnet.groups
        SET organization_id = ${newOrganizationId}::uuid, slug = ${newSlug}, updated_at = NOW()
        WHERE id = ${book.id}::uuid
      `);
    }

    const handover: BookHandover = {
      recipeBookId: book.id,
      newOwnerUserId: successor.userId,
      successionRule,
      previousOrganizationId: book.organizationId,
      newOrganizationId,
      previousSlug: book.slug,
      newSlug,
    };
    // Raw INSERT (not the best-effort writeAudit) so the trail commits or
    // rolls back with the hand-over itself. Ids and slugs only — no email
    // addresses or book names; the row outlives the departing actor.
    const { recipeBookId: _recipeBookId, ...metadata } = handover;
    await db.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (
        ${userId}::uuid, 'recipe_book.ownership_transferred', 'group', ${book.id}::uuid,
        ${JSON.stringify({ reason: "owner_account_deleted", ...metadata })}::jsonb
      )
    `);
    handovers.push(handover);
  }
  return handovers;
}

/**
 * The organization an inherited book is re-homed into: the new owner's
 * pinned personal organization when it is still theirs, else the oldest
 * organization they own. A user who owns none (not reachable through
 * registration, which always creates one) gets a personal organization the
 * way registration would have made it.
 */
async function resolvePersonalOrganization(
  db: PostgresJsDatabase,
  ownerUserId: string,
): Promise<string> {
  const orgRows = await db.execute(sql`
    SELECT o.id FROM claimnet.organizations o
    JOIN claimnet.users u ON u.id = o.owner_id
    WHERE o.owner_id = ${ownerUserId}::uuid
    ORDER BY (o.id = u.personal_organization_id) DESC NULLS LAST,
             o.is_personal DESC, o.created_at ASC, o.id ASC
    LIMIT 1
  `);
  const existing = (orgRows as unknown as Array<{ id: string }>)[0]?.id;
  if (existing) return existing;

  const userRows = await db.execute(sql`
    SELECT email FROM claimnet.users WHERE id = ${ownerUserId}::uuid
  `);
  const email = (userRows as unknown as Array<{ email: string }>)[0]?.email;
  if (!email) throw new Error("hand-over target user not found");
  const slugBase = email.split("@")[0]?.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "user";
  const created = await db.execute(sql`
    INSERT INTO claimnet.organizations (name, slug, owner_id, is_personal)
    VALUES (
      ${`${email}'s workspace`}, ${`${slugBase}-${ownerUserId.slice(0, 8)}`},
      ${ownerUserId}::uuid, true
    )
    RETURNING id
  `);
  const orgId = (created as unknown as Array<{ id: string }>)[0]?.id;
  if (!orgId) throw new Error("failed to create a personal organization for the hand-over target");
  await db.execute(sql`
    UPDATE claimnet.users SET personal_organization_id = ${orgId}::uuid WHERE id = ${ownerUserId}::uuid
  `);
  return orgId;
}

/** Slugs are 1–100 chars of [a-z0-9-] (createGroupSchema in routes/groups.ts). */
const MAX_SLUG_LENGTH = 100;

/** `slug` if the organization doesn't use it yet, else the first free -2, -3, … */
async function freeSlugIn(
  db: PostgresJsDatabase,
  organizationId: string,
  slug: string,
): Promise<string> {
  const rows = await db.execute(sql`
    SELECT slug FROM claimnet.groups WHERE organization_id = ${organizationId}::uuid
  `);
  const taken = new Set((rows as unknown as Array<{ slug: string }>).map((r) => r.slug));
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${slug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
