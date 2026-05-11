/**
 * Trace submission and search service.
 *
 * Core business logic for the search-as-logging model:
 * 1. Validate the API key
 * 2. Parse evidence markdown into structured entries
 * 3. Insert trace + evidence + references + links
 * 4. Run full-text search on existing traces
 * 5. Return results with pagination
 *
 * Docs to update when changing this file:
 *   - docs/architecture/search-algorithms.md (Implementation section, Embedding Strategies)
 *   - docs/architecture/search-strategies.md (Sync vs Async Embedding, Strategy 3)
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  evidence,
  references,
  traceEvidence,
  traceReferences,
  evidenceReferences,
} from "@soupnet/db";
import { getDb } from "../db";
import { parseEvidenceMarkdown } from "./evidence-parser";
import { validateKey } from "./api-key.service";
import { enqueueEmbedding } from "../lib/embeddings/enqueue";
import { storeFile } from "../lib/file-store";
import type { RegionMeta } from "../lib/image-roi";
import type { EvidenceSearchResult } from "./vector-search.service";
import { scoreFormatAdherence } from "./format-adherence";
import { runSearchPipeline } from "./search-pipeline";
import { auditLog } from "@soupnet/db";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ImageAttachment {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface SubmitAndSearchParams {
  key: string;
  traceText: string;
  evidenceFor: string;
  sort?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  clusters?: number | undefined;
  maxChars?: number | undefined;
  /** Optional image attachment — stored as evidence and embedded multimodally */
  image?: ImageAttachment | undefined;
  /** Optional region-of-interest metadata for the attached image. If
   *  image_box is set, the embedding pipeline crops to ROI+padding, blurs
   *  the padding, and appends a text hint. See ADR-0019 for details. */
  region?: RegionMeta | undefined;
  /** Two concept terms for semantic axis projection (comma-separated). */
  axes?: string | undefined;
  /** Group ID or slug to write this trace to. Resolved within the key's write groups.
   *  Defaults to the key's defaultWriteGroupId. */
  targetGroup?: string | undefined;
  /** Comma-separated group slugs or IDs to restrict search scope.
   *  Resolved within the key's read groups. Defaults to all readable groups. */
  readGroups?: string | undefined;
}

export interface SearchResultItem {
  id: string;
  claimText: string;
  createdAt: Date;
  rank: number;
  semanticScore?: number | undefined;
  clusterSize?: number | undefined;
}

export interface SubmitAndSearchResult {
  error?: string;
  traceId?: string;
  /** The checked recipe text — echoed in JSON responses so agents can match results to divergent checks. */
  traceText?: string;
  formatWarning?: string | undefined;
  results: SearchResultItem[];
  /** Evidence from other recipes that's topically related to the checked recipe */
  relatedEvidence?: EvidenceSearchResult[] | undefined;
  totalResults: number;
  currentPage: number;
  totalPages: number;
  searchMode?: "semantic" | "hybrid" | "lexical" | undefined;
  clustered?: boolean | undefined;
  /** Concept-axis positions (TCAV-style). Only when axes param is set. */
  conceptAxes?: {
    axisA: string;
    axisB: string;
    positions: Record<string, { x: number; y: number }>;
  } | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface InsertEvidenceOptions {
  db: PostgresJsDatabase;
  traceId: string;
  traceText: string; // parent trace claim text — prepended to evidence embeddings per Anthropic contextual retrieval
  apiKeyId: string;
  groupId: string;
  entries: Array<{ interpretation: string; quote: string; source: string }>;
  stance: "for" | "against";
  /** File attachment for the first evidence entry's reference. Optional
   *  region metadata triggers ROI-aware embedding (blur + text hint) per
   *  ADR-0019. */
  file?: {
    url: string;
    mimeType: string;
    hash: string;
    buffer: Buffer;
    /** Original filename as the agent provided it. Surfaced to viewers
     *  alongside fileHash + region so they can verify against their own copy
     *  of the source artifact (we don't serve the file itself). */
    originalFilename?: string | undefined;
    region?: RegionMeta | undefined;
  } | undefined;
}

async function insertEvidenceEntries(opts: InsertEvidenceOptions): Promise<void> {
  const { db, traceId, traceText, apiKeyId, groupId, entries, stance, file } = opts;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!entry.interpretation && !entry.quote) continue;

    // Insert evidence
    const evidenceRows = await db
      .insert(evidence)
      .values({ content: entry.interpretation || "(no interpretation)" })
      .returning({ id: evidence.id });

    const evidenceId = evidenceRows[0]?.id;
    if (!evidenceId) continue;

    // Link trace <-> evidence
    await db.insert(traceEvidence).values({
      traceId,
      evidenceId,
      stance,
      apiKeyId,
    });

