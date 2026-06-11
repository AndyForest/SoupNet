import { Hono } from "hono";
import { z } from "zod";
import crypto from "crypto";
import { getDb } from "../db";
import { requireAuth, requireSystem, requireVerifiedEmail } from "../auth";
import { sql } from "drizzle-orm";
import {
  getAllSettings,
  setSetting,
  getVerifiedUserCount,
  getPendingInvitationCount,
} from "../services/system-settings.service";
import { QUEUE_DESCRIPTIONS, getQueueDescription } from "@soupnet/domain";
import { approveWaitlistedUser, promoteTopWaitlisted } from "../services/waitlist.service";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

// Rate limit admin invitations: 20 per hour per user
const inviteRateLimit = rateLimit({
  max: 20,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => c.get("user")?.id ?? "unknown",
});

const admin = new Hono<AppEnv>();

// All admin routes require system role + verified email (secure-by-default).
// Order: requireAuth → requireVerifiedEmail → requireSystem.
admin.use("/*", requireAuth, requireVerifiedEmail, requireSystem);

// GET /admin/organizations — list all orgs (system only)
admin.get("/organizations", async (c) => {
  const rows = await getDb().execute(sql`
    SELECT o.id, o.name, o.slug, o.is_personal, o.created_at,
           u.email as owner_email
    FROM claimnet.organizations o
    JOIN claimnet.users u ON u.id = o.owner_id
    ORDER BY o.created_at DESC
  `);
  return c.json({ ok: true, data: rows });
});

// GET /admin/settings — get system settings
admin.get("/settings", async (c) => {
  const db = getDb();
  const settings = await getAllSettings(db);
  const verifiedUsers = await getVerifiedUserCount(db);
  const pendingInvitations = await getPendingInvitationCount(db);

  return c.json({
    ok: true,
    data: {
      ...settings,
      currentUsers: verifiedUsers,
      pendingInvitations,
    },
  });
});

// PUT /admin/settings — update system settings
const updateSettingsSchema = z.object({
  signupCap: z.number().int().min(0).optional(),
  embeddingsEnabled: z.boolean().optional(),
});

