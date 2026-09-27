/**
 * Membership questions and writes that account deletion needs: which shared
 * books a departing user is responsible for, who takes each one over, and the
 * membership rows that go when the account does [F70].
 *
 * Part of the authorization seam (docs/engineering-principles.md §7): the
 * deletion cascade in services/user-delete.service.ts decides WHAT happens to
 * a book; every statement that reads or writes `claimnet.group_members` to
 * answer it lives here. Callers pass their transaction handle as `db`, so the
 * row locks below are held until that transaction ends.
 *
 * Posture matches book-access.ts: fail closed, bound parameters only, no
 * caching. "Is a member" comes from membership-sql.ts throughout, so the books
 * handed on (`sharedBooksOwnedBy`) and the books deleted with the account
 * (`booksDeletedWith`) can never disagree about who counts as another member.
 * Both also count recipes written by anyone else as a reason a book is not
 * the departing user's alone [F73]. The two DELETEs at the bottom act on stored rows, not on
 * "is a member": every row goes, whatever it counts as.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { membershipOf, membershipOfSomeoneElse } from "./membership-sql";
import { activeUserPredicate } from "./key-auth";
import { inBooks } from "./scope-sql";

/**
 * A `claimnet.traces` row aliased `t` is a recipe by another author: someone
 * other than `userId` whose account still exists [F73]. (traces.user_id has
 * no foreign key; a recipe whose author has no account left has nobody to be
 * handed to and goes with the book it is in, as before.)
 */
function byAnotherAuthor(userId: string): SQL {
  return sql`(t.user_id <> ${userId}::uuid AND EXISTS (
    SELECT 1 FROM claimnet.users author WHERE author.id = t.user_id
  ))`;
}

/** A shared book the departing user is responsible for. */
export interface BookToHandOver {
  id: string;
  slug: string;
  organizationId: string;
  /** True when the book lives in an organization the departing user owns. */
  inOwnedOrg: boolean;
}

/**
 * Who takes a book over. `role` is the role they held beforehand, or null for
 * a former author: someone who wrote a recipe in the book but is no longer a
 * member, and is re-added as its owner [F73].
 */
export interface Successor {
  userId: string;
  role: string | null;
}

/**
 * Shared books the user is responsible for. "Shared" means the book holds
 * someone else: another member, or a recipe written by someone else, whether
 * or not that author is still a member [F73] (operator ruling 2026-09-27,
 * Soup.net recipe f46cfc50: "never destroy co-authors' recipes" covers anyone
 * who ever wrote a recipe in the book). "Responsible" means the book lives in
 * an organization the user owns, or the user is one of its owners, or the
 * user is its only member — a book that would otherwise be left with nobody
 * to look after what others wrote in it [F74].
 *
 * In id order, locking each book row (the module's lock order: book rows, in
 * id order, before membership rows; see `lockBooksForDeparture`).
 */
export async function sharedBooksOwnedBy(
  db: PostgresJsDatabase,
  userId: string,
): Promise<BookToHandOver[]> {
  const rows = await db.execute(sql`
    SELECT g.id, g.slug, g.organization_id AS "organizationId",
           (o.owner_id = ${userId}::uuid) AS "inOwnedOrg"
    FROM claimnet.groups g
    JOIN claimnet.organizations o ON o.id = g.organization_id
    WHERE (
        o.owner_id = ${userId}::uuid
        OR EXISTS (
          SELECT 1 FROM claimnet.group_members me
          WHERE me.group_id = g.id AND ${membershipOf("me", userId)} AND me.role = 'owner'
        )
        OR (
          EXISTS (
            SELECT 1 FROM claimnet.group_members me
            WHERE me.group_id = g.id AND ${membershipOf("me", userId)}
          )
          AND NOT EXISTS (
            SELECT 1 FROM claimnet.group_members other
            WHERE other.group_id = g.id AND ${membershipOfSomeoneElse("other", userId)}
          )
        )
      )
      AND (
        EXISTS (
          SELECT 1 FROM claimnet.group_members other
          WHERE other.group_id = g.id AND ${membershipOfSomeoneElse("other", userId)}
        )
        OR EXISTS (
          SELECT 1 FROM claimnet.traces t
          WHERE t.group_id = g.id AND ${byAnotherAuthor(userId)}
        )
      )
    ORDER BY g.id
    FOR UPDATE OF g
  `);
  return rows as unknown as BookToHandOver[];
}

/**
 * Lock every book account deletion may change or delete for the user: books in
 * organizations they own, and books they belong to. One statement, in id
 * order — the same order `sharedBooksOwnedBy` locks in — so two deletions
 * locking overlapping sets queue rather than deadlock [F74].
 *
 * The lock order across the module is: book row first, then membership rows.
 * `removeMember` locks its book before its owner rows, and a membership insert
 * takes a key-share lock on its book, so while these locks are held nobody
 * joins, leaves, or is removed from these books.
 */
export async function lockBooksForDeparture(
  db: PostgresJsDatabase,
  userId: string,
): Promise<void> {
  await db.execute(sql`
    SELECT g.id FROM claimnet.groups g
    WHERE g.organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
      OR EXISTS (
        SELECT 1 FROM claimnet.group_members me
        WHERE me.group_id = g.id AND ${membershipOf("me", userId)}
      )
    ORDER BY g.id
    FOR UPDATE OF g
  `);
}

/**
 * Books deleted with the account, asked after shared books have been handed
 * on: every book still in an organization the user owns, plus any book
 * elsewhere in which the user is the only member and nobody else wrote a
 * recipe [F74]. The second kind would otherwise outlive the account with no
 * member at all: unreachable, unmanageable, and holding a slug. Nothing in it
 * belongs to anyone else, so it goes.
 */
