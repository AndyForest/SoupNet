/**
 * GET /health/version — API-key-authed stack introspection.
 *
 * The (d) surface of the eval-reset contract, plus the reduced (f) form.
 * Design: docs/planning/eval-reset-contract-response.md items (d) + (f) — the
 * operator ruled the detailed introspection block ships on an authenticated
 * line (coarse liveness stays public on /health), and that the headless
 * key-lifecycle need "largely dissolves" into proactive expiry visibility for
 * live keys rather than an expiry-naming 4xx. One authenticated GET answers a
 * benchmark runner's "is this stack stale / is my key about to die" question
 * before it spends budget: git commit, ranking algorithm version, migration
 * head, embeddings provider + model, and the PRESENTING key's own expiry/type.
 *
 * Auth: any valid API key, accepted as a Bearer header OR a `?key=` query
 * param — the same dual acceptance as /check. NEVER unauthenticated.
 *
 * Indistinguishability boundary (anti-enumeration): a missing, invalid, OR
 * expired key all return the identical uniform 401 "Invalid or expired API
 * key" — the standing ruling is that "Invalid and expired keys are
 * deliberately indistinguishable" (lib/key-remediation.ts, routes/check.ts).
 * The response doc explicitly DECLINES an expired-key-naming 4xx for exactly
 * this reason. Expiry is surfaced only to a caller already holding a
 * currently-VALID key — its own runway, never another key's existence.
 *
 * Rate limiting: follows the /recipes precedent (WT-3, 2026-07-05; corpus
 * recipe 5999be88) — a generous in-memory per-credential cap mirroring the
 * /mcp per-bearer backstop. This is a cheap read-only endpoint (no embedding
 * calls), legitimate fleet use should never hit the throttle first, and the
 * accepted trade-off is that in-memory state resets on restart — a reset only
 * briefly widens a window the per-IP limiter still bounds. A per-IP limiter
 * runs first for defense in depth against many-key scraping from one host.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql } from "drizzle-orm";
import { RANKING_ALGORITHM_VERSION } from "@soupnet/domain";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { validateKey } from "../services/api-key.service";
import {
  getEmbeddingProviderId,
  getEmbeddingModelId,
} from "../lib/embeddings/provider";
import { rateLimit, getClientIp, hashApiKey } from "../middleware/rate-limit";

/** Pull the raw api key from a Bearer header or the `?key=` query param —
 *  the same dual acceptance /check offers. Bearer wins if both are present. */
function extractKey(c: Context): string | null {
  const auth = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (match) return match[1]!.trim();
  const q = c.req.query("key");
  return q ? q.trim() : null;
}

// Per-IP: 1000/hour (defense in depth, same shape as /recipes' per-IP limiter).
const versionIpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

// Per-credential: 600/hour keyed by hashed key (raw keys must not sit in
// memory as map keys). Falls back to IP bucketing when no key is present.
const versionPerKeyRateLimit = rateLimit({
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const token = extractKey(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

const version = new Hono<AppEnv>();

interface MigrationsInfo {
  count: number;
  latest: { hash: string; createdAt: string } | null;
}

/**
 * Read-only query against the Drizzle migrations journal table
 * (drizzle.__drizzle_migrations — the default location; the config sets no
 * override). `count` is the number of applied migrations; `latest` is the most
 * recent entry's content hash + the ISO timestamp it was applied. created_at is
 * a bigint of epoch milliseconds in this table.
 */
async function readMigrations(db: ReturnType<typeof getDb>): Promise<MigrationsInfo> {
  const rows = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM drizzle.__drizzle_migrations) AS count,
      hash AS latest_hash,
      created_at AS latest_created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = (rows as unknown as Array<{
    count: number;
    latest_hash: string;
    latest_created_at: string | number | bigint;
  }>)[0];
  if (!row) return { count: 0, latest: null };
  return {
    count: row.count,
    latest: {
      hash: row.latest_hash,
      createdAt: new Date(Number(row.latest_created_at)).toISOString(),
    },
  };
}

// GET /health/version
// Authorization: Bearer <api-key>  OR  ?key=<api-key>. No JWT — agent surface.
version.get("/", versionIpRateLimit, versionPerKeyRateLimit, async (c) => {
  const rawKey = extractKey(c);
  if (!rawKey) {
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  const db = getDb();
  const validated = await validateKey(db, rawKey);
  if (!validated) {
    // Uniform 401 — a missing, invalid, and expired key are indistinguishable.
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  const migrations = await readMigrations(db);

  return c.json({
    ok: true,
    data: {
      gitCommit: process.env["GIT_COMMIT"] ?? "unknown",
      rankingAlgorithmVersion: RANKING_ALGORITHM_VERSION,
      migrations,
      embeddings: {
        provider: getEmbeddingProviderId(),
        modelId: getEmbeddingModelId(),
      },
      // The PRESENTING key's own runway — surfaced only because this caller
      // holds a currently-valid key (see the indistinguishability boundary
      // above). Never another key's expiry.
      key: {
        expiresAt: validated.expiresAt.toISOString(),
        keyType: validated.keyType,
      },
    },
  });
});

export { version as versionRoutes };
