import { describe, it, expect } from "vitest";

import {
  DEFAULT_RANKING,
  RANKING_ALGORITHM_VERSION,
  isCurated,
  demotionAdjustedMass,
} from "./ranking-config";
import { DEFAULT_ECHO_SUPPRESSION } from "./ranking";

describe("DEFAULT_RANKING", () => {
  it("ships byte-identical to pre-refactor behavior", () => {
    // Echo demotion OFF, v1 exemption (decided_at only), legacy cluster order.
    // Changing any of these defaults is a versioned algorithm event: bump
    // RANKING_ALGORITHM_VERSION and add a ranking-changelog.md entry.
    expect(DEFAULT_RANKING.echo).toEqual(DEFAULT_ECHO_SUPPRESSION);
    expect(DEFAULT_RANKING.echo.enabled).toBe(false);
    expect(DEFAULT_RANKING.exemption).toEqual({
      decidedAt: true,
      humanReaction: false,
      crossAgentFeedback: false,
    });
    expect(DEFAULT_RANKING.clusterOrdering).toBe("member-count");
    // "page" = the legacy pagination-window pool; the fixed:100 candidate is
    // the measured alternative (candidate-pool-sizing memo, P6).
    expect(DEFAULT_RANKING.clusterPool.mode).toBe("page");
    expect(DEFAULT_RANKING.clusterPool.size).toBe(100);
    expect(DEFAULT_RANKING.clusterPool.vectorDims).toBe(768);
  });

  it("has a dated version identifier", () => {
    expect(RANKING_ALGORITHM_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isCurated", () => {
  const base = {
    decidedAt: null,
    humanReactionCount: undefined,
    crossAgentFeedbackCount: undefined,
  };
  const v1 = DEFAULT_RANKING.exemption;

  it("v1: decided_at set ⇒ curated", () => {
    expect(isCurated({ ...base, decidedAt: new Date("2026-01-01") }, v1)).toBe(true);
  });

  it("v1: no signals ⇒ not curated", () => {
    expect(isCurated(base, v1)).toBe(false);
  });

  it("v1: corroboration signals are ignored while their flags are off", () => {
    expect(
      isCurated(
        { ...base, humanReactionCount: 3, crossAgentFeedbackCount: 2 },
        v1,
      ),
    ).toBe(false);
  });

  it("humanReaction flag on: a single reaction exempts", () => {
    const exemption = { ...v1, humanReaction: true };
    expect(isCurated({ ...base, humanReactionCount: 1 }, exemption)).toBe(true);
    expect(isCurated({ ...base, humanReactionCount: 0 }, exemption)).toBe(false);
  });

  it("crossAgentFeedback flag on: cross-agent feedback exempts", () => {
    const exemption = { ...v1, crossAgentFeedback: true };
    expect(isCurated({ ...base, crossAgentFeedbackCount: 1 }, exemption)).toBe(true);
    expect(isCurated({ ...base, crossAgentFeedbackCount: 0 }, exemption)).toBe(false);
  });

  it("a flag that is on but not hydrated degrades to false, never throws", () => {
    const exemption = { decidedAt: true, humanReaction: true, crossAgentFeedback: true };
    expect(isCurated(base, exemption)).toBe(false);
  });

  it("decidedAt flag off disables even the v1 signal", () => {
    const exemption = { ...v1, decidedAt: false };
    expect(isCurated({ ...base, decidedAt: new Date("2026-01-01") }, exemption)).toBe(false);
  });
});

describe("demotionAdjustedMass", () => {
  it("sums member weights", () => {
    expect(demotionAdjustedMass([0.9, 0.5, 0.1])).toBeCloseTo(1.5);
  });

  it("empty cluster weighs 0", () => {
    expect(demotionAdjustedMass([])).toBe(0);
  });

  it("undemoted members contribute their full similarity, demoted less", () => {
    // Three echoes at 0.9 similarity demoted by 0.5 (mass 1.35) sink below
    // two durable recipes at 0.8 (mass 1.6) — the §3d mechanism in one line.
    expect(demotionAdjustedMass([0.45, 0.45, 0.45])).toBeLessThan(
      demotionAdjustedMass([0.8, 0.8]),
    );
  });
});
