import { describe, it, expect } from "vitest";
import { parseDraftFlag, draftDepositNotice, draftLabel, validateVerificationEvidence, onBehalfRefusal, onlySubjectReviewsReason, headlessVerifyRefusal, parseDraftOutcome, DRAFT_OUTCOMES, describeResolution, openQuestionLine, OPEN_QUESTION_STORY_MAX } from "./drafts";

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

// ── Slice 6c: agent-side resolution ─────────────────────────────────────────

describe("parseDraftOutcome (S6c-M2, S6c-B6)", () => {
  it("defaults to verified when absent, null, or empty", () => {
    for (const raw of [undefined, null, ""]) expect(parseDraftOutcome(raw)).toEqual({ ok: true, outcome: "verified" });
  });

  it("accepts each of the three outcomes, trimmed", () => {
    for (const o of DRAFT_OUTCOMES) expect(parseDraftOutcome(o)).toEqual({ ok: true, outcome: o });
    expect(parseDraftOutcome(" rejected ")).toEqual({ ok: true, outcome: "rejected" });
    expect(DRAFT_OUTCOMES).toEqual(["verified", "rejected", "not_chosen"]);
  });

  it("fails closed on anything else, naming the three values, so a typo never publishes", () => {
    for (const raw of ["reject", "REJECTED", "not chosen", true, 1, {}, ["rejected"]]) {
      const r = parseDraftOutcome(raw);
      expect(r.ok, String(raw)).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain("verified | rejected | not_chosen");
        expect(r.error).toContain("nothing was stored");
      }
    }
  });

  it("echoes a long unknown value truncated", () => {
    const r = parseDraftOutcome("x".repeat(200));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeLessThan(260);
  });
});

describe("validateVerificationEvidence per outcome (S6c-E1, S6c-E3)", () => {
  const existing = ["the person said yes to option A"];

  it("keeps one structural rule for every outcome: a new quote with a citation passes", () => {
    for (const o of DRAFT_OUTCOMES) {
      expect(validateVerificationEvidence([{ interpretation: "Settled.", quote: "No, not A", source: "chat" }], existing, o)).toEqual({ ok: true });
    }
  });

  it("S6c-E2: a rejection citing a covering recipe by id passes; the id is not looked up", () => {
    const r = validateVerificationEvidence(
      [{ interpretation: "A later verified recipe covers the same call the other way.", quote: "I chose default deny", source: "recipe 1a2b3c4d" }],
      existing,
      "rejected",
    );
    expect(r).toEqual({ ok: true });
  });

  it("refuses a rejection that only re-quotes the draft's own evidence", () => {
    const r = validateVerificationEvidence([{ interpretation: "x", quote: "the person said yes to option A", source: "chat" }], existing, "rejected");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("already");
  });

  it("words the refusal for the outcome: a rejection may quote the covering recipe, cited by id", () => {
    const rej = validateVerificationEvidence([], existing, "rejected");
    const nc = validateVerificationEvidence([], existing, "not_chosen");
    const ver = validateVerificationEvidence([], existing);
    expect(!rej.ok && rej.error).toMatch(/^Rejecting a draft needs new evidence/);
    expect(!rej.ok && rej.error).toContain("-- recipe <id>");
    expect(!nc.ok && nc.error).toMatch(/^Marking a draft not chosen needs new evidence/);
    expect(!ver.ok && ver.error).toMatch(/^Verifying a draft needs new evidence/);
  });

  it("says how many entries the text was read as and what each lacked", () => {
    const r = validateVerificationEvidence(
      [
        { interpretation: "Interpretation.", quote: "the answer", source: "" },
        { interpretation: "", quote: "", source: "chat, 2026-10-24" },
      ],
      existing,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("read as 2 entries");
      expect(r.error).toContain("entry 1 has a quote but no citation");
      expect(r.error).toContain("entry 2 has a citation but no quote");
    }
    const none = validateVerificationEvidence([], existing);
    expect(!none.ok && none.error).toContain("No evidence was sent");
    const one = validateVerificationEvidence([{ interpretation: "Only words.", quote: "", source: "" }], existing);
    expect(!one.ok && one.error).toContain("read as 1 entry: entry 1 has no quote and no citation");
  });
});

