/**
 * Vector search service — pure semantic search using pgvector HNSW cosine similarity.
 *
 * Leverages the richness of Gemini embedding-2-preview (3072-dim) embeddings
 * rather than layering additional search algorithms on top. The embedding model
 * already captures lexical and semantic similarity in a single vector space.
 *
 * History: previously a hybrid service blending tsvector lexical search with
 * vector search via Reciprocal Rank Fusion (RRF). Simplified to pure vector
 * baseline (2026-04-11) because the hybrid layer added complexity without
 * validated improvement over semantic-only search (Experiment 9 in
 * research-foundations.md was never conducted). The tsvector column remains
 * in the schema but is no longer queried.
 *
 * Docs to update when changing this file:
 *   - docs/architecture/search-algorithms.md (Implementation section)
 *   - docs/architecture/research-foundations.md (§7 Cosine Similarity)
 *   - docs/architecture/search-strategies.md (Strategy 1, Strategy 2)
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { embedQuery } from "../lib/embeddings/provider";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HybridSearchParams {
  /** Recipe text — embedded and used for vector cosine similarity search */
  recipeText: string;
  groupIds: string[];
  limit: number;
  offset: number;
  excludeTraceId?: string | undefined;
}

export interface HybridSearchResult {
  id: string;
  claimText: string;
  createdAt: Date;
  semanticScore: number | null;
  combinedScore: number;
}

export interface HybridSearchResponse {
  results: HybridSearchResult[];
  totalResults: number;
  searchMode: "semantic";
}

// ── Main search function ─────────────────────────────────────────────────────

// HNSW requires a LIMIT to use the index (otherwise falls back to sequential scan).
// ef_search controls how many candidates HNSW examines internally.
// LIMIT should match ef_search — setting LIMIT higher is wasteful since HNSW
// won't find more than ef_search good candidates.
// Increase both together when corpus grows beyond current capacity.
const HNSW_EF_SEARCH = 1000;
const SEARCH_CANDIDATE_LIMIT = HNSW_EF_SEARCH;

