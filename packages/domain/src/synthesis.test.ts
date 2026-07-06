import { describe, it, expect } from "vitest";
import { buildSynthesisPrompt, stubSynthesis, SYNTHESIS_WORD_LIMIT } from "./synthesis";
import type { SynthesisInput } from "./synthesis";

const ID_OLD = "11111111-1111-1111-1111-111111111111";
const ID_MID = "22222222-2222-2222-2222-222222222222";
const ID_NEW = "33333333-3333-3333-3333-333333333333";

function baseInput(): SynthesisInput {
  return {
    checkedRecipe: "As a developer working on an API, I chose Hono so that edge deployment stays possible.",
    results: [
      { id: ID_OLD, recipe: "As a developer, I preferred REST so that clients stay simple.", judgmentDate: "2026-01-05", evidence: ["We standardized on REST."] },
      { id: ID_NEW, recipe: "As a developer, I now prefer tRPC so that types flow end to end.", judgmentDate: "2026-06-20", evidence: ["Switched to tRPC last sprint."] },
      { id: ID_MID, recipe: "As a developer, I chose GraphQL for the mobile app.", judgmentDate: "2026-03-11" },
    ],
    relatedEvidence: [{ recipeId: ID_MID, content: "The mobile team wanted a single round trip." }],
  };
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).length;
}

describe("buildSynthesisPrompt", () => {
  it("is deterministic — same input yields the same prompt", () => {
    expect(buildSynthesisPrompt(baseInput())).toBe(buildSynthesisPrompt(baseInput()));
  });

  it("pins the truthfulness guardrails and the word limit into the prompt", () => {
    const p = buildSynthesisPrompt(baseInput());
    expect(p).toContain(`at most ${SYNTHESIS_WORD_LIMIT} words`);
    expect(p).toContain("Cite recipe ids inline");
    expect(p).toContain("Quote only text that appears verbatim");
    expect(p).toContain("never invent");
    expect(p).toContain("the older as superseded"); // newest-wins conflict rule
  });

  it("orders recorded recipes newest judgment first, regardless of input order", () => {
    const p = buildSynthesisPrompt(baseInput());
    const posNew = p.indexOf(ID_NEW);
    const posMid = p.indexOf(ID_MID);
    const posOld = p.indexOf(ID_OLD);
    expect(posNew).toBeGreaterThanOrEqual(0);
    expect(posNew).toBeLessThan(posMid);
    expect(posMid).toBeLessThan(posOld);
  });

  it("includes the checked recipe and every result id", () => {
    const p = buildSynthesisPrompt(baseInput());
    expect(p).toContain("I chose Hono");
    for (const id of [ID_OLD, ID_MID, ID_NEW]) expect(p).toContain(id);
  });

  it("renders an evidence line only for results that carry evidence", () => {
    const p = buildSynthesisPrompt(baseInput());
    expect(p).toContain("evidence: We standardized on REST.");
    // ID_MID has no evidence — no evidence line follows its recipe.
    const midLine = p.split("\n").find((l) => l.includes(ID_MID) && l.startsWith("- ["));
    expect(midLine).toBeDefined();
    expect(p).not.toContain("evidence: The mobile team"); // related-evidence content is not a recipe evidence line
  });

  it("drops blank evidence entries rather than emitting an empty evidence line", () => {
    const input = baseInput();
    input.results[0]!.evidence = ["", "   "];
    const p = buildSynthesisPrompt(input);
    expect(p).not.toContain("evidence:  |");
    expect(p).not.toMatch(/evidence: \s*$/m);
  });

  it("renders a related-evidence section when present, skipping blank content", () => {
    const input = baseInput();
    input.relatedEvidence = [
      { recipeId: ID_OLD, content: "Kept the REST gateway for legacy clients." },
      { recipeId: ID_NEW, content: "   " },
    ];
    const p = buildSynthesisPrompt(input);
    expect(p).toContain("Related evidence from other recipes:");
    expect(p).toContain(`(recipe ${ID_OLD}) Kept the REST gateway`);
    expect(p).not.toContain(`(recipe ${ID_NEW})`); // blank content skipped
  });

  it("omits the related-evidence section entirely when none is provided", () => {
    const input = baseInput();
    delete input.relatedEvidence;
    const p = buildSynthesisPrompt(input);
    expect(p).not.toContain("Related evidence from other recipes:");
  });

  it("handles empty results with an explicit 'none returned' line", () => {
    const p = buildSynthesisPrompt({ checkedRecipe: "As a dev, I chose X.", results: [] });
    expect(p).toContain("Recorded recipes (newest judgment first): none returned.");
    expect(p).toContain("Write the preference profile now.");
  });
});

describe("stubSynthesis", () => {
  it("is deterministic — same input yields the same output", () => {
    expect(stubSynthesis(baseInput())).toBe(stubSynthesis(baseInput()));
  });

  it("cites every result id verbatim", () => {
    const out = stubSynthesis(baseInput());
    for (const id of [ID_OLD, ID_MID, ID_NEW]) expect(out).toContain(id);
  });

  it("orders exemplars newest judgment first", () => {
    const out = stubSynthesis(baseInput());
    expect(out.indexOf(ID_NEW)).toBeLessThan(out.indexOf(ID_MID));
    expect(out.indexOf(ID_MID)).toBeLessThan(out.indexOf(ID_OLD));
  });

  it("stays within the word limit", () => {
    expect(wordCount(stubSynthesis(baseInput()))).toBeLessThanOrEqual(SYNTHESIS_WORD_LIMIT);
  });

  it("handles empty results without inventing content", () => {
    const out = stubSynthesis({ checkedRecipe: "As a dev, I chose X.", results: [] });
    expect(out).toBe("Current preference profile (stub synthesis): no recorded recipes to synthesize.");
  });
});