describe("describeResolution (S6c-B4)", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  it("says what each outcome did, with the evidence count", () => {
    expect(describeResolution(ID, "verified", 1)).toBe(
      `Draft ${ID} is verified: it is now an ordinary recipe that collaborators can find, with your new evidence attached (1 entry).`,
    );
    const rej = describeResolution(ID, "rejected", 2);
    expect(rej).toMatch(new RegExp(`^Draft ${ID} is rejected:`));
    expect(rej).toContain("leaves the review queue");
    expect(rej).not.toContain("the person");
    expect(rej).toContain("(2 entries)");
    const nc = describeResolution(ID, "not_chosen", 1);
    expect(nc).toMatch(new RegExp(`^Draft ${ID} is marked not chosen:`));
    expect(nc).toContain("private");
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
    expect(draftLabel("rejected", { draftAbout: PAT })).toBe(`[rejected draft about ${PAT}: its evidence says why]`);
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

describe("headless deposit notices (slice 5, S5-W2, S5-W4, S5-Z4)", () => {
  const ID = "0f4b7a8e-2d1c-4e5f-9a0b-1c2d3e4f5a6b";
  const URL = `http://localhost:5273/app/drafts?ids=${ID}`;
  const base = { storedState: "unverified", requestedDraft: true, queueUrl: URL, headless: true } as const;

  it("a new draft says it is a draft because the key is headless, a setting chosen at mint, with the queue link and no verify_draft", () => {
    const n = draftDepositNotice({ ...base, existing: false })!;
    expect(n).toContain("because this API key is headless, a setting chosen when the key was made");
    expect(n).toContain(URL);
    expect(n).not.toContain("verify_draft");
    expect(n).not.toContain("overridden");
  });

  it("says the draft flag was overridden only when told to", () => {
    expect(draftDepositNotice({ ...base, existing: false, draftFlagOverridden: true })).toContain("(your draft flag was overridden)");
  });

  it("S5-Z4: is at most 80 characters longer than a self draft's new-draft notice with the same URL", () => {
    const self = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, queueUrl: URL })!;
    for (const draftFlagOverridden of [false, true]) {
      const n = draftDepositNotice({ ...base, existing: false, draftFlagOverridden })!;
      expect(n.length, n).toBeLessThanOrEqual(self.length + 80);
    }
  });

  it("S5-W4: an identical repeat is still a draft, never offers verify_draft, and hands over the link", () => {
    const still = draftDepositNotice({ ...base, existing: true })!;
    expect(still).toContain("still a draft");
    expect(still).toContain(URL);
    expect(still).not.toContain("verify_draft");
    const rejected = draftDepositNotice({ ...base, storedState: "rejected", existing: true })!;
    expect(rejected).toContain("has since been rejected");
    expect(rejected).not.toContain("verify_draft");
  });

  it("without a queue URL it points to the recipe's page, still without verify_draft", () => {
    const n = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing: false, headless: true })!;
    expect(n).toContain("recipe's page");
    expect(n).not.toContain("verify_draft");
  });

  it("the on-behalf reason wins over the headless one, since it names who can review the draft (S5-W3)", () => {
    const n = draftDepositNotice({ ...base, existing: false, onBehalfOf: "pat@example.test" })!;
    expect(n).toContain("on their behalf");
    expect(n).not.toContain("headless");
  });

  it("an ordinary key's notice is unchanged when headless is false or absent", () => {
    for (const existing of [false, true]) {
      const plain = draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing, queueUrl: URL });
      expect(draftDepositNotice({ storedState: "unverified", requestedDraft: true, existing, queueUrl: URL, headless: false })).toBe(plain);
    }
  });
});