export async function booksDeletedWith(
  db: PostgresJsDatabase,
  userId: string,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT g.id FROM claimnet.groups g
    WHERE g.organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
      OR (
        EXISTS (
          SELECT 1 FROM claimnet.group_members me
          WHERE me.group_id = g.id AND ${membershipOf("me", userId)}
        )
        AND NOT EXISTS (
          SELECT 1 FROM claimnet.group_members other
          WHERE other.group_id = g.id AND ${membershipOfSomeoneElse("other", userId)}
        )
        AND NOT EXISTS (
          SELECT 1 FROM claimnet.traces t
          WHERE t.group_id = g.id AND ${byAnotherAuthor(userId)}
        )
      )
    ORDER BY g.id
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Who takes the book over when `departingUserId` leaves: another existing
 * owner if there is one; else the longest-standing admin; else the
 * longest-standing member (joined_at, then id, as the tie-break); else, when
 * no other member remains, the longest-standing former author — the author
 * of the book's earliest recipe among people who are no longer members, who
 * is re-added as owner (`readmitAsOwner`) [F73]. Null when the book holds
 * nobody else at all.
 *
 * Accounts that can act come first [F75]: the order above is applied to
 * candidates whose account passes the same user-state predicate key
 * authentication uses (`activeUserPredicate`: verified, not waitlisted, and
 * whatever account-disable condition later lands there), and falls back to
 * the others only when none does, so a book is never lost for want of an
 * active heir.
 *
 * Takes no row locks of its own: the caller holds the book's row lock, and
 * every membership change takes that lock first (see
 * `lockBooksForDeparture`), so the candidates cannot change underneath it.
 */
export async function pickSuccessor(
  db: PostgresJsDatabase,
  bookId: string,
  departingUserId: string,
): Promise<Successor | null> {
  const rows = await db.execute(sql`
    WITH candidates AS (
      SELECT gm.user_id, gm.role, gm.joined_at AS since, gm.id::text AS tiebreak
      FROM claimnet.group_members gm
      WHERE gm.group_id = ${bookId}::uuid AND ${membershipOfSomeoneElse("gm", departingUserId)}
      UNION ALL
      SELECT t.user_id, NULL, MIN(t.created_at), t.user_id::text
      FROM claimnet.traces t
      WHERE t.group_id = ${bookId}::uuid AND t.user_id <> ${departingUserId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM claimnet.group_members gm
          WHERE gm.group_id = t.group_id AND ${membershipOf("gm", sql`t.user_id`)}
        )
      GROUP BY t.user_id
    )
    SELECT c.user_id AS "userId", c.role
    FROM candidates c
    JOIN claimnet.users u ON u.id = c.user_id
    ORDER BY ${activeUserPredicate()} DESC,
             CASE c.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
             c.since ASC, c.tiebreak ASC
    LIMIT 1
  `);
  return (rows as unknown as Successor[])[0] ?? null;
}

/**
 * Re-add a former author as the book's owner [F73]. Daily-link reads and
 * writes take the column defaults (excluded), as for any membership the user
 * did not create themselves; they opt in. If a row already exists (it does
 * not count as a membership, or appeared since), it is made the owner row.
 */
export async function readmitAsOwner(
  db: PostgresJsDatabase,
  bookId: string,
  userId: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO claimnet.group_members (group_id, user_id, role)
    VALUES (${bookId}::uuid, ${userId}::uuid, 'owner')
    ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'owner'
  `);
}

/** Make an existing member the book's owner. */
export async function promoteToOwner(
  db: PostgresJsDatabase,
  bookId: string,
  userId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE claimnet.group_members gm SET role = 'owner'
    WHERE gm.group_id = ${bookId}::uuid AND ${membershipOf("gm", userId)}
  `);
}

/**
 * Whether any of the given books holds a recipe written by someone other than
 * the user. The teardown asks this of the books it is about to delete and
 * refuses to go on if the answer is yes [F73]: a book holding another
 * author's recipe is handed on, never deleted, and this holds even if a
 * hand-over was somehow missed (or a recipe landed after it). Nothing is
 * deleted in that case; a retry hands the book on.
 */
export async function booksHoldOthersRecipes(
  db: PostgresJsDatabase,
  bookIds: readonly string[],
  userId: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM claimnet.traces t
      WHERE ${inBooks(sql`t.group_id`, bookIds)} AND ${byAnotherAuthor(userId)}
    ) AS "found"
  `);
  return (rows as unknown as Array<{ found: boolean }>)[0]?.found === true;
}

/**
 * Ids of recipes in the given books whose author has no account left. They
 * have nobody to be handed to, so they go with the book they are in.
 */
export async function authorlessTraceIdsIn(
  db: PostgresJsDatabase,
  bookIds: readonly string[],
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT t.id FROM claimnet.traces t
    WHERE ${inBooks(sql`t.group_id`, bookIds)}
      AND NOT EXISTS (SELECT 1 FROM claimnet.users author WHERE author.id = t.user_id)
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Remove every membership row in the given books — the books being deleted
 * with an account (`booksDeletedWith`), so nothing in them outlives it.
 */
export async function removeMembershipsIn(
  db: PostgresJsDatabase,
  bookIds: readonly string[],
): Promise<void> {
  await db.execute(sql`
    DELETE FROM claimnet.group_members WHERE ${inBooks(sql`group_id`, bookIds)}
  `);
}

/** Remove every membership the user holds, in any book. */
export async function removeAllMembershipsOf(
  db: PostgresJsDatabase,
  userId: string,
): Promise<void> {
  await db.execute(sql`DELETE FROM claimnet.group_members WHERE user_id = ${userId}::uuid`);
}
