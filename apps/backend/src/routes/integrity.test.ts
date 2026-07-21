import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Layer 3 integration tests for GET /health/integrity — API-key-authed
 * retrieval-index integrity check (eval-reset contract item (b1)).
 *
 * Covers: uniform 401 for missing AND garbage keys (no data leak); a fresh
 * agent's book reports zero orphans with clean:true and the book listed; a
 * REAL seeded orphan (trace deposited over HTTP, then its claimnet.traces row
 * DELETEd raw — bypassing the service cascade, exactly the external-tampering /
 * crashed-import class this endpoint exists to catch) surfaces the orphaned
 * source + its chunk/vector counts, clean:false, and the source id in samples;
 * and scoping — key B (different user) never sees key A's orphan or A's book.
 *
 * Requires a running backend (BACKEND_URL) + postgres — same pattern as
 * recipes.test.ts / check-hardening.test.ts; runs under `npm run test:ci`.
 * The seed and cleanup use direct SQL (the endpoint's whole reason for existing
 * is to catch damage the normal service path would never produce); all seeded
 * orphan rows are deleted by source_id at the end so the shared store isn't
 * polluted.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface BookIntegrity {
  recipeBookId: string;
  slug: string;
  name: string;
  orphanedSources: number;
  orphanedChunks: number;
  orphanedVectors: number;
  sampleOrphanSourceIds: string[];
}

interface IntegrityResponse {
  ok: boolean;
  error?: string;
  data?: {
    books: BookIntegrity[];
    summary: {
      booksScanned: number;
      orphanedSources: number;
      orphanedChunks: number;
      orphanedVectors: number;
      clean: boolean;
    };
  };
}

async function setupUserWithKey(tag: string): Promise<{ apiKey: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `integrity-${tag}-${uid}@test.local`;
  const password = "integrity-test-password-123";
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
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const apiKey = keyBody.data?.key;
  if (!apiKey) throw new Error(`Setup failed: key (${tag})`);
  return { apiKey };
}

/** Run a recipe check over HTTP to create a real trace (with evidence + the
 *  synchronous trace embeddings) owned by this key. Returns the trace id. */
async function createTrace(apiKey: string, recipeText: string): Promise<string> {
  const ef = `Test evidence interpretation.\n> "verbatim test quote"\n-- integrity integration test, 2026-07-21`;
  const url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(recipeText)}&ef=${encodeURIComponent(ef)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as { ok: boolean; data?: { checked?: { recipeId?: string } } };
  const id = body.data?.checked?.recipeId;
  if (!id) throw new Error("Setup failed: createTrace");
  return id;
}

