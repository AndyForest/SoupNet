import { describe, it, expect } from "vitest";
import { scopedKeyPayload, headlessKeyLabel, HEADLESS_KEY_DESCRIPTION } from "./headless-key";

// drafts-and-triage slice 5: S5-K1, S5-K3 — the keys page's scoped-key form
// sends the ladder's wire name, and a headless key says so in text.
describe("scopedKeyPayload (S5-K1, S5-K3)", () => {
  const base = {
    readRecipeBookIds: ["r"],
    writeRecipeBookIds: ["w"],
    defaultWriteRecipeBookId: "w",
    expiresAt: "2026-10-28T00:00:00.000Z",
    label: "",
  };

  it("an unticked checkbox sends no depositLevel, so the server default (full) applies", () => {
    const p = scopedKeyPayload({ ...base, headless: false });
    expect(p).not.toHaveProperty("depositLevel");
    expect(p).toEqual({ readRecipeBookIds: ["r"], writeRecipeBookIds: ["w"], defaultWriteRecipeBookId: "w", expiresAt: base.expiresAt });
  });

  it("a ticked checkbox sends depositLevel \"drafts\"", () => {
    expect(scopedKeyPayload({ ...base, headless: true, label: "sweep" })).toEqual({
      readRecipeBookIds: ["r"], writeRecipeBookIds: ["w"], defaultWriteRecipeBookId: "w", expiresAt: base.expiresAt,
      label: "sweep", depositLevel: "drafts",
    });
  });
});

describe("headlessKeyLabel (S5-K3)", () => {
  it("is text for a headless key and nothing for an ordinary one", () => {
    expect(headlessKeyLabel("drafts")).toBe("Headless: deposits drafts only");
    expect(headlessKeyLabel("full")).toBeNull();
  });

  it("fails closed like the server: any level but full reads as headless", () => {
    expect(headlessKeyLabel("none")).toBe("Headless: deposits drafts only");
    expect(headlessKeyLabel(undefined)).toBeNull(); // a list from a server without the field
  });
});

describe("HEADLESS_KEY_DESCRIPTION (S5-K3)", () => {
  it("says what it does in one sentence: drafts for review, no verifying, for unattended agents", () => {
    expect(HEADLESS_KEY_DESCRIPTION).toContain("draft");
    expect(HEADLESS_KEY_DESCRIPTION).toContain("cannot verify");
    expect(HEADLESS_KEY_DESCRIPTION).toContain("unattended");
    expect(HEADLESS_KEY_DESCRIPTION.split(/\.\s/).length).toBe(1);
  });
});