admin.put("/settings", async (c) => {
  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const db = getDb();
  let promoted: string[] = [];
  if (parsed.data.signupCap !== undefined) {
    await setSetting(db, "signupCap", parsed.data.signupCap);

    // Raising the cap promotes the top of the waitlist automatically:
    // verified accounts only, invitation-holders first, then oldest-first.
    // Each promotion sends the "you're in" email. Under the signup_cap
    // advisory lock (inside a transaction) so concurrent registrations
    // can't double-spend the new headroom.
    promoted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('signup_cap'))`);
      const verified = await getVerifiedUserCount(tx as unknown as Parameters<typeof getVerifiedUserCount>[0]);
      const pending = await getPendingInvitationCount(tx as unknown as Parameters<typeof getPendingInvitationCount>[0]);
      const headroom = parsed.data.signupCap! - verified - pending;
      return promoteTopWaitlisted(tx as unknown as Parameters<typeof promoteTopWaitlisted>[0], headroom);
    });
  }
  if (parsed.data.embeddingsEnabled !== undefined) {
    await setSetting(db, "embeddingsEnabled", parsed.data.embeddingsEnabled);
  }

  const settings = await getAllSettings(db);
  return c.json({ ok: true, data: { ...settings, promoted } });
});

// POST /admin/invite — system admin creates a full cap-bypass invitation by
// email. groupId is optional (old idea — recipe-book membership can be
// granted separately); groupless invitations exist purely to let the email
// register past the cap and are stamped accepted at registration.
//
// Deliberately does NOT send email. The admin gets the invite URL back and
// shares it through their own channel — consistent with the spam-safe
// invitation design (ADR-0016 "no emails to non-users"; the previous
// auto-send here predated the operator deciding it wasn't needed).
const inviteSchema = z.object({
  email: z.string().email(),
  groupId: z.string().uuid().optional(),
});

admin.post("/invite", inviteRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const email = parsed.data.email.toLowerCase().trim();
  const { groupId } = parsed.data;
  const user = c.get("user");
  const db = getDb();

  // Check if user already exists
  const existingUser = await db.execute(sql`
    SELECT id FROM claimnet.users WHERE email = ${email} LIMIT 1
  `);
  if ((existingUser as unknown[]).length > 0) {
    return c.json({ ok: false, error: "User already exists" }, 409);
  }

  if (groupId) {
    const groupRows = await db.execute(sql`
      SELECT name FROM claimnet.groups WHERE id = ${groupId}::uuid LIMIT 1
    `);
    if (!(groupRows as unknown[]).length) {
      return c.json({ ok: false, error: "Group not found" }, 404);
    }
  }

  // Create invitation with cap bypass
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.execute(sql`
    INSERT INTO claimnet.invitations (inviter_id, group_id, email, token, bypass_cap, expires_at)
    VALUES (${user.id}::uuid, ${groupId ?? null}::uuid, ${email}, ${token}, true, ${expiresAt.toISOString()}::timestamptz)
  `);

  const inviteUrl = `${process.env["FRONTEND_URL"] ?? "https://soup.net"}/auth/register?invite=${token}`;

  return c.json({
    ok: true,
    data: { email, groupId: groupId ?? null, inviteUrl, expiresAt: expiresAt.toISOString() },
  });
});

// GET /admin/users — list users (paginated, filtered, sortable).
// Query params:
//   q?            — case-insensitive email search
//   verified?     — "yes" | "no"
//   role?         — exact match (e.g. "tenant", "system")
//   hasKeys?      — "yes" | "no" (at least one active, non-expired key)
//   suspended?    — "yes" | "no"
//   sortBy?       — createdAt | lastLoginAt | email  (default createdAt)
//   sortDir?      — asc | desc  (default desc)
//   limit?        — default 50, max 200
//   offset?       — default 0
admin.get("/users", async (c) => {
  const db = getDb();

  const q = c.req.query("q")?.trim() ?? "";
  const verified = c.req.query("verified");
  const role = c.req.query("role");
  const hasKeys = c.req.query("hasKeys");
  const suspended = c.req.query("suspended");
  const sortBy = c.req.query("sortBy") ?? "createdAt";
  const sortDir = c.req.query("sortDir") === "asc" ? "asc" : "desc";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const sortColumnMap: Record<string, string> = {
    createdAt: "u.created_at",
    lastLoginAt: "u.last_login_at",
    email: "u.email",
  };
  const sortColumn = sortColumnMap[sortBy] ?? "u.created_at";

  const where = [sql`1=1`];
  if (q) where.push(sql`u.email ILIKE ${"%" + q + "%"}`);
  if (verified === "yes") where.push(sql`u.email_verified_at IS NOT NULL`);
  if (verified === "no") where.push(sql`u.email_verified_at IS NULL`);
  if (role) where.push(sql`u.role = ${role}`);
  if (suspended === "yes") where.push(sql`u.suspended_at IS NOT NULL`);
  if (suspended === "no") where.push(sql`u.suspended_at IS NULL`);
  const waitlisted = c.req.query("waitlisted");
  if (waitlisted === "yes") where.push(sql`u.waitlisted_at IS NOT NULL`);
  if (waitlisted === "no") where.push(sql`u.waitlisted_at IS NULL`);
  if (hasKeys === "yes") {
    where.push(sql`EXISTS (
      SELECT 1 FROM claimnet.api_keys ak
      WHERE ak.user_id = u.id AND ak.expires_at > now()
    )`);
  }
  if (hasKeys === "no") {
    where.push(sql`NOT EXISTS (
      SELECT 1 FROM claimnet.api_keys ak
      WHERE ak.user_id = u.id AND ak.expires_at > now()
    )`);
  }
  const whereClause = sql.join(where, sql` AND `);
  const orderClause = sql.raw(`${sortColumn} ${sortDir.toUpperCase()} NULLS LAST`);

  const rows = await db.execute(sql`
    SELECT
      u.id,
      u.email,
      u.role,
      u.email_verified_at  AS "emailVerifiedAt",
      u.suspended_at       AS "suspendedAt",
      u.suspended_reason   AS "suspendedReason",
      u.waitlisted_at      AS "waitlistedAt",
      u.signup_reason      AS "signupReason",
      u.last_login_at      AS "lastLoginAt",
      u.created_at         AS "createdAt",
      (SELECT COUNT(*)::int FROM claimnet.api_keys ak
        WHERE ak.user_id = u.id AND ak.expires_at > now())
                           AS "activeKeyCount",
      (SELECT COUNT(*)::int FROM claimnet.traces t WHERE t.user_id = u.id)
                           AS "recipeCount",
      (SELECT COUNT(*)::int FROM claimnet.group_members gm WHERE gm.user_id = u.id)
                           AS "groupCount"
    FROM claimnet.users u
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM claimnet.users u WHERE ${whereClause}
  `);
  const total = (countRows as unknown as Array<{ total: number }>)[0]?.total ?? 0;

  return c.json({
    ok: true,
    data: { users: rows, total, limit, offset, sortBy, sortDir, queriedAt: new Date().toISOString() },
  });
});

// GET /admin/stats — top-line numbers for the admin landing + user-management header
admin.get("/stats", async (c) => {
  const db = getDb();
  const statsRows = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM claimnet.users)                                                   AS "totalUsers",
      (SELECT COUNT(*)::int FROM claimnet.users WHERE email_verified_at IS NOT NULL)               AS "verifiedUsers",
      (SELECT COUNT(*)::int FROM claimnet.users WHERE suspended_at IS NOT NULL)                    AS "suspendedUsers",
      (SELECT COUNT(*)::int FROM claimnet.traces)                                                  AS "totalRecipes",
      (SELECT COUNT(*)::int FROM claimnet.traces WHERE created_at > now() - interval '24 hours')   AS "recipes24h",
      (SELECT COUNT(*)::int FROM claimnet.traces WHERE created_at > now() - interval '7 days')     AS "recipes7d",
      (SELECT COUNT(*)::int FROM claimnet.groups)                                                  AS "totalGroups",
      (SELECT COUNT(*)::int FROM claimnet.api_keys WHERE expires_at > now())                      AS "activeApiKeys",
      (SELECT COUNT(*)::int FROM claimnet.users WHERE created_at > now() - interval '7 days')      AS "registrations7d",
      (SELECT COUNT(*)::int FROM claimnet.invitations WHERE accepted_at IS NULL AND expires_at > now()) AS "pendingInvitations"
  `);
  const row = (statsRows as unknown as Array<Record<string, number>>)[0] ?? {};

  const signupCap = await getAllSettings(db).then((s) => s.signupCap);
  const verifiedUsers = await getVerifiedUserCount(db);

  return c.json({
    ok: true,
    data: {
      ...row,
      signupCap,
      signupCapUsed: verifiedUsers,
      queriedAt: new Date().toISOString(),
    },
  });
});

