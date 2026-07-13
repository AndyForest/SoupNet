/**
 * Repair orphaned user data left behind by past account deletions.
 *
 * Before user-delete.service.ts unified the teardown path (2026-07-12),
 * DELETE /auth/me removed traces and their link rows but left behind the
 * evidence, references, and embedding pipeline rows those traces spawned —
 * embedding_sources.source_text and embedding_chunks.chunk_text hold the
 * deleted user's recipe + evidence text in cleartext. This script finds and
 * removes those historical orphans:
 *
 *   - evidence rows with no trace_evidence link (unreachable — evidence is
 *     only ever reached through a trace), plus their evidence_references
 *     links and embedding chains
 *   - references rows with no trace_references AND no evidence_references
 *     link (computed after the orphaned-evidence pass, since pruning
 *     evidence can orphan references), plus their reference_source_cache
 *     rows and embedding chains
 *   - embedding_sources (with their chunk_strategies / chunks / vectors)
 *     whose owning trace / evidence / reference row no longer exists
 *   - reference_source_cache rows whose reference no longer exists
 *     (defensive — the FK should prevent these)
 *
 * Deliberately NOT touched: vector_cache (content-hash keyed, no source
 * text, PII-free by design) and audit_log (append-only, retained per
 * privacy policy §5).
 *
 * Safety:
 *   - DRY-RUN BY DEFAULT — reports counts only. Pass --apply to delete.
 *   - Rows created in the last hour are excluded, so an in-flight write
 *     burst can't be misread as orphans (normal writes are transactional,
 *     so this is belt-and-suspenders).
 *   - Idempotent and resumable — safe to re-run; each pass deletes only
 *     what is currently orphaned.
 *
 * Intended operator use (production):
 *   node scripts/repair-orphaned-user-data.mjs            # dry run: report counts
 *   node scripts/repair-orphaned-user-data.mjs --apply    # delete the orphans
 *
 * Connection: uses DATABASE_URL if set, otherwise the PGHOST / PGPORT /
 * PGUSER / PGPASSWORD / PGDATABASE variables (same resolution order as
 * apps/backend/src/db.ts). e.g.:
 *   source .env && node scripts/repair-orphaned-user-data.mjs
 */

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
// Exclude rows newer than this — don't race an in-flight write burst.
const MIN_AGE = "1 hour";

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (url) return postgres(url, { max: 1 });
  return postgres({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5633),
    user: process.env.PGUSER ?? "claimnet",
    password: process.env.PGPASSWORD ?? "claimnet",
    database: process.env.PGDATABASE ?? "claimnet",
    max: 1,
  });
}

const sql = makeClient();

/** Orphaned evidence: no trace_evidence link left. */
const ORPHAN_EVIDENCE = `
  SELECT e.id FROM claimnet.evidence e
  WHERE e.created_at < now() - interval '${MIN_AGE}'
    AND NOT EXISTS (
      SELECT 1 FROM claimnet.trace_evidence te WHERE te.evidence_id = e.id
    )
`;

/** Orphaned references: no trace_references and no evidence_references link.
 *  Evaluated AFTER the evidence pass in apply mode (pruning evidence removes
 *  evidence_references links, which can orphan more references). */
const ORPHAN_REFERENCES = `
  SELECT r.id FROM claimnet.references r
  WHERE r.created_at < now() - interval '${MIN_AGE}'
    AND NOT EXISTS (
      SELECT 1 FROM claimnet.trace_references tr WHERE tr.reference_id = r.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM claimnet.evidence_references er WHERE er.reference_id = r.id
    )
`;

/** Orphaned embedding_sources: the owning entity row is gone. */
const ORPHAN_SOURCES = `
  SELECT es.id FROM claimnet.embedding_sources es
  WHERE es.created_at < now() - interval '${MIN_AGE}'
    AND (
      (es.source_type = 'trace' AND NOT EXISTS (
        SELECT 1 FROM claimnet.traces t WHERE t.id = es.source_id))
      OR (es.source_type = 'evidence' AND NOT EXISTS (
        SELECT 1 FROM claimnet.evidence e WHERE e.id = es.source_id))
      OR (es.source_type = 'reference' AND NOT EXISTS (
        SELECT 1 FROM claimnet.references r WHERE r.id = es.source_id))
    )
`;

/** reference_source_cache rows whose reference is gone (FK should make this
 *  impossible; covered defensively). */
const ORPHAN_REF_CACHE = `
  SELECT rsc.id FROM claimnet.reference_source_cache rsc
  WHERE rsc.created_at < now() - interval '${MIN_AGE}'
    AND NOT EXISTS (
      SELECT 1 FROM claimnet."references" r WHERE r.id = rsc.reference_id
    )
`;

async function count(query) {
  const rows = await sql.unsafe(`SELECT count(*)::int AS n FROM (${query}) q`);
  return rows[0].n;
}

/** Delete the full embedding chain for a set of embedding_source ids. */
async function deleteEmbeddingChains(tx, sourceIdsQuery) {
  const vectors = await tx.unsafe(`
    DELETE FROM claimnet.embedding_vectors WHERE embedding_chunk_id IN (
      SELECT id FROM claimnet.embedding_chunks
      WHERE embedding_source_id IN (${sourceIdsQuery})
    )`);
  const chunks = await tx.unsafe(`
    DELETE FROM claimnet.embedding_chunks
    WHERE embedding_source_id IN (${sourceIdsQuery})`);
  const strategies = await tx.unsafe(`
    DELETE FROM claimnet.embedding_chunk_strategies
    WHERE embedding_source_id IN (${sourceIdsQuery})`);
  const sources = await tx.unsafe(`
    DELETE FROM claimnet.embedding_sources WHERE id IN (${sourceIdsQuery})`);
  return {
    vectors: vectors.count,
    chunks: chunks.count,
    strategies: strategies.count,
    sources: sources.count,
  };
}

