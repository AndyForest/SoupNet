/**
 * Recipe-book access for HUMAN (JWT-path) callers: which books a user can see
 * and what role they hold in one. (Access to a single recipe: trace-access.ts.)
 *
 * This is the read half of the authorization seam (docs/engineering-principles.md
 * §7). Route handlers ask these functions; they do not join
 * `claimnet.group_members` themselves, and `npm run check:authz-seam` fails
 * the build when a new file does.
 *
 * Posture, stated rather than assumed:
 *   - Fail closed. "No membership row" is `null` / `false` / an empty list,
 *     never a thrown error a caller might swallow, and never a default role.
 *   - `userId` comes from the verified JWT. Nothing here trusts a
 *     client-supplied user id, and nothing here reads an API key — agent scope
 *     is frozen on the key at mint time and is a separate mechanism.
 *   - No caching. Every call reads the table, so removing a member takes
 *     effect on their next request.
 *   - Every value is a bound parameter.
 *   - The membership condition comes from membership-sql.ts, never written
 *     out here.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { BookRole } from "./roles";
import { membershipOf } from "./membership-sql";

/** A recipe book as its member sees it: book columns plus their own membership row. */
export interface BookForUser {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  organization_id: string;
  created_at: string;
  member_role: string;
  daily_read: boolean;
  daily_write: boolean;
}

/**
 * The user's role in a recipe book, or null when they are not a member (or the
 * book does not exist — the two are indistinguishable here on purpose).
 */
export async function roleIn(
  db: PostgresJsDatabase,
  userId: string,
  bookId: string,
): Promise<BookRole> {
  const rows = await db.execute(sql`
    SELECT gm.role FROM claimnet.group_members gm
    WHERE gm.group_id = ${bookId}::uuid AND ${membershipOf("gm", userId)}
  `);
  return (rows as unknown as Array<{ role: string }>)[0]?.role ?? null;
}

/** True when the user has a membership row in the book, whatever the role. */
export async function isMember(
  db: PostgresJsDatabase,
  userId: string,
  bookId: string,
): Promise<boolean> {
  // `role` is NOT NULL, so "has a role" and "has a row" are the same fact —
  // and one statement is one place for a future membership predicate to land.
  return (await roleIn(db, userId, bookId)) !== null;
}

/** Ids of every recipe book the user is a member of. */
export async function bookIdsFor(db: PostgresJsDatabase, userId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT gm.group_id AS "groupId"
    FROM claimnet.group_members gm
    WHERE ${membershipOf("gm", userId)}
  `);
  return (rows as unknown as Array<{ groupId: string }>).map((r) => r.groupId);
}

/**
 * Every recipe book the user is a member of, newest first, with their role and
 * daily-link preferences. Column names are the wire shape of GET /recipe-books.
 */
export async function booksFor(db: PostgresJsDatabase, userId: string): Promise<BookForUser[]> {
  const rows = await db.execute(sql`
    SELECT g.id, g.name, g.slug, g.description, g.organization_id, g.created_at,
           gm.role as member_role,
           gm.daily_read as daily_read,
           gm.daily_write as daily_write
    FROM claimnet.groups g
    JOIN claimnet.group_members gm ON gm.group_id = g.id
    WHERE ${membershipOf("gm", userId)}
    ORDER BY g.created_at DESC
  `);
  return rows as unknown as BookForUser[];
}