// GET /admin/queues — pg-boss data model overview
// Top-level: row counts of each pgboss table. Drill in via /admin/queues/jobs.
admin.get("/queues", async (c) => {
  const db = getDb();

  // pg-boss table sizes — the primary data model overview
  const tableCountsRows = await db.execute(sql`
    SELECT 'queue' AS table_name, COUNT(*)::int AS row_count FROM pgboss.queue
    UNION ALL
    SELECT 'job', COUNT(*)::int FROM pgboss.job
    UNION ALL
    SELECT 'archive', COUNT(*)::int FROM pgboss.archive
    UNION ALL
    SELECT 'schedule', COUNT(*)::int FROM pgboss.schedule
    UNION ALL
    SELECT 'subscription', COUNT(*)::int FROM pgboss.subscription
  `);

  // All registered queues with their config
  const queues = await db.execute(sql`
    SELECT q.name, q.policy, q.retry_limit AS "retryLimit", q.retry_delay AS "retryDelay",
           q.retry_backoff AS "retryBackoff", q.expire_seconds AS "expireSeconds",
           q.retention_minutes AS "retentionMinutes", q.dead_letter AS "deadLetter",
           q.created_on AS "createdOn", q.updated_on AS "updatedOn",
           COALESCE(j.job_count, 0)::int AS "jobCount"
    FROM pgboss.queue q
    LEFT JOIN (
      SELECT name, COUNT(*)::int AS job_count FROM pgboss.job GROUP BY name
    ) j ON j.name = q.name
    ORDER BY q.name
  `);

  // Job state distribution (across all queues, for the overview)
  const stateDistribution = await db.execute(sql`
    SELECT state, COUNT(*)::int AS count
    FROM pgboss.job
    GROUP BY state
    ORDER BY count DESC
  `);

  // Cron schedules
  const schedules = await db.execute(sql`
    SELECT name, cron, timezone, data, options, created_on AS "createdOn", updated_on AS "updatedOn"
    FROM pgboss.schedule
    ORDER BY name
  `);

  // ── Health metrics ──────────────────────────────────────────────

  // Currently active: jobs in 'active' state, grouped by queue
  const currentlyActive = await db.execute(sql`
    SELECT name, COUNT(*)::int AS count,
           MIN(started_on) AS "oldestStartedOn"
    FROM pgboss.job
    WHERE state = 'active'
    GROUP BY name
    ORDER BY count DESC
  `);

  // Backlog age per queue: oldest waiting (created/retry) job
  const backlogAge = await db.execute(sql`
    SELECT name,
           COUNT(*)::int AS "backlogCount",
           MIN(created_on) AS "oldestPending"
    FROM pgboss.job
    WHERE state IN ('created', 'retry')
    GROUP BY name
    ORDER BY MIN(created_on) ASC
  `);

  // Avg / p95 completion time per queue (last 100 completed jobs each)
  const completionTimes = await db.execute(sql`
    WITH recent AS (
      SELECT name,
             EXTRACT(EPOCH FROM (completed_on - started_on)) * 1000 AS duration_ms,
             ROW_NUMBER() OVER (PARTITION BY name ORDER BY completed_on DESC) AS rn
      FROM pgboss.job
      WHERE state = 'completed'
        AND completed_on IS NOT NULL
        AND started_on IS NOT NULL
    )
    SELECT name,
           COUNT(*)::int AS "sampleSize",
           AVG(duration_ms)::int AS "avgMs",
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS "p95Ms"
    FROM recent
    WHERE rn <= 100
    GROUP BY name
    ORDER BY name
  `);

  // Recent failures: failed jobs in the last hour, grouped by queue
  const recentFailures = await db.execute(sql`
    SELECT name, COUNT(*)::int AS count
    FROM pgboss.job
    WHERE state = 'failed'
      AND completed_on > now() - interval '1 hour'
    GROUP BY name
    ORDER BY count DESC
  `);

  return c.json({
    ok: true,
    data: {
      tableCounts: tableCountsRows,
      queues,
      stateDistribution,
      schedules,
      currentlyActive,
      backlogAge,
      completionTimes,
      recentFailures,
      queueDescriptions: QUEUE_DESCRIPTIONS,
      queriedAt: new Date().toISOString(),
    },
  });
});

