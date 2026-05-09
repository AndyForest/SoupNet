/**
 * Shared primitive schemas used across contracts.
 *
 * Note: ArtifactKindSchema has been removed per ADR-0011 (self-describing claims via tags).
 * Use tags like "kind:decision", "kind:procedure", "kind:bug-report" instead.
 * See docs/adr/0011-self-describing-claims.md
 */
import { z } from "zod";

export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.string().datetime();

/** Pagination params for list endpoints */
export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

/** Standard API response envelopes */
export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  });

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Moderation states shared across object types */
export const ModerationStateSchema = z.enum([
  "pending",
  "approved",
  "flagged",
  "removed",
  "under_review",
]);
export type ModerationState = z.infer<typeof ModerationStateSchema>;
