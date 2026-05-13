/**
 * /me — user-scoped non-auth endpoints (preferences for now; more user-scoped
 * settings will land here so /auth stays focused on identity and sessions).
 *
 * JWT-auth + verified-email required, matching the rest of the JWT-authed
 * router family (keys, traces, recipe-books).
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import {
  userPreferencesSchema,
  mergeUserPreferences,
  applyPreferencesPatch,
} from "@soupnet/domain";

const me = new Hono<AppEnv>();

me.use("/*", requireAuth, requireVerifiedEmail);

// GET /me/preferences — returns the merged-with-defaults preferences object so
// the client never has to know what the defaults are.
me.get("/preferences", async (c) => {
  const user = c.get("user");
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT preferences FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const stored = (rows as unknown as Array<{ preferences: unknown }>)[0]?.preferences;
  const resolved = mergeUserPreferences(stored);
  return c.json({ ok: true, data: resolved });
});

// PATCH /me/preferences — deep-merges the validated patch into the stored
// sparse object. Returns the new resolved (merged-with-defaults) shape so
// the client can update its local state without a second GET.
me.patch("/preferences", async (c) => {
  const user = c.get("user");
  const db = getDb();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Body must be valid JSON" }, 400);
  }

  const parsed = userPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid preferences", details: parsed.error.issues }, 400);
  }

  const existingRows = await db.execute(sql`
    SELECT preferences FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const existing = (existingRows as unknown as Array<{ preferences: unknown }>)[0]?.preferences;

  const updated = applyPreferencesPatch(existing, parsed.data);

  await db.execute(sql`
    UPDATE claimnet.users
    SET preferences = ${JSON.stringify(updated)}::jsonb, updated_at = NOW()
    WHERE id = ${user.id}::uuid
  `);

  return c.json({ ok: true, data: mergeUserPreferences(updated) });
});

export { me as meRoutes };
