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
import {
  enqueueEmbedding,
  getOrCreateCachedVector,
  computeChunkHash,
} from "../lib/embeddings/enqueue";
import { storeFile } from "../lib/file-store";
import type { RegionMeta } from "../lib/image-roi";
import type { EvidenceSearchResult } from "./vector-search.service";
import { scoreFormatAdherence } from "./format-adherence";
import { runSearchPipeline } from "./search-pipeline";
import { StageTimer } from "../lib/stage-timer";
import { invalidKeyMessage } from "../lib/key-remediation";
import { resolveRankingConfig } from "./system-settings.service";
import { DEFAULT_RANKING, RANKING_ALGORITHM_VERSION } from "@soupnet/domain";
import type { CandidateSignals } from "@soupnet/domain";
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
  /** Keyword terms (whitespace/comma separated) that narrow the candidate
   *  set — every returned recipe must contain every term (case-insensitive
   *  substring). This is the `filter` param when it accompanies a recipe;
   *  filter WITHOUT a recipe goes through searchWithoutLogging instead,
   *  where the filter text becomes the semantic query itself. */
  keywordFilter?: string | undefined;
  /** ISO 8601 date/datetime — when the human originally made this judgment
   *  call, for backfilling decisions discovered in dated artifacts (git
   *  history, ADRs). Must not be in the future. Stored as traces.decided_at;
   *  created_at stays the insertion time. See design-thinking.md §Decision
   *  Archaeology. */
  decidedAt?: string | undefined;
  /** Free-text self-minted agent identity. CAPTURE ONLY (WT-4 phase 2,
   *  2026-07-05): stamped into the recipe.checked audit metadata so agent
   *  lineages are joinable later. No dedup or behavior change — phase-2
   *  auto-stubbing is gated on recall evals (see the worktree plan). */
  agentId?: string | undefined;
  /** Server-known connection surface (UVP Layer 1): "mcp-http" (set by the
   *  /mcp route), "mcp-stdio" (the stdio proxy self-identifies via the
   *  X-SoupNet-Surface header on /check), or "web" (default for /check).
   *  OAuth client identity is derived from the key itself, not this field. */
  surface?: string | undefined;
  /** Per-request echo-suppression override ("on"/"off"), the A/B toggle. When
   *  absent the global `echoSuppression` setting (default OFF) applies. See
   *  docs/planning/echo-suppression.md. */
  echoSuppress?: "on" | "off" | undefined;
}

export interface SearchResultItem {
  id: string;
  claimText: string;
  createdAt: Date;
  rank: number;
  semanticScore?: number | undefined;
  clusterSize?: number | undefined;
  /** Per-candidate ranking signals (@soupnet/domain CandidateSignals) —
   *  hydrated by hybridSearch in query mode; absent in corpus mode. Available
   *  to every pipeline stage; NOT serialized into agent responses. */
  signals?: CandidateSignals | undefined;
}

/** Which ranking served this response — version + effective switches.
 *  Additive response metadata (brief §3c): consumers/experiments report the
 *  ranking they ran against. */
