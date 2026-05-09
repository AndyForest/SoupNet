/**
 * Knowledge graph contracts — public API.
 *
 * Typed directed edges connect claims (and validations/requests).
 * Supersedes the old counter_analyses and supersessions tables.
 *
 * Source of truth: docs/architecture/api.md §Knowledge graph
 * See: docs/adr/0017-knowledge-graph-information-model.md
 * Registered in: packages/contracts/src/openapi-registry.ts
 * MCP tools: apps/mcp-server/src/tools/create-edge.ts, get-ancestors.ts, get-descendants.ts
 */
import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";
import { PrivacyLevelSchema } from "./claims";

export const EdgeNodeTypeSchema = z.enum(["claim", "validation", "request"]);
export type EdgeNodeType = z.infer<typeof EdgeNodeTypeSchema>;

/**
 * Typed edge relation types.
 * Edges are directed: source → target.
 */
export const EdgeRelationTypeSchema = z.enum([
  "supersedes",       // source replaces or obsoletes target
  "depends_on",       // source builds on / requires target to be true
  "refutes",          // source challenges or contradicts target
  "supports",         // source provides additional evidence for target
  "narrows_scope_of", // source applies only in a subset of target's context
  "extends",          // source adds to / generalizes from target
]);
export type EdgeRelationType = z.infer<typeof EdgeRelationTypeSchema>;

/** Knowledge edge between two nodes */
export const KnowledgeEdgeSchema = z.object({
  id: IdSchema,
  sourceId: IdSchema,
  sourceType: EdgeNodeTypeSchema,
  targetId: IdSchema,
  targetType: EdgeNodeTypeSchema,
  relationType: EdgeRelationTypeSchema,
  privacyLevel: PrivacyLevelSchema,
  authorId: IdSchema,
  authorNodeId: IdSchema.optional(),
  organizationId: IdSchema,
  reasoning: z.string().max(1000).optional(),
  createdAt: TimestampSchema,
});
export type KnowledgeEdge = z.infer<typeof KnowledgeEdgeSchema>;

export const CreateEdgeBodySchema = z.object({
  sourceId: IdSchema,
  sourceType: EdgeNodeTypeSchema.default("claim"),
  targetId: IdSchema,
  targetType: EdgeNodeTypeSchema.default("claim"),
  relationType: EdgeRelationTypeSchema,
  privacyLevel: PrivacyLevelSchema.optional(),
  reasoning: z.string().max(1000).optional(),
});
export type CreateEdgeBody = z.infer<typeof CreateEdgeBodySchema>;

/** An ancestor or descendant in the graph, returned by traversal queries */
export const GraphNodeSchema = z.object({
  claimId: IdSchema,
  depth: z.number().int().min(0),
  relationType: EdgeRelationTypeSchema,
  summary: z.string(),
  tags: z.array(z.string()),
  privacyLevel: PrivacyLevelSchema,
  storageMode: z.string(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** External source of truth document (for indexed-mode claims) */
export const ExternalSourceSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  url: z.string().url(),
  title: z.string().optional(),
  sourceType: z.enum(["google_drive", "github", "notion", "confluence", "url"]).optional(),
  isAccessible: z.enum(["yes", "no", "unknown"]).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ExternalSource = z.infer<typeof ExternalSourceSchema>;

export const CreateExternalSourceBodySchema = z.object({
  claimId: IdSchema,
  url: z.string().url(),
  title: z.string().optional(),
});
export type CreateExternalSourceBody = z.infer<typeof CreateExternalSourceBodySchema>;