async function dryRun() {
  console.log("DRY RUN — no rows will be deleted. Pass --apply to delete.\n");
  const evidence = await count(ORPHAN_EVIDENCE);
  const references = await count(ORPHAN_REFERENCES);
  const sources = await count(ORPHAN_SOURCES);
  const refCache = await count(ORPHAN_REF_CACHE);
  const chunks = await count(`
    SELECT ec.id FROM claimnet.embedding_chunks ec
    WHERE ec.embedding_source_id IN (${ORPHAN_SOURCES})
  `);
  const vectors = await count(`
    SELECT ev.id FROM claimnet.embedding_vectors ev
    WHERE ev.embedding_chunk_id IN (
      SELECT ec.id FROM claimnet.embedding_chunks ec
      WHERE ec.embedding_source_id IN (${ORPHAN_SOURCES})
    )
  `);
  console.log(`Orphaned evidence rows:                ${evidence}`);
  console.log(`Orphaned references rows:              ${references}`);
  console.log(`Orphaned embedding_sources rows:       ${sources}`);
  console.log(`  … their embedding_chunks:            ${chunks}`);
  console.log(`  … their embedding_vectors:           ${vectors}`);
  console.log(`Orphaned reference_source_cache rows:  ${refCache}`);
  console.log(
    "\nNote: deleting orphaned evidence can orphan further references and",
  );
  console.log(
    "embedding rows — apply mode iterates until stable, so apply-mode totals",
  );
  console.log("can exceed these counts.");
}

async function apply() {
  console.log("APPLY MODE — deleting orphans.\n");
  const totals = {
    evidence: 0, references: 0, refCache: 0,
    sources: 0, strategies: 0, chunks: 0, vectors: 0,
  };

  // Iterate to a fixed point: pruning evidence orphans references; pruning
  // evidence/references orphans their embedding_sources.
  for (let pass = 1; ; pass++) {
    const deleted = await sql.begin(async (tx) => {
      let n = 0;

      // 1. Orphaned evidence: embedding chains, then links, then rows.
      const evidenceChains = await deleteEmbeddingChains(
        tx,
        `SELECT es.id FROM claimnet.embedding_sources es
         WHERE es.source_type = 'evidence' AND es.source_id IN (${ORPHAN_EVIDENCE})`,
      );
      await tx.unsafe(`
        DELETE FROM claimnet.evidence_references
        WHERE evidence_id IN (${ORPHAN_EVIDENCE})`);
      const ev = await tx.unsafe(`
        DELETE FROM claimnet.evidence WHERE id IN (${ORPHAN_EVIDENCE})`);

      // 2. Orphaned references (recomputed after the evidence prune):
      //    embedding chains + source cache, then rows.
      const referenceChains = await deleteEmbeddingChains(
        tx,
        `SELECT es.id FROM claimnet.embedding_sources es
         WHERE es.source_type = 'reference' AND es.source_id IN (${ORPHAN_REFERENCES})`,
      );
      const refCacheForRefs = await tx.unsafe(`
        DELETE FROM claimnet.reference_source_cache
        WHERE reference_id IN (${ORPHAN_REFERENCES})`);
      const refs = await tx.unsafe(`
        DELETE FROM claimnet."references" WHERE id IN (${ORPHAN_REFERENCES})`);

      // 3. Embedding chains whose owning entity is gone (covers traces
      //    deleted by the old auth.ts path, whose embedding rows survived).
      const sourceChains = await deleteEmbeddingChains(tx, ORPHAN_SOURCES);

      // 4. Defensive: cache rows whose reference is gone.
      const cache = await tx.unsafe(`
        DELETE FROM claimnet.reference_source_cache
        WHERE id IN (${ORPHAN_REF_CACHE})`);

      totals.evidence += ev.count;
      totals.references += refs.count;
      totals.refCache += refCacheForRefs.count + cache.count;
      for (const c of [evidenceChains, referenceChains, sourceChains]) {
        totals.sources += c.sources;
        totals.strategies += c.strategies;
        totals.chunks += c.chunks;
        totals.vectors += c.vectors;
      }
      n = ev.count + refs.count + cache.count +
        evidenceChains.sources + referenceChains.sources + sourceChains.sources;
      return n;
    });

    console.log(`Pass ${pass}: ${deleted} orphaned row group(s) removed.`);
    if (deleted === 0) break;
  }

  console.log("\nDeleted totals:");
  console.log(`  evidence:                  ${totals.evidence}`);
  console.log(`  references:                ${totals.references}`);
  console.log(`  reference_source_cache:    ${totals.refCache}`);
  console.log(`  embedding_sources:         ${totals.sources}`);
  console.log(`  embedding_chunk_strategies:${totals.strategies}`);
  console.log(`  embedding_chunks:          ${totals.chunks}`);
  console.log(`  embedding_vectors:         ${totals.vectors}`);
}

try {
  if (APPLY) {
    await apply();
  } else {
    await dryRun();
  }
} finally {
  await sql.end();
}