export async function hybridSearch(
  db: PostgresJsDatabase,
  params: HybridSearchParams,
): Promise<HybridSearchResponse> {
  const { recipeText, groupIds, limit, offset, excludeTraceId } = params;

  if (groupIds.length === 0) {
    return { results: [], totalResults: 0, searchMode: "semantic" };
  }

  const groupIdsSql = sql.join(
    groupIds.map((g) => sql`${g}::uuid`),
    sql`, `,
  );

  // ── Semantic search (pure vector cosine similarity) ─────────────────────

  const queryVector = await embedQuery(recipeText, "SEMANTIC_SIMILARITY");

  if (!queryVector) {
    return { results: [], totalResults: 0, searchMode: "semantic" };
  }

  const vectorStr = `[${queryVector.join(",")}]`;

  try {
    // Set HNSW search parameter for this transaction
    // SET doesn't accept parameterized values — use raw SQL
    await db.execute(sql.raw(`SET hnsw.ef_search = ${HNSW_EF_SEARCH}`));

    // Search all trace embedding strategies (full_document, full_recipe_context, etc.)
    // HNSW requires ORDER BY + LIMIT to use the index. Deduplication by trace ID
    // happens in application code since DISTINCT ON defeats the index.
    const semanticRows = await db.execute(sql`
      SELECT es.source_id AS trace_id,
             1 - (ev.vector <=> ${vectorStr}::halfvec(3072)) AS semantic_score
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
      WHERE ev.status = 'complete'
        AND ev.vector IS NOT NULL
        AND ev.task_type = 'SEMANTIC_SIMILARITY'
        AND es.source_type = 'trace'
        AND es.group_id IN (${groupIdsSql})
        ${excludeTraceId ? sql`AND es.source_id != ${excludeTraceId}::uuid` : sql``}
      ORDER BY ev.vector <=> ${vectorStr}::halfvec(3072)
      LIMIT ${SEARCH_CANDIDATE_LIMIT}
    `);

    // Deduplicate by trace ID — same trace may appear from multiple strategies.
    // Keep the best score per trace.
    const semanticMap = new Map<string, number>();
    for (const row of semanticRows as unknown as Record<string, unknown>[]) {
      const traceId = row["trace_id"] as string;
      const score = Number(row["semantic_score"]);
      const existing = semanticMap.get(traceId);
      if (existing === undefined || score > existing) {
        semanticMap.set(traceId, score);
      }
    }

    // Sort by score descending
    const sorted = [...semanticMap.entries()]
      .sort((a, b) => b[1] - a[1]);

    const totalResults = sorted.length;

    // Apply pagination
    const paged = sorted.slice(offset, offset + limit);

    // ── Load trace data ─────────────────────────────────────────────────
    const traceIds = paged.map(([id]) => id);

    if (traceIds.length === 0) {
      return { results: [], totalResults: 0, searchMode: "semantic" };
    }

    const traceIdsSql = sql.join(
      traceIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    const traceRows = await db.execute(sql`
      SELECT id, claim_text, created_at
      FROM claimnet.traces
      WHERE id IN (${traceIdsSql})
    `);

    const traceMap = new Map<
      string,
      { claimText: string; createdAt: Date }
    >();
    for (const row of traceRows as unknown as Record<string, unknown>[]) {
      traceMap.set(row["id"] as string, {
        claimText: row["claim_text"] as string,
        createdAt: new Date(row["created_at"] as string),
      });
    }

    // ── Build response ────────────────────────────────────────────────────

    const results: HybridSearchResult[] = paged.map(([traceId, score]) => {
      const trace = traceMap.get(traceId);
      return {
        id: traceId,
        claimText: trace?.claimText ?? "",
        createdAt: trace?.createdAt ?? new Date(),
        semanticScore: score,
        combinedScore: score,
      };
    });

    return { results, totalResults, searchMode: "semantic" };
  } catch (err) {
    console.error("[vector-search] Semantic search failed:", err);
    return { results: [], totalResults: 0, searchMode: "semantic" };
  }
}

// ── Evidence search ─────────────────────────────────────────────────────────

/**
 * Search evidence embeddings to find topically related evidence from other recipes.
 *
 * Uses the same semantic search as hybridSearch but queries source_type='evidence'
 * instead of 'trace'. Returns evidence IDs with their parent trace context.
 *
 * Research basis: evidence embeddings are enriched with parent trace context per
 * Anthropic's Contextual Retrieval pattern (35-67% improvement in retrieval quality).
 * The system finds topically similar evidence — stance interpretation is left to
 * the AI agent consumer (see docs/architecture/embedding-test-results.md, negation problem).
 *
 * @see https://www.anthropic.com/news/contextual-retrieval
 */

export interface EvidenceSearchResult {
  evidenceId: string;
  parentTraceId: string;
  parentTraceText: string;
  evidenceContent: string;
  semanticScore: number;
}

export async function evidenceSearch(
  db: PostgresJsDatabase,
  params: {
    queryText: string;
    groupIds: string[];
    limit?: number;
    excludeTraceId?: string;
  },
): Promise<EvidenceSearchResult[]> {
  const limit = params.limit ?? 50;

  // Embed the query text
  const queryVector = await embedQuery(params.queryText, "SEMANTIC_SIMILARITY");
  if (!queryVector) return []; // graceful fallback

  const vectorStr = `[${queryVector.join(",")}]`;

  const groupIdsSql = sql.join(
    params.groupIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // Search evidence embeddings — joins back to evidence and parent trace
  const rows = await db.execute(sql`
    SELECT
      es.source_id AS evidence_id,
      te.trace_id AS parent_trace_id,
      t.claim_text AS parent_trace_text,
      e.content AS evidence_content,
      1 - (ev.vector <=> ${vectorStr}::halfvec(3072)) AS semantic_score
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
    JOIN claimnet.evidence e ON e.id = es.source_id
    JOIN claimnet.trace_evidence te ON te.evidence_id = e.id
    JOIN claimnet.traces t ON t.id = te.trace_id
    WHERE ev.status = 'complete'
      AND ev.vector IS NOT NULL
      AND ev.task_type = 'SEMANTIC_SIMILARITY'
      AND es.source_type = 'evidence'
      AND es.group_id IN (${groupIdsSql})
      ${params.excludeTraceId ? sql`AND te.trace_id != ${params.excludeTraceId}::uuid` : sql``}
    ORDER BY ev.vector <=> ${vectorStr}::halfvec(3072)
    LIMIT ${limit}
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    evidenceId: row["evidence_id"] as string,
    parentTraceId: row["parent_trace_id"] as string,
    parentTraceText: row["parent_trace_text"] as string,
    evidenceContent: row["evidence_content"] as string,
    semanticScore: Number(row["semantic_score"]),
  }));
}
