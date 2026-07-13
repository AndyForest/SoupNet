import { Hono } from "hono";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { sql } from "drizzle-orm";
import { runSearchPipeline, MAP_VECTOR_DIMS } from "../services/search-pipeline";
import {
  mapLayoutCacheKey,
  getCachedMapLayout,
  setCachedMapLayout,
} from "../services/map-layout-cache";
import { deleteTraceCascade } from "../services/trace-delete.service";
import {
  moveTraceToBook,
  TraceMoveNotFoundError,
  TraceMoveSameBookError,
  TraceMoveDuplicateError,
  TraceMoveEvidenceNotFoundError,
} from "../services/trace-move.service";
import { writeAudit } from "../services/audit-log.service";
import { TRACE_REACTIONS, vocab, authorizeTraceMove } from "@soupnet/domain";

const traces = new Hono<AppEnv>();

/** Shared read-access gate for a trace: the requester owns it or is a member
 *  of its recipe book. Returns true when readable. Same predicate as
 *  GET /traces/:id. */
async function canReadTrace(
  db: ReturnType<typeof getDb>,
  traceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT t.id
    FROM claimnet.traces t
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND gm.user_id = ${userId}::uuid
    WHERE t.id = ${traceId}::uuid
      AND (t.user_id = ${userId}::uuid OR gm.user_id IS NOT NULL)
  `);
  return (rows as unknown as Array<{ id: string }>).length > 0;
}

// Secure-by-default: every JWT-authed route also requires email verification.
// See routes/auth.ts for the (very small) opt-out list.
traces.use("/*", requireAuth, requireVerifiedEmail);

// GET /traces/map — hierarchical cluster visualization
// Uses the same search pipeline as recipe check (unified k, maxChars params).
// dryRun=true: read-only, no trace logging.
traces.get("/map", async (c) => {
  const user = c.get("user");
  const db = getDb();

  // Get user's group IDs
  const groupRows = await db.execute(sql`
    SELECT group_id AS "groupId"
    FROM claimnet.group_members
    WHERE user_id = ${user.id}::uuid
  `);
  const groupIds = (groupRows as unknown as Array<{ groupId: string }>).map((r) => r.groupId);

  if (groupIds.length === 0) {
    return c.json({ ok: true, data: { clusters: [], unclustered: [], meta: { totalTraces: 0, tracesInScope: 0, k: 0 } } });
  }

  // Parse params — aligned with recipe check
  const k = parseInt(c.req.query("k") ?? "5", 10);
  const query = c.req.query("query") || undefined;
  const axes = c.req.query("axes") || undefined;
  const maxChars = c.req.query("max_chars") ? parseInt(c.req.query("max_chars")!, 10) : undefined;
  const expand = c.req.query("expand") === "true";
  const traceIdsParam = c.req.query("traceIds");
  const traceIds = traceIdsParam ? traceIdsParam.split(",").filter(Boolean) : undefined;
  const strategy = c.req.query("strategy") || undefined;

  // Optional group scoping — single-group (groupId) OR multi-group (groupIds=csv).
  // groupId wins when both are supplied, since it represents an explicit narrower
  // focus. Both validate every requested ID against the user's JWT-scoped
  // memberships — we never widen scope, only narrow.
  const groupIdParam = c.req.query("groupId");
  const groupIdsParam = c.req.query("groupIds");
  if (groupIdParam) {
    if (!groupIds.includes(groupIdParam)) {
      return c.json({ ok: false, error: "Not a member of that group" }, 403);
    }
    groupIds.length = 0;
    groupIds.push(groupIdParam);
  } else if (groupIdsParam) {
    const requested = groupIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (requested.length === 0) {
      return c.json({ ok: false, error: "groupIds must have at least one id" }, 400);
    }
    const allowed = new Set(groupIds);
    for (const id of requested) {
      if (!allowed.has(id)) {
        return c.json({ ok: false, error: "Not a member of one or more requested groups" }, 403);
      }
    }
    groupIds.length = 0;
    groupIds.push(...requested);
  }

  // ── Layout cache ─────────────────────────────────────────────────────────
  // The default map load (no query/axes/traceIds) recomputes the same layout
  // until the corpus changes; a corpus-version key makes repeat loads instant.
  // Query/axes/traceIds variants are per-interaction and skip the cache.
  const cacheable = !query && !axes && !traceIds;
  let cacheKey: string | undefined;
  if (cacheable) {
    // Fingerprint PER BOOK, then combine, rather than aggregating count(*) and
    // max(created_at) across the union first.
    //
    // This is hardening, not a bug fix — the aggregate form is correct TODAY.
    // An aggregated key cannot see a trace moving between two books inside the
    // union (one count falls, the other rises), but the layout it caches also
    // cannot: the cacheable path is corpus mode, which selects through
    // fetchCorpusTraces on traces.group_id, and CorpusTrace carries only
    // {id, claimText, createdAt} — no book identity reaches a node. So the union
    // really does render identically before and after such a move, and a
    // single-book map invalidates anyway because that book's count changes.
    //
    // It stops being correct the moment the map colors or groups nodes by book,
    // or a trace's text becomes editable in place. Per-book counts see the move;
    // max(updated_at) sees an in-place edit that no insert-time statistic can.
    // Both are one GROUP BY away, so pay for them now rather than debug it later.
    const versionRows = await db.execute(sql`
      SELECT
        group_id AS "groupId",
        count(*)::int AS n,
        COALESCE(max(created_at)::text, '') AS newest,
        COALESCE(max(updated_at)::text, '') AS touched
      FROM claimnet.traces
      WHERE group_id IN (${sql.join(groupIds.map((g) => sql`${g}::uuid`), sql`, `)})
      GROUP BY group_id
    `);
    const perBook = new Map(
      (versionRows as unknown as Array<{
        groupId: string; n: number; newest: string; touched: string;
      }>).map((r) => [r.groupId, `${r.n}:${r.newest}:${r.touched}`]),
    );
    // Stable order, and books with zero traces contribute an explicit empty
    // marker so adding the first trace to one changes the key.
    const corpusVersion = [...groupIds]
      .sort()
      .map((g) => `${g}=${perBook.get(g) ?? "0::"}`)
      .join("|");

    cacheKey = mapLayoutCacheKey({
      groupIds,
      k: expand ? undefined : k,
      maxChars,
      expand,
      strategy,
      corpusVersion,
    });
    const cached = getCachedMapLayout(cacheKey);
    if (cached !== undefined) {
      return c.json({ ok: true, data: { ...(cached as Record<string, unknown>), meta: { ...((cached as { meta: Record<string, unknown> }).meta), cached: true } } });
    }
  }

  // Run pipeline with clustering + vectors. Vectors are MRL-truncated at read
  // time (stored vectors untouched) — whole-corpus k-means at 768 dims costs
  // 1/4 of full precision with near-identical 2D layout quality.
  const result = await runSearchPipeline({
    db,
    groupIds,
    query,
    k: expand ? undefined : k,
    maxChars,
    expand,
    traceIds,
    includeVectors: true,
    axes,
    perPage: 10000, // no pagination limit — clustering IS the pagination
    vectorStrategy: strategy,
    vectorDims: MAP_VECTOR_DIMS,
  });

  // allResults has the pre-clustered full list; results has exemplars only
  const allTraces = result.allResults ?? result.results;
  const vectors = result.vectors;

  // Build cluster response with member IDs
  // result.results after clustering = one exemplar per cluster, in cluster order
  const clusters = (result.clusters ?? []).map((cluster, clusterIdx) => {
    const members = cluster.memberIndices
      .map((i) => allTraces[i])
      .filter(Boolean)
      .map((t) => ({ id: t!.id, text: t!.claimText.slice(0, 80) }));
    const memberIds = members.map((m) => m.id);
    // After clustering, result.results[clusterIdx] IS this cluster's exemplar
    const exemplar = result.results[clusterIdx];
    const exemplarId = exemplar?.id ?? memberIds[0] ?? "";
    const exemplarText = exemplar?.claimText ?? "";

    return {
      exemplarTraceId: exemplarId,
      exemplarText,
      memberCount: cluster.memberCount,
      avgSimilarity: cluster.avgSimilarity,
      memberTraceIds: memberIds,
      memberPreviews: members,
      exemplarVector: vectors?.get(exemplarId) ?? null,
    };
  });

  // Traces without vectors or not assigned to any cluster
  const clusteredIds = new Set(clusters.flatMap((c) => c.memberTraceIds));
  const unclustered = allTraces
    .filter((t) => !clusteredIds.has(t.id))
    .map((t) => ({
      id: t.id,
      claimText: t.claimText,
      createdAt: t.createdAt,
      vector: vectors?.get(t.id) ?? null,
    }));

  // Concept axes positions (TCAV-style projection)
  let conceptAxes: { axisA: string; axisB: string; positions: Record<string, { x: number; y: number }> } | undefined;
  if (result.conceptAxes) {
    const posObj: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of result.conceptAxes.positions) {
      posObj[id] = pos;
    }
    conceptAxes = { axisA: result.conceptAxes.axisA, axisB: result.conceptAxes.axisB, positions: posObj };
  }

  const data = {
    clusters,
    unclustered,
    conceptAxes,
    meta: {
      totalTraces: allTraces.length,
      tracesInScope: allTraces.length,
      k: clusters.length,
      searchMode: query ? result.searchMode : "corpus",
      vectorStrategy: strategy ?? "all",
      vectorDims: MAP_VECTOR_DIMS,
      cached: false,
    },
  };
  if (cacheKey) {
    setCachedMapLayout(cacheKey, data);
  }
  return c.json({ ok: true, data });
});

// GET /traces/checks — recipe check audit log
traces.get("/checks", async (c) => {
  const user = c.get("user");
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const rows = await db.execute(sql`
    SELECT
      al.id,
      al.target_id AS "traceId",
      al.metadata,
      al.occurred_at AS "occurredAt",
      t.claim_text AS "claimText"
    FROM claimnet.audit_log al
    LEFT JOIN claimnet.traces t ON t.id = al.target_id
    WHERE al.actor_user_id = ${user.id}::uuid
      AND al.action = 'recipe.checked'
    ORDER BY al.occurred_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM claimnet.audit_log
    WHERE actor_user_id = ${user.id}::uuid
      AND action = 'recipe.checked'
  `);
  const total = (countRows as unknown as Array<{ total: number }>)[0]?.total ?? 0;

  return c.json({ ok: true, data: { checks: rows, total } });
});

// GET /traces/count — total trace count for the user
traces.get("/count", async (c) => {
  const user = c.get("user");
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM claimnet.traces
    WHERE user_id = ${user.id}::uuid
  `);
  const count = (rows as unknown as Array<{ count: number }>)[0]?.count ?? 0;
  return c.json({ ok: true, data: { count } });
});

