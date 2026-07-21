/**
 * Ephemeral workspace lifecycle — the eval-reset destructive tier.
 *
 * Design: docs/planning/eval-reset-contract-response.md (the operator's ruled
 * design) as constrained by the design-phase security audit
 * (claimNet docs/security/security-audit-2026-07-21-eval-reset-destructive-tier.md,
 * F55–F64). Agents never delete; they CREATE disposable books whose destruction
 * is declared policy (a TTL), executed by the system (the pg-boss reaper).
 *
 * The whole tier hangs off the ephemeral_books birth record: presence = the
 * book is ephemeral, absence = durable. The reaper JOINs THROUGH that table so
 * it structurally cannot delete a book with no birth record; expire-now/extend
 * gate on the presenting key being the creator; the tombstone reads expiry from
 * it. Durable books have no write path to any expiry field.
 *
 * Every mutating surface here is enabled ONLY where ALLOW_BENCHMARK_OPS ===
 * "true" (routes/workspaces.ts gates the routes with a 404 when off). This
 * module assumes that gate has already passed — it does not re-check the flag.
 *
 * PERSONA HYGIENE (corpus recipe bc30ced3): a workspace description renders
 * verbatim inside get_briefing for any persona briefed against a key that can
 * read the book. Keep benchmark-framing labels ("EVAL DATA") OUT of the
 * description — the route docs carry this warning for callers.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { deleteTraceCascade } from "./trace-delete.service";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Default TTL when the caller supplies no ttlDays. The operator's working
 *  figure is "create at ~60 days, dispose earlier when done". No MAX cap —
 *  the operator waived it (controlled benchmark environments only). */
export const DEFAULT_TTL_DAYS = 60;

/** Per-key ceiling on concurrently-LIVE (unexpired) ephemeral workspaces (audit
 *  F59). Generous — legitimate benchmark use creates a handful per run and
 *  disposes them; the cap bounds a leaked/looping key's damage. Override via
 *  EPHEMERAL_MAX_LIVE_PER_KEY. */
export const DEFAULT_MAX_LIVE_PER_KEY = 50;

export function maxLivePerKey(): number {
  const raw = Number(process.env["EPHEMERAL_MAX_LIVE_PER_KEY"]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_LIVE_PER_KEY;
}

// ── Errors (mapped to HTTP status by the route) ──────────────────────────────

export class EphemeralWorkspaceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "EphemeralWorkspaceError";
  }
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateEphemeralWorkspaceInput {
  db: PostgresJsDatabase;
  /** api_keys.id of the presenting (scoped) key — the key its scope widens. */
  keyId: string;
  /** Owning user of the presenting key. */
  userId: string;
  name?: string | undefined;
  description?: string | undefined;
  /** TTL in days from now. Defaults to DEFAULT_TTL_DAYS. Must be > 0. */
  ttlDays?: number | undefined;
}

export interface CreateEphemeralWorkspaceResult {
  recipeBookId: string;
  slug: string;
  name: string;
  expiresAt: string;
}

/**
 * Create a born-ephemeral recipe book, atomically widening ONLY the presenting
 * key's own scope by exactly the new book id (capability self-binding — never a
 * caller-supplied target). The book attaches to the key user's personal org.
 * All-or-nothing: if the key died mid-create (rotation/expiry), the scope
 * append updates zero rows and the whole transaction rolls back, so no orphan
 * book is ever left bound to a dead key (audit F60).
 */
