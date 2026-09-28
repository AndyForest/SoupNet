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

// ── Slice 3 ──────────────────────────────────────────────────────────────────

describe("draftDepositNotice with the queue link (S3-L6, S3-Z3)", () => {
  const url = "https://soup.net/app/drafts?ids=11111111-1111-4111-8111-111111111111";

  it("a new draft's notice hands the agent the queue link in place of the recipe page", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, queueUrl: url })!;
    expect(n).toContain(`review queue: ${url}`);
    expect(n).not.toContain("recipe's page");
  });

  it("so does an identical repeat of an unresolved draft", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: false, existing: true, queueUrl: url })!;
    expect(n).toContain(url);
    expect(n).toContain("still a draft");
  });

  it("a resolved repeat and a published repeat carry no link (nothing to review)", () => {
    expect(draftDepositNotice({ storedState: "rejected", requestedDraft: false, existing: true, queueUrl: url })).not.toContain(url);
    expect(draftDepositNotice({ storedState: null, requestedDraft: true, existing: true, queueUrl: url })).not.toContain(url);
  });

  it("grows by at most the queue URL plus 20 characters", () => {
    for (const existing of [false, true]) {
      const before = draftDepositNotice({ storedState: "unverified", requestedDraft: !existing, existing })!;
      const after = draftDepositNotice({ storedState: "unverified", requestedDraft: !existing, existing, queueUrl: url })!;
      expect(after.length - before.length).toBeLessThanOrEqual(url.length + 20);
    }
  });
});

describe("draftLabel with the agent's ratings (S3-AG2, S3-Z4)", () => {
  const values = [null, "low", "medium", "high"] as const;

  it("an unrated draft's label is unchanged, and a published row has no label at all", () => {
    for (const state of ["unverified", "rejected", "not_chosen"] as const) {
      expect(draftLabel(state, { impact: null, uncertainty: null })).toBe(draftLabel(state));
      expect(draftLabel(state, {})).toBe(draftLabel(state));
    }
    for (const state of [null, undefined, "verified"]) {
      expect(draftLabel(state, { impact: "high", uncertainty: "high" })).toBe("");
    }
  });

  it("adds at most 40 bytes for every rated combination", () => {
    for (const state of ["unverified", "rejected", "not_chosen"] as const) {
      const base = Buffer.byteLength(draftLabel(state), "utf8");
      for (const impact of values) {
        for (const uncertainty of values) {
          const label = draftLabel(state, { impact, uncertainty });
          const added = Buffer.byteLength(label, "utf8") - base;
          if (impact === null && uncertainty === null) expect(added).toBe(0);
          else expect(added, `${state} ${impact}/${uncertainty}: ${label}`).toBeLessThanOrEqual(40);
        }
      }
    }
  });

  it("names both ratings, 'not rated' for a missing one, inside the label", () => {
    expect(draftLabel("unverified", { impact: "high", uncertainty: null })).toMatch(/; impact high, uncertainty not rated\]$/);
    expect(draftLabel("unverified", { impact: "low", uncertainty: "medium" })).toMatch(/; impact low, uncertainty medium\]$/);
  });
});
