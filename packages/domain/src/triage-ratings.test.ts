/**
 * Layer 1 tests for the triage-rating rules (drafts-and-triage slice 1).
 * Each case names the rubric criterion (docs/planning/drafts-and-triage-build.md
 * §Slice 1 rubric) and scenario (docs/product-specs/drafts-and-triage.feature)
 * it realizes. 100% branch coverage of triage-ratings.ts.
 */
import { describe, it, expect } from "vitest";
import {
  parseTriageRating,
  parseTriageRatings,
  repeatRatingsNotice,
  describeRatings,
  renderRatingsMarkdown,
  triageWeight,
  triageScore,
  compareForTriage,
  UNRATED_TRIAGE_WEIGHT,
} from "./triage-ratings";
import type { TriageOrderable } from "./triage-ratings";

describe("parseTriageRating", () => {
  it("S1-B1 / DT-RAT-01: accepts each vocabulary value", () => {
    expect(parseTriageRating("low")).toEqual({ value: "low" });
    expect(parseTriageRating("medium")).toEqual({ value: "medium" });
    expect(parseTriageRating("high")).toEqual({ value: "high" });
  });

  it("S1-B1: tolerates case and surrounding whitespace", () => {
    expect(parseTriageRating("  High ")).toEqual({ value: "high" });
  });

  it("S1-B2 / DT-RAT-02: omitted, null, and blank all mean not rated, never a default", () => {
    expect(parseTriageRating(undefined)).toEqual({ value: null });
    expect(parseTriageRating(null)).toEqual({ value: null });
    expect(parseTriageRating("   ")).toEqual({ value: null });
  });

  it("S1-B3 / DT-RAT-04: an unrecognized value is not rated and reports what was sent", () => {
    expect(parseTriageRating("urgent")).toEqual({ value: null, unrecognized: "urgent" });
    expect(parseTriageRating(3)).toEqual({ value: null, unrecognized: "3" });
  });
});

describe("parseTriageRatings", () => {
  it("S1-B4 / DT-RAT-03: the two ratings parse independently", () => {
    expect(parseTriageRatings({ impact: "high", uncertainty: "low" })).toEqual({
      ratings: { impact: "high", uncertainty: "low" },
    });
    expect(parseTriageRatings({ impact: "high" })).toEqual({
      ratings: { impact: "high", uncertainty: null },
    });
  });

  it("S1-B3 / DT-RAT-04: a notice names the rejected value and the accepted vocabulary", () => {
    const { ratings, notice } = parseTriageRatings({ impact: "urgent", uncertainty: "medium" });
    expect(ratings).toEqual({ impact: null, uncertainty: "medium" });
    expect(notice).toContain('impact "urgent"');
    expect(notice).toContain("low | medium | high");
    expect(notice).toContain("not rated");
  });

  it("S1-B3: both unrecognized are named in one notice", () => {
    const { notice } = parseTriageRatings({ impact: "urgent", uncertainty: "maybe" });
    expect(notice).toContain('impact "urgent"');
    expect(notice).toContain('uncertainty "maybe"');
  });

  it("S1-B3 follow-up: two unrecognized values take a plural verb, one takes a singular", () => {
    const both = parseTriageRatings({ impact: "urgent", uncertainty: "7" }).notice;
    expect(both).toContain('impact "urgent" and uncertainty "7" are not rating values');
    const one = parseTriageRatings({ impact: "urgent" }).notice;
    expect(one).toContain('impact "urgent" is not a rating value');
  });

  it("S1-B3 follow-up: a non-string value (wrong JSON type) is unrecognized, never thrown", () => {
    expect(parseTriageRating(3)).toEqual({ value: null, unrecognized: "3" });
    expect(parseTriageRating(true)).toEqual({ value: null, unrecognized: "true" });
    expect(parseTriageRating({ level: "high" })).toEqual({ value: null, unrecognized: '{"level":"high"}' });
    expect(parseTriageRating(["high"])).toEqual({ value: null, unrecognized: '["high"]' });
  });

  it("S1-B3 follow-up: a long unrecognized value is echoed bounded", () => {
    const { unrecognized } = parseTriageRating("x".repeat(500));
    expect(unrecognized!.length).toBeLessThanOrEqual(61);
  });
});

describe("repeatRatingsNotice", () => {
  it("S1-B5 / DT-RAT-08: a repeat that sends different ratings is told the first ones stand", () => {
    const notice = repeatRatingsNotice(
      { impact: "high", uncertainty: null },
      { impact: "low", uncertainty: null },
    );
    expect(notice).toContain("already");
    expect(notice).toContain("impact low");
    expect(notice).toContain("not applied");
  });

  it("S1-B5: a rating sent where none was stored is also not applied", () => {
    expect(repeatRatingsNotice({ impact: null, uncertainty: "high" }, { impact: null, uncertainty: null }))
      .toContain("uncertainty not rated");
  });

  it("S1-B5: no notice when the repeat sends nothing, or the same ratings", () => {
    expect(repeatRatingsNotice({ impact: null, uncertainty: null }, { impact: "low", uncertainty: "high" })).toBeUndefined();
    expect(repeatRatingsNotice({ impact: "low", uncertainty: null }, { impact: "low", uncertainty: "high" })).toBeUndefined();
  });
});

