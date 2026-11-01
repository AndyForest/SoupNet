/**
 * Search going silently empty is the worst way this system can fail: the read id
 * has no vectors, every search returns 200 with nothing, and nothing else notices.
 * This watch makes it loud in the log and visible on /health/version, and it never
 * takes the service down: the load balancer's probe stays on /health/ready.
 *
 * Runs in every process, whether or not it runs the worker. See ADR-0024.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  countsFor,
  readModelCounts,
  readVectorsState,
  type ReadVectorsState,
} from "../../services/embedding-model-status.service";
import { getEmbeddingModelId } from "./provider";

const WATCH_INTERVAL_MS = 60_000;

let lastState: ReadVectorsState | "unknown" = "unknown";

/** The read id's state as of the last check; `unknown` before the first one. */
export function getReadVectorsState(): ReadVectorsState | "unknown" {
  return lastState;
}

/** One check. Exported for start-up, where it runs before the port opens. */
export async function checkReadModel(db: PostgresJsDatabase): Promise<void> {
  try {
    const counts = await readModelCounts(db);
    const readModelId = getEmbeddingModelId();
    const state = readVectorsState(counts, readModelId);
    lastState = state;
    if (state === "ok") return;
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
        `[embedding-model] READ_MODEL_PARTIAL: search is missing sources. Complete vectors: ${read} ${others}.`,
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
