/**
 * In-memory sliding-window rate limiter middleware.
 *
 * Tracks requests per key (IP or user ID) in a Map with automatic cleanup.
 * Suitable for single-container deployments (ECS Fargate).
 *
 * For multi-container: swap to Redis-backed store.
 */

import type { Context, Next } from "hono";

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

function createStore() {
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup every 5 minutes
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < 15 * 60 * 1000);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, 5 * 60 * 1000);
  cleanup.unref();

  return store;
}

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

/**
 * Create a rate-limiting middleware.
 *
 * Each call creates its own isolated store, so different route groups
 * can have independent limits.
 */
export function rateLimit(opts: RateLimitOptions) {
  const store = createStore();
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
