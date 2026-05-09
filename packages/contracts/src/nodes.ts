/**
 * Client node contracts.
 * Local agent clients are represented as ClientNodes.
 * They register for payload fulfillment and advertise node identity.
 *
 * Updated per ADR-0011: removed compatibilityMetadata from capabilities.
 * Capability matching is now tag-based. Use tags like "lang:python", "os:linux".
 * See docs/architecture/api.md §Client Nodes
 */
import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

export const ClientNodeStatusSchema = z.enum(["online", "offline", "degraded"]);

/** What this node advertises it can do. Tags replace the old compatibilityMetadata object. */
export const CapabilitySchema = z.object({
  description: z.string().max(500),
  tags: z.array(z.string()).max(30),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const ClientNodeSchema = z.object({
  id: IdSchema,
  ownerUserId: IdSchema,
  publicKey: z.string(),
  label: z.string().max(200).optional(),
  status: ClientNodeStatusSchema,
  capabilities: z.array(CapabilitySchema),
  lastSeenAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ClientNode = z.infer<typeof ClientNodeSchema>;

export const NodeCheckInBodySchema = z.object({
  publicKey: z.string(),
  label: z.string().max(200).optional(),
  capabilities: z.array(CapabilitySchema),
});
export type NodeCheckInBody = z.infer<typeof NodeCheckInBodySchema>;

export const FulfillmentRequestSchema = z.object({
  id: IdSchema,
  requestId: IdSchema,
  nodeId: IdSchema,
  /** Presigned S3 URL the node should upload the artifact to */
  uploadUrl: z.string().url(),
  /** S3 key that will hold the artifact after upload */
  artifactKey: z.string(),
  /** When this fulfillment request expires */
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
});
export type FulfillmentRequest = z.infer<typeof FulfillmentRequestSchema>;
