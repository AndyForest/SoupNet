import { describe, it, expect } from "vitest";
import { validateRedirectUri, hashOpaque } from "./oauth.service";

describe("validateRedirectUri", () => {
  it("accepts https URIs", () => {
    expect(validateRedirectUri("https://claude.ai/api/mcp/auth_callback")).toEqual({ ok: true });
    expect(validateRedirectUri("https://claude.com/api/mcp/auth_callback")).toEqual({ ok: true });
  });

  it("accepts http://localhost variants for development", () => {
    expect(validateRedirectUri("http://localhost:3000/callback")).toEqual({ ok: true });
    expect(validateRedirectUri("http://127.0.0.1:8080/cb")).toEqual({ ok: true });
    expect(validateRedirectUri("http://[::1]:8080/cb")).toEqual({ ok: true });
  });

  it("rejects http:// for non-localhost hosts", () => {
    const result = validateRedirectUri("http://example.com/cb");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/https/);
  });

  it("rejects URIs with a fragment (RFC 6749 §3.1.2)", () => {
    const result = validateRedirectUri("https://example.com/cb#frag");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/fragment/);
  });

  it("rejects unparseable values", () => {
    expect(validateRedirectUri("not a url").ok).toBe(false);
    expect(validateRedirectUri("").ok).toBe(false);
  });

  it("rejects extremely long URIs", () => {
    const long = "https://example.com/" + "a".repeat(3000);
    const result = validateRedirectUri(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/max length/);
  });
});

describe("hashOpaque", () => {
  it("produces a deterministic SHA-256 hex digest", () => {
    expect(hashOpaque("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("produces different hashes for different inputs", () => {
    expect(hashOpaque("a")).not.toBe(hashOpaque("b"));
  });
});
