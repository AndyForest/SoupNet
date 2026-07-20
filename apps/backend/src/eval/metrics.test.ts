import { describe, it, expect } from "vitest";
import {
  rankDiscount,
  dcg,
  ndcg,
  shareAtK,
  recallAtK,
  kendallTau,
  serendipityAtL,
  aspectCoverage,
  exemplarOrderNdcg,
  firstExemplarGrade,
  displayRedundancy,
  mean,
} from "./metrics";

// Layer 1 unit tests — pure functions, 100% branch coverage.

describe("rankDiscount / dcg", () => {
  it("discounts by 1/log2(rank+1)", () => {
    expect(rankDiscount(1)).toBe(1);
    expect(rankDiscount(3)).toBeCloseTo(0.5, 10);
  });

  it("dcg sums discounted gains over the whole list by default", () => {
    // 3/log2(2) + 1/log2(3) + 2/log2(4)
    expect(dcg([3, 1, 2])).toBeCloseTo(3 + 1 / Math.log2(3) + 1, 10);
  });

  it("dcg respects a cutoff shorter than the list", () => {
    expect(dcg([3, 1, 2], 1)).toBe(3);
  });

  it("dcg with a cutoff longer than the list uses the whole list", () => {
    expect(dcg([3], 10)).toBe(3);
  });
});

