/**
 * Tier 1: Strategy Sweep — runs every 1 minute.
 *
 * Discovers which embedding strategies have pending work and fans out
 * one strategy.check job per strategy. Does NO heavy processing.
 *
 * Also performs stale-processing recovery: vectors stuck in 'processing'
 * for >10 minutes get reset to 'pending' (or marked 'failed' if retry_count
 * is exhausted). This handles worker crashes mid-batch.
 *
 * See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture
 * See: docs/architecture/admin-dashboards.md §Retry semantics
 */

import type PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { ALL_STRATEGY_IDS } from "@soupnet/domain";
import { getEmbeddingProviderId } from "../../lib/embeddings/provider";
import { QUEUES } from "../queues";

const STALE_PROCESSING_MINUTES = 10;
const AUTO_RETRY_LIMIT = 3;

export async function handleStrategySweep(
  boss: PgBoss,
  db: PostgresJsDatabase,
): Promise<void> {
  // Only the gemini provider needs an API key to make discovery worthwhile.
  // stub/local/openai-compatible are keyless — gating them on GEMINI_API_KEY
  // (the pre-multi-provider behavior) left pending vectors undrained forever
  // in keyless deployments, which corpus import (2026-07-12) depends on: it
  // enqueues pending stubs / relies on this sweep's backfill for all imported
  // rows. See ADR-0023 for the provider matrix.
  if (getEmbeddingProviderId() === "gemini" && !process.env["GEMINI_API_KEY"]) {
    return; // gemini without a key: discovery would only queue doomed API calls
  }

  // ── Stale processing recovery ──────────────────────────────────────
  const failedRows = await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'failed',
        error = 'Auto-retry limit exceeded after stale processing recovery',
        updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - interval '${sql.raw(String(STALE_PROCESSING_MINUTES))} minutes'
      AND retry_count >= ${AUTO_RETRY_LIMIT}
    RETURNING id
  `);
  const failedCount = (failedRows as unknown as Array<{ id: string }>).length;

  const recoveredRows = await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'pending',
        retry_count = retry_count + 1,
        error = NULL,
        updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - interval '${sql.raw(String(STALE_PROCESSING_MINUTES))} minutes'
      AND retry_count < ${AUTO_RETRY_LIMIT}
    RETURNING id
  `);
  const recoveredCount = (recoveredRows as unknown as Array<{ id: string }>).length;

  if (failedCount > 0 || recoveredCount > 0) {
    console.warn(
      `[strategy-sweep] Stale recovery: ${recoveredCount} vectors reset to pending, ${failedCount} marked failed (retry limit exceeded)`,
    );
  }

  // ── Discovery: find strategies with pending vectors ────────────────
  const pendingRows = await db.execute(sql`
    SELECT DISTINCT ecs.strategy_id
    FROM claimnet.embedding_chunk_strategies ecs
    JOIN claimnet.embedding_chunks ec ON ec.chunk_strategy_id = ecs.id
    JOIN claimnet.embedding_vectors ev ON ev.embedding_chunk_id = ec.id
    WHERE ecs.status = 'complete'
      AND ev.status = 'pending'
  `);

  const pendingStrategies = new Set(
    (pendingRows as unknown as Array<{ strategy_id: string }>).map((r) => r.strategy_id),
  );

  // Find strategies that need chunk_text backfill (traces exist but chunks don't)
  for (const strategyId of ALL_STRATEGY_IDS) {
    if (pendingStrategies.has(strategyId)) continue;

    const missingRows = await db.execute(sql`
      SELECT 1 FROM claimnet.traces t
      WHERE NOT EXISTS (
        SELECT 1 FROM claimnet.embedding_sources es
        JOIN claimnet.embedding_chunk_strategies ecs ON ecs.embedding_source_id = es.id
        WHERE es.source_id = t.id AND es.source_type = 'trace'
          AND ecs.strategy_id = ${strategyId}
      )
      LIMIT 1
    `);

    if ((missingRows as unknown[]).length > 0) {
      pendingStrategies.add(strategyId);
    }
  }

  if (pendingStrategies.size === 0) return;

  for (const strategyId of pendingStrategies) {
    await boss.send(QUEUES.STRATEGY_CHECK, {
      strategyId,
    }, {
      singletonKey: `strategy-check-${strategyId}`,
      priority: 1,
    });
  }

  console.warn(`[strategy-sweep] Enqueued ${pendingStrategies.size} strategy check jobs`);
}
