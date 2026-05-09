/**
 * Claim contracts — public API.
 *
 * Source of truth: docs/architecture/api.md §Claims
 * Registered in: packages/contracts/src/openapi-registry.ts
 * MCP tools: apps/mcp-server/src/tools/submit-claim.ts, get-claim.ts, fetch-artifact.ts
 */
import { z } from "zod";
import { IdSchema, ModerationStateSchema, TimestampSchema } from "./common";

// ── Privacy and storage enums ──────────────────────────────────────────────────

/**
 * Who can see the claim.
 * 'public' is reserved for post-MVP and is rejected at the API boundary (HTTP 400).
 */
export const PrivacyLevelSchema = z.enum([
  "agent_only",
  "user_only",
  "group",
  "org_only",
]);
export type PrivacyLevel = z.infer<typeof PrivacyLevelSchema>;

/**
 * How payload content is handled.
 * See docs/adr/0014-client-side-vector-computation.md
 */
export const StorageModeSchema = z.enum([
  "full",      // content retained in S3; server computes vectors
  "indexed",   // server vectorizes then deletes; payload_link is live source of truth
  "air-gapped", // client computes vectors; content never transmitted
]);
export type StorageMode = z.infer<typeof StorageModeSchema>;

// ── Reasoning digest ───────────────────────────────────────────────────────────

/** Compact reasoning metadata stored on the claim card. All fields optional. */
export const ReasoningDigestSchema = z.object({
  whatWasAttempted: z.string().max(2000).optional(),
  whyThisPath: z.string().max(2000).optional(),
  assumptions: z.array(z.string()).max(20).optional(),
  evidenceTypes: z.array(z.string()).max(20).optional(),
  environment: z.string().max(500).optional(),
  conclusion: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  knownLimitations: z.array(z.string()).max(20).optional(),
});
export type ReasoningDigest = z.infer<typeof ReasoningDigestSchema>;

// ── Claim ──────────────────────────────────────────────────────────────────────

/** Full claim card returned by the API */
export const ClaimSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  authorId: IdSchema,
  authorNodeId: IdSchema.optional(), // null if submitted via web UI

  summary: z.string().min(10).max(2000),
  tags: z.array(z.string()).max(30),

  privacyLevel: PrivacyLevelSchema,
  storageMode: StorageModeSchema,

  /**
   * External source of truth URL (indexed mode only).
   * The document at this link is authoritative — ClaimNet stores the judgment, not a copy.
   */
  payloadLink: z.string().url().optional(),

  reasoningDigest: ReasoningDigestSchema.optional(),

  moderationState: ModerationStateSchema,
  rankingScore: z.number().optional(),
  validationCount: z.number().int().default(0),
  hasUnappliedDescendants: z.boolean().default(false),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Body for creating a new claim */
export const CreateClaimBodySchema = z.object({
  summary: z.string().min(10).max(2000),
  tags: z.array(z.string()).max(30),
  organizationId: IdSchema,

  privacyLevel: PrivacyLevelSchema.optional(), // defaults to org/user default
  storageMode: StorageModeSchema.optional(),   // defaults to org/user default

  payloadLink: z.string().url().optional(),    // required for indexed mode

  reasoningDigest: ReasoningDigestSchema.optional(),

  /** If set, creates a knowledge edge parent_claim_id → this claim on submission */
  parentClaimId: IdSchema.optional(),
  edgeRelationType: z.enum([
    "depends_on", "extends", "supersedes", "supports", "narrows_scope_of",
  ]).optional(),
});
export type CreateClaimBody = z.infer<typeof CreateClaimBodySchema>;

/** Response after creating a claim */
export const CreateClaimResponseSchema = z.object({
  claimId: IdSchema,
  summary: z.string(),
  privacyLevel: PrivacyLevelSchema,
  storageMode: StorageModeSchema,
  createdAt: TimestampSchema,
});
export type CreateClaimResponse = z.infer<typeof CreateClaimResponseSchema>;

/** Response for payload download URL request */
export const ClaimPayloadResponseSchema = z.object({
  downloadUrl: z.string().url().optional(),   // null if fulfillment is pending
  status: z.enum(["available", "fulfillment_requested", "air-gapped", "not_available"]),
  expiresAt: z.string().optional(),
  retryAfter: z.number().int().optional(),    // seconds to wait before polling again
});
export type ClaimPayloadResponse = z.infer<typeof ClaimPayloadResponseSchema>;
