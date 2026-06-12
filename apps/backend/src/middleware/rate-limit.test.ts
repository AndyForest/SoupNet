import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { getClientIp, rateLimit, perKeyRateLimit } from "./rate-limit";

// These tests exercise the rate limiter directly — no running server needed.
// Integration tests run with DISABLE_RATE_LIMIT=true; these verify the actual limiting logic.

describe("rate-limit middleware", () => {
  const originalEnv = process.env["DISABLE_RATE_LIMIT"];

  beforeEach(() => {
    // Ensure rate limiting is ENABLED for these tests
    delete process.env["DISABLE_RATE_LIMIT"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["DISABLE_RATE_LIMIT"] = originalEnv;
    } else {
      delete process.env["DISABLE_RATE_LIMIT"];
    }
  });

  function createApp(max: number, windowMs: number) {
    const app = new Hono();
    app.use("/*", rateLimit({ max, windowMs }));
    app.get("/test", (c) => c.json({ ok: true }));
    app.post("/test", (c) => c.json({ ok: true }));
    return app;
  }

  function req(app: Hono, ip = "127.0.0.1") {
    return app.request("/test", {
      headers: { "x-forwarded-for": ip },
    });
  }

  it("allows requests under the limit", async () => {
    const app = createApp(3, 60_000);

    const r1 = await req(app);
    const r2 = await req(app);
    const r3 = await req(app);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });

  it("blocks requests over the limit with 429", async () => {
    const app = createApp(2, 60_000);

    const r1 = await req(app);
    const r2 = await req(app);
    const r3 = await req(app);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);

    const body = await r3.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Too many requests");
  });

  it("includes Retry-After header on 429", async () => {
    const app = createApp(1, 60_000);

    await req(app); // use up the limit
    const blocked = await req(app);

    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("tracks limits per IP independently", async () => {
    const app = createApp(1, 60_000);

    const r1 = await req(app, "10.0.0.1");
    const r2 = await req(app, "10.0.0.2");
    const r3 = await req(app, "10.0.0.1"); // same IP as r1

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200); // different IP, independent limit
    expect(r3.status).toBe(429); // same IP, over limit
  });

  it("resets after the window expires", async () => {
    vi.useFakeTimers();

    const app = createApp(1, 1000); // 1 request per 1 second

    const r1 = await req(app);
    expect(r1.status).toBe(200);

    const r2 = await req(app);
    expect(r2.status).toBe(429);

    // Advance past the window
    vi.advanceTimersByTime(1100);

    const r3 = await req(app);
    expect(r3.status).toBe(200);

    vi.useRealTimers();
  });

  it("is bypassed when DISABLE_RATE_LIMIT=true", async () => {
    process.env["DISABLE_RATE_LIMIT"] = "true";

    const app = createApp(1, 60_000);

    const r1 = await req(app);
    const r2 = await req(app);
    const r3 = await req(app);

    // All pass despite limit of 1
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });

  // F32: cleanup interval is derived from windowMs, so timestamps inside a
  // 1-hour window are NOT purged after 16 minutes of inactivity.
  it("F32: 1h-window timestamps survive a 16-minute gap (cleanup respects windowMs)", async () => {
    vi.useFakeTimers();
    const app = createApp(2, 60 * 60 * 1000); // 2 per 1 hour

    // First request — counted.
    const r1 = await req(app);
    expect(r1.status).toBe(200);

    // Advance 16 minutes (well past the old hardcoded 15-min cleanup, but
    // still inside the 1h window). The cleanup tick runs at min(5m, ¼ window).
    vi.advanceTimersByTime(16 * 60 * 1000);

    // Second request — must still see the first one's timestamp, so the
    // count is 2 and the limiter accepts.
    const r2 = await req(app);
    expect(r2.status).toBe(200);

    // Third request — must trip 429 because the first two timestamps are
    // both still in-window. With the F32 fix this is correct; before the
    // fix, the first timestamp was silently purged at ~15 minutes and the
    // count reset to 1, allowing the third to slip through.
    const r3 = await req(app);
    expect(r3.status).toBe(429);

    vi.useRealTimers();
  });

  // F36 (security-audit-2026-06-11): the ALB APPENDS the observed client IP
  // to any inbound X-Forwarded-For, so the trustworthy entry is the LAST one,
  // not the first. A client who forges a fresh leading XFF entry per request
  // must NOT get a fresh rate-limit bucket.
  it("F36: spoofed leading XFF entries do not reset the per-IP bucket", async () => {
    const app = createApp(1, 60_000);

    // Same real client (ALB-appended last entry), different forged prefixes.
    const r1 = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.5" },
    });
    const r2 = await app.request("/test", {
      headers: { "x-forwarded-for": "99.99.99.99, 203.0.113.5" },
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429); // forged prefix changed, bucket did not
  });

  it("F36: getClientIp takes the rightmost XFF entry (one trusted hop)", () => {
    const mk = (xff: string) =>
      ({ req: { header: (n: string) => (n === "x-forwarded-for" ? xff : undefined) } }) as never;
    expect(getClientIp(mk("203.0.113.5"))).toBe("203.0.113.5");
    expect(getClientIp(mk("evil, 203.0.113.5"))).toBe("203.0.113.5");
    expect(getClientIp(mk("a, b, 203.0.113.5"))).toBe("203.0.113.5");
    expect(getClientIp(mk("203.0.113.5,"))).toBe("203.0.113.5"); // trailing comma junk
  });

  it("F36: TRUSTED_PROXY_HOPS=2 takes the second-from-right entry", () => {
    process.env["TRUSTED_PROXY_HOPS"] = "2";
    try {
      const mk = (xff: string) =>
        ({ req: { header: (n: string) => (n === "x-forwarded-for" ? xff : undefined) } }) as never;
      // client -> CloudFront -> ALB: [forged..., clientIP, cloudfrontIP]
      expect(getClientIp(mk("evil, 203.0.113.5, 130.176.0.1"))).toBe("203.0.113.5");
      // Fewer entries than hops: clamp to the first rather than crash.
      expect(getClientIp(mk("203.0.113.5"))).toBe("203.0.113.5");
    } finally {
      delete process.env["TRUSTED_PROXY_HOPS"];
    }
  });

  it("supports custom key function", async () => {
    const app = new Hono();
    app.use("/*", rateLimit({
      max: 1,
      windowMs: 60_000,
      keyFn: (c) => c.req.header("x-api-key") ?? "anonymous",
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    const r1 = await app.request("/test", { headers: { "x-api-key": "key-a" } });
    const r2 = await app.request("/test", { headers: { "x-api-key": "key-b" } });
    const r3 = await app.request("/test", { headers: { "x-api-key": "key-a" } });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200); // different key
    expect(r3.status).toBe(429); // same key, over limit
  });
});

// F29: per-key rate limiter that queries audit_log directly instead of
// keeping its own counter. Tests inject a stub deps interface so we can
// drive the count without spinning up postgres.
describe("perKeyRateLimit middleware (F29)", () => {
  const originalEnv = process.env["DISABLE_RATE_LIMIT"];

  beforeEach(() => {
    delete process.env["DISABLE_RATE_LIMIT"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["DISABLE_RATE_LIMIT"] = originalEnv;
    } else {
      delete process.env["DISABLE_RATE_LIMIT"];
    }
  });

  function createApp(opts: {
    hourlyMax?: number;
    dailyMax?: number;
    rawKey?: string | null;
    apiKeyId?: string | null;
    hourly?: number;
    daily?: number;
    /** Bumps each call so we can assert calls weren't made. */
    spies?: { resolveCalls: number; countCalls: number };
  }) {
    const app = new Hono();
    const counts = { resolveCalls: 0, countCalls: 0 };
    app.use("/*", perKeyRateLimit({
      keyExtractor: () => opts.rawKey ?? null,
      ...(opts.hourlyMax !== undefined ? { hourlyMax: opts.hourlyMax } : {}),
      ...(opts.dailyMax !== undefined ? { dailyMax: opts.dailyMax } : {}),
      deps: {
        resolveApiKeyId: async () => {
          counts.resolveCalls++;
          return opts.apiKeyId ?? null;
        },
        countRecipeChecksSince: async (_id, intervalSql) => {
          counts.countCalls++;
          if (intervalSql === "1 hour") return opts.hourly ?? 0;
          return opts.daily ?? 0;
        },
      },
    }));
    app.get("/test", (c) => c.json({ ok: true }));
    if (opts.spies) Object.assign(opts.spies, counts);
    return { app, counts };
  }

  it("passes when both counts are under their caps", async () => {
    const { app } = createApp({
      rawKey: "cn_d_test",
      apiKeyId: "00000000-0000-0000-0000-000000000001",
      hourly: 199,
      daily: 999,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks with 429 when hourly count is at the cap", async () => {
    const { app } = createApp({
      rawKey: "cn_d_test",
      apiKeyId: "00000000-0000-0000-0000-000000000001",
      hourly: 200,
      daily: 500,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("hourly");
    expect(res.headers.get("Retry-After")).toBe("3600");
  });

  it("blocks with 429 when daily count is at the cap (hourly under)", async () => {
    const { app } = createApp({
      rawKey: "cn_d_test",
      apiKeyId: "00000000-0000-0000-0000-000000000001",
      hourly: 50,
      daily: 1000,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("daily");
    expect(res.headers.get("Retry-After")).toBe("86400");
  });

  it("falls through (no 429) when no key is on the request", async () => {
    const { app, counts } = createApp({
      rawKey: null,
      apiKeyId: "should-not-resolve",
      hourly: 99999,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(counts.resolveCalls).toBe(0);
    expect(counts.countCalls).toBe(0);
  });

  it("falls through (no 429) when the key cannot be resolved", async () => {
    const { app, counts } = createApp({
      rawKey: "cn_d_unknown",
      apiKeyId: null,
      hourly: 99999,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(counts.resolveCalls).toBe(1);
    expect(counts.countCalls).toBe(0);
  });

  // F43 (security-audit-2026-06-11): unresolvable credentials get their own
  // throttle. A garbage-Bearer flood previously fell through to the handler
  // (only the per-IP limiter applied), costing a DB lookup per request.
  it("F43: throttles a flood of the same unresolvable credential", async () => {
    const app = new Hono();
    app.use("/*", perKeyRateLimit({
      keyExtractor: () => "cn_d_garbage",
      invalidKeyMax: 3,
      deps: {
        resolveApiKeyId: async () => null,
        countRecipeChecksSince: async () => 0,
      },
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await app.request("/test")).status);
    }
    // First 3 fall through to the handler (consistent 401-from-handler path
    // in production; 200 here), the rest are throttled.
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("respects custom hourlyMax / dailyMax", async () => {
    const { app } = createApp({
      hourlyMax: 5,
      dailyMax: 10,
      rawKey: "cn_d_test",
      apiKeyId: "00000000-0000-0000-0000-000000000001",
      hourly: 5,
      daily: 0,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(429);
  });

  it("is bypassed when DISABLE_RATE_LIMIT=true", async () => {
    process.env["DISABLE_RATE_LIMIT"] = "true";
    const { app, counts } = createApp({
      rawKey: "cn_d_test",
      apiKeyId: "00000000-0000-0000-0000-000000000001",
      hourly: 99999,
      daily: 99999,
    });
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(counts.resolveCalls).toBe(0);
    expect(counts.countCalls).toBe(0);
  });
});
