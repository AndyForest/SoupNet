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

import { PRODUCTION_SEARCH_STRATEGY_IDS, DEFAULT_RANKING } from "@soupnet/domain";
import type { RankingConfig } from "@soupnet/domain";
import { hybridSearch, evidenceSearch } from "./vector-search.service";
import type { EvidenceSearchResult } from "./vector-search.service";
import type { SearchResultItem } from "./trace.service";
import { clusterResults } from "./clustering.service";
import type { ClusterResult } from "./clustering.service";
import { embedQuery, getEmbeddingModelId } from "../lib/embeddings/provider";
import { StageTimer } from "../lib/stage-timer";

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
  /** Keyword narrowing over recipe text (whitespace/comma-separated terms,
   *  ANDed, case-insensitive substring). Applied in SQL by hybridSearch so
   *  counts and pagination stay exact. Only meaningful in query mode. */
  keywordFilter?: string | undefined;
  /** Include raw vectors in response (for visualization). */
  includeVectors?: boolean | undefined;
  /** Two concept terms for TCAV-style axis projection (comma-separated).
   *  Each trace is positioned by cosine similarity to each concept embedding.
   *  Research basis: Kim et al. 2018, "Testing with Concept Activation Vectors" (ICLR). */
  axes?: string | undefined;
  /** Filter vectors by embedding strategy (e.g., 'full_document', 'exp_trace_instructed').
   *  When set, fetchTraceVectors returns only vectors from this strategy.
   *  Used by /traces/map for clustering experiments. */
  vectorStrategy?: string | undefined;
  /** Pre-resolved embedding of `query` in pgvector text format. The recipe
   *  check path passes the trace vector it just cached, so the pipeline makes
   *  zero embedding API calls. When absent, the pipeline embeds the query
   *  once and shares the vector between trace search and evidence search. */
  queryVectorStr?: string | undefined;
  /** Optional per-request stage timer — the check path passes its own so
   *  pipeline stages land in the same Server-Timing header / log line. */
  timer?: StageTimer | undefined;
  /** Ranking pipeline config (@soupnet/domain RankingConfig) — the single
   *  config object every ranking stage reads. Absent ⇒ DEFAULT_RANKING
   *  (byte-stable legacy behavior). Ranking is a pure function of the check's
   *  explicit inputs and the corpus (plan v2 seam 1) — this config carries no
   *  identity state. Stage names, in pipeline order: query_embed → search
   *  (retrieval) → vectors → cluster (k-means to budget) → evidence → axes.
   *  Timer keys match. */
  ranking?: RankingConfig | undefined;
  /** Known-set for stub RENDERING (plan v2 seam 2): recipe ids the caller
   *  already holds (this session's deposits ∪ client-declared known_recipes).
   *  Never touches ranking or membership — a known flat result is flagged for
   *  stub rendering at its true rank, and a known cluster exemplar is
   *  replaced for display by the cluster's next-nearest non-known member
   *  (the "return the ID instead… and the full text of the next recipe in
   *  line" budget backfill), with the known id carried as a stub. */
  knownIds?: ReadonlySet<string> | undefined;
  /** Read-time MRL truncation for fetched trace vectors (clustering, concept
   *  axes, response vectors). Stored vectors are NEVER modified — pgvector's
   *  subvector() slices the leading dims at query time. gemini embeddings are
   *  Matryoshka-trained, so a leading-prefix slice is a valid lower-dim
   *  embedding, and cosine math normalizes internally (no re-normalization
   *  needed). Used by the map + briefing-exemplar surfaces where k-means over
   *  the whole corpus at 3,072 dims dominated latency; see MAP_VECTOR_DIMS. */
  vectorDims?: number | undefined;
}

/**
 * Read-time vector dimensionality for whole-corpus visualization math (map
 * clustering, briefing exemplars). 768 is an MRL-supported truncation point
 * for gemini-embedding-2-preview — 4× less transfer/parse/k-means work than
 * the full 3,072 dims with near-identical 2D-layout quality. Search is
 * unaffected (it runs in SQL on the full stored vectors).
 */
