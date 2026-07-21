import { describe, it, expect } from "vitest";
import { CHECK_PARAMS, buildQs, readParams, type PageParams } from "./check";

const empty: PageParams = {
  key: null, trace: null, ef: null,
  ea: undefined, sort: undefined, page: undefined, format: undefined,
  clusters: undefined, maxChars: undefined, expand: undefined, compact: undefined,
  axes: undefined, group: undefined, readGroups: undefined, decidedAt: undefined,
  agentId: undefined, knownRecipes: undefined, sessionId: undefined, filter: undefined,
  synthesize: undefined,
  feedbackTraceId: undefined, feedbackKind: undefined, feedbackImpact: undefined,
  feedbackDisposition: undefined, feedbackStoryFulfilled: undefined,
  feedbackStory: undefined, feedbackNote: undefined,
  imageFile: undefined,
};

function makeGet(map: Record<string, string>): (name: string) => string | undefined {
  return (name) => map[name];
}

describe("buildQs", () => {
  // The 2026-05-27 trace-dupe bug: a URL with `recipe_book=soup-net-development`
  // followed by the "Copy results for AI agent" button created two traces in
  // two different books because buildQs dropped `group` from the carry-forward
  // list. The second submission fell back to the api_key default → different
  // group_id → unique constraint correctly did not collapse them. Regression
  // guard.
  it("carries recipe_book (regression for 2026-05-27 trace-dupe bug)", () => {
    const qs = buildQs({ ...empty, key: "k", trace: "t", ef: "e", group: "soup-net-dev" });
    expect(qs).toContain("recipe_book=soup-net-dev");
  });

  // session_id is an intent-preserving param: losing it on the re-check form
  // or Copy-URL round-trip would silently reset the caller's known-set and
  // re-send full bodies for recipes the session already holds.
  it("carries session_id across round-trips", () => {
    const qs = buildQs({ ...empty, key: "k", sessionId: "sess-1234abcd" });
    expect(qs).toContain("session_id=sess-1234abcd");
  });

  it("carries every roundTrip-carry field when set", () => {
    for (const spec of CHECK_PARAMS) {
      if (spec.roundTrip === "override-only") continue;
      const params: PageParams = { ...empty, [spec.field]: "test-value" } as PageParams;
      const qs = buildQs(params);
      expect(qs, `field ${spec.field} should be carried as ${spec.wire}`).toContain(
        `${spec.wire}=test-value`,
      );
    }
  });

  it("emits canonical wire name when struct field differs", () => {
    const qs = buildQs({ ...empty, group: "x", readGroups: "y", maxChars: "100" });
    expect(qs).toContain("recipe_book=x");
    expect(qs).toContain("read_recipe_books=y");
    expect(qs).toContain("max_chars=100");
    expect(qs).not.toContain("group=");
    expect(qs).not.toContain("readGroups=");
    expect(qs).not.toContain("maxChars=");
  });

  it("override-only fields do not round-trip from params", () => {
    const qs = buildQs({
      ...empty, key: "k", page: "5", format: "json", expand: "true", compact: "false",
    });
    expect(qs).toContain("key=k");
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("format=");
    expect(qs).not.toContain("expand=");
    expect(qs).not.toContain("compact=");
  });

  // Ride-along feedback params must NEVER carry forward — round-tripping
  // them into the Copy-URL or the re-check hidden form would attach the same
  // feedback row to the next check too and double-log it.
  it("feedback_* ride-along params do not round-trip from params", () => {
    const qs = buildQs({
      ...empty,
      key: "k",
      feedbackTraceId: "18912fbd-0000-0000-0000-000000000000",
      feedbackKind: "check-feedback",
      feedbackImpact: "subtle",
      feedbackDisposition: "proceeded",
      feedbackStoryFulfilled: "yes",
      feedbackStory: "As a developer, I logged feedback so that future checks calibrate.",
      feedbackNote: "test note",
    });
    expect(qs).toContain("key=k");
    expect(qs).not.toContain("feedback_trace_id=");
    expect(qs).not.toContain("feedback_kind=");
    expect(qs).not.toContain("feedback_impact=");
    expect(qs).not.toContain("feedback_disposition=");
    expect(qs).not.toContain("feedback_story_fulfilled=");
    expect(qs).not.toContain("feedback_story=");
    expect(qs).not.toContain("feedback_note=");
  });

  it("overrides replace carry values", () => {
    const qs = buildQs({ ...empty, sort: "relevance" }, { sort: "recent" });
    expect(qs).toContain("sort=recent");
    expect(qs).not.toContain("sort=relevance");
  });

  it("expand override cancels clusters and max_chars", () => {
    const qs = buildQs(
      { ...empty, clusters: "5", maxChars: "2000", sort: "relevance" },
      { expand: "true" },
    );
    expect(qs).toContain("expand=true");
    expect(qs).toContain("sort=relevance"); // sort is unaffected by expand
    expect(qs).not.toContain("clusters=");
    expect(qs).not.toContain("max_chars=");
  });

  it("returns empty string when nothing to emit", () => {
    expect(buildQs(empty)).toBe("");
  });

  it("URL-encodes values", () => {
    const qs = buildQs({ ...empty, trace: "hello world & friends" });
    expect(qs).toContain("trace=hello%20world%20%26%20friends");
  });
});

