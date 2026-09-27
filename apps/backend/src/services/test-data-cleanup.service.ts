import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { deleteUserCascade } from "./user-delete.service";

/**
 * Removes the throwaway accounts automated tests and browser verification
 * create (email ending in @test.local) and everything they own.
 * `scripts/cleanup-test-data.mts` is the command-line wrapper.
 *
 * Not every @test.local account is throwaway: long-lived eval corpora
 * (perma-eval, swelancer-eval, ...) use the domain too, and a blanket sweep
 * deleted ~14k recipes of one on 2026-09-27. Throwaway accounts carry a run
 * timestamp in their name (`e2e-smoke-1790530957031-rjyw`, `probe-1790530584`);
 * a sweep takes only those, and none over MAX_DISPOSABLE_RECIPES.
 */

export const TEST_EMAIL_SUFFIX = "@test.local";

/** Every test account. Narrow it (e.g. `run-123-%@test.local`) to touch one run's accounts only. */
export const ALL_TEST_USERS = `%${TEST_EMAIL_SUFFIX}`;

/**
 * A LIKE pattern may select test accounts only if it ends in the literal
 * "@test.local": a pattern like "%test.local" would also match
 * "someone@nottest.local", and "%@test.local%" would match
 * "someone@test.local.example.com".
 */
export function assertTestUserPattern(emailLike: string): void {
  if (!emailLike.endsWith(TEST_EMAIL_SUFFIX)) {
    throw new Error(`Refusing to clean up "${emailLike}": the pattern must end in "${TEST_EMAIL_SUFFIX}"`);
  }
}

export interface TestDataStatus {
  testUsers: number;
  testOrgs: number;
  testGroups: number;
  testTraces: number;
}

export async function testDataStatus(db: PostgresJsDatabase, emailLike = ALL_TEST_USERS): Promise<TestDataStatus> {
  assertTestUserPattern(emailLike);
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM claimnet.users WHERE email LIKE ${emailLike})::int AS test_users,
      (SELECT count(*) FROM claimnet.organizations WHERE owner_id IN (
        SELECT id FROM claimnet.users WHERE email LIKE ${emailLike}
      ))::int AS test_orgs,
      (SELECT count(*) FROM claimnet.groups WHERE organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id IN (
          SELECT id FROM claimnet.users WHERE email LIKE ${emailLike}
        )
      ))::int AS test_groups,
      (SELECT count(*) FROM claimnet.traces WHERE user_id IN (
        SELECT id FROM claimnet.users WHERE email LIKE ${emailLike}
      ))::int AS test_traces
  `);
  const row = (counts as unknown as Array<Record<string, number>>)[0]!;
  return {
    testUsers: row["test_users"]!,
    testOrgs: row["test_orgs"]!,
    testGroups: row["test_groups"]!,
    testTraces: row["test_traces"]!,
  };
}

/** A name with 10+ consecutive digits carries a run timestamp (epoch seconds or milliseconds). */
const RUN_MARKER = /\d{10,}/;

/** A test account holding more recipes than this is an imported corpus, not a test fixture. */
export const MAX_DISPOSABLE_RECIPES = 1000;

export interface TestUserRow {
  id: string;
  email: string;
  recipeCount: number;
}

export interface KeptTestUser {
  email: string;
  recipeCount: number;
  reason: string;
}

/**
 * Split matched accounts into the ones a sweep may delete and the ones it
 * keeps, with the reason. `explicit` is for a pattern the operator named on
 * purpose (`--only`): then everything it matched is theirs to delete.
 */
export function selectDisposableTestUsers(
  rows: TestUserRow[],
  { explicit = false }: { explicit?: boolean } = {},
): { disposable: TestUserRow[]; kept: KeptTestUser[] } {
  if (explicit) return { disposable: rows, kept: [] };
  const disposable: TestUserRow[] = [];
  const kept: KeptTestUser[] = [];
  for (const row of rows) {
    const localPart = row.email.slice(0, row.email.lastIndexOf("@"));
    if (!RUN_MARKER.test(localPart)) {
      kept.push({ email: row.email, recipeCount: row.recipeCount, reason: "no run timestamp" });
    } else if (row.recipeCount > MAX_DISPOSABLE_RECIPES) {
      kept.push({ email: row.email, recipeCount: row.recipeCount, reason: `over ${MAX_DISPOSABLE_RECIPES} recipes` });
    } else {
      disposable.push(row);
    }
  }
  return { disposable, kept };
}

/** What a cleanup with these options would delete and keep, without deleting anything. */
export async function planTestCleanup(
  db: PostgresJsDatabase,
  { emailLike = ALL_TEST_USERS, explicit = false }: { emailLike?: string; explicit?: boolean } = {},
): Promise<{ disposable: TestUserRow[]; kept: KeptTestUser[] }> {
  assertTestUserPattern(emailLike);
  const rows = await db.execute(sql`
    SELECT u.id, u.email, (SELECT count(*) FROM claimnet.traces t WHERE t.user_id = u.id)::int AS "recipeCount"
    FROM claimnet.users u
    WHERE u.email LIKE ${emailLike}
    ORDER BY u.created_at
  `);
  return selectDisposableTestUsers(rows as unknown as TestUserRow[], { explicit });
}

/**
 * Deletes each disposable matching account through deleteUserCascade, the
 * same path as DELETE /auth/me, rather than a hand-kept table list: shared
 * books are handed on to their remaining members, only what the test
 * account authored is removed, and every table the account-deletion path
 * covers is covered here.
 */
export async function cleanupTestUsers(
  db: PostgresJsDatabase,
  options: { emailLike?: string; explicit?: boolean } = {},
): Promise<{ usersDeleted: number; tracesDeleted: number; booksHandedOver: number; kept: KeptTestUser[] }> {
  const { disposable, kept } = await planTestCleanup(db, options);
  let tracesDeleted = 0;
  let booksHandedOver = 0;
  for (const user of disposable) {
    const result = await deleteUserCascade(db, user.id);
    tracesDeleted += result.tracesDeleted;
    booksHandedOver += result.booksHandedOver.length;
  }
  return { usersDeleted: disposable.length, tracesDeleted, booksHandedOver, kept };
}
