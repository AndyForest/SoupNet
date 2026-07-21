/**
 * GET /health/integrity — API-key-authed retrieval-index integrity check.
 *
 * The (b1) surface of the eval-reset contract: a read-only validity gate that
 * eval runners call before every scored run. Design: the operator's ruled
 * response, docs/planning/eval-reset-contract-response.md item (b1) ("an
 * endpoint reporting orphaned embedding rows per book/user for pre-run validity
 * gates"); requirements rationale in docs/planning/eval-reset-contract.md §2(b).
 * Purpose, verbatim from the contract: "a validity gate needs to prove
 * index-consistency cheaply" — so a runner asserts a clean scope in one read
 * before it spends benchmark budget on a stack with a corrupt index.
 *
 * What it reports, per readable book: counts of ORPHANED embedding sources —
 * `source_type = 'trace'` rows whose `source_id` no longer resolves in
 * claimnet.traces, and `source_type = 'evidence'` rows whose `source_id` no
 * longer resolves in claimnet.evidence — plus the dependent orphaned chunk and
 * vector counts hanging off those sources, and up to 10 sample orphaned source
 * ids (the dangling trace/evidence ids). Samples let a runner file a precise
 * report without a full dump. `summary` totals the same across the key's scope
 * and carries `clean` (true iff every count is zero). This is the exact
 * external-tampering / crashed-import damage class that leaves an embedding row
 * pointing at a source object the service cascade would have removed together.
 *
 * Auth: any valid API key, accepted as a Bearer header OR a `?key=` query param
 * — the same dual acceptance as /check and /health/version. NEVER
 * unauthenticated. A missing, invalid, OR expired key all return the identical
 * uniform 401 "Invalid or expired API key" (the standing anti-enumeration
 * ruling: "Invalid and expired keys are deliberately indistinguishable").
 *
 * Scope (anti-enumeration): strictly the PRESENTING key's `read_group_ids` —
 * no global counts, no other-tenant information. Orphans are attributed to
 * books by `embedding_sources.group_id`, which survives even when the source's
 * trace/evidence row is gone, so a book still owns its orphans. The report is
 * scoped to books whose row still EXISTS in the key's read set (inner join
 * against claimnet.groups); orphans whose book row itself is already gone are
 * deferred to the forward-compat section below rather than emitted as a bare
 * group id with no book to name it (corpus recipe b7c56886).
 *
 * FORWARD-COMPATIBILITY (do not implement here): when ephemeral workspaces land
 * (eval-reset contract step 3, the tombstone-at-expiry design in
 * eval-reset-contract-response.md item (b1)), this response gains an "expired,
 * not yet reaped" section — books past their TTL that the reaper has not yet
 * physically deleted — so a validity gate asserts a clean scope, orphans AND
 * un-reaped tombstones, in one read.
 *
 * Performance: one set-based query — NOT EXISTS anti-joins scoped by `group_id`
 * IN the key's read set, aggregated per book, LEFT JOINed back onto the full
 * readable-book list so zero-orphan books still appear (a validity gate needs
 * the affirmative zero). No per-book loop, no O(books × table-scan). This is an
 * occasional pre-run gate, not a hot path.
 *
 * Rate limiting: follows the /recipes + /health/version precedent — a generous
 * in-memory per-credential cap with a per-IP limiter first for defense in depth
 * against many-key scraping from one host. Cheap read-only endpoint; legitimate
 * fleet use should never hit the throttle first.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { validateKey } from "../services/api-key.service";
import { rateLimit, getClientIp, hashApiKey } from "../middleware/rate-limit";

/** Pull the raw api key from a Bearer header or the `?key=` query param —
 *  the same dual acceptance /check and /health/version offer. Bearer wins. */
function extractKey(c: Context): string | null {
  const auth = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (match) return match[1]!.trim();
  const q = c.req.query("key");
  return q ? q.trim() : null;
}

// Per-IP: 1000/hour (defense in depth, same shape as /recipes' per-IP limiter).
const integrityIpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

