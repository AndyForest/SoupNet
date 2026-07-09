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
import { PRODUCTION_SEARCH_STRATEGY_IDS } from "@soupnet/domain";
import { embedQuery, getEmbeddingModelId } from "../lib/embeddings/provider";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HybridSearchParams {
  /** Recipe text — embedded and used for vector cosine similarity search */
  recipeText: string;
  groupIds: string[];
  limit: number;
  offset: number;
  excludeTraceId?: string | undefined;
  /** Pre-resolved query vector in pgvector text format ("[0.1,0.2,...]").
   *  When provided, no embedding API call is made — the caller already has
   *  the vector (e.g. the sync write path just cached the identical text).
   *  See docs/rough-notes/2026-07-01/recipe-check-latency-findings.md. */
  queryVectorStr?: string | undefined;
  /** Keyword narrowing (the /check `filter` param when it accompanies a
   *  recipe): whitespace/comma-separated terms, ANDed as case-insensitive
   *  substring matches on the recipe text. Applied inside the SQL predicates
   *  so the exact count, ANN top-k, and exhaustive fallback all agree. */
  keywordFilter?: string | undefined;
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

// ANN-first search (2026-07-02, operator direction "optimize the query so the
// index IS used"). Three cooperating pieces, each with a distinct job:
//
//   1. totalResults — an exact COUNT(DISTINCT trace) with no distance work
//      (~5ms). Keeps the recall un-cap's honesty (operator decision
//      2026-07-01: no silent candidate cap) without ranking everything.
//   2. Results — an HNSW-streamed top-k query. At display-relevant limits
//      (k ≤ ~400) the planner picks the HNSW index unforced through the full
//      join shape when `hnsw.iterative_scan = relaxed_order` is set (measured
//      2026-07-01: 8-18ms at k=40-100 vs 50-65ms exhaustive warm — and cold
//      it touches ~k vectors' pages instead of the whole table, which removes
//      the after-idle latency cliff). k is sized with a dedupe margin: each
//      trace contributes up to 2 production-strategy rows.
//   3. Fallback — if top-k under-fills the requested page after dedup (narrow
//      group scope, deep pagination, or ANN approximation), rerun exhaustively
//      with no LIMIT: exact, guaranteed-complete, the pre-reshape behavior.
//
// relaxed_order returns rows in approximate distance order; the app-side
// best-score-per-trace dedupe + sort makes final ordering exact over the
// candidate set.

const ANN_CANDIDATE_MIN = 60;
// Above ~400 the planner flips back to the exhaustive plan anyway (measured),
// so past this we just run the exact scan directly.
const ANN_CANDIDATE_MAX = 400;
// Each trace has ≤2 production-strategy rows; ×3 leaves slack for uneven
// score interleaving across traces.
const ANN_DEDUPE_MARGIN = 3;

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
  // Reuse the caller's pre-resolved vector when available; otherwise embed.

  let vectorStr: string;
  if (params.queryVectorStr) {
    vectorStr = params.queryVectorStr;
  } else {
    const queryVector = await embedQuery(recipeText, "SEMANTIC_SIMILARITY");
    if (!queryVector) {
      return { results: [], totalResults: 0, searchMode: "semantic" };
    }
    vectorStr = `[${queryVector.join(",")}]`;
  }

  try {
    // Shared predicates: PRODUCTION trace embedding strategies only
    // (full_document, full_recipe_context) — experimental exp_* strategies
    // don't compete (operator decision 2026-07-01; see
    // PRODUCTION_SEARCH_STRATEGY_IDS in @soupnet/domain).
    const strategyIdsSql = sql.join(
      PRODUCTION_SEARCH_STRATEGY_IDS.map((s) => sql`${s}`),
      sql`, `,
    );
    // Keyword narrowing terms (filter param alongside a recipe): each term
    // must appear in the recipe text (case-insensitive). Terms are capped to
    // keep the predicate bounded; ILIKE wildcards in user terms are escaped.
    const keywordTerms = (params.keywordFilter ?? "")
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    const escapeLike = (t: string) => t.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const keywordPredicate = keywordTerms.length > 0
      ? sql.join(
        keywordTerms.map((t) => sql`AND tr.claim_text ILIKE ${"%" + escapeLike(t) + "%"}`),
        sql` `,
      )
      : sql``;

    const searchPredicates = sql`
        ev.status = 'complete'
        AND ev.vector IS NOT NULL
        AND ev.task_type = 'SEMANTIC_SIMILARITY'
        AND ev.model_id = ${getEmbeddingModelId()}
        AND ecs.strategy_id IN (${strategyIdsSql})
        AND es.source_type = 'trace'
        AND es.group_id IN (${groupIdsSql})
        ${excludeTraceId ? sql`AND es.source_id != ${excludeTraceId}::uuid` : sql``}
        ${keywordPredicate}`;
    const searchJoins = sql`
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
      ${keywordTerms.length > 0 ? sql`JOIN claimnet.traces tr ON tr.id = es.source_id` : sql``}`;

    // ── 1. Exact result count (no distance computations) ─────────────────
    const countRows = await db.execute(sql`
      SELECT count(DISTINCT es.source_id)::int AS n
      ${searchJoins}
      WHERE ${searchPredicates}
    `);
    const totalResults = Number(
      (countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0,
    );
    if (totalResults === 0) {
      return { results: [], totalResults: 0, searchMode: "semantic" };
    }

    // Deduplicate by trace ID — same trace may appear from multiple
    // strategies. Keep the best score per trace, then sort exactly.
    const dedupeAndSort = (rows: unknown): Array<[string, number]> => {
      const map = new Map<string, number>();
      for (const row of rows as Record<string, unknown>[]) {
        const traceId = row["trace_id"] as string;
        const score = Number(row["semantic_score"]);
        const existing = map.get(traceId);
        if (existing === undefined || score > existing) {
          map.set(traceId, score);
        }
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };

    const runExhaustive = async () =>
      dedupeAndSort(await db.execute(sql`
        SELECT es.source_id AS trace_id,
               1 - (ev.vector <=> ${vectorStr}::halfvec(3072)) AS semantic_score
        ${searchJoins}
        WHERE ${searchPredicates}
        ORDER BY ev.vector <=> ${vectorStr}::halfvec(3072)
      `));

    // ── 2. ANN-streamed top-k (HNSW via iterative scan) ───────────────────
    const k = Math.max(ANN_CANDIDATE_MIN, (offset + limit) * ANN_DEDUPE_MARGIN);
    let sorted: Array<[string, number]>;
    if (k > ANN_CANDIDATE_MAX) {
      // Deep pagination — the planner would pick the exhaustive plan at this
      // k anyway; run it directly (exact).
      sorted = await runExhaustive();
    } else {
      try {
        sorted = dedupeAndSort(await db.transaction(async (tx) => {
          // SET LOCAL scopes both settings to this transaction (pgvector ≥0.8
          // for iterative_scan; ef_search must be ≥ k so the index can yield
          // enough candidates before iteration kicks in). Floor of 200 tuned
          // on the real 1,316-trace corpus 2026-07-02: recall@20 mean 99.0%,
          // min 85%, top-3 exemplar agreement 28/30 vs exact — residual
          // disagreements are near-tie score inversions.
          await tx.execute(sql.raw(`SET LOCAL hnsw.iterative_scan = relaxed_order`));
          await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${Math.max(200, k)}`));
          return await tx.execute(sql`
            SELECT es.source_id AS trace_id,
                   1 - (ev.vector <=> ${vectorStr}::halfvec(3072)) AS semantic_score
            ${searchJoins}
            WHERE ${searchPredicates}
            ORDER BY ev.vector <=> ${vectorStr}::halfvec(3072)
            LIMIT ${k}
          `);
        }));
      } catch (annErr) {
        // e.g. pgvector <0.8 without iterative_scan — degrade to exact scan.
        console.error("[vector-search] ANN path failed, falling back to exhaustive:", annErr);
        sorted = await runExhaustive();
      }

      // ── 3. Under-fill fallback (guaranteed no recall regression) ────────
      // If the deduped top-k can't fill the requested page even though more
      // matches exist (narrow scope post-filtering, or ANN approximation),
      // rerun exhaustively — the exact pre-reshape behavior.
      const needed = Math.min(totalResults, offset + limit);
      if (sorted.length < needed) {
        sorted = await runExhaustive();
      }
    }

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

    // created_at is coalesced with decided_at so the date agents see is the
    // judgment date — backfilled recipes (decision archaeology) read as old
    // judgments, not fresh context. Raw created_at stays on the trace row.
    const traceRows = await db.execute(sql`
      SELECT id, claim_text, COALESCE(decided_at, created_at) AS created_at
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
    /** Pre-resolved query vector (pgvector text format) — skips the embedding
     *  API call. The search pipeline resolves the query text once and shares
     *  the vector between trace search and evidence search. */
    queryVectorStr?: string;
  },
): Promise<EvidenceSearchResult[]> {
  const limit = params.limit ?? 50;

  // Reuse the caller's pre-resolved vector when available; otherwise embed.
  let vectorStr: string;
  if (params.queryVectorStr) {
    vectorStr = params.queryVectorStr;
  } else {
    const queryVector = await embedQuery(params.queryText, "SEMANTIC_SIMILARITY");
    if (!queryVector) return []; // graceful fallback
    vectorStr = `[${queryVector.join(",")}]`;
  }

  const groupIdsSql = sql.join(
    params.groupIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // Search evidence embeddings — joins back to evidence and parent trace.
  // Same ANN posture as hybridSearch: at LIMIT ~100 the planner streams from
  // the HNSW index when iterative scan is on (post-join filters can't starve
  // it), and falls back to the exact plan on its own when that's cheaper.
  const runQuery = (tx: Pick<PostgresJsDatabase, "execute">) => tx.execute(sql`
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
      AND ev.model_id = ${getEmbeddingModelId()}
      AND es.source_type = 'evidence'
      AND es.group_id IN (${groupIdsSql})
      ${params.excludeTraceId ? sql`AND te.trace_id != ${params.excludeTraceId}::uuid` : sql``}
    ORDER BY ev.vector <=> ${vectorStr}::halfvec(3072)
    LIMIT ${limit}
  `);

  let rows: unknown;
  try {
    rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL hnsw.iterative_scan = relaxed_order`));
      await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${Math.max(200, limit)}`));
      return await runQuery(tx);
    });
  } catch (annErr) {
    console.error("[vector-search] Evidence ANN path failed, falling back:", annErr);
    rows = await runQuery(db);
  }

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    evidenceId: row["evidence_id"] as string,
    parentTraceId: row["parent_trace_id"] as string,
    parentTraceText: row["parent_trace_text"] as string,
    evidenceContent: row["evidence_content"] as string,
    semanticScore: Number(row["semantic_score"]),
  }));
}
