import { describe, it, expect } from "vitest";
import { parseDraftFlag, draftDepositNotice, draftLabel, validateVerificationEvidence, onBehalfRefusal, onlySubjectReviewsReason } from "./drafts";

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

// ── Slice 4: drafts on behalf of another person ─────────────────────────────

describe("on-behalf labels (S4-L1, S4-Z3)", () => {
  const PAT = "pat@example.test";
  const DANA = "dana@example.test";

  it("names the depositor to the subject and the subject to the depositor, inside the label", () => {
    expect(draftLabel("unverified", { draftDepositedBy: DANA })).toContain(`unverified draft, deposited by ${DANA}:`);
    expect(draftLabel("unverified", { draftAbout: PAT })).toContain(`unverified draft about ${PAT}:`);
    expect(draftLabel("rejected", { draftAbout: PAT })).toBe(`[rejected draft about ${PAT}: the person said this is wrong]`);
    expect(draftLabel("not_chosen", { draftDepositedBy: DANA })).toBe(`[draft not chosen, deposited by ${DANA}]`);
  });

  it("a self draft's label and a published row are unchanged byte for byte", () => {
    for (const s of ["unverified", "rejected", "not_chosen"]) {
      expect(draftLabel(s, { draftDepositedBy: null, draftAbout: null })).toBe(draftLabel(s));
    }
    expect(draftLabel(null, { draftDepositedBy: DANA })).toBe("");
    expect(draftLabel("verified", { draftAbout: PAT })).toBe("");
  });

  it("adds at most the other party's email plus 20 bytes, with or without ratings", () => {
    for (const s of ["unverified", "rejected", "not_chosen"]) {
      for (const ratings of [{}, { impact: "high", uncertainty: "low" }]) {
        const self = Buffer.byteLength(draftLabel(s, ratings));
        expect(Buffer.byteLength(draftLabel(s, { ...ratings, draftDepositedBy: DANA })) - self).toBeLessThanOrEqual(DANA.length + 20);
        expect(Buffer.byteLength(draftLabel(s, { ...ratings, draftAbout: PAT })) - self).toBeLessThanOrEqual(PAT.length + 20);
      }
    }
  });
});

describe("on-behalf deposit notices (S4-L3, S4-L4, S4-Z4)", () => {
  const PAT = "pat@example.test";
  const URL = "http://localhost:5273/app/drafts?ids=0f4b7a8e-2d1c-4e5f-9a0b-1c2d3e4f5a6b";

  it("a new on-behalf draft says why it is a draft, who can see it, who confirms it, and the link to hand them", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, queueUrl: URL, onBehalfOf: PAT })!;
    expect(n).toContain(`draft about ${PAT}`);
    expect(n).toContain("on their behalf");
    expect(n).toContain("only they can confirm or reject it");
    expect(n).toContain(URL);
    expect(n).not.toContain("verify_draft");
    expect(n).not.toContain("overridden");
  });

  it("says when the draft flag was overridden", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, queueUrl: URL, onBehalfOf: PAT, draftFlagOverridden: true })!;
    expect(n).toContain("your draft flag was overridden");
  });

  it("is at most 60 characters longer than today's new-draft notice plus the subject's email", () => {
    const today = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, queueUrl: URL })!;
    for (const draftFlagOverridden of [false, true]) {
      const n = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, queueUrl: URL, onBehalfOf: PAT, draftFlagOverridden })!;
      expect(n.length).toBeLessThanOrEqual(today.length + 60 + PAT.length);
    }
  });

  it("an identical repeat is worded for the subject, and never offers verification to the depositor", () => {
    const still = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: true, queueUrl: URL, onBehalfOf: PAT })!;
    expect(still).toContain(`still a draft`);
    expect(still).toContain(`draft about ${PAT}`);
    expect(still).toContain(URL);
    expect(still).not.toContain("verify_draft");
    const rejected = draftDepositNotice({ storedState: "rejected", requestedDraft: true, existing: true, onBehalfOf: PAT })!;
    expect(rejected).toContain(`draft about ${PAT} that has since been rejected`);
    expect(rejected).toContain("nothing new was stored");
  });

  it("the naming refusal is one answer that names the way forward and echoes no email", () => {
    const r = onBehalfRefusal("team-notes");
    expect(r).toContain("nothing was stored");
    expect(r).toContain("check without on_behalf_of");
    expect(r).not.toMatch(/@/);
  });

  it("the depositor's refusal names who reviews it and the link to hand them", () => {
    expect(onlySubjectReviewsReason(PAT, URL)).toBe(`Only ${PAT} can review this draft: it is about them. Hand them their review link: ${URL}`);
    expect(onlySubjectReviewsReason(null)).toContain("the person it is about");
  });
});
