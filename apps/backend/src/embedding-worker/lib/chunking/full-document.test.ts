import { describe, it, expect } from "vitest";
import { chunkFullDocument } from "./full-document";

describe("chunkFullDocument", () => {
  it("returns exactly one chunk", () => {
    const result = chunkFullDocument("hello world");
    expect(result).toHaveLength(1);
  });

  it("chunkText matches input", () => {
    const input = "The quick brown fox jumps over the lazy dog.";
    const result = chunkFullDocument(input);
    expect(result[0]!.chunkText).toBe(input);
  });

  it("chunkHash is a 64-char hex string (SHA-256)", () => {
    const result = chunkFullDocument("test content");
    expect(result[0]!.chunkHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for the same input (deterministic)", () => {
    const a = chunkFullDocument("deterministic input");
    const b = chunkFullDocument("deterministic input");
    expect(a[0]!.chunkHash).toBe(b[0]!.chunkHash);
  });

  it("produces different hashes for different input", () => {
    const a = chunkFullDocument("input one");
    const b = chunkFullDocument("input two");
    expect(a[0]!.chunkHash).not.toBe(b[0]!.chunkHash);
  });

  it("chunkPath is 'doc'", () => {
    const result = chunkFullDocument("anything");
    expect(result[0]!.chunkPath).toBe("doc");
  });

  it("metadata is an empty object", () => {
    const result = chunkFullDocument("anything");
    expect(result[0]!.metadata).toEqual({});
  });
});
