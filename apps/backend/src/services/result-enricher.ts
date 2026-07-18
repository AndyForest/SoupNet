/**
 * Result enricher — loads evidence and references for search results.
 *
 * Given a list of trace IDs from search, batch-loads all associated
 * evidence and their references, then attaches them to the result objects.
 *
 * Stance is intentionally not surfaced in the enriched shape: per ADR-0015,
 * the negation problem means embeddings cannot reliably distinguish
 * supporting from contradicting evidence, so the system does not assert
 * stance at search time. The trace_evidence.stance column persists for
 * legacy 'against' rows but new entries are always 'for'; consumers should
 * treat all returned evidence as "evidence the LLM author asserted at
 * write time" and re-evaluate stance against current context.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SearchResultItem } from "./trace.service";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Region-of-interest metadata. Mirrors the shape stored in `references.region_meta`
 * and surfaced verbatim to clients so viewers can see what region of the source
 * artifact the agent meant to flag. Image box coords are normalized 0–1, top-left
 * origin (matches MCP tool input + ADR-0019 storage shape).
 */
export interface EnrichedRegionMeta {
  image_box?: { x0: number; y0: number; x1: number; y1: number } | undefined;
}

export interface EnrichedReference {
  quote: string;
  source: string;
  fileUrl?: string | undefined;
  fileMimeType?: string | undefined;
  /** Original filename as provided by the agent at upload time. We don't serve
   *  the file itself (uploads are opaque references); the filename + fileHash
   *  + region give viewers enough to verify against their own source copy. */
  originalFilename?: string | undefined;
  /** SHA-256 hex of the file bytes, for cross-checking against a viewer's
   *  local copy of the source artifact. */
  fileHash?: string | undefined;
  /** Region of interest metadata (image_box for now; video/PDF planned). */
  regionMeta?: EnrichedRegionMeta | undefined;
}

export interface EnrichedEvidence {
  id: string;
  content: string;
  references: EnrichedReference[];
  /** When evidence is clustered, how many similar entries this exemplar represents */
  clusterSize?: number | undefined;
}

export interface EnrichedRecipeBook {
  recipeBookId: string;
  name: string;
  /** Kept for surfaces that own descriptions (briefing composer); check
   *  builders serialize {recipeBookId, name} only (recipe f3c0fe2f). */
  description: string | null;
}

export interface EnrichedResult {
  id: string;
  claimText: string;
  createdAt: string;
  semanticScore: number | null;
  clusterSize?: number | undefined;
  recipeBook?: EnrichedRecipeBook | undefined;
  evidence: EnrichedEvidence[];
  /** Known-set rendering flag (seam 2), passed through from SearchResultItem:
   *  the caller's session already holds this recipe — response builders
   *  render an id-only stub at its true rank. */
  known?: boolean | undefined;
  /** Known members of this displayed cluster (recipes the session has
   *  already seen or deposited), each with its raw similarity — builders
   *  render them as an id+percentage list beside the item ("stub, stub,
   *  full recipe": known cluster-mates stay visible). */
  knownClusterMembers?: Array<{ id: string; similarity: number }> | undefined;
}

// ── Main function ────────────────────────────────────────────────────────────

