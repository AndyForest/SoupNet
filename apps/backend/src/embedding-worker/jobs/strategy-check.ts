/**
 * Tier 2: Strategy Check — per strategy_id.
 *
 * Ensures all traces have chunk_text built and pending vector stubs created
 * for a specific embedding strategy. Then fans out vector.check jobs.
 *
 * Handles backfill naturally — the sweep discovers missing strategies,
 * this handler creates the texts. No separate backfill script needed.
 *
 * See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture
 */

import crypto from "node:crypto";
import type PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { buildStrategyText } from "@soupnet/domain";
import type { EvidenceEntry } from "@soupnet/domain";
import { getEmbeddingModelId } from "../../lib/embeddings/provider";
import { QUEUES } from "../queues";
import type { VectorCheckItem } from "../queues";

// SEMANTIC_SIMILARITY only — RETRIEVAL_DOCUMENT generation dropped 2026-07-01
// (model ignores task_type; see enqueue.ts KNOWN BUG note for the re-add path).
const TASK_TYPES = ["SEMANTIC_SIMILARITY"] as const;
const MAX_TRACES_PER_JOB = 200;
const VECTOR_BATCH_SIZE = 64;

export async function handleStrategyCheck(
  job: { data: { strategyId: string } },
  boss: PgBoss,
  db: PostgresJsDatabase,
): Promise<void> {
  const { strategyId } = job.data;
  const modelId = getEmbeddingModelId();

  // ── Step 1: Find traces missing chunk_text for this strategy ────────
  const missingTraceRows = await db.execute(sql`
    SELECT t.id AS trace_id, t.claim_text, t.group_id
    FROM claimnet.traces t
    WHERE NOT EXISTS (
      SELECT 1 FROM claimnet.embedding_sources es
      JOIN claimnet.embedding_chunk_strategies ecs ON ecs.embedding_source_id = es.id
      WHERE es.source_id = t.id AND es.source_type = 'trace'
        AND ecs.strategy_id = ${strategyId}
    )
    ORDER BY t.created_at DESC
    LIMIT ${MAX_TRACES_PER_JOB}
  `);

  const missingTraces = missingTraceRows as unknown as Array<{
    trace_id: string; claim_text: string; group_id: string;
  }>;

  if (missingTraces.length > 0) {
    let created = 0;
    for (const trace of missingTraces) {
      const evidenceRows = await db.execute(sql`
        SELECT e.content AS interpretation, r.quote, r.source
        FROM claimnet.trace_evidence te
        JOIN claimnet.evidence e ON e.id = te.evidence_id
        LEFT JOIN claimnet.evidence_references er ON er.evidence_id = e.id
        LEFT JOIN claimnet.references r ON r.id = er.reference_id
        WHERE te.trace_id = ${trace.trace_id}::uuid AND te.stance = 'for'
        ORDER BY e.created_at
      `);

      const entries: EvidenceEntry[] = (evidenceRows as unknown as Array<{
        interpretation: string; quote: string | null; source: string | null;
      }>).map((r) => ({
        interpretation: r.interpretation,
        quote: r.quote ?? undefined,
        source: r.source ?? undefined,
      }));

      const sourceText = buildStrategyText(strategyId, trace.claim_text, entries);
      if (!sourceText) continue;

      const contentHash = crypto.createHash("sha256").update(sourceText).digest("hex");

      // Guarded single-statement insert: the trace may have been deleted
      // between the discovery query above and this point, and
      // embedding_sources.source_id has no FK (polymorphic) to catch it —
      // a plain VALUES insert here would orphan PII-bearing rows that
      // deleteTraceCascade already swept (the CI-exposed sweep/delete race,
      // 2026-07-13). Selecting FROM traces FOR UPDATE makes existence-check
      // and insert atomic, and serializes with the cascade's up-front trace
      // lock: a mid-cascade trace blocks us, then yields zero rows. Reading
      // group_id from the locked row (not the stale discovery read) also
      // lands the backfill in the right book if the trace was re-filed
      // between discovery and insert. Downstream chunk/vector inserts are
      // FK-protected; if the cascade wins between statements they fail
      // loudly and the next sweep cycle skips the vanished trace.
      const sourceRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_sources
          (source_type, source_id, group_id, source_text, artifact_category)
        SELECT 'trace', t.id, t.group_id, ${sourceText}, 'text'
        FROM claimnet.traces t
        WHERE t.id = ${trace.trace_id}::uuid
        FOR UPDATE
        RETURNING id
      `);
      const sourceId = (sourceRows as unknown as Array<{ id: string }>)[0]?.id;
      if (!sourceId) continue;

      const strategyRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_chunk_strategies
          (embedding_source_id, strategy_id, status)
        VALUES (${sourceId}::uuid, ${strategyId}, 'complete')
        RETURNING id
      `);
      const chunkStrategyId = (strategyRows as unknown as Array<{ id: string }>)[0]?.id;
      if (!chunkStrategyId) continue;

      const chunkRows = await db.execute(sql`
        INSERT INTO claimnet.embedding_chunks
          (embedding_source_id, chunk_strategy_id, chunk_text, chunk_hash, chunk_path, metadata)
        VALUES (${sourceId}::uuid, ${chunkStrategyId}::uuid, ${sourceText}, ${contentHash}, 'doc', '{}'::jsonb)
        RETURNING id
      `);
      const chunkId = (chunkRows as unknown as Array<{ id: string }>)[0]?.id;
      if (!chunkId) continue;

      for (const taskType of TASK_TYPES) {
        await db.execute(sql`
          INSERT INTO claimnet.embedding_vectors
            (embedding_chunk_id, model_id, task_type, status, vector)
          VALUES (${chunkId}::uuid, ${modelId}, ${taskType}, 'pending', NULL)
        `);
      }

      created++;
    }

    if (created > 0) {
      console.warn(`[strategy-check] strategy=${strategyId}: created chunks for ${created} traces`);
    }
  }

  // ── Step 2: Find pending vectors for this strategy → fan out vector.check ──
  const pendingRows = await db.execute(sql`
    SELECT ev.id AS vector_id, ec.id AS chunk_id, ec.chunk_text, ec.chunk_hash,
           ev.task_type, ev.model_id
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    WHERE ecs.strategy_id = ${strategyId}
      AND ev.status = 'pending'
    ORDER BY ev.task_type, ev.created_at
    LIMIT ${VECTOR_BATCH_SIZE * 10}
  `);

  const pending = pendingRows as unknown as Array<{
    vector_id: string; chunk_id: string; chunk_text: string; chunk_hash: string;
    task_type: string; model_id: string;
  }>;

  if (pending.length === 0) return;

  for (let i = 0; i < pending.length; i += VECTOR_BATCH_SIZE) {
    const batch = pending.slice(i, i + VECTOR_BATCH_SIZE);
    const items: VectorCheckItem[] = batch.map((r) => ({
      vectorId: r.vector_id,
      chunkId: r.chunk_id,
      chunkText: r.chunk_text,
      chunkHash: r.chunk_hash,
      taskType: r.task_type,
      modelId: r.model_id,
    }));

    await boss.send(QUEUES.VECTOR_CHECK, { items }, {
      singletonKey: `vector-check-${items[0]!.vectorId}`,
      priority: 1,
    });
  }

  const batchCount = Math.ceil(pending.length / VECTOR_BATCH_SIZE);
  console.warn(
    `[strategy-check] strategy=${strategyId}: ${missingTraces.length} traces backfilled, ${pending.length} pending vectors → ${batchCount} vector-check jobs`,
  );
}
