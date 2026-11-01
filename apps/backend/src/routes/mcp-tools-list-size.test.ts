/**
 * Served tools/list budget for the remote MCP server (drafts-and-triage
 * slice 1: rubric S1-Z1, S1-Z4, S1-Z6; scenarios DT-TOOL-01..03).
 *
 * Measures what a client actually receives, not the description constants:
 * the server is built with createMcpServer and a stub Principal, connected to
 * an in-memory transport, and sent `initialize` then `tools/list` as raw
 * JSON-RPC. The reply's `result`, serialized as minified UTF-8 JSON, is the
 * method the build log's baseline used, so the feedback-row item schema,
 * annotations, and JSON Schema scaffolding all count. The character budget in
 * mcp-tool-descriptions.test.ts cannot see any of those.
 *
 * Measured (docs/planning/drafts-and-triage-build.md §Slice 1 baseline):
 *   before slice 1 (2026-09-27): 18,090 bytes
 *   after slice 1 (2026-09-27):  15,864 bytes, with impact and uncertainty added
 *   after slice 2 (2026-09-27):  16,854 bytes, with draft and verify_draft added
 *   after slice 3 (2026-09-27):  16,853 bytes (search_recipes query names is:draft, impact:, uncertainty:; cap not raised)
 *   after slice 4 (2026-09-27):  16,986 bytes (on_behalf_of)
 *   after slice 5 (2026-09-28):  16,986 bytes, identical for a headless key (S5-Z1)
 *   before slices 6 to 9 (2026-10-24): 16,986 bytes; cap raised ahead of them (PR A0, see below)
 * The stdio twin lives in apps/mcp-server/src/server.test.ts.
 */
import { describe, it, expect } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./mcp";
import type { Principal } from "../authz";

/** S1-Z1: the remote roster's served ceiling. Lower it when the roster
 *  shrinks; raise it only deliberately, with a dated reason (recipe 8dd573b4).
 *  16,000 → 17,000 (2026-09-27, drafts-and-triage slice 2): the `draft` param
 *  and the verify_draft tool, the one new agent operation the design names
 *  (recipe 6ae9a299). Measured 15,864 → 16,854; still 1,236 bytes under the
 *  pre-slice-1 roster (18,090).
 *  17,000 → 18,200 (2026-10-24, drafts-and-triage slices 6 to 9, scaffold PR A0):
 *  one raise sized for the whole batch so parallel streams never edit this
 *  line: the `outcome` enumeration on verify_draft (6c), the `intent:` term
 *  in search_recipes (6a), and the log_feedback / get_recipes enumerations
 *  moved into parameter descriptions (8a). Each PR records its bytes in
 *  spec-decision-log.md; after slices 8b and 6b merge the cap is re-tightened
 *  to the measured figure (docs/planning/drafts-and-triage-slices-6-9-
 *  implementation-plan.md, PR A0).
 *  18,200 → 18,950 (2026-10-26, OpenAI plugin directory stream T): every
 *  description in the reviewed shape (what it does, when to use it, when not
 *  to and what to use instead), the get_profile tool the directory asks for,
 *  and explicit annotations on every tool. Measured 17,904 on main (with
 *  slice 8b's page parameter) → 18,930; the profile tool is about 400 of the
 *  1,026 bytes. Stream O's per-tool securitySchemes land after this and move
 *  the cap again by their own measured bytes (docs/connectors/openai-plugin.md).
 *  18,950 → 19,600 (2026-10-26, OpenAI plugin directory stream O, item 12,
 *  measured on main after T's #150): every tool's `_meta.securitySchemes`,
 *  616 bytes over the nine tools (18,930 → 19,546). */
const REMOTE_TOOLS_LIST_MAX_BYTES = 19_600;

const stubPrincipal: Principal = {
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
  description?: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>> };
}

/** Send initialize + tools/list over an in-memory transport and return the
 *  reply's `result` as the server serialized it, with its UTF-8 size. */
async function servedToolsList(principal: Principal = stubPrincipal): Promise<{ bytes: number; tools: ServedTool[]; json: string }> {
  const server = createMcpServer("http://localhost:0", principal);
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
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "size-probe", version: "0" } },
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await client.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  for (let i = 0; i < 200 && !replies.has(2); i++) await new Promise((r) => setTimeout(r, 5));
  await server.close();
  const reply = replies.get(2) as { result?: { tools: ServedTool[] } } | undefined;
  if (!reply?.result) throw new Error("no tools/list reply");
  const json = JSON.stringify(reply.result);
  return { bytes: Buffer.byteLength(json, "utf8"), tools: reply.result.tools, json };
}

