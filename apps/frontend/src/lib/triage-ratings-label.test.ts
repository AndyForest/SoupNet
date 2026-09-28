import { describe, it, expect } from "vitest";
import { triageRatingsLabel, TRIAGE_RATINGS_TITLE } from "./triage-ratings-label";

// drafts-and-triage slice 1: S1-B7 / DT-RAT-09 — the detail page shows the
// ratings as the agent's, with no claim they are the person's own assessment.
describe("triageRatingsLabel (S1-B7 / DT-RAT-09)", () => {
  it("labels both ratings as the agent's", () => {
    expect(triageRatingsLabel({ impact: "high", uncertainty: "high" })).toBe(
      "Agent's ratings: impact high · uncertainty high",
    );
  });

  it("names a missing rating as not rated", () => {
    expect(triageRatingsLabel({ impact: "low", uncertainty: null })).toBe(
      "Agent's ratings: impact low · uncertainty not rated",
    );
    expect(triageRatingsLabel({ uncertainty: "medium" })).toBe(
      "Agent's ratings: impact not rated · uncertainty medium",
    );
  });

  it("shows nothing when the agent rated neither", () => {
    expect(triageRatingsLabel({ impact: null, uncertainty: null })).toBeNull();
    expect(triageRatingsLabel({})).toBeNull();
  });

  it("the hover text disclaims the person's own assessment", () => {
    expect(TRIAGE_RATINGS_TITLE).toContain("not your assessment");
  });
});
