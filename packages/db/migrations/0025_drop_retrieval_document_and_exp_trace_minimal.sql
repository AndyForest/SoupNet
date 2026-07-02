-- Custom SQL migration file, put your code below! --

-- Data cleanup (operator decisions 2026-07-01, see
-- docs/rough-notes/2026-07-01/recipe-check-latency-findings.md):
--
-- 1. RETRIEVAL_DOCUMENT vectors: gemini-embedding-2-preview ignores task_type,
--    so these were byte-identical twins of the SEMANTIC_SIMILARITY vectors —
--    doubling embedding_vectors and vector_cache (buffer-cache pressure behind
--    the cold-start slowdown) for data search never reads. Generation stopped
--    in the same change (enqueue.ts / strategy-check.ts TASK_TYPES).
--
-- 2. exp_trace_minimal pipeline rows: the strategy's text was byte-identical
--    to full_document, so its rows were pure duplicates. The strategy is
--    removed from ALL_STRATEGY_IDS; full_document is the trace-only baseline.
--    Its vector_cache entries are shared with full_document (same content
--    hash) and are kept.
--
-- No ON DELETE CASCADE on these FKs — delete children before parents.

-- 1. RETRIEVAL_DOCUMENT twins
DELETE FROM "claimnet"."embedding_vectors" WHERE "task_type" = 'RETRIEVAL_DOCUMENT';
--> statement-breakpoint
DELETE FROM "claimnet"."vector_cache" WHERE "task_type" = 'RETRIEVAL_DOCUMENT';
--> statement-breakpoint

-- 2. exp_trace_minimal pipeline rows (children → parents)
DELETE FROM "claimnet"."embedding_vectors" ev
USING "claimnet"."embedding_chunks" ec,
      "claimnet"."embedding_chunk_strategies" ecs
WHERE ev."embedding_chunk_id" = ec."id"
  AND ec."chunk_strategy_id" = ecs."id"
  AND ecs."strategy_id" = 'exp_trace_minimal';
--> statement-breakpoint
DELETE FROM "claimnet"."embedding_chunks" ec
USING "claimnet"."embedding_chunk_strategies" ecs
WHERE ec."chunk_strategy_id" = ecs."id"
  AND ecs."strategy_id" = 'exp_trace_minimal';
--> statement-breakpoint
-- Sources are created one-per-strategy by enqueue/strategy-check, so a source
-- whose only strategy row is exp_trace_minimal is dedicated to it. Capture the
-- source ids BEFORE deleting the strategy rows that identify them.
CREATE TEMP TABLE "_exp_trace_minimal_sources" AS
SELECT DISTINCT ecs."embedding_source_id" AS id
FROM "claimnet"."embedding_chunk_strategies" ecs
WHERE ecs."strategy_id" = 'exp_trace_minimal';
--> statement-breakpoint
DELETE FROM "claimnet"."embedding_chunk_strategies" WHERE "strategy_id" = 'exp_trace_minimal';
--> statement-breakpoint
-- Only delete sources that now have no remaining strategy rows (defensive:
-- keeps any source that somehow carries another strategy).
DELETE FROM "claimnet"."embedding_sources" es
WHERE es."id" IN (SELECT id FROM "_exp_trace_minimal_sources")
  AND NOT EXISTS (
    SELECT 1 FROM "claimnet"."embedding_chunk_strategies" ecs
    WHERE ecs."embedding_source_id" = es."id"
  );
--> statement-breakpoint
DROP TABLE "_exp_trace_minimal_sources";
