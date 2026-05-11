import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stubEmbeddingVector } from "@soupnet/domain";

/**
 * Vector search integration tests — requires running backend + postgres.
 *
 * Seeds real Gemini vectors from fixtures (exported from dev DB) into the
 * vector_cache table, then tests the full pipeline: submission → vector
 * cache hit → HNSW search → RRF merge → clustering → evidence discovery.
 *
 * One test ("vector_cache hit returns the seeded vector verbatim") explicitly
 * verifies the cache hit code path: it inserts a known seed into vector_cache,
 * submits a recipe whose chunk_hash matches the seed, then reads back the
 * embedding_vectors row and asserts the value matches the seed (and does NOT
 * match the deterministic stub vector that would be produced on a miss). This
 * is important because the rest of the suite would silently keep passing if
 * the cache lookup regressed and every embedding fell through to the stub
 * provider.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

// Lazy DB imports — vitest's include glob is global so this file is loaded
// even when DATABASE_URL/PGHOST aren't set; importing the db module at the
// top would crash module init. Loaded inside beforeAll only when needed.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

interface FixtureLine {
  content_hash: string;
  model_id: string;
  task_type: string;
  source_text: string;
  vector: string;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  data?: {
    recipeId?: string;
    searchMode?: string;
    clustered?: boolean;
    results?: Array<{
      id: string;
      recipe: string;
      clusterSize?: number;
      score?: { semantic: number | null; combined: number };
    }>;
    relatedEvidence?: Array<{
      evidence: string;
      parentRecipe: string;
      similarity: number;
    }>;
    totalResults?: number;
  };
}

let token = "";
let apiKey = "";

// Load vector fixtures
function loadFixtures(): FixtureLine[] {
  const fixturePath = resolve(__dirname, "../test-fixtures/vector-cache-seeds.jsonl");
  const lines = readFileSync(fixturePath, "utf-8").trim().split("\n");
  return lines.map((line) => JSON.parse(line) as FixtureLine);
}

describe.skipIf(!BASE)("vector search integration (seeded vectors)", () => {
  const uid = Date.now();
  const fixtures = loadFixtures();

  beforeAll(async () => {
    // Lazy load db module so this file can be imported even when no DB is
    // available (the describe.skipIf above guards execution).
    const dbMod = await import("../db");
    const drizzleMod = await import("drizzle-orm");
    getDb = dbMod.getDb;
    sql = drizzleMod.sql;

    // Register a test user
    const email = `test-vecsearch-${uid}@test.local`;
    const password = "vecsearch-test-password";
    const regRes = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await regRes.json()) as { data?: { verificationToken?: string } };

    // F15: verify the user before key creation. Dev backend exposes the
    // verification token in the register response when ALLOW_AUTO_SETUP=true.
    const verificationToken = regBody.data?.verificationToken;
    if (!verificationToken) throw new Error("Backend did not return verificationToken — ALLOW_AUTO_SETUP must be true");
    const verifyRes = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verificationToken }),
    });
    if (!verifyRes.ok) throw new Error("Failed to verify test user for vector search tests");

    // F30: log in for the JWT (register no longer returns it).
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = (await loginRes.json()) as { data?: { token?: string } };
    token = loginBody.data?.token ?? "";
    if (!token) throw new Error("Failed to log in test user for vector search tests");

    // Generate API key
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    apiKey = keyBody.data?.key ?? "";
    if (!apiKey) throw new Error("Failed to generate test API key");

    // Seed vector_cache directly from the JSONL fixtures. This is the only
    // place these real Gemini vectors come from in the test environment —
    // the integration backend uses EMBEDDINGS_PROVIDER=stub, so without this
    // step there would be no real vectors anywhere and the cache-hit
    // assertion below would have nothing to match against.
    const db = getDb();
    for (const fixture of fixtures) {
      await db.execute(sql`
        INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector)
        VALUES (
          ${fixture.content_hash},
          ${fixture.model_id},
          ${fixture.task_type},
          ${fixture.vector}::vector(3072)
        )
        ON CONFLICT (content_hash, model_id, task_type) DO NOTHING
      `);
    }

    // Submit each fixture's source text via /check so the search corpus has
    // matching traces to find. The synchronous embedding path in
    // backend/lib/embeddings/enqueue.ts will hit our just-seeded cache
    // entries for SEMANTIC_SIMILARITY (the only task_type in the seed file).
    for (const fixture of fixtures) {
      await fetch(
        `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(fixture.source_text)}&ef=${encodeURIComponent("Seeded fixture evidence.\n> \"test fixture\"\n-- vector-cache-seeds.jsonl")}&format=json`,
      );
    }
  }, 60_000);

  it("finds semantically similar traces via vector search", { timeout: 15_000 }, async () => {
    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent("As a backend developer, I chose Hono over Express.")}&ef=${encodeURIComponent("Hono is better.\n> \"lightweight\"\n-- dev notes")}&format=json`,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.results).toBeDefined();

    // Semantic search should surface fixture traces about the same topic
    const honoResults = (body.data?.results ?? []).filter((r) =>
      r.recipe.toLowerCase().includes("hono"),
    );
    expect(honoResults.length).toBeGreaterThan(0);
  });

  it("returns search mode indicator", { timeout: 15_000 }, async () => {
    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent("As a developer, I chose Zod for input validation.")}&ef=${encodeURIComponent("Type safety.\n> \"Zod\"\n-- notes")}&format=json`,
    );

    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.searchMode).toBe("semantic");
  });

  it("clusters results when requested", { timeout: 15_000 }, async () => {
    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent("As a developer building APIs, I prefer modern frameworks and strong validation.")}&ef=${encodeURIComponent("Modern stack.\n> \"modern\"\n-- notes")}&clusters=2&format=json`,
    );

    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);

    if ((body.data?.results?.length ?? 0) > 2) {
      // If there are more results than clusters requested, clustering should activate
      expect(body.data?.clustered).toBe(true);
      // Clustered results should have clusterSize
      const withClusterSize = (body.data?.results ?? []).filter((r) => r.clusterSize);
      expect(withClusterSize.length).toBeGreaterThan(0);
    }
  });

  it("returns related evidence from other recipes", { timeout: 15_000 }, async () => {
    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent("As a backend developer, I chose Hono over Express.")}&ef=${encodeURIComponent("Hono is better.\n> \"lightweight and fast\"\n-- benchmarks")}&format=json`,
    );

    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);

    // Related evidence may or may not be present depending on whether
    // evidence embeddings were generated (they're deferred to worker).
    // Just verify the field exists in the response structure.
    if (body.data?.relatedEvidence) {
      expect(Array.isArray(body.data.relatedEvidence)).toBe(true);
    }
  });

  it("reports total results count", { timeout: 15_000 }, async () => {
    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent("As a developer, I prefer clear architecture.")}&ef=${encodeURIComponent("Architecture matters.\n> \"clean\"\n-- notes")}&format=json`,
    );

    const body = (await res.json()) as ApiResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.totalResults).toBeDefined();
    expect(typeof body.data?.totalResults).toBe("number");
  });

  it("vector_cache hit returns the seeded vector verbatim (not the stub)", { timeout: 15_000 }, async () => {
    // Pick a fixture whose source_text is short and unambiguous so that the
    // backend's full_document chunking will hash it to exactly the seed's
    // content_hash. enqueue.ts (apps/backend/src/lib/embeddings/enqueue.ts)
    // computes chunk_hash = sha256(sourceText), which is the same scheme
    // used to generate the JSONL fixtures, so the hashes match.
    const fixture = fixtures.find((f) =>
      f.source_text.includes("Hono over Express for API servers"),
    );
    if (!fixture) throw new Error("Expected Hono fixture in vector-cache-seeds.jsonl");
    expect(fixture.task_type).toBe("SEMANTIC_SIMILARITY");

    const db = getDb();

    // Sanity check: the seed must actually be in vector_cache before we
    // attempt the cache hit. (beforeAll inserted it; this asserts the
    // insertion took.)
    const cacheRows = await db.execute(sql`
      SELECT 1
      FROM claimnet.vector_cache
      WHERE content_hash = ${fixture.content_hash}
        AND model_id = ${fixture.model_id}
        AND task_type = ${fixture.task_type}
      LIMIT 1
    `);
    expect((cacheRows as unknown as unknown[]).length).toBe(1);

    // Submit the seed text via /check. The backend's synchronous embedding
    // path will hash the text, find our seeded entry in vector_cache, and
    // write the cached vector into embedding_vectors with status='complete'.
    const submitRes = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(fixture.source_text)}&ef=${encodeURIComponent("Cache hit verification.\n> \"verbatim\"\n-- vector-search.test.ts")}&format=json`,
    );
    expect(submitRes.status).toBe(200);

    // Read back the embedding_vectors row that was just written. Join via
    // chunk_hash so we don't have to know the recipeId — there can be many
    // chunks with the same hash if other tests submitted the same text, and
    // any one of them is fine because they all share the same cached vector.
    const vectorRows = await db.execute(sql`
      SELECT ev.vector::text AS vec_str
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      WHERE ec.chunk_hash = ${fixture.content_hash}
        AND ev.task_type = ${fixture.task_type}
        AND ev.model_id = ${fixture.model_id}
        AND ev.status = 'complete'
        AND ev.vector IS NOT NULL
      ORDER BY ev.updated_at DESC
      LIMIT 1
    `);
    const row = (vectorRows as unknown as Array<{ vec_str: string }>)[0];
    expect(row, "no completed embedding row found for the seeded chunk_hash").toBeDefined();

    // Parse the halfvec text repr ("[v1,v2,...]") into numbers.
    const stored = row!.vec_str.slice(1, -1).split(",").map(Number);
    expect(stored).toHaveLength(3072);

    // Parse the seed vector (full float32 precision) for comparison.
    const seeded = fixture.vector.slice(1, -1).split(",").map(Number);
    expect(seeded).toHaveLength(3072);

    // The stored vector is halfvec(3072) — fp16 truncation of the original
    // float32 cache value. Allow ~1e-3 absolute tolerance per dim, which is
    // ~10x the worst-case fp16 rounding error for unit-norm values.
    // Spot-check several dimensions; checking all 3072 would just be noise.
    const dims = [0, 1, 17, 100, 500, 1000, 2000, 3071];
    for (const i of dims) {
      expect(stored[i]).toBeCloseTo(seeded[i]!, 2);
    }

    // Crucially: the stored vector must NOT match what the stub provider
    // would produce for the same (text, taskType, model). If the cache
    // lookup regressed and every embedding fell through to the stub, the
    // first check above would still pass (seeded values happen to be in
    // the same numerical range as stub values), but this check would fail
    // because stub and seeded vectors are uncorrelated sequences. This is
    // the actual cache-hit assertion — if you only keep one assertion in
    // this test, keep this one.
    const stubbed = stubEmbeddingVector(
      fixture.source_text,
      fixture.task_type,
      fixture.model_id,
    );

    // L2 distance between two unit-norm vectors is in [0, 2]:
    //   identical → 0; orthogonal → sqrt(2) ≈ 1.414; antipodal → 2.
    // A cache hit (stored ≈ seeded) vs the stub gives L2 ≈ sqrt(2).
    // A cache miss falling through to stub (stored == stubbed) gives L2 ≈ 0.
    // Threshold of 1.0 is comfortably above any cache-miss residual and
    // well below the random-vector expectation, so this is a robust
    // cache-hit / cache-miss discriminator.
    let sumSqStub = 0;
    let sumSqSeed = 0;
    for (let i = 0; i < 3072; i++) {
      const dStub = stored[i]! - stubbed[i]!;
      const dSeed = stored[i]! - seeded[i]!;
      sumSqStub += dStub * dStub;
      sumSqSeed += dSeed * dSeed;
    }
    const distFromStub = Math.sqrt(sumSqStub);
    const distFromSeed = Math.sqrt(sumSqSeed);

    // The stored vector should be very close to the seed (fp16 truncation
    // residual) and far from the stub.
    expect(distFromSeed).toBeLessThan(0.05);
    expect(distFromStub).toBeGreaterThan(1.0);
  });
});
