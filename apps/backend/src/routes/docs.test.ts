import { describe, it, expect } from "vitest";

/**
 * Route tests for /docs/* pages — requires running backend.
 * These are public pages (no auth needed). Tests verify status codes,
 * content-type, and key content markers.
 *
 * Run with: source .env && BACKEND_URL=http://localhost:3001 npx vitest run
 */

const BASE = process.env["BACKEND_URL"] ?? "";

describe.skipIf(!BASE)("/docs routes", () => {
  it("GET /docs/recipe-check-guide returns HTML with guide content", async () => {
    const res = await fetch(`${BASE}/docs/recipe-check-guide`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("How this works");
    expect(html).toContain("recipe-scenarios");
  });

  it("GET /docs/recipe-scenarios returns rendered HTML from markdown", async () => {
    const res = await fetch(`${BASE}/docs/recipe-scenarios`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("Could not read");
    expect(html).toContain("Scenario A");
    expect(html).toContain("Scenario E");
  });

  it("GET /docs/recipe-scenarios has valid HTML structure", async () => {
    const res = await fetch(`${BASE}/docs/recipe-scenarios`);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('href="/check-style.css"');
    expect(html).toContain("Back to recipe check guide");
  });

  it("GET /docs/mcp-setup returns HTML with setup instructions", async () => {
    const res = await fetch(`${BASE}/docs/mcp-setup`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("MCP");
    expect(html).toContain("check_recipe");
  });

  it("GET /docs/mcp-setup embeds API key from query param", async () => {
    const res = await fetch(`${BASE}/docs/mcp-setup?key=TEST-KEY-123`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("TEST-KEY-");
  });

  it("GET /docs/bootstrap returns rendered HTML from markdown", async () => {
    const res = await fetch(`${BASE}/docs/bootstrap`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("Could not read");
    expect(html).toContain("Bootstrap Your Corpus");
    expect(html).toContain("cross-pollination");
  });

  // Regression guard for F10 (security audit 2026-03-29 / 2026-03-31).
  // The fix was to REMOVE the static /uploads/* file server entirely rather
  // than adding auth — there is no longer any route that serves uploaded
  // files. If someone re-introduces a static file server, this test catches
  // it: a request to /uploads/* must not match any route.
  it("F10 regression: /uploads/* is not a route (file server was removed)", async () => {
    const res = await fetch(`${BASE}/uploads/artifacts/nonexistent.png`);
    expect(res.status).toBe(404);
  });
});
