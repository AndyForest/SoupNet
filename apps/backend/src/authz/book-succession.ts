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
 * handed on (`sharedBooksOwnedBy`), the books left without members
 * (`memberlessBooksWithOthersRecipes`) and the recipes deleted with the
 * account (`traceIdsInSoleMemberBooksOwnedBy`) can never disagree about who
 * counts as another member. Account deletion never adds anyone to a book
 * [F73, F87]. The two DELETEs at the bottom act on stored rows, not on "is a
 * member": every row goes, whatever it counts as.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { membershipOf, membershipOfSomeoneElse } from "./membership-sql";
import { activeUserPredicate } from "./key-auth";

/** A shared book the departing user is responsible for. */
export interface BookToHandOver {
  id: string;
  slug: string;
  organizationId: string;
  /** True when the book lives in an organization the departing user owns. */
  inOwnedOrg: boolean;
}

/** The member who takes a book over, with the role they held beforehand. */
export interface Successor {
  userId: string;
  role: string;
}

/**
 * Shared books the user is responsible for: books with at least one OTHER
 * member that either live in an organization the user owns, or have the user
 * as a role-'owner' member. Id order (the module's lock order, see
 * `lockBooksForDeparture`); locks each book row.
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
      )
      AND EXISTS (
        SELECT 1 FROM claimnet.group_members other
        WHERE other.group_id = g.id AND ${membershipOfSomeoneElse("other", userId)}
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
 * Who takes the book over when `departingUserId` leaves: another existing
 * owner if there is one; else the longest-standing admin; else the
 * longest-standing member (joined_at, then id, as the tie-break). Null when no
 * other member remains. Locks the chosen membership row.
 *
 * Accounts that can act come first [F75]: the order above is applied to
 * members whose account passes the same user-state predicate key
 * authentication uses (`activeUserPredicate`: verified, not waitlisted, and
 * whatever account-disable condition later lands there), and falls back to
 * the other members only when none does, so a book is never lost for want of
 * an active heir.
 */
export async function pickSuccessor(
  db: PostgresJsDatabase,
  bookId: string,
  departingUserId: string,
): Promise<Successor | null> {
  const rows = await db.execute(sql`
    SELECT gm.user_id AS "userId", gm.role
    FROM claimnet.group_members gm
    JOIN claimnet.users u ON u.id = gm.user_id
    WHERE gm.group_id = ${bookId}::uuid AND ${membershipOfSomeoneElse("gm", departingUserId)}
    ORDER BY ${activeUserPredicate()} DESC,
             CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
             gm.joined_at ASC, gm.id ASC
    LIMIT 1
    FOR UPDATE OF gm
  `);
  return (rows as unknown as Successor[])[0] ?? null;
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
 * Ids of recipes in books of organizations the user owns that have NO member
 * other than the user, and that are not another person's: the user's own, and
 * any whose author has no account left. A book with another member never
 * contributes here, and neither does a recipe by another author who still has
 * an account, member or not [F73]: the conditions are the cascade's own
 * guarantee that another person's recipe is never collected.
 */
export async function traceIdsInSoleMemberBooksOwnedBy(
  db: PostgresJsDatabase,
  userId: string,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT t.id FROM claimnet.traces t
    JOIN claimnet.groups g ON g.id = t.group_id
    WHERE g.organization_id IN (
      SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM claimnet.group_members gm
      WHERE gm.group_id = g.id AND ${membershipOfSomeoneElse("gm", userId)}
    )
    AND NOT EXISTS (
      SELECT 1 FROM claimnet.users author
      WHERE author.id = t.user_id AND author.id <> ${userId}::uuid
    )
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/** A book left without members that still holds another person's recipes. */
export interface MemberlessBook {
  id: string;
  slug: string;
  organizationId: string;
  /** The author of the book's earliest recipe among people other than the departing user. */
  authorUserId: string;
}

/**
 * Books in organizations the user owns that have no member other than the
 * user but still hold recipes by other people (former members who still have
 * an account) [F73]. They are not the user's to delete, and nobody is added
 * to them: the cascade moves each into the personal organization of the
 * author of its earliest remaining recipe (organization_id is NOT NULL, and
 * the user's organizations are going) and leaves it with no members. Id
 * order; locks each book row.
 */
export async function memberlessBooksWithOthersRecipes(
  db: PostgresJsDatabase,
  userId: string,
): Promise<MemberlessBook[]> {
  const rows = await db.execute(sql`
    SELECT g.id, g.slug, g.organization_id AS "organizationId",
      (SELECT t.user_id FROM claimnet.traces t
       JOIN claimnet.users author ON author.id = t.user_id
       WHERE t.group_id = g.id AND t.user_id <> ${userId}::uuid
       ORDER BY t.created_at ASC, t.id ASC LIMIT 1) AS "authorUserId"
    FROM claimnet.groups g
    WHERE g.organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.group_members other
        WHERE other.group_id = g.id AND ${membershipOfSomeoneElse("other", userId)}
      )
      AND EXISTS (
        SELECT 1 FROM claimnet.traces t
        JOIN claimnet.users author ON author.id = t.user_id
        WHERE t.group_id = g.id AND t.user_id <> ${userId}::uuid
      )
    ORDER BY g.id
    FOR UPDATE OF g
  `);
  return rows as unknown as MemberlessBook[];
}

/**
 * Remove every membership row in books of organizations the user owns. Runs
 * after shared books have been handed on and re-homed, so what is left in
 * those organizations is only what is being deleted with the account.
 */
export async function removeMembershipsInOrgsOwnedBy(
  db: PostgresJsDatabase,
  userId: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM claimnet.group_members
    WHERE group_id IN (
      SELECT g.id FROM claimnet.groups g
      WHERE g.organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid
      )
    )
  `);
}

/** Remove every membership the user holds, in any book. */
export async function removeAllMembershipsOf(
  db: PostgresJsDatabase,
  userId: string,
): Promise<void> {
  await db.execute(sql`DELETE FROM claimnet.group_members WHERE user_id = ${userId}::uuid`);
}