async function getIntegrity(apiKey: string): Promise<IntegrityResponse> {
  const res = await fetch(`${BASE}/health/integrity`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as IntegrityResponse;
}

// Direct DB access for seeding the orphan (raw DELETE, bypassing the cascade)
// and for final cleanup. Same connection pattern as check-hardening.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlClient: any;
async function getSql() {
  if (!sqlClient) {
    const postgres = (await import("postgres")).default;
    sqlClient = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
  }
  return sqlClient;
}

describe.skipIf(!BASE)("GET /health/integrity — retrieval-index integrity check", () => {
  let keyClean: string;
  let keyA: string;
  let keyB: string;
  let orphanTraceId: string;
  let seededEvidenceIds: string[] = [];
  let seededReferenceIds: string[] = [];

  beforeAll(async () => {
    const [clean, a, b] = await Promise.all([
      setupUserWithKey("clean"),
      setupUserWithKey("a"),
      setupUserWithKey("b"),
    ]);
    keyClean = clean.apiKey;
    keyA = a.apiKey;
    keyB = b.apiKey;

    // Seed a REAL orphan on key A: deposit a trace over HTTP (creating its
    // 'trace' embedding source/chunk/vector rows), then delete the traces row
    // raw — leaving the embedding rows dangling. This is the crashed-import /
    // external-tampering damage the endpoint is built to detect. The traces
    // row is FK-referenced by the link tables, so clearing those links first is
    // part of bypassing the service cascade (which would have swept the
    // embedding chain too — the whole point is that it doesn't get swept here).
    orphanTraceId = await createTrace(
      keyA,
      "As a test engineer working on integrity-check integration tests, I prefer seeding one deletable trace so that the orphan assertions are deterministic.",
    );
    const sql = await getSql();
    // Capture the evidence/reference ids the check created so afterAll can
    // remove the whole seeded footprint (the trace's own evidence stays VALID —
    // it isn't orphaned — but we still clean it up rather than leave it behind).
    const evRows = await sql`SELECT evidence_id FROM claimnet.trace_evidence WHERE trace_id = ${orphanTraceId}::uuid`;
    seededEvidenceIds = evRows.map((r: { evidence_id: string }) => r.evidence_id);
    const refRows = await sql`SELECT reference_id FROM claimnet.trace_references WHERE trace_id = ${orphanTraceId}::uuid`;
    seededReferenceIds = refRows.map((r: { reference_id: string }) => r.reference_id);
    // Clear every FK to the traces row, then delete it raw.
    await sql`DELETE FROM claimnet.trace_reactions WHERE trace_id = ${orphanTraceId}::uuid`;
    await sql`DELETE FROM claimnet.check_feedback WHERE trace_id = ${orphanTraceId}::uuid`;
    await sql`DELETE FROM claimnet.trace_references WHERE trace_id = ${orphanTraceId}::uuid`;
    await sql`DELETE FROM claimnet.trace_evidence WHERE trace_id = ${orphanTraceId}::uuid`;
    await sql`DELETE FROM claimnet.traces WHERE id = ${orphanTraceId}::uuid`;
  }, 60_000);

  afterAll(async () => {
    if (!sqlClient) return;
    // Delete the whole embedding chain (vectors → chunks → strategies → sources)
    // for every source id we seeded — the orphaned 'trace' sources AND the still
    // -valid 'evidence' sources — so the shared dev/CI store isn't polluted with
    // dangling index rows (the task's explicit cleanup requirement). Then remove
    // the leftover evidence/reference rows the check created.
    const seededSourceIds = [orphanTraceId, ...seededEvidenceIds];
    await sqlClient`
      DELETE FROM claimnet.embedding_vectors
      WHERE embedding_chunk_id IN (
        SELECT ec.id FROM claimnet.embedding_chunks ec
        JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
        WHERE es.source_id = ANY(${seededSourceIds}::uuid[])
      )`;
    await sqlClient`
      DELETE FROM claimnet.embedding_chunks
      WHERE embedding_source_id IN (
        SELECT id FROM claimnet.embedding_sources WHERE source_id = ANY(${seededSourceIds}::uuid[])
      )`;
    await sqlClient`
      DELETE FROM claimnet.embedding_chunk_strategies
      WHERE embedding_source_id IN (
        SELECT id FROM claimnet.embedding_sources WHERE source_id = ANY(${seededSourceIds}::uuid[])
      )`;
    await sqlClient`
      DELETE FROM claimnet.embedding_sources WHERE source_id = ANY(${seededSourceIds}::uuid[])`;
    if (seededEvidenceIds.length > 0) {
      await sqlClient`DELETE FROM claimnet.evidence_references WHERE evidence_id = ANY(${seededEvidenceIds}::uuid[])`;
      await sqlClient`DELETE FROM claimnet.evidence WHERE id = ANY(${seededEvidenceIds}::uuid[])`;
    }
    if (seededReferenceIds.length > 0) {
      await sqlClient`DELETE FROM claimnet.references WHERE id = ANY(${seededReferenceIds}::uuid[])`;
    }
    await sqlClient.end({ timeout: 2 });
  }, 30_000);

  // ── Auth: uniform 401, no data leak ──────────────────────────────────────

  it("returns 401 without a key", async () => {
    const res = await fetch(`${BASE}/health/integrity`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as IntegrityResponse;
    expect(body.ok).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it("returns 401 for a garbage key with a uniform body and no data", async () => {
    const res = await fetch(`${BASE}/health/integrity`, {
      headers: { Authorization: "Bearer cn_s_definitely-not-a-real-key" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as IntegrityResponse;
    expect(body.ok).toBe(false);
    expect(body.data).toBeUndefined();
    // Same uniform error copy as /health/version — invalid and expired are
    // deliberately indistinguishable.
    expect(body.error).toBe("Invalid or expired API key");
  });

  it("accepts the key via ?key= query param too (dual acceptance)", async () => {
    const res = await fetch(`${BASE}/health/integrity?key=${encodeURIComponent(keyClean)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as IntegrityResponse;
    expect(body.ok).toBe(true);
  });

  // ── Fresh agent: clean, with the book listed ─────────────────────────────

  it("a fresh agent's book reports zero orphans with clean:true and the book listed", async () => {
    const body = await getIntegrity(keyClean);
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data.summary.clean).toBe(true);
    expect(data.summary.orphanedSources).toBe(0);
    expect(data.summary.orphanedChunks).toBe(0);
    expect(data.summary.orphanedVectors).toBe(0);
    // The affirmative zero: at least one readable book appears even with no
    // orphans, and every count on it is zero.
    expect(data.books.length).toBeGreaterThan(0);
    expect(data.summary.booksScanned).toBe(data.books.length);
    for (const book of data.books) {
      expect(book.recipeBookId).toBeTruthy();
      expect(book.slug).toBeTruthy();
      expect(book.orphanedSources).toBe(0);
      expect(book.orphanedChunks).toBe(0);
      expect(book.orphanedVectors).toBe(0);
      expect(book.sampleOrphanSourceIds).toEqual([]);
    }
  });

  // ── Real orphan: surfaced with counts + sample, clean:false ──────────────

  it("reports a seeded orphan with its chunk/vector counts, clean:false, and the source id in samples", async () => {
    const body = await getIntegrity(keyA);
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data.summary.clean).toBe(false);
    // The deposit created two 'trace' sources (claim + full-recipe-context),
    // each with a synchronous chunk + vector, so counts are >= 1 (the async
    // worker sweep may add more strategies over time — assert the floor).
    expect(data.summary.orphanedSources).toBeGreaterThanOrEqual(1);
    expect(data.summary.orphanedChunks).toBeGreaterThanOrEqual(1);
    expect(data.summary.orphanedVectors).toBeGreaterThanOrEqual(1);

    // The orphan is attributed to exactly one of A's books, and the dangling
    // trace id appears in that book's samples.
    const offending = data.books.filter((b) => b.orphanedSources > 0);
    expect(offending.length).toBe(1);
    const book = offending[0]!;
    expect(book.orphanedChunks).toBeGreaterThanOrEqual(1);
    expect(book.orphanedVectors).toBeGreaterThanOrEqual(1);
    expect(book.sampleOrphanSourceIds).toContain(orphanTraceId);
    expect(book.sampleOrphanSourceIds.length).toBeLessThanOrEqual(10);
  });

  // ── Scoping: key B never sees A's orphan or A's book ─────────────────────

  it("scoping: key B (different user) sees neither key A's orphan nor A's book", async () => {
    // Establish A's offending book id from A's own scoped report.
    const aBody = await getIntegrity(keyA);
    const aOffendingBookId = aBody.data!.books.find((b) => b.orphanedSources > 0)!.recipeBookId;

    const bBody = await getIntegrity(keyB);
    expect(bBody.ok).toBe(true);
    const bData = bBody.data!;
    // B's scope stays clean...
    expect(bData.summary.clean).toBe(true);
    // ...contains none of A's books...
    expect(bData.books.some((b) => b.recipeBookId === aOffendingBookId)).toBe(false);
    // ...and the dangling trace id appears nowhere in B's response.
    expect(JSON.stringify(bBody)).not.toContain(orphanTraceId);
  });
});
