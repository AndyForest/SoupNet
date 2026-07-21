import { describe, it, expect, beforeAll } from "vitest";

/**
 * Sync embedding path integration tests — requires running backend + postgres.
 *
 * Verifies the 2026-07-01 latency posture (docs/rough-notes/2026-07-01/
 * recipe-check-latency-findings.md) of the recipe-check write path:
 *   - SEMANTIC_SIMILARITY (the only task type generated at all — the model
 *     ignores task_type, so RETRIEVAL_DOCUMENT twins were dropped entirely)
 *     is generated synchronously and complete immediately after the check;
 *   - experimental strategies are NOT enqueued on the check path (the worker
 *     strategy sweep backfills them — operator decision 2026-07-01);
 *   - duplicate re-checks are idempotent: no new embedding pipeline rows.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

// Lazy DB imports — vitest's include glob is global so this file is loaded
// even when DATABASE_URL/PGHOST aren't set (see vector-search.test.ts).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

interface ApiResponse {
  ok: boolean;
  error?: string;
  data?: {
    checked?: { recipeId?: string };
    results?: unknown[];
    totalResults?: number;
  };
}

interface VectorShapeRow {
  strategy_id: string;
  task_type: string;
  status: string;
  has_vector: boolean;
}

let apiKey = "";

async function submitCheck(recipe: string): Promise<ApiResponse> {
  const res = await fetch(
    `${BASE}/check?key=${encodeURIComponent(apiKey)}&recipe=${encodeURIComponent(recipe)}&evidence=${encodeURIComponent("Sync-path shape assertion.\n> \"embed once\"\n-- sync-embed-path.test.ts")}&format=json`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ApiResponse;
}

async function traceVectorShape(recipeId: string): Promise<VectorShapeRow[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT ecs.strategy_id, ev.task_type, ev.status, (ev.vector IS NOT NULL) AS has_vector
    FROM claimnet.embedding_sources es
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.embedding_source_id = es.id
    JOIN claimnet.embedding_chunks ec ON ec.chunk_strategy_id = ecs.id
    JOIN claimnet.embedding_vectors ev ON ev.embedding_chunk_id = ec.id
    WHERE es.source_id = ${recipeId}::uuid
      AND es.source_type = 'trace'
    ORDER BY ecs.strategy_id, ev.task_type
  `);
  return rows as unknown as VectorShapeRow[];
}

describe.skipIf(!BASE)("sync embedding path (recipe check write)", () => {
  const uid = Date.now();

  beforeAll(async () => {
    const dbMod = await import("../db");
    const drizzleMod = await import("drizzle-orm");
    getDb = dbMod.getDb;
    sql = drizzleMod.sql;

    // Register + verify + login a throwaway user, mint a daily key
    const email = `test-syncembed-${uid}@test.local`;
    const password = "syncembed-test-password";
    const regRes = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await regRes.json()) as { data?: { verificationToken?: string } };
    const verificationToken = regBody.data?.verificationToken;
    if (!verificationToken) throw new Error("Backend did not return verificationToken — ALLOW_AUTO_SETUP must be true");
    const verifyRes = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verificationToken }),
    });
    if (!verifyRes.ok) throw new Error("Failed to verify test user");

    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = (await loginRes.json()) as { data?: { token?: string } };
    const token = loginBody.data?.token ?? "";
    if (!token) throw new Error("Failed to log in test user");

    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    apiKey = keyBody.data?.key ?? "";
    if (!apiKey) throw new Error("Failed to generate test API key");
  }, 60_000);

  it("generates SEMANTIC-only sync-complete vectors, no inline experimental strategies", { timeout: 15_000 }, async () => {
    const recipe = `As a backend engineer testing the sync embed path (run ${uid}), I prefer generating only the searched task type synchronously so that checks stay fast.`;
    const body = await submitCheck(recipe);
    expect(body.ok).toBe(true);
    const recipeId = body.data?.checked?.recipeId;
    expect(recipeId).toBeDefined();

    const rows = await traceVectorShape(recipeId!);

    // Exactly the two production strategies, one SEMANTIC row each — no
    // RETRIEVAL_DOCUMENT twins (dropped 2026-07-01: the model ignores
    // task_type). Experimental strategies are backfilled by the worker sweep
    // (1-minute cadence), not the check path — this SELECT runs milliseconds
    // after the check, so their absence asserts the check path didn't create
    // them.
    const strategies = [...new Set(rows.map((r) => r.strategy_id))].sort();
    expect(strategies).toEqual(["full_document", "full_recipe_context"]);
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.task_type, `${row.strategy_id}`).toBe("SEMANTIC_SIMILARITY");
      expect(row.status, `${row.strategy_id}`).toBe("complete");
      expect(row.has_vector, `${row.strategy_id}`).toBe(true);
    }
  });

  it("duplicate re-check is idempotent: same recipeId, no new embedding rows, search still works", { timeout: 15_000 }, async () => {
    const recipe = `As a backend engineer testing duplicate re-checks (run ${uid}), I prefer idempotent check submissions so that repeated checks never duplicate pipeline rows.`;
    const first = await submitCheck(recipe);
    expect(first.ok).toBe(true);
    const recipeId = first.data?.checked?.recipeId;
    expect(recipeId).toBeDefined();
    const rowsAfterFirst = await traceVectorShape(recipeId!);

    const second = await submitCheck(recipe);
    expect(second.ok).toBe(true);
    expect(second.data?.checked?.recipeId).toBe(recipeId);
    // Duplicate path skips the write block entirely — same pipeline rows FOR
    // THE PRODUCTION STRATEGIES. Compare that subset, not the raw count: the
    // worker sweep backfills exp_* strategies on a 1-minute cadence, so on a
    // slow runner a legitimate sweep row can land between these two snapshots
    // (CI run 29804767919, 2026-07-21: raw count 2 → 3 mid-test). Sweep
    // additions are not duplicate-check leaks; new PRODUCTION rows would be.
    const prodOnly = (rows: Awaited<ReturnType<typeof traceVectorShape>>) =>
      rows.filter((r) => r.strategy_id === "full_document" || r.strategy_id === "full_recipe_context");
    const rowsAfterSecond = await traceVectorShape(recipeId!);
    expect(prodOnly(rowsAfterSecond)).toHaveLength(prodOnly(rowsAfterFirst).length);
    // And the search half still ran (results array present).
    expect(second.data?.results).toBeDefined();
  });
});