export interface RankingResponseInfo {
  /** Dated algorithm version of the shipped defaults (ranking-changelog.md). */
  version: string;
  /** Whether echo demotion was active for this request. */
  echoSuppression: "on" | "off";
  /** Cluster display-ordering key in effect. */
  clusterOrdering: string;
  /** Ephemeral per-request overrides applied (e.g. "echo_suppress=on").
   *  Omitted when none. */
  overrides?: string[] | undefined;
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
  /** Server-Timing header value for the check's per-stage latencies.
   *  Routes attach it as a response header; never part of the JSON payload. */
  serverTiming?: string | undefined;
  /** Which ranking served this response (JSON/structured payloads only —
   *  kept out of the token-lean markdown surfaces). */
  ranking?: RankingResponseInfo | undefined;
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
// (Experimental variants are backfilled by the worker strategy sweep, not
// enqueued on the check path.)
import { buildFullRecipeContext } from "@soupnet/domain";

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
      error: invalidKeyMessage(),
      results: [],
      totalResults: 0,
      currentPage: page,
      totalPages: 0,
    };
  }

  const { keyId, userId, readGroupIds, writeGroupIds, defaultWriteGroupId, keyType, oauthClientId } = keyResult;

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

  // 1c. Parse optional decided_at (original judgment date for backfilled
  // decisions). Rejecting future dates means backdating can only make a
  // recipe older — no freshness gaming.
  let decidedAt: Date | undefined;
  if (params.decidedAt !== undefined && params.decidedAt.trim() !== "") {
    const parsed = new Date(params.decidedAt.trim());
    if (Number.isNaN(parsed.getTime())) {
      return {
        error: `Invalid decided_at "${params.decidedAt}" — use ISO 8601, e.g. "2024-03-15" or "2024-03-15T14:30:00Z".`,
        results: [], totalResults: 0, currentPage: page, totalPages: 0,
      };
    }
    if (parsed.getTime() > Date.now()) {
      return {
        error: `decided_at "${params.decidedAt}" is in the future — it must be when the judgment was originally made.`,
        results: [], totalResults: 0, currentPage: page, totalPages: 0,
      };
    }
    decidedAt = parsed;
  }

  // 2. Parse evidence
  const forEntries = parseEvidenceMarkdown(params.evidenceFor);
  // evidence_against removed from ingest — see docs/architecture/embedding-test-results.md
  // (negation problem: embeddings can't distinguish stance).

  // 3. Idempotency check: hash the claim text, ON CONFLICT return existing
  const claimTextHash = crypto.createHash("sha256").update(params.traceText).digest("hex");
  let traceId: string | undefined;
  let isExisting = false;

  // 4. Resolve the two sync embeddings in PARALLEL, BEFORE the transaction —
  // external API calls don't belong inside an open transaction, and running
  // them concurrently makes the write path cost ~one embed round-trip instead
  // of a sequential sum (2026-07-01 latency findings). Content-hash cache
  // (vector_cache) makes both cache hits for an identical re-check; a
  // duplicate submitted with DIFFERENT evidence wastes one speculative
  // full-context embed (harmless: cached, and duplicates are the rare path).
  // The trace vector doubles as the search query vector below — the query
  // text IS the trace text, so the pipeline makes zero additional embedding
  // calls. Full-recipe context (Strategy 3) is built from the same parsed
  // entries the insert path uses.
  const timer = new StageTimer();
  const fullRecipeText = buildFullRecipeContext(params.traceText, forEntries);
  const [traceVectorStr, fullContextVectorStr] = await timer.time("embed", () =>
    Promise.all([
      getOrCreateCachedVector(
        db, computeChunkHash(params.traceText), params.traceText, "SEMANTIC_SIMILARITY",
      ),
      getOrCreateCachedVector(
        db, computeChunkHash(fullRecipeText), fullRecipeText, "SEMANTIC_SIMILARITY",
      ),
    ]));

  await timer.time("write", () => db.transaction(async (tx) => {
    // Try to insert — unique constraint on (api_key_id, group_id, claim_text_hash)
    // prevents duplicates from the same agent + group
    const traceRows = await tx.execute(sql`
      INSERT INTO claimnet.traces (user_id, group_id, api_key_id, claim_text, claim_text_hash, format_adherence_score, decided_at)
      VALUES (${userId}::uuid, ${groupId}::uuid, ${keyId}::uuid, ${params.traceText}, ${claimTextHash}, ${adherence.score}, ${decidedAt ? decidedAt.toISOString() : null}::timestamptz)
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

      // Trace-level embedding (text only — evidence embeddings are separate).
      // Vector was resolved in parallel before the transaction; this inserts
      // pipeline rows only.
      await enqueueEmbedding(tx, {
        sourceType: "trace",
        sourceId: traceId,
        groupId,
        sourceText: params.traceText,
        artifactCategory: "text",
        precomputedVectors: { SEMANTIC_SIMILARITY: traceVectorStr },
      });

      // Full-recipe context embedding — concatenates trace + all evidence + references.
      // See: docs/architecture/search-strategies.md (Strategy 3)
      await enqueueEmbedding(tx, {
        sourceType: "trace",
        sourceId: traceId,
        groupId,
        sourceText: fullRecipeText,
        artifactCategory: "text",
        strategyId: "full_recipe_context",
        precomputedVectors: { SEMANTIC_SIMILARITY: fullContextVectorStr },
      });

      // Experimental embedding strategies (6 map-visualization variants) are
      // NOT enqueued here — the worker strategy sweep discovers traces missing
      // them and backfills within ~1 minute (strategy-sweep.ts, second
      // discovery loop). Keeping them off the check path saves ~30 inserts
      // per check (operator decision, 2026-07-01).
    } else {
      // Duplicate — find the existing trace
      isExisting = true;
      const existingRows = await tx.execute(sql`
        SELECT id FROM claimnet.traces
        WHERE api_key_id = ${keyId}::uuid
          AND group_id = ${groupId}::uuid
          AND claim_text_hash = ${claimTextHash}
        LIMIT 1
      `);
      traceId = (existingRows as unknown as Array<{ id: string }>)[0]?.id;
    }
  }));

  if (!traceId) {
    return {
      error: "Failed to insert trace.",
      results: [],
      totalResults: 0,
      currentPage: page,
      totalPages: 0,
    };
  }

  // 5b. Resolve the ranking config (versioned code defaults ← the global
  // echoSuppression setting ← the per-request echo_suppress override). The
  // echo reorder demotes THIS agent's own recent hypothesis-appends in the
  // results — see docs/planning/echo-suppression.md and
  // docs/planning/check-recipe-ranking-system.md.
  const ranking = await resolveRankingConfig(db, params.echoSuppress);

  // 6. Run unified search pipeline
  // See docs/architecture/search-algorithms.md for the full algorithm description.
  // The pre-resolved trace vector doubles as the query vector (identical text),
  // so the pipeline makes no embedding API calls of its own.
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
    queryVectorStr: traceVectorStr ?? undefined,
    keywordFilter: params.keywordFilter,
    echo: {
      config: ranking.config.echo,
      exemption: ranking.config.exemption,
      currentApiKeyId: keyId,
      now: new Date(),
    },
    ranking: ranking.config,
    timer,
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
      // UVP Layer 1 server stamps (2026-07-05): what the agent actually saw.
      // resultSimilarities is index-parallel to resultTraceIds — together
      // they erase the retyped-topSimilarity gap in self-reported feedback.
      resultSimilarities: pipelineResult.results.map((r) => r.semanticScore ?? null),
      // Connection surface: mcp-http | mcp-stdio | web (server-known).
      surface: params.surface ?? "web",
      // Which ranking served the check — joins offline analysis to the
      // algorithm version + effective demotion arm (brief §3c).
      rankingVersion: ranking.version,
      echoSuppression: ranking.config.echo.enabled,
      // OAuth client identity — segmentable cross-vendor column the day a
      // connector check arrives. Null for daily/scoped keys.
      ...(keyType === "oauth" && oauthClientId ? { oauthClientId } : {}),
    };
    if (params.agentId) {
      // Self-minted agent identity — capture only (no behavior; see
      // SubmitAndSearchParams.agentId).
      metadata["agentId"] = params.agentId;
    }
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

  // One structured timing line per check — the per-stage attribution the
  // 2026-07-01 investigation had to reconstruct by black-box measurement.
  // console.warn is the repo's operational-log channel (lint allows warn/error).
  // `req` disambiguates lines that share a traceId (duplicate re-checks of the
  // same recipe log one line each — N probes of one recipe are N requests, not
  // one request executing N times); `dup` marks the idempotent-duplicate path.
  console.warn(`[check-timing] ${JSON.stringify({
    req: crypto.randomUUID().slice(0, 8),
    traceId,
    dup: isExisting,
    ...timer.toLogObject(),
  })}`);

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
    serverTiming: timer.toServerTimingHeader(),
    ranking: {
      version: ranking.version,
      echoSuppression: ranking.config.echo.enabled ? "on" : "off",
      clusterOrdering: ranking.config.clusterOrdering,
      overrides: ranking.overrides.length > 0 ? ranking.overrides : undefined,
    },
  };
}

// ── Read-only search (the /check `filter` path) ─────────────────────────────

export interface SearchOnlyParams {
  key: string;
  /** Keyword text — becomes the semantic query (the same runSearchPipeline
   *  query slot the briefing's filter/purpose params use). */
  filter: string;
  sort?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  clusters?: number | undefined;
  maxChars?: number | undefined;
  axes?: string | undefined;
  readGroups?: string | undefined;
  surface?: string | undefined;
}

/**
 * Read-only keyword search over the key's read scope — the sanctioned
 * "just looking for something" path the docs have promised as
 * `/check?filter=...` (alias `f`) since before it existed (implemented
 * 2026-07-05, operator decision resolving the backlog [DECISION NEEDED]
 * item). Contract:
 *
 *   - NO trace row is inserted — nothing enters the corpus.
 *   - NO `recipe.checked` audit row is written, so the F29 per-key check
 *     budget is untouched (its COUNT filters on action='recipe.checked').
 *   - A lightweight `check.searched` audit row IS written so append-only
 *     accounting still sees the usage (same rationale as briefing.issued).
 *     Abuse control for the read path itself is the route-level in-memory
 *     per-credential limiter (mirroring the /recipes lookup decision) —
 *     deliberately NOT the audit-log-backed counter.
 */
export async function searchWithoutLogging(
  params: SearchOnlyParams,
): Promise<SubmitAndSearchResult> {
  const db = getDb();
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;

  const keyResult = await validateKey(db, params.key);
  if (!keyResult) {
    return {
      error: invalidKeyMessage(),
      results: [],
      totalResults: 0,
      currentPage: page,
      totalPages: 0,
    };
  }

  // Resolve read scope exactly as submitAndSearch does.
  let effectiveReadGroupIds = keyResult.readGroupIds;
  if (params.readGroups) {
    const slugs = params.readGroups.split(",").map((s) => s.trim()).filter(Boolean);
    const resolved: string[] = [];
    for (const slug of slugs) {
      const id = await resolveGroupSlug(db, slug, keyResult.readGroupIds);
      if (id) resolved.push(id);
    }
    if (resolved.length > 0) effectiveReadGroupIds = resolved;
  }

  const timer = new StageTimer();
  const pipelineResult = await runSearchPipeline({
    db,
    groupIds: effectiveReadGroupIds,
    query: params.filter,
    k: params.clusters,
    maxChars: params.maxChars,
    sort: params.sort,
    page,
    perPage,
    axes: params.axes,
    includeVectors: !!params.axes,
    timer,
  });

  try {
    await db.insert(auditLog).values({
      actorUserId: keyResult.userId,
      apiKeyId: keyResult.keyId,
      action: "check.searched",
      targetType: "search",
      metadata: {
        apiKeyId: keyResult.keyId,
        filter: params.filter,
        resultCount: pipelineResult.totalResults,
        searchMode: pipelineResult.searchMode,
        surface: params.surface ?? "web",
      },
    });
  } catch (err) {
    // Non-blocking — accounting must not fail the read.
    console.error("[trace.service] check.searched audit write failed:", err);
  }

  return {
    // No traceId — nothing was logged. Routes key their "search-only"
    // rendering off this absence.
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
    serverTiming: timer.toServerTimingHeader(),
    // The read-only filter path never demotes (echo suppression applies to
    // the logging check path only) and uses legacy ordering — but it is still
    // a ranked response, so it reports the algorithm version it ran under.
    ranking: {
      version: RANKING_ALGORITHM_VERSION,
      echoSuppression: "off",
      clusterOrdering: DEFAULT_RANKING.clusterOrdering,
    },
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
