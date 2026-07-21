import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  createEphemeralWorkspace,
  reapEphemeralBook,
  reapExpiredEphemeralBooks,
} from "../services/ephemeral-workspace.service";
import { repairOrphanedEmbeddings } from "../services/integrity-repair.service";

/**
 * Layer 3 integration tests for the eval-reset destructive tier — ephemeral
 * workspaces (create / auto-scope-bind / expire-now / tombstone / reaper) and
 * admin orphan repair. Requires a running backend (BACKEND_URL) with
 * ALLOW_BENCHMARK_OPS=true + postgres — same pattern as integrity.test.ts; runs
 * under `npm run test:ci` (which spawns its backend with the flag on).
 *
 * HTTP-driven (register/keys/workspaces/check over fetch); direct SQL only for
 * seeding/verification; the reaper, the create-cap, and the repair are exercised
 * by importing their service functions and calling them against the same DB
 * (the same way integrity.test seeds raw) — the 5-minute cron can't be waited on.
 *
 * Constraint→test map (numbered per the implementation brief):
 *  1  create restricted to self-created books — auto-bind widens only the creator key
 *  3  tombstone excludes from read scope (briefing) AND refuses deposits
 *  4  audit rows (reaper writes recipe_book.reaped) — asserted via audit_log
 *  5  per-key live-workspace cap
 *  6  scoped keys only (daily → 403); auto-scope self-bind
 *  7  reaper removes the whole chain + purges scopes; refuses a book with no birth record
 * 10  admin orphan repair heals a seeded orphan (+ admin-only gate)
 */

const BASE = process.env["BACKEND_URL"] ?? "";

// ── DB access for seeding/verification + direct service calls ────────────────
let sqlClient: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase | undefined;
function getSql() {
  if (!sqlClient) {
    sqlClient = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    db = drizzle(sqlClient);
  }
  return { sql: sqlClient, db: db! };
}

function hashKey(k: string): string {
  return crypto.createHash("sha256").update(k).digest("hex");
}

interface Actor {
  jwt: string;
  personalBookId: string;
  scopedKey: string;
  scopedKeyId: string;
  userId: string;
}

async function registerVerifyLogin(tag: string): Promise<{ jwt: string; email: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `ws-${tag}-${uid}@test.local`;
  const password = "workspace-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error(`Setup failed: register (${tag})`);
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const jwt = loginBody.data?.token;
  if (!jwt) throw new Error(`Setup failed: login (${tag})`);
  return { jwt, email };
}

async function personalBook(jwt: string): Promise<string> {
  const res = await fetch(`${BASE}/recipe-books`, { headers: { Authorization: `Bearer ${jwt}` } });
  const body = (await res.json()) as { data?: Array<{ id: string; slug: string }> };
  const rows = body.data ?? [];
  const personal = rows.find((r) => r.slug === "personal") ?? rows[0];
  if (!personal) throw new Error("Setup failed: no recipe book");
  return personal.id;
}

async function mintScopedKey(jwt: string, bookId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${BASE}/keys/scoped`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      readRecipeBookIds: [bookId],
      writeRecipeBookIds: [bookId],
      defaultWriteRecipeBookId: bookId,
      expiresAt,
    }),
  });
  const body = (await res.json()) as { data?: { key?: string } };
  if (!body.data?.key) throw new Error("Setup failed: scoped key");
  return body.data.key;
}

async function mintDailyKey(jwt: string): Promise<string> {
  const res = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const body = (await res.json()) as { data?: { key?: string } };
  if (!body.data?.key) throw new Error("Setup failed: daily key");
  return body.data.key;
}

async function makeActor(tag: string): Promise<Actor> {
  const { jwt } = await registerVerifyLogin(tag);
  const personalBookId = await personalBook(jwt);
  const scopedKey = await mintScopedKey(jwt, personalBookId);
  const { sql } = getSql();
  const rows = await sql`SELECT id, user_id FROM claimnet.api_keys WHERE key = ${hashKey(scopedKey)} LIMIT 1`;
  const row = rows[0] as { id: string; user_id: string } | undefined;
  if (!row) throw new Error("Setup failed: scoped key row");
  return { jwt, personalBookId, scopedKey, scopedKeyId: row.id, userId: row.user_id };
}

interface WorkspaceResult {
  ok: boolean;
  error?: string;
  data?: { recipeBookId: string; slug: string; name: string; expiresAt: string };
}

async function createWorkspace(
  key: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: WorkspaceResult }> {
  const res = await fetch(`${BASE}/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as WorkspaceResult };
}

