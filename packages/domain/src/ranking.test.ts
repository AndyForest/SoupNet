import { describe, it, expect } from "vitest";
import { computeRelevanceScore } from "./ranking";

describe("computeRelevanceScore", () => {
  it("blends 40% lexical + 60% semantic when both signals present", () => {
    const score = computeRelevanceScore({
      tsvectorRank: 0.5,
      semanticScore: 0.8,
    });
    // 0.4 * 0.5 + 0.6 * 0.8 = 0.2 + 0.48 = 0.68
    expect(score).toBeCloseTo(0.68);
  });

  it("returns semantic score when only semantic is present", () => {
    expect(computeRelevanceScore({ semanticScore: 0.75 })).toBeCloseTo(0.75);
  });

  it("returns lexical score when only lexical is present", () => {
    expect(computeRelevanceScore({ tsvectorRank: 0.6 })).toBeCloseTo(0.6);
  });

  it("returns 0 when neither signal is present", () => {
    expect(computeRelevanceScore({})).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(computeRelevanceScore({ tsvectorRank: 2.0 })).toBe(1);
    expect(computeRelevanceScore({ semanticScore: 1.5 })).toBe(1);
    expect(
      computeRelevanceScore({ tsvectorRank: 5.0, semanticScore: 3.0 }),
    ).toBe(1);
  });

  it("clamps values below 0 to 0", () => {
    expect(computeRelevanceScore({ tsvectorRank: -1 })).toBe(0);
    expect(computeRelevanceScore({ semanticScore: -0.5 })).toBe(0);
    expect(
      computeRelevanceScore({ tsvectorRank: -1, semanticScore: -2 }),
    ).toBe(0);
  });

  it("computes the specific example: tsvectorRank=0.5, semanticScore=0.8 → 0.68", () => {
    const score = computeRelevanceScore({
      tsvectorRank: 0.5,
      semanticScore: 0.8,
    });
    expect(score).toBe(0.4 * 0.5 + 0.6 * 0.8);
  });
});
