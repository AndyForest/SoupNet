/**
 * Search going silently empty is the worst way this system can fail: the read id
 * has no vectors, every search returns 200 with nothing, and nothing else notices.
 * This watch makes it loud in the log and visible on /health/version, and it never
 * takes the service down: the load balancer's probe stays on /health/ready.
 *
 * Runs in every process, whether or not it runs the worker. See ADR-0024.
 */

import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  countsFor,
  readCoverage,
  readModelCounts,
  readVectorsState,
  recordTaskHeartbeat,
  type ReadVectorsState,
} from "../../services/embedding-model-status.service";
import { getEmbeddingModelId, getRebuildTargetModelId } from "./provider";

const WATCH_INTERVAL_MS = 60_000;
const LIVE_STATE_MEMO_MS = 5_000;
const TASK_ID = randomUUID();

let live: { state: ReadVectorsState; atMs: number } | null = null;

/**
 * The read id's state now, for /health/version: rows can leave between watch ticks.
 * Held briefly, since any key holder can ask.
 */
export async function getReadVectorsState(db: PostgresJsDatabase): Promise<ReadVectorsState | "unknown"> {
  if (live && Date.now() - live.atMs < LIVE_STATE_MEMO_MS) return live.state;
  try {
    const state = readVectorsState(await readCoverage(db, getEmbeddingModelId()));
    live = { state, atMs: Date.now() };
    return state;
  } catch {
    return "unknown";
  }
}

/** One check. Exported for start-up, where it runs before the port opens. */
export async function checkReadModel(db: PostgresJsDatabase): Promise<void> {
  try {
    const readModelId = getEmbeddingModelId();
    // Before anything that can return: a prune needs to know what this task reads.
    await recordTaskHeartbeat(db, TASK_ID, readModelId, getRebuildTargetModelId());
    const coverage = await readCoverage(db, readModelId);
    const state = readVectorsState(coverage);
    live = { state, atMs: Date.now() };
    if (state === "ok") return;
    const counts = await readModelCounts(db);
    const others = [...counts]
      .filter(([id]) => id !== readModelId)
      .map(([id, c]) => `${id}=${c.complete}`)
      .join(" ");
    const read = `${readModelId}=${countsFor(counts, readModelId).complete}`;
    if (state === "empty") {
      console.error(
        `[embedding-model] READ_MODEL_EMPTY: search returns no results. Complete vectors: ${read} ${others}. ` +
          "Set EMBEDDINGS_MODEL back to the model holding the vectors, or leave it and wait for the worker to fill the gap.",
      );
    } else {
      console.error(
        `[embedding-model] READ_MODEL_PARTIAL: ${coverage.missing} of ${coverage.total} chunks are out of search under ${readModelId}. ` +
          `Refused by the provider, and not counted here: ${coverage.refused}. Complete vectors: ${read} ${others}.`,
      );
    }
  } catch (err) {
    // An unreachable database is /health/ready's job to report.
    console.warn("[embedding-model] Read model check could not run:", err instanceof Error ? err.message : err);
  }
}

export function startReadModelWatch(db: PostgresJsDatabase): void {
  const timer = setInterval(() => void checkReadModel(db), WATCH_INTERVAL_MS);
  timer.unref();
}
