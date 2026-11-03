/** The consoles' list routes: what a page of a list may ask for. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;
const LIST_MAX_OFFSET = 2_147_483_647;

export const LIST_PAGING_MESSAGE = `limit must be a whole number of 1 or more (at most ${LIST_MAX_LIMIT} are returned), and offset a whole number of 0 or more.`;

export interface ListPaging {
  limit: number;
  offset: number;
}

function wholeNumber(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/**
 * `limit` and `offset` from a query string, or null when either isn't one, so a
 * route can answer 400 instead of handing Postgres a value it refuses (F206). A
 * limit above the maximum still means the maximum.
 */
export function parseListPaging(query: Partial<Record<string, string | undefined>>): ListPaging | null {
  const limit = wholeNumber(query["limit"] ?? String(LIST_DEFAULT_LIMIT));
  const offset = wholeNumber(query["offset"] ?? "0");
  if (limit === null || limit < 1 || offset === null || offset > LIST_MAX_OFFSET) return null;
  return { limit: Math.min(limit, LIST_MAX_LIMIT), offset };
}
