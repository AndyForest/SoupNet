import { describe, it, expect } from "vitest";
import { draftStatusLabel } from "./draft-status-label";

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

  it("DT-VER-01: verified with a reaction", () => {
    const l = draftStatusLabel({ draftState: "verified", draftResolvedAt: "2026-09-27T10:00:00Z", draftResolvedByKeyId: null })!;
    expect(l.text).toContain("Verified draft");
    expect(l.text).toContain("by you");
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
