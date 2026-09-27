import { describe, it, expect } from "vitest";
import { memberRemovalPrompt } from "./member-removal";

// Removing a member from a recipe book asks first, naming the person and the
// book, so a mis-click on the wrong row is caught before it takes effect.

describe("memberRemovalPrompt", () => {
  it("names the person and the recipe book", () => {
    const prompt = memberRemovalPrompt("sam@example.com", "Team Recipes");
    expect(prompt.question).toBe("Remove sam@example.com from Team Recipes?");
  });

  it("gives the confirm button a label distinct from the row's Remove button", () => {
    // Account deletion's confirm step uses a different phrase from its
    // trigger ("Delete my account…" then "Permanently delete"); the removal
    // confirm does the same. The accessible name starts with the visible
    // text (WCAG 2.5.3) and names the person, so a screen-reader user hears
    // who is being removed.
    const prompt = memberRemovalPrompt("sam@example.com", "Team Recipes");
    expect(prompt.confirmLabel).toBe("Yes, remove");
    expect(prompt.confirmAccessibleName).toBe("Yes, remove sam@example.com");
    expect(prompt.confirmAccessibleName.startsWith(prompt.confirmLabel)).toBe(true);
    expect(prompt.confirmLabel).not.toBe("Remove");
  });

  it("says what removal does and that it can be undone by inviting again", () => {
    const prompt = memberRemovalPrompt("sam@example.com", "Team Recipes");
    expect(prompt.detail).toContain("lose access to this recipe book");
    expect(prompt.detail).toContain("invite them again");
  });
});