describe("describeRatings / renderRatingsMarkdown", () => {
  it("S1-B2 / DT-RAT-02: a null rating reads as not rated", () => {
    expect(describeRatings({ impact: null, uncertainty: null })).toBe("impact not rated, uncertainty not rated");
    expect(describeRatings({ impact: "high", uncertainty: "medium" })).toBe("impact high, uncertainty medium");
  });

  it("S1-B1 / DT-RAT-01: the markdown echo says whose ratings they are", () => {
    const md = renderRatingsMarkdown({ impact: "high", uncertainty: "medium" });
    expect(md).toBe("Your ratings: impact high, uncertainty medium (triage only, never ranking).\n");
  });

  it("stays silent when nothing was rated and there is no notice", () => {
    expect(renderRatingsMarkdown({ impact: null, uncertainty: null })).toBe("");
    expect(renderRatingsMarkdown(undefined)).toBe("");
  });

  it("S1-B3: a notice renders even when both ratings ended up not rated", () => {
    const md = renderRatingsMarkdown({ impact: null, uncertainty: null }, "Some notice.");
    expect(md).toBe("Your ratings: impact not rated, uncertainty not rated (triage only, never ranking).\nSome notice.\n");
  });
});

// ── Slice 3: the review queue's order (S3-O1, DT-QUE-02) ────────────────────

describe("triage order (S3-O1)", () => {
  const values = [null, "low", "medium", "high"] as const;
  const weight = (v: (typeof values)[number]) => (v === null ? 2 : { low: 1, medium: 2, high: 3 }[v]);

  it("weights low 1, medium 2, high 3, and unrated (or an unknown value) as medium", () => {
    expect(triageWeight("low")).toBe(1);
    expect(triageWeight("medium")).toBe(2);
    expect(triageWeight("high")).toBe(3);
    expect(triageWeight(null)).toBe(UNRATED_TRIAGE_WEIGHT);
    expect(triageWeight(undefined)).toBe(2);
    expect(triageWeight("urgent")).toBe(2);
    expect(triageWeight("toString")).toBe(2);
  });

  it("scores impact × uncertainty for all 16 combinations; an unrated draft scores 4", () => {
    for (const impact of values) {
      for (const uncertainty of values) {
        expect(triageScore({ impact, uncertainty }), `${impact}/${uncertainty}`).toBe(weight(impact) * weight(uncertainty));
      }
    }
    expect(triageScore({ impact: null, uncertainty: null })).toBe(4);
  });

  it("orders all 16 combinations by score, then impact, and every pair consistently", () => {
    const t0 = Date.parse("2026-09-27T10:00:00Z");
    const items: TriageOrderable[] = [];
    let i = 0;
    for (const impact of values) {
      for (const uncertainty of values) {
        items.push({ id: `id-${String(i).padStart(2, "0")}`, impact, uncertainty, createdAt: new Date(t0 + i * 1000) });
        i += 1;
      }
    }
    const sorted = [...items].sort(compareForTriage);
    for (let k = 1; k < sorted.length; k++) {
      const a = sorted[k - 1]!;
      const b = sorted[k]!;
      const sa = triageScore(a);
      const sb = triageScore(b);
      expect(sa, `${JSON.stringify(a)} before ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(sb);
      if (sa === sb) {
        expect(triageWeight(a.impact)).toBeGreaterThanOrEqual(triageWeight(b.impact));
        if (triageWeight(a.impact) === triageWeight(b.impact)) {
          expect(new Date(a.createdAt).getTime()).toBeGreaterThan(new Date(b.createdAt).getTime());
        }
      }
    }
    // Antisymmetric and total: no two distinct items compare equal.
    for (const a of items) {
      for (const b of items) {
        const ab = Math.sign(compareForTriage(a, b));
        const ba = Math.sign(compareForTriage(b, a));
        expect(ab + ba).toBe(0);
        if (a !== b) expect(ab).not.toBe(0);
      }
    }
  });

  it("DT-QUE-02: (high, high), not rated, (high, low), (low, high), whatever the deposit order", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 8, 27, 10, m));
    // Deposited in the browser run's order: (low, high), (high, low), not rated, (high, high).
    const lowHigh = { id: "a", impact: "low", uncertainty: "high", createdAt: t(1) };
    const highLow = { id: "b", impact: "high", uncertainty: "low", createdAt: t(2) };
    const unrated = { id: "c", impact: null, uncertainty: null, createdAt: t(3) };
    const highHigh = { id: "d", impact: "high", uncertainty: "high", createdAt: t(4) };
    const order = [lowHigh, highLow, unrated, highHigh].sort(compareForTriage).map((d) => d.id);
    expect(order).toEqual(["d", "c", "b", "a"]);
  });

  it("equal score and impact: the most recently deposited first, then the smaller id", () => {
    const older = { id: "z", impact: "high", uncertainty: "low", createdAt: "2026-09-01T00:00:00Z" };
    const newer = { id: "y", impact: "high", uncertainty: "low", createdAt: "2026-09-02T00:00:00Z" };
    expect([older, newer].sort(compareForTriage).map((d) => d.id)).toEqual(["y", "z"]);
    const sameA = { id: "a", impact: null, uncertainty: null, createdAt: "2026-09-01T00:00:00Z" };
    const sameB = { id: "b", impact: null, uncertainty: null, createdAt: "2026-09-01T00:00:00Z" };
    expect([sameB, sameA].sort(compareForTriage).map((d) => d.id)).toEqual(["a", "b"]);
    expect(compareForTriage(sameA, { ...sameA })).toBe(0);
  });
});
