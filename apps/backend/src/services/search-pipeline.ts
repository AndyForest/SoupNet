/**
 * Search pipeline — the core search+cluster+enrich algorithm.
 *
 * Extracted from trace.service.ts to serve multiple consumers:
 *   - Recipe check: runSearchPipeline({ query, dryRun: false }) — stigmergic (search + log)
 *   - Map visualization: runSearchPipeline({ dryRun: true, includeVectors: true }) — read-only
 *   - Future consumers call the same pipeline with the params they need
 *
 * Search is pure semantic (vector cosine similarity on Gemini embeddings).
 * When query is provided: runs vector search. When absent: fetches full corpus.
 *
 * Docs to update when changing this file:
 *   - docs/architecture/search-algorithms.md (Implementation section)
 *   - docs/architecture/search-strategies.md (Output Strategies)
 *
 * See docs/architecture/search-algorithms.md for the full algorithm description.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { hybridSearch, evidenceSearch } from "./vector-search.service";
import type { EvidenceSearchResult } from "./vector-search.service";
import type { SearchResultItem } from "./trace.service";
import { clusterResults } from "./clustering.service";
import type { ClusterResult } from "./clustering.service";
import { embedQuery } from "../lib/embeddings/provider";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchPipelineParams {
  db: PostgresJsDatabase;
  groupIds: string[];
  /** Recipe text query — when provided, runs semantic vector search. When absent, operates on full corpus. */
  query?: string | undefined;
  /** Number of clusters (explicit k). */
  k?: number | undefined;
  /** Character budget for auto-k estimation. */
  maxChars?: number | undefined;
  /** Disable clustering (return all results). */
  expand?: boolean | undefined;
  /** Sort order: "relevance" (default) or "recent". */
  sort?: string | undefined;
  /** Pagination. */
  page?: number | undefined;
  perPage?: number | undefined;
  /** Restrict to these trace IDs (for hierarchical drill-down). */
  traceIds?: string[] | undefined;
  /** Trace ID to exclude from results (typically the just-submitted trace). */
  excludeTraceId?: string | undefined;
  /** Include raw vectors in response (for visualization). */
  includeVectors?: boolean | undefined;
  /** Two concept terms for TCAV-style axis projection (comma-separated).
   *  Each trace is positioned by cosine similarity to each concept embedding.
   *  Research basis: Kim et al. 2018, "Testing with Concept Activation Vectors" (ICLR). */
  axes?: string | undefined;
  /** Filter vectors by embedding strategy (e.g., 'full_document', 'exp_trace_minimal').
   *  When set, fetchTraceVectors returns only vectors from this strategy.
   *  Used by /traces/map for clustering experiments. */
  vectorStrategy?: string | undefined;
}

export interface ClusterAssignment {
  exemplarIndex: number;
  memberCount: number;
  avgSimilarity: number;
  memberIndices: number[];
}

export interface SearchPipelineResult {
  /** Results — exemplars when clustered, full list when not. */
  results: SearchResultItem[];
  /** All results before clustering (for member ID resolution). Only set when clustered. */
  allResults?: SearchResultItem[] | undefined;
  relatedEvidence?: EvidenceSearchResult[] | undefined;
  clusters?: ClusterAssignment[] | undefined;
  totalResults: number;
  searchMode: "semantic" | "corpus";
  clustered: boolean;
  /** Raw vectors keyed by trace ID (only when includeVectors=true). */
  vectors?: Map<string, number[]> | undefined;
  /** Concept-axis positions per trace (only when axes param is set).
   *  Based on TCAV (Kim et al. 2018) — cosine similarity to user-defined concept embeddings. */
  conceptAxes?: {
    axisA: string;
    axisB: string;
    positions: Map<string, { x: number; y: number }>;
  } | undefined;
  page: number;
  totalPages: number;
}

// ── Vector fetching ──────────────────────────────────────────────────────────

/** Parse a Postgres vector string like "[1,2,3]" into a number array. */
export function parseVector(s: string): number[] {
  return s.slice(1, -1).split(",").map(Number);
}

