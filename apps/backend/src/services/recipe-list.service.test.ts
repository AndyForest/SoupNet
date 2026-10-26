import { describe, it, expect } from "vitest";
import { parseSearchQuery } from "@soupnet/domain";
import { clampFlatListPage, flatListOrderFor, FLAT_LIST_MAX_PAGE } from "./recipe-list.service";

/** Layer 1: the flat list's pure helpers (drafts-and-triage slice 8b). */

function parsed(q: string) {
  const r = parseSearchQuery(q);
  if (!r.ok) throw new Error(r.error);
  return r.query;
}

describe("flatListOrderFor (rubric decision 3)", () => {
  it("lists newest judgment first by default", () => {
    expect(flatListOrderFor(parsed("author:me"))).toBe("judgment");
    expect(flatListOrderFor(parsed("-is:draft"))).toBe("judgment");
  });
  it("uses triage order for is:draft and is:expired", () => {
    expect(flatListOrderFor(parsed("is:draft"))).toBe("triage");
    expect(flatListOrderFor(parsed("is:expired"))).toBe("triage");
  });
  it("orders by latest change whenever changed-after: is set, drafts included", () => {
    expect(flatListOrderFor(parsed("changed-after:2026-10-01"))).toBe("changed");
    expect(flatListOrderFor(parsed("is:draft changed-after:2026-10-01"))).toBe("changed");
  });
});

describe("clampFlatListPage (S8b-P1, /check's lenient page)", () => {
  it("keeps a usable page and floors a fraction", () => {
    expect(clampFlatListPage(3)).toBe(3);
    expect(clampFlatListPage(2.7)).toBe(2);
  });
  it("reads a missing, zero, negative or unusable page as page 1", () => {
    expect(clampFlatListPage(undefined)).toBe(1);
    expect(clampFlatListPage(0)).toBe(1);
    expect(clampFlatListPage(-4)).toBe(1);
    expect(clampFlatListPage(Number.NaN)).toBe(1);
  });
  it("caps the page so no OFFSET can overflow", () => {
    expect(clampFlatListPage(Number.MAX_SAFE_INTEGER)).toBe(FLAT_LIST_MAX_PAGE);
    expect(clampFlatListPage(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
