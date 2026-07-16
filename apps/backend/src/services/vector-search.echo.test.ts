import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { DEFAULT_ECHO_SUPPRESSION } from "@soupnet/domain";
import type { EchoSuppressionConfig } from "@soupnet/domain";

/**
 * Echo-suppression ranking — full-stack integration test.
 *
 * Requires a running backend + postgres (skipped otherwise). Seeds three traces
 * with HAND-CRAFTED unit vectors so cosine similarity to the query is exactly
 * controlled — no dependence on the embedding provider — then drives the real
 * hybridSearch SQL path with echo suppression off vs on and asserts the reorder.
 *
 * Proves the four required properties end-to-end:
 *   1. a same-agent recent hypothesis is demoted BELOW an older cross-agent
 *      recipe of similar similarity (S drops under O),
 *   2. displayed similarity percentages are unchanged (reorder only),
 *   3. nothing is truncated (all three results remain),
 *   4. flag off = byte-stable (pure relevance order).
 *
 * A curated (decided_at) same-agent recent recipe (C) is exempt from demotion —
 * it keeps its relevance position even with echo on.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let hybridSearch: typeof import("./vector-search.service").hybridSearch;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let validateKey: typeof import("../services/api-key.service").validateKey;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getEmbeddingModelId: typeof import("../lib/embeddings/provider").getEmbeddingModelId;

const DIMS = 3072;

/** Unit vector: value `a` at index 0, the residual mass at index 1, rest zero.
 *  cosine(e0, v) === a exactly (v is unit-norm). */
function unitVec(a: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[0] = a;
  v[1] = Math.sqrt(1 - a * a);
  return v;
}
const toPgVec = (v: number[]) => `[${v.join(",")}]`;

// Query at e0; each trace's cosine similarity to it is its index-0 value.
const Q = unitVec(1); // [1, 0, 0, ...]
const SIM_S = 0.82; // self, recent, non-curated  → demoted when on
const SIM_C = 0.81; // self, recent, curated       → exempt
const SIM_O = 0.8; //  cross-agent, old            → never demoted

const uid = Date.now();

interface Seed {
  id: string;
  apiKeyId: string;
  createdAtSql: string;
  decidedAt: string | null;
  vector: number[];
}