export async function enrichResults(
  db: PostgresJsDatabase,
  results: SearchResultItem[],
): Promise<EnrichedResult[]> {
  if (results.length === 0) return [];

  const traceIds = results.map((r) => r.id);
  const traceIdsSql = sql.join(
    traceIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // 0. Load group info for all trace IDs
  const groupRows = await db.execute(sql`
    SELECT t.id AS trace_id, g.id AS group_id, g.name AS group_name, g.description AS group_description
    FROM claimnet.traces t
    JOIN claimnet.groups g ON g.id = t.group_id
    WHERE t.id IN (${traceIdsSql})
  `);

  const traceGroupMap = new Map<string, EnrichedRecipeBook>();
  for (const row of groupRows as unknown as Record<string, unknown>[]) {
    traceGroupMap.set(row["trace_id"] as string, {
      recipeBookId: row["group_id"] as string,
      name: row["group_name"] as string,
      description: (row["group_description"] as string) ?? null,
    });
  }

  // 1. Load evidence for all trace IDs (stance column persists for legacy
  // rows but is not surfaced — see file header).
  const evidenceRows = await db.execute(sql`
    SELECT te.trace_id, e.content, e.id AS evidence_id
    FROM claimnet.trace_evidence te
    JOIN claimnet.evidence e ON e.id = te.evidence_id
    WHERE te.trace_id IN (${traceIdsSql})
    ORDER BY te.created_at ASC
  `);

  const evidenceList = (evidenceRows as unknown as Record<string, unknown>[]).map((row) => ({
    traceId: row["trace_id"] as string,
    content: row["content"] as string,
    evidenceId: row["evidence_id"] as string,
  }));

  // 2. Collect all evidence IDs and load their references
  const evidenceIds = evidenceList.map((e) => e.evidenceId);
  const refMap = new Map<string, EnrichedReference[]>();

  if (evidenceIds.length > 0) {
    const evidenceIdsSql = sql.join(
      evidenceIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    const refRows = await db.execute(sql`
      SELECT er.evidence_id, r.quote, r.source, r.file_url, r.file_mime_type,
             r.original_filename, r.file_hash, r.region_meta
      FROM claimnet.evidence_references er
      JOIN claimnet.references r ON r.id = er.reference_id
      WHERE er.evidence_id IN (${evidenceIdsSql})
      ORDER BY er.created_at ASC
    `);

    for (const row of refRows as unknown as Record<string, unknown>[]) {
      const evidenceId = row["evidence_id"] as string;
      const ref: EnrichedReference = {
        quote: row["quote"] as string,
        source: row["source"] as string,
        fileUrl: (row["file_url"] as string) || undefined,
        fileMimeType: (row["file_mime_type"] as string) || undefined,
        originalFilename: (row["original_filename"] as string) || undefined,
        fileHash: (row["file_hash"] as string) || undefined,
        regionMeta: (row["region_meta"] as EnrichedRegionMeta) || undefined,
      };
      const existing = refMap.get(evidenceId);
      if (existing) {
        existing.push(ref);
      } else {
        refMap.set(evidenceId, [ref]);
      }
    }
  }

  // 3. Group evidence by trace ID
  const traceEvidenceMap = new Map<string, EnrichedEvidence[]>();

  for (const e of evidenceList) {
    const enrichedEvidence: EnrichedEvidence = {
      id: e.evidenceId,
      content: e.content,
      references: refMap.get(e.evidenceId) ?? [],
    };

    const existing = traceEvidenceMap.get(e.traceId);
    if (existing) {
      existing.push(enrichedEvidence);
    } else {
      traceEvidenceMap.set(e.traceId, [enrichedEvidence]);
    }
  }

  // 4. Build enriched results
  return results.map((r) => ({
    id: r.id,
    claimText: r.claimText,
    createdAt: r.createdAt.toISOString(),
    semanticScore: r.semanticScore ?? null,
    clusterSize: r.clusterSize,
    recipeBook: traceGroupMap.get(r.id),
    evidence: traceEvidenceMap.get(r.id) ?? [],
    known: r.known,
    knownClusterMembers: r.knownClusterMembers,
  }));
}

// ── Evidence clustering ─────────────────────────────────────────────────────

/**
 * Cluster evidence within each enriched result using K-Means.
 *
 * Loads evidence vectors from the DB, clusters per-trace, and replaces
 * the evidence arrays with clustered exemplars + cluster sizes.
 *
 * Research basis: CRAG (Clustered RAG) — clustering retrieved evidence
 * before presenting reduces tokens 46-90% without quality loss.
 * See: docs/architecture/search-strategies.md
 *
 * @param maxEvidencePerTrace — max evidence entries to show per trace after clustering
 */
export async function clusterEvidenceInResults(
  db: PostgresJsDatabase,
  results: EnrichedResult[],
  maxEvidencePerTrace: number = 5,
): Promise<EnrichedResult[]> {
  const { clusterResults } = await import("./clustering.service");

  // Collect all evidence IDs that need vector lookup
  const allEvidenceIds: string[] = [];
  for (const r of results) {
    for (const e of r.evidence) allEvidenceIds.push(e.id);
  }

  if (allEvidenceIds.length === 0) return results;

  // Batch load evidence vectors
  const evidenceIdsSql = sql.join(
    allEvidenceIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const vectorRows = await db.execute(sql`
    SELECT es.source_id::text AS evidence_id,
           ev.vector::text AS vector_str
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
    WHERE es.source_id IN (${evidenceIdsSql})
      AND es.source_type = 'evidence'
      AND ev.task_type = 'SEMANTIC_SIMILARITY'
      AND ev.status = 'complete'
      AND ev.vector IS NOT NULL
  `);

  const vectorMap = new Map<string, string>();
  for (const row of vectorRows as unknown as Record<string, unknown>[]) {
    vectorMap.set(row["evidence_id"] as string, row["vector_str"] as string);
  }

  // Cluster evidence per trace
  return results.map((r) => {
    if (r.evidence.length <= maxEvidencePerTrace) return r;

    // Build vectors for evidence that has embeddings
    const evidenceWithVectors: { evidence: EnrichedEvidence; vector: number[] }[] = [];
    const evidenceWithoutVectors: EnrichedEvidence[] = [];

    for (const e of r.evidence) {
      const vecStr = vectorMap.get(e.id);
      if (vecStr) {
        const vector = vecStr.slice(1, -1).split(",").map(Number);
        evidenceWithVectors.push({ evidence: e, vector });
      } else {
        evidenceWithoutVectors.push(e);
      }
    }

    if (evidenceWithVectors.length <= maxEvidencePerTrace) {
      // Not enough to cluster — return as-is
      return r;
    }

    const clusters = clusterResults({
      vectors: evidenceWithVectors.map((e) => e.vector),
      k: maxEvidencePerTrace,
    });

    const clusteredEvidence = clusters.map((c) => ({
      ...evidenceWithVectors[c.exemplarIndex]!.evidence,
      clusterSize: c.memberCount,
    }));

    // Append any evidence without vectors (unclustered) at the end
    return {
      ...r,
      evidence: [...clusteredEvidence, ...evidenceWithoutVectors],
    };
  });
}
