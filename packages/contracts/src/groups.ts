/**
 * Group contracts — public API.
 *
 * Groups are lightweight cross-org trust circles.
 * A claim can be shared to multiple groups simultaneously; each share is independent.
 *
 * Groups are Payload-managed (public.groups + public.group_members).
 * The Drizzle-managed claimnet.claim_group_shares table tracks shares.
 *
 * Source of truth: docs/architecture/api.md §Groups
 * See: docs/adr/0016-groups.md
 * Registered in: packages/contracts/src/openapi-registry.ts
 * MCP tools: apps/mcp-server/src/tools/share-to-group.ts, create-group.ts, create-group-invitation.ts
 */
import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

export const GroupSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  memberCount: z.number().int().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Group = z.infer<typeof GroupSchema>;

export const CreateGroupBodySchema = z.object({
  organizationId: IdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type CreateGroupBody = z.infer<typeof CreateGroupBodySchema>;

/** Invitation link for a human to join a group */
export const GroupInvitationSchema = z.object({
  id: IdSchema,
  groupId: IdSchema,
  inviteUrl: z.string().url(),
  expiresAt: TimestampSchema,
  maxUses: z.number().int().nullable(),
  useCount: z.number().int().default(0),
  createdAt: TimestampSchema,
});
export type GroupInvitation = z.infer<typeof GroupInvitationSchema>;

export const CreateGroupInvitationBodySchema = z.object({
  groupId: IdSchema,
  expiresInHours: z.number().int().min(1).max(720).default(72),
  maxUses: z.number().int().positive().optional(),
});
export type CreateGroupInvitationBody = z.infer<typeof CreateGroupInvitationBodySchema>;

/** A claim-to-group share record */
export const ClaimGroupShareSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  groupId: IdSchema,
  grantedBy: IdSchema,
  createdAt: TimestampSchema,
});
export type ClaimGroupShare = z.infer<typeof ClaimGroupShareSchema>;

export const CreateClaimGroupShareBodySchema = z.object({
  groupId: IdSchema,
});
export type CreateClaimGroupShareBody = z.infer<typeof CreateClaimGroupShareBodySchema>;