// GET /admin/queues/jobs — paginated job explorer
// Query params:
//   queue?       - filter by queue name
//   state?       - filter by job state
//   from?        - ISO datetime, filter created_on >=
//   to?          - ISO datetime, filter created_on <=
//   sortBy?      - createdOn | startedOn | completedOn (default createdOn)
//   sortDir?     - asc | desc (default desc)
//   limit?       - default 50, max 200
//   offset?      - default 0
admin.get("/queues/jobs", async (c) => {
  const db = getDb();
  const queueFilter = c.req.query("queue");
  const stateFilter = c.req.query("state");
  const fromFilter = c.req.query("from");
  const toFilter = c.req.query("to");
  const sortBy = c.req.query("sortBy") ?? "createdOn";
  const sortDir = c.req.query("sortDir") === "asc" ? "asc" : "desc";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  // Whitelist sort columns to prevent SQL injection
  const sortColumnMap: Record<string, string> = {
    createdOn: "created_on",
    startedOn: "started_on",
    completedOn: "completed_on",
  };
  const sortColumn = sortColumnMap[sortBy] ?? "created_on";

  const whereConditions = [sql`1=1`];
  if (queueFilter) whereConditions.push(sql`name = ${queueFilter}`);
  if (stateFilter) whereConditions.push(sql`state = ${stateFilter}::pgboss.job_state`);
  if (fromFilter) whereConditions.push(sql`created_on >= ${fromFilter}::timestamptz`);
  if (toFilter) whereConditions.push(sql`created_on <= ${toFilter}::timestamptz`);

  const whereClause = sql.join(whereConditions, sql` AND `);
  const orderClause = sql.raw(`${sortColumn} ${sortDir.toUpperCase()} NULLS LAST`);

  const jobs = await db.execute(sql`
    SELECT id, name, state, priority,
           retry_count AS "retryCount", retry_limit AS "retryLimit",
           created_on AS "createdOn", started_on AS "startedOn", completed_on AS "completedOn",
           keep_until AS "keepUntil", expire_in AS "expireIn",
           singleton_key AS "singletonKey",
           dead_letter AS "deadLetter", policy,
           data, output
    FROM pgboss.job
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM pgboss.job
    WHERE ${whereClause}
  `);
  const total = (countRows as unknown as Array<{ total: number }>)[0]?.total ?? 0;

  return c.json({
    ok: true,
    data: { jobs, total, limit, offset, sortBy, sortDir, queriedAt: new Date().toISOString() },
  });
});

