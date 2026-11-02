import { describe, expect, it } from "vitest";
import { EmbeddingHttpError, isProviderSideFailure, parseRetryAfterMs } from "./errors";
import { backoffDelayMs } from "./provider-cooldown";

describe("embedding failure classification", () => {
  const http = (status: number, body = "") => new EmbeddingHttpError("Gemini", status, body);

  it("treats limits, outages, bad keys and a retired model as the provider's side", () => {
    for (const status of [401, 403, 404, 408, 429, 500, 503]) {
      expect(isProviderSideFailure(http(status))).toBe(true);
    }
    expect(isProviderSideFailure(http(400, '{"reason":"API_KEY_INVALID"}'))).toBe(true);
    expect(isProviderSideFailure(new TypeError("fetch failed"))).toBe(true);
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(isProviderSideFailure(timeout)).toBe(true);
  });

  it("leaves a refused input to the poison-pill path", () => {
    expect(isProviderSideFailure(http(400, '{"status":"INVALID_ARGUMENT"}'))).toBe(false);
    expect(isProviderSideFailure(new Error("No embedding returned"))).toBe(false);
    expect(isProviderSideFailure("not an error")).toBe(false);
  });

  it("reads the retry hint from the header or Google's error body", () => {
    expect(parseRetryAfterMs("12", "")).toBe(12_000);
    const now = Date.parse("2026-11-01T00:00:00Z");
    expect(parseRetryAfterMs("Sun, 01 Nov 2026 00:00:30 GMT", "", now)).toBe(30_000);
    expect(parseRetryAfterMs(null, '{"details":[{"retryDelay":"37s"}]}')).toBe(37_000);
    expect(parseRetryAfterMs(null, "{}")).toBeUndefined();
  });

  it("backs off exponentially, capped, and never under the provider's own hint", () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(20)).toBe(300_000);
    expect(backoffDelayMs(1, 90_000)).toBe(90_000);
  });
});