// GET /traces — list traces.
//
// Default (no groupId): the requester's own traces across all groups —
// the personal dashboard's "your activity" view.
//
// With ?groupId=<uuid>: all traces in that group (any author), if the
// requester is a member. Includes per-row userEmail and canDelete so
// group owners/admins can scan and delete malformed entries. Plain
// members see canDelete=true only on their own rows; owner/admin see
// it on every row; system role overrides to true.
traces.get("/", async (c) => {
  const user = c.get("user");
  const db = getDb();

  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const groupId = c.req.query("groupId");

  if (groupId) {
    const memberRows = await db.execute(sql`
      SELECT role FROM claimnet.group_members
      WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
    `);
    const role = (memberRows as unknown as Array<{ role: string }>)[0]?.role;
    if (!role) {
      return c.json({ ok: false, error: "Not a member of that group" }, 403);
    }
    const isGroupAdmin = role === "owner" || role === "admin";
    const isSystem = user.role === "system";

    const rows = await db.execute(sql`
      SELECT
        t.id,
        t.claim_text AS "claimText",
        t.user_id AS "userId",
        t.group_id AS "groupId",
        t.api_key_id AS "apiKeyId",
        t.format_adherence_score AS "formatAdherenceScore",
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt",
        COALESCE(ec.evidence_count, 0)::int AS "evidenceCount",
        COALESCE(rc.ref_count, 0)::int AS "referenceCount",
        g.name AS "groupName",
        ak.label AS "apiKeyLabel",
        u.email AS "userEmail"
      FROM claimnet.traces t
      LEFT JOIN claimnet.groups g ON g.id = t.group_id
      LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
      LEFT JOIN claimnet.users u ON u.id = t.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS evidence_count
        FROM claimnet.trace_evidence te
        WHERE te.trace_id = t.id
      ) ec ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS ref_count
        FROM claimnet.trace_references tr
        WHERE tr.trace_id = t.id
      ) rc ON true
      WHERE t.group_id = ${groupId}::uuid
      ORDER BY t.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const data = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      canDelete: isSystem || isGroupAdmin || r["userId"] === user.id,
    }));

    return c.json({ ok: true, data });
  }

  const rows = await db.execute(sql`
    SELECT
      t.id,
      t.claim_text AS "claimText",
      t.group_id AS "groupId",
      t.api_key_id AS "apiKeyId",
      t.format_adherence_score AS "formatAdherenceScore",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      COALESCE(ec.evidence_count, 0)::int AS "evidenceCount",
      COALESCE(rc.ref_count, 0)::int AS "referenceCount",
      g.name AS "groupName",
      ak.label AS "apiKeyLabel"
    FROM claimnet.traces t
    LEFT JOIN claimnet.groups g ON g.id = t.group_id
    LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS evidence_count
      FROM claimnet.trace_evidence te
      WHERE te.trace_id = t.id
    ) ec ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS ref_count
      FROM claimnet.trace_references tr
      WHERE tr.trace_id = t.id
    ) rc ON true
    WHERE t.user_id = ${user.id}::uuid
    ORDER BY t.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return c.json({ ok: true, data: rows });
});

