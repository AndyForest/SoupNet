/**
 * Client-side mirror of the daily-key read-scope resolution in
 * apps/backend/src/routes/keys.ts (POST /keys/daily):
 *
 *   readGroupIds = configured daily_read set, or fall back to ALL
 *   memberships when the user has none configured.
 *
 * The dashboard uses this to label the "Copy agent briefing" / daily-key
 * buttons with the books the key will actually read, instead of a static
 * claim. If the backend rule changes, update both places — the label's
 * whole job is to match the key's real scope.
 */

export interface DailyReadBook {
  id: string;
  name: string;
  /** Wire-format field from GET /recipe-books (snake_case per SQL alias). */
  daily_read: boolean;
}

export interface ResolvedDailyReadScope<T extends DailyReadBook> {
  /** The books the daily key will read, after applying the fallback rule. */
  books: T[];
  /** True when zero books are flagged daily_read, so the backend falls back to all memberships. */
  usedFallback: boolean;
}

export function resolveDailyReadBooks<T extends DailyReadBook>(
  allBooks: T[],
): ResolvedDailyReadScope<T> {
  const configured = allBooks.filter((b) => b.daily_read);
  if (configured.length > 0) {
    return { books: configured, usedFallback: false };
  }
  return { books: allBooks, usedFallback: true };
}

/**
 * Human-readable book-name list for the scope label. Keeps the label short
 * when many books are included: "A", "A and B", "A, B, and C",
 * "A, B, C, and 2 more".
 */
export function formatBookList(names: string[], maxNamed = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= maxNamed) {
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, maxNamed);
  const rest = names.length - maxNamed;
  return `${shown.join(", ")}, and ${rest} more`;
}

/**
 * The full scope sentence fragment after "reads ". Kept pure so the exact
 * wording — including the honest fallback case — is unit-testable.
 */
export function describeDailyReadScope(
  allBooks: DailyReadBook[],
): string {
  if (allBooks.length === 0) return "your recipe books";
  const { books, usedFallback } = resolveDailyReadBooks(allBooks);
  if (usedFallback) {
    return allBooks.length === 1
      ? `your recipe book ${allBooks[0]!.name}`
      : `all ${allBooks.length} of your recipe books (none are marked for daily reads yet, so all are included)`;
  }
  if (books.length === allBooks.length) {
    return allBooks.length === 1
      ? `your recipe book ${allBooks[0]!.name}`
      : `all ${allBooks.length} of your recipe books`;
  }
  return formatBookList(books.map((b) => b.name));
}
