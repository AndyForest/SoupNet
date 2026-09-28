import { describe, it, expect } from "vitest";
import { safeReturnTarget, loginPathFor } from "./return-target.js";

describe("safeReturnTarget (S3-L5: no open redirect)", () => {
  it("honours same-origin paths under /app/, query and hash kept", () => {
    expect(safeReturnTarget("/app/drafts?ids=a,b")).toBe("/app/drafts?ids=a,b");
    expect(safeReturnTarget("/app/drafts?ids=11111111-1111-4111-8111-111111111111")).toBe("/app/drafts?ids=11111111-1111-4111-8111-111111111111");
    expect(safeReturnTarget("/app/traces/abc#evidence")).toBe("/app/traces/abc#evidence");
    expect(safeReturnTarget("/app/dashboard")).toBe("/app/dashboard");
  });

  it("ignores absolute, protocol-relative, and scheme targets", () => {
    for (const bad of [
      "https://example.com/",
      "http://example.com/app/drafts",
      "//example.com/",
      "//example.com/app/drafts",
      "javascript:alert(1)",
      "data:text/html,hi",
      "example.com/app/drafts",
    ]) {
      expect(safeReturnTarget(bad), bad).toBeNull();
    }
  });

  it("ignores backslash and control-character tricks", () => {
    for (const bad of ["/\\example.com", "\\\\example.com", "/app/\\..\\auth", "/app/drafts\n", "/app/ drafts", "/app/drafts\u0000"]) {
      expect(safeReturnTarget(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("ignores other in-app paths and paths that normalize out of /app/", () => {
    for (const bad of ["/", "/auth/login", "/admin", "/app", "/application", "/app/../admin", "/app/%2e%2e/admin", "/info/terms"]) {
      expect(safeReturnTarget(bad), bad).toBeNull();
    }
  });

  it("ignores percent-encoded separators and dots in the path, either case (fix pass)", () => {
    for (const bad of [
      "/app/..%2Fadmin", "/app/..%2fadmin", "/app/%2F%2Fevil.com", "/app/%5C%5Cevil.com", "/app/%5cevil",
      "/app/.%2e/admin", "/app/%2E%2E/admin", "/app/%252F..%252Fadmin",
    ]) {
      expect(safeReturnTarget(bad), bad).toBeNull();
    }
  });

  it("still accepts encoded characters in the query (an ids list with an encoded comma)", () => {
    expect(safeReturnTarget("/app/drafts?ids=a%2Cb")).toBe("/app/drafts?ids=a%2Cb");
    expect(safeReturnTarget("/app/drafts?q=%22cache%22")).toBe("/app/drafts?q=%22cache%22");
  });

  it("ignores empty, missing, and oversized values", () => {
    expect(safeReturnTarget(null)).toBeNull();
    expect(safeReturnTarget(undefined)).toBeNull();
    expect(safeReturnTarget("")).toBeNull();
    expect(safeReturnTarget(`/app/drafts?ids=${"a".repeat(3000)}`)).toBeNull();
  });

  it("loginPathFor carries a safe target and drops an unsafe one", () => {
    expect(loginPathFor("/app/drafts?ids=a,b")).toBe("/auth/login?next=%2Fapp%2Fdrafts%3Fids%3Da%2Cb");
    expect(loginPathFor("https://example.com/")).toBe("/auth/login");
  });
});
