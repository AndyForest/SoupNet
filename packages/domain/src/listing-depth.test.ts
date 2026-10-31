import { describe, it, expect } from "vitest";
import { LISTING_DEPTH_MAX, lastReachablePage, pageBeyondReach, searchPageBeyondReachError, FLAT_LIST_NARROWING } from "./listing-depth";

/** Layer 1: the listing depth (audit findings F105 and F110). */

describe("lastReachablePage and pageBeyondReach", () => {
  it("is the last page whose first row is within the first 10,000", () => {
    expect(LISTING_DEPTH_MAX).toBe(10_000);
    expect(lastReachablePage(50)).toBe(200);
    expect(lastReachablePage(200)).toBe(50);
    expect(lastReachablePage(20)).toBe(500);
    expect(lastReachablePage(3)).toBe(3334);
    expect(lastReachablePage(1)).toBe(10_000);
  });

  it("refuses the page after it and nothing before it", () => {
    expect(pageBeyondReach(200, 50)).toBe(false);
    expect(pageBeyondReach(201, 50)).toBe(true);
    expect(pageBeyondReach(1, 50)).toBe(false);
    expect(pageBeyondReach(Number.MAX_SAFE_INTEGER, 20)).toBe(true);
  });

  it("treats an unusable page size as one row a page", () => {
    expect(lastReachablePage(0)).toBe(10_000);
    expect(lastReachablePage(0.5)).toBe(10_000);
  });
});

describe("searchPageBeyondReachError", () => {
  it("names the page, the reach and the pages that exist, then the way to narrow", () => {
    expect(searchPageBeyondReachError(201, 50, FLAT_LIST_NARROWING)).toBe(
      "page 201 is past what a search pages through: the first 10,000 results (pages 1 to 200 at 50 per page). "
      + "Narrow the query with changed-after:, created-after: or read_recipe_books to reach the rest.",
    );
  });
});
