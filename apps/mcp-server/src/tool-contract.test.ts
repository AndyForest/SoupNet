import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_SERVER_INSTRUCTIONS } from "@soupnet/domain";
import { createStdioServer } from "./server.js";

/**
 * The stdio server's side of the tool contract (OpenAI plugin directory
 * stream T, rows T-A5, T-D2, T-I1; the remote side is
 * apps/backend/src/routes/tool-contract.test.ts). The annotations follow the
 * remote server's rule in docs/connectors/openai-plugin.md; stdio's check
 * attaches a local file, never a URL, so it is closed-world here.
 */

const STDIO_FLAGS: Record<string, [boolean, boolean, boolean]> = {
  check_recipe: [false, false, false],
  search_recipes: [true, false, false],
  get_briefing: [true, false, false],
  get_recipes: [true, false, false],
  verify_draft: [false, true, false],
  log_feedback: [false, false, false],
};

async function connect() {
  const server = createStdioServer({ backendUrl: "http://localhost:0", apiKey: "k" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "contract", version: "0" });
  await client.connect(clientSide);
  return client;
}

describe("stdio tool contract (stream T)", () => {
  it("T-I1: initialize returns the shared instructions", async () => {
    const client = await connect();
    expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it("T-A5: every tool carries all three hints as explicit booleans, by the remote rule", async () => {
    const { tools } = await (await connect()).listTools();
    const flags = Object.fromEntries(
      tools.map((t) => [t.name, [t.annotations?.readOnlyHint, t.annotations?.destructiveHint, t.annotations?.openWorldHint]]),
    );
    expect(flags).toEqual(STDIO_FLAGS);
  });

  it("T-D2/T-P1: no promotional, comparative or plan wording in tools/list", async () => {
    const banned = /\b(powerful|best|seamless|smart(er|est)?|revolutionary|cutting-edge|world-class|premium|upgrade|pricing|subscription|free trial|checkout|plan)\b/i;
    for (const t of (await (await connect()).listTools()).tools) {
      expect(JSON.stringify({ d: t.description, s: t.inputSchema }).match(banned)?.[0], t.name).toBeUndefined();
    }
  });
});
