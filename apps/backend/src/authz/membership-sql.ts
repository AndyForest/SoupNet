/**
 * The membership condition, written once.
 *
 * Every statement in this module that asks "is this row a membership?" gets
 * its answer from the fragments below, so a condition added to membership
 * later (a deactivation timestamp, provenance) is one edit here rather than a
 * hunt through every query — and cannot be applied to some statements and
 * forgotten in others. membership-sql.test.ts fails when another file in the
 * module writes the condition by hand.
 *
 * Internal to the module: not re-exported from index.ts. Routes and services
 * ask the module's functions; they do not compose membership SQL themselves
 * (docs/engineering-principles.md §7).
 *
 * What does NOT use these fragments, on purpose: statements that act on the
 * stored ROW rather than on "is a member" — inserting a row, and deleting rows
 * by key or when an account goes. A row that stops counting as a membership is
 * still a row, and must stay removable.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * The table aliases the module's statements give `claimnet.group_members`.
 * A closed set, so the only text that ever reaches `sql.raw` is one of these
 * constants; every value is still a bound parameter.
 */
const ALIASES = {
  gm: sql.raw("gm"),
  me: sql.raw("me"),
  other: sql.raw("other"),
} as const;

export type MembershipAlias = keyof typeof ALIASES;

function aliasSql(alias: MembershipAlias): SQL {
  if (!Object.prototype.hasOwnProperty.call(ALIASES, alias)) {
    throw new Error(`Unknown membership alias: ${String(alias)}`);
  }
  return ALIASES[alias];
}

/**
 * The row-level condition: does this `group_members` row count as a
 * membership at all? Today every row does. This is THE place a future
 * condition on membership lands; the two fragments below compose it, and
 * statements that are not about one particular user (member lists, owner
 * counts, succession) use it directly.
 */
export function countsAsMembership(alias: MembershipAlias): SQL {
  aliasSql(alias);
  return sql`TRUE`;
}

/** The row is a membership held by `userId`. */
export function membershipOf(alias: MembershipAlias, userId: string): SQL {
  return sql`(${aliasSql(alias)}.user_id = ${userId}::uuid AND ${countsAsMembership(alias)})`;
}

/** The row is a membership held by anyone other than `userId`. */
export function membershipOfSomeoneElse(alias: MembershipAlias, userId: string): SQL {
  return sql`(${aliasSql(alias)}.user_id <> ${userId}::uuid AND ${countsAsMembership(alias)})`;
}