// GET /admin/queues/jobs/:id — single job detail (full data + output)
admin.get("/queues/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT id, name, state, priority,
           retry_count AS "retryCount", retry_limit AS "retryLimit",
           retry_delay AS "retryDelay", retry_backoff AS "retryBackoff",
           start_after AS "startAfter", started_on AS "startedOn",
           singleton_key AS "singletonKey", singleton_on AS "singletonOn",
           expire_in AS "expireIn", created_on AS "createdOn",
           completed_on AS "completedOn", keep_until AS "keepUntil",
           dead_letter AS "deadLetter", policy,
           data, output
    FROM pgboss.job
    WHERE id = ${id}::uuid
    LIMIT 1
  `);

  const job = (rows as unknown as Array<{ name: string }>)[0];
  if (!job) {
    return c.json({ ok: false, error: "Job not found" }, 404);
  }

  const queueDescription = getQueueDescription(job.name);

  return c.json({ ok: true, data: { job, queueDescription } });
});

// GET /admin/workers/embeddings — embedding pipeline dashboard
admin.get("/workers/embeddings", async (c) => {
  const db = getDb();

  // Embedding vector status by strategy
  const vectorStats = await db.execute(sql`
    SELECT ecs.strategy_id, ev.status, COUNT(*)::int AS count
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    GROUP BY ecs.strategy_id, ev.status
    ORDER BY ecs.strategy_id, ev.status
  `);

  // Trace coverage by strategy
  const traceCoverage = await db.execute(sql`
    SELECT ecs.strategy_id, COUNT(DISTINCT es.source_id)::int AS traces_with_strategy
    FROM claimnet.embedding_chunk_strategies ecs
    JOIN claimnet.embedding_sources es ON es.id = ecs.embedding_source_id
    WHERE es.source_type = 'trace'
    GROUP BY ecs.strategy_id
    ORDER BY ecs.strategy_id
  `);

  // Total trace count for comparison
  const totalTracesRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM claimnet.traces
  `);
  const totalTraces = (totalTracesRows as unknown as Array<{ total: number }>)[0]?.total ?? 0;

  // Recent failed vectors with error + retry_count
  const failedVectors = await db.execute(sql`
    SELECT ev.id, ev.error, ev.retry_count AS "retryCount",
           ev.updated_at AS "updatedAt",
           ecs.strategy_id AS "strategyId"
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    WHERE ev.status = 'failed'
    ORDER BY ev.updated_at DESC
    LIMIT 50
  `);

  // Error grouping: cluster failed vectors by error message
  const errorGrouping = await db.execute(sql`
    SELECT
      COALESCE(ev.error, '(no error message)') AS error,
      COUNT(*)::int AS count,
      MAX(ev.updated_at) AS "lastSeen",
      ARRAY_AGG(DISTINCT ecs.strategy_id) AS strategies
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    WHERE ev.status = 'failed'
    GROUP BY ev.error
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `);

  // Stuck processing vectors (>5 min in 'processing')
  const stuckProcessing = await db.execute(sql`
    SELECT ev.id, ev.retry_count AS "retryCount",
           ev.updated_at AS "updatedAt",
           ecs.strategy_id AS "strategyId",
           EXTRACT(EPOCH FROM (now() - ev.updated_at))::int AS "ageSeconds"
    FROM claimnet.embedding_vectors ev
    JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
    JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
    WHERE ev.status = 'processing'
      AND ev.updated_at < now() - interval '5 minutes'
    ORDER BY ev.updated_at ASC
    LIMIT 50
  `);

  return c.json({
    ok: true,
    data: {
      vectorStats,
      traceCoverage,
      totalTraces,
      failedVectors,
      errorGrouping,
      stuckProcessing,
      queriedAt: new Date().toISOString(),
    },
  });
});

