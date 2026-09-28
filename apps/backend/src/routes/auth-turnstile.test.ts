import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Hono } from "hono";
import { authRoutes } from "./auth";

/**
 * With TURNSTILE_SECRET_KEY set, registration refuses a missing or invalid
 * Turnstile token before touching the database. Drives the auth routes
 * in-process (like workspaces-flag.test.ts), with Cloudflare's siteverify
 * stubbed. The pass path and the "secret unset" path reach the database and
 * are covered by the lib tests and the existing registration integration tests.
 */

function makeApp() {
  const app = new Hono();
  app.route("/auth", authRoutes);
  return app;
}

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ email: `turnstile-${Date.now()}@test.local`, password: "turnstile-pass-123", tosAccepted: true, ...extra });

describe("POST /auth/register with Turnstile on", () => {
  const saved = { secret: process.env["TURNSTILE_SECRET_KEY"], rate: process.env["DISABLE_RATE_LIMIT"] };

  beforeEach(() => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    process.env["DISABLE_RATE_LIMIT"] = "true";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved.secret === undefined) delete process.env["TURNSTILE_SECRET_KEY"];
    else process.env["TURNSTILE_SECRET_KEY"] = saved.secret;
    if (saved.rate === undefined) delete process.env["DISABLE_RATE_LIMIT"];
    else process.env["DISABLE_RATE_LIMIT"] = saved.rate;
  });

  it("refuses a registration without a token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await makeApp().request("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: body() });
    expect(res.status, "a missing token must be refused").toBe(400);
    const json = (await res.json()) as { error?: string; code?: string };
    expect(json.code).toBe("turnstile_failed");
    expect(fetchSpy, "no token means nothing to verify").not.toHaveBeenCalled();
  });

  it("refuses a registration whose token Cloudflare rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 })));
    const res = await makeApp().request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body({ turnstileToken: "forged" }),
    });
    expect(res.status, "a rejected token must be refused").toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("turnstile_failed");
  });
});