// ── Feedback lineage + human reactions (WT-4 phase 3, 2026-07-05) ───────────
//
// The trace detail page renders the checks-against-this-recipe lineage:
// agent feedback rows (impact/disposition chips, story, note, agent id) plus
// the human ground-truth signals from §Validating the UVP Layer 3 — a
// still_true|stale|wrong reaction per user per recipe, and a "mattered" star
// per user per feedback row. JWT-auth, same read predicate as GET /traces/:id.

// GET /traces/:id/feedback — feedback rows + reaction summary for one trace
traces.get("/:id/feedback", async (c) => {
  const user = c.get("user");
  const traceId = c.req.param("id");
  const db = getDb();

  if (!(await canReadTrace(db, traceId, user.id))) {
    return c.json({ ok: false, error: "Trace not found" }, 404);
  }

  const feedbackRows = await db.execute(sql`
    SELECT
      cf.id,
      cf.agent_id AS "agentId",
      cf.kind,
      cf.impact,
      cf.disposition,
      cf.story_fulfilled AS "storyFulfilled",
      cf.story,
      cf.note,
      cf.top_similarity AS "topSimilarity",
      cf.model,
      cf.harness,
      cf.harness_version AS "harnessVersion",
      cf.related_trace_ids AS "relatedTraceIds",
      cf.created_at AS "createdAt",
      ak.label AS "apiKeyLabel",
      -- Human-origin rows (a re-filing correction) carry actor_user_id and a
      -- NULL api_key_id. Without this, they'd render as an unlabelled agent.
      cf.actor_user_id AS "actorUserId",
      au.email AS "actorEmail",
      COALESCE(sc.star_count, 0)::int AS "starCount",
      (my.id IS NOT NULL) AS "starredByMe"
    FROM claimnet.check_feedback cf
    LEFT JOIN claimnet.api_keys ak ON ak.id = cf.api_key_id
    LEFT JOIN claimnet.users au ON au.id = cf.actor_user_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS star_count
      FROM claimnet.check_feedback_stars s
      WHERE s.feedback_id = cf.id
    ) sc ON true
    LEFT JOIN claimnet.check_feedback_stars my
      ON my.feedback_id = cf.id AND my.user_id = ${user.id}::uuid
    WHERE cf.trace_id = ${traceId}::uuid
    ORDER BY cf.created_at DESC
  `);

  const reactionCounts = await db.execute(sql`
    SELECT reaction, COUNT(*)::int AS n
    FROM claimnet.trace_reactions
    WHERE trace_id = ${traceId}::uuid
    GROUP BY reaction
  `);
  const mineRows = await db.execute(sql`
    SELECT reaction FROM claimnet.trace_reactions
    WHERE trace_id = ${traceId}::uuid AND user_id = ${user.id}::uuid
  `);

  const counts: Record<string, number> = {};
  for (const r of reactionCounts as unknown as Array<{ reaction: string; n: number }>) {
    counts[r.reaction] = r.n;
  }

  return c.json({
    ok: true,
    data: {
      feedback: feedbackRows,
      reactions: {
        mine: (mineRows as unknown as Array<{ reaction: string }>)[0]?.reaction ?? null,
        counts,
      },
    },
  });
});