    // Insert reference if quote or source present (or if file attached to first entry)
    const attachFile = i === 0 && file;
    if (entry.quote || entry.source || attachFile) {
      const refRows = await db
        .insert(references)
        .values({
          quote: entry.quote || "",
          source: entry.source || "",
          ...(attachFile ? {
            fileUrl: file.url,
            fileMimeType: file.mimeType,
            fileHash: file.hash,
            ...(file.originalFilename ? { originalFilename: file.originalFilename } : {}),
            ...(file.region ? { regionMeta: file.region } : {}),
          } : {}),
        })
        .returning({ id: references.id });

      const referenceId = refRows[0]?.id;
      if (!referenceId) continue;

      // Link trace <-> reference
      await db.insert(traceReferences).values({
        traceId,
        referenceId,
        apiKeyId,
      });

      // Link evidence <-> reference
      await db.insert(evidenceReferences).values({
        evidenceId,
        referenceId,
      });
    }

    // Embed this evidence entry with parent trace context prepended.
    // DEFERRED TO WORKER — evidence embeddings are not needed for immediate search.
    // The worker sweep generates vectors asynchronously.
    // Research basis: Anthropic's Contextual Retrieval — prepending parent document
    // context to chunks produces 35-67% improvement in retrieval quality.
    // See: https://www.anthropic.com/news/contextual-retrieval
    const embeddingLines = [
      `Recipe context: "${traceText}"`,
      `Supporting evidence: ${entry.interpretation}`,
      entry.quote ? `> "${entry.quote}"` : "",
      entry.source ? `-- ${entry.source}` : "",
    ];

    // ROI-aware multimodal embedding (ADR-0019): if the attachment has a
    // region box, apply the visual cue (blur-reverse-mask) to the image
    // and append a text hint so Gemini interprets the blur as a pipeline
    // artifact, not a property of the original image.
    const hasFile = i === 0 && file;
    let embedFileBuffer: Buffer | undefined;
    let embedFileMimeType: string | undefined;
    if (hasFile) {
      embedFileBuffer = file.buffer;
      embedFileMimeType = file.mimeType;
      if (file.region?.image_box) {
        try {
          const { applyVisualCue, roiTextHint } = await import("../lib/image-roi");
          const processed = await applyVisualCue(file.buffer, file.region.image_box);
          embedFileBuffer = processed.buffer;
          embedFileMimeType = processed.mimeType;
          embeddingLines.push("", roiTextHint(file.region.image_box));
        } catch (err) {
          // Non-fatal: if ROI processing fails, log and fall back to the
          // original image without region context. The reference row still
          // stores region_meta so later pipeline versions can re-embed.
          console.error("[trace.service] ROI processing failed, falling back to unmodified image:", err instanceof Error ? err.message : String(err));
        }
      }
    }

    const embeddingText = embeddingLines.filter(Boolean).join("\n");

    // Multimodal chunks are sync-only (enqueueEmbedding enforces). Text-only
    // evidence defers to the async pipeline since it's not needed for
    // immediate search.
    await enqueueEmbedding(db, {
      sourceType: "evidence",
      sourceId: evidenceId,
      groupId,
      sourceText: embeddingText,
      artifactCategory: hasFile ? "multimodal" : "text",
      ...(hasFile && embedFileBuffer && embedFileMimeType ? { fileBuffer: embedFileBuffer, fileMimeType: embedFileMimeType } : {}),
      deferToWorker: !hasFile,
    });
  }
}

// ── Embedding strategies — imported from @soupnet/domain ────────────────────
// See: docs/architecture/search-algorithms.md §Experimental Embedding Strategies
import {
  buildExperimentalStrategies,
  buildFullRecipeContext,
} from "@soupnet/domain";

// ── Main service function ────────────────────────────────────────────────────

