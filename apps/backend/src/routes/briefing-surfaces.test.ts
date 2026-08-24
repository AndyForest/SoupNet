import { describe, it, expect, beforeAll } from "vitest";

/**
 * Layer 3 integration tests for the surface-profiled briefing (cold-start v2
 * Phase B; spec: docs/briefing-specs/briefing-surfaces.feature).
 *
 * The contract under test:
 *   - MCP surfaces (mcp-http tool, X-SoupNet-Surface: mcp-stdio) get the THIN
 *     profile: no setup cluster, no link formatting, no pasted-JSON section,
 *     no clustered exemplars by default — per-book Index lines instead.
 *   - Explicit verbosity opts exemplars back in on MCP.
 *   - Non-MCP surfaces (bare GET /briefing, POST /keys/briefing) keep the
 *     FULL artifact — setup sections and exemplars present, no Index lines.
 *
 * Requires a running backend (BACKEND_URL); runs under `npm run test:ci`.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

async function setupUserWithKey(tag: string): Promise<{ apiKey: string; jwt: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `brsurf-${tag}-${uid}@test.local`;
  const password = "brsurf-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error(`Setup failed: register (${tag})`);
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
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const jwt = loginBody.data?.token;
  if (!jwt) throw new Error(`Setup failed: login (${tag})`);
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const apiKey = keyBody.data?.key;
  if (!apiKey) throw new Error(`Setup failed: key (${tag})`);
  return { apiKey, jwt };
}

async function createTrace(apiKey: string, recipeText: string): Promise<void> {
  const ef = `Test evidence interpretation.\n> "verbatim test quote"\n-- integration test, 2026-08-23`;
  const url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(recipeText)}&ef=${encodeURIComponent(ef)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as { ok: boolean };
  if (!body.ok) throw new Error("Setup failed: createTrace");
}

async function mcpGetBriefing(apiKey: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "get_briefing", arguments: args },
      id: 1,
    }),
  });
  expect(res.status).toBe(200);
  return res.text();
}

const SETUP_HEADINGS = [
  "## Setup — MCP-capable agents",
  "## Setup — web-only agents",
  "## Formatting recipe-check links",
  "## When the user copies JSON results back",
];

describe.skipIf(!BASE)("surface-profiled briefings (cold-start v2 Phase B)", () => {
  let apiKey: string;
  let jwt: string;

  beforeAll(async () => {
    const setup = await setupUserWithKey("a");
    apiKey = setup.apiKey;
    jwt = setup.jwt;
    await createTrace(apiKey, "As a test engineer working on briefing surface profiles, I prefer a seeded recipe so that index-line assertions are deterministic.");
    await createTrace(apiKey, "As a test engineer working on briefing surface profiles, I prefer a second seeded recipe so that the index count is above one.");
  }, 60_000);

  it("MCP get_briefing default is the thin profile: no setup cluster, no exemplars, Index lines present", async () => {
    const raw = await mcpGetBriefing(apiKey);
    for (const heading of SETUP_HEADINGS) {
      expect(raw, `thin briefing must not carry "${heading}"`).not.toContain(heading);
    }
    expect(raw).not.toContain("## Context from");
    // Norms survive.
    expect(raw).toContain("## Principles");
    expect(raw).toContain("## Recipe format");
    expect(raw).toContain("## Closing the loop");
    // The per-book index (2 seeded recipes in the default book). The MCP
    // wire JSON-encodes the text, so match the escaped form loosely.
    expect(raw).toContain("Index: 2 recipes");
    expect(raw).toContain("newest judgment");
  });

  it("verbosity=high restores clustered exemplars on the MCP surface", async () => {
    const raw = await mcpGetBriefing(apiKey, { verbosity: "high" });
    expect(raw).toContain("## Context from");
    // Index lines coexist with the opted-in sample.
    expect(raw).toContain("Index: 2 recipes");
  });

  it("bare GET /briefing (rest surface) keeps the full artifact", async () => {
    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json()) as { ok: boolean; data?: { text: string; exemplarCount: number } };
    const text = body.data?.text ?? "";
    for (const heading of SETUP_HEADINGS) {
      expect(text, `full briefing must carry "${heading}"`).toContain(heading);
    }
    expect(body.data?.exemplarCount).toBeGreaterThanOrEqual(1);
    expect(text).toContain("## Context from");
    expect(text).not.toContain("Index: 2 recipes");
  });

  it("GET /briefing with X-SoupNet-Surface: mcp-stdio gets the thin profile", async () => {
    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-SoupNet-Surface": "mcp-stdio" },
    });
    const body = (await res.json()) as { ok: boolean; data?: { text: string; exemplarCount: number } };
    const text = body.data?.text ?? "";
    expect(text).not.toContain("## Setup — MCP-capable agents");
    expect(text).not.toContain("## Context from");
    expect(body.data?.exemplarCount).toBe(0);
    expect(text).toContain("Index: 2 recipes");
  });

  it("POST /keys/briefing (web dashboard) keeps the full artifact with no Index lines", async () => {
    const res = await fetch(`${BASE}/keys/briefing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ key: apiKey }),
    });
    const body = (await res.json()) as { ok: boolean; data?: { text: string; exemplarCount: number } };
    const text = body.data?.text ?? "";
    expect(text).toContain("## Setup — MCP-capable agents");
    expect(text).toContain("## Context from");
    expect(text).not.toContain("Index: 2 recipes");
  });

  it("list_my_recipe_books returns Index lines and no exemplar sample", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "list_my_recipe_books", arguments: {} },
        id: 2,
      }),
    });
    const raw = await res.text();
    expect(raw).toContain("## Your recipe books");
    expect(raw).toContain("Index: 2 recipes");
    expect(raw).not.toContain("## Context from");
  });
});
