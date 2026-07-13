import { describe, it, expect } from "vitest";
import postgres from "postgres";

/**
 * Integration test for the account-deletion data-retention fix (2026-07-12):
 * DELETE /auth/me routes through deleteUserCascade (user-delete.service.ts),
 * which must remove EVERYTHING attributable to the user — including the
 * rows the old hand-rolled deletion list leaked:
 *
 *   - evidence + references spawned by the user's traces
 *   - embedding_sources / embedding_chunks / embedding_vectors (these hold
 *     recipe + evidence text in CLEARTEXT — the core of the finding)
 *   - reference_source_cache rows for the user's references
 *   - check_feedback authored by the user's api keys about OTHER users'
 *     traces (attributable only via api_key_id → api_keys.user_id, so they
 *     must go before the api_keys rows)
 *   - uploads owned by the user's api keys
 *
 * …while preserving by design:
 *   - vector_cache rows (content-hash keyed, no source text — PII-free)
 *   - audit_log entries (append-only trail, §5 retention)
 *   - other users' traces and content
 *
 * Requires a running backend (BACKEND_URL) with EMBEDDINGS_PROVIDER=stub
 * and direct DB access via PG* env vars — same setup as auth-delete.test.ts.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface RegisterResponse {
  data?: { verificationToken?: string };
}
interface LoginResponse {
  data?: { token?: string };
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

async function provisionUser(suffix: string): Promise<{ token: string; userId: string; email: string; password: string }> {
  const email = `cascade-${Date.now()}-${suffix}@test.local`;
  const password = "cascade-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as RegisterResponse;
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error("Setup: verificationToken missing");
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
  const loginBody = (await login.json()) as LoginResponse;
  const token = loginBody.data?.token;
  if (!token) throw new Error("Setup: login failed");
  const meRes = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meBody = (await meRes.json()) as { data?: { user?: { id: string } } };
  const userId = meBody.data?.user?.id;
  if (!userId) throw new Error("Setup: /auth/me missing id");
  return { token, userId, email, password };
}

async function mintDailyKey(jwt: string): Promise<string> {
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const key = keyBody.data?.key;
  if (!key) throw new Error("Setup: daily key mint failed");
  return key;
}

async function checkRecipe(apiKey: string, recipe: string, evidence: string): Promise<string> {
  const params = new URLSearchParams({
    key: apiKey,
    trace: recipe,
    ef: evidence,
    format: "json",
  });
  const res = await fetch(`${BASE}/check?${params.toString()}`, { headers: { Accept: "application/json" } });
  const json = (await res.json()) as { data?: { recipeId?: string } };
  const traceId = json.data?.recipeId ?? "";
  if (!traceId) throw new Error(`Setup: /check did not return a recipeId (status ${res.status})`);
  return traceId;
}

describe.skipIf(!BASE)("DELETE /auth/me — full data cascade (no PII survives)", () => {
  it("removes evidence, references, embedding rows, cache, feedback, uploads — and preserves vector_cache", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const userA = await provisionUser("cascade-a");
      const userB = await provisionUser("cascade-b");
      const keyB = await mintDailyKey(userB.token);

      // B checks a recipe first; A joins B's book BEFORE minting A's key
      // (daily keys capture the member books as read scope at mint time).
      const now = Date.now();
      const traceB = await checkRecipe(
        keyB,
        `As a developer working on shared books, I prefer feedback attribution to be explicit so that deletion can find it. (${now})`,
        `Fixture for the cross-user feedback path.\n> "feedback rides on api_key_id"\n-- cascade test fixture B`,
      );
      const bGroupRows: Array<{ group_id: string }> = await sql`
        SELECT group_id FROM claimnet.traces WHERE id = ${traceB}::uuid
      `;
      const bGroupId = bGroupRows[0]?.group_id;
      expect(bGroupId).toBeTruthy();
      await sql`
        INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read)
        VALUES (${bGroupId!}::uuid, ${userA.userId}::uuid, 'member', true)
      `;

      const keyA = await mintDailyKey(userA.token);

      // A checks two recipes with evidence + a quoted reference each —
      // populates traces, evidence, references, the link tables, and the
      // embedding pipeline (sources/chunks/vectors are written in the same
      // transaction as the trace; EMBEDDINGS_PROVIDER=stub embeds inline).
      const traceA1 = await checkRecipe(
        keyA,
        `As a developer working on deletion cascades, I chose a unified teardown service so that the deletion list cannot drift per call site. (${now})`,
        `The old hand-rolled list already drifted once.\n> "auth.ts's explicit deletion list doesn't touch this table"\n-- cascade test fixture A1`,
      );
      const traceA2 = await checkRecipe(
        keyA,
        `As a developer working on data retention, I prefer cleartext user content to die with the account so that deletion means deletion. (${now})`,
        `Embedding sources hold source text verbatim.\n> "embedding_sources.source_text holds cleartext"\n-- cascade test fixture A2`,
      );
      const aTraceIds = [traceA1, traceA2];

      // A uploads a file (owned by A's api key).
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: "application/pdf" }), "cascade-test.pdf");
      const upRes = await fetch(`${BASE}/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${keyA}` },
        body: form,
      });
      expect(upRes.status).toBeLessThan(300);

      // A's key logs feedback about B's trace — a check_feedback row that is
      // attributable to A ONLY via api_key_id → api_keys.user_id.
      const fbRes = await fetch(`${BASE}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
        body: JSON.stringify({
          trace_id: traceB,
          kind: "check-feedback",
          impact: "subtle",
          disposition: "proceeded",
          story_fulfilled: "yes",
          story: "As a developer testing deletion, I wanted cross-user feedback so that the api_key attribution path is exercised.",
        }),
      });
      expect(fbRes.status).toBeLessThan(300);

      // ── Capture A's data graph BEFORE deletion ──
      const aKeyIds = (await sql`
        SELECT id FROM claimnet.api_keys WHERE user_id = ${userA.userId}::uuid
      ` as Array<{ id: string }>).map((r) => r.id);
      expect(aKeyIds.length).toBeGreaterThan(0);

      const aEvidenceIds = (await sql`
        SELECT DISTINCT evidence_id AS id FROM claimnet.trace_evidence
        WHERE trace_id IN ${sql(aTraceIds)}
      ` as Array<{ id: string }>).map((r) => r.id);
      const aReferenceIds = (await sql`
        SELECT DISTINCT reference_id AS id FROM claimnet.trace_references
        WHERE trace_id IN ${sql(aTraceIds)}
      ` as Array<{ id: string }>).map((r) => r.id);
      expect(aEvidenceIds.length).toBeGreaterThan(0);
      expect(aReferenceIds.length).toBeGreaterThan(0);

      const aEntityIds = [...aTraceIds, ...aEvidenceIds, ...aReferenceIds];
      const aSourceIds = (await sql`
        SELECT id FROM claimnet.embedding_sources WHERE source_id IN ${sql(aEntityIds)}
      ` as Array<{ id: string }>).map((r) => r.id);
      expect(aSourceIds.length).toBeGreaterThan(0);

      const aChunkHashes = (await sql`
        SELECT DISTINCT chunk_hash FROM claimnet.embedding_chunks
        WHERE embedding_source_id IN ${sql(aSourceIds)}
      ` as Array<{ chunk_hash: string }>).map((r) => r.chunk_hash);
      expect(aChunkHashes.length).toBeGreaterThan(0);

      const cachedBefore: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.vector_cache WHERE content_hash IN ${sql(aChunkHashes)}
      `;
      expect(cachedBefore[0]!.n).toBeGreaterThan(0);

      // Seed a reference_source_cache row for one of A's references (the
      // fetch worker is dormant — simulate what it would write).
      await sql`
        INSERT INTO claimnet.reference_source_cache
          (reference_id, url, content_type, cached_content, fetch_strategy, fetched_at)
        VALUES
          (${aReferenceIds[0]!}::uuid, 'https://example.test/cascade', 'text/html',
           'cached page text that must not outlive the account', 'html_sanitized', now())
      `;

      const uploadsBefore: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.uploads WHERE api_key_id IN ${sql(aKeyIds)}
      `;
      expect(uploadsBefore[0]!.n).toBe(1);
      const feedbackBefore: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.check_feedback WHERE api_key_id IN ${sql(aKeyIds)}
      `;
      expect(feedbackBefore[0]!.n).toBe(1);

      // ── Delete A's account ──
      const delRes = await fetch(`${BASE}/auth/me`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
        body: JSON.stringify({ password: userA.password }),
      });
      expect(delRes.status).toBe(200);

      // ── Zero-rows assertions across every leaked table ──
      const zeroCounts: Record<string, number> = {};
      const q = async (label: string, rows: Array<{ n: number }>) => {
        zeroCounts[label] = rows[0]!.n;
      };
      await q("traces", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id IN ${sql(aTraceIds)}
      `);
      await q("trace_evidence", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id IN ${sql(aTraceIds)}
      `);
      await q("trace_references", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.trace_references WHERE trace_id IN ${sql(aTraceIds)}
      `);
      await q("evidence", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.evidence WHERE id IN ${sql(aEvidenceIds)}
      `);
      await q("references", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.references WHERE id IN ${sql(aReferenceIds)}
      `);
      await q("embedding_sources", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources WHERE source_id IN ${sql(aEntityIds)}
      `);
      await q("embedding_chunks", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_chunks WHERE embedding_source_id IN ${sql(aSourceIds)}
      `);
      await q("embedding_chunk_strategies", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_chunk_strategies WHERE embedding_source_id IN ${sql(aSourceIds)}
      `);
      await q("embedding_vectors", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_vectors WHERE embedding_chunk_id IN (
          SELECT id FROM claimnet.embedding_chunks WHERE embedding_source_id IN ${sql(aSourceIds)}
        )
      `);
      await q("reference_source_cache", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.reference_source_cache WHERE reference_id IN ${sql(aReferenceIds)}
      `);
      await q("check_feedback (A-authored)", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.check_feedback WHERE api_key_id IN ${sql(aKeyIds)}
      `);
      await q("uploads", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.uploads WHERE api_key_id IN ${sql(aKeyIds)}
      `);
      await q("api_keys", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.api_keys WHERE user_id = ${userA.userId}::uuid
      `);
      await q("users", await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.users WHERE id = ${userA.userId}::uuid
      `);
      expect(zeroCounts).toEqual(Object.fromEntries(Object.keys(zeroCounts).map((k) => [k, 0])));

      // ── Survivors by design ──
      // vector_cache: content-hash keyed, no source text — must survive.
      const cachedAfter: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.vector_cache WHERE content_hash IN ${sql(aChunkHashes)}
      `;
      expect(cachedAfter[0]!.n).toBe(cachedBefore[0]!.n);

      // audit_log: the self-delete entry outlives the actor (§5 retention).
      const auditRows: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.audit_log
        WHERE actor_user_id = ${userA.userId}::uuid AND action = 'user.self_delete'
      `;
      expect(auditRows[0]!.n).toBe(1);

      // B's trace and content are untouched.
      const bTraceStill: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${traceB}::uuid
      `;
      expect(bTraceStill[0]!.n).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