export async function submitAndSearch(
  params: SubmitAndSearchParams,
): Promise<SubmitAndSearchResult> {
  const db = getDb();
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;

  // 1. Validate API key
  const keyResult = await validateKey(db, params.key);
  if (!keyResult) {
    return {
      error: "Invalid or expired API key.",
      results: [],
      totalResults: 0,
      currentPage: page,
      totalPages: 0,
    };
  }

  const { keyId, userId, readGroupIds, writeGroupIds, defaultWriteGroupId } = keyResult;

  // Resolve write target group (slug or ID, within key's write groups)
  let groupId: string;
  if (params.targetGroup) {
    const resolved = await resolveGroupSlug(db, params.targetGroup, writeGroupIds);
    if (!resolved) {
      return {
        error: `Group "${params.targetGroup}" not found or not writable with this key.`,
        results: [], totalResults: 0, currentPage: page, totalPages: 0,
      };
    }
    groupId = resolved;
  } else {
    groupId = defaultWriteGroupId;
  }

  if (!groupId || !writeGroupIds.includes(groupId)) {
    return {
      error: "API key has no write access to its default group.",
      results: [], totalResults: 0, currentPage: page, totalPages: 0,
    };
  }

  // Resolve read scope (optional per-call narrowing of readable groups)
  let effectiveReadGroupIds = readGroupIds;
  if (params.readGroups) {
    const slugs = params.readGroups.split(",").map((s) => s.trim()).filter(Boolean);
    const resolved: string[] = [];
    for (const slug of slugs) {
      const id = await resolveGroupSlug(db, slug, readGroupIds);
      if (id) resolved.push(id);
    }
    if (resolved.length > 0) effectiveReadGroupIds = resolved;
  }

  // 1b. Format adherence check
  const adherence = scoreFormatAdherence(params.traceText);
  if (adherence.level === "reject") {
    return {
      error: adherence.reason,
      results: [],
      totalResults: 0,
      currentPage: page,
      totalPages: 0,
    };
  }

  const formatWarning =
    adherence.level === "warn" ? adherence.reason : undefined;

  // 2. Parse evidence
  const forEntries = parseEvidenceMarkdown(params.evidenceFor);
  // evidence_against removed from ingest — see docs/architecture/embedding-test-results.md
  // (negation problem: embeddings can't distinguish stance).

  // 3. Idempotency check: hash the claim text, ON CONFLICT return existing
  const claimTextHash = crypto.createHash("sha256").update(params.traceText).digest("hex");
  let traceId: string | undefined;
  let _isExisting = false;

  await db.transaction(async (tx) => {
    // Try to insert — unique constraint on (api_key_id, group_id, claim_text_hash)
    // prevents duplicates from the same agent + group
    const traceRows = await tx.execute(sql`
      INSERT INTO claimnet.traces (user_id, group_id, api_key_id, claim_text, claim_text_hash, format_adherence_score)
      VALUES (${userId}::uuid, ${groupId}::uuid, ${keyId}::uuid, ${params.traceText}, ${claimTextHash}, ${adherence.score})
      ON CONFLICT (api_key_id, group_id, claim_text_hash) DO NOTHING
      RETURNING id
    `);

    const insertedRow = (traceRows as unknown as Array<{ id: string }>)[0];

    if (insertedRow) {
      // New trace — insert evidence, references, embeddings
      traceId = insertedRow.id;

      // Store file attachment if present (for first evidence_for reference).
      // storeFile stores the ORIGINAL (unmodified) bytes per ADR-0019 —
      // ROI processing is applied at embed time, not at storage time, so
      // the stored bytes remain re-processable if the visual-cue technique
      // changes later.
      let fileInfo: {
        url: string;
        mimeType: string;
        hash: string;
        buffer: Buffer;
        region?: RegionMeta | undefined;
      } | undefined;
      if (params.image) {
        const stored = await storeFile(params.image.buffer, params.image.mimeType);
        fileInfo = {
          url: stored.publicUrl,
          mimeType: params.image.mimeType,
          hash: stored.contentHash,
          buffer: params.image.buffer,
          ...(params.image.filename ? { originalFilename: params.image.filename } : {}),
          ...(params.region ? { region: params.region } : {}),
        };
      }

      // Insert evidence entries (each gets its own embedding)
      await insertEvidenceEntries({
        db: tx, traceId, traceText: params.traceText, apiKeyId: keyId, groupId,
        entries: forEntries, stance: "for", file: fileInfo,
      });
      // No "against" entries — stance discovery is handled by the evidence search pipeline

      // Trace-level embedding (text only — evidence embeddings are separate)
      await enqueueEmbedding(tx, {
        sourceType: "trace",
        sourceId: traceId,
        groupId,
        sourceText: params.traceText,
        artifactCategory: "text",
      });

      // Full-recipe context embedding — concatenates trace + all evidence + references.
      // See: docs/architecture/search-strategies.md (Strategy 3)
      const fullRecipeText = buildFullRecipeContext(params.traceText, forEntries);

      await enqueueEmbedding(tx, {
        sourceType: "trace",
        sourceId: traceId,
        groupId,
        sourceText: fullRecipeText,
        artifactCategory: "text",
        strategyId: "full_recipe_context",
      });

      // ── Experimental embedding strategies (6 variants) ──────────────────
      // Deferred to worker — these are for map visualization experiments,
      // not for recipe check search results. The worker strategy sweep
      // discovers and processes them within 1 minute.
      // See: docs/architecture/search-algorithms.md §Experimental Embedding Strategies

      const experimentalStrategies = buildExperimentalStrategies(
        params.traceText,
        forEntries,
      );

      for (const strategy of experimentalStrategies) {
        await enqueueEmbedding(tx, {
          sourceType: "trace",
          sourceId: traceId,
          groupId,
          sourceText: strategy.text,
          artifactCategory: "text",
          strategyId: strategy.id,
          deferToWorker: true,
        });
      }
    } else {
      // Duplicate — find the existing trace
      _isExisting = true;
      const existingRows = await tx.execute(sql`
        SELECT id FROM claimnet.traces
        WHERE api_key_id = ${keyId}::uuid
          AND group_id = ${groupId}::uuid
          AND claim_text_hash = ${claimTextHash}
        LIMIT 1
      `);
      traceId = (existingRows as unknown as Array<{ id: string }>)[0]?.id;
    }
  });

  if (!traceId) {
    return {
      error: "Failed to insert trace.",
      results: [],
      totalResults: 0,
      currentPage: page,
      totalPages: 0,
    };
  }

  // 6. Run unified search pipeline
  // See docs/architecture/search-algorithms.md for the full algorithm description.
  const pipelineResult = await runSearchPipeline({
    db,
    groupIds: effectiveReadGroupIds,
    query: params.traceText,
    k: params.clusters,
    maxChars: params.maxChars,
    sort: params.sort,
    page,
    perPage,
    excludeTraceId: traceId,
    axes: params.axes,
    includeVectors: !!params.axes, // need vectors for concept-axis computation
  });

  // 7. Audit log — record what the agent saw for later analysis and "Map from here".
  //
  // F29: api_key_id is also written to its own column (in addition to the
  // legacy metadata.apiKeyId field) so the per-key rate-limit COUNT queries
  // can hit the indexed column instead of jsonb extraction.
  //
  // F11 follow-up: when the recipe carried a file upload, file metadata is
  // included on this same event rather than a separate upload.received event
  // — uploads only co-occur with /check, so a single row keys the forensic
  // trail to (key, trace, file) atomically. See ADR-0019.
  try {
    const metadata: Record<string, unknown> = {
      apiKeyId: keyId,
      k: params.clusters ?? null,
      maxChars: params.maxChars ?? null,
      searchMode: pipelineResult.searchMode,
      resultCount: pipelineResult.totalResults,
      clustered: pipelineResult.clustered,
      resultTraceIds: pipelineResult.results.map((r) => r.id),
    };
    if (params.image) {
      const imageHash = crypto.createHash("sha256").update(params.image.buffer).digest("hex");
      metadata["hasFile"] = true;
      metadata["fileHash"] = imageHash;
      metadata["fileMimeType"] = params.image.mimeType;
      metadata["fileBytes"] = params.image.buffer.length;
    }
    await db.insert(auditLog).values({
      actorUserId: userId,
      apiKeyId: keyId,
      action: "recipe.checked",
      targetType: "trace",
      targetId: traceId,
      metadata,
    });
  } catch (err) {
    // Non-blocking — don't fail the recipe check if audit logging fails
    console.error("[trace.service] Audit log write failed:", err);
  }

  return {
    traceId,
    traceText: params.traceText,
    formatWarning,
    results: pipelineResult.results,
    relatedEvidence: pipelineResult.relatedEvidence,
    totalResults: pipelineResult.totalResults,
    currentPage: pipelineResult.page,
    totalPages: pipelineResult.totalPages,
    searchMode: pipelineResult.searchMode === "corpus" ? undefined : pipelineResult.searchMode,
    clustered: pipelineResult.clustered || undefined,
    conceptAxes: pipelineResult.conceptAxes
      ? {
        axisA: pipelineResult.conceptAxes.axisA,
        axisB: pipelineResult.conceptAxes.axisB,
        positions: Object.fromEntries(pipelineResult.conceptAxes.positions),
      }
      : undefined,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a group identifier (UUID or slug) within a set of allowed group IDs.
 * Returns the UUID if found, null otherwise. Slugs are resolved per-key scope
 * (not globally) to avoid collisions between users' personal groups.
 */
async function resolveGroupSlug(
  db: PostgresJsDatabase,
  groupRef: string,
  allowedGroupIds: string[],
): Promise<string | null> {
  if (allowedGroupIds.length === 0) return null;

  // If it looks like a UUID, check directly
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(groupRef)) {
    return allowedGroupIds.includes(groupRef) ? groupRef : null;
  }

  // Otherwise treat as slug — look up within allowed groups
  const rows = await db.execute(sql`
    SELECT id FROM claimnet.groups
    WHERE slug = ${groupRef}
      AND id IN (${sql.join(allowedGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
    LIMIT 1
  `);

  const row = (rows as unknown as Array<{ id: string }>)[0];
  return row?.id ?? null;
}
