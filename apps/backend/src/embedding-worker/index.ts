/**
 * Embedding worker — pg-boss consumers running inside the backend process.
 *
 * startEmbeddingWorker(db) boots pg-boss, creates the queues, schedules the
 * 1-minute strategy sweep, and registers all job handlers. Returns a shutdown
 * function that the backend's SIGTERM/SIGINT handlers await before closing.
 *
 * Gated by EMBEDDING_WORKER_ENABLED (default "true"). Set to "false" to run
 * the backend as an HTTP-only process; a separate ECS task with the flag on
 * can then consume the queues in isolation. See ADR-0020.
 *
 * 4-tier embedding pipeline (see ADR-0002):
 *   Tier 1: Strategy Sweep (cron) — discovers work, fans out
 *   Tier 2: Strategy Check — per strategy, ensures texts + stubs exist
 *   Tier 3: Vector Check — per batch, resolves cache hits
 *   Tier 4: Vector API Call — per batch of cache misses, Gemini API
 */

import PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { resolvePgSsl } from "../db";
import { QUEUES } from "./queues";
import type { StrategyCheckJob, VectorCheckJob, VectorApiCallJob, EmbeddingsChunkJob, EmbeddingsVectorJob } from "./queues";

import { handleStrategySweep } from "./jobs/strategy-sweep";
import { handleStrategyCheck } from "./jobs/strategy-check";
import { handleVectorCheck } from "./jobs/vector-check";
import { handleVectorApiCall } from "./jobs/vector-api-call";
import { handleChunkingJob } from "./jobs/chunking";
import { handleVectoringJob } from "./jobs/vectoring";
import { handleEphemeralReap } from "./jobs/ephemeral-reap";

/** Build a pg-boss instance from the same env vars as the backend's db.ts. */
function createBoss(): PgBoss {
  const url = process.env["DATABASE_URL"];
  if (url) return new PgBoss(url);

  const host = process.env["PGHOST"];
  if (host) {
    const database = process.env["PGDATABASE"];
    const user = process.env["PGUSER"];
    const password = process.env["PGPASSWORD"];
    if (!database || !user || !password) {
      throw new Error("PGHOST is set but PGDATABASE, PGUSER, or PGPASSWORD is missing");
    }
    return new PgBoss({
      host,
      port: Number(process.env["PGPORT"] ?? 5432),
      database,
      user,
      password,
      // F48: shared resolver — verifies the RDS cert when PGSSLROOTCERT is
      // set; encrypt-only (with a loud warning) when it isn't.
      ssl: resolvePgSsl(),
    });
  }

  throw new Error(
    "Database connection not configured. Set DATABASE_URL (local/CI) or PGHOST + PGUSER + PGPASSWORD + PGDATABASE (AWS ECS).",
  );
}

/**
 * Start the embedding worker. Returns a shutdown function.
 *
 * If EMBEDDING_WORKER_ENABLED is "false", returns a no-op shutdown — the
 * backend runs HTTP-only.
 */
export async function startEmbeddingWorker(
  db: PostgresJsDatabase,
): Promise<() => Promise<void>> {
  const enabled = (process.env["EMBEDDING_WORKER_ENABLED"] ?? "true").toLowerCase() !== "false";
  if (!enabled) {
    console.warn("[embedding-worker] Disabled via EMBEDDING_WORKER_ENABLED=false");
    return async () => { /* no-op */ };
  }

  const concurrency = parseInt(process.env["WORKER_CONCURRENCY"] ?? "5", 10);

  const boss = createBoss();
  boss.on("error", (err) => {
    console.error("[embedding-worker pg-boss error]", err);
  });

  await boss.start();
  console.warn("[embedding-worker] pg-boss started");

  // Create queues
  await boss.createQueue(QUEUES.STRATEGY_SWEEP);
  await boss.createQueue(QUEUES.STRATEGY_CHECK);
  await boss.createQueue(QUEUES.VECTOR_CHECK);
  await boss.createQueue(QUEUES.VECTOR_API_CALL);
  await boss.createQueue(QUEUES.EMBEDDINGS_CHUNK);
  await boss.createQueue(QUEUES.EMBEDDINGS_VECTOR);
  await boss.createQueue(QUEUES.EPHEMERAL_REAP);

  // Cleanup orphaned schedules from pre-refactor worker.
  try {
    await boss.unschedule("embeddings.sweep");
    const orphanCleanup = await db.execute(sql`
      DELETE FROM pgboss.job
      WHERE name = 'embeddings.sweep'
      RETURNING id
    `);
    const cleanedCount = (orphanCleanup as unknown as Array<{ id: string }>).length;
    if (cleanedCount > 0) {
      console.warn(`[embedding-worker] Cleaned up ${cleanedCount} orphaned 'embeddings.sweep' jobs`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("does not exist")) {
      console.warn(`[embedding-worker] Failed to clean up orphaned schedule (non-fatal): ${message}`);
    }
  }

  // Tier 1: Strategy Sweep (1-minute cron)
  await boss.schedule(QUEUES.STRATEGY_SWEEP, "*/1 * * * *", {});
  await boss.work(
    QUEUES.STRATEGY_SWEEP,
    async () => { await handleStrategySweep(boss, db); },
  );

  // Tier 2: Strategy Check
  await boss.work<StrategyCheckJob>(
    QUEUES.STRATEGY_CHECK,
    { batchSize: concurrency },
    async (jobs) => {
      for (const job of jobs) {
        await handleStrategyCheck(job, boss, db);
      }
    },
  );

  // Tier 3: Vector Check
  await boss.work<VectorCheckJob>(
    QUEUES.VECTOR_CHECK,
    { batchSize: concurrency },
    async (jobs) => {
      for (const job of jobs) {
        await handleVectorCheck(job, boss, db);
      }
    },
  );

  // Tier 4: Vector API Call
  await boss.work<VectorApiCallJob>(
    QUEUES.VECTOR_API_CALL,
    { batchSize: Math.max(1, Math.floor(concurrency / 2)) },
    async (jobs) => {
      for (const job of jobs) {
        await handleVectorApiCall(job, boss, db);
      }
    },
  );

  // Legacy handlers (drain in-flight jobs from the pre-4-tier queue)
  await boss.work<EmbeddingsChunkJob>(
    QUEUES.EMBEDDINGS_CHUNK,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await handleChunkingJob(job, db);
      }
    },
  );

  await boss.work<EmbeddingsVectorJob>(
    QUEUES.EMBEDDINGS_VECTOR,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await handleVectoringJob(job, db);
      }
    },
  );

  // Ephemeral workspace reaper (eval-reset destructive tier) — cron every 5
  // minutes. Always registered; harmless (zero-cost scan) when the feature flag
  // is off. See jobs/ephemeral-reap.ts.
  await boss.schedule(QUEUES.EPHEMERAL_REAP, "*/5 * * * *", {});
  await boss.work(
    QUEUES.EPHEMERAL_REAP,
    async () => { await handleEphemeralReap(db); },
  );

  console.warn("[embedding-worker] All processors registered");

  return async () => {
    console.warn("[embedding-worker] Shutting down pg-boss gracefully...");
    await boss.stop({ graceful: true });
  };
}
