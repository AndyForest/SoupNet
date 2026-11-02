import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

/**
 * OD-V4: "check now" drives a DNS query, so it is limited to ten per
 * organization per fifteen minutes. The gate runs with rate limits disabled
 * (DISABLE_RATE_LIMIT=true), so the limiter instance the route uses is tested
 * here on its own, with the switch off.
 */
describe("the check-now limiter (OD-V4)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["DISABLE_RATE_LIMIT"];
    delete process.env["DISABLE_RATE_LIMIT"];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["DISABLE_RATE_LIMIT"];
    else process.env["DISABLE_RATE_LIMIT"] = saved;
  });

  it("allows ten checks per organization in the window, refuses the eleventh, and keeps organizations apart", async () => {
    const { domainCheckRateLimit } = await import("./organization-domains");
    const app = new Hono();
    app.post("/organizations/:id/check", domainCheckRateLimit, (c) => c.json({ ok: true }));
    const org = `limit-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect((await app.request(`/organizations/${org}/check`, { method: "POST" })).status).toBe(200);
    }
    const refused = await app.request(`/organizations/${org}/check`, { method: "POST" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBeTruthy();
    expect((await app.request(`/organizations/${org}-other/check`, { method: "POST" })).status).toBe(200);
  });
});