// PUT /traces/:id/reaction — set my reaction (upsert: latest click wins).
// DELETE /traces/:id/reaction — clear it.
traces.put("/:id/reaction", async (c) => {
  const user = c.get("user");
  const traceId = c.req.param("id");
  const db = getDb();

  if (!(await canReadTrace(db, traceId, user.id))) {
    return c.json({ ok: false, error: "Trace not found" }, 404);
  }

  let reaction: unknown;
  try {
    reaction = ((await c.req.json()) as { reaction?: unknown }).reaction;
  } catch {
    return c.json({ ok: false, error: "Body must be JSON" }, 400);
  }
  if (typeof reaction !== "string" || !(TRACE_REACTIONS as readonly string[]).includes(reaction)) {
    return c.json(
      { ok: false, error: `reaction must be one of: ${vocab(TRACE_REACTIONS)}` },
      400,
    );
  }

  await db.execute(sql`
    INSERT INTO claimnet.trace_reactions (trace_id, user_id, reaction)
    VALUES (${traceId}::uuid, ${user.id}::uuid, ${reaction})
    ON CONFLICT (trace_id, user_id)
    DO UPDATE SET reaction = ${reaction}, updated_at = NOW()
  `);

  return c.json({ ok: true, data: { reaction } });
});

traces.delete("/:id/reaction", async (c) => {
  const user = c.get("user");
  const traceId = c.req.param("id");
  const db = getDb();

  if (!(await canReadTrace(db, traceId, user.id))) {
    return c.json({ ok: false, error: "Trace not found" }, 404);
  }

  await db.execute(sql`
    DELETE FROM claimnet.trace_reactions
    WHERE trace_id = ${traceId}::uuid AND user_id = ${user.id}::uuid
  `);

  return c.json({ ok: true, data: { reaction: null } });
});

