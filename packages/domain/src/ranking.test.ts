import { describe, it, expect } from "vitest";
import {
  computeRelevanceScore,
  echoDemotionPenalty,
  echoRankingScore,
  rankWithEchoSuppression,
  DEFAULT_ECHO_SUPPRESSION,
} from "./ranking";
import type {
  EchoRankCandidate,
  EchoRankContext,
  EchoSuppressionConfig,
} from "./ranking";

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

describe("echo suppression", () => {
  const NOW = new Date("2026-07-14T12:00:00Z");
  const KEY_SELF = "key-self";
  const KEY_OTHER = "key-other";

  const ctx: EchoRankContext = { currentApiKeyId: KEY_SELF, now: NOW };
  const on: EchoSuppressionConfig = { ...DEFAULT_ECHO_SUPPRESSION, enabled: true };

  const cand = (over: Partial<EchoRankCandidate>): EchoRankCandidate => ({
    id: "c",
    semanticScore: 0.8,
    authorApiKeyId: KEY_OTHER,
    createdAt: new Date(NOW.getTime() - 10 * 60_000), // 10 min ago
    curated: false,
    ...over,
  });

  const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  describe("echoDemotionPenalty", () => {
    it("is 0 for a cross-agent recipe even when recent", () => {
      expect(echoDemotionPenalty(cand({ authorApiKeyId: KEY_OTHER }), ctx, on)).toBe(0);
    });

    it("applies full weight to a same-agent same-session append", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(30) }),
        ctx,
        on,
      );
      expect(p).toBeCloseTo(on.weight); // 0.5
    });

    it("applies the day factor in the same-day-but-not-same-session band", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(180) }), // 3h ago
        ctx,
        on,
      );
      expect(p).toBeCloseTo(on.weight * on.dayWeightFactor); // 0.25
    });

    it("does not demote an append older than the day window", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(48 * 60) }), // 2 days
        ctx,
        on,
      );
      expect(p).toBe(0);
    });

    it("exempts a curated (decided_at) recipe even if same-agent and recent", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(5), curated: true }),
        ctx,
        on,
      );
      expect(p).toBe(0);
    });

    it("is 0 when disabled", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(5) }),
        ctx,
        DEFAULT_ECHO_SUPPRESSION,
      );
      expect(p).toBe(0);
    });

    it("is 0 when the current key is unknown", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(5) }),
        { currentApiKeyId: null, now: NOW },
        on,
      );
      expect(p).toBe(0);
    });

    it("is 0 for a future-dated append (clock skew safety)", () => {
      const p = echoDemotionPenalty(
        cand({ authorApiKeyId: KEY_SELF, createdAt: new Date(NOW.getTime() + 60_000) }),
        ctx,
        on,
      );
      expect(p).toBe(0);
    });
  });

  describe("echoRankingScore", () => {
    it("leaves the raw score untouched when nothing is demoted", () => {
      expect(echoRankingScore(cand({ authorApiKeyId: KEY_OTHER }), ctx, on)).toBeCloseTo(0.8);
    });

    it("halves the ranking score for a same-session self-append", () => {
      const s = echoRankingScore(
        cand({ semanticScore: 0.8, authorApiKeyId: KEY_SELF, createdAt: minsAgo(10) }),
        ctx,
        on,
      );
      expect(s).toBeCloseTo(0.4);
    });

    it("returns the raw score when disabled", () => {
      const s = echoRankingScore(
        cand({ authorApiKeyId: KEY_SELF, createdAt: minsAgo(10) }),
        ctx,
        DEFAULT_ECHO_SUPPRESSION,
      );
      expect(s).toBeCloseTo(0.8);
    });
  });

  describe("rankWithEchoSuppression", () => {
    it("demotes a same-agent recent hypothesis below an older cross-agent recipe of similar similarity", () => {
      const selfRecent = cand({
        id: "self-recent",
        semanticScore: 0.82,
        authorApiKeyId: KEY_SELF,
        createdAt: minsAgo(5),
      });
      const crossOlder = cand({
        id: "cross-older",
        semanticScore: 0.8,
        authorApiKeyId: KEY_OTHER,
        createdAt: minsAgo(60 * 24 * 30), // a month old
      });
      // Incoming order is by raw similarity: self-recent (0.82) first.
      const ranked = rankWithEchoSuppression([selfRecent, crossOlder], ctx, on);
      expect(ranked.map((r) => r.id)).toEqual(["cross-older", "self-recent"]);
      // Displayed similarity is unchanged — reorder only, no mutation.
      expect(ranked.find((r) => r.id === "self-recent")!.semanticScore).toBe(0.82);
    });

    it("is an order-preserving identity transform when disabled (byte-stable)", () => {
      const a = cand({ id: "a", semanticScore: 0.9, authorApiKeyId: KEY_SELF, createdAt: minsAgo(1) });
      const b = cand({ id: "b", semanticScore: 0.7, authorApiKeyId: KEY_OTHER });
      const input = [a, b];
      const ranked = rankWithEchoSuppression(input, ctx, DEFAULT_ECHO_SUPPRESSION);
      expect(ranked.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("keeps relevance order among non-demoted results (stable sort)", () => {
      const hi = cand({ id: "hi", semanticScore: 0.9, authorApiKeyId: KEY_OTHER });
      const lo = cand({ id: "lo", semanticScore: 0.6, authorApiKeyId: KEY_OTHER });
      const ranked = rankWithEchoSuppression([hi, lo], ctx, on);
      expect(ranked.map((r) => r.id)).toEqual(["hi", "lo"]);
    });

    it("does not add or drop any results (no truncation)", () => {
      const items = [
        cand({ id: "1", authorApiKeyId: KEY_SELF, createdAt: minsAgo(2) }),
        cand({ id: "2", authorApiKeyId: KEY_OTHER }),
        cand({ id: "3", authorApiKeyId: KEY_SELF, createdAt: minsAgo(2), curated: true }),
      ];
      const ranked = rankWithEchoSuppression(items, ctx, on);
      expect(new Set(ranked.map((r) => r.id))).toEqual(new Set(["1", "2", "3"]));
      expect(ranked).toHaveLength(3);
    });
  });
});
