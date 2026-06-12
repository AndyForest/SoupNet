import { describe, it, expect } from "vitest";

/**
 * Security-header regression tests — the "headers" coverage gap from
 * security-audit-2026-06-11 (no test verified any security header existed).
 * Runs against the live backend (BASE-gated, like the other integration
 * suites).
 *
 * Covers: baseline headers on an HTML route, a JSON route, and /docs;
 * per-request CSP nonce uniqueness (and body match when an inline script is
 * present); the stricter user-content policy on GET /uploads/*.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

const BASELINE: Array<[name: string, expected: string | RegExp]> = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["strict-transport-security", /max-age=31536000/],
  ["permissions-policy", /camera=\(\)/],
];

function expectBaseline(res: Response): void {
  for (const [name, expected] of BASELINE) {
    const value = res.headers.get(name);
    expect(value, `missing header ${name}`).toBeTruthy();
    if (typeof expected === "string") expect(value).toBe(expected);
    else expect(value).toMatch(expected);
  }
}

function cspOf(res: Response): string {
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp, "missing Content-Security-Policy").toBeTruthy();
  return csp;
}

describe.skipIf(!BASE)("security headers", () => {
  it("HTML route (/check) carries baseline headers and the hardened CSP", async () => {
    const res = await fetch(`${BASE}/check`);
    expectBaseline(res);
    const csp = cspOf(res);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).not.toContain("unsafe-inline'; script"); // no unsafe-inline on script-src
  });

  it("JSON route (/health) carries the same baseline", async () => {
    const res = await fetch(`${BASE}/health`);
    expectBaseline(res);
    cspOf(res);
  });

  it("/docs carries the baseline", async () => {
    const res = await fetch(`${BASE}/docs`);
    expectBaseline(res);
    cspOf(res);
  });

  it("CSP nonce differs across requests and matches the inline script nonce", async () => {
    const res1 = await fetch(`${BASE}/check`);
    const res2 = await fetch(`${BASE}/check`);
    const nonce1 = /'nonce-([^']+)'/.exec(cspOf(res1))?.[1];
    const nonce2 = /'nonce-([^']+)'/.exec(cspOf(res2))?.[1];
    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);

    // When the page embeds a nonce'd inline script, it must use THIS
    // request's nonce (a static nonce would defeat the CSP).
    const body = await res1.text();
    const bodyNonce = /<script[^>]*\snonce="([^"]+)"/.exec(body)?.[1];
    if (bodyNonce) {
      expect(bodyNonce).toBe(nonce1);
    }
  });

  it("GET /uploads/* pins the user-content sandbox policy (inert today, fails safe later)", async () => {
    const res = await fetch(`${BASE}/uploads/00000000-0000-0000-0000-000000000000.png`);
    expect(res.status).toBe(404); // F10: reference token, not a file
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expectBaseline(res);
  });
});
