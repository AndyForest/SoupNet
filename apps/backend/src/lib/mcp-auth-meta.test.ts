import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../routes/mcp";
import type { Principal } from "../authz";
import { securitySchemesFor, toolAuthChallenge, toolCallAuthErrorBody, toolCallId } from "./mcp-auth-meta";

/** Rubric O6-1 and the pieces of O6-2 that need no running backend
 *  (docs/planning/openai-plugin-build/oauth.md). */

const saved = process.env["BACKEND_URL"];
beforeEach(() => {
  process.env["BACKEND_URL"] = "https://mcp.example.net";
});
afterEach(() => {
  if (saved === undefined) delete process.env["BACKEND_URL"];
  else process.env["BACKEND_URL"] = saved;
});

const stubPrincipal: Principal = {
  keyId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  keyType: "oauth",
  oauthClientId: "oauth_stub",
  expiresAt: new Date("2099-01-01T00:00:00Z"),
  depositLevel: "full",
  readGroupIds: [],
  writeGroupIds: [],
  defaultWriteGroupId: null,
  expiredReadGroupIds: [],
};

interface ServedTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  _meta?: { securitySchemes?: unknown };
}

async function servedTools(): Promise<ServedTool[]> {
  const server = createMcpServer("http://localhost:0", stubPrincipal);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const replies = new Map<number, JSONRPCMessage>();
  client.onmessage = (m) => {
    const id = (m as { id?: unknown }).id;
    if (typeof id === "number") replies.set(id, m);
  };
  await server.connect(serverSide);
  await client.start();
  await client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "meta-probe", version: "0" } },
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await client.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  for (let i = 0; i < 200 && !replies.has(2); i++) await new Promise((r) => setTimeout(r, 5));
  await server.close();
  const reply = replies.get(2) as { result?: { tools: ServedTool[] } } | undefined;
  if (!reply?.result) throw new Error("no tools/list reply");
  return reply.result.tools;
}

describe("per-tool securitySchemes (O6-1)", () => {
  it("every served tool declares oauth2 schemes that follow its readOnlyHint", async () => {
    const tools = await servedTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      const expected = t.annotations?.readOnlyHint === true ? ["read"] : ["read", "write"];
      expect(t._meta?.securitySchemes, t.name).toEqual([{ type: "oauth2", scopes: expected }]);
    }
  });

  it("maps annotations to scopes", () => {
    expect(securitySchemesFor({ readOnlyHint: true })).toEqual([{ type: "oauth2", scopes: ["read"] }]);
    expect(securitySchemesFor({ readOnlyHint: false })).toEqual([{ type: "oauth2", scopes: ["read", "write"] }]);
    expect(securitySchemesFor(undefined)).toEqual([{ type: "oauth2", scopes: ["read", "write"] }]);
  });
});

describe("the tool-level challenge (O6-2)", () => {
  it("names the protected-resource metadata, with error and error_description", () => {
    expect(toolAuthChallenge("missing")).toBe(
      'Bearer resource_metadata="https://mcp.example.net/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Sign in to Soup.net to use this tool"',
    );
    expect(toolAuthChallenge("invalid")).toBe(
      'Bearer resource_metadata="https://mcp.example.net/.well-known/oauth-protected-resource", error="invalid_token", error_description="The access token is invalid or expired"',
    );
  });

  it("is a tool error result paired by id", () => {
    expect(toolCallAuthErrorBody(7, "invalid", "dead key")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        content: [{ type: "text", text: "dead key" }],
        isError: true,
        _meta: { "mcp/www_authenticate": [toolAuthChallenge("invalid")] },
      },
    });
  });

  const req = (body: string) => new Request("https://mcp.example.net/mcp", { method: "POST", body });

  it("finds the id of a single tools/call and leaves the request readable", async () => {
    const r = req(JSON.stringify({ jsonrpc: "2.0", id: "a1", method: "tools/call", params: { name: "get_briefing" } }));
    expect(await toolCallId(r)).toBe("a1");
    expect(((await r.json()) as { id: string }).id).toBe("a1");
  });

  it.each([
    ["another method", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })],
    ["a batch", JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/call" }])],
    ["a notification", JSON.stringify({ jsonrpc: "2.0", method: "tools/call" })],
    ["an object id", JSON.stringify({ jsonrpc: "2.0", id: { x: 1 }, method: "tools/call" })],
    ["not JSON", "tools/call"],
  ])("ignores %s", async (_label, body) => {
    expect(await toolCallId(req(body))).toBeUndefined();
  });
});
