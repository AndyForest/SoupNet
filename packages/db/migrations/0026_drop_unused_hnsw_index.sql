-- Custom SQL migration file, put your code below! --

-- Drop the unused HNSW index (2026-07-02, follows the 2026-07-01 latency work).
--
-- Evidence: the planner never picks it for the production search query — it
-- top-N seq-scans even with enable_seqscan=off (measured locally at 23k
-- vectors, pgvector 0.8.2) and prod pg_stat shows idx_scan = 81 lifetime.
-- Meanwhile it cost 95 MB of buffer space on a 1 GiB instance (~17% of the
-- working set) plus HNSW graph maintenance on every vector insert.
--
-- Reversal: when the corpus is large enough that the exact scan hurts warm
-- (~10x current scale), recreate alongside the query reshape — see
-- docs/backlog.md §Recipe-check latency:
--   CREATE INDEX embedding_vectors_hnsw_idx
--     ON claimnet.embedding_vectors USING hnsw (vector halfvec_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
-- (~30s build at 2026 scale; use a higher maintenance_work_mem.)

DROP INDEX IF EXISTS "claimnet"."embedding_vectors_hnsw_idx";
