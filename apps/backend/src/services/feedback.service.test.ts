import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  validateFeedbackRow,
  summarizeFeedbackResults,
  ingestFeedback,
  isTraceIdPrefix,
  uuidPrefixRange,
  MIN_TRACE_ID_PREFIX,
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

  it("accepts an 8-char short-id prefix and normalizes it to lowercase", () => {
    const v = validateFeedbackRow(validRow({ trace_id: "7676E323" }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row.traceId).toBe("7676e323");
  });

  it("accepts a longer partial UUID with canonical hyphens", () => {
    const v = validateFeedbackRow(validRow({ trace_id: "7676e323-e4a8" }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row.traceId).toBe("7676e323-e4a8");
  });

  it("rejects prefixes shorter than the minimum, with an actionable message", () => {
    const v = validateFeedbackRow(validRow({ trace_id: "7676e32" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain(`at least ${MIN_TRACE_ID_PREFIX} characters`);
  });

  it("rejects non-hex and mis-hyphenated prefixes", () => {
    for (const bad of ["7676e32z", "7676e323e4a8" + "-", "7676e323_e4a8"]) {
      const v = validateFeedbackRow(validRow({ trace_id: bad }));
      expect(v.ok).toBe(false);
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

  // session_id is capture-only (2026-07-17): a valid token is stored, anything
  // else — malformed, wrong type, absent — becomes NULL. Never a rejection
  // (a mangled token must not cost the feedback it rides with) and never a
  // minted fresh token (feedback joins a session, it doesn't start one).
  it("captures a valid session_id, trimmed", () => {
    const v = validateFeedbackRow(validRow({ session_id: "  sess_2026-07-17a  " }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row.sessionId).toBe("sess_2026-07-17a");
  });

  it("stores NULL for malformed session_id values without rejecting the row", () => {
    for (const bad of ["short", "has spaces here", "bang!bang!", "x".repeat(65), 42, {}, null]) {
      const v = validateFeedbackRow(validRow({ session_id: bad as never }));
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.row.sessionId).toBeNull();
    }
  });

  it("stores NULL when session_id is absent", () => {
    const v = validateFeedbackRow(validRow());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row.sessionId).toBeNull();
  });
});

describe("isTraceIdPrefix", () => {
  it("accepts canonical prefixes from 8 chars up to 35 chars", () => {
    expect(isTraceIdPrefix("7676e323")).toBe(true);
    expect(isTraceIdPrefix("7676e323-")).toBe(true);
    expect(isTraceIdPrefix(TRACE_ID.slice(0, 35))).toBe(true);
  });

  it("rejects full UUIDs (handled by the UUID path), short fragments, and non-canonical shapes", () => {
    expect(isTraceIdPrefix(TRACE_ID)).toBe(false); // full 36-char UUID
    expect(isTraceIdPrefix("7676e32")).toBe(false); // 7 chars
    expect(isTraceIdPrefix("7676e323e4a8")).toBe(false); // hyphen missing at position 8
    expect(isTraceIdPrefix("7676e32g")).toBe(false); // non-hex
  });
});

describe("uuidPrefixRange", () => {
  it("pads an 8-char prefix into an inclusive canonical UUID range", () => {
    const { lo, hi } = uuidPrefixRange("7676e323");
    expect(lo).toBe("7676e323-0000-0000-0000-000000000000");
    expect(hi).toBe("7676e323-ffff-ffff-ffff-ffffffffffff");
  });

  it("handles hyphenated prefixes and uppercase input", () => {
    const { lo, hi } = uuidPrefixRange("7676E323-E4A8");
    expect(lo).toBe("7676e323-e4a8-0000-0000-000000000000");
    expect(hi).toBe("7676e323-e4a8-ffff-ffff-ffffffffffff");
  });
});

describe("ingestFeedback short-id prefix resolution (stubbed db)", () => {
  // The ambiguity branch cannot be forced through the API with random UUIDs
  // (an 8-char collision needs a birthday-scale corpus), so it's covered
  // here deterministically with a stubbed db. The happy/none paths get both
  // this unit coverage and the Layer 3 integration tests in
  // routes/feedback.test.ts.
  const GROUP = "11111111-1111-1111-1111-111111111111";
  const T1 = "7676e323-e4a8-493e-b705-febfac26081a";
  const T2 = "7676e323-0000-4000-8000-000000000000";

  beforeEach(() => {
    vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubDb(executeResults: Array<Array<{ id: string }>>) {
    let call = 0;
    return {
      execute: async () => executeResults[call++] ?? [],
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: "fb-00000000" }],
        }),
      }),
    } as unknown as PostgresJsDatabase;
  }

  it("resolves an unambiguous prefix and echoes the full UUID on success", async () => {
    const results = await ingestFeedback({
      db: stubDb([[{ id: T1 }]]),
      apiKeyId: "22222222-2222-2222-2222-222222222222",
      readGroupIds: [GROUP],
      rows: [validRow({ trace_id: T1.slice(0, 8) })],
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.traceId).toBe(T1);
    expect(results[0]?.feedbackId).toBe("fb-00000000");
  });

  it("rejects an ambiguous prefix with an error naming the readable candidates", async () => {
    const results = await ingestFeedback({
      db: stubDb([[{ id: T1 }, { id: T2 }]]),
      apiKeyId: "22222222-2222-2222-2222-222222222222",
      readGroupIds: [GROUP],
      rows: [validRow({ trace_id: "7676e323" })],
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toContain("ambiguous");
    expect(results[0]?.error).toContain(T1);
    expect(results[0]?.error).toContain(T2);
    expect(results[0]?.error).toContain("full UUID");
  });

  it("gives a zero-match prefix the same uniform marker as an unknown full UUID", async () => {
    const results = await ingestFeedback({
      db: stubDb([[], []]),
      apiKeyId: "22222222-2222-2222-2222-222222222222",
      readGroupIds: [GROUP],
      rows: [validRow({ trace_id: "ffffffff" }), validRow({ trace_id: T2 })],
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[1]?.ok).toBe(false);
    // Anti-enumeration: identical marker text for both shapes.
    expect(results[0]?.error).toBe(TRACE_NOT_READABLE);
    expect(results[1]?.error).toBe(TRACE_NOT_READABLE);
  });

  it("never resolves a prefix when the key has no read scope", async () => {
    let executed = 0;
    const db = {
      execute: async () => {
        executed++;
        return [{ id: T1 }];
      },
    } as unknown as PostgresJsDatabase;
    const results = await ingestFeedback({
      db,
      apiKeyId: "22222222-2222-2222-2222-222222222222",
      readGroupIds: [],
      rows: [validRow({ trace_id: T1.slice(0, 8) })],
    });
    expect(executed).toBe(0); // no resolution query without a read scope
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toBe(TRACE_NOT_READABLE);
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