/**
 * Fetch vectors for a set of trace IDs.
 * Tries vector_cache first (full precision), falls back to embedding_vectors (halfvec).
 * Returns one vector per trace (DISTINCT ON source_id).
 *
 * @param strategyId — when set, only returns vectors from this embedding strategy.
 *   Used by /traces/map for clustering experiments (e.g., 'exp_trace_minimal').
 */
export async function fetchTraceVectors(
  db: PostgresJsDatabase,
  traceIds: string[],
  strategyId?: string,
): Promise<Map<string, number[]>> {
  if (traceIds.length === 0) return new Map();

  const strategyFilter = strategyId
    ? sql`AND ecs.strategy_id = ${strategyId}`
    : sql``;

  // ORDER BY on DISTINCT ON is load-bearing: without it, PostgreSQL picks an
  // arbitrary row per source_id, which means (a) nondeterministic responses
  // across calls, and (b) could pick a halfvec row when a full-precision
  // vector_cache row exists for the same trace. The ORDER BY below makes
  // vector_cache rows win the tiebreak, then picks by strategy_id for
  // stability.
  const vectorRows = await db.execute(sql`
    SELECT DISTINCT ON (es.source_id) es.source_id::text AS trace_id,
      COALESCE(vc.vector, ev.vector)::text AS vector_str
    FROM claimnet.embedding_sources es
    JOIN claimnet.embedding_chunks ec ON ec.embedding_source_id = es.id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    LEFT JOIN claimnet.vector_cache vc ON vc.content_hash = ec.chunk_hash
      AND vc.task_type = 'SEMANTIC_SIMILARITY'
      AND vc.model_id = 'gemini-embedding-2-preview'
    LEFT JOIN claimnet.embedding_vectors ev ON ev.embedding_chunk_id = ec.id
      AND ev.task_type = 'SEMANTIC_SIMILARITY'
      AND ev.status = 'complete'
      AND ev.vector IS NOT NULL
    WHERE es.source_id IN (${sql.join(traceIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND es.source_type = 'trace'
      AND (vc.vector IS NOT NULL OR ev.vector IS NOT NULL)
      ${strategyFilter}
    ORDER BY es.source_id, (vc.vector IS NOT NULL) DESC, ecs.strategy_id
  `);

  const result = new Map<string, number[]>();
  for (const row of vectorRows as unknown as Record<string, unknown>[]) {
    result.set(row["trace_id"] as string, parseVector(row["vector_str"] as string));
  }
  return result;
}

// ── Corpus fetch (no query mode) ─────────────────────────────────────────────

interface CorpusTrace {
  id: string;
  claimText: string;
  createdAt: Date;
}

/**
 * Fetch all traces in the supplied groups (everyone's, not just one user's).
 *
 * Used by /traces/map for the no-query "show me everything" path. Scope is
 * group-based, not user-based — any trace in a readable group is in scope
 * regardless of author. Callers MUST validate `groupIds` against the
 * requester's memberships before calling (today done by the /traces/map
 * handler at routes/traces.ts:51-69). The query-mode path uses
 * hybridSearch which already filters by group only, so corpus mode and
 * query mode now have matching scope semantics.
 */