// POST /admin/workers/embeddings/retry/:vectorId — manual retry of a single failed vector
admin.post("/workers/embeddings/retry/:vectorId", async (c) => {
  const vectorId = c.req.param("vectorId");
  if (!vectorId) {
    return c.json({ ok: false, error: "vectorId required" }, 400);
  }

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE claimnet.embedding_vectors
    SET status = 'pending',
        retry_count = retry_count + 1,
        error = NULL,
        updated_at = now()
    WHERE id = ${vectorId}::uuid
      AND status = 'failed'
    RETURNING id, retry_count
  `);

  const rows = result as unknown as Array<{ id: string; retry_count: number }>;
  if (rows.length === 0) {
    return c.json({ ok: false, error: "Vector not found or not in failed state" }, 404);
  }

  return c.json({
    ok: true,
    data: { id: rows[0]!.id, retryCount: rows[0]!.retry_count },
  });
});

// POST /admin/workers/embeddings/retry-all/:strategyId — bulk retry all failed vectors for a strategy
admin.post("/workers/embeddings/retry-all/:strategyId", async (c) => {
  const strategyId = c.req.param("strategyId");
  if (!strategyId) {
    return c.json({ ok: false, error: "strategyId required" }, 400);
  }

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE claimnet.embedding_vectors ev
    SET status = 'pending',
        retry_count = ev.retry_count + 1,
        error = NULL,
        updated_at = now()
    FROM claimnet.embedding_chunks ec, claimnet.embedding_chunk_strategies ecs
    WHERE ev.embedding_chunk_id = ec.id
      AND ec.chunk_strategy_id = ecs.id
      AND ecs.strategy_id = ${strategyId}
      AND ev.status = 'failed'
    RETURNING ev.id
  `);

  const count = (result as unknown as Array<{ id: string }>).length;
  return c.json({ ok: true, data: { strategyId, retriedCount: count } });
});