export const MAP_VECTOR_DIMS = 768;

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
 *   Used by /traces/map for clustering experiments (e.g., 'exp_trace_instructed').
 * @param dims — when set, vectors are MRL-truncated to the leading `dims`
 *   dimensions IN SQL (pgvector subvector) — stored vectors are untouched.
 *   Cuts transfer + parse + downstream k-means cost proportionally.
 */
export async function fetchTraceVectors(
  db: PostgresJsDatabase,
  traceIds: string[],
  strategyId?: string,
  dims?: number,
): Promise<Map<string, number[]>> {
  if (traceIds.length === 0) return new Map();

  const strategyFilter = strategyId
    ? sql`AND ecs.strategy_id = ${strategyId}`
    : sql``;

  // Full precision by default; MRL leading-prefix slice when dims is set.
  // (subvector needs the vector type — halfvec rows are cast first.)
  const vectorExpr = dims
    ? sql`subvector(COALESCE(vc.vector, ev.vector::vector(3072)), 1, ${sql.raw(String(Math.trunc(dims)))})`
    : sql`COALESCE(vc.vector, ev.vector)`;

  // ORDER BY on DISTINCT ON is load-bearing: without it, PostgreSQL picks an
  // arbitrary row per source_id, which means (a) nondeterministic responses
  // across calls, and (b) could pick a halfvec row when a full-precision
  // vector_cache row exists for the same trace. The ORDER BY below prefers
  // production search strategies over exp_* (previously alphabetical order
  // made exp_full_headed win — the same 2026-07-01 operator decision that
  // took exp_* out of production search applies to clustering vectors),
  // then vector_cache rows, then strategy_id for stability ('full_document'
  // sorts before 'full_recipe_context', so clustering runs on the trace-text
  // embedding when both are cached).
  const vectorRows = await db.execute(sql`
    SELECT DISTINCT ON (es.source_id) es.source_id::text AS trace_id,
      (${vectorExpr})::text AS vector_str
    FROM claimnet.embedding_sources es
    JOIN claimnet.embedding_chunks ec ON ec.embedding_source_id = es.id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    LEFT JOIN claimnet.vector_cache vc ON vc.content_hash = ec.chunk_hash
      AND vc.task_type = 'SEMANTIC_SIMILARITY'
      AND vc.model_id = ${getEmbeddingModelId()}
    LEFT JOIN claimnet.embedding_vectors ev ON ev.embedding_chunk_id = ec.id
      AND ev.task_type = 'SEMANTIC_SIMILARITY'
      AND ev.status = 'complete'
      AND ev.vector IS NOT NULL
    WHERE es.source_id IN (${sql.join(traceIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND es.source_type = 'trace'
      AND (vc.vector IS NOT NULL OR ev.vector IS NOT NULL)
      ${strategyFilter}
    ORDER BY es.source_id,
      (ecs.strategy_id IN (${sql.join(PRODUCTION_SEARCH_STRATEGY_IDS.map((s) => sql`${s}`), sql`, `)})) DESC,
      (vc.vector IS NOT NULL) DESC,
      ecs.strategy_id
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

  // Judgment date: decided_at (backfilled decisions) falls back to created_at.
  const rows = await db.execute(sql`
    SELECT t.id, t.claim_text AS "claimText", COALESCE(t.decided_at, t.created_at) AS "createdAt"
    FROM claimnet.traces t
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY COALESCE(t.decided_at, t.created_at) DESC
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

  const ranking = params.ranking ?? DEFAULT_RANKING;
  const timer = params.timer ?? new StageTimer();

  // Resolve the query embedding once — trace search and evidence search share
  // it. The check path hands in the vector it just cached (queryVectorStr);
  // other query-mode callers pay one embedQuery here instead of one per search.
  let queryVectorStr = params.queryVectorStr;
  if (params.query && !queryVectorStr) {
    const embedded = await timer.time("query_embed", () =>
      embedQuery(params.query!, "SEMANTIC_SIMILARITY"));
    if (embedded) queryVectorStr = `[${embedded.join(",")}]`;
    // null → leave undefined; hybridSearch/evidenceSearch degrade gracefully.
  }

  let poolItems: SearchResultItem[] | undefined;

  if (params.query) {
    // ── Query mode: semantic vector search ─────────────────────────────────
    const searchResponse = await timer.time("search", () => hybridSearch(db, {
      recipeText: params.query!,
      groupIds,
      limit: perPage,
      offset,
      excludeTraceId: params.excludeTraceId,
      queryVectorStr,
      keywordFilter: params.keywordFilter,
      // P6 pool lever: cluster the top candidates down to the pool boundary
      // instead of the page window. "page" mode ⇒ byte-stable no-op.
      pool: ranking.clusterPool,
    }));

    const toItem = (r: (typeof searchResponse.results)[number]): SearchResultItem => ({
      id: r.id,
      claimText: r.claimText,
      createdAt: r.createdAt,
      rank: r.semanticScore ?? r.combinedScore,
      semanticScore: r.semanticScore ?? undefined,
      signals: r.signals,
    });

    results = searchResponse.results.map(toItem);
    poolItems = searchResponse.pool?.map(toItem);

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
  // clusterInput is what the cluster stage summarizes: the P6 pool when the
  // lever is on, else the page (legacy — byte-stable). Vectors, membership,
  // weights, and exemplars all index into clusterInput.
  let clustered = false;
  let clusterAssignments: ClusterAssignment[] | undefined;
  let vectorMap: Map<string, number[]> | undefined;
  let preClusterResults: SearchResultItem[] | undefined;

  const clusterInput = poolItems && poolItems.length > 1 ? poolItems : results;
  const shouldCluster = !params.expand && (params.k || params.maxChars) && clusterInput.length > 1;
  if (shouldCluster || params.includeVectors || params.axes) {
    // Fetch vectors for the cluster input ∪ page (optionally filtered by
    // strategy for experiments). Pool vectors are MRL-truncated per the
    // lever's vectorDims unless the caller pinned dims explicitly.
    const vecIds = [...new Set([...clusterInput, ...results].map((r) => r.id))];
    const dims = params.vectorDims
      ?? (poolItems && ranking.clusterPool.vectorDims > 0 ? ranking.clusterPool.vectorDims : undefined);
    vectorMap = await timer.time("vectors", () =>
      fetchTraceVectors(db, vecIds, params.vectorStrategy, dims));
  }

  if (shouldCluster && vectorMap && vectorMap.size > 1) {
    // Build vectors array matching clusterInput order
    const vectors: number[][] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < clusterInput.length; i++) {
      const vec = vectorMap.get(clusterInput[i]!.id);
      if (vec) {
        vectors.push(vec);
        validIndices.push(i);
      }
    }

    if (vectors.length > 1) {
      const rawClusters = timer.timeSync("cluster", () => clusterResults({
        vectors,
        k: params.k,
        maxChars: params.maxChars,
        resultTexts: validIndices.map((i) => clusterInput[i]!.claimText),
      }));

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

      // Save pre-clustered input for member ID resolution (used by map
      // endpoint; = the P6 pool when the lever is on).
      preClusterResults = [...clusterInput];

      // Replace results with exemplars (add clusterSize). Known-set budget
      // backfill (seam 2): when the chosen exemplar is already known to the
      // caller, display the cluster's next-nearest non-known member instead
      // and carry the known id as a stub — the display budget is spent on
      // novel content, nothing is hidden (the stub keeps the id fetchable).
      results = clusterAssignments.map((c, ci) => {
        const exemplarInputIdx = validIndices[c.exemplarIndex]!;
        const exemplar = clusterInput[exemplarInputIdx]!;
        if (!params.knownIds?.has(exemplar.id)) {
          return { ...exemplar, clusterSize: c.memberCount };
        }
        const centroid = rawClusters[ci]!.centroid;
        let promoted: SearchResultItem | undefined;
        let bestDist = Infinity;
        for (const mi of c.memberIndices) {
          const member = clusterInput[mi]!;
          if (params.knownIds.has(member.id)) continue;
          const vec = vectorMap!.get(member.id);
          if (!vec) continue;
          const dist = 1 - cosineSimilarity(vec, centroid);
          if (dist < bestDist) {
            bestDist = dist;
            promoted = member;
          }
        }
        if (promoted) {
          return {
            ...promoted,
            clusterSize: c.memberCount,
            promotedOverKnownIds: [exemplar.id],
          };
        }
        // Every member is known — the exemplar renders as a stub.
        return { ...exemplar, clusterSize: c.memberCount, known: true };
      });
      clustered = true;
    }
  }

  // Flat known flagging (seam 2): unclustered known results keep their true
  // rank and are flagged for id-stub rendering. No backfill in flat mode —
  // pagination already reaches everything.
  if (params.knownIds?.size && !clustered) {
    results = results.map((r) =>
      params.knownIds!.has(r.id) ? { ...r, known: true } : r);
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
      if (queryVectorStr) evidenceParams.queryVectorStr = queryVectorStr;
      const evidenceCandidates = await timer.time("evidence", () =>
        evidenceSearch(db, evidenceParams));

      if (evidenceCandidates.length > 0) {
        const targetCount = params.k
          ?? (clustered ? results.length : undefined)
          ?? Math.min(5, evidenceCandidates.length);

        const known = params.knownIds;
        if (known?.size && evidenceCandidates.some((e) => known.has(e.parentTraceId))) {
          // Known-set stubbing for evidence discovery (seam 2): the full
          // selection is drawn from NOVEL parents — evidence budget goes to
          // content the session doesn't hold — and any known-parent entry
          // that would have made the legacy selection is appended as a
          // flagged stub (id kept, text dropped at render). Nothing hidden.
          const legacyPick = selectDiverseEvidence(evidenceCandidates, targetCount);
          const novel = evidenceCandidates.filter((e) => !known.has(e.parentTraceId));
          const picks = selectDiverseEvidence(novel, targetCount);
          const displacedKnown = legacyPick
            .filter((e) => known.has(e.parentTraceId))
            .map((e) => ({ ...e, known: true }));
          relatedEvidence = [...picks, ...displacedKnown];
        } else {
          relatedEvidence = selectDiverseEvidence(evidenceCandidates, targetCount);
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
        vectorMap = await fetchTraceVectors(db, allIds, params.vectorStrategy, params.vectorDims);
      }

      // Concept-axis cosine with truncated trace vectors stays valid: the
      // similarity loop iterates the TRACE vector's length, so the concept
      // embedding is implicitly truncated to the same MRL prefix.

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

// ── Evidence diversity selection ─────────────────────────────────────────────

/**
 * The evidence-discovery diversity pick: up to targetCount entries preferring
 * one per parent recipe, topped up by score order. Byte-identical to the
 * pre-2026-07-17 inline logic (including returning the list as-is when it
 * already fits the target).
 */
function selectDiverseEvidence(
  candidates: EvidenceSearchResult[],
  targetCount: number,
): EvidenceSearchResult[] {
  if (!(candidates.length > targetCount && targetCount > 0)) return candidates;
  const seen = new Set<string>();
  const diverse: EvidenceSearchResult[] = [];
  for (const e of candidates) {
    if (diverse.length >= targetCount) break;
    if (!seen.has(e.parentTraceId)) {
      diverse.push(e);
      seen.add(e.parentTraceId);
    }
  }
  if (diverse.length < targetCount) {
    for (const e of candidates) {
      if (diverse.length >= targetCount) break;
      if (!diverse.includes(e)) diverse.push(e);
    }
  }
  return diverse;
}

// ── Vector math helpers ──────────────────────────────────────────────────────

/** Cosine similarity between two vectors (0 = orthogonal, 1 = identical).
 *  Iterates over `a`'s length, so passing an MRL-truncated trace vector as
 *  `a` implicitly truncates a full-dim query embedding as `b` — valid for
 *  Matryoshka-trained gemini embeddings (same rationale as MAP_VECTOR_DIMS).
 *  Exported for the briefing-exemplars purpose-biasing pass. */
export function cosineSimilarity(a: number[], b: number[]): number {
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
