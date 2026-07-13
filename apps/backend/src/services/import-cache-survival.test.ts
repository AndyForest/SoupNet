import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

/**
 * Regression test for the vector-cache survival guarantee (corpus-import v1.1,
 * Andy 2026-07-13): "let's double check that deleting a user doesn't delete
 * their entries in the vector cache. We want to keep those precisely for this
 * kind of thing."
 *
 * The vector_cache is content-addressed (content_hash + model_id + task_type),
 * deliberately cross-user, and holds no source text — so deleting a user must
 * NOT evict shared cache entries, and re-importing the same content as another
 * user must re-embed for free. This is the property that makes the
 * fresh-user-per-corpus pattern cheap on a single instance.
 *
 * The loop, driven through the REAL production paths (importCorpus,
 * deleteUserCascade, and the cache-first getOrCreateCachedVector that both the
 * sync check path and the async worker's vector-check share):
 *   create user A → import content → embed (populates vector_cache)
 *   → delete user A → assert vector_cache rows SURVIVE
 *   → re-import the same content as user B → assert the re-embed is a cache
 *     HIT (0 provider calls: the surviving row is returned unchanged, never
 *     re-inserted — a miss would mint a new id + created_at).
 *
 * Service-level (no HTTP): needs a DB (PG* env) and the deterministic stub
 * provider so the "embed" step never touches a real API. Both hold in the CI
 * gate (docker-compose.ci.yml + EMBEDDINGS_PROVIDER=stub).
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let importCorpus: typeof import("./import.service").importCorpus;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let deleteUserCascade: typeof import("./user-delete.service").deleteUserCascade;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let parseExportPayload: typeof import("./import-validate").parseExportPayload;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getOrCreateCachedVector: typeof import("../lib/embeddings/enqueue").getOrCreateCachedVector;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getEmbeddingModelId: typeof import("../lib/embeddings/provider").getEmbeddingModelId;

const uid = Date.now();
const TASK = "SEMANTIC_SIMILARITY";

function canRun(): boolean {
  return (
    !!(process.env["DATABASE_URL"] || process.env["PGHOST"]) &&
    // Only with the deterministic stub — a cache MISS calls the real provider,
    // and this test intentionally forces a miss for user A.
    (process.env["EMBEDDINGS_PROVIDER"] ?? "gemini") === "stub"
  );
}

/** A one-trace corpus (trace + evidence + reference + links), unique per call. */
function buildCorpusFile(tag: string): Record<string, unknown> {
  const t = crypto.randomUUID();
  const ev = crypto.randomUUID();
  const ref = crypto.randomUUID();
  const now = "2026-07-01T12:00:00.000Z";
  return {
    schemaVersion: 1,
    traces: [
      {
        id: t,
        groupId: null,
        claimText: `As a corpus owner moving between instances (${tag}), I prefer the content-addressed cache so that a re-import costs zero provider calls.`,
        claimTextHash: null,
        formatAdherenceScore: 0.8,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    evidence: [{ id: ev, content: `Cache survival fixture ${tag}.`, createdAt: now, updatedAt: now }],
    references: [
      { id: ref, quote: "keep the cache across deletion", source: `fixture ${tag}`, fileUrl: null, fileMimeType: null, fileHash: null, createdAt: now },
    ],
    traceEvidence: [{ id: crypto.randomUUID(), traceId: t, evidenceId: ev, stance: "for", apiKeyId: null, createdAt: now }],
    traceReferences: [{ id: crypto.randomUUID(), traceId: t, referenceId: ref, apiKeyId: null, createdAt: now }],
    evidenceReferences: [{ id: crypto.randomUUID(), evidenceId: ev, referenceId: ref, createdAt: now }],
  };
}

async function createUserWithOrg(label: string): Promise<{ userId: string; orgId: string }> {
  const db = getDb();
  const email = `import-cache-${uid}-${label}@test.local`;
  const userRows = await db.execute(sql`
    INSERT INTO claimnet.users (email, password_hash, tos_accepted_at, email_verified_at)
    VALUES (${email}, ${"x".repeat(60)}, now(), now())
    RETURNING id
  `);
  const userId = (userRows as unknown as Array<{ id: string }>)[0]!.id;
  const orgRows = await db.execute(sql`
    INSERT INTO claimnet.organizations (name, slug, owner_id, is_personal)
    VALUES (${`Cache Test ${label} ${uid}`}, ${`cache-${label}-${uid}`}, ${userId}::uuid, true)
    RETURNING id
  `);
  const orgId = (orgRows as unknown as Array<{ id: string }>)[0]!.id;
  return { userId, orgId };
}

/** The evidence chunk (hash + text) import queued for a user's imported corpus. */
async function readEvidenceChunk(userId: string): Promise<{ chunkHash: string; chunkText: string }> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT ec.chunk_hash AS "chunkHash", ec.chunk_text AS "chunkText"
    FROM claimnet.embedding_chunks ec
    JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
    JOIN claimnet.evidence e ON e.id = es.source_id
    JOIN claimnet.trace_evidence te ON te.evidence_id = e.id
    JOIN claimnet.traces t ON t.id = te.trace_id
    WHERE es.source_type = 'evidence' AND t.user_id = ${userId}::uuid
    LIMIT 1
  `);
  const row = (rows as unknown as Array<{ chunkHash: string; chunkText: string }>)[0];
  if (!row) throw new Error("no evidence embedding chunk found for user");
  return row;
}

async function cacheRow(chunkHash: string, modelId: string): Promise<{ id: string; createdAt: string } | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT id, created_at AS "createdAt" FROM claimnet.vector_cache
    WHERE content_hash = ${chunkHash} AND model_id = ${modelId} AND task_type = ${TASK}
  `);
  const list = rows as unknown as Array<{ id: string; createdAt: string }>;
  return list.length === 1 ? list[0]! : (list.length === 0 ? null : (() => { throw new Error("duplicate cache rows"); })());
}