function tool(tools: ServedTool[], name: string): ServedTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not served`);
  return t;
}

describe("remote MCP tools/list as served (drafts-and-triage slice 1)", () => {
  it(`S1-Z1 / DT-TOOL-01: the served payload is at most ${REMOTE_TOOLS_LIST_MAX_BYTES} bytes`, async () => {
    const { bytes } = await servedToolsList();
    expect(bytes, `served tools/list is ${bytes} bytes`).toBeLessThanOrEqual(REMOTE_TOOLS_LIST_MAX_BYTES);
  });

  it("S5-Z1: a headless key is served the same tools/list, byte for byte, verify_draft included", async () => {
    const ordinary = await servedToolsList();
    const headless = await servedToolsList({ ...stubPrincipal, depositLevel: "drafts" });
    expect(headless.json).toBe(ordinary.json);
    expect(headless.tools.map((t) => t.name)).toContain("verify_draft");
  });

  it("S1-B1 / DT-TOOL-01: check_recipe lists impact and uncertainty as plain strings naming the vocabulary", async () => {
    const props = tool((await servedToolsList()).tools, "check_recipe").inputSchema.properties ?? {};
    for (const name of ["impact", "uncertainty"]) {
      expect(props[name], name).toBeDefined();
      // Not an enum: an unrecognized value must reach the service and become
      // a notice rather than an SDK validation error (S1-B3, recipe 4cfd166e).
      expect(props[name]?.["type"]).toBe("string");
      expect(props[name]?.["enum"]).toBeUndefined();
      expect(String(props[name]?.["description"])).toContain("low | medium | high");
    }
    // S1-B6: the check-level impact says it is not a feedback row's impact.
    expect(String(props["impact"]?.["description"])).toContain("feedback row");
  });

  it("S2-B1: check_recipe serves draft as an optional boolean", async () => {
    const t = tool((await servedToolsList()).tools, "check_recipe");
    expect(t.inputSchema.properties?.["draft"]?.["type"]).toBe("boolean");
    expect((t.inputSchema as { required?: string[] }).required ?? []).not.toContain("draft");
  });

  it("S2-B10 / S6c-M2: verify_draft is served with a required recipe_id and supporting_evidence, and an optional outcome", async () => {
    const t = tool((await servedToolsList()).tools, "verify_draft");
    const props = t.inputSchema.properties ?? {};
    expect(Object.keys(props).sort()).toEqual(["outcome", "recipe_id", "supporting_evidence"]);
    expect(((t.inputSchema as { required?: string[] }).required ?? []).sort()).toEqual(["recipe_id", "supporting_evidence"]);
    // A plain string naming the values, not an enum: the service refuses an
    // unknown value itself, together with any evidence problem (S6c-B6).
    expect(props["outcome"]?.["type"]).toBe("string");
    expect(props["outcome"]?.["enum"]).toBeUndefined();
    expect(String(props["outcome"]?.["description"])).toContain("verified (default) | rejected | not_chosen");
  });

  it("S1-Z6 / DT-TOOL-02: clusters and max_chars stay declared with a one-line pointer to verbosity", async () => {
    const props = tool((await servedToolsList()).tools, "check_recipe").inputSchema.properties ?? {};
    for (const name of ["clusters", "max_chars"]) {
      const description = String(props[name]?.["description"]);
      expect(props[name]?.["type"], name).toBe("number");
      expect(description).toContain("verbosity");
      expect(description).not.toContain("\n");
      expect(description.length).toBeLessThanOrEqual(60);
    }
  });

  it("S1-Z4 / DT-TOOL-03: feedback on check_recipe points to log_feedback instead of inlining the row schema", async () => {
    const { tools } = await servedToolsList();
    const feedback = tool(tools, "check_recipe").inputSchema.properties?.["feedback"] ?? {};
    const items = feedback["items"] as { properties?: unknown; additionalProperties?: unknown };
    expect(items.properties, "feedback items repeat no per-field schema").toBeUndefined();
    // Open item schema: every row field reaches the handler (the SDK would
    // strip undeclared keys from a closed object).
    expect(items.additionalProperties, "feedback items stay open").not.toBe(false);
    expect(String(feedback["description"])).toContain("log_feedback");
  });

  it("recipe 9dbcfb77: search_recipes declares no feedback parameter", async () => {
    const { tools } = await servedToolsList();
    expect(tool(tools, "search_recipes").inputSchema.properties).not.toHaveProperty("feedback");
  });

  // briefing_id joined the row fields in slice 8a (a briefing as a feedback
  // target, S8a-O5); every field declared before stays.
  it("log_feedback's own schema keeps every row field it declared before slice 1", async () => {
    const props = tool((await servedToolsList()).tools, "log_feedback").inputSchema.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      "agent_id", "briefing_id", "disposition", "harness", "harness_version", "impact", "intent_id", "kind", "model",
      "note", "related_trace_ids", "search_id", "session_id", "story", "story_fulfilled", "top_similarity", "trace_id",
    ]);
    expect(props["impact"]?.["description"]).toBe("none | new | subtle | big | operational");
  });
});