// PUT /traces/feedback/:feedbackId/star — star a feedback row ("mattered").
// DELETE — unstar. Row existence is the star; both are idempotent.
traces.put("/feedback/:feedbackId/star", async (c) => {
  const user = c.get("user");
  const feedbackId = c.req.param("feedbackId");
  const db = getDb();

  // ACL through the feedback row's trace — reader access required. Missing
  // feedback row and unreadable trace collapse to the same 404.
  const rows = await db.execute(sql`
    SELECT cf.id
    FROM claimnet.check_feedback cf
    JOIN claimnet.traces t ON t.id = cf.trace_id
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND gm.user_id = ${user.id}::uuid
    WHERE cf.id = ${feedbackId}::uuid
      AND (t.user_id = ${user.id}::uuid OR gm.user_id IS NOT NULL)
  `);
  if ((rows as unknown as Array<{ id: string }>).length === 0) {
    return c.json({ ok: false, error: "Feedback not found" }, 404);
  }

  await db.execute(sql`
    INSERT INTO claimnet.check_feedback_stars (feedback_id, user_id)
    VALUES (${feedbackId}::uuid, ${user.id}::uuid)
    ON CONFLICT (feedback_id, user_id) DO NOTHING
  `);

  return c.json({ ok: true, data: { starred: true } });
});

