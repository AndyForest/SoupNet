import { describe, it, expect } from "vitest";
import { parseQueueQuery } from "./draft-queue.service";

// Slice 10 (S10-K2): the queue pins is:draft on, unless the person asked for
// is:expired, which lists the drafts that expired unanswered instead.
describe("parseQueueQuery", () => {
  it("pins is:draft on an empty or ordinary query", () => {
    for (const q of [undefined, "", "cache strategy", "impact:high"]) {
      const r = parseQueueQuery(q);
      expect(r.ok, String(q)).toBe(true);
      if (r.ok) {
        expect(r.query.isDraft).toBe(true);
        expect(r.query.isExpired).toBeUndefined();
      }
    }
  });

  it("keeps is:expired as asked, with its other qualifiers and text", () => {
    const r = parseQueueQuery("is:expired impact:high cache");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.query.isExpired).toBe(true);
      expect(r.query.isDraft).toBeUndefined();
      expect(r.query.semanticText).toBe("cache");
      expect(r.query.impact).toEqual({ equals: "high", excluded: [] });
    }
  });

  it("still refuses -is:draft", () => {
    expect(parseQueueQuery("-is:draft").ok).toBe(false);
  });
});
