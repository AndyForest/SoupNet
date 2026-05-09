import { Hono } from "hono";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { sql } from "drizzle-orm";
import { runSearchPipeline } from "../services/search-pipeline";
import { deleteTraceCascade } from "../services/trace-delete.service";
import { writeAudit } from "../services/audit-log.service";

const traces = new Hono<AppEnv>();

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

  // Run pipeline with clustering + vectors
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

  return c.json({
    ok: true,
    data: {
      clusters,
      unclustered,
      conceptAxes,
      meta: {
        totalTraces: allTraces.length,
        tracesInScope: allTraces.length,
        k: clusters.length,
        searchMode: query ? result.searchMode : "corpus",
        vectorStrategy: strategy ?? "all",
      },
    },
  });
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
      evidence: evidenceRows,
      references: referenceRows,
      evidenceReferences: evidenceRefRows,
    },
  });
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
