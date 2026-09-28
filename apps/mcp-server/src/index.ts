/**
 * Soup.net MCP Server (stdio transport) — entry point.
 *
 * Reads configuration from the environment and connects the server built in
 * server.ts to stdio. Tool registrations live in server.ts so tests can build
 * the same server against an in-memory transport.
 *
 * Auth: SOUPNET_API_KEY env var. The same daily or scoped key shown on the
 * dashboard.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createStdioServer } from "./server.js";

const server = createStdioServer({
  backendUrl: process.env["SOUPNET_BACKEND_URL"] ?? "http://localhost:3101",
  apiKey: process.env["SOUPNET_API_KEY"] ?? "",
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] Soup.net MCP server started (stdio transport)");
}

main().catch((err) => {
  console.error("[mcp-server] Fatal error:", err);
  process.exit(1);
});
