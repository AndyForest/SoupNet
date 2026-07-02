import { describe, it, expect, beforeEach } from "vitest";
import {
  mapLayoutCacheKey,
  getCachedMapLayout,
  setCachedMapLayout,
  clearMapLayoutCache,
} from "./map-layout-cache";

// Layer 1 — pure module, no I/O.

describe("map-layout-cache", () => {
  beforeEach(() => clearMapLayoutCache());

  const baseParts = {
    groupIds: ["b", "a"],
    k: 5,
    maxChars: undefined,
    expand: false,
    strategy: undefined,
    corpusVersion: "100:2026-07-02",
  };

  it("key is order-insensitive for groupIds and version-sensitive", () => {
    const k1 = mapLayoutCacheKey(baseParts);
    const k2 = mapLayoutCacheKey({ ...baseParts, groupIds: ["a", "b"] });
    expect(k1).toBe(k2);
    const k3 = mapLayoutCacheKey({ ...baseParts, corpusVersion: "101:2026-07-02" });
    expect(k3).not.toBe(k1);
  });

  it("key distinguishes clustering params", () => {
    const k1 = mapLayoutCacheKey(baseParts);
    expect(mapLayoutCacheKey({ ...baseParts, k: 10 })).not.toBe(k1);
    expect(mapLayoutCacheKey({ ...baseParts, expand: true })).not.toBe(k1);
    expect(mapLayoutCacheKey({ ...baseParts, strategy: "exp_full_headed" })).not.toBe(k1);
  });

  it("get/set round-trips and misses on unknown keys", () => {
    const key = mapLayoutCacheKey(baseParts);
    expect(getCachedMapLayout(key)).toBeUndefined();
    setCachedMapLayout(key, { hello: 1 });
    expect(getCachedMapLayout(key)).toEqual({ hello: 1 });
  });

  it("evicts the least-recently-used entry past the cap", () => {
    // Fill beyond the cap of 16; entry 0 should evict first...
    for (let i = 0; i < 16; i++) setCachedMapLayout(`k${i}`, i);
    // ...unless refreshed by a read.
    expect(getCachedMapLayout("k0")).toBe(0);
    setCachedMapLayout("k16", 16);
    expect(getCachedMapLayout("k0")).toBe(0); // refreshed — survived
    expect(getCachedMapLayout("k1")).toBeUndefined(); // oldest unrefreshed — evicted
    expect(getCachedMapLayout("k16")).toBe(16);
  });
});
