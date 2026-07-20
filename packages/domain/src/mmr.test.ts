import { describe, it, expect } from "vitest";

import { cosineSimilarity, maximalMarginalRelevance } from "./mmr";

// Layer 1 unit tests — pure functions, hand-crafted vectors where the pick
// order is provable by the MMR formula.

describe("cosineSimilarity", () => {
  it("is 1 for identical direction, 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("is 0 when either vector is all zeros (no direction)", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("truncates to the shorter length (MRL prefix)", () => {
    // The 3-dim tail of the second vector is ignored — the leading prefix decides.
    expect(cosineSimilarity([1, 0], [1, 0, 99])).toBeCloseTo(1, 10);
  });
});

describe("maximalMarginalRelevance", () => {
  // Query on axis 0. P is the top-relevant item; P2 is a near-duplicate of P
  // (very high mutual similarity, slightly lower query similarity); D is a
  // distinct item (its own axis) with lower query similarity but far from P.
  const q = [1, 0, 0];
  const P = [0.8, 0.6, 0]; //   query sim 0.80
  const P2 = [0.79, 0.61, 0]; // query sim ~0.79, sim to P ~0.9999 (near-dup)
  const D = [0.5, 0, 0.866]; //  query sim 0.50, sim to P 0.40 (distinct)
  const candidates = [P, P2, D];

  it("first pick is always the highest-query-similarity candidate, wherever it sits", () => {
    // Highest-sim item (P) placed LAST — the seed must still find it.
    const reordered = [D, P2, P];
    expect(maximalMarginalRelevance(q, reordered, 0.5, 1)).toEqual([2]);
  });

  it("λ=1 degenerates to pure relevance order (query-similarity descending)", () => {
    expect(maximalMarginalRelevance(q, candidates, 1, 3)).toEqual([0, 1, 2]);
  });

  it("λ=0 spreads maximally: after the seed, picks the item least like the selected set", () => {
    // Seed P (0); then D is far from P while P2 is a near-dup — D leads P2.
    expect(maximalMarginalRelevance(q, candidates, 0, 3)).toEqual([0, 2, 1]);
  });

  it("a near-duplicate is never picked while a distinct candidate remains", () => {
    // λ=0.5: seed P; second pick weighs relevance against redundancy. P2 is
    // penalized heavily (near-dup of P), so D — distinct — wins the slot.
    expect(maximalMarginalRelevance(q, candidates, 0.5, 2)).toEqual([0, 2]);
  });

  it("k greater than the candidate count returns all indices (in pick order)", () => {
    const all = maximalMarginalRelevance(q, candidates, 0.6, 99);
    expect([...all].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(all).toHaveLength(3);
  });

  it("k ≤ 0 or no candidates returns an empty selection", () => {
    expect(maximalMarginalRelevance(q, candidates, 0.6, 0)).toEqual([]);
    expect(maximalMarginalRelevance(q, [], 0.6, 3)).toEqual([]);
  });
});
