/**
 * How deep a paged listing reaches (audit findings F105 and F110, 2026-10-26).
 *
 * Every OFFSET-paged listing an API key or a report reader can page through
 * serves rows only from its first LISTING_DEPTH_MAX: the report read paths,
 * the flat list a search with no bare text returns, and the ranked pages of
 * search and check. A page whose first row lies past that is refused with
 * a sentence naming `page` and the way to narrow, instead of making the
 * server skip millions of rows on one call. Totals stay exact; only the
 * reachable pages are bounded. A sweep that outgrows the reach narrows by
 * time (`changed-after:`, `created-after:`, `since`), which is what those
 * qualifiers are for.
 *
 * A cap, not keyset paging (recipe ce61eb6d): a cursor would be a new
 * parameter on the tool roster, the flat list's triage order sorts on a
 * computed expression a cursor would have to carry, and capping depth is the
 * established practice (Elasticsearch's `index.max_result_window` defaults to
 * 10,000; GitHub's search API returns at most the first 1,000 results).
 *
 * One constant for every path, so they cannot drift (recipe 01bfbe35). Pure.
 */

export const LISTING_DEPTH_MAX = 10_000;

/** The last page whose first row is within the reach, at this page size. */
export function lastReachablePage(perPage: number): number {
  return Math.max(1, Math.ceil(LISTING_DEPTH_MAX / Math.max(1, Math.floor(perPage))));
}

/** Whether a page starts past the reach (`(page - 1) × perPage ≥ LISTING_DEPTH_MAX`). */
export function pageBeyondReach(page: number, perPage: number): boolean {
  return page > lastReachablePage(perPage);
}

/**
 * The search surfaces' refusal (search_recipes, /check with or without a
 * recipe). `narrow` names what the caller can do instead.
 */
export function searchPageBeyondReachError(page: number, perPage: number, narrow: string): string {
  return `page ${page} is past what a search pages through: the first ${LISTING_DEPTH_MAX.toLocaleString("en-US")} results (pages 1 to ${lastReachablePage(perPage)} at ${perPage} per page). ${narrow}`;
}

/** What a sweep over the flat list narrows with. */
export const FLAT_LIST_NARROWING = "Narrow the query with changed-after:, created-after: or read_recipe_books to reach the rest.";