describe("readParams", () => {
  it("reads canonical wire names", () => {
    const p = readParams(makeGet({ key: "K", trace: "T", ef: "E", recipe_book: "R", session_id: "S" }));
    expect(p.key).toBe("K");
    expect(p.trace).toBe("T");
    expect(p.ef).toBe("E");
    expect(p.group).toBe("R");
    expect(p.sessionId).toBe("S");
  });

  it("falls through to aliases when wire name is unset", () => {
    const p = readParams(makeGet({
      recipe: "Hello",
      evidence: "World",
      group: "old-name",
      read_groups: "a,b",
      decided: "2024-03-15",
      f: "keyword narrowing",
    }));
    expect(p.trace).toBe("Hello");
    expect(p.ef).toBe("World");
    expect(p.group).toBe("old-name");
    expect(p.readGroups).toBe("a,b");
    expect(p.decidedAt).toBe("2024-03-15");
    expect(p.filter).toBe("keyword narrowing");
  });

  it("wire name wins when both wire and alias are set", () => {
    const p = readParams(makeGet({ trace: "from-wire", recipe: "from-alias" }));
    expect(p.trace).toBe("from-wire");
  });

  it("missing nullable fields default to null", () => {
    const p = readParams(makeGet({}));
    expect(p.key).toBeNull();
    expect(p.trace).toBeNull();
    expect(p.ef).toBeNull();
  });

  it("missing non-nullable fields default to undefined", () => {
    const p = readParams(makeGet({}));
    expect(p.group).toBeUndefined();
    expect(p.readGroups).toBeUndefined();
    expect(p.axes).toBeUndefined();
    expect(p.sort).toBeUndefined();
  });

  it("reads feedback_* wire params with no aliases", () => {
    const p = readParams(makeGet({
      feedback_trace_id: "18912fbd-0000-0000-0000-000000000000",
      feedback_kind: "check-feedback",
      feedback_impact: "subtle",
      feedback_disposition: "proceeded",
      feedback_story_fulfilled: "yes",
      feedback_story: "story text",
      feedback_note: "note text",
    }));
    expect(p.feedbackTraceId).toBe("18912fbd-0000-0000-0000-000000000000");
    expect(p.feedbackKind).toBe("check-feedback");
    expect(p.feedbackImpact).toBe("subtle");
    expect(p.feedbackDisposition).toBe("proceeded");
    expect(p.feedbackStoryFulfilled).toBe("yes");
    expect(p.feedbackStory).toBe("story text");
    expect(p.feedbackNote).toBe("note text");
  });

  it("preserves empty-string for nullable fields (matches `?? null` semantics)", () => {
    // `?recipe=` with explicit empty value: original GET reader returned ""
    // (via `c.req.query("trace") ?? c.req.query("recipe") ?? null` — `??`
    // only falls through on null/undefined). Downstream falsy-checks
    // (`if (params.trace && ...)`) treat "" and null the same anyway, but
    // we preserve the type contract.
    const p = readParams(makeGet({ trace: "" }));
    expect(p.trace).toBe("");
  });
});

describe("feedback_* CHECK_PARAMS rows", () => {
  const feedbackFields = [
    "feedbackTraceId", "feedbackKind", "feedbackImpact", "feedbackDisposition",
    "feedbackStoryFulfilled", "feedbackStory", "feedbackNote",
  ];
  const feedbackWires = [
    "feedback_trace_id", "feedback_kind", "feedback_impact", "feedback_disposition",
    "feedback_story_fulfilled", "feedback_story", "feedback_note",
  ];

  it("declares one row per feedback field, override-only, no aliases", () => {
    for (const field of feedbackFields) {
      const spec = CHECK_PARAMS.find((s) => s.field === field);
      expect(spec, `CHECK_PARAMS should declare a row for ${field}`).toBeDefined();
      expect(spec!.roundTrip).toBe("override-only");
      expect(spec!.aliases).toEqual([]);
    }
  });

  it("uses the settled flat snake_case wire names", () => {
    for (let i = 0; i < feedbackFields.length; i++) {
      const spec = CHECK_PARAMS.find((s) => s.field === feedbackFields[i]);
      expect(spec!.wire).toBe(feedbackWires[i]);
    }
  });
});
