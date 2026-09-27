/**
 * Clean up accumulated test data from integration tests and browser
 * verification runs.
 *
 * Removes throwaway test accounts through the same deletion path as account
 * deletion (deleteUserCascade): what they authored goes, books other people
 * still belong to are handed on, real accounts are never touched. A sweep
 * takes only @test.local accounts whose name carries a run timestamp and
 * that hold at most 1,000 recipes; long-lived eval corpora (perma-eval,
 * swelancer-eval, ...) are kept and listed. The bounds are pinned in
 * apps/backend/src/services/test-data-cleanup.test.ts.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-data.mts --dry-run          # what would go, what stays
 *   npx tsx scripts/cleanup-test-data.mts                    # sweep throwaway test accounts
 *   npx tsx scripts/cleanup-test-data.mts --status           # just show counts
 *   npx tsx scripts/cleanup-test-data.mts --only 'perma-eval@test.local'
 *       # an explicitly named pattern: everything it matches goes, eval corpora included
 *
 * Needs DATABASE_URL, or the PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
 * PGDATABASE) the backend also accepts.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  ALL_TEST_USERS,
  assertTestUserPattern,
  cleanupTestUsers,
  planTestCleanup,
  testDataStatus,
  type KeptTestUser,
} from "../apps/backend/src/services/test-data-cleanup.service";

// DATABASE_URL, or the PG* set, as apps/backend/src/db.ts accepts.
function connectionUrl(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const host = process.env["PGHOST"];
  if (!host) return undefined;
  const u = new URL("postgresql://localhost");
  u.hostname = host;
  u.port = process.env["PGPORT"] ?? "5432";
  u.username = encodeURIComponent(process.env["PGUSER"] ?? "");
  u.password = encodeURIComponent(process.env["PGPASSWORD"] ?? "");
  u.pathname = `/${process.env["PGDATABASE"] ?? ""}`;
  return u.toString();
}

const databaseUrl = connectionUrl();
if (!databaseUrl) {
  console.error("Set DATABASE_URL, or PGHOST + PGPORT + PGUSER + PGPASSWORD + PGDATABASE (e.g. `node --env-file=.env`).");
  process.exit(1);
}

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const dryRun = args.includes("--dry-run");
const onlyIndex = args.indexOf("--only");
const explicit = onlyIndex >= 0;
const emailLike = explicit ? (args[onlyIndex + 1] ?? "") : ALL_TEST_USERS;
assertTestUserPattern(emailLike);

const client = postgres(databaseUrl);
const db = drizzle(client);

async function printStatus(): Promise<void> {
  const s = await testDataStatus(db, emailLike);
  console.log(`\n=== Test data matching ${emailLike} ===`);
  console.log(`  Test users: ${s.testUsers}`);
  console.log(`  Test organizations: ${s.testOrgs}`);
  console.log(`  Test recipe books: ${s.testGroups}`);
  console.log(`  Test traces: ${s.testTraces}`);
  console.log("");
}

function printKept(kept: KeptTestUser[]): void {
  if (kept.length === 0) return;
  console.log(`Kept ${kept.length} account(s):`);
  for (const k of kept) console.log(`  ${k.email}  (${k.recipeCount} recipes; ${k.reason})`);
  console.log("");
}

async function main(): Promise<void> {
  await printStatus();
  if (statusOnly) return;
  if (dryRun) {
    const plan = await planTestCleanup(db, { emailLike, explicit });
    const recipes = plan.disposable.reduce((n, u) => n + u.recipeCount, 0);
    console.log(`Would delete ${plan.disposable.length} account(s) holding ${recipes} recipes.`);
    printKept(plan.kept);
    return;
  }
  const r = await cleanupTestUsers(db, { emailLike, explicit });
  console.log(`Deleted ${r.usersDeleted} test users and ${r.tracesDeleted} traces; handed on ${r.booksHandedOver} shared books.`);
  printKept(r.kept);
  await printStatus();
}

main()
  .then(() => client.end())
  .catch(async (err) => {
    console.error("Cleanup failed:", err);
    await client.end();
    process.exit(1);
  });
