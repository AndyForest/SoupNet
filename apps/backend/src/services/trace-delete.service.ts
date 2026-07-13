import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface TraceDeleteOptions {
  db: PostgresJsDatabase;
  traceId: string;
  actorUserId: string;
  reason?: string | undefined;
}

export interface TraceDeleteResult {
  ok: true;
  traceId: string;
  evidenceDeleted: number;
  referencesDeleted: number;
}

/**
 * Hard-delete a trace and prune any evidence/references it was the last link
 * to. The vector_cache table is preserved — it's content-hash keyed, has no
 * back-reference to source data, and survives deletion (see vector-cache.ts).
 *
 * Per-trace embedding rows in the four-table pipeline (sources → strategies
 * → chunks → vectors) ARE removed, since they reference source_id and would
 * otherwise leave dangling vectors that point at a deleted trace.
 *
 * The audit_log entry is written by the caller (route handler) so the actor's
 * perspective and the reason field stay co-located with the request.
 */
export async function deleteTraceCascade(
  opts: TraceDeleteOptions,
): Promise<TraceDeleteResult> {
  const { db, traceId } = opts;

  return db.transaction(async (tx) => {
    const evidenceIdRows = await tx.execute(sql`
      SELECT evidence_id AS "id" FROM claimnet.trace_evidence
      WHERE trace_id = ${traceId}::uuid
    `);
    const evidenceIds = (evidenceIdRows as unknown as Array<{ id: string }>).map((r) => r.id);

    const referenceIdRows = await tx.execute(sql`
      SELECT reference_id AS "id" FROM claimnet.trace_references
      WHERE trace_id = ${traceId}::uuid
    `);
    const referenceIds = (referenceIdRows as unknown as Array<{ id: string }>).map((r) => r.id);

    await deleteEmbeddingChainForSource(tx, "trace", traceId);

    await tx.execute(sql`
      DELETE FROM claimnet.trace_evidence WHERE trace_id = ${traceId}::uuid
    `);
    await tx.execute(sql`
      DELETE FROM claimnet.trace_references WHERE trace_id = ${traceId}::uuid
    `);

    let evidenceDeleted = 0;
    for (const evidenceId of evidenceIds) {
      const stillLinked = await tx.execute(sql`
        SELECT 1 FROM claimnet.trace_evidence WHERE evidence_id = ${evidenceId}::uuid LIMIT 1
      `);
      if ((stillLinked as unknown as unknown[]).length > 0) continue;

      await tx.execute(sql`
        DELETE FROM claimnet.evidence_references WHERE evidence_id = ${evidenceId}::uuid
      `);
      await deleteEmbeddingChainForSource(tx, "evidence", evidenceId);
      await tx.execute(sql`
        DELETE FROM claimnet.evidence WHERE id = ${evidenceId}::uuid
      `);
      evidenceDeleted++;
    }

    let referencesDeleted = 0;
    for (const referenceId of referenceIds) {
      const stillLinkedTrace = await tx.execute(sql`
        SELECT 1 FROM claimnet.trace_references WHERE reference_id = ${referenceId}::uuid LIMIT 1
      `);
      if ((stillLinkedTrace as unknown as unknown[]).length > 0) continue;

      const stillLinkedEvidence = await tx.execute(sql`
        SELECT 1 FROM claimnet.evidence_references WHERE reference_id = ${referenceId}::uuid LIMIT 1
      `);
      if ((stillLinkedEvidence as unknown as unknown[]).length > 0) continue;

      await deleteEmbeddingChainForSource(tx, "reference", referenceId);
      // Cached fetched content for the reference's URL holds third-party
      // page text keyed to this reference; its FK (NO ACTION) would block
      // the reference delete, and the cached content must not outlive the
      // reference it was fetched for.
      await tx.execute(sql`
        DELETE FROM claimnet.reference_source_cache WHERE reference_id = ${referenceId}::uuid
      `);
      await tx.execute(sql`
        DELETE FROM claimnet.references WHERE id = ${referenceId}::uuid
      `);
      referencesDeleted++;
    }

    await tx.execute(sql`
      DELETE FROM claimnet.traces WHERE id = ${traceId}::uuid
    `);

    return { ok: true, traceId, evidenceDeleted, referencesDeleted };
  });
}

async function deleteEmbeddingChainForSource(
  tx: PostgresJsDatabase,
  sourceType: "trace" | "evidence" | "reference",
  sourceId: string,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM claimnet.embedding_vectors
    WHERE embedding_chunk_id IN (
      SELECT ec.id FROM claimnet.embedding_chunks ec
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
      WHERE es.source_type = ${sourceType} AND es.source_id = ${sourceId}::uuid
    )
  `);
  await tx.execute(sql`
    DELETE FROM claimnet.embedding_chunks
    WHERE embedding_source_id IN (
      SELECT id FROM claimnet.embedding_sources
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
    )
  `);
  await tx.execute(sql`
    DELETE FROM claimnet.embedding_chunk_strategies
    WHERE embedding_source_id IN (
      SELECT id FROM claimnet.embedding_sources
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
    )
  `);
  await tx.execute(sql`
    DELETE FROM claimnet.embedding_sources
    WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
  `);
}