traces.delete("/feedback/:feedbackId/star", async (c) => {
  const user = c.get("user");
  const feedbackId = c.req.param("feedbackId");
  const db = getDb();

  await db.execute(sql`
    DELETE FROM claimnet.check_feedback_stars
    WHERE feedback_id = ${feedbackId}::uuid AND user_id = ${user.id}::uuid
  `);

  return c.json({ ok: true, data: { starred: false } });
});

// GET /traces/:id — single trace with full evidence and references
traces.get("/:id", async (c) => {
  const user = c.get("user");
  const traceId = c.req.param("id");
  const db = getDb();

  const traceRows = await db.execute(sql`
    SELECT
      t.id,
      t.claim_text AS "claimText",
      t.user_id AS "userId",
      t.group_id AS "groupId",
      t.api_key_id AS "apiKeyId",
      t.format_adherence_score AS "formatAdherenceScore",
      t.decided_at AS "decidedAt",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      g.name AS "groupName",
      ak.label AS "apiKeyLabel",
      u.email AS "userEmail",
      gm.role AS "viewerGroupRole"
    FROM claimnet.traces t
    LEFT JOIN claimnet.groups g ON g.id = t.group_id
    LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
    LEFT JOIN claimnet.users u ON u.id = t.user_id
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND gm.user_id = ${user.id}::uuid
    WHERE t.id = ${traceId}::uuid
      AND (t.user_id = ${user.id}::uuid OR gm.user_id IS NOT NULL)
  `);

  const trace = (traceRows as unknown as Record<string, unknown>[])[0];
  if (!trace) {
    return c.json({ ok: false, error: "Trace not found" }, 404);
  }

  const viewerGroupRole = trace["viewerGroupRole"] as string | null;
  const isTraceOwner = trace["userId"] === user.id;
  const isGroupAdmin = viewerGroupRole === "owner" || viewerGroupRole === "admin";
  const isSystem = user.role === "system";
  const canDelete = isTraceOwner || isGroupAdmin || isSystem;
  // Source gate only. Whether a given DESTINATION book will accept the recipe
  // is decided at move time against that book's membership — the UI can't know
  // it here, and asking would leak which books the trace could be moved into.
  const canMove = canDelete;

  // Get evidence. The trace_evidence.stance column is preserved for legacy
  // rows but no longer surfaced — the LLM author's stance assertion at write
  // time is what justifies stance, not anything the system can infer. Per
  // ADR-0015 we no longer write 'against' rows; legacy ones render as plain
  // evidence so the LLM consumer can re-evaluate stance against current
  // context if needed.
  const evidenceRows = await db.execute(sql`
    SELECT
      e.id,
      e.content,
      e.created_at AS "createdAt"
    FROM claimnet.evidence e
    JOIN claimnet.trace_evidence te ON te.evidence_id = e.id
    WHERE te.trace_id = ${traceId}::uuid
    ORDER BY te.created_at ASC
  `);

  // Get references — include file metadata so viewers can verify the recipe
  // against their own copy of the source artifact (we don't serve the file
  // itself; the filename + hash + ROI are the audit trail).
  const referenceRows = await db.execute(sql`
    SELECT
      r.id,
      r.quote,
      r.source,
      r.file_url AS "fileUrl",
      r.file_mime_type AS "fileMimeType",
      r.original_filename AS "originalFilename",
      r.file_hash AS "fileHash",
      r.region_meta AS "regionMeta",
      r.created_at AS "createdAt"
    FROM claimnet.references r
    JOIN claimnet.trace_references tr ON tr.reference_id = r.id
    WHERE tr.trace_id = ${traceId}::uuid
    ORDER BY tr.created_at ASC
  `);

  // Get evidence-reference links
  const evidenceRefRows = await db.execute(sql`
    SELECT
      er.evidence_id AS "evidenceId",
      er.reference_id AS "referenceId"
    FROM claimnet.evidence_references er
    WHERE er.evidence_id IN (
      SELECT te.evidence_id FROM claimnet.trace_evidence te
      WHERE te.trace_id = ${traceId}::uuid
    )
  `);

  // viewerGroupRole was used to derive canDelete; don't leak it in the payload.
  const { viewerGroupRole: _viewerGroupRole, ...tracePayload } = trace;

  return c.json({
    ok: true,
    data: {
      ...tracePayload,
      canDelete,
      canMove,
      evidence: evidenceRows,
      references: referenceRows,
      evidenceReferences: evidenceRefRows,
    },
  });
});