async function fetchCorpusTraces(
  db: PostgresJsDatabase,
  params: {
    groupIds: string[];
    traceIds?: string[] | undefined;
  },
): Promise<CorpusTrace[]> {
  const conditions = [
    sql`t.group_id IN (${sql.join(params.groupIds.map((g) => sql`${g}::uuid`), sql`, `)})`,
  ];

  if (params.traceIds && params.traceIds.length > 0) {
    conditions.push(
      sql`t.id IN (${sql.join(params.traceIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
  }

  const rows = await db.execute(sql`
    SELECT t.id, t.claim_text AS "claimText", t.created_at AS "createdAt"
    FROM claimnet.traces t
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY t.created_at DESC
  `);

  return rows as unknown as CorpusTrace[];
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runSearchPipeline(
  params: SearchPipelineParams,
): Promise<SearchPipelineResult> {
  const { db, groupIds } = params;
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let results: SearchResultItem[];
  let totalResults: number;
  let searchMode: "semantic" | "corpus";

  if (params.query) {
    // ── Query mode: semantic vector search ─────────────────────────────────
    const searchResponse = await hybridSearch(db, {
      recipeText: params.query,
      groupIds,
      limit: perPage,
      offset,
      excludeTraceId: params.excludeTraceId,
    });

    results = searchResponse.results.map((r) => ({
      id: r.id,
      claimText: r.claimText,
      createdAt: r.createdAt,
      rank: r.semanticScore ?? r.combinedScore,
      semanticScore: r.semanticScore ?? undefined,
    }));

    totalResults = searchResponse.totalResults;
    searchMode = searchResponse.searchMode;
  } else {
    // ── Corpus mode: fetch ALL traces in the requested (and pre-validated) groups.
    // Author-agnostic: shared-group traces from other members are in scope, which
    // is what the Recipe Map needs for the cross-collaborator view in
    // design-thinking.md §"Understanding group dynamics".
    const corpusTraces = await fetchCorpusTraces(db, {
      groupIds,
      traceIds: params.traceIds,
    });

    results = corpusTraces.map((t) => ({
      id: t.id,
      claimText: t.claimText,
      createdAt: t.createdAt,
      rank: 0, // no relevance score in corpus mode
    }));

    totalResults = results.length;
    searchMode = "corpus";
  }

  // ── Clustering (optional) ────────────────────────────────────────────────
  let clustered = false;
  let clusterAssignments: ClusterAssignment[] | undefined;
  let vectorMap: Map<string, number[]> | undefined;
  let preClusterResults: SearchResultItem[] | undefined;

  const shouldCluster = !params.expand && (params.k || params.maxChars) && results.length > 1;
  if (shouldCluster || params.includeVectors || params.axes) {
    // Fetch vectors for all results (optionally filtered by strategy for experiments)
    const resultIds = results.map((r) => r.id);
    vectorMap = await fetchTraceVectors(db, resultIds, params.vectorStrategy);
  }

  if (shouldCluster && vectorMap && vectorMap.size > 1) {
    // Build vectors array matching results order
    const vectors: number[][] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < results.length; i++) {
      const vec = vectorMap.get(results[i]!.id);
      if (vec) {
        vectors.push(vec);
        validIndices.push(i);
      }
    }

    if (vectors.length > 1) {
      const rawClusters = clusterResults({
        vectors,
        k: params.k,
        maxChars: params.maxChars,
        resultTexts: validIndices.map((i) => results[i]!.claimText),
      });

      // Build cluster assignments with member tracking
      clusterAssignments = rawClusters.map((c) => ({
        exemplarIndex: c.exemplarIndex,
        memberCount: c.memberCount,
        avgSimilarity: c.avgSimilarity,
        memberIndices: [] as number[], // populated below
      }));

      // Assign each valid result to its nearest cluster
      const assignments = assignToClusters(vectors, rawClusters);
      for (let vi = 0; vi < assignments.length; vi++) {
        const clusterIdx = assignments[vi]!;
        clusterAssignments[clusterIdx]!.memberIndices.push(validIndices[vi]!);
      }

      // Save pre-clustered results for member ID resolution (used by map endpoint)
      preClusterResults = [...results];

      // Replace results with exemplars (add clusterSize)
      results = clusterAssignments.map((c) => ({
        ...results[validIndices[c.exemplarIndex]!]!,
        clusterSize: c.memberCount,
      }));
      clustered = true;
    }
  }

  if (params.sort === "recent") {
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ── Evidence discovery (query mode only) ─────────────────────────────────
  let relatedEvidence: EvidenceSearchResult[] | undefined;
  if (params.query) {
    try {
      const evidenceParams: Parameters<typeof evidenceSearch>[1] = {
        queryText: params.query,
        groupIds,
        limit: 100,
      };
      if (params.excludeTraceId) evidenceParams.excludeTraceId = params.excludeTraceId;
      const evidenceCandidates = await evidenceSearch(db, evidenceParams);

      if (evidenceCandidates.length > 0) {
        const targetCount = params.k
          ?? (clustered ? results.length : undefined)
          ?? Math.min(5, evidenceCandidates.length);

        if (evidenceCandidates.length > targetCount && targetCount > 0) {
          const seen = new Set<string>();
          const diverse: EvidenceSearchResult[] = [];
          for (const e of evidenceCandidates) {
            if (diverse.length >= targetCount) break;
            if (!seen.has(e.parentTraceId)) {
              diverse.push(e);
              seen.add(e.parentTraceId);
            }
          }
          if (diverse.length < targetCount) {
            for (const e of evidenceCandidates) {
              if (diverse.length >= targetCount) break;
              if (!diverse.includes(e)) diverse.push(e);
            }
          }
          relatedEvidence = diverse;
        } else {
          relatedEvidence = evidenceCandidates;
        }
      }
    } catch (err) {
      console.error("[search-pipeline] Evidence search failed (non-blocking):", err);
    }
  }

  // ── Concept axes (semantic projection) ──────────────────────────────────────
  // Research basis: Grand et al. 2022, "Semantic projection recovers rich human
  // knowledge of multiple object features from word embeddings" (Nature Human Behaviour).
  // Embed concept terms, project each trace by cosine similarity to each concept.
  //
  // Only when `axes` is explicitly provided. Filter terms are for narrowing (destructive),
  // axes are for positioning (non-destructive) — different cognitive acts, kept separate.
  let conceptAxes: SearchPipelineResult["conceptAxes"];

  if (params.axes) {
    const axisParts = params.axes.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (axisParts.length >= 2) {
      const [axisALabel, axisBLabel] = [axisParts[0]!, axisParts[1]!];

      // Ensure we have vectors for all results
      if (!vectorMap) {
        const allIds = (preClusterResults ?? results).map((r) => r.id);
        vectorMap = await fetchTraceVectors(db, allIds, params.vectorStrategy);
      }

      // Embed the two concept terms (2 Gemini API calls)
      const [axisAVec, axisBVec] = await Promise.all([
        embedQuery(axisALabel, "SEMANTIC_SIMILARITY"),
        embedQuery(axisBLabel, "SEMANTIC_SIMILARITY"),
      ]);

      if (axisAVec && axisBVec) {
        const positions = new Map<string, { x: number; y: number }>();
        const allTraces = preClusterResults ?? results;

        for (const trace of allTraces) {
          const vec = vectorMap.get(trace.id);
          if (vec) {
            positions.set(trace.id, {
              x: cosineSimilarity(vec, axisAVec),
              y: cosineSimilarity(vec, axisBVec),
            });
          }
        }

        conceptAxes = { axisA: axisALabel, axisB: axisBLabel, positions };
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalResults / perPage));

  return {
    results,
    allResults: preClusterResults,
    relatedEvidence,
    clusters: clusterAssignments,
    totalResults,
    searchMode,
    clustered,
    vectors: params.includeVectors ? vectorMap : undefined,
    conceptAxes,
    page,
    totalPages,
  };
}

// ── Vector math helpers ──────────────────────────────────────────────────────

/** Cosine similarity between two vectors (0 = orthogonal, 1 = identical). */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Cluster assignment helper ────────────────────────────────────────────────

/** Assign each vector to its nearest cluster centroid. Returns array of cluster indices. */
function assignToClusters(vectors: number[][], clusters: ClusterResult[]): number[] {
  return vectors.map((vec) => {
    let bestCluster = 0;
    let bestDist = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const centroid = clusters[c]!.centroid;
      let dot = 0, normA = 0, normB = 0;
      for (let d = 0; d < vec.length; d++) {
        dot += vec[d]! * centroid[d]!;
        normA += vec[d]! * vec[d]!;
        normB += centroid[d]! * centroid[d]!;
      }
      const dist = 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
      if (dist < bestDist) {
        bestDist = dist;
        bestCluster = c;
      }
    }
    return bestCluster;
  });
}
