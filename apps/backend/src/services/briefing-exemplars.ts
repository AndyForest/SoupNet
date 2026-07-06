/**
 * Briefing exemplars — pulls clustered sample recipes for the unified
 * briefing's "## Context from <books>" section. Pure read; no side effects.
 *
 * Extracted from RecipeMapPage's client-side composer so every briefing
 * surface (Dashboard, API Keys, Recipe Books, Recipe Map, MCP get_briefing,
 * MCP list_my_recipe_books) gets the same data without each one
 * re-implementing the trace-detail fetch and formatting.
 *
 * The clustering parameters mirror the recipe-map UI controls so the map page
 * can pass through user-tuned values (axes, filter, k, strategy) while other
 * surfaces stay on sensible defaults from user preferences.
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { runSearchPipeline, cosineSimilarity, MAP_VECTOR_DIMS } from "./search-pipeline";
import { embedQuery } from "../lib/embeddings/provider";
import type { BriefingExemplar } from "@soupnet/domain";

export interface ExemplarFetchOptions {
  k: number;
  axes?: string | undefined;
  filter?: string | undefined;
  vectorStrategy?: string | undefined;
  /** Free-text task purpose (WT-3). Biases WITHIN-cluster exemplar choice:
   *  the cluster structure stays corpus-wide (same k-means as without
   *  purpose), but each cluster's exemplar becomes the member most similar
   *  to the purpose embedding instead of the centroid-nearest member —
   *  tailored exemplars, stable map of the corpus. Independent of `filter`
   *  (which narrows the pool via the semantic-query slot). Degrades
   *  gracefully to centroid exemplars when embedding is unavailable. */
  purpose?: string | undefined;
}

export interface ExemplarFetchResult {
  exemplars: BriefingExemplar[];
  /** Mirrors the map context for the briefing builder. */
  mapContext: {
    k: number;
    mode: "umap" | "concept";
    axes?: string | undefined;
    filter?: string | undefined;
    strategy?: string | undefined;
    purpose?: string | undefined;
  };
}

