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
  whyLabel,
  partyText,
  linkHeading,
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
    // Fix pass (E10): a verified draft says so to its person.
    expect(stateLabel("verified")).toMatch(/^Verified draft/);
    expect(stateLabel("verified")).not.toMatch(/not a draft/);
  });

  it("the interpretation is labelled as the agent's reason only on drafts (fix pass)", () => {
    for (const s of ["unverified", "rejected", "not_chosen", "verified"] as const) expect(whyLabel(s)).toBe("Why your agent drafted it:");
    expect(whyLabel("published")).toBe("Evidence:");
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
      expect(name).toContain("Draft 11111111: As a backend maintainer");
      expect(name).not.toBe(actionAccessibleName(action, other));
    }
  });

  it("names stay unique when two drafts share their first 80 characters (fix pass)", () => {
    const opening = "As a backend maintainer working on paging, I prefer page one of the same thought so that folding hides it ";
    const a = { ...item, id: "aaaaaaaa-1111-4111-8111-111111111111", recipe: `${opening}— alpha` };
    const b = { ...item, id: "bbbbbbbb-1111-4111-8111-111111111111", recipe: `${opening}— beta` };
    expect(excerpt(a.recipe)).toBe(excerpt(b.recipe));
    for (const action of QUEUE_ACTIONS) {
      expect(actionAccessibleName(action, a)).not.toBe(actionAccessibleName(action, b));
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

describe("slice 4: drafts deposited on someone else's behalf (S4-Q2, S4-Q5, S4-UI2)", () => {
  const base = { depositedAt: "2026-09-27T10:00:00Z", keyLabel: "Dana laptop", impact: "high", uncertainty: null };

  it("names the depositor beside the key label, and says the ratings are the depositing agent's", () => {
    const item = { ...base, depositedBy: "dana@test.local" };
    expect(depositedText(item, "en-GB")).toContain("by dana@test.local (Dana laptop)");
    expect(queueRatingsText(item)).toBe("Depositing agent's ratings: impact high · uncertainty not rated");
    expect(whyLabel("unverified", item)).toBe("Why their agent drafted it:");
    expect(partyText(item)).toBe("Deposited on your behalf by dana@test.local");
  });

  it("names the subject to the depositor", () => {
    expect(partyText({ about: "pat@test.local" })).toBe("About pat@test.local");
  });

  it("a draft the person's own agent deposited reads as before", () => {
    expect(depositedText(base, "en-GB")).toContain("by Dana laptop");
    expect(queueRatingsText(base)).toBe("Agent's ratings: impact high · uncertainty not rated");
    expect(whyLabel("unverified")).toBe("Why your agent drafted it:");
    expect(partyText({})).toBeNull();
  });
});

describe("the id-list heading is true for whoever opens the link (slice 4 fix pass)", () => {
  it("says 'your agent' only when every linked draft is the viewer's own agent's", () => {
    expect(linkHeading([{ depositedBy: null, about: null }])).toBe("Drafts your agent linked");
    expect(linkHeading([{ depositedBy: null, about: "pat@test.local" }])).toBe("Linked drafts");
    expect(linkHeading([{ depositedBy: "dana@test.local", about: null }])).toBe("Linked drafts");
    expect(linkHeading([])).toBe("Drafts your agent linked");
  });
});
