import { describe, it, expect, vi, afterEach } from "vitest";
import { ClientSafeError, publicErrorMessage } from "./client-safe-error";

/**
 * F47 (security-audit-2026-06-11) — error-leakage regression tests, the
 * coverage gap the audit called out. Two layers:
 *
 * 1. Unit: publicErrorMessage passes ClientSafeError through verbatim and
 *    replaces everything else with the generic message (logging the raw
 *    error server-side).
 * 2. Integration (BASE-gated): 4xx/5xx bodies from real endpoints contain
 *    no stack frames, driver errors, or internal paths.
 */

// Markers that should never appear in a client-facing error body. Kept
// deliberately specific so legitimate validation messages don't false-positive.
const LEAK_PATTERNS: RegExp[] = [
  /\bat\s+\S+\.(?:ts|js|mjs|cjs):\d+/, // stack frame
  /node_modules/,
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/,
  /PostgresError|drizzle|pg-boss/i,
  /syntax error at or near/i, // postgres SQL errors
  /[A-Za-z]:\\|\/(?:home|app|usr)\/\S*\.(?:ts|js)/, // absolute fs paths to source
];

function expectNoLeak(body: string): void {
  for (const pattern of LEAK_PATTERNS) {
    expect(body).not.toMatch(pattern);
  }
}

describe("publicErrorMessage (F47)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes ClientSafeError messages through verbatim", () => {
    const msg = publicErrorMessage(new ClientSafeError("File too large: 999 bytes (max 100)"), {
      logPrefix: "[test]",
      generic: "generic",
    });
    expect(msg).toBe("File too large: 999 bytes (max 100)");
  });

  it("passes ClientSafeError subclasses through verbatim", () => {
    class SubError extends ClientSafeError {}
    const msg = publicErrorMessage(new SubError("Upload not found: https://x.example/u/1.png"), {
      logPrefix: "[test]",
      generic: "generic",
    });
    expect(msg).toBe("Upload not found: https://x.example/u/1.png");
  });

  it("replaces plain Error messages with the generic text and logs the raw error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const internal = new Error("connect ECONNREFUSED 10.0.12.34:5432", {
      cause: new Error("PostgresError: relation claimnet.api_keys does not exist"),
    });
    const msg = publicErrorMessage(internal, { logPrefix: "[test]", generic: "Something went wrong." });

    expect(msg).toBe("Something went wrong.");
    expectNoLeak(msg);
    // The raw detail must still reach the server log (message + cause).
    expect(spy).toHaveBeenCalledOnce();
    const logged = String(spy.mock.calls[0]?.join(" "));
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).toContain("PostgresError");
  });

  it("replaces non-Error throws with the generic text", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicErrorMessage("raw string failure", { logPrefix: "[test]", generic: "g" })).toBe("g");
    expect(publicErrorMessage(undefined, { logPrefix: "[test]", generic: "g" })).toBe("g");
  });
});

// ── Integration: live error bodies carry no internal detail ────────────────

const BASE = process.env["BACKEND_URL"] ?? "";

describe.skipIf(!BASE)("error responses leak no internals (F47)", () => {
  it("malformed JSON on /auth/register", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expectNoLeak(await res.text());
  });

  it("garbage bearer token on /mcp", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer cn_d_garbage_token_000",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "leak-test", version: "0" } }, id: 1 }),
    });
    expectNoLeak(await res.text());
  });

  it("broken multipart on /uploads", async () => {
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: {
        Authorization: "Bearer cn_d_garbage_token_000",
        "Content-Type": "multipart/form-data; boundary=broken",
      },
      body: "--broken\r\nnot a valid part\r\n",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expectNoLeak(await res.text());
  });

  it("unknown route 404", async () => {
    const res = await fetch(`${BASE}/definitely-not-a-route-${Date.now()}`);
    expect(res.status).toBe(404);
    expectNoLeak(await res.text());
  });

  it("invalid grant on /oauth/token", async () => {
    const res = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "bogus",
        code_verifier: "bogus-verifier-bogus-verifier-bogus-verifier",
        client_id: "oauth_bogus",
        client_secret: "bogus",
        redirect_uri: "https://example.com/cb",
      }).toString(),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expectNoLeak(await res.text());
  });
});
