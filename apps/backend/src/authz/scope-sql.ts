/**
 * A caller's recipe-book scope, rendered as SQL.
 *
 * Every statement that restricts rows to the books a caller may read or write
 * gets the condition from here, so an empty scope means one thing everywhere:
 * the caller reads (or writes) nothing, and the statement answers normally
 * with no rows and zero counts. An empty scope is ordinary, not a broken
 * credential: key scope is the grant intersected with live membership
 * (key-auth.ts), so a member removed from the only book a key named holds a
 * good key with no books.
 *
 * Hand-writing `col IN (${sql.join(ids, …)})` renders `IN ()` for an empty
 * list, which is a Postgres syntax error: the request fails instead of
 * reading nothing, and a caller has to remember an early return to avoid it.
 * `FALSE` needs no remembering.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * `column IN (bookIds…)`, or `FALSE` when `bookIds` is empty. Every id is a
 * bound parameter cast to uuid. `column` is SQL the calling statement writes
 * itself (for example sql`t.group_id`), never request input.
 */
export function inBooks(column: SQL, bookIds: readonly string[]): SQL {
  if (bookIds.length === 0) return sql`FALSE`;
  return sql`${column} IN (${sql.join(bookIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
}
