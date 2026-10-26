/**
 * Cross-surface checks for the two MCP servers (drafts-and-triage slice 8a).
 *
 * The remote server (apps/backend) and the stdio server (apps/mcp-server)
 * each typecheck with rootDir "src", so neither app's tests can import the
 * other. This file sits outside both and builds each server in-process.
 *
 * - S8a-V3: log_feedback serves the same parameters, with the same schemas,
 *   on both servers.
 * - The unknown-parameter guard reads accepted names from the SDK's private
 *   tool registry (toolParamsFromRegistry). If an SDK upgrade moves it, this
 *   test names the cause directly; the through-the-server refusal tests would
 *   only fail without saying why (audit note on stream D, 2026-10-24).
 * - S8a-U2 on stdio: with the guard the stdio entry installs, a check_recipe
 *   naming an undeclared parameter writes nothing through the live backend
 *   (skipped without BACKEND_URL).
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { guardUnknownParams, toolParamsFromRegistry } from "@soupnet/domain";
import type { McpTransportLike } from "@soupnet/domain";
import { createMcpServer } from "../apps/backend/src/routes/mcp.ts";
import type { Principal } from "../apps/backend/src/authz/index.ts";
import { getDb } from "../apps/backend/src/db.ts";
import { seedVerifiedUser } from "../apps/backend/src/test-users.ts";
import { createStdioServer } from "../apps/mcp-server/src/server.ts";
import { servedToolsList } from "../apps/mcp-server/src/served-tools-list.ts";

const BASE = process.env["BACKEND_URL"] ?? "";

const stubPrincipal = {
  keyId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  keyType: "daily",
  oauthClientId: null,
  expiresAt: new Date("2099-01-01T00:00:00Z"),
  depositLevel: "full",
  readGroupIds: [],
  writeGroupIds: [],
  defaultWriteGroupId: null,
  expiredReadGroupIds: [],
} as Principal;

function remote() {
  return createMcpServer("http://localhost:0", stubPrincipal);
}

function stdio(backendUrl = "http://backend.test", apiKey = "k") {
  return createStdioServer({ backendUrl, apiKey });
}

describe("MCP surface parity (slice 8a)", () => {
  it("S8a-V3: log_feedback serves identical parameters and schemas on the remote and stdio servers", async () => {
    const [r, s] = await Promise.all([servedToolsList(remote()), servedToolsList(stdio())]);
    const pick = (tools: typeof r.tools) => tools.find((t) => t.name === "log_feedback")!.inputSchema;
    expect(pick(s.tools)).toEqual(pick(r.tools));
  });

  it("the guard can read every registered tool's parameters on both servers (SDK registry pin)", () => {
    for (const [server, tools] of [
      [remote(), ["check_recipe", "search_recipes", "get_briefing", "get_recipes", "log_feedback", "verify_draft"]],
      [stdio(), ["check_recipe", "search_recipes", "get_briefing", "get_recipes", "log_feedback", "verify_draft"]],
    ] as const) {
      const accepted = toolParamsFromRegistry(server);
      for (const tool of tools) {
        expect(accepted(tool)?.length, `${tool}: no parameter names read from the SDK registry`).toBeGreaterThan(0);
      }
    }
  });
});

describe.skipIf(!BASE)("stdio unknown-parameter refusal through the live backend (S8a-U2)", () => {
  it("a refused check_recipe writes no trace and no recipe.checked row", async () => {
    const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const login = await seedVerifiedUser(`parity-${run}@test.local`, "parity-test-password-123");
    const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
    const keyRes = await fetch(`${BASE}/keys/daily`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` } });
    const apiKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
    const me = (await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${jwt}` } })).json()) as { data?: { id?: string; user?: { id?: string } } };
    const userId = me.data?.user?.id ?? me.data?.id ?? "";
    expect(apiKey && userId).toBeTruthy();

    const counts = async () => ((await getDb().execute(sql`
      SELECT
        (SELECT count(*)::int FROM claimnet.audit_log WHERE action = 'recipe.checked' AND actor_user_id = ${userId}::uuid) AS checks,
        (SELECT count(*)::int FROM claimnet.traces WHERE user_id = ${userId}::uuid) AS traces
    `)) as unknown as Array<{ checks: number; traces: number }>)[0];
    const before = await counts();

    const server = stdio(BASE, apiKey);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "parity-test", version: "0" });
    await server.connect(serverSide);
    guardUnknownParams(serverSide as unknown as McpTransportLike, toolParamsFromRegistry(server), "refuse");
    await client.connect(clientSide);
    try {
      const r = await client.callTool({
        name: "check_recipe",
        arguments: {
          recipe: `As a developer testing the stdio guard, I chose refusal so that a typo never writes. (${run})`,
          supporting_evidence: `Why.\n> "quote"\n-- parity suite`,
          recipe_boook: "soupnet-oss",
        },
      });
      expect(r.isError).toBe(true);
      expect((r.content as Array<{ text: string }>)[0]!.text).toMatch(/^Error: check_recipe does not take recipe_boook\b.*Nothing was run;/);
    } finally {
      await client.close();
      await server.close();
    }
    expect(await counts()).toEqual(before);
  }, 30_000);
});