async function setExpiry(
  key: string,
  recipeBookId: string,
  expiresAt: string,
): Promise<{ status: number; body: { ok: boolean; data?: { expiresAt: string; tombstoned: boolean } } }> {
  const res = await fetch(`${BASE}/workspaces/${recipeBookId}/expiry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ expiresAt }),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: { expiresAt: string; tombstoned: boolean } } };
}

/** Deposit a recipe over HTTP into a target book slug. Returns {recipeId?, error?}. */
async function deposit(
  key: string,
  recipeText: string,
  bookSlug?: string,
): Promise<{ ok: boolean; recipeId?: string | undefined; error?: string | undefined }> {
  const ef = `Test evidence interpretation.\n> "verbatim workspace quote"\n-- workspace integration test, 2026-07-21`;
  const bookParam = bookSlug ? `&recipe_book=${encodeURIComponent(bookSlug)}` : "";
  const url = `${BASE}/check?key=${encodeURIComponent(key)}&trace=${encodeURIComponent(recipeText)}&ef=${encodeURIComponent(ef)}${bookParam}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as { ok?: boolean; error?: string; data?: { checked?: { recipeId?: string } } };
  return { ok: res.ok && body.ok !== false, recipeId: body.data?.checked?.recipeId, error: body.error };
}

async function briefingBookSlugs(jwt: string, key: string): Promise<string[]> {
  const res = await fetch(`${BASE}/keys/briefing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ key }),
  });
  const body = (await res.json()) as { data?: { groups?: Array<{ slug: string }> } };
  return (body.data?.groups ?? []).map((g) => g.slug);
}

async function integrity(key: string): Promise<{
  clean: boolean;
  books: Array<{ recipeBookId: string; slug: string }>;
  expiredNotYetReaped: Array<{ recipeBookId: string }>;
  summary: { expiredNotYetReaped: number };
}> {
  const res = await fetch(`${BASE}/health/integrity`, { headers: { Authorization: `Bearer ${key}` } });
  const body = (await res.json()) as {
    data: {
      books: Array<{ recipeBookId: string; slug: string; orphanedSources: number }>;
      expiredNotYetReaped: Array<{ recipeBookId: string }>;
      summary: { clean: boolean; expiredNotYetReaped: number };
    };
  };
  return {
    clean: body.data.summary.clean,
    books: body.data.books,
    expiredNotYetReaped: body.data.expiredNotYetReaped,
    summary: body.data.summary,
  };
}

const RECIPE = (n: string) =>
  `As a benchmark engineer working on ephemeral-workspace ${n}, I prefer disposable per-run books so that between-run resets never leak phantom hits.`;

describe.skipIf(!BASE)("ephemeral workspaces — eval-reset destructive tier", () => {
  let A: Actor;
  let B: Actor;
  const seededGroupIds: string[] = [];

  beforeAll(async () => {
    [A, B] = await Promise.all([makeActor("a"), makeActor("b")]);
  }, 60_000);

  afterAll(async () => {
    // Best-effort cleanup of any workspace groups that survived a failed test.
    if (sqlClient) {
      for (const gid of seededGroupIds) {
        try {
          await sqlClient`DELETE FROM claimnet.ephemeral_books WHERE group_id = ${gid}::uuid`;
          await sqlClient`DELETE FROM claimnet.groups WHERE id = ${gid}::uuid`;
        } catch { /* already reaped */ }
      }
      await sqlClient.end({ timeout: 2 });
    }
  }, 30_000);

  // ── 6: scoped keys only ──────────────────────────────────────────────────
  it("(6) daily keys cannot create workspaces (403); scoped keys can (201)", async () => {
    const daily = await mintDailyKey(A.jwt);
    const denied = await createWorkspace(daily, { name: "should fail" });
    expect(denied.status).toBe(403);

    const ok = await createWorkspace(A.scopedKey, { name: "Run 1", ttlDays: 30 });
    expect(ok.status).toBe(201);
    expect(ok.body.data?.recipeBookId).toBeTruthy();
    expect(ok.body.data?.slug).toContain("ephemeral-");
    expect(ok.body.data?.name).toBe("Run 1");
    expect(new Date(ok.body.data!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    seededGroupIds.push(ok.body.data!.recipeBookId);
  });

  // ── 1 + 6: auto-bind widens ONLY the creating key ────────────────────────
  it("(1,6) auto-scope-bind lets the creator write+read the book; a second key cannot", async () => {
    const created = await createWorkspace(A.scopedKey, { name: "Bind test" });
    const { recipeBookId, slug } = created.body.data!;
    seededGroupIds.push(recipeBookId);

    // A's key gained read+write scope on exactly this book (atomic append).
    const { sql } = getSql();
    const keyRow = (await sql`
      SELECT read_group_ids, write_group_ids FROM claimnet.api_keys WHERE id = ${A.scopedKeyId}::uuid
    `)[0] as { read_group_ids: string[]; write_group_ids: string[] };
    expect(keyRow.read_group_ids).toContain(recipeBookId);
    expect(keyRow.write_group_ids).toContain(recipeBookId);

    // A can deposit into it.
    const aDeposit = await deposit(A.scopedKey, RECIPE("bind-A"), slug);
    expect(aDeposit.ok).toBe(true);
    expect(aDeposit.recipeId).toBeTruthy();

    // B (different user, different key) cannot see or write the book.
    const bKeyRow = (await sql`
      SELECT read_group_ids, write_group_ids FROM claimnet.api_keys WHERE id = ${B.scopedKeyId}::uuid
    `)[0] as { read_group_ids: string[]; write_group_ids: string[] };
    expect(bKeyRow.read_group_ids).not.toContain(recipeBookId);
    expect(bKeyRow.write_group_ids).not.toContain(recipeBookId);

    const bDeposit = await deposit(B.scopedKey, RECIPE("bind-B"), slug);
    expect(bDeposit.ok).toBe(false);
    expect(bDeposit.error).toMatch(/not found or not writable/i);
  });

  // ── 3: tombstone excludes from read scope AND refuses deposits ───────────
  it("(3) after expire-now the book leaves briefing scope AND refuses new deposits", async () => {
    const created = await createWorkspace(A.scopedKey, { name: "Tombstone test" });
    const { recipeBookId, slug } = created.body.data!;
    seededGroupIds.push(recipeBookId);

    // Before expiry: the book appears in A's briefing scope and accepts writes.
    const before = await briefingBookSlugs(A.jwt, A.scopedKey);
    expect(before).toContain(slug);
    const okDeposit = await deposit(A.scopedKey, RECIPE("tomb-live"), slug);
    expect(okDeposit.ok).toBe(true);

    // Expire now (creator key).
    const expired = await setExpiry(A.scopedKey, recipeBookId, "now");
    expect(expired.status).toBe(200);
    expect(expired.body.data?.tombstoned).toBe(true);

    // Read exclusion: gone from briefing scope the instant expiry passed.
    const after = await briefingBookSlugs(A.jwt, A.scopedKey);
    expect(after).not.toContain(slug);

    // Write refusal: a deposit racing expiry loses — the existing "not
    // writable" shape, no new error class.
    const racing = await deposit(A.scopedKey, RECIPE("tomb-after"), slug);
    expect(racing.ok).toBe(false);
    expect(racing.error).toMatch(/not found or not writable/i);

    // A validity gate sees it as expired-not-yet-reaped.
    const integ = await integrity(A.scopedKey);
    expect(integ.expiredNotYetReaped.some((b) => b.recipeBookId === recipeBookId)).toBe(true);
    expect(integ.clean).toBe(false);
  });

  // ── expire-now is creator-KEY-only ───────────────────────────────────────
  it("expire-now is creator-key-only — a different key gets 404 and mutates nothing", async () => {
    const created = await createWorkspace(A.scopedKey, { name: "Creator-only" });
    const { recipeBookId } = created.body.data!;
    seededGroupIds.push(recipeBookId);

    // B's key did not create it → uniform 404, no mutation.
    const denied = await setExpiry(B.scopedKey, recipeBookId, "now");
    expect(denied.status).toBe(404);

    const { sql } = getSql();
    const stillLive = (await sql`
      SELECT expires_at FROM claimnet.ephemeral_books WHERE group_id = ${recipeBookId}::uuid
    `)[0] as { expires_at: string } | undefined;
    expect(stillLive).toBeTruthy();
    expect(new Date(stillLive!.expires_at).getTime()).toBeGreaterThan(Date.now());

    // A (creator) can extend it, no max cap.
    const farFuture = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
    const extended = await setExpiry(A.scopedKey, recipeBookId, farFuture);
    expect(extended.status).toBe(200);
    expect(extended.body.data?.tombstoned).toBe(false);
  });

  // ── 7 + 4: reaper deletes the whole chain, purges scope, audits ──────────
  it("(7,4) the reaper deletes the full book chain, purges key scope, and audits", async () => {
    const { sql, db } = getSql();
    const created = await createWorkspace(A.scopedKey, { name: "Reap me" });
    const { recipeBookId, slug } = created.body.data!;

    // Deposit so the book has a real trace + embedding subgraph to cascade.
    const dep = await deposit(A.scopedKey, RECIPE("reap-target"), slug);
    expect(dep.ok).toBe(true);
    const tracesBefore = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE group_id = ${recipeBookId}::uuid`)[0] as { n: number };
    expect(tracesBefore.n).toBeGreaterThanOrEqual(1);

    // Expire in the past, then run the reaper directly (the cron can't be waited on).
    await sql`UPDATE claimnet.ephemeral_books SET expires_at = NOW() - interval '1 minute' WHERE group_id = ${recipeBookId}::uuid`;
    const result = await reapEphemeralBook(db, recipeBookId);
    expect(result.tracesDeleted).toBeGreaterThanOrEqual(1);

    // Zero surviving rows anywhere referencing the book.
    const traceCount = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE group_id = ${recipeBookId}::uuid`)[0] as { n: number };
    expect(traceCount.n).toBe(0);
    const groupCount = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.groups WHERE id = ${recipeBookId}::uuid`)[0] as { n: number };
    expect(groupCount.n).toBe(0);
    const birthCount = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.ephemeral_books WHERE group_id = ${recipeBookId}::uuid`)[0] as { n: number };
    expect(birthCount.n).toBe(0);
    const srcCount = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources WHERE group_id = ${recipeBookId}::uuid`)[0] as { n: number };
    expect(srcCount.n).toBe(0);

    // The id is purged from A's key scope arrays.
    const keyRow = (await sql`
      SELECT read_group_ids, write_group_ids FROM claimnet.api_keys WHERE id = ${A.scopedKeyId}::uuid
    `)[0] as { read_group_ids: string[]; write_group_ids: string[] };
    expect(keyRow.read_group_ids).not.toContain(recipeBookId);
    expect(keyRow.write_group_ids).not.toContain(recipeBookId);

    // Audit row written with per-layer counts.
    const audit = (await sql`
      SELECT metadata FROM claimnet.audit_log
      WHERE action = 'recipe_book.reaped' AND target_id = ${recipeBookId}::uuid
    `)[0] as { metadata: { tracesDeleted: number } } | undefined;
    expect(audit).toBeTruthy();
    expect(audit!.metadata.tracesDeleted).toBeGreaterThanOrEqual(1);

    // And it's gone from the integrity report's expired-not-yet-reaped section.
    const integ = await integrity(A.scopedKey);
    expect(integ.expiredNotYetReaped.some((b) => b.recipeBookId === recipeBookId)).toBe(false);

    // Idempotent: a second reap is a no-op.
    const again = await reapEphemeralBook(db, recipeBookId);
    expect(again.tracesDeleted).toBe(0);
  });

  // ── 7: reaper refuses a book with no birth record ────────────────────────
  it("(7) the reaper never touches a durable book (no ephemeral_books row)", async () => {
    const { sql, db } = getSql();
    // A durable book: created via the normal recipe-book route, no birth record.
    const res = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${A.jwt}` },
      body: JSON.stringify({
        name: "Durable book",
        slug: `durable-${Date.now().toString(36)}`,
        organizationId: (await sql`
          SELECT organization_id FROM claimnet.groups WHERE id = ${A.personalBookId}::uuid
        `)[0]!.organization_id,
      }),
    });
    const durableId = ((await res.json()) as { data?: { id?: string } }).data?.id;
    expect(durableId).toBeTruthy();
    const durId = durableId as string;

    // An expired ephemeral book alongside it, so the reaper has real work to do.
    const created = await createWorkspace(A.scopedKey, { name: "Reap the ephemeral, not the durable" });
    const ephemeralId = created.body.data!.recipeBookId;
    await sql`UPDATE claimnet.ephemeral_books SET expires_at = NOW() - interval '1 minute' WHERE group_id = ${ephemeralId}::uuid`;

    const { booksReaped } = await reapExpiredEphemeralBooks(db);
    expect(booksReaped).toBeGreaterThanOrEqual(1);

    // The durable book is untouched; the ephemeral one is gone.
    const durableStill = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.groups WHERE id = ${durId}::uuid`)[0] as { n: number };
    expect(durableStill.n).toBe(1);
    const ephemeralGone = (await sql`SELECT COUNT(*)::int AS n FROM claimnet.groups WHERE id = ${ephemeralId}::uuid`)[0] as { n: number };
    expect(ephemeralGone.n).toBe(0);

    // Cleanup the durable book.
    await sql`DELETE FROM claimnet.group_members WHERE group_id = ${durId}::uuid`;
    await sql`DELETE FROM claimnet.groups WHERE id = ${durId}::uuid`;
  });

  // ── 5: per-key live-workspace cap ────────────────────────────────────────
  it("(5) rejects create past the per-key live-workspace cap", async () => {
    const { db } = getSql();
    const prev = process.env["EPHEMERAL_MAX_LIVE_PER_KEY"];
    process.env["EPHEMERAL_MAX_LIVE_PER_KEY"] = "2";
    try {
      // A dedicated actor so other tests' live workspaces don't count here.
      const cap = await makeActor("cap");
      const one = await createEphemeralWorkspace({ db, keyId: cap.scopedKeyId, userId: cap.userId, name: "cap-1" });
      const two = await createEphemeralWorkspace({ db, keyId: cap.scopedKeyId, userId: cap.userId, name: "cap-2" });
      seededGroupIds.push(one.recipeBookId, two.recipeBookId);

      await expect(
        createEphemeralWorkspace({ db, keyId: cap.scopedKeyId, userId: cap.userId, name: "cap-3" }),
      ).rejects.toMatchObject({ status: 429 });
    } finally {
      if (prev === undefined) delete process.env["EPHEMERAL_MAX_LIVE_PER_KEY"];
      else process.env["EPHEMERAL_MAX_LIVE_PER_KEY"] = prev;
    }
  });

  // ── 10: admin orphan repair ──────────────────────────────────────────────
  it("(10) admin orphan repair is admin-only and heals a seeded orphan", async () => {
    const { sql, db } = getSql();

    // Admin-only gate: a normal user's JWT is rejected (403).
    const denied = await fetch(`${BASE}/admin/integrity/repair`, {
      method: "POST",
      headers: { Authorization: `Bearer ${A.jwt}` },
    });
    expect(denied.status).toBe(403);

    // Seed a REAL orphan on A's personal book: deposit, then raw-delete the
    // traces row (bypassing the cascade), leaving dangling embedding rows.
    const dep = await deposit(A.scopedKey, RECIPE("orphan-seed"), "personal");
    expect(dep.ok).toBe(true);
    const traceId = dep.recipeId!;
    await sql`DELETE FROM claimnet.trace_reactions WHERE trace_id = ${traceId}::uuid`;
    await sql`DELETE FROM claimnet.check_feedback WHERE trace_id = ${traceId}::uuid`;
    await sql`DELETE FROM claimnet.trace_references WHERE trace_id = ${traceId}::uuid`;
    await sql`DELETE FROM claimnet.trace_evidence WHERE trace_id = ${traceId}::uuid`;
    await sql`DELETE FROM claimnet.traces WHERE id = ${traceId}::uuid`;

    const orphanBefore = (await sql`
      SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources
      WHERE source_type = 'trace' AND source_id = ${traceId}::uuid
    `)[0] as { n: number };
    expect(orphanBefore.n).toBeGreaterThanOrEqual(1);

    // Repair (service call — the admin route is a thin wrapper over it).
    const result = await repairOrphanedEmbeddings(db);
    expect(result.summary.orphanedSourcesDeleted).toBeGreaterThanOrEqual(1);

    // The dangling rows are gone.
    const orphanAfter = (await sql`
      SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources
      WHERE source_type = 'trace' AND source_id = ${traceId}::uuid
    `)[0] as { n: number };
    expect(orphanAfter.n).toBe(0);
  });
});
