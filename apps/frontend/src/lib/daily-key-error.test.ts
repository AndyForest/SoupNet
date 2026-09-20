import { describe, it, expect } from "vitest";
import { dailyKeyErrorCode, isDailyKeySetupError, dailyKeySetupSentence } from "./daily-key-error";

// POST /keys/daily refuses to guess a scope: with no book included in daily
// writes or daily reads it returns a coded 400 [F71]. Every button that
// mints a daily key shows the same sentence pointing at the Recipe Books
// page, instead of a bare "Failed to generate key".

describe("dailyKeyErrorCode", () => {
  it("passes the backend's error code through", () => {
    expect(dailyKeyErrorCode({ error: "no_read_recipe_books_configured" })).toBe(
      "no_read_recipe_books_configured",
    );
  });

  it("falls back to a generic message when the response carries no error", () => {
    expect(dailyKeyErrorCode({})).toBe("Failed to generate key");
    expect(dailyKeyErrorCode({}, "Failed to generate link")).toBe("Failed to generate link");
  });
});

describe("isDailyKeySetupError", () => {
  it("recognizes both scope-setup codes", () => {
    expect(isDailyKeySetupError("no_read_recipe_books_configured")).toBe(true);
    expect(isDailyKeySetupError("no_write_recipe_books_configured")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isDailyKeySetupError("Failed to generate key")).toBe(false);
    expect(isDailyKeySetupError(null)).toBe(false);
  });
});

describe("dailyKeySetupSentence", () => {
  it("splits the read sentence around the page link", () => {
    expect(dailyKeySetupSentence("no_read_recipe_books_configured")).toEqual({
      before: "No recipe book is included in daily reads yet — include at least one on the ",
      after: ", then try again.",
    });
  });

  it("splits the write sentence around the page link", () => {
    expect(dailyKeySetupSentence("no_write_recipe_books_configured")).toEqual({
      before: "No recipe book is set for daily writes yet — include one on the ",
      after: ", then try again.",
    });
  });
});
