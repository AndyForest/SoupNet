import { describe, it, expect } from "vitest";
import { memberRemovalPrompt } from "./member-removal";

// Removing a member from a recipe book asks first, naming the person and the
// book, so a mis-click on the wrong row is caught before it takes effect.

describe("memberRemovalPrompt", () => {
  it("names the person and the recipe book", () => {
    const prompt = memberRemovalPrompt("sam@example.com", "Team Recipes");
    expect(prompt.question).toBe("Remove sam@example.com from Team Recipes?");
  });

  it("says what removal does and that it can be undone by inviting again", () => {
    const prompt = memberRemovalPrompt("sam@example.com", "Team Recipes");
    expect(prompt.detail).toContain("lose access to this recipe book");
    expect(prompt.detail).toContain("invite them again");
  });
});
