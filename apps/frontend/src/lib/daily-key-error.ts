/**
 * Shared handling for POST /keys/daily failures.
 *
 * The backend refuses to guess a daily key's scope: with no recipe book
 * included in daily writes (and no explicit write book) it returns
 * `no_write_recipe_books_configured`, and with none included in daily reads
 * it returns `no_read_recipe_books_configured` [F71]. Both are fixed on the
 * Recipe Books page, so every button that mints a daily key shows the same
 * sentence with a link there (components/DailyKeyError.tsx) instead of a
 * bare "Failed to generate key".
 */

export type DailyKeySetupError =
  | "no_write_recipe_books_configured"
  | "no_read_recipe_books_configured";

const SETUP_SENTENCES: Record<DailyKeySetupError, { before: string; after: string }> = {
  no_write_recipe_books_configured: {
    before: "No recipe book is set for daily writes yet — include one on the ",
    after: ", then try again.",
  },
  no_read_recipe_books_configured: {
    before: "No recipe book is included in daily reads yet — include at least one on the ",
    after: ", then try again.",
  },
};

/**
 * The string to throw when a /keys/daily response is not ok: the backend's
 * error code when it sent one (so the UI can recognize the setup errors),
 * else a generic fallback.
 */
export function dailyKeyErrorCode(
  json: { error?: string | undefined },
  fallback = "Failed to generate key",
): string {
  return json.error ?? fallback;
}

export function isDailyKeySetupError(error: string | null | undefined): error is DailyKeySetupError {
  return error === "no_write_recipe_books_configured" || error === "no_read_recipe_books_configured";
}

/** The sentence around the "Recipe Books page" link, split so the link can be a router Link. */
export function dailyKeySetupSentence(error: DailyKeySetupError): { before: string; after: string } {
  return SETUP_SENTENCES[error];
}
