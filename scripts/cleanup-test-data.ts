/**
 * Clean up accumulated test data from integration test runs.
 *
 * Removes test users (email matching *@test.local) and all their
 * associated data: orgs, groups, group_members, API keys, traces,
 * evidence, references, embedding pipeline rows.
 *
 * Usage:
 *   source .env && npx tsx scripts/cleanup-test-data.ts
 *   source .env && npx tsx scripts/cleanup-test-data.ts --status  # just show counts
 *
 * Safe to run anytime — only affects @test.local users, never real users.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Run: source .env && npx tsx scripts/cleanup-test-data.ts");
  process.exit(1);
}

const statusOnly = process.argv[2] === "--status";

const client = postgres(databaseUrl);
const db = drizzle(client);

async function showStatus(): Promise<void> {
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM claimnet.users WHERE email LIKE '%@test.local')::int AS test_users,
      (SELECT count(*) FROM claimnet.organizations WHERE owner_id IN (
        SELECT id FROM claimnet.users WHERE email LIKE '%@test.local'
      ))::int AS test_orgs,
      (SELECT count(*) FROM claimnet.groups WHERE organization_id IN (
        SELECT id FROM claimnet.organizations WHERE owner_id IN (
          SELECT id FROM claimnet.users WHERE email LIKE '%@test.local'
        )
      ))::int AS test_groups,
      (SELECT count(*) FROM claimnet.traces WHERE user_id IN (
        SELECT id FROM claimnet.users WHERE email LIKE '%@test.local'
      ))::int AS test_traces
  `);
  const row = (counts as unknown as Array<Record<string, number>>)[0]!;
  console.log("\n=== Test Data Status ===");
  console.log(`  Test users (@test.local): ${row["test_users"]}`);
  console.log(`  Test organizations: ${row["test_orgs"]}`);
  console.log(`  Test groups: ${row["test_groups"]}`);
  console.log(`  Test traces: ${row["test_traces"]}`);
  console.log("");
}

async function cleanup(): Promise<void> {
  // Get test user IDs
  const testUsers = await db.execute(sql`
    SELECT id FROM claimnet.users WHERE email LIKE '%@test.local'
  `);
  const userIds = (testUsers as unknown as Array<{ id: string }>).map(r => r.id);

  if (userIds.length === 0) {
    console.log("No test users found. Nothing to clean.");
    return;
  }

  const userIdsSql = sql.join(userIds.map(id => sql`${id}::uuid`), sql`, `);

  console.log(`Cleaning up ${userIds.length} test users...`);

  // Delete traces and their linked data
  const traceIds = await db.execute(sql`
    SELECT id FROM claimnet.traces WHERE user_id IN (${userIdsSql})
  `);
  const tIds = (traceIds as unknown as Array<{ id: string }>).map(r => r.id);

  if (tIds.length > 0) {
    const tIdsSql = sql.join(tIds.map(id => sql`${id}::uuid`), sql`, `);

    // Embedding pipeline
    await db.execute(sql`
      DELETE FROM claimnet.embedding_vectors WHERE embedding_chunk_id IN (
        SELECT ec.id FROM claimnet.embedding_chunks ec
        JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
        WHERE es.source_type = 'trace' AND es.source_id IN (${tIdsSql})
      )
    `);
    await db.execute(sql`
      DELETE FROM claimnet.embedding_chunks WHERE embedding_source_id IN (
        SELECT id FROM claimnet.embedding_sources
        WHERE source_type = 'trace' AND source_id IN (${tIdsSql})
      )
    `);
    await db.execute(sql`
      DELETE FROM claimnet.embedding_chunk_strategies WHERE embedding_source_id IN (
        SELECT id FROM claimnet.embedding_sources
        WHERE source_type = 'trace' AND source_id IN (${tIdsSql})
      )
    `);
    await db.execute(sql`
      DELETE FROM claimnet.embedding_sources
      WHERE source_type = 'trace' AND source_id IN (${tIdsSql})
    `);

    // Linking tables
    await db.execute(sql`DELETE FROM claimnet.trace_evidence WHERE trace_id IN (${tIdsSql})`);
    await db.execute(sql`DELETE FROM claimnet.trace_references WHERE trace_id IN (${tIdsSql})`);

    // Traces themselves
    await db.execute(sql`DELETE FROM claimnet.traces WHERE id IN (${tIdsSql})`);
    console.log(`  Deleted ${tIds.length} test traces + embedding data`);
  }

  // API keys
  await db.execute(sql`DELETE FROM claimnet.api_keys WHERE user_id IN (${userIdsSql})`);

  // Group members
  await db.execute(sql`DELETE FROM claimnet.group_members WHERE user_id IN (${userIdsSql})`);

  // Groups owned by test orgs
  const testOrgIds = await db.execute(sql`
    SELECT id FROM claimnet.organizations WHERE owner_id IN (${userIdsSql})
  `);
  const orgIds = (testOrgIds as unknown as Array<{ id: string }>).map(r => r.id);
  if (orgIds.length > 0) {
    const orgIdsSql = sql.join(orgIds.map(id => sql`${id}::uuid`), sql`, `);
    await db.execute(sql`DELETE FROM claimnet.groups WHERE organization_id IN (${orgIdsSql})`);
    await db.execute(sql`DELETE FROM claimnet.organizations WHERE id IN (${orgIdsSql})`);
    console.log(`  Deleted ${orgIds.length} test organizations + groups`);
  }

  // Users
  await db.execute(sql`DELETE FROM claimnet.users WHERE id IN (${userIdsSql})`);
  console.log(`  Deleted ${userIds.length} test users`);
}

async function main(): Promise<void> {
  await showStatus();
  if (!statusOnly) {
    await cleanup();
    console.log("");
    await showStatus();
  }
  await client.end();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
