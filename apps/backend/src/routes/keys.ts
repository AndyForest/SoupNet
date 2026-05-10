import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { generateDailyKey, generateScopedKey, listKeys, revokeKey } from "../services/api-key.service";
import { rateLimit } from "../middleware/rate-limit";
import { sql } from "drizzle-orm";
import { BRIEFING_MCP, BRIEFING_WEB } from "@soupnet/domain";

const scopedKeySchema = z.object({
  readGroupIds: z.array(z.string().uuid()).min(1),
  writeGroupIds: z.array(z.string().uuid()).min(1),
  defaultWriteGroupId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  label: z.string().max(100).optional(),
});

// Rate limit key generation: 10 per hour per user
const keyGenRateLimit = rateLimit({
  max: 10,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => c.get("user")?.id ?? "unknown",
});

const keys = new Hono<AppEnv>();

// Secure-by-default: every JWT-authed router requires verified email.
// See routes/auth.ts for the (very small) opt-out list of routes that must
// remain reachable for unverified users (/auth/me, /auth/resend-verification).
keys.use("/*", requireAuth, requireVerifiedEmail);

// POST /keys/daily
// Optional body: { writeGroupId?: string } — scopes write to a single group
// (explicit override). Without writeGroupId, the user's configured
// daily_read / daily_write group_members flags determine the defaults. New
// groups default to excluded from both; existing memberships were
// grandfathered to included by migration 0016. See design-thinking.md
// §Configurable defaults for the "daily agent link" buttons.
keys.post("/daily", keyGenRateLimit, async (c) => {
  const user = c.get("user");
  const db = getDb();

  // Pull the user's memberships with their daily-link preferences.
  const membershipRows = await db.execute(sql`
    SELECT gm.group_id AS "groupId", gm.daily_read AS "dailyRead", gm.daily_write AS "dailyWrite"
    FROM claimnet.group_members gm
    WHERE gm.user_id = ${user.id}::uuid
  `);
  const memberships = membershipRows as unknown as Array<{
    groupId: string;
    dailyRead: boolean;
    dailyWrite: boolean;
  }>;
  if (memberships.length === 0) {
    return c.json({ ok: false, error: "No group memberships found" }, 400);
  }

  const allGroupIds = memberships.map((m) => m.groupId);
  const configuredReadGroupIds = memberships.filter((m) => m.dailyRead).map((m) => m.groupId);
  const configuredWriteGroupIds = memberships.filter((m) => m.dailyWrite).map((m) => m.groupId);

  // Optional: scope write to a single group (explicit override).
  let writeGroupIds: string[];
  let defaultWriteGroupId: string | undefined;
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch { /* no body or invalid JSON — use configured defaults */ }

  if (typeof body["writeGroupId"] === "string") {
    const wgId = body["writeGroupId"];
    if (!allGroupIds.includes(wgId)) {
      return c.json({ ok: false, error: "writeGroupId must be a group you are a member of" }, 400);
    }
    writeGroupIds = [wgId];
    defaultWriteGroupId = wgId;
  } else if (configuredWriteGroupIds.length > 0) {
    writeGroupIds = configuredWriteGroupIds;
    defaultWriteGroupId = configuredWriteGroupIds[0];
  } else {
    // No write groups configured and no override — the key would be read-only,
    // which breaks the "open recipe check page" action. Surface a clear error
    // so the UI can point the user at the Groups page to opt a group in.
    return c.json({
      ok: false,
      error: "no_write_groups_configured",
      message: "No groups are configured for daily-agent writes. Open the Groups page and include at least one group in writes, or pass writeGroupId explicitly.",
    }, 400);
  }

  // Read scope: configured daily_read set, or fall back to all memberships
  // when the user has none configured. The fallback matters only for users
  // created before migration 0016 who then toggled everything off; new users
  // get grandfathered state.
  const readGroupIds = configuredReadGroupIds.length > 0 ? configuredReadGroupIds : allGroupIds;

  const result = await generateDailyKey(db, user.id, readGroupIds, writeGroupIds, defaultWriteGroupId);
  return c.json({ ok: true, data: result });
});

