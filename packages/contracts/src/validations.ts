/**
 * Validation contracts — public API.
 *
 * Counter-analyses and supersessions have been replaced by the knowledge graph
 * (KnowledgeEdge in graph.ts). See docs/adr/0017-knowledge-graph-information-model.md
 *
 * Source of truth: docs/architecture/api.md §Validations
 * Registered in: packages/contracts/src/openapi-registry.ts
 * MCP tools: apps/mcp-server/src/tools/submit-validation.ts
 */
import { z } from "zod";
import { IdSchema, ModerationStateSchema, TimestampSchema } from "./common";

export const ValidationOutcomeSchema = z.enum([
  "success",
  "partial_success",
  "failure",
  "inconclusive",
  "not_applicable",
]);
export type ValidationOutcome = z.infer<typeof ValidationOutcomeSchema>;

/**
 * Rich validation report — closer to a bug report or experiment log than a rating.
 * This is ClaimNet's core differentiator.
 */
export const ValidationSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  requestId: IdSchema.optional(), // the request context that led to this claim

  validatorUserId: IdSchema,
  validatorNodeId: IdSchema.optional(),
  organizationId: IdSchema,

  problemStatement: z.string().min(20).max(4000),
  whyChosen: z.string().max(2000).optional(),
  environmentFreeText: z.string().max(1000).optional(),

  stepsSummary: z.string().max(4000),
  expectedResult: z.string().max(2000),
  actualResult: z.string().max(2000),
  evidenceSummary: z.string().max(4000).optional(),

  outcome: ValidationOutcomeSchema,
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string()).max(20),
  wouldReuse: z.boolean(),
  confidenceBlockers: z.array(z.string()).max(10).optional(),

  moderationState: ModerationStateSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Validation = z.infer<typeof ValidationSchema>;

export const CreateValidationBodySchema = z.object({
  claimId: IdSchema,
  requestId: IdSchema.optional(),
  problemStatement: z.string().min(20).max(4000),
  whyChosen: z.string().max(2000).optional(),
  environmentFreeText: z.string().max(1000).optional(),
  stepsSummary: z.string().max(4000),
  expectedResult: z.string().max(2000),
  actualResult: z.string().max(2000),
  evidenceSummary: z.string().max(4000).optional(),
  outcome: ValidationOutcomeSchema,
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string()).max(20),
  wouldReuse: z.boolean(),
  confidenceBlockers: z.array(z.string()).max(10).optional(),
});
export type CreateValidationBody = z.infer<typeof CreateValidationBodySchema>;

/**
 * Neutral summary: AI-generated synthesis of a claim and its validation record.
 * Deferred feature — schema retained for when the feature is built.
 */
export const NeutralSummarySchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  summaryText: z.string().min(20).max(4000),
  model: z.string(),
  generatedAt: TimestampSchema,
  validationCountAtGeneration: z.number().int().default(0),
});
export type NeutralSummary = z.infer<typeof NeutralSummarySchema>;
