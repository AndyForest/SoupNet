import { describe, it, expect } from "vitest";
import { draftStatusLabel, draftPartyLine, deleteDraftAccessibleName, showsKeyBadge, reactionPrompt, offeredReactions } from "./draft-status-label";

// drafts-and-triage slice 2: the trace detail page tells the person a recipe
// is their draft, and how it was verified (build log open question 14: show
// "verified by the depositing agent" so the person can audit it).
describe("draftStatusLabel", () => {
  it("shows nothing for a recipe that was never a draft", () => {
    expect(draftStatusLabel({ draftState: null })).toBeNull();
    expect(draftStatusLabel({})).toBeNull();
  });

  it("DT-VIS-01 / DT-VER-01: an unverified draft says who can see it and how to verify or reject it", () => {
    const l = draftStatusLabel({ draftState: "unverified" })!;
    expect(l.text).toContain("Unverified draft");
    expect(l.title).toContain("Only you and your agents");
    expect(l.title).toContain("Still true");
    expect(l.title).toContain("Wrong");
  });

  it("DT-VER-01: verified with a reaction, by the viewer", () => {
    const l = draftStatusLabel({ draftState: "verified", draftResolvedAt: "2026-09-27T10:00:00Z", draftResolvedByKeyId: null, draftResolvedByViewer: true })!;
    expect(l.text).toContain("Verified draft");
    expect(l.text).toContain("by you");
  });

  it("[F83] \"by you\" only when the viewer resolved it", () => {
    const l = draftStatusLabel({ draftState: "verified", draftResolvedByKeyId: null, draftResolvedByViewer: false })!;
    expect(l.text).not.toContain("by you");
    expect(l.text).toContain("by the person it is about");
    expect(draftStatusLabel({ draftState: "verified", draftResolvedByKeyId: null })!.text).not.toContain("by you");
  });

  it("DT-VER-04: verified by an agent, and flagged when it was the agent that deposited it", () => {
    const other = draftStatusLabel({ draftState: "verified", draftResolvedByKeyId: "k2", apiKeyId: "k1" })!;
    expect(other.text).toContain("by your agent");
    const same = draftStatusLabel({ draftState: "verified", draftResolvedByKeyId: "k1", apiKeyId: "k1" })!;
    expect(same.text).toContain("by the agent that deposited it");
  });

  it("DT-VER-02: rejected and not-chosen drafts stay private", () => {
    expect(draftStatusLabel({ draftState: "rejected" })!.text).toContain("Rejected draft");
    expect(draftStatusLabel({ draftState: "not_chosen" })!.text).toContain("not chosen");
  });
});

describe("slice 4: on-behalf drafts on the detail page (S4-L1, S4-UI2)", () => {
  it("names the other party as text, from each side", () => {
    expect(draftPartyLine({ draftDepositedBy: "dana@test.local" })).toBe("Deposited by dana@test.local's agent, on your behalf");
    expect(draftPartyLine({ draftAbout: "pat@test.local", draftState: "unverified" })).toBe("About pat@test.local: only they can confirm or reject it");
    expect(draftPartyLine({})).toBeNull();
  });

  it("the depositor's delete control says what it removes", () => {
    expect(deleteDraftAccessibleName({ draftAbout: "pat@test.local", claimText: "As a backend maintainer, I prefer X so that Y." }))
      .toBe("Delete draft about pat@test.local: As a backend maintainer, I prefer X so that Y.");
    expect(deleteDraftAccessibleName({ claimText: "x" })).toBeUndefined();
  });

  it("the status title tells each party who can see it", () => {
    expect(draftStatusLabel({ draftState: "unverified", draftAbout: "pat@test.local" })!.title).toContain("only they and you");
    expect(draftStatusLabel({ draftState: "unverified", draftDepositedBy: "dana@test.local" })!.title).toContain("dana@test.local's agent");
  });
});

describe("[F93] the key badge shows only under its owner's authorship", () => {
  it("shows for the author's own key, and hides entirely for a verified on-behalf recipe's key", () => {
    expect(showsKeyBadge({ apiKeyId: "k1", apiKeyIsAuthors: true })).toBe(true);
    expect(showsKeyBadge({ apiKeyId: "k1", apiKeyIsAuthors: false })).toBe(false);
    expect(showsKeyBadge({ apiKeyId: null, apiKeyIsAuthors: true })).toBe(false);
  });
});

describe("depositor-facing copy is true for the depositor (slice 4 fix pass)", () => {
  it("a resolved draft's party line no longer says only they can confirm it", () => {
    expect(draftPartyLine({ draftAbout: "pat@test.local", draftState: "unverified" })).toBe("About pat@test.local: only they can confirm or reject it");
    for (const draftState of ["rejected", "not_chosen"]) {
      expect(draftPartyLine({ draftAbout: "pat@test.local", draftState })).toBe("About pat@test.local");
    }
  });

  it("the depositor's tooltip on a resolved draft names the person who resolved it, not 'you'", () => {
    const rejected = draftStatusLabel({ draftState: "rejected", draftAbout: "pat@test.local" })!;
    expect(rejected.title).toContain("pat@test.local rejected this draft");
    expect(rejected.title).not.toContain("You marked");
    const notChosen = draftStatusLabel({ draftState: "not_chosen", draftAbout: "pat@test.local" })!;
    expect(notChosen.title).toContain("pat@test.local");
    // The subject's own view, when it knows they resolved it themselves.
    expect(draftStatusLabel({ draftState: "rejected", draftResolvedByKeyId: null, draftResolvedByViewer: true })!.title).toContain("You marked this draft wrong");
  });
});

