/**
 * Organizations — multi-tenant grouping of users.
 *
 * Organizations are built in from the start. Every content object
 * belongs to exactly one organization. Personal projects use a
 * personal org auto-created on user signup.
 *
 * See: docs/backlog.md for pending org-related decisions.
 */
import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

export const OrgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const OrgVisibilitySchema = z.enum(["public", "private"]);
export type OrgVisibility = z.infer<typeof OrgVisibilitySchema>;

export const OrganizationSchema = z.object({
  id: IdSchema,
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().max(1000).optional(),
  /** public orgs' approved claims are searchable by all; private are only visible to members */
  visibility: OrgVisibilitySchema,
  /** Auto-created personal org for a user */
  isPersonal: z.boolean(),
  ownerId: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const OrgMemberSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  userId: IdSchema,
  role: OrgRoleSchema,
  joinedAt: TimestampSchema,
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const CreateOrganizationBodySchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().max(1000).optional(),
  visibility: OrgVisibilitySchema.default("private"),
});
export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBodySchema>;

export const InviteMemberBodySchema = z.object({
  email: z.string().email(),
  role: OrgRoleSchema.exclude(["owner"]),
});
export type InviteMemberBody = z.infer<typeof InviteMemberBodySchema>;
