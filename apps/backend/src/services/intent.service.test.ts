import { describe, it, expect } from "vitest";
import {
  INTENT_ID_RE,
  INTENT_STORY_MAX_CHARS,
  mintIntentId,
  intentEchoLine,
} from "./intent.service";

// Layer 1 — pure parts of the declared-intent mechanism (cold-start v2
// Phase C). resolveIntent / ledger functions are DB-bound; covered by the
// Layer 3 suite (routes/intents.test.ts).

describe("mintIntentId", () => {
  it("mints int_-prefixed 24-char base62 ids matching INTENT_ID_RE", () => {
    for (let i = 0; i < 50; i++) {
      const id = mintIntentId();
      expect(id).toMatch(INTENT_ID_RE);
      expect(id.length).toBe(28);
    }
  });

  it("does not collide across a small sample", () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintIntentId()));
    expect(ids.size).toBe(200);
  });
});

describe("INTENT_ID_RE", () => {
  it("accepts exactly the minted shape", () => {
    expect(INTENT_ID_RE.test("int_" + "a".repeat(24))).toBe(true);
    expect(INTENT_ID_RE.test("int_" + "A9".repeat(12))).toBe(true);
  });

  it("rejects story text, session-token shapes, and near-misses", () => {
    expect(INTENT_ID_RE.test("As a developer working on X, I want ...")).toBe(false);
    expect(INTENT_ID_RE.test("int_" + "a".repeat(23))).toBe(false); // too short
    expect(INTENT_ID_RE.test("int_" + "a".repeat(25))).toBe(false); // too long
    expect(INTENT_ID_RE.test("int_" + "a".repeat(23) + "-")).toBe(false); // non-base62
    expect(INTENT_ID_RE.test("Int_" + "a".repeat(24))).toBe(false); // case-sensitive prefix
    expect(INTENT_ID_RE.test("a".repeat(28))).toBe(false); // no prefix
  });
});

describe("intentEchoLine", () => {
  const id = "int_" + "b".repeat(24);

  it("acks a registration with the carry-the-id protocol and sub-agent guidance", () => {
    const line = intentEchoLine({ intentId: id, registered: true });
    expect(line).toContain("Intent registered");
    expect(line).toContain(id);
    expect(line).toContain("id-stubs");
    expect(line).toContain("Sub-agents");
  });

  it("echoes a joined intent without the registered verb", () => {
    const line = intentEchoLine({ intentId: id, registered: false });
    expect(line).toContain(`Intent: ${id}`);
    expect(line).not.toContain("Intent registered");
  });

  it("explains untracked states without an existence oracle", () => {
    const notFound = intentEchoLine({ intentId: null, registered: false, notFound: true });
    expect(notFound).toContain("unknown or not yours");
    expect(notFound).toContain("deliberately indistinguishable");
    const budget = intentEchoLine({ intentId: null, registered: false, budgetExceeded: true });
    expect(budget).toContain("budget");
    const tooLong = intentEchoLine({ intentId: null, registered: false, storyTooLong: true });
    expect(tooLong).toContain(`${INTENT_STORY_MAX_CHARS.toLocaleString("en-US")}`);
  });

  it("returns null for an untracked call with no flags (no intent param)", () => {
    expect(intentEchoLine({ intentId: null, registered: false })).toBeNull();
  });
});
