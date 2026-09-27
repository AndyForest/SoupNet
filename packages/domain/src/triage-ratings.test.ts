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
} from "./triage-ratings";

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
