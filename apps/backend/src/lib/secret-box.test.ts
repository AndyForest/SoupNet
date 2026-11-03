import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { secretBoxKey, seal, open, SecretBoxError } from "./secret-box";

// Layer 1 for the directory credential's encryption (stream Offboarding, OB-M2).

const key = crypto.randomBytes(32);

describe("secretBoxKey", () => {
  it("is null when unset", () => {
    expect(secretBoxKey("")).toBeNull();
    expect(secretBoxKey("  ")).toBeNull();
  });

  it("reads 64 hex characters or base64 of 32 bytes", () => {
    expect(secretBoxKey(key.toString("hex"))?.equals(key)).toBe(true);
    expect(secretBoxKey(key.toString("base64"))?.equals(key)).toBe(true);
  });

  it("refuses a key of the wrong length", () => {
    expect(() => secretBoxKey("abcd")).toThrow(SecretBoxError);
    expect(() => secretBoxKey(crypto.randomBytes(16).toString("base64"))).toThrow(SecretBoxError);
  });
});

describe("seal and open", () => {
  it("round-trips, with a fresh IV each time", () => {
    const a = seal(key, "refresh-token-value", "org-1");
    const b = seal(key, "refresh-token-value", "org-1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toContain("refresh-token-value");
    expect(open(key, a, "org-1")).toBe("refresh-token-value");
  });

  it("fails under another organization's id, another key, or a tampered value", () => {
    const sealed = seal(key, "secret", "org-1");
    expect(() => open(key, sealed, "org-2")).toThrow(SecretBoxError);
    expect(() => open(crypto.randomBytes(32), sealed, "org-1")).toThrow(SecretBoxError);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => open(key, { ...sealed, ciphertext: flipped.toString("base64") }, "org-1")).toThrow(SecretBoxError);
    expect(() => open(key, { ...sealed, keyVersion: 2 }, "org-1")).toThrow(SecretBoxError);
  });
});
