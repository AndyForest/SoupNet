/**
 * Model rebuild tick, run once a minute by the strategy sweep. pg-boss hands the
 * sweep to one task at a time, so the budget here holds across the fleet.
 *
 * The invariant: every chunk has a vector row under every active model (the read
 * id and any rebuild target). This tick adds the missing rows as `pending`, at no
 * more than EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE, and the existing pipeline embeds
 * them (cache first). Adding rows is the throttle: rows in flight count against the
 * budget, so a stall or a 429 stops new rows being added.
 *
 * The same invariant is the catch-up. A recipe written by a task on the old setting
 * during a rolling deploy has a row only under that task's read id; the next tick
 * adds the other. Flipping back is the same thing in the other direction.
 *
 * See ADR-0024.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  getActiveEmbeddingModelIds,
  getEmbeddingModelId,
  getRebuildTargetModelId,
  getRebuildVectorsPerMinute,
} from "../../lib/embeddings/provider";
import { cooldownRemainingMs } from "../../lib/embeddings/provider-cooldown";
import {
  countsFor,
  readFlipGap,
  readModelCounts,
  readRefusedGap,
} from "../../services/embedding-model-status.service";
import { getSetting } from "../../services/system-settings.service";

/** Add up to `limit` pending rows for chunks that have a row under another model. */
async function addMissingRows(
  db: PostgresJsDatabase,
  modelId: string,
  limit: number,
): Promise<number> {
  try {
    const rows = await db.execute(sql`
      INSERT INTO claimnet.embedding_vectors (embedding_chunk_id, model_id, task_type, status, vector)
      SELECT src.embedding_chunk_id, ${modelId}, src.task_type, 'pending', NULL
      FROM claimnet.embedding_vectors src
      WHERE src.model_id <> ${modelId}
        AND src.task_type = 'SEMANTIC_SIMILARITY'
        AND NOT EXISTS (
          SELECT 1 FROM claimnet.embedding_vectors t
          WHERE t.embedding_chunk_id = src.embedding_chunk_id
            AND t.model_id = ${modelId}
            AND t.task_type = src.task_type
        )
      LIMIT ${limit}
      ON CONFLICT (embedding_chunk_id, model_id, task_type) DO NOTHING
      RETURNING id
    `);
    return (rows as unknown as unknown[]).length;
  } catch (err) {
    // A chunk deleted mid-statement fails its foreign key. Nothing is lost; the
    // next tick tries again without it.
    console.warn(
      `[embedding-rebuild] Adding rows for ${modelId} deferred to the next tick: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

export async function handleModelRebuildTick(db: PostgresJsDatabase): Promise<void> {
  const readModelId = getEmbeddingModelId();
  const targetModelId = getRebuildTargetModelId();
  const counts = await readModelCounts(db);

  // Nothing to reconcile: one model, and it's the read id. The normal state, silent.
  const onlyReadModel = counts.size === 0 || (counts.size === 1 && counts.has(readModelId));
  if (!targetModelId && onlyReadModel) return;

  const perMinute = getRebuildVectorsPerMinute();
  const enabled = await getSetting(db, "embeddingsEnabled").catch(() => true);
  const readCooldown = await cooldownRemainingMs(db, readModelId);

  let added = 0;
  let pausedFor: string | null = null;
  if (!enabled) pausedFor = "embeddings disabled in system settings";
  else if (perMinute === 0) pausedFor = "EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE=0";
  else if (readCooldown > 0) pausedFor = `provider backoff on ${readModelId}, ${Math.ceil(readCooldown / 1000)}s left`;

  if (!pausedFor) {
    let budget = perMinute;
    // Read id first: if it has a gap, search is missing sources right now.
    for (const modelId of getActiveEmbeddingModelIds()) {
      const remaining = await cooldownRemainingMs(db, modelId);
      if (remaining > 0) {
        pausedFor = `provider backoff on ${modelId}, ${Math.ceil(remaining / 1000)}s left`;
        continue;
      }
      const c = countsFor(counts, modelId);
      const room = budget - c.pending - c.processing;
      if (room <= 0) continue;
      const inserted = await addMissingRows(db, modelId, room);
      added += inserted;
      budget -= inserted;
    }
  }

  // The progress line an operator watches. Written so a log filter on
  // "[embedding-rebuild]" tells the whole story, including when it's finished.
  const read = countsFor(counts, readModelId);
  if (targetModelId) {
    const target = countsFor(counts, targetModelId);
    const gap = await readFlipGap(db, readModelId, targetModelId);
    const done = read.complete - gap;
    const percent = read.complete > 0 ? ((done / read.complete) * 100).toFixed(1) : "100.0";
    const left = perMinute > 0 && gap > 0 ? `${Math.ceil(gap / perMinute)}min` : "0min";
    // No wait closes a refused row: the steps are retry-failed, or accept it (ADR-0024).
    const refused = target.failed > 0 ? await readRefusedGap(db, readModelId, targetModelId) : 0;
    console.warn(
      `[embedding-rebuild] read=${readModelId} target=${targetModelId} done=${done}/${read.complete} (${percent}%) ` +
        `gap=${gap} pending=${target.pending} processing=${target.processing} failed=${target.failed} ` +
        `text_fallback=${target.textFallback} added=${added} budget=${perMinute}/min eta=${left} ` +
        `safe_to_flip=${gap === 0 ? "yes" : "no"}${refused > 0 ? ` refused=${refused}` : ""}${pausedFor ? ` paused="${pausedFor}"` : ""}`,
    );
  } else if (added > 0 || read.pending + read.processing > 0 || pausedFor) {
    console.warn(
      `[embedding-rebuild] read=${readModelId} target=none complete=${read.complete} pending=${read.pending} ` +
        `processing=${read.processing} failed=${read.failed} added=${added} budget=${perMinute}/min` +
        `${pausedFor ? ` paused="${pausedFor}"` : ""}`,
    );
  }
}
