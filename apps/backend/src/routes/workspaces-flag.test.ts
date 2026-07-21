import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { workspaceRoutes, benchmarkOpsEnabled } from "./workspaces";
import { maxLivePerKey, DEFAULT_MAX_LIVE_PER_KEY } from "../services/ephemeral-workspace.service";

/**
 * Layer-1 / Layer-3-lite unit tests for the ALLOW_BENCHMARK_OPS flag gate on
 * /workspaces (audit F62). Fully self-contained — mounts the router in a bare
 * Hono app and drives it with app.request(), toggling the env var. These paths
 * return BEFORE any DB access (flag-off 404; flag-on + no key 401), so no
 * backend/postgres is required and the test runs in the default vitest pass.
 *
 * Constraint (audit F62 / eval-reset contract constraint 8): the feature is
 * enabled iff ALLOW_BENCHMARK_OPS === "true" exactly — not truthiness, not the
 * environment name. When off, routes behave as ABSENT (404), never a 403 that
 * would confirm the feature exists.
 */

function makeApp() {
  const app = new Hono();
  app.route("/workspaces", workspaceRoutes);
  return app;
}

const ORIGINAL = process.env["ALLOW_BENCHMARK_OPS"];

describe("workspaces flag gate — ALLOW_BENCHMARK_OPS strict === 'true'", () => {
  beforeEach(() => {
    delete process.env["ALLOW_BENCHMARK_OPS"];
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["ALLOW_BENCHMARK_OPS"];
    else process.env["ALLOW_BENCHMARK_OPS"] = ORIGINAL;
  });

  for (const value of [undefined, "", "false", "1", "TRUE", "yes"]) {
    it(`returns 404 (absent) for POST /workspaces when flag is ${JSON.stringify(value)}`, async () => {
      if (value === undefined) delete process.env["ALLOW_BENCHMARK_OPS"];
      else process.env["ALLOW_BENCHMARK_OPS"] = value;
      const app = makeApp();
      const res = await app.request("/workspaces", {
        method: "POST",
        headers: { Authorization: "Bearer cn_s_whatever", "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
      expect(benchmarkOpsEnabled()).toBe(false);
    });

    it(`returns 404 for POST /workspaces/:id/expiry when flag is ${JSON.stringify(value)}`, async () => {
      if (value === undefined) delete process.env["ALLOW_BENCHMARK_OPS"];
      else process.env["ALLOW_BENCHMARK_OPS"] = value;
      const app = makeApp();
      const res = await app.request("/workspaces/11111111-1111-1111-1111-111111111111/expiry", {
        method: "POST",
        headers: { Authorization: "Bearer cn_s_whatever", "Content-Type": "application/json" },
        body: JSON.stringify({ expiresAt: "now" }),
      });
      expect(res.status).toBe(404);
    });
  }

  it("enables the route only for exactly 'true' — then 401 (not 404) with no key", async () => {
    process.env["ALLOW_BENCHMARK_OPS"] = "true";
    expect(benchmarkOpsEnabled()).toBe(true);
    const app = makeApp();
    // Flag on but no Authorization header → the route is reachable and returns
    // its own 401 (proving it is NOT behaving as absent). Still no DB touched.
    const res = await app.request("/workspaces", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe("maxLivePerKey — env override", () => {
  const orig = process.env["EPHEMERAL_MAX_LIVE_PER_KEY"];
  afterEach(() => {
    if (orig === undefined) delete process.env["EPHEMERAL_MAX_LIVE_PER_KEY"];
    else process.env["EPHEMERAL_MAX_LIVE_PER_KEY"] = orig;
  });

  it("defaults to 50 when unset or invalid", () => {
    delete process.env["EPHEMERAL_MAX_LIVE_PER_KEY"];
    expect(maxLivePerKey()).toBe(DEFAULT_MAX_LIVE_PER_KEY);
    process.env["EPHEMERAL_MAX_LIVE_PER_KEY"] = "-3";
    expect(maxLivePerKey()).toBe(DEFAULT_MAX_LIVE_PER_KEY);
    process.env["EPHEMERAL_MAX_LIVE_PER_KEY"] = "notanumber";
    expect(maxLivePerKey()).toBe(DEFAULT_MAX_LIVE_PER_KEY);
  });

  it("honors a positive override", () => {
    process.env["EPHEMERAL_MAX_LIVE_PER_KEY"] = "3";
    expect(maxLivePerKey()).toBe(3);
  });
});
