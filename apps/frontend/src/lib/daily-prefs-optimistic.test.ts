import { describe, it, expect } from "vitest";
import { applyDailyPrefs, dailyPrefsRollback } from "./daily-prefs-optimistic";

// The include-in-reads/writes checkboxes on the Recipe Books page flip the
// moment they are clicked (optimistic), and flip back if the save fails.
// These helpers compute the cached recipe-book list before and after.

const books = [
  { id: "a", name: "Personal", daily_read: true, daily_write: true },
  { id: "b", name: "Team", daily_read: false, daily_write: false },
];

describe("applyDailyPrefs", () => {
  it("sets only the fields in the patch, on only the named book", () => {
    const next = applyDailyPrefs(books, "b", { dailyRead: true });
    expect(next).toEqual([
      { id: "a", name: "Personal", daily_read: true, daily_write: true },
      { id: "b", name: "Team", daily_read: true, daily_write: false },
    ]);
  });

  it("maps dailyWrite to daily_write", () => {
    const next = applyDailyPrefs(books, "a", { dailyWrite: false });
    expect(next?.[0]).toEqual({ id: "a", name: "Personal", daily_read: true, daily_write: false });
  });

  it("does not mutate the cached list", () => {
    applyDailyPrefs(books, "b", { dailyRead: true });
    expect(books[1]?.daily_read).toBe(false);
  });

  it("leaves an empty cache empty", () => {
    expect(applyDailyPrefs(undefined, "b", { dailyRead: true })).toBeUndefined();
  });
});

describe("dailyPrefsRollback", () => {
  it("restores the values the patch replaced", () => {
    expect(dailyPrefsRollback(books, "b", { dailyRead: true })).toEqual({ dailyRead: false });
    expect(dailyPrefsRollback(books, "a", { dailyWrite: false, dailyRead: false })).toEqual({
      dailyRead: true,
      dailyWrite: true,
    });
  });

  it("round-trips: applying the rollback after the patch gives back the original list", () => {
    const patch = { dailyWrite: true };
    const rollback = dailyPrefsRollback(books, "b", patch);
    const after = applyDailyPrefs(applyDailyPrefs(books, "b", patch), "b", rollback);
    expect(after).toEqual(books);
  });

  it("returns an empty rollback when the book is not cached", () => {
    expect(dailyPrefsRollback(books, "missing", { dailyRead: true })).toEqual({});
    expect(dailyPrefsRollback(undefined, "b", { dailyRead: true })).toEqual({});
  });
});
