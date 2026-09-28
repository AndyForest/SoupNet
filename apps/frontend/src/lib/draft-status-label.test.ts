import { describe, it, expect } from "vitest";
import { draftStatusLabel, draftPartyLine, deleteDraftAccessibleName, showsKeyBadge } from "./draft-status-label";

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
    expect(rejected.title).toContain("pat@test.local marked this draft wrong");
    expect(rejected.title).not.toContain("You marked");
    const notChosen = draftStatusLabel({ draftState: "not_chosen", draftAbout: "pat@test.local" })!;
    expect(notChosen.title).toContain("pat@test.local");
    // The subject's own view is unchanged.
    expect(draftStatusLabel({ draftState: "rejected" })!.title).toContain("You marked this draft wrong");
  });
});
