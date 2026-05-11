import { Hono } from "hono";
import { z } from "zod";
import crypto from "node:crypto";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { generateDailyKey, generateScopedKey, listKeys, revokeKey } from "../services/api-key.service";
import { rateLimit } from "../middleware/rate-limit";
import { sql } from "drizzle-orm";
import { BRIEFING_MCP, BRIEFING_WEB } from "@soupnet/domain";

// C1 — recipe-book rename. Wire-format field names use the new "recipe book"
// vocabulary. Internal TS variables and DB columns keep the schema-level
// `groupIds` naming per the schema deferral (see ADR backlog item).
const scopedKeySchema = z.object({
  readRecipeBookIds: z.array(z.string().uuid()).min(1),
  writeRecipeBookIds: z.array(z.string().uuid()).min(1),
  defaultWriteRecipeBookId: z.string().uuid(),
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
    return c.json({ ok: false, error: "No recipe book memberships found" }, 400);
  }

  const allGroupIds = memberships.map((m) => m.groupId);
  const configuredReadGroupIds = memberships.filter((m) => m.dailyRead).map((m) => m.groupId);
  const configuredWriteGroupIds = memberships.filter((m) => m.dailyWrite).map((m) => m.groupId);

  // Optional: scope write to a single recipe book (explicit override).
  // Wire-format field name: writeRecipeBookId.
  let writeGroupIds: string[];
  let defaultWriteGroupId: string | undefined;
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch { /* no body or invalid JSON — use configured defaults */ }

  if (typeof body["writeRecipeBookId"] === "string") {
    const wgId = body["writeRecipeBookId"];
    if (!allGroupIds.includes(wgId)) {
      return c.json({ ok: false, error: "writeRecipeBookId must be a recipe book you are a member of" }, 400);
    }
    writeGroupIds = [wgId];
    defaultWriteGroupId = wgId;
  } else if (configuredWriteGroupIds.length > 0) {
    writeGroupIds = configuredWriteGroupIds;
    defaultWriteGroupId = configuredWriteGroupIds[0];
  } else {
    // No write recipe books configured and no override — the key would be
    // read-only, which breaks the "open recipe check page" action. Surface a
    // clear error so the UI can point the user at the Recipe Books page to
    // opt a book in.
    return c.json({
      ok: false,
      error: "no_write_recipe_books_configured",
      message: "No recipe books are configured for daily-agent writes. Open the Recipe Books page and include at least one in writes, or pass writeRecipeBookId explicitly.",
    }, 400);
  }

  // Read scope: configured daily_read set, or fall back to all memberships
  // when the user has none configured. The fallback matters only for users
  // created before migration 0016 who then toggled everything off; new users
  // get grandfathered state.
  const readGroupIds = configuredReadGroupIds.length > 0 ? configuredReadGroupIds : allGroupIds;

  const result = await generateDailyKey(db, user.id, readGroupIds, writeGroupIds, defaultWriteGroupId);
  return c.json({ ok: true, data: toWireKey(result) });
});

// POST /keys/scoped
keys.post("/scoped", keyGenRateLimit, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = scopedKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  // Translate wire-format names to the internal schema-level names. DB
  // columns and service functions still use the `groupIds` vocabulary (per
  // schema deferral); only the public JSON shape carries the new names.
  const readGroupIds = parsed.data.readRecipeBookIds;
  const writeGroupIds = parsed.data.writeRecipeBookIds;
  const defaultWriteGroupId = parsed.data.defaultWriteRecipeBookId;
  const { expiresAt, label } = parsed.data;

  if (!writeGroupIds.includes(defaultWriteGroupId)) {
    return c.json({ ok: false, error: "defaultWriteRecipeBookId must be in writeRecipeBookIds" }, 400);
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

  // Verify user is a member of all requested recipe books (both read and write)
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
    return c.json({ ok: false, error: "Not a member of all requested recipe books" }, 403);
  }

  const result = await generateScopedKey(db, user.id, {
    readGroupIds,
    writeGroupIds,
    defaultWriteGroupId,
    expiresAt: expiresDate,
    ...(label ? { label } : {}),
  });
  return c.json({ ok: true, data: toWireKey(result) });
});

// GET /keys
keys.get("/", async (c) => {
  const user = c.get("user");
  const result = await listKeys(getDb(), user.id);
  return c.json({ ok: true, data: result.map(toWireKeyListItem) });
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

  // F33 (security-audit-2026-04-09): look up by hashed key, not by 8-char
  // prefix. cn_d_/cn_s_ are fixed prefixes leaving only ~3 random base62
  // chars in the prefix-key, so multiple keys for the same user can collide
  // on prefix and the LIMIT 1 returned whichever the planner chose. The
  // ownership check still held, but the briefing could echo the wrong
  // group set. Mirrors validateKey() at services/api-key.service.ts:204.
  const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyRows = await db.execute(sql`
    SELECT read_group_ids, write_group_ids, default_write_group_id
    FROM claimnet.api_keys
    WHERE user_id = ${user.id}::uuid
      AND key = ${hashedKey}
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

  // Echo the resolved groups so callers (and the F33 regression test)
  // can confirm the lookup hit the right key without parsing the
  // rendered briefing text.
  return c.json({ ok: true, data: { text, type: briefingType, groups } });
});

// ── Wire-format mappers (C1 — recipe-book rename) ──────────────────────────
//
// The HTTP/JSON shape uses recipe-book vocabulary; service-layer return values
// keep the schema-level groupIds vocabulary. These helpers translate at the
// route boundary.

interface WireKey {
  key: string;
  searchUrl: string;
  expiresAt: Date;
  readRecipeBookIds: string[];
  writeRecipeBookIds: string[];
  defaultWriteRecipeBookId: string;
}

interface ServiceKey {
  key: string;
  searchUrl: string;
  expiresAt: Date;
  readGroupIds: string[];
  writeGroupIds: string[];
  defaultWriteGroupId: string;
}

function toWireKey(k: ServiceKey): WireKey {
  return {
    key: k.key,
    searchUrl: k.searchUrl,
    expiresAt: k.expiresAt,
    readRecipeBookIds: k.readGroupIds,
    writeRecipeBookIds: k.writeGroupIds,
    defaultWriteRecipeBookId: k.defaultWriteGroupId,
  };
}

interface ServiceKeyListItem {
  id: string;
  keyPrefix: string;
  keyType: string;
  readGroupIds: string[];
  writeGroupIds: string[];
  defaultWriteGroupId: string;
  label: string | null;
  expiresAt: Date;
  createdAt: Date;
}

interface WireKeyListItem {
  id: string;
  keyPrefix: string;
  keyType: string;
  readRecipeBookIds: string[];
  writeRecipeBookIds: string[];
  defaultWriteRecipeBookId: string;
  label: string | null;
  expiresAt: Date;
  createdAt: Date;
}

function toWireKeyListItem(k: ServiceKeyListItem): WireKeyListItem {
  return {
    id: k.id,
    keyPrefix: k.keyPrefix,
    keyType: k.keyType,
    readRecipeBookIds: k.readGroupIds,
    writeRecipeBookIds: k.writeGroupIds,
    defaultWriteRecipeBookId: k.defaultWriteGroupId,
    label: k.label,
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
  };
}

export { keys as keyRoutes };
