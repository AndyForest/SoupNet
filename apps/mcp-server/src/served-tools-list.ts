/**
 * Test helper: what a client receives from tools/list, byte for byte.
 *
 * Connects a server to an in-memory transport, sends `initialize` then
 * `tools/list` as raw JSON-RPC, and returns the reply's `result` together
 * with its size serialized as minified UTF-8 JSON — the method the
 * drafts-and-triage build log uses for its tools/list baselines
 * (docs/planning/drafts-and-triage-build.md §Slice 1 baseline). Measuring
 * the served payload, rather than the description constants, counts the
 * JSON Schema scaffolding, enums, and annotations too.
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ServedToolsList {
  bytes: number;
  tools: Array<{ name: string; description?: string; inputSchema: { properties?: Record<string, Record<string, unknown>> } } & Record<string, unknown>>;
}

export async function servedToolsList(server: McpServer): Promise<ServedToolsList> {
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
  const reply = replies.get(2) as { result?: { tools: ServedToolsList["tools"] } } | undefined;
  if (!reply?.result) throw new Error("no tools/list reply");
  return { bytes: Buffer.byteLength(JSON.stringify(reply.result), "utf8"), tools: reply.result.tools };
}
