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

/**
 * The other paths a stranger's address can be sent mail through: password
 * reset (public) and verification resend (a signed-in, unverified account,
 * which bots created before signup was protected). Both refuse without a
 * valid token before any lookup or send.
 */
describe("email-sending auth routes with Turnstile on", () => {
  const saved = {
    secret: process.env["TURNSTILE_SECRET_KEY"],
    rate: process.env["DISABLE_RATE_LIMIT"],
    jwt: process.env["JWT_SECRET"],
  };

  beforeEach(() => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    process.env["DISABLE_RATE_LIMIT"] = "true";
    process.env["JWT_SECRET"] ??= "turnstile-route-test-secret-0123456789abcdef";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of [["TURNSTILE_SECRET_KEY", saved.secret], ["DISABLE_RATE_LIMIT", saved.rate], ["JWT_SECRET", saved.jwt]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const rejectAll = () => vi.fn(async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }));

  it("password reset refuses a missing token without calling Cloudflare", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await makeApp().request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@test.local" }),
    });
    expect(res.status, "a reset request without a token must be refused").toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("turnstile_failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("password reset refuses a token Cloudflare rejects", async () => {
    vi.stubGlobal("fetch", rejectAll());
    const res = await makeApp().request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@test.local", turnstileToken: "forged" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("turnstile_failed");
  });

  it("verification resend refuses a signed-in request without a token", async () => {
    const { signToken } = await import("../auth");
    const jwt = signToken({ sub: "00000000-0000-0000-0000-000000000001", email: "someone@test.local", role: "tenant" } as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await makeApp().request("/auth/resend-verification", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status, "a resend without a token must be refused").toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("turnstile_failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verification resend still requires sign-in first", async () => {
    const res = await makeApp().request("/auth/resend-verification", { method: "POST", body: "{}" });
    expect(res.status, "no bearer token is a 401, before any bot check").toBe(401);
  });
});
