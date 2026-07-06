import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for /mcp in stateless mode.
 *
 * Switched to stateless 2026-04-18 — no session map, no session-id headers
 * to track. Each request is independent. The previous stale-session test
 * battery is gone because there's nothing to be stale about.
 *
 * Wider behavior is exercised end-to-end via the soupnet-local MCP client.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

const ACCEPT_BOTH = "application/json, text/event-stream";

describe.skipIf(!BASE)("/mcp stateless behavior", () => {
  let apiKey: string;

  beforeAll(async () => {
    const uid = Date.now();
    const email = `mcp-test-${uid}@test.local`;
    const password = "mcp-test-password-123";
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Setup failed");
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    // F30: /auth/register no longer auto-logs-in.
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = (await login.json()) as { data?: { token?: string } };
    const t = loginBody.data?.token;
    if (!t) throw new Error("Login after register failed");
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    apiKey = keyBody.data?.key ?? "";
    if (!apiKey) throw new Error("Failed to generate test key");
  });

  it("rejects requests without Bearer token", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 }),
    });
    expect(res.status).toBe(401);
    // MCP auth spec (2025-06-18): the 401 carries WWW-Authenticate pointing at
    // the protected-resource metadata so OAuth clients can discover the
    // authorization server. Directory reviewers validate this via Inspector.
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain("/.well-known/oauth-protected-resource");
  });

  it("returns 405 for GET and DELETE (stateless: no SSE stream, no sessions)", async () => {
    // Streamable HTTP spec: servers not offering server-initiated messages
    // MUST 405 the standalone GET. Before this fix the SDK opened an SSE
    // stream that never sent a byte, silently stalling clients that wait on
    // it (2026-07-06 claude.ai conversation-time tool-discovery failure).
    for (const method of ["GET", "DELETE"] as const) {
      const res = await fetch(`${BASE}/mcp`, {
        method,
        headers: { Accept: "text/event-stream, application/json", Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toContain("POST");
    }
  });

  it("accepts initialize without any session header (stateless)", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "stateless-test", version: "0.0.1" },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
    // Stateless mode: SDK should NOT issue a session ID.
    expect(res.headers.get("mcp-session-id")).toBeFalsy();
  });

  it("update_recipe_book_description tool updates a recipe book the key has write access to", { timeout: 20_000 }, async () => {
    // Set up a fresh group + write-scoped key for this user.
    const uid = Date.now();
    const email = `mcp-update-desc-${uid}@test.local`;
    const password = "mcp-test-password-123";
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken ?? "";
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    // F30: log in for the JWT (register no longer returns it).
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = (await login.json()) as { data?: { token?: string } };
    const jwt = loginBody.data?.token ?? "";

    const groupsRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const groupsBody = (await groupsRes.json()) as { data: Array<{ organization_id: string }> };
    const orgId = groupsBody.data[0]?.organization_id;

    const newGroup = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        name: `Tool Update Target ${uid}`,
        slug: `tool-update-${uid}`,
        description: "Initial description before tool edit.",
        organizationId: orgId,
      }),
    });
    const newGroupBody = (await newGroup.json()) as { data?: { id: string } };
    const targetGroupId = newGroupBody.data?.id ?? "";

    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ writeRecipeBookId: targetGroupId }),
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    const writeKey = keyBody.data?.key ?? "";

    // tools/call via JSON-RPC over the streamable HTTP transport.
    const newDesc = `Edited via update_recipe_book_description tool at ${new Date(uid).toISOString()}`;
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${writeKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "update_recipe_book_description",
          arguments: { recipe_book_id_or_slug: targetGroupId, description: newDesc },
        },
        id: 1,
      }),
    });
    expect(callRes.status).toBe(200);
    const callText = await callRes.text();
    // Streamable HTTP returns the result either as JSON or as SSE — both
    // contain the tool response payload textually. Looking for the new
    // description string in either flavor is the cheapest assertion.
    expect(callText).toContain(newDesc);

    // Verify the row actually changed via the JWT GET path.
    const verifyRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const verifyBody = (await verifyRes.json()) as { data: Array<{ id: string; description: string | null }> };
    const updated = verifyBody.data.find((g) => g.id === targetGroupId);
    expect(updated?.description).toBe(newDesc);
  });

  it("update_recipe_book_description rejects keys without write access to the recipe book", async () => {
    // Reuse the test user's daily key from beforeAll — it's scoped to the
    // user's personal group (auto-created), so any OTHER user's group is
    // out of write scope. Try updating a non-existent UUID — same reach
    // behavior as a slug not in writeGroupIds.
    const stranger = "00000000-0000-0000-0000-000000000000";
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "update_recipe_book_description",
          arguments: { recipe_book_id_or_slug: stranger, description: "should not land" },
        },
        id: 2,
      }),
    });
    expect(callRes.status).toBe(200);
    const callText = await callRes.text();
    expect(callText.toLowerCase()).toContain("not found in your key's write recipe books");
  });

  // Origin-header validation (MCP transport spec §Security): when an Origin
  // is present, the server checks an allowlist. Absent Origin (typical for
  // server-to-server calls from claude.ai's cloud) passes through.
  it("accepts a request from an allowlisted Origin (claude.ai)", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
        Origin: "https://claude.ai",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "origin-allowed-test", version: "0.0.1" } },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a request from a non-allowlisted Origin", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
        Origin: "https://attacker.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "origin-rejected-test", version: "0.0.1" } },
        id: 1,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("forbidden_origin");
  });

  it("accepts a request with no Origin header (server-to-server)", async () => {
    // The Bearer-token check is the security boundary for these calls; Origin
    // validation only kicks in when an Origin header is actually present.
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "no-origin-test", version: "0.0.1" } },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts a stale session-id header without erroring (header is ignored in stateless mode)", async () => {
    // Critical regression guard: clients that cached an old session ID from a
    // pre-stateless server must not get 404s. The SDK's validateSession is a
    // no-op when sessionIdGenerator is undefined, so any session-id header is
    // simply ignored.
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
        "mcp-session-id": "00000000-0000-0000-0000-000000000000",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "stale-id-test", version: "0.0.1" },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
  });

  // WP2: premium synthesis over MCP. A premium+flagged caller passing
  // synthesize=true with response_format=structured gets the synthesis carried
  // in structuredContent. CI runs SYNTHESIS_PROVIDER=stub so the profile is the
  // deterministic "stub synthesis" text — asserting that string proves the
  // field reached structuredContent without a live LLM.
  it("check_recipe with synthesize=true (premium+flag) carries synthesis in structuredContent", { timeout: 20_000 }, async () => {
    const uid = Date.now();
    const email = `mcp-synth-${uid}@test.local`;
    const password = "mcp-test-password-123";
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken ?? "";
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    });
    const synthKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!synthKey) throw new Error("Failed to generate synthesis test key");

    // Grant premium (direct SQL, mirroring check.test.ts) + flip the opt-in.
    const postgres = (await import("postgres")).default;
    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      await sql`UPDATE claimnet.users SET premium_at = now() WHERE email = ${email}`;
    } finally {
      await sql.end();
    }
    await fetch(`${BASE}/me/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ features: { synthesize: true } }),
    });

    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${synthKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "check_recipe",
          arguments: {
            recipe: `As a preference-profiling engineer working on MCP synthesis coverage ${uid}, I prefer deterministic stub synthesis so that the structuredContent assertion is stable.`,
            supporting_evidence: `Determinism keeps the gate testable.\n> "Same input, same profile"\n-- Synthesis test plan`,
            synthesize: true,
            response_format: "structured",
          },
        },
        id: 7,
      }),
    });
    expect(callRes.status).toBe(200);
    const callText = await callRes.text();
    // The deterministic stub profile is emitted only for an eligible caller,
    // and only inside structuredContent for response_format=structured.
    expect(callText).toContain("stub synthesis");
  });

  // F41: framework-level body cap on /mcp (28 MiB = 20 MiB MAX_UPLOAD_BYTES
  // × 4/3 base64 inflation + JSON-RPC envelope slack). Must be the LAST test
  // in this describe — bodyLimit emits the 413 before draining the request,
  // which can break the next request on the same keep-alive socket (see the
  // F28 test in check.test.ts for the full rationale).
  it("F41: POST /mcp rejects bodies over 28 MiB at the framework layer", async () => {
    // Raw node:http rather than fetch: undici stalls trying to finish
    // writing a ~29 MiB body when the server 413s without reading it (the
    // server-side behavior is correct — a 29 MiB JSON POST gets 413 in ~3ms
    // via curl). bodyLimit rejects on the declared Content-Length before
    // reading the body, so declaring the oversized length and writing a
    // single byte exercises the framework-layer rejection without shipping
    // 29 MiB through a socket the server isn't draining.
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(`${BASE}/mcp`);
      const req = request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: ACCEPT_BOTH,
            Authorization: `Bearer ${apiKey}`,
            "Content-Length": String(29 * 1024 * 1024),
          },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
          req.destroy();
        },
      );
      req.on("error", reject);
      req.write("{"); // start the body; the 413 must come from the declared length
    });
    expect(status).toBe(413);
  }, 15_000);
});
