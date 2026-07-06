import { describe, it, expect } from "vitest";
import { groupChecksByTrace } from "./group-checks";

function check(id: string, traceId: string, occurredAt = "2026-07-05T00:00:00.000Z") {
  return { id, traceId, occurredAt };
}

describe("groupChecksByTrace", () => {
  it("returns one group per distinct trace when there are no repeats", () => {
    const checks = [check("c1", "t1"), check("c2", "t2"), check("c3", "t3")];
    const groups = groupChecksByTrace(checks);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.count)).toEqual([1, 1, 1]);
  });

  it("collapses consecutive repeats of the same trace into one row with a count", () => {
    // open + refresh + JSON fetch of the same check URL — the reported bug.
    const checks = [check("c1", "t1"), check("c2", "t1"), check("c3", "t1")];
    const groups = groupChecksByTrace(checks);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.latest.id).toBe("c1"); // most recent (first in list) anchors the row
    expect(groups[0]!.entryIds).toEqual(["c1", "c2", "c3"]);
  });

  it("collapses repeats even when interleaved with other traces", () => {
    const checks = [check("c1", "t1"), check("c2", "t2"), check("c3", "t1")];
    const groups = groupChecksByTrace(checks);
    expect(groups).toHaveLength(2);
    const t1Group = groups.find((g) => g.latest.traceId === "t1")!;
    expect(t1Group.count).toBe(2);
    expect(t1Group.entryIds).toEqual(["c1", "c3"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupChecksByTrace([])).toEqual([]);
  });

  it("preserves first-seen order for group rows", () => {
    const checks = [check("c1", "t2"), check("c2", "t1"), check("c3", "t2")];
    const groups = groupChecksByTrace(checks);
    expect(groups.map((g) => g.latest.traceId)).toEqual(["t2", "t1"]);
  });
});
