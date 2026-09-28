/**
 * Who may be named as the subject of a draft deposited on their behalf
 * (drafts-and-triage slice 4, rubric S4-M1; build log open question 28,
 * recipe 19b3f331).
 *
 * The check's `on_behalf_of` parameter is an email. It names a person only
 * when that person could resolve the draft now: an account whose email
 * matches (trimmed, case-insensitive, the way `author:` matches) that holds a
 * live write-capable membership in the target book and can act
 * (`activeUserPredicate`, the rule key authentication uses). So "may be
 * named" and "may resolve" can never disagree.
 *
 * Everything else (no account, a member of another book only, no membership,
 * an account that cannot act, a malformed address) is the same null, from
 * the same one statement, so the caller's refusal cannot tell an unknown
 * email from a known one (S4-U1). Membership of the book itself is not
 * secret from a writer of that book, so an accepted name need not look like
 * a refusal.
 *
 * The subject is stored as a user id, never an email: an account registered
 * later with the same address inherits nothing.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { membershipOf } from "./membership-sql";
import { WRITE_ROLES } from "./roles";
import { activeUserPredicate } from "./key-auth";

/** Normalize an `on_behalf_of` value: trimmed and lower-cased; empty means absent. */
export function normalizeOnBehalfOf(raw: unknown): { present: false } | { present: true; email: string } {
  if (raw === undefined || raw === null) return { present: false };
  // A non-string on MCP is a value nobody can be named by: present, and
  // refused like an unknown email (S4-W4).
  if (typeof raw !== "string") return { present: true, email: "" };
  const email = raw.trim().toLowerCase();
  if (email === "") return { present: false };
  return { present: true, email };
}

/**
 * The person `email` names (their user id and stored email), if they may be
 * named as the subject of a draft in `bookId`; otherwise null. One
 * statement, run the same way for every input.
 */
export async function resolveNameableSubject(
  db: Pick<PostgresJsDatabase, "execute">,
  params: { email: string; bookId: string },
): Promise<{ userId: string; email: string } | null> {
  const rows = await db.execute(sql`
    SELECT u.id AS "userId", u.email
    FROM claimnet.users u
    JOIN claimnet.group_members gm
      ON gm.group_id = ${params.bookId}::uuid
      AND ${membershipOf("gm", sql`u.id`)}
      AND gm.role IN (${sql.join(WRITE_ROLES.map((r) => sql`${r}`), sql`, `)})
    WHERE lower(u.email) = ${params.email.trim().toLowerCase()}
      AND ${activeUserPredicate()}
    LIMIT 1
  `);
  return (rows as unknown as Array<{ userId: string; email: string }>)[0] ?? null;
}
