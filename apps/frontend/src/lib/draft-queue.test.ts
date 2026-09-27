import { describe, it, expect } from "vitest";
import {
  queueRatingsText,
  actionLabel,
  actionAccessibleName,
  actionOutcome,
  stateLabel,
  depositedText,
  dashboardDraftsEntry,
  queueTotalText,
  linkNotShownText,
  nextFocusId,
  excerpt,
  QUEUE_ACTIONS,
} from "./draft-queue.js";
import type { QueueItem } from "./draft-queue.js";

const item: QueueItem = {
  id: "11111111-1111-4111-8111-111111111111",
  recipe: "As a backend maintainer working on the cache layer, I prefer write-through caching so that reads never see stale data after a deploy, even under load.",
  recipeBook: { id: "b", name: "Platform", slug: "platform" },
  impact: "high",
  uncertainty: null,
  depositedAt: "2026-09-27T10:00:00.000Z",
  keyLabel: "Claude Code key",
  firstInterpretation: "Could not ask: offline until Monday.",
  state: "unverified",
  canResolve: true,
};

describe("queue item wording (S3-Q4, S3-UI3)", () => {
  it("ratings are the agent's, in words, with not rated for a missing one", () => {
    expect(queueRatingsText(item)).toBe("Agent's ratings: impact high · uncertainty not rated");
    expect(queueRatingsText({ impact: null, uncertainty: null })).toBe("Agent's ratings: not rated");
    expect(queueRatingsText({ impact: "low", uncertainty: "medium" })).toBe("Agent's ratings: impact low · uncertainty medium");
  });

  it("the deposit line names when and which key", () => {
    expect(depositedText(item, "en-GB")).toMatch(/^Deposited 27 \S+ 2026 by Claude Code key$/);
    expect(depositedText({ ...item, keyLabel: null }, "en-GB")).toMatch(/by an agent key$/);
    expect(depositedText({ ...item, depositedAt: "nonsense" })).toBe("Deposited by Claude Code key");
  });

  it("states other than unverified are labelled for id-list links (S3-L3)", () => {
    expect(stateLabel("unverified")).toBeNull();
    expect(stateLabel("published")).toMatch(/Published/);
    expect(stateLabel("rejected")).toBe("Rejected draft");
    expect(stateLabel("not_chosen")).toBe("Draft not chosen");
  });
});

describe("action labels (ruling 27, S3-UI2)", () => {
  it("visible labels say what each action does; confirm names the book", () => {
    expect(actionLabel("confirm", item)).toBe("Confirm: publish to Platform");
    expect(actionLabel("reject", item)).toBe("Reject: keep private");
    expect(actionLabel("not_chosen", item)).toBe("Not chosen: keep private");
  });

  it("accessible names start with the visible label and name the draft, so buttons are told apart", () => {
    const other = { ...item, recipe: "As a designer working on onboarding, I prefer one screen so that nobody gets lost." };
    for (const action of QUEUE_ACTIONS) {
      const name = actionAccessibleName(action, item);
      expect(name.startsWith(actionLabel(action, item))).toBe(true);
      expect(name).toContain("Draft: As a backend maintainer");
      expect(name).not.toBe(actionAccessibleName(action, other));
    }
  });

  it("outcomes say what happened, for the live region", () => {
    expect(actionOutcome("confirm", item)).toMatch(/published to Platform/);
    expect(actionOutcome("reject", item)).toMatch(/stays private/);
    expect(actionOutcome("not_chosen", item)).toMatch(/not chosen/);
  });

  it("excerpts collapse whitespace and cut with an ellipsis", () => {
    expect(excerpt("a  b\nc")).toBe("a b c");
    expect(excerpt("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("dashboard entry and totals (S3-Q8, S3-Q7)", () => {
  it("shows the entry only when drafts are waiting", () => {
    expect(dashboardDraftsEntry(0)).toBeNull();
    expect(dashboardDraftsEntry(undefined)).toBeNull();
    expect(dashboardDraftsEntry(null)).toBeNull();
    expect(dashboardDraftsEntry(1)).toBe("1 draft awaits your review");
    expect(dashboardDraftsEntry(2)).toBe("2 drafts await your review");
  });

  it("the queue's total line and its empty state", () => {
    expect(queueTotalText(0)).toBe("No drafts await your review.");
    expect(queueTotalText(1)).toBe("1 draft awaits your review.");
    expect(queueTotalText(45)).toBe("45 drafts await your review.");
  });
});

describe("id-list link note (S3-L2, S3-L4)", () => {
  it("one wording whatever the reason; nothing when all are shown", () => {
    expect(linkNotShownText(0, false)).toBeNull();
    expect(linkNotShownText(1, false)).toBe("1 recipe in this link is not shown: it does not exist or you cannot see it.");
    expect(linkNotShownText(3, false)).toMatch(/^3 recipes in this link are not shown/);
    expect(linkNotShownText(5, true)).toMatch(/only the first 20/);
    expect(linkNotShownText(0, true)).toMatch(/only the first 20/);
  });
});

describe("focus after an action (S3-A5)", () => {
  it("moves to the next item, else the previous, else the heading (null)", () => {
    expect(nextFocusId(["a", "b", "c"], "a")).toBe("b");
    expect(nextFocusId(["a", "b", "c"], "c")).toBe("b");
    expect(nextFocusId(["a"], "a")).toBeNull();
    expect(nextFocusId(["a", "b"], "z")).toBe("a");
    expect(nextFocusId([], "z")).toBeNull();
  });
});
