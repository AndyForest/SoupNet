/**
 * In-memory sliding-window rate limiter middleware.
 *
 * Tracks requests per key (IP or user ID) in a Map with automatic cleanup.
 * Suitable for single-container deployments (ECS Fargate).
 *
 * For multi-container: swap to Redis-backed store.
 *
 * The per-key rate limiter at the bottom of this file (F29) is different —
 * it queries audit_log directly so all containers see the same counter
 * without a shared store. The trade-off is one indexed COUNT per request.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getDb } from "../db";
import { parseLenientQuery } from "../lib/lenient-query";

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Function to extract the rate limit key (defaults to IP) */
  keyFn?: (c: Context) => string;
}

function createStore(windowMs: number) {
  const store = new Map<string, RateLimitEntry>();

  // F32 (security-audit-2026-04-09): cleanup uses the limiter's own window,
  // not a hardcoded 15-minute filter. The previous hardcode silently purged
  // timestamps from minutes 0–45 of an hour-long limiter after 15 minutes
  // of inactivity, which let bursty attackers exceed the nominal cap.
  const cleanupIntervalMs = Math.min(5 * 60 * 1000, Math.max(60_000, Math.floor(windowMs / 4)));
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, cleanupIntervalMs);
  cleanup.unref();

  return store;
}

// F36 (security-audit-2026-06-11): the ALB *appends* the IP it observed to
// any inbound X-Forwarded-For and does not strip client-supplied entries, so
// the FIRST entry is attacker-controlled. Trust only the entry at a fixed hop
// distance from the right: with one trusted proxy (our ALB), that's the last
// entry. If the topology gains another trusted hop (e.g. CloudFront in front
// of the ALB), bump TRUSTED_PROXY_HOPS to 2 — never count from the left.
const TRUSTED_PROXY_HOPS_DEFAULT = 1;

export function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const entries = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (entries.length > 0) {
      const hops = Number(process.env["TRUSTED_PROXY_HOPS"] ?? TRUSTED_PROXY_HOPS_DEFAULT);
      const idx = Math.max(0, entries.length - Math.max(1, hops));
      return entries[idx]!;
    }
  }
  // No XFF (local dev / direct connection). x-real-ip is never set by the
  // ALB, so in production the XFF branch above always wins; this fallback
  // only matters off-ALB where spoofing isn't load-bearing.
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Create a rate-limiting middleware.
 *
 * Each call creates its own isolated store, so different route groups
 * can have independent limits.
 */
export function rateLimit(opts: RateLimitOptions) {
  const store = createStore(opts.windowMs);
  const keyFn = opts.keyFn ?? getClientIp;

  return async (c: Context, next: Next) => {
    // Disable rate limiting in test environments
    if (process.env["DISABLE_RATE_LIMIT"] === "true") {
      return next();
    }

    const key = keyFn(c);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);

    if (entry.timestamps.length >= opts.max) {
      const retryAfter = Math.ceil((entry.timestamps[0]! + opts.windowMs - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ ok: false, error: "Too many requests" }, 429);
    }

    entry.timestamps.push(now);
    return next();
  };
}

// ── Per-key rate limiter (F29) ───────────────────────────────────────────────
//
// Queries audit_log directly for the live count of recipe.checked events
// keyed to a given api_key_id. Single source of truth, no parallel counter
// to maintain or to drift after restart. The composite index
// (api_key_id, occurred_at DESC) keeps the COUNT cheap.
//
// Defaults: 200 / hour, 1000 / day. Locked by Andy (2026-05-02). Override
// via PER_KEY_RATE_LIMIT_HOURLY / PER_KEY_RATE_LIMIT_DAILY env vars.
//
// Mounted on /check and /mcp after the per-IP limiter (defense in depth):
// per-IP catches NAT'd attackers across many keys; per-key catches a single
// noisy key behind any IP. See docs/security/security-audit-2026-04-09.md F29.

export const PER_KEY_HOURLY_DEFAULT = 200;
export const PER_KEY_DAILY_DEFAULT = 1000;

/** SHA-256 a credential before using it as a limiter map key — raw keys
 *  should not sit in memory as map keys. Exported for keyFns that bucket
 *  by Bearer token (uploads, the /mcp per-bearer backstop). */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

interface PerKeyDeps {
  /** Resolves a raw api key to its api_keys.id (or null if unknown). */
  resolveApiKeyId: (rawKey: string) => Promise<string | null>;
  /** Counts recipe.checked rows in audit_log for a given key within the
   *  trailing interval (e.g. "1 hour", "24 hours"). */
  countRecipeChecksSince: (apiKeyId: string, intervalSql: string) => Promise<number>;
}

/** Default deps query the live DB. Tests inject stubs. */
export function defaultPerKeyDeps(): PerKeyDeps {
  return {
    resolveApiKeyId: async (rawKey: string) => {
      const hashed = hashApiKey(rawKey);
      const rows = await getDb().execute(sql`
        SELECT id FROM claimnet.api_keys
        WHERE key = ${hashed}
          AND expires_at > NOW()
        LIMIT 1
      `);
      const row = (rows as unknown as Array<{ id: string }>)[0];
      return row?.id ?? null;
    },
    countRecipeChecksSince: async (apiKeyId: string, intervalSql: string) => {
      // Inline interval string — values are constants ("1 hour" / "24 hours")
      // chosen by perKeyRateLimit, never user-supplied.
      const rows = await getDb().execute(sql`
        SELECT COUNT(*)::int AS n
        FROM claimnet.audit_log
        WHERE api_key_id = ${apiKeyId}::uuid
          AND action = 'recipe.checked'
          AND occurred_at > NOW() - ${sql.raw(`INTERVAL '${intervalSql}'`)}
      `);
      const row = (rows as unknown as Array<{ n: number }>)[0];
      return row?.n ?? 0;
    },
  };
}

