import { describe, it, expect, beforeEach } from "vitest";
import {
  mapLayoutCacheKey,
  getCachedMapLayout,
  setCachedMapLayout,
  clearMapLayoutCache,
} from "./map-layout-cache";
import { SHARED_AUDIENCE } from "../authz";
import type { DraftAudience } from "../authz";

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
    audience: SHARED_AUDIENCE,
  };

  it("a cached layout is only ever the shared audience's: a viewer audience cannot build a key", () => {
    // The cache is process-wide and its key names no viewer, so a layout
    // computed with one person's drafts in it would be served to everyone.
    // The type admits only SHARED_AUDIENCE; this pins the runtime check too.
    const viewer = { viewerUserId: "11111111-1111-4111-8111-111111111111" } as unknown as typeof SHARED_AUDIENCE;
    expect(() => mapLayoutCacheKey({ ...baseParts, audience: viewer })).toThrow(/shared audience/);
    const widened: DraftAudience = SHARED_AUDIENCE;
    expect(() => mapLayoutCacheKey({ ...baseParts, audience: widened as typeof SHARED_AUDIENCE })).not.toThrow();
  });

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