export async function fetchBriefingExemplars(
  db: PostgresJsDatabase,
  groupIds: string[],
  options: ExemplarFetchOptions,
): Promise<ExemplarFetchResult> {
  const mapContext = {
    k: options.k,
    mode: (options.axes ? "concept" : "umap") as "umap" | "concept",
    axes: options.axes,
    filter: options.filter,
    strategy: options.vectorStrategy,
    purpose: options.purpose,
  };

  if (groupIds.length === 0) {
    return { exemplars: [], mapContext };
  }

  // Run the same clustering pipeline the recipe-map UI uses. The map calls
  // /traces/map; we call the underlying function directly to skip the HTTP
  // roundtrip and to keep this composable from the MCP tool handler too.
  // vectorDims: whole-corpus k-means at the MRL-truncated 768 dims (stored
  // vectors untouched) — same read-time optimization as the map route.
  // includeVectors only when a purpose is set: the purpose pass below needs
  // per-member vectors to re-pick exemplars (they're already fetched for
  // clustering; this just keeps them on the result).
  const result = await runSearchPipeline({
    db,
    groupIds,
    query: options.filter,
    k: options.k,
    includeVectors: Boolean(options.purpose),
    axes: options.axes,
    perPage: 10000,
    vectorStrategy: options.vectorStrategy,
    vectorDims: MAP_VECTOR_DIMS,
  });

  const clusters = result.clusters ?? [];
  if (clusters.length === 0) {
    return { exemplars: [], mapContext };
  }

  // Purpose-biased exemplar choice (WT-3): keep the cluster structure exactly
  // as k-means produced it, but within each cluster prefer the member most
  // similar to the purpose embedding over the centroid-nearest exemplar.
  // Falls back per-cluster (and wholesale, when the embedding provider is
  // unavailable) to the default exemplar — the briefing must never fail
  // because of the purpose param.
  let purposeVector: number[] | null = null;
  if (options.purpose && options.purpose.trim().length > 0) {
    try {
      purposeVector = await embedQuery(options.purpose.trim(), "SEMANTIC_SIMILARITY");
    } catch (err) {
      console.error("[briefing-exemplars] purpose embedding failed (non-blocking):", err);
    }
  }

  // Each cluster's exemplar maps to result.results[clusterIdx]. SearchResultItem
  // is typed as having `createdAt: Date` but the raw db.execute path actually
  // returns it as a string (postgres-js, no coercion); handled by
  // formatLoggedDate below.
  const exemplarRows = clusters.map((cluster, clusterIdx) => {
    let exemplar = result.results[clusterIdx];
    if (!exemplar) return null;

    if (purposeVector && result.vectors && result.allResults) {
      let bestScore = -Infinity;
      for (const memberIdx of cluster.memberIndices) {
        const member = result.allResults[memberIdx];
        if (!member) continue;
        const vec = result.vectors.get(member.id);
        if (!vec) continue;
        // Trace vector first: its (possibly MRL-truncated) length bounds the
        // cosine loop, implicitly truncating the full-dim purpose embedding.
        const score = cosineSimilarity(vec, purposeVector);
        if (score > bestScore) {
          bestScore = score;
          exemplar = member;
        }
      }
    }

    return {
      traceId: exemplar.id,
      claimText: exemplar.claimText,
      createdAt: exemplar.createdAt as unknown,
      memberCount: cluster.memberCount,
    };
  }).filter((x): x is { traceId: string; claimText: string; createdAt: unknown; memberCount: number } => x !== null);

  if (exemplarRows.length === 0) {
    return { exemplars: [], mapContext };
  }

  // Batched fetches for everything we need to enrich each exemplar:
  //   - trace meta (author + recipe book slug)
  //   - evidence rows
  //   - reference rows
  //   - evidence ↔ reference link table
  // Single query per concern avoids N+1 fan-out across exemplars.
  const exemplarIds = exemplarRows.map((r) => r.traceId);
  const idList = sql.join(exemplarIds.map((id) => sql`${id}::uuid`), sql`, `);

  const traceMetaRows = await db.execute(sql`
    SELECT
      t.id AS "traceId",
      u.email AS "authorEmail",
      u.display_name AS "authorDisplayName",
      g.slug AS "groupSlug"
    FROM claimnet.traces t
    LEFT JOIN claimnet.users u ON u.id = t.user_id
    LEFT JOIN claimnet.groups g ON g.id = t.group_id
    WHERE t.id IN (${idList})
  `);

  const evidenceRows = await db.execute(sql`
    SELECT
      te.trace_id AS "traceId",
      e.id AS "evidenceId",
      e.content,
      te.created_at AS "createdAt"
    FROM claimnet.evidence e
    JOIN claimnet.trace_evidence te ON te.evidence_id = e.id
    WHERE te.trace_id IN (${idList})
    ORDER BY te.trace_id, te.created_at ASC
  `);

  const referenceRows = await db.execute(sql`
    SELECT
      tr.trace_id AS "traceId",
      r.id AS "referenceId",
      r.quote,
      r.source
    FROM claimnet.references r
    JOIN claimnet.trace_references tr ON tr.reference_id = r.id
    WHERE tr.trace_id IN (${idList})
  `);

  const evidenceRefRows = await db.execute(sql`
    SELECT
      te.trace_id AS "traceId",
      er.evidence_id AS "evidenceId",
      er.reference_id AS "referenceId"
    FROM claimnet.evidence_references er
    JOIN claimnet.trace_evidence te ON te.evidence_id = er.evidence_id
    WHERE te.trace_id IN (${idList})
  `);

  interface TraceMetaRow { traceId: string; authorEmail: string | null; authorDisplayName: string | null; groupSlug: string | null }
  interface EvRow { traceId: string; evidenceId: string; content: string }
  interface RefRow { traceId: string; referenceId: string; quote: string | null; source: string | null }
  interface ErRow { traceId: string; evidenceId: string; referenceId: string }

  const metaByTrace = new Map<string, TraceMetaRow>();
  for (const row of traceMetaRows as unknown as TraceMetaRow[]) {
    metaByTrace.set(row.traceId, row);
  }

  const evidenceByTrace = new Map<string, Array<{ id: string; content: string }>>();
  for (const row of evidenceRows as unknown as EvRow[]) {
    const list = evidenceByTrace.get(row.traceId) ?? [];
    list.push({ id: row.evidenceId, content: row.content });
    evidenceByTrace.set(row.traceId, list);
  }

  const referencesByTrace = new Map<string, Map<string, { quote: string | null; source: string | null }>>();
  for (const row of referenceRows as unknown as RefRow[]) {
    const inner = referencesByTrace.get(row.traceId) ?? new Map();
    inner.set(row.referenceId, { quote: row.quote, source: row.source });
    referencesByTrace.set(row.traceId, inner);
  }

  // evidence_id → set of reference_ids, scoped to the exemplar trace so a
  // referenceless evidence row doesn't accidentally pick up cross-trace links.
  const evRefMap = new Map<string, Map<string, Set<string>>>();
  for (const row of evidenceRefRows as unknown as ErRow[]) {
    const inner = evRefMap.get(row.traceId) ?? new Map<string, Set<string>>();
    const refs = inner.get(row.evidenceId) ?? new Set<string>();
    refs.add(row.referenceId);
    inner.set(row.evidenceId, refs);
    evRefMap.set(row.traceId, inner);
  }

  const exemplars: BriefingExemplar[] = exemplarRows.map((row) => {
    const meta = metaByTrace.get(row.traceId);
    const evList = evidenceByTrace.get(row.traceId) ?? [];
    const refMap = referencesByTrace.get(row.traceId) ?? new Map();
    const erMap = evRefMap.get(row.traceId) ?? new Map<string, Set<string>>();

    const evidenceBlocks: string[] = evList.map((ev) => formatEvidenceBlock(ev.content, erMap.get(ev.id) ?? new Set(), refMap))
      .filter((b) => b.length > 0);

    const exemplar: BriefingExemplar = {
      recipeId: row.traceId,
      recipeBookSlug: meta?.groupSlug ?? "(unknown)",
      loggedDate: formatLoggedDate(row.createdAt),
      memberCount: row.memberCount,
      claimText: row.claimText,
      evidenceBlocks,
    };
    if (meta?.authorEmail) {
      exemplar.author = { email: meta.authorEmail, displayName: meta.authorDisplayName };
    }
    return exemplar;
  });

  return { exemplars, mapContext };
}