interface PerKeyRateLimitOptions {
  /** Pulls the raw api key out of the request — query string, form body,
   *  Authorization header, etc. Return null if no key is present (the
   *  downstream handler will reject with the right error). */
  keyExtractor: (c: Context) => Promise<string | null> | string | null;
  /** Hourly cap (default 200, env override PER_KEY_RATE_LIMIT_HOURLY). */
  hourlyMax?: number;
  /** Daily cap (default 1000, env override PER_KEY_RATE_LIMIT_DAILY). */
  dailyMax?: number;
  /** Cap for UNRESOLVABLE credentials per window (F43; default 30/15min). */
  invalidKeyMax?: number;
  /** Test seam — defaults to live-DB queries. */
  deps?: PerKeyDeps;
}

// F43 (security-audit-2026-06-11): unknown/expired keys used to fall through
// with no throttle at all — a garbage-Bearer flood hit only the per-IP
// limiter before the 401, and every flood request cost a DB lookup in
// resolveApiKeyId. Unresolvable credentials now get their own small
// sliding-window bucket, keyed by the credential hash. Entries are bounded
// by the per-IP limiter upstream (post-F36 an attacker can't mint unlimited
// request budget from one IP) and purged by the store's cleanup tick.
const INVALID_KEY_WINDOW_MS = 15 * 60 * 1000;
const INVALID_KEY_MAX_DEFAULT = 30;

export function perKeyRateLimit(opts: PerKeyRateLimitOptions) {
  const hourlyMax = opts.hourlyMax
    ?? Number(process.env["PER_KEY_RATE_LIMIT_HOURLY"] ?? PER_KEY_HOURLY_DEFAULT);
  const dailyMax = opts.dailyMax
    ?? Number(process.env["PER_KEY_RATE_LIMIT_DAILY"] ?? PER_KEY_DAILY_DEFAULT);
  const invalidKeyMax = opts.invalidKeyMax ?? INVALID_KEY_MAX_DEFAULT;
  const deps = opts.deps ?? defaultPerKeyDeps();
  const invalidKeyStore = createStore(INVALID_KEY_WINDOW_MS);

  return async (c: Context, next: Next) => {
    if (process.env["DISABLE_RATE_LIMIT"] === "true") {
      return next();
    }

    const rawKey = await opts.keyExtractor(c);
    if (!rawKey) {
      // No key on the request — let the downstream handler return its own
      // "missing key" error so the response stays consistent with non-rate-
      // -limited paths.
      return next();
    }

    const apiKeyId = await deps.resolveApiKeyId(rawKey);
    if (!apiKeyId) {
      // Unknown / expired key (F43): throttle per credential before letting
      // the handler 401, but stay below the cap so the first attempts still
      // get the consistent 401 from the handler.
      const now = Date.now();
      const hashed = hashApiKey(rawKey);
      let entry = invalidKeyStore.get(hashed);
      if (!entry) {
        entry = { timestamps: [] };
        invalidKeyStore.set(hashed, entry);
      }
      entry.timestamps = entry.timestamps.filter((t) => now - t < INVALID_KEY_WINDOW_MS);
      if (entry.timestamps.length >= invalidKeyMax) {
        const retryAfter = Math.ceil((entry.timestamps[0]! + INVALID_KEY_WINDOW_MS - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.json({ ok: false, error: "Too many requests" }, 429);
      }
      entry.timestamps.push(now);
      return next();
    }

    // Stash for downstream handlers that want to skip re-resolving.
    c.set("apiKeyId" as never, apiKeyId as never);

    const hourly = await deps.countRecipeChecksSince(apiKeyId, "1 hour");
    if (hourly >= hourlyMax) {
      c.header("Retry-After", "3600");
      return c.json(
        { ok: false, error: "Too many requests for this API key (hourly limit)" },
        429,
      );
    }

    const daily = await deps.countRecipeChecksSince(apiKeyId, "24 hours");
    if (daily >= dailyMax) {
      c.header("Retry-After", "86400");
      return c.json(
        { ok: false, error: "Too many requests for this API key (daily limit)" },
        429,
      );
    }

    return next();
  };
}

/** Extract the raw api key from /check requests (query string for GET,
 *  form body for POST). Mounted as the keyExtractor on /check. */
export async function extractCheckRequestKey(c: Context): Promise<string | null> {
  const method = c.req.method;
  if (method === "GET") {
    return c.req.query("key") ?? null;
  }
  // POST urlencoded: read the RAW body text, not parseBody(). Hono caches
  // whichever body view is consumed first — parseBody() here would make the
  // route handler's later c.req.text() return a re-serialized multipart
  // rendering of the parsed FormData (invalid escapes already replaced with
  // U+FFFD), breaking the lenient windows-1252 decode in routes/check.ts.
  // text() is cached too, so the handler's second read is free.
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      return parseLenientQuery(await c.req.text())("key") ?? null;
    } catch {
      return null;
    }
  }
  // POST multipart: parseBody is cached per-request by Hono, so the route
  // handler can call it again without re-parsing.
  try {
    const body = await c.req.parseBody();
    const k = body["key"];
    return typeof k === "string" ? k : null;
  } catch {
    return null;
  }
}

/** Extract the raw api key from MCP requests (Bearer token). */
export function extractMcpBearerKey(c: Context): string | null {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
