import { describe, it, expect } from "vitest";
import { clusterResults, cosineDistance } from "./clustering.service";

// ── Test helpers ─────────────────────────────────────────────────────────────

// Three obvious clusters in 4-dim space
const clusterA = [
  [1, 0, 0, 0],
  [0.95, 0.05, 0, 0],
  [0.9, 0.1, 0, 0],
];
const clusterB = [
  [0, 1, 0, 0],
  [0.05, 0.95, 0, 0],
  [0.1, 0.9, 0, 0],
];
const clusterC = [
  [0, 0, 1, 0],
  [0, 0.05, 0.95, 0],
  [0, 0.1, 0.9, 0],
  [0, 0, 0.9, 0.1],
];

const tenVectors = [...clusterA, ...clusterB, ...clusterC];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("cosineDistance", () => {
  it("returns 0 for identical vectors", () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 5);
  });

  it("returns ~1 for orthogonal vectors", () => {
    expect(cosineDistance([1, 0, 0], [0, 1, 0])).toBeCloseTo(1, 5);
  });

  it("returns ~2 for opposite vectors", () => {
    expect(cosineDistance([1, 0, 0], [-1, 0, 0])).toBeCloseTo(2, 5);
  });
});

describe("clusterResults", () => {
  it("clusters 10 points into 3 groups", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    expect(results).toHaveLength(3);

    // Cluster sizes should roughly correspond to 3, 3, 4
    const sizes = results.map((r) => r.memberCount).sort((a, b) => a - b);
    expect(sizes).toEqual([3, 3, 4]);
  });

  it("each exemplar is a valid input index", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    for (const r of results) {
      expect(r.exemplarIndex).toBeGreaterThanOrEqual(0);
      expect(r.exemplarIndex).toBeLessThan(tenVectors.length);
    }
  });

  it("cluster sizes sum to total input count", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    const totalSize = results.reduce((sum, r) => sum + r.memberCount, 0);
    expect(totalSize).toBe(tenVectors.length);
  });

  it("single point returns one cluster with size 1", () => {
    const results = clusterResults({ vectors: [[1, 0, 0]], k: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.memberCount).toBe(1);
    expect(results[0]!.exemplarIndex).toBe(0);
    expect(results[0]!.avgSimilarity).toBe(1);
  });

  it("k greater than N returns N clusters", () => {
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const results = clusterResults({ vectors, k: 10 });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.memberCount).toBe(1);
    }
  });

  it("zero points returns empty", () => {
    const results = clusterResults({ vectors: [], k: 3 });
    expect(results).toEqual([]);
  });

  it("auto-k from maxChars", () => {
    const vectors = [
      [1, 0, 0, 0, 0],
      [0.9, 0.1, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 0.9, 0.1, 0, 0],
      [0, 0, 1, 0, 0],
    ];
    const resultTexts = [
      "a".repeat(100),
      "b".repeat(100),
      "c".repeat(100),
      "d".repeat(100),
      "e".repeat(100),
    ];

    const results = clusterResults({
      vectors,
      maxChars: 250,
      resultTexts,
    });

    // floor(250 / (100 * 3.5)) = 0, clamped to max(2, ...) = 2
    expect(results).toHaveLength(2);
  });

  it("deterministic for same input", () => {
    const results1 = clusterResults({ vectors: tenVectors, k: 3 });
    const results2 = clusterResults({ vectors: tenVectors, k: 3 });
    expect(results1).toEqual(results2);
  });

  it("largest cluster first in output", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.memberCount).toBeGreaterThanOrEqual(
        results[i]!.memberCount,
      );
    }
  });

  it("avgSimilarity is between 0 and 1", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    for (const r of results) {
      expect(r.avgSimilarity).toBeGreaterThanOrEqual(0);
      expect(r.avgSimilarity).toBeLessThanOrEqual(1);
    }
  });

  it("exemplar indices are unique", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    const indices = results.map((r) => r.exemplarIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("returns centroid vectors", () => {
    const results = clusterResults({ vectors: tenVectors, k: 3 });
    for (const r of results) {
      expect(r.centroid).toBeDefined();
      expect(r.centroid.length).toBe(4); // 4-dim test vectors
    }
  });

  it("centroid is the arithmetic mean of cluster members", () => {
    // Three similar vectors — single cluster centroid should be their mean
    const vectors = [
      [0.9, 0.1, 0],
      [0.8, 0.2, 0],
      [0.7, 0.3, 0],
    ];
    const results = clusterResults({ vectors, k: 1 });
    const centroid = results[0]!.centroid;
    // Mean: [0.8, 0.2, 0]
    expect(centroid[0]).toBeCloseTo(0.8, 1);
    expect(centroid[1]).toBeCloseTo(0.2, 1);
    expect(centroid[2]).toBeCloseTo(0, 1);
  });
});

describe("memberWeights (demotion-adjusted-mass cluster ordering)", () => {
  // Two well-separated topics: three "echo" vectors near e0, two "durable"
  // vectors near e1. With k=2 the clusters are unambiguous.
  const echoish = [
    [1, 0, 0, 0],
    [0.99, 0.05, 0, 0],
    [0.98, 0.08, 0, 0],
  ];
  const durable = [
    [0, 1, 0, 0],
    [0.05, 0.99, 0, 0],
  ];
  const vectors = [...echoish, ...durable];
  // Demotion-adjusted weights: echoes at similarity 0.8 demoted by 0.5
  // (weight 0.4 each, mass 1.2); durable cross-agent recipes undemoted at
  // 0.75 (mass 1.5). Raw memberCount says echo cluster first (3 > 2); mass
  // says durable first (1.5 > 1.2).
  const weights = [0.4, 0.4, 0.4, 0.75, 0.75];

  it("without weights: larger cluster first (legacy, byte-stable)", () => {
    const results = clusterResults({ vectors, k: 2 });
    expect(results[0]!.memberCount).toBe(3);
    expect(results[1]!.memberCount).toBe(2);
  });

  it("with weights: higher-mass cluster first even when smaller", () => {
    const results = clusterResults({ vectors, k: 2, memberWeights: weights });
    expect(results[0]!.memberCount).toBe(2); // durable cluster leads
    expect(results[1]!.memberCount).toBe(3); // echo cluster sinks
  });

  it("weights reorder only — membership, exemplars, and similarity untouched", () => {
    const unweighted = clusterResults({ vectors, k: 2 });
    const weighted = clusterResults({ vectors, k: 2, memberWeights: weights });
    const key = (r: { exemplarIndex: number; memberCount: number; avgSimilarity: number }) =>
      `${r.exemplarIndex}:${r.memberCount}:${r.avgSimilarity.toFixed(6)}`;
    expect(new Set(weighted.map(key))).toEqual(new Set(unweighted.map(key)));
  });

  it("k >= n edge case: weighted singletons sort by their own weight", () => {
    const results = clusterResults({
      vectors: [[1, 0], [0.9, 0.1], [0, 1]],
      k: 5,
      memberWeights: [0.2, 0.9, 0.5],
    });
    expect(results.map((r) => r.exemplarIndex)).toEqual([1, 2, 0]);
    expect(results.every((r) => r.memberCount === 1)).toBe(true);
  });

  it("equal weights fall back to memberCount then exemplarIndex tiebreak", () => {
    const results = clusterResults({ vectors, k: 2, memberWeights: [1, 1, 1, 1, 1] });
    // Masses 3 vs 2 → same order as legacy.
    expect(results[0]!.memberCount).toBe(3);
  });
});
