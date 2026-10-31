import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canonicalResource, normalizeResource, resourceMetadataUrl } from "./oauth-resource";

/** Rubric O1-2 (docs/planning/openai-plugin-build/oauth.md). */
describe("oauth resource identity", () => {
  const saved = process.env["BACKEND_URL"];
  beforeEach(() => {
    process.env["BACKEND_URL"] = "https://mcp.example.net";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["BACKEND_URL"];
    else process.env["BACKEND_URL"] = saved;
  });

  it("the canonical resource is the origin, without a trailing slash", () => {
    expect(canonicalResource()).toBe("https://mcp.example.net");
    process.env["BACKEND_URL"] = "https://mcp.example.net/";
    expect(canonicalResource()).toBe("https://mcp.example.net");
    expect(resourceMetadataUrl()).toBe("https://mcp.example.net/.well-known/oauth-protected-resource");
  });

  it("falls back to the local default when BACKEND_URL is unset", () => {
    delete process.env["BACKEND_URL"];
    expect(canonicalResource()).toBe("http://localhost:3101");
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["https://mcp.example.net"],
    ["https://mcp.example.net/"],
    ["https://mcp.example.net/mcp"],
    ["https://mcp.example.net/mcp/"],
    ["https://MCP.example.net/mcp"],
    ["https://mcp.example.net:443/mcp"],
  ])("accepts %s as the canonical resource", (raw) => {
    expect(normalizeResource(raw)).toEqual({ ok: true, resource: "https://mcp.example.net" });
  });

  it.each([
    ["http://mcp.example.net"],
    ["https://mcp.example.net:8443"],
    ["https://other.example.net/mcp"],
    ["https://mcp.example.net.evil.test"],
    ["https://mcp.example.net/mcpx"],
    ["https://mcp.example.net/mcp/tools"],
    ["https://mcp.example.net/api"],
    ["https://mcp.example.net/mcp?x=1"],
    ["https://mcp.example.net/?"],
    ["https://mcp.example.net/#frag"],
    ["https://mcp.example.net#"],
    ["https://user:pw@mcp.example.net"],
    ["mcp.example.net"],
    ["not a url"],
  ])("refuses %s", (raw) => {
    expect(normalizeResource(raw)).toEqual({ ok: false });
  });

  it("keeps a path in BACKEND_URL as part of the identity", () => {
    process.env["BACKEND_URL"] = "https://example.net/soup";
    expect(normalizeResource("https://example.net/soup/mcp")).toEqual({ ok: true, resource: "https://example.net/soup" });
    expect(normalizeResource("https://example.net/mcp")).toEqual({ ok: false });
  });
});
