import { describe, it, expect } from "vitest";
import { resolveDailyReadBooks, formatBookList, describeDailyReadScope } from "./daily-scope";

// Mirrors apps/backend/src/routes/keys.ts POST /keys/daily read-scope rule:
// configured daily_read set, or fall back to all memberships when zero are
// configured. The dashboard label must render this truthfully — the old
// static "reads all recipe books" claim was the verified WT-2 scope bug.

function book(id: string, name: string, dailyRead: boolean) {
  return { id, name, daily_read: dailyRead };
}

describe("resolveDailyReadBooks", () => {
  it("returns only daily_read-flagged books when any are configured", () => {
    const books = [book("1", "A", true), book("2", "B", false), book("3", "C", true)];
    const result = resolveDailyReadBooks(books);
    expect(result.books.map((b) => b.name)).toEqual(["A", "C"]);
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to all books when zero are configured", () => {
    const books = [book("1", "A", false), book("2", "B", false)];
    const result = resolveDailyReadBooks(books);
    expect(result.books.map((b) => b.name)).toEqual(["A", "B"]);
    expect(result.usedFallback).toBe(true);
  });

  it("handles the all-flagged case without fallback", () => {
    const books = [book("1", "A", true), book("2", "B", true)];
    const result = resolveDailyReadBooks(books);
    expect(result.books).toHaveLength(2);
    expect(result.usedFallback).toBe(false);
  });

  it("returns empty with fallback for an empty membership list", () => {
    const result = resolveDailyReadBooks([]);
    expect(result.books).toEqual([]);
    expect(result.usedFallback).toBe(true);
  });
});

describe("formatBookList", () => {
  it("returns empty string for no names", () => {
    expect(formatBookList([])).toBe("");
  });

  it("renders one name bare", () => {
    expect(formatBookList(["Personal"])).toBe("Personal");
  });

  it("joins two names with 'and'", () => {
    expect(formatBookList(["Personal", "Work"])).toBe("Personal and Work");
  });

  it("uses an Oxford comma at exactly the max", () => {
    expect(formatBookList(["A", "B", "C"])).toBe("A, B, and C");
  });

  it("truncates beyond the max with a count", () => {
    expect(formatBookList(["A", "B", "C", "D", "E"])).toBe("A, B, C, and 2 more");
  });

  it("respects a custom maxNamed", () => {
    expect(formatBookList(["A", "B", "C"], 2)).toBe("A, B, and 1 more");
  });
});

describe("describeDailyReadScope", () => {
  it("degrades gracefully with zero memberships", () => {
    expect(describeDailyReadScope([])).toBe("your recipe books");
  });

  it("names the single book when the user has exactly one (configured)", () => {
    expect(describeDailyReadScope([book("1", "Personal", true)])).toBe(
      "your recipe book Personal",
    );
  });

  it("names the single book when the user has exactly one (fallback)", () => {
    expect(describeDailyReadScope([book("1", "Personal", false)])).toBe(
      "your recipe book Personal",
    );
  });

  it("says 'all N' when every book is flagged", () => {
    expect(describeDailyReadScope([book("1", "A", true), book("2", "B", true)])).toBe(
      "all 2 of your recipe books",
    );
  });

  it("is honest about the fallback case — all included because none are marked", () => {
    expect(describeDailyReadScope([book("1", "A", false), book("2", "B", false)])).toBe(
      "all 2 of your recipe books (none are marked for daily reads yet, so all are included)",
    );
  });

  it("lists the actual subset when only some books are flagged", () => {
    const books = [book("1", "A", true), book("2", "B", false), book("3", "C", true)];
    expect(describeDailyReadScope(books)).toBe("A and C");
  });

  it("truncates a long subset", () => {
    const books = [
      book("1", "A", true),
      book("2", "B", true),
      book("3", "C", true),
      book("4", "D", true),
      book("5", "E", false),
    ];
    expect(describeDailyReadScope(books)).toBe("A, B, C, and 1 more");
  });
});
