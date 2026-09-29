import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import {
  assertTestUserPattern,
  MAX_DISPOSABLE_RECIPES,
  selectDisposableTestUsers,
} from "./test-data-cleanup.service";
import { seedVerifiedUser } from "../test-users";

/**
 * Bounds for the test-data cleanup (scripts/cleanup-test-data.mts). It runs
 * against a developer's own database, where real accounts sit beside the
 * @test.local ones, so what it must NOT touch matters as much as what it
 * removes:
 *
 *   - only accounts whose email ends in @test.local, within the pattern given
 *   - a real account's recipes survive, even in a book a test account owns
 *     (the book is handed on, as account deletion does [F70])
 *   - a real account's own book stays whole when a test account was a member;
 *     only the test account's recipes in it go
 *
 * Each run scopes the cleanup to its own accounts (`cleanup-<run>-%@test.local`)
 * so it never removes accounts other test files are using concurrently.
 *
 * Requires a running backend (BACKEND_URL) with EMBEDDINGS_PROVIDER=stub and
 * direct DB access via PG* env vars — same setup as auth-delete-shared-books.test.ts.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let cleanupTestUsers: typeof import("./test-data-cleanup.service").cleanupTestUsers;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let deleteUserCascade: typeof import("./user-delete.service").deleteUserCascade;

interface TestUser {
  token: string;
  userId: string;
  email: string;
  personalOrgId: string;
}

function makeSql() {
  return postgres({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 5633),
    user: process.env["PGUSER"] ?? "claimnet",
    password: process.env["PGPASSWORD"] ?? "claimnet",
    database: process.env["PGDATABASE"] ?? "claimnet",
  });
}

type Sql = ReturnType<typeof makeSql>;

async function provisionUser(sql: Sql, email: string): Promise<TestUser> {
  const password = "cleanup-bounds-password-123";
  const login = await seedVerifiedUser(email, password);
  const token = ((await login.json()) as { data?: { token?: string } }).data?.token;
  if (!token) throw new Error(`Setup: login failed for ${email}`);
  const rows: Array<{ id: string; personal_organization_id: string | null }> = await sql`
    SELECT id, personal_organization_id FROM claimnet.users WHERE email = ${email}
  `;
  const row = rows[0];
  if (!row?.personal_organization_id) throw new Error("Setup: user has no personal organization");
  return { token, userId: row.id, email, personalOrgId: row.personal_organization_id };
}

async function createBook(owner: TestUser, slug: string): Promise<string> {
  const res = await fetch(`${BASE}/recipe-books`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name: `Book ${slug}`, slug, organizationId: owner.personalOrgId }),
  });
  const id = ((await res.json()) as { data?: { id?: string } }).data?.id;
  if (!id) throw new Error(`Setup: recipe book create failed (status ${res.status})`);
  return id;
}

async function addMember(sql: Sql, groupId: string, user: TestUser): Promise<void> {
  await sql`
    INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write, joined_at)
    VALUES (${groupId}::uuid, ${user.userId}::uuid, 'member', true, true, now())
  `;
}

async function checkInto(user: TestUser, bookSlug: string, recipe: string): Promise<string> {
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
  });
  const key = ((await keyRes.json()) as { data?: { key?: string } }).data?.key;
  if (!key) throw new Error("Setup: daily key mint failed");
  const params = new URLSearchParams({ key, trace: recipe, ef: "cleanup bounds fixture", recipe_book: bookSlug, format: "json" });
  const res = await fetch(`${BASE}/check?${params.toString()}`, { headers: { Accept: "application/json" } });
  const traceId = ((await res.json()) as { data?: { checked?: { recipeId?: string } } }).data?.checked?.recipeId;
  if (!traceId) throw new Error(`Setup: /check did not return a recipeId (status ${res.status})`);
  return traceId;
}

async function exists(sql: Sql, table: "users" | "groups" | "traces", id: string): Promise<boolean> {
  const rows: Array<{ n: number }> = await sql`
    SELECT count(*)::int AS n FROM claimnet.${sql(table)} WHERE id = ${id}::uuid
  `;
  return rows[0]!.n === 1;
}

async function roleOf(sql: Sql, groupId: string, userId: string): Promise<string | undefined> {
  const rows: Array<{ role: string }> = await sql`
    SELECT role FROM claimnet.group_members WHERE group_id = ${groupId}::uuid AND user_id = ${userId}::uuid
  `;
  return rows[0]?.role;
}

describe("assertTestUserPattern", () => {
  it("accepts patterns anchored on @test.local", () => {
    expect(() => assertTestUserPattern("%@test.local")).not.toThrow();
    expect(() => assertTestUserPattern("run-42-%@test.local")).not.toThrow();
  });

  it.each([
    ["%", "every account"],
    ["%test.local", "someone@nottest.local"],
    ["%@test.local%", "someone@test.local.example.com"],
    ["%@example.com", "a real domain"],
    ["", "the empty pattern"],
  ])("refuses %s (would reach %s)", (pattern) => {
    expect(() => assertTestUserPattern(pattern), `"${pattern}" must be refused before any query runs`).toThrow(/must end in "@test.local"/);
  });
});

describe("selectDisposableTestUsers", () => {
  // Long-lived eval corpora share the @test.local domain with throwaway
  // accounts (a blanket sweep deleted ~14k recipes of one on 2026-09-27).
  // Throwaway accounts carry a run timestamp in their name; eval ones don't.
  const row = (email: string, recipeCount = 3) => ({ id: email, email, recipeCount });

  it("keeps accounts without a run timestamp in the name", () => {
    const { disposable, kept } = selectDisposableTestUsers([
      row("perma-eval@test.local", 162_886),
      row("field-notes@test.local", 27),
      row("pibench-eval@test.local", 0),
      row("e2e-smoke-1790530957031-rjyw@test.local"),
      row("probe-1790530584@test.local"),
    ]);
    expect(disposable.map((r) => r.email), "only run-stamped accounts are disposable").toEqual([
      "e2e-smoke-1790530957031-rjyw@test.local",
      "probe-1790530584@test.local",
    ]);
    expect(kept.map((k) => k.reason), "each kept account says why it was kept").toEqual([
      "no run timestamp",
      "no run timestamp",
      "no run timestamp",
    ]);
  });

  it("keeps a run-stamped account over the recipe ceiling", () => {
    const { disposable, kept } = selectDisposableTestUsers([
      row("import-1784000000000@test.local", MAX_DISPOSABLE_RECIPES + 1),
      row("import-1784000000001@test.local", MAX_DISPOSABLE_RECIPES),
    ]);
    expect(disposable.map((r) => r.email), "an account at the ceiling is still disposable").toEqual(["import-1784000000001@test.local"]);
    expect(kept[0]?.reason, "an account over the ceiling is kept, with the reason").toMatch(/recipes/);
  });

  it("takes everything the pattern matched when the caller named it explicitly", () => {
    const { disposable, kept } = selectDisposableTestUsers(
      [row("perma-eval@test.local", 162_886)],
      { explicit: true },
    );
    expect(disposable, "--only with a named pattern is the operator's deliberate choice").toHaveLength(1);
    expect(kept).toHaveLength(0);
  });
});

describe.skipIf(!BASE)("cleanupTestUsers stays inside its bounds", () => {
  beforeAll(async () => {
    ({ getDb } = await import("../db"));
    ({ cleanupTestUsers } = await import("./test-data-cleanup.service"));
    ({ deleteUserCascade } = await import("./user-delete.service"));
  });

  it("removes the run's @test.local accounts and nothing that only looks like one", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    const run = `cleanup-${Date.now()}`;
    const survivors: TestUser[] = [];
    try {
      const target = await provisionUser(sql, `${run}-target@test.local`);
      // Same prefix, domain only starts with test.local.
      const lookalike = await provisionUser(sql, `${run}-lookalike@test.local.example.com`);
      // A test account outside this run's scope (another test file's, say).
      const otherRun = await provisionUser(sql, `other-${run}@test.local`);
      survivors.push(lookalike, otherRun);

      const result = await cleanupTestUsers(getDb(), { emailLike: `${run}-%@test.local` });

      expect(result.usersDeleted, "exactly the one in-scope account should be deleted").toBe(1);
      expect(await exists(sql, "users", target.userId), "the in-scope @test.local account should be gone").toBe(false);
      expect(await exists(sql, "users", lookalike.userId), "an @test.local.example.com account is not a test account and must survive").toBe(true);
      expect(await exists(sql, "users", otherRun.userId), "a test account outside the given pattern must survive").toBe(true);
    } finally {
      for (const u of survivors) await deleteUserCascade(getDb(), u.userId).catch(() => {});
      await sql.end();
    }
  });

  it("keeps a long-lived @test.local account that has no run timestamp", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    // Letters only, so the scope pattern itself carries no timestamp.
    const tag = `cleanup-${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8)}`;
    let evalCorpus: TestUser | undefined;
    try {
      evalCorpus = await provisionUser(sql, `${tag}-evalcorpus@test.local`);
      const throwaway = await provisionUser(sql, `${tag}-${Date.now()}@test.local`);

      const result = await cleanupTestUsers(getDb(), { emailLike: `${tag}-%@test.local` });

      expect(await exists(sql, "users", throwaway.userId), "the run-stamped account should be deleted").toBe(false);
      expect(await exists(sql, "users", evalCorpus.userId), "an account with no run timestamp is long-lived and must survive").toBe(true);
      expect(result.kept.map((k) => k.email), "the kept account should be reported").toEqual([evalCorpus.email]);
    } finally {
      if (evalCorpus) await deleteUserCascade(getDb(), evalCorpus.userId).catch(() => {});
      await sql.end();
    }
  });

  it("keeps a real account's recipes and book when the book's test owner is cleaned up", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    const run = `cleanup-${Date.now()}`;
    let real: TestUser | undefined;
    try {
      const testOwner = await provisionUser(sql, `${run}-owner@test.local`);
      real = await provisionUser(sql, `${run}-real@example.com`);
      const slug = `cleanup-shared-${Date.now().toString(36)}`;
      const bookId = await createBook(testOwner, slug);
      await addMember(sql, bookId, real);
      const ownerTrace = await checkInto(testOwner, slug, `As a test owner, I prefer fixtures so that ${run} runs`);
      const realTrace = await checkInto(real, slug, `As a real co-author, I prefer my recipes kept so that ${run} is safe`);

      await cleanupTestUsers(getDb(), { emailLike: `${run}-%@test.local` });

      expect(await exists(sql, "traces", realTrace), "the real co-author's recipe must survive the cleanup").toBe(true);
      expect(await exists(sql, "groups", bookId), "a book with a real member must be handed on, not deleted").toBe(true);
      expect(await roleOf(sql, bookId, real.userId), "the real co-author should now own the book").toBe("owner");
      expect(await exists(sql, "traces", ownerTrace), "the test owner's own recipe should be gone").toBe(false);
      expect(await exists(sql, "users", testOwner.userId), "the test owner should be gone").toBe(false);
    } finally {
      if (real) await deleteUserCascade(getDb(), real.userId).catch(() => {});
      await sql.end();
    }
  });

  it("leaves a real account's own book whole when a test account was a member", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    const run = `cleanup-${Date.now()}`;
    let real: TestUser | undefined;
    try {
      real = await provisionUser(sql, `${run}-realowner@example.com`);
      const testMember = await provisionUser(sql, `${run}-member@test.local`);
      const slug = `cleanup-real-${Date.now().toString(36)}`;
      const bookId = await createBook(real, slug);
      await addMember(sql, bookId, testMember);
      const realTrace = await checkInto(real, slug, `As a book owner, I prefer my book intact so that ${run} is safe`);
      const memberTrace = await checkInto(testMember, slug, `As a test member, I prefer fixtures so that ${run} runs`);

      await cleanupTestUsers(getDb(), { emailLike: `${run}-%@test.local` });

      expect(await exists(sql, "groups", bookId), "the real owner's book must survive").toBe(true);
      expect(await roleOf(sql, bookId, real.userId), "the real owner should still own their book").toBe("owner");
      expect(await exists(sql, "traces", realTrace), "the real owner's recipe must survive").toBe(true);
      expect(await exists(sql, "traces", memberTrace), "the test member's recipe in the real book should be gone").toBe(false);
      expect(await roleOf(sql, bookId, testMember.userId), "the test member's membership should be gone").toBeUndefined();
    } finally {
      if (real) await deleteUserCascade(getDb(), real.userId).catch(() => {});
      await sql.end();
    }
  });
});
