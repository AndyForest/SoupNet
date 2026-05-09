/**
 * Search contracts — public API.
 *
 * No public feed. All discovery is search-driven.
 * Uses hybrid retrieval: FTS + pgvector ANN + relevancy re-ranking.
 *
 * Supports Google-style flag syntax in queries:
 *   kind:decision    — filter by tag prefix
 *   privacy:group    — filter by privacy level
 *   group:<id>       — filter to a specific group
 *
 * Source of truth: docs/architecture/api.md §Search
 */
import { z } from "zod";
import { IdSchema, PaginationSchema } from "./common";
import { PrivacyLevelSchema, StorageModeSchema } from "./claims";

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(2000),
  tags: z.array(z.string()).max(20).optional(),
  privacyScopes: z.array(PrivacyLevelSchema).optional(),
  groupIds: z.array(IdSchema).max(10).optional(),
  organizationId: IdSchema.optional(), // scoped search; omit for cross-org search
  pagination: PaginationSchema.optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultItemSchema = z.object({
  claimId: IdSchema,
  organizationId: IdSchema,
  summary: z.string(),
  tags: z.array(z.string()),
  privacyLevel: PrivacyLevelSchema,
  storageMode: StorageModeSchema,
  rankingScore: z.number(),
  validationCount: z.number().int(),
  latestValidationOutcome: z.string().optional(),
  hasUnappliedDescendants: z.boolean(),
  createdAt: z.string(),
});
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;
