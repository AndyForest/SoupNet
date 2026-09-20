/**
 * Recipe-book membership rows: the statements that list, create, change, and
 * remove them. The write half of the authorization seam — see book-access.ts
 * for the posture and docs/engineering-principles.md §7 for the rule.
 *
 * These functions perform the statement they are named for and nothing else.
 * Deciding WHO may call them is the caller's job, using `roleIn` and the role
 * predicates; keeping the two apart is what lets a route read as
 * "gate, then act".
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { groupMembers } from "@soupnet/db";
import { countsAsMembership, membershipOf } from "./membership-sql";

export interface BookMember {
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

export interface DailyPrefs {
  dailyRead: boolean;
  dailyWrite: boolean;
}

/** Members of a book with their email and role, in join order. */
export async function listMembers(db: PostgresJsDatabase, bookId: string): Promise<BookMember[]> {
  const rows = await db.execute(sql`
    SELECT gm.user_id, u.email, gm.role, gm.joined_at
    FROM claimnet.group_members gm
    JOIN claimnet.users u ON u.id = gm.user_id
    WHERE gm.group_id = ${bookId}::uuid AND ${countsAsMembership("gm")}
    ORDER BY gm.joined_at ASC
  `);
  return rows as unknown as BookMember[];
}

/**
 * Make the creator of a new book its owner, opted in to daily-link read and
 * write. The "new books default to excluded" rule applies to memberships
 * gained by invitation or direct add, not to books you create.
 */
export async function addCreatorAsOwner(
  db: PostgresJsDatabase,
  bookId: string,
  userId: string,
): Promise<void> {
  await db.insert(groupMembers).values({
    groupId: bookId,
    userId,
    role: "owner",
    dailyRead: true,
    dailyWrite: true,
  });
}

/** What `addMember` found or made: the stored role, and whether this call created the row. */
export interface AddMemberResult {
  created: boolean;
  /** The role the row actually holds — NOT necessarily the role that was asked for. */
  role: string;
}

/**
 * Add a user to a book. Already a member → nothing is written and their
 * existing role is kept; this function adds, it never changes a role. Either
 * way it returns the row as stored, so a caller reports what is true rather
 * than what it asked for. Daily-link read/write take the column defaults
 * (excluded) — the same anti-spam posture as accepting an invitation; the new
 * member opts in.
 *
 * Both statements address the stored row by its key (see membership-sql.ts on
 * rows versus "is a member").
 */
export async function addMember(
  db: PostgresJsDatabase,
  bookId: string,
  userId: string,
  role: "member" | "admin",
): Promise<AddMemberResult> {
  // Two passes at most: the second only runs if the row that blocked the
  // insert was removed before we could read it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const inserted = await db.execute(sql`
      INSERT INTO claimnet.group_members (group_id, user_id, role)
      VALUES (${bookId}::uuid, ${userId}::uuid, ${role})
      ON CONFLICT (group_id, user_id) DO NOTHING
      RETURNING role
    `);
    const made = (inserted as unknown as Array<{ role: string }>)[0];
    if (made) return { created: true, role: made.role };

    const existing = await db.execute(sql`
      SELECT role FROM claimnet.group_members
      WHERE group_id = ${bookId}::uuid AND user_id = ${userId}::uuid
    `);
    const found = (existing as unknown as Array<{ role: string }>)[0];
    if (found) return { created: false, role: found.role };
  }
  throw new Error("addMember: membership row changed repeatedly while adding");
}

/** How many owners a book has. (The last-owner rule itself lives in `removeMember`.) */
export async function countOwners(db: PostgresJsDatabase, bookId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total FROM claimnet.group_members gm
    WHERE gm.group_id = ${bookId}::uuid AND gm.role = 'owner' AND ${countsAsMembership("gm")}
  `);
  return (rows as unknown as Array<{ total: number }>)[0]?.total ?? 0;
}

/**
 * What `removeMember` did:
 *   - `removed`      — the row is gone
 *   - `not_a_member` — there was no row; nothing changed
 *   - `last_owner`   — refused: the user is the book's only owner; nothing changed
 */
export type RemoveMemberResult = "removed" | "not_a_member" | "last_owner";

/**
 * Remove a user's membership row — unless that would leave the book with no
 * owner. The rule is part of the removal itself, so no caller can forget it
 * or get it subtly wrong:
 *
 *   - Ids are compared by the database as uuids, never as strings, so however
 *     the caller's copy of an id is written it names the same member.
 *   - The book's owner rows are locked (in a fixed order) before the decision.
 *     Two owners leaving at the same moment are serialized: the second waits,
 *     then decides on what the first left behind, and is refused.
 *
 * Pass a transaction handle as `db` to make the removal part of a larger unit;
 * the locks are then held until that transaction ends.
 *
 * The DELETE addresses the stored row by its key rather than through the
 * membership condition: a row that no longer counts as a membership must still
 * be removable.
 */
export async function removeMember(
  db: PostgresJsDatabase,
  bookId: string,
  userId: string,
): Promise<RemoveMemberResult> {
  return db.transaction(async (tx) => {
    const ownerRows = await tx.execute(sql`
      SELECT ${membershipOf("gm", userId)} AS "isTarget"
      FROM claimnet.group_members gm
      WHERE gm.group_id = ${bookId}::uuid AND gm.role = 'owner' AND ${countsAsMembership("gm")}
      ORDER BY gm.id
      FOR UPDATE OF gm
    `);
    const owners = ownerRows as unknown as Array<{ isTarget: boolean }>;
    const targetIsOwner = owners.some((o) => o.isTarget === true);
    if (targetIsOwner && owners.length <= 1) return "last_owner";

    const deleted = await tx.execute(sql`
      DELETE FROM claimnet.group_members
      WHERE group_id = ${bookId}::uuid AND user_id = ${userId}::uuid
      RETURNING id
    `);
    return (deleted as unknown as unknown[]).length > 0 ? "removed" : "not_a_member";
  });
}

/**
 * Update the user's own daily-link preferences for a book; an omitted field is
 * left as it was. Returns the resulting prefs, or null when the user is not a
 * member — the UPDATE is its own membership gate, so there is no window between
 * checking and writing.
 */
export async function updateDailyPrefs(
  db: PostgresJsDatabase,
  bookId: string,
  userId: string,
  prefs: { dailyRead?: boolean | undefined; dailyWrite?: boolean | undefined },
): Promise<DailyPrefs | null> {
  const rows = await db.execute(sql`
    UPDATE claimnet.group_members gm
    SET
      daily_read = COALESCE(${prefs.dailyRead ?? null}::boolean, gm.daily_read),
      daily_write = COALESCE(${prefs.dailyWrite ?? null}::boolean, gm.daily_write)
    WHERE gm.group_id = ${bookId}::uuid AND ${membershipOf("gm", userId)}
    RETURNING gm.daily_read AS "dailyRead", gm.daily_write AS "dailyWrite"
  `);
  return (rows as unknown as DailyPrefs[])[0] ?? null;
}
