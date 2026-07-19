import { describe, it, expect } from "vitest";
import {
  parseRecipeIds,
  renderRecipeEntries,
  RECIPE_LOOKUP_MAX_IDS,
} from "./recipe-lookup.service";
import type { RecipeLookupEntry, RecipeLookupFound } from "./recipe-lookup.service";

// Layer 1 — pure functions of the WT-3 recipe-lookup service.

describe("parseRecipeIds", () => {
  it("splits on commas", () => {
    expect(parseRecipeIds("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("splits on whitespace and mixed separators", () => {
    expect(parseRecipeIds("a b\nc,\td")).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupes while preserving first-seen order", () => {
    expect(parseRecipeIds("b,a,b,c,a")).toEqual(["b", "a", "c"]);
  });

  it("drops empty segments", () => {
    expect(parseRecipeIds(",, a ,\n, b ,")).toEqual(["a", "b"]);
    expect(parseRecipeIds("")).toEqual([]);
    expect(parseRecipeIds("  ,  ")).toEqual([]);
  });

  it("does not validate UUID shape (malformed ids flow through to markers)", () => {
    expect(parseRecipeIds("not-a-uuid")).toEqual(["not-a-uuid"]);
  });
});

describe("renderRecipeEntries", () => {
  const found: RecipeLookupFound = {
    recipeId: "11111111-2222-3333-4444-555555555555",
    status: "ok",
    recipe: "As a tester, I prefer deterministic fixtures so that assertions are stable.",
    recipeBook: { recipeBookId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", slug: "test-book", name: "Test Book" },
    author: { email: "a@test.local", displayName: "Ada" },
    createdAt: "2026-06-15T00:00:00.000Z",
    loggedAt: "2026-07-01T12:00:00.000Z",
    evidence: [
      {
        interpretation: "The user said so directly.",
        references: [
          { quote: "stable please", source: "chat, 2026-07-01" },
        ],
      },
    ],
  };

  it("renders metadata, recipe text, and evidence for a found entry", () => {
    const out = renderRecipeEntries([found]);
    expect(out).toContain("### 11111111-2222-3333-4444-555555555555");
    expect(out).toContain("Recipe book: Test Book (test-book)");
    expect(out).toContain("Author: Ada <a@test.local>");
    expect(out).toContain("Logged: 2026-07-01");
    expect(out).toContain("Decided: 2026-06-15");
    expect(out).toContain(found.recipe);
    expect(out).toContain("The user said so directly.");
    expect(out).toContain('> "stable please"');
    expect(out).toContain("-- chat, 2026-07-01");
  });

  it("omits the Decided line when the judgment date matches the append time", () => {
    const out = renderRecipeEntries([{ ...found, createdAt: found.loggedAt }]);
    expect(out).not.toContain("Decided:");
    expect(out).toContain("Logged: 2026-07-01");
  });

  it("renders the uniform marker for unresolved entries", () => {
    const entries: RecipeLookupEntry[] = [
      { recipeId: "99999999-9999-9999-9999-999999999999", status: "not_found_or_unreadable" },
    ];
    const out = renderRecipeEntries(entries);
    expect(out).toContain("### 99999999-9999-9999-9999-999999999999");
    expect(out).toContain("not_found_or_unreadable");
    // Markers must never carry content fields.
    expect(out).not.toContain("Recipe book:");
    expect(out).not.toContain("Evidence:");
  });

  it("renders markers and found entries in input order", () => {
    const marker: RecipeLookupEntry = { recipeId: "zzz", status: "not_found_or_unreadable" };
    const out = renderRecipeEntries([marker, found]);
    expect(out.indexOf("### zzz")).toBeLessThan(out.indexOf(`### ${found.recipeId}`));
  });
});

describe("RECIPE_LOOKUP_MAX_IDS", () => {
  it("caps at 20 per the WT-3 plan", () => {
    expect(RECIPE_LOOKUP_MAX_IDS).toBe(20);
  });
});
