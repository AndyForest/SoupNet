/**
 * Queue names and job data types for pg-boss consumers.
 *
 * Rules:
 * - Every job must be idempotent.
 * - Every job must have a retry policy.
 * - Every job logs a correlation ID.
 * - Every external API call must have a timeout and retry budget.
 * - Every job writes its status back to the DB.
 *
 * See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture
 * See: docs/adr/0020-unified-embedding-service.md (why these now live in backend)
 */

export const QUEUES = {
  // Embedding pipeline — 4-tier hierarchy (see ADR-0002)
  STRATEGY_SWEEP: "embedding.strategy-sweep",      // Tier 1: cron, discovers work, fans out
  STRATEGY_CHECK: "embedding.strategy-check",      // Tier 2: per strategy, ensures texts + stubs exist
  // Jobs on these two carry row ids only; handlers read the text from the database
  // (ADR-0024). New names, so a task on older code can't take a job it can't read.
  VECTOR_CHECK: "embedding.vector-check-ids",       // Tier 3: per batch ≤64, resolves cache hits
  VECTOR_API_CALL: "embedding.vector-api-call-ids", // Tier 4: per batch of cache misses, Gemini API

  // The same handlers drain jobs queued under the old names, which carried text.
  // The text in them is ignored. These can go once none is left.
  VECTOR_CHECK_WITH_TEXT: "embedding.vector-check",
  VECTOR_API_CALL_WITH_TEXT: "embedding.vector-api-call",

  // Legacy (kept for backward compat with in-flight jobs, will be removed)
  EMBEDDINGS_CHUNK: "embeddings.chunk",
  EMBEDDINGS_VECTOR: "embeddings.vector",

  // Knowledge graph
  GRAPH_CLOSURE_REBUILD: "graph.closure.rebuild",

  // Ranking
  RANKING_RECOMPUTE: "ranking.recompute",

  // Ephemeral workspaces — reaper (eval-reset destructive tier). Cron every
  // 5 min; physically deletes expired born-ephemeral books. The only deleter.
  EPHEMERAL_REAP: "ephemeral.reap",

  // Payload fulfillment (indexed + air-gapped modes)
  PAYLOAD_FULFILLMENT: "payload.fulfillment",
  CLIENT_FULFILLMENT_RETRY: "client.fulfillment.retry",

  // Moderation
  MODERATION_SCAN: "moderation.scan",

  // Email
  EMAIL_SEND: "email.send",

  // Neutral summary (deferred feature)
  SUMMARY_REFRESH: "summary.refresh",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ── Job data types ─────────────────────────────────────────────────────────────

// ── New 4-tier embedding pipeline ──────────────────────────────────────────

export interface StrategyCheckJob {
  strategyId: string;
}

/**
 * Row ids only. pg-boss keeps a finished job's payload for about a week, so text put
 * here outlives a deleted recipe, and a job queued before a delete would still send it.
 */
export interface VectorCheckItem {
  vectorId: string;
  taskType: string;
  modelId: string;
}

export interface VectorCheckJob {
  items: VectorCheckItem[];
}

export interface VectorApiCallJob {
  items: VectorCheckItem[];
}

// ── Legacy (backward compat) ──────────────────────────────────────────────

export interface EmbeddingsChunkJob {
  correlationId: string;
  embeddingSourceId: string;
  strategyId: string;
}

export interface EmbeddingsVectorJob {
  correlationId: string;
  embeddingChunkStrategyId?: string;
  batchVectors?: Array<VectorCheckItem & { chunkId: string; chunkText: string; chunkHash: string }>;
}

export interface GraphClosureRebuildJob {
  correlationId: string;
  edgeId: string;
  sourceId: string;
  targetId: string;
}

export interface RankingRecomputeJob {
  correlationId: string;
  claimId: string;
  reason: "new_validation" | "new_edge" | "moderation_change" | "relevancy_update";
}

export interface PayloadFulfillmentJob {
  correlationId: string;
  fulfillmentAttemptId: string;
  nodeId: string;
  claimId: string;
  requesterId: string;
}

export interface ClientFulfillmentRetryJob {
  correlationId: string;
  fulfillmentAttemptId: string;
  attempt: number;
}

export interface ModerationScanJob {
  correlationId: string;
  objectType: "claim" | "validation";
  objectId: string;
}

export interface EmailSendJob {
  correlationId: string;
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

export interface SummaryRefreshJob {
  correlationId: string;
  subjectType: "claim" | "request";
  subjectId: string;
}