// Per-credential: 600/hour keyed by hashed key (raw keys must not sit in
// memory as map keys). Falls back to IP bucketing when no key is present.
const integrityPerKeyRateLimit = rateLimit({
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const token = extractKey(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

const integrity = new Hono<AppEnv>();

/** One row per readable book, as returned by the integrity query. */
interface IntegrityRow {
  recipe_book_id: string;
  slug: string;
  name: string;
  orphaned_sources: number;
  orphaned_chunks: number;
  orphaned_vectors: number;
  sample_source_ids: string[];
}

interface BookIntegrity {
  recipeBookId: string;
  slug: string;
  name: string;
  orphanedSources: number;
  orphanedChunks: number;
  orphanedVectors: number;
  sampleOrphanSourceIds: string[];
}

/**
 * Set-based orphan report scoped to the key's readable books.
 *
 * `scope` is the readable books that still exist. `orphan_sources` is every
 * embedding_sources row in that scope whose backing trace/evidence row is gone
 * (NOT EXISTS anti-join). Chunk/vector orphans hang off those sources. The
 * three aggregates LEFT JOIN back onto `scope` so a book with zero orphans
 * still emits a row with the affirmative zeros. `orphaned_sources` counts
 * source ROWS; `sample_source_ids` de-dupes the dangling source_id values
 * (one trace yields two 'trace' sources — claim + full-recipe-context — sharing
 * one source_id) and caps at 10.
 */
async function readIntegrity(
  db: ReturnType<typeof getDb>,
  readGroupIds: string[],
): Promise<BookIntegrity[]> {
  // Empty read scope: nothing to scan. Short-circuit so the array literal below
  // never has to render an empty (untyped) ARRAY[].
  if (readGroupIds.length === 0) return [];

  const groupIdArray = sql`ARRAY[${sql.join(
    readGroupIds.map((g) => sql`${g}::uuid`),
    sql`,`,
  )}]`;

  const rows = await db.execute(sql`
    WITH scope AS (
      SELECT id, slug, name
      FROM claimnet.groups
      WHERE id = ANY(${groupIdArray})
    ),
    orphan_sources AS (
      SELECT es.id, es.group_id, es.source_id
      FROM claimnet.embedding_sources es
      WHERE es.group_id = ANY(${groupIdArray})
        AND (
          (es.source_type = 'trace' AND NOT EXISTS (
            SELECT 1 FROM claimnet.traces t WHERE t.id = es.source_id))
          OR
          (es.source_type = 'evidence' AND NOT EXISTS (
            SELECT 1 FROM claimnet.evidence e WHERE e.id = es.source_id))
        )
    ),
    orphan_chunks AS (
      SELECT ec.id, os.group_id
      FROM claimnet.embedding_chunks ec
      JOIN orphan_sources os ON os.id = ec.embedding_source_id
    ),
    orphan_vectors AS (
      SELECT ev.id, oc.group_id
      FROM claimnet.embedding_vectors ev
      JOIN orphan_chunks oc ON oc.id = ev.embedding_chunk_id
    ),
    src_agg AS (
      SELECT group_id,
             COUNT(*)::int AS n_sources,
             (ARRAY_AGG(DISTINCT source_id))[1:10] AS sample_ids
      FROM orphan_sources
      GROUP BY group_id
    ),
    chunk_agg AS (
      SELECT group_id, COUNT(*)::int AS n_chunks
      FROM orphan_chunks GROUP BY group_id
    ),
    vec_agg AS (
      SELECT group_id, COUNT(*)::int AS n_vectors
      FROM orphan_vectors GROUP BY group_id
    )
    SELECT
      s.id AS recipe_book_id,
      s.slug,
      s.name,
      COALESCE(sa.n_sources, 0) AS orphaned_sources,
      COALESCE(ca.n_chunks, 0) AS orphaned_chunks,
      COALESCE(va.n_vectors, 0) AS orphaned_vectors,
      COALESCE(sa.sample_ids, ARRAY[]::uuid[]) AS sample_source_ids
    FROM scope s
    LEFT JOIN src_agg sa ON sa.group_id = s.id
    LEFT JOIN chunk_agg ca ON ca.group_id = s.id
    LEFT JOIN vec_agg va ON va.group_id = s.id
    ORDER BY s.slug ASC
  `);

  return (rows as unknown as IntegrityRow[]).map((r) => ({
    recipeBookId: r.recipe_book_id,
    slug: r.slug,
    name: r.name,
    orphanedSources: r.orphaned_sources,
    orphanedChunks: r.orphaned_chunks,
    orphanedVectors: r.orphaned_vectors,
    sampleOrphanSourceIds: r.sample_source_ids ?? [],
  }));
}

// GET /health/integrity
// Authorization: Bearer <api-key>  OR  ?key=<api-key>. No JWT — agent surface.
integrity.get("/", integrityIpRateLimit, integrityPerKeyRateLimit, async (c) => {
  const rawKey = extractKey(c);
  if (!rawKey) {
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  const db = getDb();
  const validated = await validateKey(db, rawKey);
  if (!validated) {
    // Uniform 401 — a missing, invalid, and expired key are indistinguishable.
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  const books = await readIntegrity(db, validated.readGroupIds);

  const totalSources = books.reduce((n, b) => n + b.orphanedSources, 0);
  const totalChunks = books.reduce((n, b) => n + b.orphanedChunks, 0);
  const totalVectors = books.reduce((n, b) => n + b.orphanedVectors, 0);

  return c.json({
    ok: true,
    data: {
      books,
      summary: {
        booksScanned: books.length,
        orphanedSources: totalSources,
        orphanedChunks: totalChunks,
        orphanedVectors: totalVectors,
        // The affirmative a validity gate reads: index is consistent across
        // the whole scope. True iff every orphan count is zero.
        clean: totalSources === 0 && totalChunks === 0 && totalVectors === 0,
      },
    },
  });
});

export { integrity as integrityRoutes };
