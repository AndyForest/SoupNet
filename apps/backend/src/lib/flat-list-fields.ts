/**
 * The flat list's wire fields (drafts-and-triage slice 8b), shared by the
 * /check JSON builder and the remote MCP search tool so the two surfaces
 * cannot drift (the stdio server reads the /check JSON).
 *
 * A row is an index entry: the id, the whole claim, the book, the three
 * times, and the viewer's own draft label with its ratings (S3-AG2: ratings
 * ride only on the viewer's own drafts). No evidence and no similarity;
 * get_recipes fetches what a sweep wants to read. Known recipes are not
 * stubbed, because a sweep needs every id on every tick (S8b-L5).
 */
import type { Recipe } from "@soupnet/contracts";
import type { EnrichedResult } from "../services/result-enricher";
import type { SubmitAndSearchResult, FlatListMeta } from "../services/trace.service";
import { ownDraftFields } from "./own-draft-fields";

export function flatListFields(
  result: SubmitAndSearchResult & { listing: FlatListMeta },
  enriched: EnrichedResult[],
): Record<string, unknown> {
  return {
    clustered: false,
    listOrder: result.listing.order,
    perPage: result.listing.perPage,
    results: enriched.map((r) => {
      const times = result.listing.times[r.id];
      const row: Recipe = {
        recipeId: r.id,
        recipe: r.claimText,
        ...ownDraftFields(r),
        // The judgment date, as on every result row; loggedAt is the append
        // time, as on get_recipes.
        createdAt: r.createdAt,
        ...(times ? { loggedAt: times.depositedAt, changedAt: times.changedAt } : {}),
        ...(r.recipeBook ? { recipeBook: { recipeBookId: r.recipeBook.recipeBookId, name: r.recipeBook.name } } : {}),
      };
      return row;
    }),
    totalResults: result.totalResults,
    page: result.currentPage,
    totalPages: result.totalPages,
  };
}