describe.skipIf(!canRun())("vector_cache survives user deletion → cross-user re-embed is free", () => {
  beforeAll(async () => {
    const dbMod = await import("../db");
    const drizzleMod = await import("drizzle-orm");
    getDb = dbMod.getDb;
    sql = drizzleMod.sql;
    importCorpus = (await import("./import.service")).importCorpus;
    deleteUserCascade = (await import("./user-delete.service")).deleteUserCascade;
    parseExportPayload = (await import("./import-validate")).parseExportPayload;
    getOrCreateCachedVector = (await import("../lib/embeddings/enqueue")).getOrCreateCachedVector;
    getEmbeddingModelId = (await import("../lib/embeddings/provider")).getEmbeddingModelId;
  });

  it("deletes a user without evicting their shared cache entries, then re-embeds identical content with 0 provider calls", async () => {
    const db = getDb();
    const modelId = getEmbeddingModelId();
    const corpus = buildCorpusFile(`c${uid}`);

    // ── User A: import + embed (populate the cache) ──
    const a = await createUserWithOrg("a");
    const parsedA = parseExportPayload(corpus);
    expect(parsedA.ok).toBe(true);
    if (!parsedA.ok) return;
    await importCorpus(db, parsedA.data, { userId: a.userId, overwrite: false });

    const chunkA = await readEvidenceChunk(a.userId);
    // First embed = cache miss → stub provider → writes vector_cache.
    const vecA = await getOrCreateCachedVector(db, chunkA.chunkHash, chunkA.chunkText, TASK);
    expect(vecA).not.toBeNull();
    const before = await cacheRow(chunkA.chunkHash, modelId);
    expect(before).not.toBeNull();

    // ── Delete user A ──
    await deleteUserCascade(db, a.userId);

    // A's traces/evidence/embedding rows are gone…
    const aTraces = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE user_id = ${a.userId}::uuid
    `);
    expect((aTraces as unknown as Array<{ n: number }>)[0]!.n).toBe(0);

    // …but the content-addressed cache row SURVIVES, byte-for-byte (same id +
    // created_at — not re-created). This is the core regression assertion.
    const survived = await cacheRow(chunkA.chunkHash, modelId);
    expect(survived).not.toBeNull();
    expect(survived!.id).toBe(before!.id);
    expect(new Date(survived!.createdAt).getTime()).toBe(new Date(before!.createdAt).getTime());

    // ── User B: re-import the SAME corpus, re-embed identical content ──
    const b = await createUserWithOrg("b");
    const parsedB = parseExportPayload(corpus);
    expect(parsedB.ok).toBe(true);
    if (!parsedB.ok) return;
    await importCorpus(db, parsedB.data, { userId: b.userId, overwrite: false });

    const chunkB = await readEvidenceChunk(b.userId);
    // Identical content ⇒ identical content hash ⇒ the surviving cache row is
    // the key B will hit.
    expect(chunkB.chunkHash).toBe(chunkA.chunkHash);

    const vecB = await getOrCreateCachedVector(db, chunkB.chunkHash, chunkB.chunkText, TASK);
    expect(vecB).not.toBeNull();
    // Cache HIT ⇒ 0 provider calls: getOrCreateCachedVector returns before ever
    // reaching the provider on a hit, and never inserts. A miss would have
    // minted a NEW row (new id/created_at); the row is unchanged, so the
    // re-embed was free.
    const afterB = await cacheRow(chunkB.chunkHash, modelId);
    expect(afterB).not.toBeNull();
    expect(afterB!.id).toBe(before!.id);
    expect(new Date(afterB!.createdAt).getTime()).toBe(new Date(before!.createdAt).getTime());
    // (vecA is the miss-path full-precision string; vecB is Postgres's
    // vector::text render of the same surviving row — same vector, different
    // text precision — so identity is asserted on the cache ROW above, not the
    // serialized string.)

    // Cleanup.
    await deleteUserCascade(db, b.userId);
  }, 60_000);
});
