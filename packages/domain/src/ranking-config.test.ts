import { describe, it, expect } from "vitest";

import {
  DEFAULT_RANKING,
  RANKING_ALGORITHM_VERSION,
  poolBoundary,
  orderClusters,
} from "./ranking-config";
import type { ClusterOrderStat } from "./ranking-config";

describe("DEFAULT_RANKING", () => {
  it("ships the 2026-07-19 ruling: fixed:100 clustering pool", () => {
    // Changing any default is a versioned algorithm event: bump
    // RANKING_ALGORITHM_VERSION and add a ranking-changelog.md entry
    // (this flip: p6-pool-sweep-report.md; "page" stays a comparison arm).
    expect(DEFAULT_RANKING.clusterPool.mode).toBe("fixed");
    expect(DEFAULT_RANKING.clusterPool.size).toBe(100);
    expect(DEFAULT_RANKING.clusterPool.minSize).toBe(20);
    expect(DEFAULT_RANKING.clusterPool.vectorDims).toBe(768);
  });

  it("ships the 2026-07-20 ruling: max-similarity cluster ordering", () => {
    // Versioned flip (p7-ordering-sweep-report.md): relevance-first cluster
    // ranking; member-count stays a comparison arm, evidence-mass stays
    // plumbed awaiting evidence-bearing golden material.
    expect(DEFAULT_RANKING.clusterOrdering).toBe("max-similarity");
  });

  it("has a dated version identifier matching the ordering-flip mint", () => {
    expect(RANKING_ALGORITHM_VERSION).toBe("2026-07-20");
  });
});

describe("poolBoundary", () => {
  const pool = (mode: "page" | "fixed" | "score-gap", size = 10, minSize = 3) => ({
    mode,
    size,
    minSize,
    vectorDims: 768,
  });

  it("page mode: no pool (undefined)", () => {
    expect(poolBoundary([0.9, 0.8], pool("page"))).toBeUndefined();
  });

  it("fixed mode: size, clamped to the candidate count", () => {
    expect(poolBoundary([0.9, 0.8, 0.7], pool("fixed", 2))).toBe(2);
    expect(poolBoundary([0.9, 0.8], pool("fixed", 10))).toBe(2);
  });

  it("score-gap: cuts at the largest adjacent drop within [minSize, size]", () => {
    // Scores: tight head, cliff after index 4 (0.80 → 0.40), long tail.
    const scores = [0.9, 0.88, 0.85, 0.82, 0.8, 0.4, 0.39, 0.38, 0.37, 0.36, 0.35];
    expect(poolBoundary(scores, pool("score-gap", 10, 3))).toBe(5);
  });

  it("score-gap: ignores gaps before minSize", () => {
    // Biggest drop is at index 1 (0.9 → 0.5), but minSize=3 forces the search
    // to start at the 3rd candidate — the cut lands on the later 0.48 → 0.30.
    const scores = [0.9, 0.5, 0.49, 0.48, 0.3, 0.29];
    expect(poolBoundary(scores, pool("score-gap", 6, 3))).toBe(4);
  });

  it("score-gap: uniform scores cut at minSize (no boundary signal)", () => {
    const scores = [0.5, 0.5, 0.5, 0.5, 0.5];
    // Every gap is 0 — the first probe wins, so the cut is conservative
    // (minSize). Whether uniform heads should instead take the max is a
    // sweepable choice; conservative ships.
    expect(poolBoundary(scores, pool("score-gap", 5, 2))).toBe(2);
  });

  it("score-gap: candidate count below minSize returns everything", () => {
    expect(poolBoundary([0.9, 0.8], pool("score-gap", 10, 5))).toBe(2);
  });
});

describe("orderClusters", () => {
  // Three clusters where the three modes DISAGREE: cluster 0 is biggest but
  // lowest-similarity and evidence-thin (the echo failure mode); cluster 1 has
  // the best member similarity; cluster 2 carries the most evidence.
  const stats: ClusterOrderStat[] = [
    { memberCount: 5, maxScore: 0.70, evidenceMass: 1 }, // 0
    { memberCount: 2, maxScore: 0.95, evidenceMass: 2 }, // 1
    { memberCount: 1, maxScore: 0.80, evidenceMass: 9 }, // 2
  ];

  it("member-count: biggest cluster first (legacy)", () => {
    expect(orderClusters(stats, "member-count")).toEqual([0, 1, 2]);
  });

  it("max-similarity: best member's query similarity first (relevance-first)", () => {
    expect(orderClusters(stats, "max-similarity")).toEqual([1, 2, 0]);
  });

  it("evidence-mass: heaviest summed evidence first (corroboration)", () => {
    expect(orderClusters(stats, "evidence-mass")).toEqual([2, 1, 0]);
  });

  it("ties preserve incoming (legacy) order — stable", () => {
    const tied: ClusterOrderStat[] = [
      { memberCount: 3, maxScore: 0.5, evidenceMass: 0 }, // 0
      { memberCount: 3, maxScore: 0.9, evidenceMass: 0 }, // 1 — higher sim, same count
      { memberCount: 3, maxScore: 0.5, evidenceMass: 0 }, // 2
    ];
    // Equal member counts ⇒ the incoming order is preserved, not resorted by
    // any secondary key.
    expect(orderClusters(tied, "member-count")).toEqual([0, 1, 2]);
    // Equal evidence mass ⇒ likewise stable.
    expect(orderClusters(tied, "evidence-mass")).toEqual([0, 1, 2]);
  });

  it("empty input ⇒ empty permutation", () => {
    expect(orderClusters([], "max-similarity")).toEqual([]);
  });
});
