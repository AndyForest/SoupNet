import { describe, it, expect } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { MCP_SERVER_INSTRUCTIONS } from "@soupnet/domain";
import { createMcpServer } from "./mcp";
import { SYNTHESIS_INELIGIBLE_NOTICE } from "../services/synthesis.service";
import type { Principal } from "../authz";

/**
 * The tool contract the OpenAI plugin directory reviews (stream T, rubric in
 * docs/planning/openai-plugin-build/tool-contract.md; justifications in
 * docs/connectors/openai-plugin.md). In-process: the remote server's served
 * `initialize` and `tools/list`, as a client reads them. The stdio server's
 * side is apps/mcp-server/src/tool-contract.test.ts.
 */

const principal: Principal = {
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
};

interface ServedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { properties?: Record<string, unknown> };
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

type Connectable = { connect: (t: InMemoryTransport) => Promise<void>; close: () => Promise<void> };

/** initialize + tools/list over an in-memory transport, as a client sees them. */
async function served(server: Connectable): Promise<{ instructions?: string; tools: ServedTool[] }> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const replies = new Map<number, JSONRPCMessage>();
  client.onmessage = (m) => {
    const id = (m as { id?: unknown }).id;
    if (typeof id === "number") replies.set(id, m);
  };
  await server.connect(serverSide);
  await client.start();
  await client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract", version: "0" } } });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await client.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  for (let i = 0; i < 200 && !replies.has(2); i++) await new Promise((r) => setTimeout(r, 5));
  await server.close();
  const init = replies.get(1) as { result?: { instructions?: string } } | undefined;
  const list = replies.get(2) as { result?: { tools: ServedTool[] } } | undefined;
  if (!list?.result) throw new Error("no tools/list reply");
  return { ...(init?.result?.instructions !== undefined ? { instructions: init.result.instructions } : {}), tools: list.result.tools };
}
const remote = () => served(createMcpServer("http://localhost:0", principal) as unknown as Connectable);

/** [readOnlyHint, destructiveHint, openWorldHint] per tool, by the rule in
 *  docs/connectors/openai-plugin.md. A change here is a reviewed edit. */
const REMOTE_FLAGS: Record<string, [boolean, boolean, boolean]> = {
  check_recipe: [false, false, true],
  search_recipes: [true, false, false],
  get_briefing: [true, false, false],
  get_recipes: [true, false, false],
  verify_draft: [false, true, false],
  list_my_recipe_books: [true, false, false],
  update_recipe_book_description: [false, true, false],
  log_feedback: [false, false, false],
  get_profile: [true, false, false],
};

const flagsOf = (t: ServedTool) => [t.annotations?.["readOnlyHint"], t.annotations?.["destructiveHint"], t.annotations?.["openWorldHint"]];

describe("annotations (T-A1 to T-A4)", () => {
  it("T-A1: every remote tool carries a title and all three hints as explicit booleans", async () => {
    const { tools } = await remote();
    expect(tools.length).toBe(Object.keys(REMOTE_FLAGS).length);
    for (const t of tools) {
      expect(typeof t.annotations?.["title"], t.name).toBe("string");
      for (const f of flagsOf(t)) expect(typeof f, `${t.name}: ${JSON.stringify(t.annotations)}`).toBe("boolean");
    }
  });

  it("T-A2/A3/A4: the remote flags are exactly the reviewed table", async () => {
    const { tools } = await remote();
    expect(Object.fromEntries(tools.map((t) => [t.name, flagsOf(t)]))).toEqual(REMOTE_FLAGS);
  });

  it("T-A3: the description update says it replaces the text, and how the earlier text is seen", async () => {
    const { tools } = await remote();
    const d = tools.find((t) => t.name === "update_recipe_book_description")?.description ?? "";
    expect(d).toContain("Replaces");
    expect(d).toContain("the response shows the earlier text once");
  });
});

describe("descriptions (T-D1 to T-D3)", () => {
  it("T-D1: every remote description says when to use it and when not to", async () => {
    const { tools } = await remote();
    for (const t of tools) {
      const d = t.description ?? "";
      expect(d, t.name).toMatch(/\bUse\b/);
      expect(d, t.name).toMatch(/\bNot (for|needed)\b/);
    }
  });

  it("T-D2/T-P1: no promotional, comparative or plan wording anywhere in tools/list", async () => {
    const banned = /\b(powerful|best|seamless|smart(er|est)?|revolutionary|cutting-edge|world-class|premium|upgrade|pricing|subscription|free trial|checkout|plan)\b/i;
    for (const t of (await remote()).tools) {
      const text = JSON.stringify({ d: t.description, s: t.inputSchema });
      expect(text.match(banned)?.[0], t.name).toBeUndefined();
    }
    expect(SYNTHESIS_INELIGIBLE_NOTICE).not.toMatch(banned);
  });

  it("T-D3: a snake_case name in a description is a tool or one of that tool's parameters", async () => {
    const { tools } = await remote();
    const toolNames = new Set(tools.map((t) => t.name));
    for (const t of tools) {
      const params = new Set(Object.keys(t.inputSchema.properties ?? {}));
      for (const name of (t.description ?? "").match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? []) {
        expect(toolNames.has(name) || params.has(name) || name === "not_found_or_unreadable", `${t.name} names ${name}`).toBe(true);
      }
    }
  });
});

describe("server instructions (T-I1 to T-I3)", () => {
  it("T-I1: the remote server returns the shared text", async () => {
    expect((await remote()).instructions).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it("T-I2: the first 512 characters carry every cross-tool move, each naming its tool", () => {
    const head = MCP_SERVER_INSTRUCTIONS.slice(0, 512);
    for (const name of ["get_briefing", "check_recipe", "search_recipes", "get_recipes", "log_feedback", "verify_draft"]) {
      expect(head, name).toContain(name);
    }
    expect(head).toMatch(/before a judgment call/i);
    expect(head).toMatch(/after a decision/i);
  });

  it("T-I3: at most 1,200 characters, and no vendor or client names", () => {
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(1200);
    expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/OpenAI|ChatGPT|Codex|Claude|Anthropic|Gemini|Cursor/);
  });
});

describe("profile tool (T-F2, T-F3)", () => {
  it("is flagged as the profile tool and takes no parameters", async () => {
    const { tools } = await remote();
    const t = tools.find((x) => x.name === "get_profile");
    expect(t?._meta?.["openai/profile"]).toBe(true);
    expect(Object.keys(t?.inputSchema.properties ?? {})).toEqual([]);
  });
});
