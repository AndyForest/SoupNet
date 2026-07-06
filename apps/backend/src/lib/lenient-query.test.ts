import { describe, it, expect } from "vitest";
import {
  decodeQueryComponentLenient,
  parseLenientQuery,
  rawQueryOfUrl,
} from "./lenient-query";

/**
 * Layer-1 tests for the lenient query decoder — the fix for the "%97
 * em-dash" storage artifact (windows-1252 percent-escapes that
 * decodeURIComponent rejects and Hono passes through raw).
 */

const EM_DASH = "—";

describe("decodeQueryComponentLenient", () => {
  it("decodes standard UTF-8 percent-escapes (em-dash)", () => {
    expect(decodeQueryComponentLenient("a%E2%80%94b")).toBe(`a${EM_DASH}b`);
  });

  it("decodes windows-1252 escapes that are invalid UTF-8 (%97 → em-dash)", () => {
    expect(decodeQueryComponentLenient("a%97b")).toBe(`a${EM_DASH}b`);
  });

  it("decodes other common 1252 punctuation (%91/%92 quotes, %85 ellipsis)", () => {
    expect(decodeQueryComponentLenient("%91x%92")).toBe("‘x’");
    expect(decodeQueryComponentLenient("wait%85")).toBe("wait…");
  });

  it("keeps a double-encoded literal %97 as text (no double decode)", () => {
    // %2597 is the correct encoding OF the literal three characters "%97" —
    // e.g. a recipe quoting this very bug. Must NOT collapse to an em-dash.
    expect(decodeQueryComponentLenient("a%2597b")).toBe("a%97b");
  });

  it("converts + to space", () => {
    expect(decodeQueryComponentLenient("a+b+c")).toBe("a b c");
  });

  it("passes plain ASCII through unchanged", () => {
    expect(decodeQueryComponentLenient("hello-world_1.2~x")).toBe(
      "hello-world_1.2~x",
    );
  });

  it("decodes multibyte UTF-8 (accents, CJK, emoji)", () => {
    expect(decodeQueryComponentLenient("caf%C3%A9")).toBe("café");
    expect(decodeQueryComponentLenient("%E6%97%A5%E6%9C%AC")).toBe("日本");
    expect(decodeQueryComponentLenient("%F0%9F%8D%9C")).toBe("\u{1F35C}");
  });

  it("tolerates a stray % that is not a valid escape", () => {
    expect(decodeQueryComponentLenient("100%")).toBe("100%");
    expect(decodeQueryComponentLenient("a%zzb")).toBe("a%zzb");
  });

  it("handles literal (unescaped) non-ASCII mixed with escapes", () => {
    expect(decodeQueryComponentLenient(`café%20x`)).toBe("café x");
  });
});

describe("parseLenientQuery", () => {
  it("reads named params with lenient decoding", () => {
    const get = parseLenientQuery("trace=a%97b&ef=c%E2%80%94d");
    expect(get("trace")).toBe(`a${EM_DASH}b`);
    expect(get("ef")).toBe(`c${EM_DASH}d`);
  });

  it("returns undefined for absent params and first occurrence for dupes", () => {
    const get = parseLenientQuery("a=1&a=2");
    expect(get("a")).toBe("1");
    expect(get("missing")).toBeUndefined();
  });

  it("treats a bare name as empty string", () => {
    const get = parseLenientQuery("flag&x=1");
    expect(get("flag")).toBe("");
  });

  it("handles an empty query string", () => {
    const get = parseLenientQuery("");
    expect(get("anything")).toBeUndefined();
  });
});

describe("rawQueryOfUrl", () => {
  it("extracts the raw query", () => {
    expect(rawQueryOfUrl("http://x/check?key=k&trace=a%97b")).toBe(
      "key=k&trace=a%97b",
    );
  });

  it("returns empty when no query", () => {
    expect(rawQueryOfUrl("http://x/check")).toBe("");
  });
});
