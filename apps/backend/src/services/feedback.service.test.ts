import { describe, it, expect } from "vitest";
import {
  validateFeedbackRow,
  summarizeFeedbackResults,
  TRACE_NOT_READABLE,
} from "./feedback.service";
import type { RawFeedbackRow, FeedbackRowResult } from "./feedback.service";

const TRACE_ID = "7676e323-e4a8-493e-b705-febfac26081a";

function validRow(overrides: Partial<RawFeedbackRow> = {}): RawFeedbackRow {
  return {
    trace_id: TRACE_ID,
    kind: "check-feedback",
    impact: "subtle",
    disposition: "proceeded",
    story_fulfilled: "yes",
    story: "As an AI sub-agent working on X, I wanted Y so that Z",
    ...overrides,
  };
}

describe("validateFeedbackRow", () => {
  it("accepts a minimal valid row", () => {
    const v = validateFeedbackRow(validRow());
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.row.traceId).toBe(TRACE_ID);
      expect(v.row.kind).toBe("check-feedback");
      expect(v.row.note).toBeNull();
      expect(v.row.relatedTraceIds).toBeNull();
    }
  });

  it("accepts a fully-populated row and normalizes optionals", () => {
    const v = validateFeedbackRow(validRow({
      note: "  changed approach  ",
      agent_id: "a-test",
      top_similarity: 0.78,
      model: "claude-fable-5",
      harness: "claude-code",
      harness_version: "2.1",
      related_trace_ids: [TRACE_ID],
    }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.row.note).toBe("changed approach");
      expect(v.row.topSimilarity).toBe(0.78);
      expect(v.row.relatedTraceIds).toEqual([TRACE_ID]);
    }
  });

  it("rejects a missing or malformed trace_id", () => {
    for (const bad of [undefined, "", "not-a-uuid", 42]) {
      const v = validateFeedbackRow(validRow({ trace_id: bad as never }));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain("trace_id");
    }
  });

  it("rejects bad enum values with a message listing the vocabulary", () => {
    const cases: Array<{ field: keyof RawFeedbackRow; vocabPart: string }> = [
      { field: "kind", vocabPart: "check-feedback | operational | outcome" },
      { field: "impact", vocabPart: "none | new | subtle | big | operational" },
      { field: "disposition", vocabPart: "proceeded | corrected | asked-human | charted-new | deferred" },
      { field: "story_fulfilled", vocabPart: "yes | partial | no | unknown" },
    ];
    for (const { field, vocabPart } of cases) {
      const v = validateFeedbackRow(validRow({ [field]: "bogus" }));
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.error).toContain(String(field));
        expect(v.error).toContain(vocabPart);
        expect(v.error).toContain("bogus");
      }
    }
  });

  it("rejects a missing story", () => {
    const v = validateFeedbackRow(validRow({ story: "   " }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("story");
  });

  it("rejects out-of-range top_similarity", () => {
    for (const bad of [-0.1, 1.5, "high"]) {
      const v = validateFeedbackRow(validRow({ top_similarity: bad as never }));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain("top_similarity");
    }
  });

  it("rejects non-uuid related_trace_ids entries", () => {
    const v = validateFeedbackRow(validRow({ related_trace_ids: ["nope"] }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("related_trace_ids");
  });

  it("rejects oversized text fields", () => {
    const v = validateFeedbackRow(validRow({ note: "x".repeat(5000) }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("note too long");
  });
});

describe("summarizeFeedbackResults", () => {
  it("summarizes mixed results with per-row markers", () => {
    const results: FeedbackRowResult[] = [
      { index: 0, ok: true, traceId: TRACE_ID, feedbackId: "f1" },
      { index: 1, ok: false, traceId: "bad", error: TRACE_NOT_READABLE },
    ];
    const text = summarizeFeedbackResults(results);
    expect(text).toContain("Feedback: 1/2 row(s) recorded.");
    expect(text).toContain(`row 2 (bad): ${TRACE_NOT_READABLE}`);
  });

  it("returns empty string for no rows", () => {
    expect(summarizeFeedbackResults([])).toBe("");
  });
});
