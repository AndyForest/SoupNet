import { describe, it, expect } from "vitest";
import { isRegisteredRedirectUri } from "./oauth-redirect";

describe("isRegisteredRedirectUri: exact match (F44, RFC 6749 §3.1.2.3)", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/cb"];

  it("accepts an exactly registered URI", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", registered)).toBe(true);
    expect(isRegisteredRedirectUri("http://localhost:3000/cb", registered)).toBe(true);
  });

  it("refuses an unregistered host (the F44 open-redirect case)", () => {
    expect(isRegisteredRedirectUri("https://evil.example/phish", registered)).toBe(false);
  });

  it("refuses the same origin with a different path", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/other/path", registered)).toBe(false);
  });

  it("refuses prefix and trailing-slash variants", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback/", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback?x=1", registered)).toBe(false);
  });

  it("refuses empty values, empty lists and unparseable values", () => {
    expect(isRegisteredRedirectUri("", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", [])).toBe(false);
    expect(isRegisteredRedirectUri("not a url", ["http://127.0.0.1/callback"])).toBe(false);
  });
});

describe("isRegisteredRedirectUri: any port on a loopback redirect (RFC 8252 §7.3)", () => {
  const codex = ["http://127.0.0.1/callback", "http://localhost/callback"];

  it("accepts the ephemeral port a native client listens on", () => {
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback", codex)).toBe(true);
    expect(isRegisteredRedirectUri("http://localhost:57687/callback", codex)).toBe(true);
    expect(isRegisteredRedirectUri("http://[::1]:57687/callback", ["http://[::1]/callback"])).toBe(true);
  });

  it("accepts a different port from a registered one, and a query that matches", () => {
    expect(isRegisteredRedirectUri("http://127.0.0.1:9000/cb", ["http://127.0.0.1:8000/cb"])).toBe(true);
    expect(isRegisteredRedirectUri("http://127.0.0.1:9000/cb?a=1", ["http://127.0.0.1/cb?a=1"])).toBe(true);
  });

  it("refuses a different path or query", () => {
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/other", codex)).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback/", codex)).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback?x=1", codex)).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/cb", ["http://127.0.0.1/cb?a=1"])).toBe(false);
  });

  it("never aliases one loopback host to another", () => {
    expect(isRegisteredRedirectUri("http://[::1]:57687/callback", codex)).toBe(false);
    expect(isRegisteredRedirectUri("http://localhost:57687/cb", ["http://127.0.0.1/cb"])).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/cb", ["http://localhost/cb"])).toBe(false);
  });

  it("refuses a loopback request against a non-loopback registration", () => {
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback", ["https://claude.ai/callback"])).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback", ["http://example.com/callback"])).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback", ["https://127.0.0.1/callback"])).toBe(false);
  });

  it("keeps https exact, on a loopback host as well as any other", () => {
    expect(isRegisteredRedirectUri("https://client.example:8443/cb", ["https://client.example/cb"])).toBe(false);
    expect(isRegisteredRedirectUri("https://client.example/cb", ["https://client.example:8443/cb"])).toBe(false);
    expect(isRegisteredRedirectUri("https://127.0.0.1:8443/cb", ["https://127.0.0.1/cb"])).toBe(false);
  });

  it("refuses names that only look like loopback", () => {
    expect(isRegisteredRedirectUri("http://localhost.evil.example:5000/callback", codex)).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1.evil.example:5000/callback", codex)).toBe(false);
    expect(isRegisteredRedirectUri("http://localhost.:5000/callback", codex)).toBe(false);
  });

  it.each([
    ["short IPv4", "http://127.1:5000/callback"],
    ["hex IPv4", "http://0x7f.0.0.1:5000/callback"],
    ["long IPv6", "http://[0:0:0:0:0:0:0:1]:5000/callback"],
    ["upper-case host", "http://LOCALHOST:5000/callback"],
    ["upper-case scheme", "HTTP://127.0.0.1:5000/callback"],
    ["default port", "http://127.0.0.1:80/callback"],
    ["empty port", "http://127.0.0.1:/callback"],
    ["dot segments", "http://127.0.0.1:5000/a/../callback"],
    ["backslash", "http:\\\\127.0.0.1:5000\\callback"],
    ["credentials", "http://user:pw@127.0.0.1:5000/callback"],
    ["credentials hiding the host", "http://127.0.0.1:5000@evil.example/callback"],
    ["empty credentials", "http://@127.0.0.1:5000/callback"],
    ["fragment", "http://127.0.0.1:5000/callback#x"],
    ["empty fragment", "http://127.0.0.1:5000/callback#"],
    ["empty query", "http://127.0.0.1:5000/callback?"],
  ])("refuses another spelling: %s", (_name, uri) => {
    expect(isRegisteredRedirectUri(uri, codex)).toBe(false);
  });

  it("gives a registration with credentials or a fragment no port freedom", () => {
    expect(isRegisteredRedirectUri("http://u:p@127.0.0.1:5000/cb", ["http://u:p@127.0.0.1/cb"])).toBe(false);
    expect(isRegisteredRedirectUri("http://127.0.0.1:5000/cb#", ["http://127.0.0.1/cb#"])).toBe(false);
  });
});
