import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit";

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
