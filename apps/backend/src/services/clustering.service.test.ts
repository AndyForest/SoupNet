import { describe, it, expect } from "vitest";
import {
  adaptiveK,
  clusterResults,
  cosineDistance,
  mmrClusters,
  varianceLambda,
} from "./clustering.service";

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

// ── Verbosity lever: adaptive k ──────────────────────────────────────────────

describe("adaptiveK", () => {
  it("cuts at a clear score cliff, plus the buffer", () => {
    // Relevant head of 3, cliff, noise tail — the steep–flat–steep shape.
    const sims = [0.92, 0.9, 0.89, 0.55, 0.53, 0.52, 0.51, 0.5, 0.49, 0.48, 0.47, 0.46];
    expect(adaptiveK(sims)).toBe(4); // cut 3 + buffer 1
  });

  it("buffer is configurable and zero-able", () => {
    const sims = [0.92, 0.9, 0.89, 0.55, 0.53, 0.52, 0.51, 0.5];
    expect(adaptiveK(sims, { buffer: 0 })).toBe(3);
  });

  it("input order does not matter (sorted internally)", () => {
    const sims = [0.5, 0.92, 0.53, 0.9, 0.55, 0.89, 0.52, 0.51, 0.49, 0.48];
    expect(adaptiveK(sims)).toBe(adaptiveK([...sims].sort((a, b) => b - a)));
  });

  it("falls back to the knee on a smooth two-regime curve", () => {
    // Steep head flattening into a plateau — no single dominant gap relative
    // to the window's average step, but a clear knee where the curve turns.
    const head = [0.9, 0.82, 0.74, 0.66];
    const plateau = Array.from({ length: 10 }, (_, i) => 0.6 - i * 0.005);
    const k = adaptiveK([...head, ...plateau]);
    expect(k).toBeGreaterThanOrEqual(3);
    expect(k).toBeLessThanOrEqual(6);
  });

  it("degenerate flat curve returns the pre-lever default of 3", () => {
    const sims = Array.from({ length: 20 }, () => 0.7);
    expect(adaptiveK(sims)).toBe(3);
  });

  it("clamps to maxK even when the gap sits deeper", () => {
    // Head of 15 near-identical, cliff at 15 — beyond the clamp window, so
    // the search never sees it; flat window → default 3.
    const sims = [...Array.from({ length: 15 }, () => 0.9), 0.3, 0.29, 0.28];
    expect(adaptiveK(sims)).toBeLessThanOrEqual(10);
  });

  it("respects a custom maxK", () => {
    const sims = [0.92, 0.9, 0.89, 0.88, 0.87, 0.86, 0.4, 0.39, 0.38];
    expect(adaptiveK(sims, { maxK: 4 })).toBeLessThanOrEqual(4);
  });

  it("tiny inputs return n", () => {
    expect(adaptiveK([0.9])).toBe(1);
    expect(adaptiveK([0.9, 0.4])).toBe(2);
    expect(adaptiveK([])).toBe(0);
  });

  it("never exceeds n or the clamp bounds", () => {
    for (const sims of [
      [0.9, 0.8, 0.7],
      Array.from({ length: 50 }, (_, i) => 1 - i * 0.01),
      [0.99, 0.1, 0.09, 0.08],
    ]) {
      const k = adaptiveK(sims);
      expect(k).toBeGreaterThanOrEqual(Math.min(2, sims.length));
      expect(k).toBeLessThanOrEqual(Math.min(10, Math.max(1, sims.length)));
    }
  });
});

// ── Verbosity lever: variance-keyed λ ────────────────────────────────────────

describe("varianceLambda", () => {
  it("tight head → focus (λ 0.8)", () => {
    expect(varianceLambda([0.9, 0.9, 0.9, 0.9, 0.89], 0.6)).toBeCloseTo(0.8, 5);
  });

  it("wide spread → diversify (λ 0.3)", () => {
    const spread = [0.95, 0.8, 0.65, 0.5, 0.35, 0.2];
    expect(varianceLambda(spread, 0.6)).toBeCloseTo(0.3, 5);
  });

  it("interpolates monotonically between the anchors", () => {
    const mk = (s: number) => [0.7 - s, 0.7, 0.7 + s];
    const lambdas = [0.03, 0.05, 0.08].map((s) => varianceLambda(mk(s), 0.6));
    expect(lambdas[0]).toBeGreaterThan(lambdas[1]!);
    expect(lambdas[1]).toBeGreaterThan(lambdas[2]!);
    for (const l of lambdas) {
      expect(l).toBeGreaterThanOrEqual(0.3);
      expect(l).toBeLessThanOrEqual(0.8);
    }
  });

  it("fewer than 3 scores returns the base λ unchanged", () => {
    expect(varianceLambda([0.9, 0.2], 0.6)).toBe(0.6);
    expect(varianceLambda([], 0.6)).toBe(0.6);
  });
});

// ── Verbosity lever: resolveK precedence (observed through the public API) ───

describe("size-steer precedence", () => {
  // Query along the first axis; 3 vectors near it, 7 far — a clear cliff.
  const queryVector = [1, 0, 0, 0];
  const near = [
    [0.99, 0.01, 0, 0],
    [0.98, 0.02, 0, 0],
    [0.97, 0.03, 0, 0],
  ];
  const far = [
    [0.1, 0.9, 0, 0],
    [0.1, 0, 0.9, 0],
    [0.1, 0, 0, 0.9],
    [0.05, 0.95, 0, 0],
    [0.05, 0, 0.95, 0],
    [0.05, 0, 0, 0.95],
    [0.08, 0.5, 0.5, 0],
  ];
  const vectors = [...near, ...far];
  const base = { vectors, queryVector, lambda: 0.6 };

  it("verbosity levels map low/medium/high → 3/5/10 exemplars", () => {
    expect(mmrClusters({ ...base, verbosity: "low" })).toHaveLength(3);
    expect(mmrClusters({ ...base, verbosity: "medium" })).toHaveLength(5);
    expect(mmrClusters({ ...base, verbosity: "high" })).toHaveLength(10);
  });

  it("explicit k (legacy clusters) wins over verbosity", () => {
    expect(mmrClusters({ ...base, k: 2, verbosity: "high" })).toHaveLength(2);
  });

  it("verbosity wins over legacy maxChars", () => {
    const resultTexts = vectors.map(() => "x".repeat(100));
    expect(
      mmrClusters({ ...base, verbosity: "medium", maxChars: 700, resultTexts }),
    ).toHaveLength(5);
  });

  it("no steer + autoK fixed → the pre-lever default of 3", () => {
    expect(mmrClusters({ ...base, autoK: "fixed" })).toHaveLength(3);
    expect(mmrClusters({ ...base })).toHaveLength(3);
  });

  it("no steer + autoK adaptive → k from the similarity cliff", () => {
    // Cliff after the 3 near vectors; gap cut 3 + buffer 1 = 4.
    expect(mmrClusters({ ...base, autoK: "adaptive" })).toHaveLength(4);
  });

  it("any explicit steer disables the adaptive path", () => {
    expect(mmrClusters({ ...base, autoK: "adaptive", verbosity: "low" })).toHaveLength(3);
    expect(mmrClusters({ ...base, autoK: "adaptive", k: 6 })).toHaveLength(6);
  });

  it("k-means path honors verbosity the same way", () => {
    expect(clusterResults({ vectors, verbosity: "medium" })).toHaveLength(5);
  });
});

