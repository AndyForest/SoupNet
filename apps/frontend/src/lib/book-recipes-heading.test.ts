import { describe, it, expect } from "vitest";
import { bookRecipesHeading } from "./book-recipes-heading";

// Post-merge findings (2026-09-29): a book whose recipes are all hidden from
// the viewer (a colleague's drafts, say) still carries its own name, since
// the name comes from the book, not from its first recipe.
describe("bookRecipesHeading", () => {
  const books = [{ id: "b1", name: "Platform" }, { id: "b2", name: "Design" }];

  it("names the book from the viewer's recipe books, even with no visible recipes", () => {
    expect(bookRecipesHeading("b2", books, [])).toBe("Recipes in Design");
  });

  it("prefers the book's own name over its first recipe's", () => {
    expect(bookRecipesHeading("b1", books, [{ groupName: "Stale name" }])).toBe("Recipes in Platform");
  });

  it("falls back to a recipe's book name, then to a generic heading, never saying Traces", () => {
    expect(bookRecipesHeading("zz", books, [{ groupName: "Other" }])).toBe("Recipes in Other");
    expect(bookRecipesHeading("zz", undefined, [])).toBe("Recipes in this recipe book");
    expect(bookRecipesHeading("zz", books, [])).not.toMatch(/Traces/);
  });
});
