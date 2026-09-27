/**
 * Optimistic-update helpers for a recipe book's daily-link preferences
 * (PUT /recipe-books/:id/daily-prefs). The page writes the patch into the
 * cached ["groups"] list as soon as a checkbox is clicked, and applies the
 * rollback if the save fails. Rolling back only the fields a patch replaced,
 * rather than restoring a whole-list snapshot, keeps a failed save from
 * undoing a different checkbox's save that was in flight at the same time.
 */
export interface DailyPrefsPatch {
  dailyRead?: boolean;
  dailyWrite?: boolean;
}

interface DailyPrefsBook {
  id: string;
  daily_read: boolean;
  daily_write: boolean;
}

export function applyDailyPrefs<T extends DailyPrefsBook>(
  books: T[] | undefined,
  bookId: string,
  patch: DailyPrefsPatch,
): T[] | undefined {
  if (!books) return books;
  return books.map((book) =>
    book.id !== bookId
      ? book
      : {
          ...book,
          ...(patch.dailyRead !== undefined ? { daily_read: patch.dailyRead } : {}),
          ...(patch.dailyWrite !== undefined ? { daily_write: patch.dailyWrite } : {}),
        },
  );
}

export function dailyPrefsRollback(
  books: DailyPrefsBook[] | undefined,
  bookId: string,
  patch: DailyPrefsPatch,
): DailyPrefsPatch {
  const book = books?.find((b) => b.id === bookId);
  if (!book) return {};
  return {
    ...(patch.dailyRead !== undefined ? { dailyRead: book.daily_read } : {}),
    ...(patch.dailyWrite !== undefined ? { dailyWrite: book.daily_write } : {}),
  };
}
