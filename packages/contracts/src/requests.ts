/**
 * Request objects: the main entry point for retrieval in ClaimNet.
 * An agent submits a Request when it needs help solving a problem.
 *
 * Updated per ADR-0011: removed ArtifactKindSchema and CompatibilityFilterSchema.
 * Use tags for kind/compatibility filtering (e.g. "kind:decision", "lang:python").
 * See docs/architecture/api.md §Search and backlog.md §Schema cleanup.
 * TODO: Add requester_node_id field — see backlog.md §Schema cleanup.
 */
import { z } from "zod";
import { IdSchema, ModerationStateSchema, TimestampSchema } from "./common";

export const RequestStatusSchema = z.enum([
  "open",
  "matched",
  "fulfilled",
  "expired",
  "closed",
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

/** A request submitted by an agent or user */
export const ClaimRequestSchema = z.object({
  id: IdSchema,
  requesterUserId: IdSchema,
  organizationId: IdSchema,
  queryText: z.string().min(10).max(4000),
  /** Use tags for kind/compat filtering: "kind:decision", "lang:python", "os:linux", etc. */
  tags: z.array(z.string()).max(20),
  /** ISO 8601 duration, e.g. PT1H */
  ttl: z.string().optional(),
  /** Optional context bundle — a brief description of the requesting agent's current task */
  contextSummary: z.string().max(2000).optional(),
  status: RequestStatusSchema,
  moderationState: ModerationStateSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

export const CreateRequestBodySchema = ClaimRequestSchema.pick({
  organizationId: true,
  queryText: true,
  tags: true,
  ttl: true,
  contextSummary: true,
});
export type CreateRequestBody = z.infer<typeof CreateRequestBodySchema>;

export const MatchRequestBodySchema = z.object({
  maxResults: z.number().int().positive().max(20).default(5),
});
export type MatchRequestBody = z.infer<typeof MatchRequestBodySchema>;
