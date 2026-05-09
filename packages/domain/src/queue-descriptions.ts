/**
 * Rich text descriptions for each pg-boss queue we register.
 *
 * Used by the admin dashboard to explain what each queue does, what state
 * its jobs go through, and any quirks worth knowing. Edit this when adding
 * or renaming queues.
 *
 * Keep descriptions concise — they appear in the admin UI tooltips and drawers.
 */

export interface QueueDescription {
  /** One-line summary */
  summary: string;
  /** Multi-paragraph explanation in markdown */
  details: string;
  /** Whether this queue is part of the live system or legacy */
  status: "live" | "legacy" | "orphaned";
}

export const QUEUE_DESCRIPTIONS: Record<string, QueueDescription> = {
  "embedding.strategy-sweep": {
    summary: "Top-level coordinator for the embedding pipeline. Runs every 1 minute.",
    status: "live",
    details: `**Tier 1 of the 4-tier embedding pipeline.**

This is a cron-scheduled job that runs every minute. It does no heavy processing — its job is to discover work and fan out per-strategy jobs.

**What it does each run:**
1. Performs stale-processing recovery: vectors stuck in 'processing' for >10 min get reset to 'pending' (with retry_count guard)
2. Finds embedding strategies that have pending vectors
3. Finds embedding strategies that need chunk_text backfill (traces exist but chunks don't)
4. Enqueues one \`embedding.strategy-check\` job per strategy needing work

**Expected job state distribution:** Most jobs should be 'completed'. A small number may be 'active' during a run. Jobs in 'created' state for more than a few seconds indicate the worker isn't running.

See: docs/adr/0002-postgres-pgvector-pg-boss.md §Worker Architecture`,
  },

  "embedding.strategy-check": {
    summary: "Per-strategy worker. Ensures texts and pending vector stubs exist.",
    status: "live",
    details: `**Tier 2 of the 4-tier embedding pipeline.**

For a single strategy_id, this worker:
1. Finds traces missing chunk_text for the strategy → creates embedding_sources, embedding_chunks, and pending embedding_vectors
2. Finds existing pending vectors for the strategy → fans out \`embedding.vector-check\` jobs in batches of ≤64

**Triggered by:** \`embedding.strategy-sweep\` (the cron tier above).

**Bounded:** Processes at most 200 traces per invocation. If more traces remain, the next sweep cycle will enqueue another check.`,
  },

  "embedding.vector-check": {
    summary: "Per-batch worker. Resolves cache hits, forwards misses to API.",
    status: "live",
    details: `**Tier 3 of the 4-tier embedding pipeline.**

For a batch of ≤64 pending vectors:
1. Looks up each vector's chunk_hash in the vector_cache table
2. Cache hit → writes the cached vector immediately, marks status='complete'
3. Cache miss → adds to a list, then enqueues ONE \`embedding.vector-api-call\` job containing only the misses

**Why this tier exists:** Cache lookups are <5ms. Separating them from API calls means API jobs contain ONLY genuine cache misses, maximizing the value of each batched Gemini call. Especially valuable during backfills where many strategies share the same underlying text.`,
  },

  "embedding.vector-api-call": {
    summary: "Calls Gemini batchEmbedContents. Binary-split retry on failures.",
    status: "live",
    details: `**Tier 4 of the 4-tier embedding pipeline.**

For a batch of confirmed cache misses (≤64 vectors):
1. Calls Gemini's \`batchEmbedContents\` endpoint
2. On success: writes vectors + populates vector_cache for future hits
3. On failure: pg-boss retries (retry_limit=2). If still failing after retries, the handler binary-splits the batch in half and re-enqueues — eventually isolating poison pills down to a batch of 1.

**Failure modes you might see:**
- Rate limit (429): Gemini quota exceeded. pg-boss retries usually too fast (seconds), so the JOB fails and the underlying VECTORS stay in 'processing' until the strategy sweep resets them after 10 min. By then the rate limit has cleared.
- Invalid input: a single vector with text Gemini rejects (empty, oversized, etc.). Binary-split isolates it to a batch of 1, then marks just that vector as 'failed'.

**Per-vector retry tracking:** The \`embedding_vectors.retry_count\` column tracks recoveries from stuck-processing state, separate from pg-boss job retries. This catches rate limits and longer outages that pg-boss's fast retries miss.`,
  },

  "embeddings.sweep": {
    summary: "ORPHANED legacy cron from before the 4-tier refactor.",
    status: "orphaned",
    details: `**This queue is orphaned and should be removed.**

This was the original embedding sweep cron from before the 2026-04-07 worker refactor. It was scheduled in pgboss.schedule with a \`*/5 * * * *\` cron, but no worker is registered for it after the refactor.

**Symptom:** Jobs accumulate in \`created\` state at a rate of 12/hour (every 5 minutes from the cron schedule). They sit there until their \`keep_until\` (14 days default) expires.

**The fix is in code:** the worker startup should call \`boss.unschedule('embeddings.sweep')\` to remove the orphan cron. Existing jobs in \`created\` state can be deleted.

**Replaced by:** \`embedding.strategy-sweep\` (the 1-minute cron tier).`,
  },

  "embeddings.chunk": {
    summary: "Legacy queue from pre-refactor pipeline. Kept for in-flight job draining.",
    status: "legacy",
    details: `**Legacy queue from before the 2026-04-07 worker refactor.**

The original pipeline had separate chunking and vectoring workers. The new 4-tier pipeline merged chunking into \`embedding.strategy-check\`.

**Why we still have it:** A legacy handler is registered to drain any in-flight jobs from before the refactor. Once the queue stays empty for the retention window, this handler can be removed.`,
  },

  "embeddings.vector": {
    summary: "Legacy queue from pre-refactor pipeline. Kept for in-flight job draining.",
    status: "legacy",
    details: `**Legacy queue from before the 2026-04-07 worker refactor.**

The original pipeline had a single vectoring worker that batched per-strategy. The new 4-tier pipeline split this into \`embedding.vector-check\` (cache lookup) and \`embedding.vector-api-call\` (Gemini API).

**Why we still have it:** A legacy handler is registered to drain any in-flight jobs from before the refactor. Once the queue stays empty for the retention window, this handler can be removed.`,
  },

  "__pgboss__send-it": {
    summary: "Internal pg-boss queue for cron schedule firing.",
    status: "live",
    details: `**pg-boss internal queue.**

This queue is managed by pg-boss itself, not by our application code. It fires every minute as the engine that triggers cron-scheduled jobs (everything in \`pgboss.schedule\`). Each completed job here represents one "tick" of the scheduling system.

You can ignore this in normal operation. If it's failing, the entire cron system is broken.`,
  },
};

export function getQueueDescription(name: string): QueueDescription | null {
  return QUEUE_DESCRIPTIONS[name] ?? null;
}