// PATCH /traces/:id — re-file a trace into a different recipe book.
//
// The complement of DELETE: deletion is the cleanup hatch for MALFORMED
// recipes (design-thinking.md §"Correcting the record"), so a correct recipe
// in the wrong book had no affordance until now — the only fix was to destroy
// it and check it again.
//
// Human-only, deliberately (recipes aaad8fdf, 4b97ba86). Agent-facing surfaces
// stay append-only and idempotent so an uncertain agent asks the human instead
// of proceeding on a thin assumption it means to correct later.
//
// Two ACL gates, unlike delete's one: authority to take a recipe OUT of a book
// says nothing about authority to put it INTO another.
traces.patch("/:id", async (c) => {
  const user = c.get("user");
  const traceId = c.req.param("id");
  const db = getDb();

  const body = await c.req
    .json<{ groupId?: string; story?: string; dropEvidenceIds?: string[] }>()
    .catch(() => ({}) as Record<string, never>);

  const destGroupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  if (!destGroupId) {
    return c.json({ ok: false, error: "groupId is required" }, 400);
  }

  const dropEvidenceIds = Array.isArray(body.dropEvidenceIds)
    ? body.dropEvidenceIds.filter((id): id is string => typeof id === "string")
    : [];

  // Source side: does the trace exist, and may this user move it out?
  const accessRows = await db.execute(sql`
    SELECT
      t.user_id AS "userId",
      t.group_id AS "groupId",
      t.claim_text AS "claimText",
      gm.role AS "sourceRole"
    FROM claimnet.traces t
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND gm.user_id = ${user.id}::uuid
    WHERE t.id = ${traceId}::uuid
  `);
  const access = (accessRows as unknown as Array<{
    userId: string; groupId: string; claimText: string; sourceRole: string | null;
  }>)[0];

  if (!access) return c.json({ ok: false, error: "Trace not found" }, 404);

  // Destination side: the user's role there, and the book's name for the
  // feedback row. A destination the user can't see resolves to no role, which
  // authorizeTraceMove rejects — so this never confirms a book's existence.
  const destRows = await db.execute(sql`
    SELECT g.name AS "name", gm.role AS "role"
    FROM claimnet.groups g
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = g.id AND gm.user_id = ${user.id}::uuid
    WHERE g.id = ${destGroupId}::uuid
  `);
  const dest = (destRows as unknown as Array<{ name: string; role: string | null }>)[0];

  const authz = authorizeTraceMove({
    isTraceOwner: access.userId === user.id,
    sourceRole: access.sourceRole,
    destRole: dest?.role ?? null,
    isSystem: user.role === "system",
  });

  if (!authz.allowed) {
    return c.json({ ok: false, error: "Forbidden", reason: authz.reason }, 403);
  }
  // A system user may move into a book they aren't a member of, but the book
  // still has to exist.
  if (!dest) return c.json({ ok: false, error: "Recipe book not found" }, 404);

  try {
    const result = await moveTraceToBook({
      db,
      traceId,
      destGroupId,
      destBookName: dest.name,
      actorUserId: user.id,
      dropEvidenceIds,
      story: body.story,
    });

    await writeAudit(db, {
      actorUserId: user.id,
      action: "trace.moved",
      targetType: "trace",
      targetId: traceId,
      metadata: {
        fromGroupId: result.fromGroupId,
        toGroupId: result.toGroupId,
        traceUserId: access.userId,
        claimText: access.claimText,
        actorRelation: authz.actorRelation,
        evidenceRedacted: result.evidenceRedacted,
        referencesRedacted: result.referencesRedacted,
      },
    });

    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof TraceMoveNotFoundError) {
      return c.json({ ok: false, error: "Trace not found" }, 404);
    }
    if (err instanceof TraceMoveSameBookError) {
      return c.json({ ok: false, error: "Trace is already in that recipe book" }, 400);
    }
    if (err instanceof TraceMoveEvidenceNotFoundError) {
      return c.json({ ok: false, error: "Unknown evidence entry" }, 400);
    }
    if (err instanceof TraceMoveDuplicateError) {
      // group_id is part of traces_api_key_group_claim_unique, so the identical
      // recipe from the same agent already lives in the destination.
      return c.json(
        { ok: false, error: "That recipe already exists in the destination recipe book" },
        409,
      );
    }
    throw err;
  }
});

