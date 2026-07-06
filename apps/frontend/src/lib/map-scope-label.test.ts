import { describe, it, expect } from "vitest";
import { describeMapScope, mapBriefingCount } from "./map-scope-label";

describe("describeMapScope", () => {
  it("reports a truly empty corpus plainly", () => {
    expect(describeMapScope(0, 0)).toBe("No recipes yet");
  });

  it("clarifies the tiny-corpus case instead of showing '0 clusters'", () => {
    expect(describeMapScope(1, 0)).toBe("1 recipe · not enough yet to cluster");
    expect(describeMapScope(3, 0)).toBe("3 recipes · not enough yet to cluster");
  });

  it("renders the normal case with singular/plural agreement", () => {
    expect(describeMapScope(1, 1)).toBe("1 recipe · 1 cluster");
    expect(describeMapScope(42, 5)).toBe("42 recipes · 5 clusters");
  });
});

describe("mapBriefingCount", () => {
  it("uses total traces when there are no clusters yet, instead of a misleading (0)", () => {
    expect(mapBriefingCount(1, 0)).toBe(1);
    expect(mapBriefingCount(3, 0)).toBe(3);
  });

  it("uses cluster count once clustering has kicked in", () => {
    expect(mapBriefingCount(42, 5)).toBe(5);
  });

  it("stays 0 for a truly empty corpus", () => {
    expect(mapBriefingCount(0, 0)).toBe(0);
  });
});