// GET /admin/waitlist — the signup queue, in line order.
//
// One row per email wanting in, from two sources:
//   - waitlisted accounts (type 'waitlist'; real user rows with
//     waitlisted_at set — carry signup_reason + verified state)
//   - pending invitations for emails with NO user record yet (type
//     'admin_invite' for bypass_cap, 'member_invite' otherwise) — these
//     people haven't registered, so there's nothing to approve; the row is
//     visibility into who's been offered a way in.
//
// Ordering reflects "an invite puts you at the top of the waitlist":
// rows holding a live invitation first, then by created_at (oldest first).
// Approved accounts leave the queue (waitlisted_at cleared → not selected).
admin.get("/waitlist", async (c) => {
  const rows = await getDb().execute(sql`
    WITH merged AS (
      SELECT
        u.id,
        u.email,
        'waitlist' AS "type",
        u.signup_reason AS "reason",
        NULL::text AS "inviterEmail",
        (u.email_verified_at IS NOT NULL) AS "verified",
        u.created_at AS "createdAt"
      FROM claimnet.users u
      WHERE u.waitlisted_at IS NOT NULL

      UNION ALL

      SELECT
        i.id,
        i.email,
        CASE WHEN i.bypass_cap THEN 'admin_invite' ELSE 'member_invite' END AS "type",
        NULL::text AS "reason",
        inviter.email AS "inviterEmail",
        false AS "verified",
        i.created_at AS "createdAt"
      FROM claimnet.invitations i
      JOIN claimnet.users inviter ON inviter.id = i.inviter_id
      WHERE i.accepted_at IS NULL
        AND i.declined_at IS NULL
        AND i.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM claimnet.users u2 WHERE u2.email = i.email)
    )
    SELECT * FROM (
      SELECT
        m.*,
        EXISTS (
          SELECT 1 FROM claimnet.invitations i2
          WHERE i2.email = m.email
            AND i2.accepted_at IS NULL
            AND i2.declined_at IS NULL
            AND i2.expires_at > now()
        ) AS "invitePending"
      FROM merged m
    ) q
    ORDER BY q."invitePending" DESC, q."createdAt" ASC
  `);
  return c.json({ ok: true, data: rows });
});

// POST /admin/waitlist/:userId/approve — clear the waitlist flag on one
// account and send the "you're in" email. Admin power: works regardless of
// cap state (the manual counterpart of bypass invitations) and regardless
// of verification (an unverified approvee still lands in the normal
// verify-pending flow at login).
admin.post("/waitlist/:userId/approve", async (c) => {
  const userId = c.req.param("userId");
  const actor = c.get("user");

  const email = await approveWaitlistedUser(getDb(), userId, actor.id);
  if (!email) {
    return c.json({ ok: false, error: "User not found or not waitlisted" }, 404);
  }
  return c.json({ ok: true, data: { email, approvedAt: new Date().toISOString() } });
});

// GET /admin/emails — the outgoing email log (light CRM + abuse/security
// review surface). Metadata only — bodies are never stored. 60-day retention
// enforced by the logged sender.
// Query params:
//   q?        — case-insensitive recipient search
//   kind?     — exact kind match (verification, password_reset, …)
//   status?   — "sent" | "failed"
//   sortDir?  — asc | desc by created_at (default desc)
//   limit?    — default 50, max 200
//   offset?   — default 0
admin.get("/emails", async (c) => {
  const db = getDb();
  const q = c.req.query("q")?.trim() ?? "";
  const kind = c.req.query("kind")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const sortDir = c.req.query("sortDir") === "asc" ? "asc" : "desc";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const where = [sql`1=1`];
  if (q) where.push(sql`to_email ILIKE ${"%" + q + "%"}`);
  if (kind) where.push(sql`kind = ${kind}`);
  if (status) where.push(sql`status = ${status}`);
  const whereClause = sql.join(where, sql` AND `);
  const orderClause = sql.raw(`created_at ${sortDir.toUpperCase()}`);

  const rows = await db.execute(sql`
    SELECT id, to_email AS "toEmail", kind, subject, status, error,
           created_at AS "createdAt"
    FROM claimnet.email_log
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM claimnet.email_log WHERE ${whereClause}
  `);
  const total = (countRows as unknown as Array<{ total: number }>)[0]?.total ?? 0;

  return c.json({
    ok: true,
    data: { emails: rows, total, limit, offset, sortDir, queriedAt: new Date().toISOString() },
  });
});

// GET /admin/invitations — list pending invitations
admin.get("/invitations", async (c) => {
  const rows = await getDb().execute(sql`
    SELECT
      i.id, i.email, i.bypass_cap AS "bypassCap",
      i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt", i.created_at AS "createdAt",
      g.name AS "groupName",
      u.email AS "inviterEmail"
    FROM claimnet.invitations i
    LEFT JOIN claimnet.groups g ON g.id = i.group_id
    JOIN claimnet.users u ON u.id = i.inviter_id
    ORDER BY i.created_at DESC
    LIMIT 100
  `);
  return c.json({ ok: true, data: rows });
});

export { admin as adminRoutes };