describe("the headless verify refusal (slice 5, S5-R1, S5-Z4)", () => {
  const URL = "http://localhost:5273/app/drafts?ids=abc12345";

  it("names the setting, says nothing was stored, and gives both ways forward", () => {
    const r = headlessVerifyRefusal("abc12345", URL);
    expect(r).toContain("headless");
    expect(r).toContain("nothing was stored");
    expect(r).toContain(URL);
    expect(r).toContain("ordinary");
    expect(r).toContain("quoted");
  });

  it("is at most 320 characters plus the link", () => {
    const r = headlessVerifyRefusal("abc12345", URL);
    expect(r.length - URL.length, r).toBeLessThanOrEqual(320);
  });

  it("differs between ids only by the echoed id", () => {
    const a = headlessVerifyRefusal("abc12345", "U/abc12345");
    const b = headlessVerifyRefusal("ffffffff-0000-4000-8000-000000000000", "U/ffffffff-0000-4000-8000-000000000000");
    expect(a.split("abc12345").join("<ID>")).toBe(b.split("ffffffff-0000-4000-8000-000000000000").join("<ID>"));
  });
});

// Slice 10: drafts as a bus.
describe("draftLabel: expiry and resolution (S10-R1, S10-R3)", () => {
  const at = "2026-10-25T09:30:00Z";

  it("an expired draft says it expired, why, and that it can still be resolved by id", () => {
    const idle = draftLabel("unverified", { expired: "intent_idle" });
    expect(idle).toBe("[expired draft: its task has been quiet for over 24 hours, so it has left the review queue and results; it can still be verified or rejected by id]");
    expect(draftLabel("unverified", { expired: "age" })).toContain("deposited with no intent over 7 days ago");
    expect(draftLabel("unverified", { expired: "age", draftAbout: "pat@test.local" })).toMatch(/^\[expired draft about pat@test\.local: /);
    expect(draftLabel("unverified", { expired: null })).toMatch(/^\[unverified draft: /);
  });

  it("names how and when for each resolved state, verified included", () => {
    expect(draftLabel("rejected", { resolution: { by: "agent", keyLabel: "K2", at } }))
      .toBe('[rejected draft: rejected by their agent "K2" on 2026-10-25; its evidence says why]');
    expect(draftLabel("not_chosen", { resolution: { by: "depositing_agent", at } }))
      .toBe("[draft not chosen: marked not chosen by the agent that deposited it on 2026-10-25]");
    expect(draftLabel("verified", { resolution: { by: "person", at: new Date(at) } }))
      .toBe("[verified draft: verified by your user on 2026-10-25]");
    expect(draftLabel("verified", { resolution: { by: "agent", keyLabel: null, at } })).toContain("by one of their agents");
  });

  it("without a resolution note, the labels are as before, and a verified draft has none", () => {
    expect(draftLabel("verified")).toBe("");
    expect(draftLabel("rejected")).toBe("[rejected draft: its evidence says why]");
    expect(draftLabel("not_chosen")).toBe("[draft not chosen]");
  });

  it("ratings still close the label", () => {
    expect(draftLabel("rejected", { impact: "high", resolution: { by: "person", at } }))
      .toBe("[rejected draft: rejected by your user on 2026-10-25; its evidence says why; impact high, uncertainty not rated]");
  });
});

describe("openQuestionLine (S10-D1, S10-D3)", () => {
  const id = "0b9c2a1e-1111-4222-8333-444455556666";

  it("names the draft, the story's first line, and when it was asked, in the ruling's words", () => {
    expect(openQuestionLine({ recipeId: id, story: "As a backend maintainer working on X, I want Y\nmore", askedAt: "2026-10-24T22:00:00Z" }))
      .toBe(`Open question near this call: ${id} (As a backend maintainer working on X, I want Y, asked 2026-10-24). If your context settles it, resolve it; otherwise leave it.`);
  });

  it("without a story (another person's intent, or none) the parenthesis carries only the date", () => {
    expect(openQuestionLine({ recipeId: id, askedAt: "2026-10-24T22:00:00Z" }))
      .toBe(`Open question near this call: ${id} (asked 2026-10-24). If your context settles it, resolve it; otherwise leave it.`);
    expect(openQuestionLine({ recipeId: id, story: "   ", askedAt: "2026-10-24T22:00:00Z" })).toContain("(asked 2026-10-24)");
  });

  it("cuts a long story to the excerpt limit", () => {
    const line = openQuestionLine({ recipeId: id, story: "x".repeat(300), askedAt: "2026-10-24T22:00:00Z" });
    const story = line.split("(")[1]!.split(", asked")[0]!;
    expect(story.length).toBe(OPEN_QUESTION_STORY_MAX);
    expect(story.endsWith("…")).toBe(true);
  });
});
