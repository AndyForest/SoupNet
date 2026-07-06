import { describe, it, expect } from "vitest";
import { localizeConnectDocs, HOSTED_MCP_HOST } from "./localize-connect-docs";

describe("localizeConnectDocs", () => {
  it("is a no-op on the hosted deployment (apiBase already equals the hosted host)", () => {
    const md = `Paste this URL: \`${HOSTED_MCP_HOST}/mcp\``;
    expect(localizeConnectDocs(md, HOSTED_MCP_HOST)).toBe(md);
  });

  it("substitutes the hosted host with the deployment's own backend origin for self-hosters", () => {
    const md = `Paste this URL: \`${HOSTED_MCP_HOST}/mcp\` — guide: \`${HOSTED_MCP_HOST}/docs/recipe-check-guide\``;
    const result = localizeConnectDocs(md, "https://soup.example.org");
    expect(result).toBe("Paste this URL: `https://soup.example.org/mcp` — guide: `https://soup.example.org/docs/recipe-check-guide`");
  });

  it("substitutes with a local dev backend origin", () => {
    const md = `\`${HOSTED_MCP_HOST}/mcp\``;
    expect(localizeConnectDocs(md, "http://localhost:3101")).toBe("`http://localhost:3101/mcp`");
  });

  it("leaves the markdown untouched when apiBase is empty/undefined (same-origin deployments)", () => {
    const md = `\`${HOSTED_MCP_HOST}/mcp\``;
    expect(localizeConnectDocs(md, undefined)).toBe(md);
    expect(localizeConnectDocs(md, "")).toBe(md);
  });
});