describe("ndcg", () => {
  it("is 1 for the ideal ordering", () => {
    expect(ndcg([3, 2, 1], [1, 2, 3])).toBe(1);
  });

  it("is below 1 for a non-ideal ordering", () => {
    const v = ndcg([1, 2, 3], [1, 2, 3]);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it("is 1 when the pool holds no relevance mass", () => {
    expect(ndcg([0, 0], [0, 0])).toBe(1);
  });

  it("ideal comes from the full pool, not the ranked list", () => {
    // Ranked list misses the grade-3 item entirely → ideal DCG still counts it.
    expect(ndcg([2], [2, 3])).toBeLessThan(1);
  });

  it("applies the cutoff to both ranked and ideal sides", () => {
    // Top-1: ranked gain 2 vs ideal gain 3.
    expect(ndcg([2, 3], [2, 3], 1)).toBeCloseTo(2 / 3, 10);
  });
});

describe("shareAtK", () => {
  const marked = new Set(["e1", "e2"]);

  it("computes the marked share of the top-k prefix", () => {
    expect(shareAtK(["e1", "d1", "e2", "d2"], marked, 2)).toBe(0.5);
  });

  it("uses the whole list when k is absent", () => {
    expect(shareAtK(["e1", "d1", "e2", "d2"], marked)).toBe(0.5);
  });

  it("clamps k to the list length", () => {
    expect(shareAtK(["e1"], marked, 10)).toBe(1);
  });

  it("returns 0 for an empty prefix", () => {
    expect(shareAtK([], marked, 3)).toBe(0);
  });
});

describe("recallAtK", () => {
  it("computes the fraction of targets in the top-k", () => {
    expect(recallAtK(["a", "b", "c"], new Set(["a", "c"]), 2)).toBe(0.5);
    expect(recallAtK(["a", "b", "c"], new Set(["a", "c"]), 3)).toBe(1);
  });

  it("returns 1 for an empty target set", () => {
    expect(recallAtK(["a"], new Set(), 1)).toBe(1);
  });
});

describe("kendallTau", () => {
  it("is exactly 1 for identical orderings", () => {
    expect(kendallTau(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("is -1 for fully reversed orderings", () => {
    expect(kendallTau(["a", "b", "c"], ["c", "b", "a"])).toBe(-1);
  });

  it("counts one discordant pair out of three", () => {
    expect(kendallTau(["a", "b", "c"], ["b", "a", "c"])).toBeCloseTo(1 / 3, 10);
  });

  it("compares over common ids only", () => {
    // "x" only in A, "y" only in B — the common pair (a,b) agrees.
    expect(kendallTau(["a", "x", "b"], ["a", "y", "b"])).toBe(1);
  });

  it("is 1 when fewer than 2 common ids exist", () => {
    expect(kendallTau(["a"], ["a"])).toBe(1);
    expect(kendallTau(["a"], ["b"])).toBe(1);
  });
});

describe("serendipityAtL", () => {
  it("is 0 for an empty list", () => {
    expect(serendipityAtL([])).toBe(0);
  });

  it("is 0 when top items are expected (unexp 0) and distant items irrelevant (rel 0)", () => {
    expect(serendipityAtL([
      { rel: 1, unexp: 0 },
      { rel: 0, unexp: 1 },
    ])).toBe(0);
  });

  it("rewards relevant-and-surprising items, discounted by rank", () => {
    // Single item at rank 1: mass = 1·1·0.5, Z = 1 → 0.5.
    expect(serendipityAtL([{ rel: 1, unexp: 0.5 }])).toBeCloseTo(0.5, 10);
    // The same item at rank 2 scores less than at rank 1.
    const first = serendipityAtL([{ rel: 1, unexp: 0.5 }, { rel: 0, unexp: 0 }]);
    const second = serendipityAtL([{ rel: 0, unexp: 0 }, { rel: 1, unexp: 0.5 }]);
    expect(second).toBeLessThan(first);
  });
});

describe("aspectCoverage", () => {
  const aspects = new Map([
    ["t1", "testing"],
    ["t2", "testing"],
    ["t3", "migrations"],
    ["t4", "docs"],
  ]);

  it("covers an aspect only via a relevant exemplar", () => {
    const relevant = new Set(["t1", "t3"]); // aspects: testing, migrations
    // t1 relevant (testing ✓); t4 exemplar is not relevant → docs not counted.
    expect(aspectCoverage(["t1", "t4"], aspects, relevant)).toBe(0.5);
  });

  it("is 1 when every relevant aspect has a relevant exemplar", () => {
    expect(aspectCoverage(["t1", "t3"], aspects, new Set(["t1", "t3"]))).toBe(1);
  });

  it("is 1 when no relevant trace carries an aspect label", () => {
    expect(aspectCoverage([], aspects, new Set())).toBe(1);
    expect(aspectCoverage([], aspects, new Set(["unlabeled"]))).toBe(1);
  });

  it("ignores exemplars without an aspect label", () => {
    const relevant = new Set(["t1", "unlabeled"]);
    expect(aspectCoverage(["unlabeled", "t1"], aspects, relevant)).toBe(1);
  });
});

describe("exemplarOrderNdcg", () => {
  it("is 1 when exemplars are displayed best-grade first", () => {
    expect(exemplarOrderNdcg([3, 2, 1])).toBe(1);
  });

  it("penalizes a top slot squandered on a low-grade exemplar", () => {
    // Same exemplars, worst-first — the ideal is [3,2,1], so this is < 1.
    expect(exemplarOrderNdcg([1, 2, 3])).toBeLessThan(1);
  });

  it("is 1 when no exemplar carries relevance mass", () => {
    expect(exemplarOrderNdcg([0, 0, 0])).toBe(1);
    expect(exemplarOrderNdcg([])).toBe(1);
  });
});

describe("firstExemplarGrade", () => {
  it("normalizes the first exemplar's grade by the scale max", () => {
    expect(firstExemplarGrade([3, 0, 1], 3)).toBe(1);
    expect(firstExemplarGrade([0, 3], 3)).toBe(0);
  });

  it("is 0 for an empty display", () => {
    expect(firstExemplarGrade([], 3)).toBe(0);
  });
});

describe("displayRedundancy", () => {
  it("is 0 for fewer than two vectors", () => {
    expect(displayRedundancy([])).toBe(0);
    expect(displayRedundancy([[1, 0]])).toBe(0);
  });

  it("is 1 for identical representatives (maximally redundant)", () => {
    expect(displayRedundancy([[1, 0], [2, 0], [3, 0]])).toBeCloseTo(1, 10);
  });

  it("is 0 for mutually orthogonal representatives (maximally diverse)", () => {
    expect(displayRedundancy([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(0, 10);
  });

  it("averages cosine over ALL pairs", () => {
    // pairs: (e0,e1)=0, (e0,diag)=1/√2, (e1,diag)=1/√2 → mean = (2/√2)/3.
    const inv = 1 / Math.sqrt(2);
    expect(displayRedundancy([[1, 0], [0, 1], [inv, inv]])).toBeCloseTo((2 * inv) / 3, 10);
  });
});

describe("mean", () => {
  it("averages values", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("is 0 for empty input", () => {
    expect(mean([])).toBe(0);
  });
});
