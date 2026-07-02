import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./normalize-email";

describe("normalizeEmail", () => {
  it("lowercases the whole address", () => {
    expect(normalizeEmail("Alice@Example.COM")).toBe("alice@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  alice@example.com \n")).toBe("alice@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail("Alice@Example.com");
    expect(normalizeEmail(once)).toBe(once);
  });

  it("leaves an already-canonical address unchanged", () => {
    expect(normalizeEmail("alice@example.com")).toBe("alice@example.com");
  });
});
