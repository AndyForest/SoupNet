import { describe, it, expect } from "vitest";
import { parseDraftFlag, draftDepositNotice, draftLabel, validateVerificationEvidence } from "./drafts";

describe("parseDraftFlag", () => {
  it("DT-VIS-01: true and its usual wire spellings mean draft", () => {
    for (const v of [true, "true", "TRUE", " 1 ", "on", "yes"]) {
      expect(parseDraftFlag(v)).toEqual({ draft: true });
    }
  });

  it("omitted, false, and its wire spellings mean an ordinary check (the default)", () => {
    for (const v of [undefined, null, false, "false", "0", "off", "no", ""]) {
      expect(parseDraftFlag(v)).toEqual({ draft: false });
    }
  });

  it("an unrecognized value is taken as draft, the private side, with a notice (never a failed check)", () => {
    const r = parseDraftFlag("maybe");
    expect(r.draft).toBe(true);
    expect(r.notice).toContain('"maybe"');
    expect(r.notice).toContain("true | false");
    expect(parseDraftFlag(7).draft).toBe(true);
  });
});

describe("draftDepositNotice", () => {
  it("DT-VIS-01: a new draft says who can see it until it is verified, and how it gets verified", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false })!;
    expect(n).toContain("only you and your own agents");
    expect(n).toContain("verify_draft");
  });

  it("an ordinary check has no notice", () => {
    expect(draftDepositNotice({ storedState: null, requestedDraft: false, existing: false })).toBeUndefined();
  });

  it("DT-VIS-12: a non-draft repeat of a draft's text reports it is still a draft and how to verify it", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: false, existing: true })!;
    expect(n).toContain("still a draft");
    expect(n).toContain("verify_draft");
  });

  it("a draft repeat of a published recipe says it stays published", () => {
    const n = draftDepositNotice({ storedState: null, requestedDraft: true, existing: true })!;
    expect(n).toContain("stays published");
  });

  it("open question 5: a repeat of a rejected draft reports the state, and nothing new is stored", () => {
    const n = draftDepositNotice({ storedState: "rejected", requestedDraft: false, existing: true })!;
    expect(n).toContain("rejected");
    expect(n).toContain("nothing new was stored");
  });

  it("a repeat of a verified draft is an ordinary existing recipe", () => {
    expect(draftDepositNotice({ storedState: "verified", requestedDraft: false, existing: true })).toBeUndefined();
  });
});

describe("draftLabel", () => {
  it("DT-VIS-06: labels each unpublished state, and nothing for a published recipe", () => {
    expect(draftLabel("unverified")).toContain("unverified draft");
    expect(draftLabel("rejected")).toContain("rejected");
    expect(draftLabel("not_chosen")).toContain("not chosen");
    expect(draftLabel(undefined)).toBe("");
    expect(draftLabel(null)).toBe("");
    expect(draftLabel("verified")).toBe("");
  });
});

describe("validateVerificationEvidence (DT-VER-05, DT-VER-06)", () => {
  const existing = ["the person said yes to option A"];

  it("accepts a new entry with an interpretation, a quote, and a citation", () => {
    const r = validateVerificationEvidence(
      [{ interpretation: "The person confirmed it when asked.", quote: "Yes, go with A", source: "User conversation, 2026-09-27" }],
      existing,
    );
    expect(r).toEqual({ ok: true });
  });

  it("refuses no evidence, and says what is needed", () => {
    const r = validateVerificationEvidence([], existing);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("quote");
      expect(r.error).toContain("citation");
    }
  });

  it("refuses an entry without a quote, or without a citation", () => {
    expect(validateVerificationEvidence([{ interpretation: "x", quote: "", source: "s" }], existing).ok).toBe(false);
    expect(validateVerificationEvidence([{ interpretation: "x", quote: "q", source: "" }], existing).ok).toBe(false);
    expect(validateVerificationEvidence([{ interpretation: "x", quote: null, source: null }], existing).ok).toBe(false);
  });

  it("refuses a quote the draft already carries (nothing new), however it is spaced or cased", () => {
    const r = validateVerificationEvidence(
      [{ interpretation: "Same as before.", quote: "  The person said YES to option A ", source: "chat" }],
      existing,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("already");
  });

  it("accepts when at least one entry carries a new quote with a citation", () => {
    const r = validateVerificationEvidence(
      [
        { interpretation: "Old.", quote: "the person said yes to option A", source: "chat" },
        { interpretation: "New.", quote: "Confirmed: A it is", source: "chat, 2026-09-27" },
      ],
      existing,
    );
    expect(r.ok).toBe(true);
  });
});