/**
 * Normalize a Postgres timestamp value to a YYYY-MM-DD string. Handles both
 * Date instances (some Drizzle paths coerce) and raw ISO strings (raw
 * db.execute(sql`…`) on postgres-js, which is what fetchCorpusTraces uses).
 */
function formatLoggedDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

/**
 * Format a single evidence row plus its linked references into a clean block.
 * Strips the "(no interpretation)" placeholder that some recipe-checker LLMs
 * literally emit when they have a quote but no synthesized commentary —
 * surfacing that placeholder to the consuming agent reads as system noise.
 * References with a source but no quote render as a bare `-- source` line
 * (faithful to the stored data; reflects an LLM author who collapsed
 * description into source).
 */
function formatEvidenceBlock(
  rawInterpretation: string,
  linkedRefIds: Set<string>,
  refMap: Map<string, { quote: string | null; source: string | null }>,
): string {
  const interpretation = stripNoInterpretation(rawInterpretation);
  const refLines: string[] = [];
  for (const refId of linkedRefIds) {
    const ref = refMap.get(refId);
    if (!ref) continue;
    if (ref.quote) refLines.push(`> "${stripOuterQuotes(ref.quote)}"`);
    if (ref.source) refLines.push(`-- ${ref.source}`);
  }

  const parts: string[] = [];
  if (interpretation.length > 0) parts.push(interpretation);
  if (refLines.length > 0) parts.push(refLines.join("\n"));
  return parts.join("\n");
}

/**
 * Defensive: strip a pair of outer matching `"` so legacy stored quotes (from
 * before the parser was updated to do this) don't render as `""quote""` after
 * the renderer wraps with `"..."`. Mirrors the parser's stripOuterQuotes.
 */
function stripOuterQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/** Drop the standalone "(no interpretation)" marker; trim what remains. */
function stripNoInterpretation(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "(no interpretation)") return "";
  // Also strip a leading "(no interpretation)\n" prefix in case the LLM
  // author wrote it before adding real interpretation below.
  return trimmed.replace(/^\(no interpretation\)\s*\n+/i, "").trim();
}