describe.skipIf(!BASE)("echo suppression (hybridSearch, seeded vectors)", () => {
  let modelId = "";
  let groupId = "";
  let selfKeyId = "";
  const crossKeyId = crypto.randomUUID(); // a different "agent"
  let userId = "";
  const seeds: Record<"S" | "C" | "O", Seed> = {} as never;

  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    hybridSearch = (await import("./vector-search.service")).hybridSearch;
    validateKey = (await import("../services/api-key.service")).validateKey;
    getEmbeddingModelId = (await import("../lib/embeddings/provider")).getEmbeddingModelId;
    modelId = getEmbeddingModelId();

    // Register + verify + login + mint a daily key (gives us a valid user,
    // group, and — via validateKey — this agent's api_key_id).
    const email = `test-echo-${uid}@test.local`;
    const password = "echo-test-password";
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Backend did not return verificationToken — ALLOW_AUTO_SETUP must be true");
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
    const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    });
    const apiKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!apiKey) throw new Error("Failed to mint API key for echo test");

    const kr = await validateKey(getDb(), apiKey);
    if (!kr) throw new Error("validateKey failed for echo test key");
    selfKeyId = kr.keyId;
    groupId = kr.defaultWriteGroupId;
    userId = kr.userId;

    seeds.S = { id: crypto.randomUUID(), apiKeyId: selfKeyId, createdAtSql: "now()", decidedAt: null, vector: unitVec(SIM_S) };
    seeds.C = { id: crypto.randomUUID(), apiKeyId: selfKeyId, createdAtSql: "now()", decidedAt: "2024-01-01T00:00:00Z", vector: unitVec(SIM_C) };
    seeds.O = { id: crypto.randomUUID(), apiKeyId: crossKeyId, createdAtSql: "now() - interval '40 days'", decidedAt: null, vector: unitVec(SIM_O) };

    const db = getDb();
    for (const key of ["S", "C", "O"] as const) {
      const s = seeds[key];
      const claim = `echo-test-${uid}-${key}`;
      const claimHash = crypto.createHash("sha256").update(claim).digest("hex");
      const chunkHash = crypto.createHash("sha256").update(`${claim}-chunk`).digest("hex");

      await db.execute(sql`
        INSERT INTO claimnet.traces (id, user_id, group_id, api_key_id, claim_text, claim_text_hash, decided_at, created_at)
        VALUES (${s.id}::uuid, ${userId}::uuid, ${groupId}::uuid, ${s.apiKeyId}::uuid, ${claim}, ${claimHash},
                ${s.decidedAt}::timestamptz, ${sql.raw(s.createdAtSql)})
      `);
      const srcRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_sources (source_type, source_id, group_id, source_text, artifact_category)
        VALUES ('trace', ${s.id}::uuid, ${groupId}::uuid, ${claim}, 'text')
        RETURNING id
      `);
      const sourceId = (srcRows as unknown as Array<{ id: string }>)[0]!.id;
      const stratRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_chunk_strategies (embedding_source_id, strategy_id, status)
        VALUES (${sourceId}::uuid, 'full_document', 'complete')
        RETURNING id
      `);
      const strategyId = (stratRows as unknown as Array<{ id: string }>)[0]!.id;
      const chunkRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_chunks (embedding_source_id, chunk_strategy_id, chunk_text, chunk_hash, chunk_path)
        VALUES (${sourceId}::uuid, ${strategyId}::uuid, ${claim}, ${chunkHash}, 'doc')
        RETURNING id
      `);
      const chunkId = (chunkRows as unknown as Array<{ id: string }>)[0]!.id;
      await db.execute(sql`
        INSERT INTO claimnet.embedding_vectors (embedding_chunk_id, model_id, task_type, status, vector, vector_source)
        VALUES (${chunkId}::uuid, ${modelId}, 'SEMANTIC_SIMILARITY', 'complete', ${toPgVec(s.vector)}::halfvec(3072), 'server')
      `);
    }
  }, 60_000);

  const runSearch = (config: EchoSuppressionConfig) =>
    hybridSearch(getDb(), {
      recipeText: "unused — queryVectorStr provided",
      groupIds: [groupId],
      limit: 10,
      offset: 0,
      queryVectorStr: toPgVec(Q),
      echo: { config, currentApiKeyId: selfKeyId, now: new Date() },
    });

  // Only our three seeds share this run's unique claim prefix.
  const ourResults = (results: Array<{ id: string; semanticScore: number | null }>) =>
    results.filter((r) => [seeds.S.id, seeds.C.id, seeds.O.id].includes(r.id));

  it("flag OFF: pure relevance order S, C, O (byte-stable)", async () => {
    const resp = await runSearch(DEFAULT_ECHO_SUPPRESSION); // enabled: false
    const ours = ourResults(resp.results);
    expect(ours.map((r) => r.id)).toEqual([seeds.S.id, seeds.C.id, seeds.O.id]);
  });

  it("flag ON: demotes the same-agent recent hypothesis below the older cross-agent recipe", async () => {
    const on: EchoSuppressionConfig = { ...DEFAULT_ECHO_SUPPRESSION, enabled: true };
    const resp = await runSearch(on);
    const ours = ourResults(resp.results);

    // C (curated, exempt) stays on top; O (cross-agent) now ranks above S
    // (self, recent, demoted). S was #1 by raw similarity — it is now last.
    expect(ours.map((r) => r.id)).toEqual([seeds.C.id, seeds.O.id, seeds.S.id]);

    // Percentages still reported and UNCHANGED — reorder only, not rescaled.
    const s = ours.find((r) => r.id === seeds.S.id)!;
    expect(s.semanticScore).toBeCloseTo(SIM_S, 2);
    const o = ours.find((r) => r.id === seeds.O.id)!;
    expect(o.semanticScore).toBeCloseTo(SIM_O, 2);

    // No truncation — all three still present.
    expect(ours).toHaveLength(3);
  });
});
