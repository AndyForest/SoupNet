import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

/**
 * Integration tests for trace.service.ts — requires running Docker postgres + backend.
 * Skips gracefully if DATABASE_URL is not set or database is unreachable.
 */

// Lazy imports — modules loaded dynamically in beforeAll when DATABASE_URL is available.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let submitAndSearch: typeof import("./trace.service").submitAndSearch;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const uid = Date.now();

// Test state populated in beforeAll
let userId: string;
let groupId: string;
let apiKeyId: string;
let rawKey: string;
let rawKey2: string;

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

describe.skipIf(!canConnect())("trace.service integration", () => {
  beforeAll(async () => {
    // Dynamic imports to avoid module-level errors when DATABASE_URL is missing
    const dbMod = await import("../db");
    const traceMod = await import("./trace.service");
    const drizzleMod = await import("drizzle-orm");
    getDb = dbMod.getDb;
    submitAndSearch = traceMod.submitAndSearch;
    sql = drizzleMod.sql;

    const db = getDb();

    // Create test user (pre-verified — F15 hard gate requires verified email
    // for API key validation, so direct-SQL test users must be marked verified)
    const userRows = await db.execute(sql`
      INSERT INTO claimnet.users (id, email, password_hash, role, email_verified_at)
      VALUES (
        gen_random_uuid(),
        ${`test-trace-svc-${uid}@test.local`},
        ${await (await import("bcryptjs")).default.hash("testpass", 4)},
        'tenant',
        NOW()
      )
      RETURNING id
    `);
    userId = (userRows as unknown as Array<{ id: string }>)[0]!.id;

    // Create test org
    const orgRows = await db.execute(sql`
      INSERT INTO claimnet.organizations (id, name, slug, owner_id, is_personal)
      VALUES (
        gen_random_uuid(),
        ${`Test Org ${uid}`},
        ${`test-trace-svc-${uid}`},
        ${userId}::uuid,
        true
      )
      RETURNING id
    `);
    const orgId = (orgRows as unknown as Array<{ id: string }>)[0]!.id;

    // Create test group
    const groupRows = await db.execute(sql`
      INSERT INTO claimnet.groups (id, name, slug, organization_id)
      VALUES (
        gen_random_uuid(),
        ${`Test Group ${uid}`},
        ${`test-trace-svc-grp-${uid}`},
        ${orgId}::uuid
      )
      RETURNING id
    `);
    groupId = (groupRows as unknown as Array<{ id: string }>)[0]!.id;

    // Add user to group
    await db.execute(sql`
      INSERT INTO claimnet.group_members (group_id, user_id, role)
      VALUES (${groupId}::uuid, ${userId}::uuid, 'owner')
    `);

    // Create API key 1
    rawKey = `cn_d_testkey1_${uid}`;
    const hashedKey = hashKey(rawKey);
    const keyRows = await db.execute(sql`
      INSERT INTO claimnet.api_keys (id, key, key_prefix, user_id, read_group_ids, write_group_ids, default_write_group_id, key_type, expires_at, created_at)
      VALUES (
        gen_random_uuid(),
        ${hashedKey},
        ${rawKey.slice(0, 8)},
        ${userId}::uuid,
        ARRAY[${groupId}::uuid],
        ARRAY[${groupId}::uuid],
        ${groupId}::uuid,
        'daily',
        (NOW() + interval '1 day')::timestamptz,
        NOW()
      )
      RETURNING id
    `);
    apiKeyId = (keyRows as unknown as Array<{ id: string }>)[0]!.id;

    // Create API key 2 (different key, same user)
    rawKey2 = `cn_d_testkey2_${uid}`;
    const hashedKey2 = hashKey(rawKey2);
    await db.execute(sql`
      INSERT INTO claimnet.api_keys (id, key, key_prefix, user_id, read_group_ids, write_group_ids, default_write_group_id, key_type, expires_at, created_at)
      VALUES (
        gen_random_uuid(),
        ${hashedKey2},
        ${rawKey2.slice(0, 8)},
        ${userId}::uuid,
        ARRAY[${groupId}::uuid],
        ARRAY[${groupId}::uuid],
        ${groupId}::uuid,
        'daily',
        (NOW() + interval '1 day')::timestamptz,
        NOW()
      )
      RETURNING id
    `);
  });

  it("submits a trace and returns results", async () => {
    const result = await submitAndSearch({
      key: rawKey,
      traceText: `Integration test trace ${uid} — first submission`,
      evidenceFor: `Test evidence for integration.\n> "Test quote"\n— Test source, ${uid}`,
    });

    expect(result.error).toBeUndefined();
    expect(result.traceId).toBeDefined();
    expect(typeof result.traceId).toBe("string");
    expect(result.currentPage).toBe(1);
  });

  it("is idempotent — same key + group + text returns existing trace", async () => {
    const traceText = `As a test engineer, I prefer idempotent submissions so that repeated requests don't create duplicates — test ${uid}`;
    const evidenceFor = `Idempotent evidence.\n> "Same quote"\n— Same source`;

    const result1 = await submitAndSearch({
      key: rawKey,
      traceText,
      evidenceFor,
    });

    const result2 = await submitAndSearch({
      key: rawKey,
      traceText,
      evidenceFor,
    });

    expect(result1.error).toBeUndefined();
    expect(result2.error).toBeUndefined();
    expect(result1.traceId).toBe(result2.traceId);

    // Verify only one trace exists with this text
    const db = getDb();
    const claimTextHash = crypto.createHash("sha256").update(traceText).digest("hex");
    const rows = await db.execute(sql`
      SELECT count(*)::int AS cnt FROM claimnet.traces
      WHERE api_key_id = ${apiKeyId}::uuid
        AND group_id = ${groupId}::uuid
        AND claim_text_hash = ${claimTextHash}
    `);
    const count = (rows as unknown as Array<{ cnt: number }>)[0]!.cnt;
    expect(count).toBe(1);
  });

  it("different API key creates a new trace for the same text", async () => {
    const traceText = `As a test engineer, I prefer that different API keys create separate traces so that coverage diversity is tracked — test ${uid}`;
    const evidenceFor = `Different key evidence.\n> "Quote"\n— Source`;

    const result1 = await submitAndSearch({
      key: rawKey,
      traceText,
      evidenceFor,
    });

    const result2 = await submitAndSearch({
      key: rawKey2,
      traceText,
      evidenceFor,
    });

    expect(result1.error).toBeUndefined();
    expect(result2.error).toBeUndefined();
    expect(result1.traceId).not.toBe(result2.traceId);
  });

  it("returns search results from tsvector matching", { timeout: 30_000 }, async () => {
    // Use separate real words as unique markers (tsvector needs English stems)
    // Use a real English word + a separate number token so tsvector can index both
    const marker = `xylophone markeruid${uid}`;

    // Submit a trace with a unique marker word
    const firstResult = await submitAndSearch({
      key: rawKey,
      traceText: `As a musician, I prefer the xylophone instrument ${marker} because it produces clear tones for orchestral arrangements.`,
      evidenceFor: `Preference for xylophone tones.\n> "The xylophone cuts through the mix"\n— Rehearsal notes`,
    });

    expect(firstResult.error).toBeUndefined();
    expect(firstResult.traceId).toBeDefined();

    // Submit a second trace with similar meaning to the first.
    // Pure semantic search should find the first trace via vector similarity.
    const searchResult = await submitAndSearch({
      key: rawKey,
      traceText: `As a musician, I prefer the xylophone instrument for clear orchestral tones.`,
      evidenceFor: `Xylophone preference.\n> "Clear tones"\n— Notes`,
    });

    expect(searchResult.error).toBeUndefined();
    // The first trace should appear in results via semantic similarity
    expect(searchResult.results.length).toBeGreaterThan(0);
    // At least one result should mention xylophone (either the first trace or another match)
    const matched = searchResult.results.some((r) =>
      r.claimText.toLowerCase().includes("xylophone"),
    );
    expect(matched).toBe(true);
  });

  it("returns error for invalid API key", async () => {
    const result = await submitAndSearch({
      key: "cn_d_totallyinvalidkey_doesnotexist",
      traceText: "This should fail.",
      evidenceFor: "No evidence needed.",
    });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("Invalid");
    expect(result.traceId).toBeUndefined();
  });

  // ── decided_at (decision archaeology — backfilled judgment dates) ─────────

  it("stores decided_at and keeps created_at as the insertion time", async () => {
    const decidedAt = "2024-03-15T14:30:00.000Z";
    const result = await submitAndSearch({
      key: rawKey,
      traceText: `As a backend developer, I chose pg-boss for queueing so that jobs live in Postgres — archaeology test ${uid}`,
      evidenceFor: `Decision found in commit history.\n> "switch to pg-boss, keeps ops in postgres"\n— commit abc1234, 2024-03-15`,
      decidedAt,
    });

    expect(result.error).toBeUndefined();
    expect(result.traceId).toBeDefined();

    const db = getDb();
    const rows = await db.execute(sql`
      SELECT decided_at AS "decidedAt",
             COALESCE(decided_at, created_at) AS "judgmentAt",
             created_at AS "createdAt"
      FROM claimnet.traces WHERE id = ${result.traceId}::uuid
    `);
    const row = (rows as unknown as Array<{ decidedAt: Date; judgmentAt: Date; createdAt: Date }>)[0]!;
    expect(new Date(row.decidedAt).toISOString()).toBe(decidedAt);
    // Agent-facing surfaces coalesce to the judgment date
    expect(new Date(row.judgmentAt).toISOString()).toBe(decidedAt);
    // Temporal honesty: created_at stays the insertion time, never backdated
    expect(new Date(row.createdAt).getTime()).toBeGreaterThan(Date.parse(decidedAt));
  });

  it("leaves decided_at null for contemporaneous checks", async () => {
    const result = await submitAndSearch({
      key: rawKey,
      traceText: `As a test engineer, I prefer contemporaneous checks to carry no decided_at so that null means "judged when logged" — test ${uid}`,
      evidenceFor: `Contemporaneous evidence.\n> "no backdate"\n— Test source`,
    });

    expect(result.error).toBeUndefined();

    const db = getDb();
    const rows = await db.execute(sql`
      SELECT decided_at AS "decidedAt" FROM claimnet.traces WHERE id = ${result.traceId}::uuid
    `);
    expect((rows as unknown as Array<{ decidedAt: Date | null }>)[0]!.decidedAt).toBeNull();
  });

  it("rejects an unparseable decided_at without inserting", async () => {
    const result = await submitAndSearch({
      key: rawKey,
      traceText: `As a test engineer, I prefer strict date validation so that malformed backdates never enter the corpus — test ${uid}`,
      evidenceFor: `Validation evidence.\n> "strict dates"\n— Test source`,
      decidedAt: "not-a-date",
    });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("decided_at");
    expect(result.traceId).toBeUndefined();
  });

  it("rejects a future decided_at without inserting", async () => {
    const result = await submitAndSearch({
      key: rawKey,
      traceText: `As a test engineer, I prefer rejecting future judgment dates so that backdating can only make recipes older — test ${uid}`,
      evidenceFor: `Validation evidence.\n> "no freshness gaming"\n— Test source`,
      decidedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("future");
    expect(result.traceId).toBeUndefined();
  });
});