// POST /keys/scoped
keys.post("/scoped", keyGenRateLimit, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = scopedKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const { readGroupIds, writeGroupIds, defaultWriteGroupId, expiresAt, label } = parsed.data;

  // Validate defaultWriteGroupId is in writeGroupIds
  if (!writeGroupIds.includes(defaultWriteGroupId)) {
    return c.json({ ok: false, error: "defaultWriteGroupId must be in writeGroupIds" }, 400);
  }

  // Validate expiresAt is in the future and not more than 1 year out
  const expiresDate = new Date(expiresAt);
  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  if (expiresDate <= now) {
    return c.json({ ok: false, error: "expiresAt must be in the future" }, 400);
  }
  if (expiresDate > oneYearFromNow) {
    return c.json({ ok: false, error: "expiresAt cannot be more than 1 year in the future" }, 400);
  }

  // Verify user is a member of all requested groups (both read and write)
  const allGroupIds = [...new Set([...readGroupIds, ...writeGroupIds])];
  const db = getDb();
  const memberGroups = await db.execute(sql`
    SELECT group_id FROM claimnet.group_members
    WHERE user_id = ${user.id}::uuid
      AND group_id IN (${sql.join(allGroupIds.map(g => sql`${g}::uuid`), sql`, `)})
  `);
  const memberGroupIds = new Set((memberGroups as unknown as Array<{ group_id: string }>).map(r => r.group_id));
  const unauthorized = allGroupIds.filter(g => !memberGroupIds.has(g));
  if (unauthorized.length > 0) {
    return c.json({ ok: false, error: "Not a member of all requested groups" }, 403);
  }

  const result = await generateScopedKey(db, user.id, {
    readGroupIds,
    writeGroupIds,
    defaultWriteGroupId,
    expiresAt: expiresDate,
    ...(label ? { label } : {}),
  });
  return c.json({ ok: true, data: result });
});

// GET /keys
keys.get("/", async (c) => {
  const user = c.get("user");
  const result = await listKeys(getDb(), user.id);
  return c.json({ ok: true, data: result });
});

// DELETE /keys/:id
keys.delete("/:id", async (c) => {
  const user = c.get("user");
  const keyId = c.req.param("id");
  const deleted = await revokeKey(getDb(), keyId, user.id);
  return c.json({ ok: true, data: { deleted } });
});

// GET /keys/briefing?type=mcp|web&key=<raw-key>
// Returns the agent briefing text with real group data filled in
keys.get("/briefing", async (c) => {
  const user = c.get("user");
  const briefingType = c.req.query("type") ?? "mcp";
  const rawKey = c.req.query("key");

  if (!rawKey) {
    return c.json({ ok: false, error: "key parameter is required" }, 400);
  }

  const db = getDb();

  // Look up key's group access
  const keyRows = await db.execute(sql`
    SELECT read_group_ids, write_group_ids, default_write_group_id
    FROM claimnet.api_keys
    WHERE user_id = ${user.id}::uuid
      AND key_prefix = ${rawKey.slice(0, 8)}
      AND expires_at > NOW()
    LIMIT 1
  `);

  const keyRow = (keyRows as unknown as Array<{
    read_group_ids: string[];
    write_group_ids: string[];
    default_write_group_id: string;
  }>)[0];

  if (!keyRow) {
    return c.json({ ok: false, error: "Key not found or expired" }, 404);
  }

  // Get group details
  const allIds = [...new Set([...keyRow.read_group_ids, ...keyRow.write_group_ids])];
  const groupRows = allIds.length > 0
    ? await db.execute(sql`
        SELECT id, slug, name, description FROM claimnet.groups
        WHERE id IN (${sql.join(allIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY name
      `)
    : [];

  const groups = (groupRows as unknown as Array<{ id: string; slug: string; name: string; description: string | null }>).map((g) => ({
    slug: g.slug,
    name: g.name,
    description: g.description,
    canWrite: keyRow.write_group_ids.includes(g.id),
    isDefault: g.id === keyRow.default_write_group_id,
  }));

  const backendUrl = process.env["BACKEND_URL"] ?? "http://localhost:3101";
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5273";
  const checkUrl = `${backendUrl}/check?key=${encodeURIComponent(rawKey)}`;

  const text = briefingType === "web"
    ? BRIEFING_WEB.build(checkUrl, rawKey, groups)
    : BRIEFING_MCP.build(rawKey, backendUrl, frontendUrl, groups);

  return c.json({ ok: true, data: { text, type: briefingType } });
});

export { keys as keyRoutes };
