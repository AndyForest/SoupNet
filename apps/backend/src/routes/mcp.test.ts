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
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `mcp-test-${uid}@test.local`,
        password: "mcp-test-password-123",
        tosAccepted: true,
      }),
    });
    const regBody = (await reg.json()) as { data?: { token?: string; verificationToken?: string } };
    const t = regBody.data?.token;
    const vtok = regBody.data?.verificationToken;
    if (!t || !vtok) throw new Error("Setup failed");
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
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

  it("update_group_description tool updates a group the key has write access to", async () => {
    // Set up a fresh group + write-scoped key for this user.
    const uid = Date.now();
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `mcp-update-desc-${uid}@test.local`,
        password: "mcp-test-password-123",
        tosAccepted: true,
      }),
    });
    const regBody = (await reg.json()) as { data?: { token?: string; verificationToken?: string } };
    const jwt = regBody.data?.token ?? "";
    const vtok = regBody.data?.verificationToken ?? "";
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });

    const groupsRes = await fetch(`${BASE}/groups`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const groupsBody = (await groupsRes.json()) as { data: Array<{ organization_id: string }> };
    const orgId = groupsBody.data[0]?.organization_id;

    const newGroup = await fetch(`${BASE}/groups`, {
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
      body: JSON.stringify({ writeGroupId: targetGroupId }),
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    const writeKey = keyBody.data?.key ?? "";

    // tools/call via JSON-RPC over the streamable HTTP transport.
    const newDesc = `Edited via update_group_description tool at ${new Date(uid).toISOString()}`;
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
          name: "update_group_description",
          arguments: { group_id_or_slug: targetGroupId, description: newDesc },
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
    const verifyRes = await fetch(`${BASE}/groups`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const verifyBody = (await verifyRes.json()) as { data: Array<{ id: string; description: string | null }> };
    const updated = verifyBody.data.find((g) => g.id === targetGroupId);
    expect(updated?.description).toBe(newDesc);
  });

  it("update_group_description rejects keys without write access to the group", async () => {
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
          name: "update_group_description",
          arguments: { group_id_or_slug: stranger, description: "should not land" },
        },
        id: 2,
      }),
    });
    expect(callRes.status).toBe(200);
    const callText = await callRes.text();
    expect(callText.toLowerCase()).toContain("not found in your key's write groups");
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
});