// DELETE /traces/:id — hard-delete a trace + linkage. The vector_cache is
// preserved (content-hash keyed, no PII). Permission: trace owner, group
// owner/admin, or system role. The cleanup hatch for malformed recipes that
// pollute the corpus (e.g. agent-perspective phrasing). Outdated-but-correct
// recipes should NOT be deleted — temporal decay handles those (see
// docs/design-thinking.md §"Correcting the record").
traces.delete("/:id", async (c) => {
  const user = c.get("user");
  const traceId = c.req.param("id");
  const db = getDb();

  let reason: string | undefined;
  try {
    const body = (await c.req.json<{ reason?: string }>().catch(() => ({}))) as { reason?: string };
    reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
  } catch {
    reason = undefined;
  }

  const accessRows = await db.execute(sql`
    SELECT
      t.user_id AS "userId",
      t.group_id AS "groupId",
      t.claim_text AS "claimText",
      gm.role AS "viewerGroupRole"
    FROM claimnet.traces t
    LEFT JOIN claimnet.group_members gm
      ON gm.group_id = t.group_id AND gm.user_id = ${user.id}::uuid
    WHERE t.id = ${traceId}::uuid
  `);

  const access = (accessRows as unknown as Array<{
    userId: string; groupId: string; claimText: string; viewerGroupRole: string | null;
  }>)[0];

  if (!access) {
    return c.json({ ok: false, error: "Trace not found" }, 404);
  }

  const isTraceOwner = access.userId === user.id;
  const isGroupAdmin = access.viewerGroupRole === "owner" || access.viewerGroupRole === "admin";
  const isSystem = user.role === "system";

  if (!isTraceOwner && !isGroupAdmin && !isSystem) {
    return c.json({ ok: false, error: "Forbidden" }, 403);
  }

  const result = await deleteTraceCascade({
    db,
    traceId,
    actorUserId: user.id,
    ...(reason ? { reason } : {}),
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: "trace.deleted",
    targetType: "trace",
    targetId: traceId,
    metadata: {
      groupId: access.groupId,
      traceUserId: access.userId,
      claimText: access.claimText,
      actorRelation: isTraceOwner ? "owner" : isSystem ? "system" : "group_admin",
      ...(reason ? { reason } : {}),
      evidenceDeleted: result.evidenceDeleted,
      referencesDeleted: result.referencesDeleted,
    },
  });

  return c.json({ ok: true, data: result });
});

export { traces as traceRoutes };
