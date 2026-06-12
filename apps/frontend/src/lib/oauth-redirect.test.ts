import { describe, it, expect } from "vitest";
import { isRegisteredRedirectUri } from "./oauth-redirect";

// F44: Cancel-path redirect validation is an exact string match against the
// client's registered URIs — the same contract the server enforces on the
// success path (RFC 6749 §3.1.2.3 simple string comparison).
describe("isRegisteredRedirectUri (F44)", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/cb"];

  it("accepts an exactly-registered URI", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", registered)).toBe(true);
  });

  it("rejects an unregistered host (the F44 open-redirect case)", () => {
    expect(isRegisteredRedirectUri("https://evil.example/phish", registered)).toBe(false);
  });

  it("rejects same-origin but different path", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/other/path", registered)).toBe(false);
  });

  it("rejects prefix and trailing-slash variants", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback/", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback?x=1", registered)).toBe(false);
  });

  it("rejects empty values and empty registration lists", () => {
    expect(isRegisteredRedirectUri("", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", [])).toBe(false);
  });
});
