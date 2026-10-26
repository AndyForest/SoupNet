import { describe, it, expect } from "vitest";
import { groupByOwnIntent } from "./draft-queue.service";

/**
 * Layer 1: the review queue's stable grouping of a page by the viewer's own
 * intent (drafts-and-triage slice 6a, S6a-G3). Used on the semantic listing;
 * the triage listing groups in SQL (Layer 3, routes/intent-link.test.ts).
 */

const A = { id: "int_A" };
const B = { id: "int_B" };
const item = (id: string, intent: { id: string } | null) => ({ id, intent });

describe("groupByOwnIntent", () => {
  it("puts each group at its first member's position, members in their given order", () => {
    const out = groupByOwnIntent([item("1", A), item("2", null), item("3", B), item("4", A), item("5", null), item("6", B)]);
    expect(out.map((i) => i.id)).toEqual(["1", "4", "2", "3", "6", "5"]);
  });

  it("keeps ungrouped items in place and in order", () => {
    const out = groupByOwnIntent([item("1", null), item("2", null), item("3", null)]);
    expect(out.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("is the identity on an already grouped list and on an empty one", () => {
    const grouped = [item("1", A), item("2", A), item("3", null), item("4", B)];
    expect(groupByOwnIntent(grouped)).toEqual(grouped);
    expect(groupByOwnIntent([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [item("1", A), item("2", null), item("3", A)];
    const copy = input.map((i) => ({ ...i }));
    groupByOwnIntent(input);
    expect(input).toEqual(copy);
  });
});