// Slice 6c (S6c-C2): an agent can now reject a draft or mark it not chosen,
// so those lines say who resolved it, as the verified line does, instead of
// "You marked this draft wrong" whoever did it.
describe("who resolved a rejected or not-chosen draft (slice 6c)", () => {
  const KEY = "key-1";
  const at = "2026-10-24T10:00:00Z";

  it("names the viewer's agent, and the depositing agent, for each outcome", () => {
    for (const [draftState, head] of [["rejected", "Rejected draft"], ["not_chosen", "Draft not chosen"]] as const) {
      const byAgent = draftStatusLabel({ draftState, draftResolvedAt: at, draftResolvedByKeyId: KEY, apiKeyId: "other", draftResolvedByViewer: true })!;
      expect(byAgent.text.startsWith(`${head} (by your agent on `)).toBe(true);
      expect(byAgent.title).not.toContain("You marked");
      expect(byAgent.title).toContain("its evidence");
      const byDepositor = draftStatusLabel({ draftState, draftResolvedAt: at, draftResolvedByKeyId: KEY, apiKeyId: KEY, draftResolvedByViewer: true })!;
      expect(byDepositor.text).toContain("by the agent that deposited it");
    }
  });

  // Verifier's defect 1: list rows (dashboard, book page) come from GET
  // /traces, which carries the state but not who resolved it, so the label
  // must not invent "by the person it is about" there.
  it("names no resolver on a row that does not say who resolved it (the dashboard and book lists)", () => {
    expect(draftStatusLabel({ draftState: "rejected" })!.text).toBe("Rejected draft");
    expect(draftStatusLabel({ draftState: "not_chosen" })!.text).toBe("Draft not chosen");
    expect(draftStatusLabel({ draftState: "verified" })!.text).toBe("Verified draft");
    expect(draftStatusLabel({ draftState: "rejected", draftResolvedAt: at })!.text).toMatch(/^Rejected draft on /);
    for (const draftState of ["rejected", "not_chosen", "verified"]) {
      const l = draftStatusLabel({ draftState })!;
      expect(l.text).not.toContain("by ");
      expect(l.title).not.toContain("You marked");
    }
  });

  it("still says the viewer did it when they resolved it in the queue or with a reaction", () => {
    const l = draftStatusLabel({ draftState: "rejected", draftResolvedAt: at, draftResolvedByKeyId: null, draftResolvedByViewer: true })!;
    expect(l.text).toMatch(/^Rejected draft \(by you on /);
    expect(l.title).toContain("You marked this draft wrong");
  });
});

// Post-merge findings (2026-09-29): the line beside the reactions says what is
// true for the viewer, and a draft offers only the reactions that resolve it.
describe("reactionPrompt", () => {
  it("asks the subject to review an unresolved draft", () => {
    expect(reactionPrompt({ canResolveDraft: true, draftState: "unverified" })).toBe("Is this draft right? Still true verifies it; Wrong rejects it.");
  });

  it("tells the depositor who reviews an unresolved draft, with the review-link instruction", () => {
    expect(reactionPrompt({ draftAbout: "pat@test.local", draftState: "unverified" })).toBe(
      "Only pat@test.local can review this draft; send them the review link from your agent.",
    );
  });

  it("tells the depositor a resolved draft is resolved, with no review-link instruction", () => {
    for (const draftState of ["rejected", "not_chosen"]) {
      const line = reactionPrompt({ draftAbout: "pat@test.local", draftState });
      expect(line).toBe("pat@test.local has resolved this draft; there is nothing left to review.");
      expect(line).not.toMatch(/review link/);
    }
  });

  it("asks about any other recipe as before", () => {
    expect(reactionPrompt({ draftState: null })).toBe("Is this recipe still right?");
    expect(reactionPrompt({ draftState: "rejected" })).toBe("Is this recipe still right?");
  });
});

describe("offeredReactions", () => {
  it("offers only Still true and Wrong on an unresolved draft, as the prompt says", () => {
    expect(offeredReactions({ draftState: "unverified" }, null)).toEqual(["still_true", "wrong"]);
  });

  it("keeps Stale when it is the viewer's own reaction, so it can be cleared", () => {
    expect(offeredReactions({ draftState: "unverified" }, "stale")).toEqual(["still_true", "stale", "wrong"]);
  });

  it("offers all three on any other recipe", () => {
    expect(offeredReactions({}, null)).toEqual(["still_true", "stale", "wrong"]);
    for (const draftState of [null, "verified", "rejected", "not_chosen"]) {
      expect(offeredReactions({ draftState }, null)).toEqual(["still_true", "stale", "wrong"]);
    }
  });
});

// Slice 10 (S10-C1): an expired draft's line says so and keeps its reactions.
describe("an expired draft (slice 10)", () => {
  it("says it expired, why, and that the person can still resolve it", () => {
    const l = draftStatusLabel({ draftState: "unverified", draftExpiry: "age" })!;
    expect(l.text).toBe("Unverified draft, expired");
    expect(l.title).toContain("over a week ago with no task attached");
    expect(l.title).toContain("left the review queue");
    expect(l.title).toContain("Still true");
    expect(draftStatusLabel({ draftState: "unverified", draftExpiry: "intent_idle" })!.title).toContain("quiet for over a day");
  });

  it("tells the depositor only the person it is about can resolve it", () => {
    const l = draftStatusLabel({ draftState: "unverified", draftExpiry: "age", draftAbout: "pat@test.local" })!;
    expect(l.title).toContain("Only pat@test.local can still verify or reject it.");
  });

  it("a live draft's line is unchanged", () => {
    expect(draftStatusLabel({ draftState: "unverified", draftExpiry: null })!.text).toBe("Unverified draft");
    expect(offeredReactions({ draftState: "unverified" }, null)).toEqual(["still_true", "wrong"]);
  });
});