export async function createEphemeralWorkspace(
  input: CreateEphemeralWorkspaceInput,
): Promise<CreateEphemeralWorkspaceResult> {
  const { db, keyId, userId } = input;

  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    throw new EphemeralWorkspaceError(400, "ttlDays must be a positive number.");
  }
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  // Live-workspace cap (audit F59) — count this key's unexpired workspaces.
  const liveRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM claimnet.ephemeral_books
    WHERE created_by_key_id = ${keyId}::uuid
      AND expires_at > NOW()
  `);
  const live = (liveRows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  if (live >= maxLivePerKey()) {
    throw new EphemeralWorkspaceError(
      429,
      `Live ephemeral workspace cap reached (max ${maxLivePerKey()} per key). Dispose an existing workspace (expire-now) before creating another.`,
    );
  }

  // Resolve the org: the pinned personal org, falling back to the oldest owned
  // org (mirrors import.service.createImportBook) for a user whose pointer was
  // never backfilled.
  const orgRows = await db.execute(sql`
    SELECT COALESCE(
      (SELECT personal_organization_id FROM claimnet.users WHERE id = ${userId}::uuid),
      (SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
        ORDER BY is_personal DESC, created_at ASC, id ASC LIMIT 1)
    ) AS org_id
  `);
  const orgId = (orgRows as unknown as Array<{ org_id: string | null }>)[0]?.org_id;
  if (!orgId) {
    throw new EphemeralWorkspaceError(400, "No organization owned by this account — cannot create a workspace.");
  }

  const bookName = input.name && input.name.trim().length > 0
    ? input.name.trim().slice(0, 200)
    : `Ephemeral workspace ${new Date().toISOString().slice(0, 10)}`;
  const description = input.description && input.description.trim().length > 0
    ? input.description.trim().slice(0, 1000)
    : null;
  // Timestamp+random slug: unique per org without a retry loop (import pattern).
  const slug = `ephemeral-${Date.now().toString(36)}${crypto.randomInt(0, 1296).toString(36).padStart(2, "0")}`;

  return db.transaction(async (tx) => {
    const groupRows = await tx.execute(sql`
      INSERT INTO claimnet.groups (name, slug, organization_id, description)
      VALUES (${bookName}, ${slug}, ${orgId}::uuid, ${description})
      RETURNING id
    `);
    const groupId = (groupRows as unknown as Array<{ id: string }>)[0]?.id;
    if (!groupId) throw new EphemeralWorkspaceError(500, "Failed to create workspace.");

    // Creator membership — opted into daily-link read+write, mirroring
    // createImportBook / POST /recipe-books (owner books, not invite accepts).
    await tx.execute(sql`
      INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write)
      VALUES (${groupId}::uuid, ${userId}::uuid, 'owner', true, true)
    `);

    // Birth record — presence marks the book ephemeral; the reaper joins here.
    await tx.execute(sql`
      INSERT INTO claimnet.ephemeral_books (group_id, created_by_key_id, created_by_user_id, expires_at)
      VALUES (${groupId}::uuid, ${keyId}::uuid, ${userId}::uuid, ${expiresAt.toISOString()}::timestamptz)
    `);

    // Capability self-binding (audit F60): append EXACTLY this book id to the
    // presenting key's own read+write arrays, in one atomic statement guarded
    // on the key still being live. Zero rows updated ⇒ the key expired/consumed
    // mid-create ⇒ roll back so no orphan book is bound to a dead key.
    const bindRows = await tx.execute(sql`
      UPDATE claimnet.api_keys
      SET read_group_ids = array_append(read_group_ids, ${groupId}::uuid),
          write_group_ids = array_append(write_group_ids, ${groupId}::uuid)
      WHERE id = ${keyId}::uuid
        AND expires_at > NOW()
        AND consumed_at IS NULL
        AND NOT (${groupId}::uuid = ANY(read_group_ids))
      RETURNING id
    `);
    if ((bindRows as unknown as Array<{ id: string }>).length === 0) {
      throw new EphemeralWorkspaceError(409, "Key is no longer valid — workspace not created.");
    }

    return {
      recipeBookId: groupId,
      slug,
      name: bookName,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

// ── Expire-now / set-expiry (creator-key-only) ───────────────────────────────

export interface SetExpiryResult {
  recipeBookId: string;
  expiresAt: string;
  /** True the instant expiry is at or before now — the book is tombstoned
   *  (retrieval-invisible + write-refusing) even before the reaper runs. */
  tombstoned: boolean;
}

/**
 * Shorten OR extend a born-ephemeral book's TTL (expire-now = pass a past/now
 * timestamp). Gated on the book having a birth record AND the presenting key
 * being its creator — any other case returns a uniform 404 that mutates
 * nothing (audit F55/F56: no oracle for durable books or other keys' books).
 * No max cap and no extension audit row (operator waived): extend is a plain
 * metadata write.
 */
export async function setEphemeralExpiry(
  db: PostgresJsDatabase,
  groupId: string,
  keyId: string,
  expiresAt: Date,
): Promise<SetExpiryResult> {
  // Update only when the row exists AND this key created it — a single guarded
  // statement, so "not ephemeral", "not creator", and "doesn't exist" are
  // indistinguishable (zero rows updated → uniform 404).
  const rows = await db.execute(sql`
    UPDATE claimnet.ephemeral_books
    SET expires_at = ${expiresAt.toISOString()}::timestamptz
    WHERE group_id = ${groupId}::uuid
      AND created_by_key_id = ${keyId}::uuid
    RETURNING expires_at
  `);
  const row = (rows as unknown as Array<{ expires_at: string }>)[0];
  if (!row) {
    throw new EphemeralWorkspaceError(404, "Workspace not found.");
  }
  const effective = new Date(row.expires_at);
  return {
    recipeBookId: groupId,
    expiresAt: effective.toISOString(),
    tombstoned: effective.getTime() <= Date.now(),
  };
}

// ── Tombstone: the single scope-resolution seam (audit F57) ──────────────────

/**
 * Of the given book ids, return the set that are TOMBSTONED — a born-ephemeral
 * book whose expiry has passed. Consumers subtract this from read scope and
 * reject writes whose target is in it, so a book leaves search/briefings/counts
 * (and refuses deposits) the instant its expiry passes, before the reaper runs.
 * Durable books never appear here (no ephemeral_books row).
 */
export async function listTombstonedGroupIds(
  db: PostgresJsDatabase,
  groupIds: string[],
): Promise<Set<string>> {
  if (groupIds.length === 0) return new Set();
  const rows = await db.execute(sql`
    SELECT group_id
    FROM claimnet.ephemeral_books
    WHERE expires_at <= NOW()
      AND group_id = ANY(ARRAY[${sql.join(groupIds.map((g) => sql`${g}::uuid`), sql`,`)}]::uuid[])
  `);
  return new Set((rows as unknown as Array<{ group_id: string }>).map((r) => r.group_id));
}

/** Convenience: the live (non-tombstoned) subset of the given ids, order
 *  preserved. Used at read-scope resolution. */
export async function excludeTombstoned(
  db: PostgresJsDatabase,
  groupIds: string[],
): Promise<string[]> {
  const dead = await listTombstonedGroupIds(db, groupIds);
  return dead.size === 0 ? groupIds : groupIds.filter((g) => !dead.has(g));
}

// ── Reaper ───────────────────────────────────────────────────────────────────

export interface ReapBookResult {
  recipeBookId: string;
  tracesDeleted: number;
  evidenceDeleted: number;
  referencesDeleted: number;
  orphanSourcesDeleted: number;
  membershipsDeleted: number;
  invitationsDeleted: number;
  scopesRepaired: number;
}

/**
 * Physically reap one expired ephemeral book. Idempotent and lock-safe,
 * following the deleteUserCascade discipline (corpus recipe 9517f6f4): a
 * transaction PER TRACE (via deleteTraceCascade, which takes the FOR UPDATE
 * lock that excludes the worker's strategy-backfill race, recipe f6025747),
 * then ONE small final teardown transaction — never a long lock held across the
 * whole book.
 *
 * Leaves ZERO rows referencing the book's group_id (audit F61): traces + their
 * evidence/reference/embedding subgraph, any remaining orphaned embedding
 * sources for the group, memberships, pending invitations, the birth record,
 * the groups row, and the id purged from every api key's scope arrays (with a
 * dangling default_write_group_id repaired to the first remaining write id).
 *
 * The reap audit row is written INSIDE the final teardown transaction, so a
 * lost audit rolls back the deletion too and the reaper re-attempts next tick —
 * the destroy trail can never vanish into a best-effort console.error (F58).
 */
export async function reapEphemeralBook(
  db: PostgresJsDatabase,
  groupId: string,
): Promise<ReapBookResult> {
  let tracesDeleted = 0;
  let evidenceDeleted = 0;
  let referencesDeleted = 0;

  // Phase 1: cascade the book's traces, one transaction per trace.
  const traceRows = await db.execute(sql`
    SELECT id FROM claimnet.traces WHERE group_id = ${groupId}::uuid
  `);
  const traceIds = (traceRows as unknown as Array<{ id: string }>).map((r) => r.id);
  for (const traceId of traceIds) {
    const result = await deleteTraceCascade({ db, traceId, actorUserId: null });
    tracesDeleted++;
    evidenceDeleted += result.evidenceDeleted;
    referencesDeleted += result.referencesDeleted;
  }

  // Phase 2: small final teardown, all-or-nothing with the audit row.
  return db.transaction(async (tx) => {
    // Any embedding sources still attributed to this book (evidence/reference
    // orphans, or import stubs never linked to a surviving trace) — the
    // integrity endpoint attributes orphans by embedding_sources.group_id, so
    // these must go or they surface as permanent orphans (audit F61).
    const orphanSrcRows = await tx.execute(sql`
      SELECT id FROM claimnet.embedding_sources WHERE group_id = ${groupId}::uuid
    `);
    const orphanSourceIds = (orphanSrcRows as unknown as Array<{ id: string }>).map((r) => r.id);
    let orphanSourcesDeleted = 0;
    if (orphanSourceIds.length > 0) {
      const idArray = sql`ARRAY[${sql.join(orphanSourceIds.map((i) => sql`${i}::uuid`), sql`,`)}]::uuid[]`;
      await tx.execute(sql`
        DELETE FROM claimnet.embedding_vectors
        WHERE embedding_chunk_id IN (
          SELECT ec.id FROM claimnet.embedding_chunks ec
          WHERE ec.embedding_source_id = ANY(${idArray})
        )`);
      await tx.execute(sql`
        DELETE FROM claimnet.embedding_chunks WHERE embedding_source_id = ANY(${idArray})`);
      await tx.execute(sql`
        DELETE FROM claimnet.embedding_chunk_strategies WHERE embedding_source_id = ANY(${idArray})`);
      const del = await tx.execute(sql`
        DELETE FROM claimnet.embedding_sources WHERE id = ANY(${idArray}) RETURNING id`);
      orphanSourcesDeleted = (del as unknown as Array<{ id: string }>).length;
    }

    const memRows = await tx.execute(sql`
      DELETE FROM claimnet.group_members WHERE group_id = ${groupId}::uuid RETURNING id
    `);
    const membershipsDeleted = (memRows as unknown as Array<{ id: string }>).length;

    const invRows = await tx.execute(sql`
      DELETE FROM claimnet.invitations WHERE group_id = ${groupId}::uuid RETURNING id
    `);
    const invitationsDeleted = (invRows as unknown as Array<{ id: string }>).length;

    // Purge the book id from EVERY key's scope arrays, and repair a
    // default_write_group_id that pointed at it to the first remaining write id
    // (checked recipe 11d5490e: default_write typically points at the user's
    // personal book, set at key mint; a reaped book landing there is an
    // external-tampering edge case, repaired locally rather than with a policy
    // default). If no write ids remain, COALESCE keeps the old value — a
    // separately-broken key we don't invent a target for.
    const scopeRows = await tx.execute(sql`
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
      RETURNING id
    `);
    const scopesRepaired = (scopeRows as unknown as Array<{ id: string }>).length;

    // Birth record, then the book row itself. (group_id FK is ON DELETE
    // CASCADE, so the groups delete would also drop the birth record — deleting
    // it explicitly first keeps the reap self-describing and order-independent.)
    await tx.execute(sql`DELETE FROM claimnet.ephemeral_books WHERE group_id = ${groupId}::uuid`);
    await tx.execute(sql`DELETE FROM claimnet.groups WHERE id = ${groupId}::uuid`);

    // Reap audit row — written IN this transaction (F58). Uses raw INSERT (not
    // the best-effort writeAudit) so it commits atomically with the deletion.
    const metadata = {
      tracesDeleted,
      evidenceDeleted,
      referencesDeleted,
      orphanSourcesDeleted,
      membershipsDeleted,
      invitationsDeleted,
      scopesRepaired,
    };
    await tx.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (NULL, 'recipe_book.reaped', 'group', ${groupId}::uuid, ${JSON.stringify(metadata)}::jsonb)
    `);

    return { recipeBookId: groupId, ...metadata };
  });
}

/**
 * Reap ALL expired ephemeral books. The scan is FROM ephemeral_books JOINed to
 * groups, so it structurally cannot pick a book with no birth record (audit
 * F56). Per-book failures are logged and skipped so one bad book doesn't strand
 * the rest; the next tick retries it (reapEphemeralBook is idempotent).
 */
export async function reapExpiredEphemeralBooks(
  db: PostgresJsDatabase,
): Promise<{ booksReaped: number; results: ReapBookResult[] }> {
  const rows = await db.execute(sql`
    SELECT eb.group_id
    FROM claimnet.ephemeral_books eb
    JOIN claimnet.groups g ON g.id = eb.group_id
    WHERE eb.expires_at <= NOW()
    ORDER BY eb.expires_at ASC
  `);
  const groupIds = (rows as unknown as Array<{ group_id: string }>).map((r) => r.group_id);

  const results: ReapBookResult[] = [];
  for (const groupId of groupIds) {
    try {
      results.push(await reapEphemeralBook(db, groupId));
    } catch (err) {
      console.error(`[ephemeral-reaper] Failed to reap book ${groupId} (will retry next tick):`, err);
    }
  }
  return { booksReaped: results.length, results };
}
