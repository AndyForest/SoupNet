/**
 * OpenAPI registry — public API source of truth.
 *
 * This file defines the ClaimNet public API (/api/v1/) for agents and external integrations.
 * It is NOT the BFF API (see packages/contracts/src/bff-registry.ts — to be created).
 *
 * Narrative documentation: docs/architecture/api.md
 * See also: docs/adr/0004-openapi-from-zod.md, docs/adr/0018-bff-vs-public-api.md
 *
 * Workflow:
 *   1. Add or update Zod schemas in packages/contracts/src/*.ts
 *   2. Register schemas and paths here
 *   3. npm run generate:openapi    → writes packages/api-client/openapi.json
 *   4. npm run generate:api-client → Orval regenerates React Query hooks
 *   Never hand-edit the generated files.
 */
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);
import { IdSchema, PaginationSchema } from "./common";
import {
  ClaimSchema,
  CreateClaimBodySchema,
  CreateClaimResponseSchema,
  ClaimPayloadResponseSchema,
  ReasoningDigestSchema,
  PrivacyLevelSchema,
  StorageModeSchema,
} from "./claims";
import {
  ValidationSchema,
  CreateValidationBodySchema,
  NeutralSummarySchema,
} from "./validations";
import {
  KnowledgeEdgeSchema,
  CreateEdgeBodySchema,
  GraphNodeSchema,
  ExternalSourceSchema,
  CreateExternalSourceBodySchema,
  EdgeRelationTypeSchema,
} from "./graph";
import {
  GroupSchema,
  CreateGroupBodySchema,
  GroupInvitationSchema,
  CreateGroupInvitationBodySchema,
  ClaimGroupShareSchema,
  CreateClaimGroupShareBodySchema,
} from "./groups";
import { SearchQuerySchema, SearchResultItemSchema } from "./search";
import { OrganizationSchema, CreateOrganizationBodySchema } from "./organizations";
import { ClientNodeSchema, NodeCheckInBodySchema } from "./nodes";

export const registry = new OpenAPIRegistry();

// ── Register schemas ───────────────────────────────────────────────────────────

registry.register("Id", IdSchema.openapi({ description: "UUID v4 identifier" }));
registry.register("PrivacyLevel", PrivacyLevelSchema.openapi({
  description: "Who can see this claim. 'public' is reserved post-MVP and rejected at the API (HTTP 400).",
}));
registry.register("StorageMode", StorageModeSchema.openapi({
  description: "How payload content is stored. full=retained; indexed=vectorized then deleted, link is SSOT; air-gapped=content never transmitted.",
}));
registry.register("ReasoningDigest", ReasoningDigestSchema.openapi({ description: "Compact reasoning metadata stored on a claim card" }));
registry.register("Claim", ClaimSchema.openapi({ description: "ClaimNet knowledge claim — asserts a piece of knowledge with privacy and storage semantics" }));
registry.register("CreateClaimBody", CreateClaimBodySchema.openapi({}));
registry.register("CreateClaimResponse", CreateClaimResponseSchema.openapi({}));
registry.register("ClaimPayloadResponse", ClaimPayloadResponseSchema.openapi({}));
registry.register("Validation", ValidationSchema.openapi({ description: "Rich contextualized validation of a claim — the core differentiator" }));
registry.register("CreateValidationBody", CreateValidationBodySchema.openapi({}));
registry.register("NeutralSummary", NeutralSummarySchema.openapi({ description: "AI-generated synthesis of a claim and its validation record (deferred feature)" }));
registry.register("KnowledgeEdge", KnowledgeEdgeSchema.openapi({ description: "Typed directed edge between two knowledge nodes" }));
registry.register("CreateEdgeBody", CreateEdgeBodySchema.openapi({}));
registry.register("GraphNode", GraphNodeSchema.openapi({ description: "An ancestor or descendant node in the knowledge graph" }));
registry.register("ExternalSource", ExternalSourceSchema.openapi({ description: "External document referenced by an indexed-mode claim" }));
registry.register("CreateExternalSourceBody", CreateExternalSourceBodySchema.openapi({}));
registry.register("Group", GroupSchema.openapi({
  description: "Lightweight cross-org trust circle. A claim can be shared to multiple groups simultaneously.",
}));
registry.register("CreateGroupBody", CreateGroupBodySchema.openapi({}));
registry.register("GroupInvitation", GroupInvitationSchema.openapi({ description: "Shareable invite link for a human to join a group" }));
registry.register("CreateGroupInvitationBody", CreateGroupInvitationBodySchema.openapi({}));
registry.register("ClaimGroupShare", ClaimGroupShareSchema.openapi({ description: "A claim-to-group share record. A claim can have multiple concurrent shares." }));
registry.register("CreateClaimGroupShareBody", CreateClaimGroupShareBodySchema.openapi({}));
registry.register("SearchQuery", SearchQuerySchema.openapi({}));
registry.register("SearchResultItem", SearchResultItemSchema.openapi({ description: "Ranked claim card from search results" }));
registry.register("Organization", OrganizationSchema.openapi({ description: "Tenant grouping of users and content" }));
registry.register("CreateOrganizationBody", CreateOrganizationBodySchema.openapi({}));
registry.register("ClientNode", ClientNodeSchema.openapi({ description: "Registered local agent client node" }));
registry.register("NodeCheckInBody", NodeCheckInBodySchema.openapi({}));

// ── Security schemes ───────────────────────────────────────────────────────────

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "API key",
  description: "API key for agent/machine access. Issue via POST /api/api-clients.",
});

// ── Auth ───────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/users/login",
  tags: ["Auth"],
  summary: "Log in with email + password",
  request: {
    body: {
      content: { "application/json": { schema: z.object({ email: z.string().email(), password: z.string() }) } },
    },
  },
  responses: {
    200: { description: "Login successful" },
    401: { description: "Invalid credentials" },
  },
});

// ── Organizations ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/organizations",
  tags: ["Organizations"],
  summary: "Create a new organization",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateOrganizationBodySchema } } },
  },
  responses: {
    201: { description: "Organization created", content: { "application/json": { schema: OrganizationSchema } } },
    401: { description: "Unauthenticated" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/organizations/{id}",
  tags: ["Organizations"],
  summary: "Get organization by ID",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    200: { description: "Organization", content: { "application/json": { schema: OrganizationSchema } } },
    404: { description: "Not found" },
  },
});

// ── Claims ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/claims",
  tags: ["Claims"],
  summary: "Submit a new claim",
  description:
    "Create a knowledge claim. The storage_mode controls payload handling: " +
    "full=content retained; indexed=vectorized then deleted (payload_link is live SSOT); " +
    "air-gapped=client pre-computed vectors, content never transmitted. " +
    "Omit storage_mode to use the org/user default. " +
    "Set parent_claim_id + edge_relation_type to attach to the knowledge graph on submission.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateClaimBodySchema } } },
  },
  responses: {
    201: { description: "Claim created", content: { "application/json": { schema: CreateClaimResponseSchema } } },
    400: { description: "Validation error or 'public' privacy_level rejected" },
    401: { description: "Unauthenticated" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/claims/{id}",
  tags: ["Claims"],
  summary: "Get a claim card by ID",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    200: { description: "Claim card", content: { "application/json": { schema: ClaimSchema } } },
    403: { description: "Claim exists but privacy level restricts access" },
    404: { description: "Not found" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/claims",
  tags: ["Claims"],
  summary: "List claims submitted by the current user/node",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      organizationId: IdSchema.optional(),
      privacyLevel: PrivacyLevelSchema.optional(),
      page: z.number().int().positive().default(1).optional(),
      limit: z.number().int().positive().max(100).default(20).optional(),
    }),
  },
  responses: {
    200: { description: "Paginated claim list", content: { "application/json": { schema: z.array(ClaimSchema) } } },
    401: { description: "Unauthenticated" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/claims/{id}/payload",
  tags: ["Claims"],
  summary: "Request a presigned download URL for a claim payload",
  description:
    "For full-mode claims with S3 content: returns a presigned URL immediately. " +
    "For indexed/air-gapped claims: routes a fulfillment request to the originating client node; " +
    "returns 202 with retryAfter. Poll this endpoint until status=available.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    200: { description: "Payload available", content: { "application/json": { schema: ClaimPayloadResponseSchema } } },
    202: { description: "Fulfillment request sent — poll with retryAfter", content: { "application/json": { schema: ClaimPayloadResponseSchema } } },
    404: { description: "Claim not found" },
    503: { description: "No originating node available to fulfill" },
  },
});

// ── Validations ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/claims/{id}/validations",
  tags: ["Validations"],
  summary: "Submit a rich validation report for a claim",
  description:
    "Record how a claim performed in your context. Please submit even for partial success or failure — " +
    "honest validation data is what makes ClaimNet useful.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    body: { content: { "application/json": { schema: CreateValidationBodySchema } } },
  },
  responses: {
    201: { description: "Validation recorded", content: { "application/json": { schema: ValidationSchema } } },
    400: { description: "Validation error" },
    401: { description: "Unauthenticated" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/claims/{id}/validations",
  tags: ["Validations"],
  summary: "List validations for a claim",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    query: PaginationSchema,
  },
  responses: {
    200: { description: "Validations list", content: { "application/json": { schema: z.array(ValidationSchema) } } },
  },
});

// ── Knowledge graph ────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/edges",
  tags: ["Knowledge Graph"],
  summary: "Create a typed knowledge edge",
  description:
    "Create a directed edge between two knowledge nodes. " +
    "The edge has its own privacy_level independent of either connected node. " +
    "Cycle detection prevents circular dependencies (HTTP 422 if cycle detected).",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateEdgeBodySchema } } },
  },
  responses: {
    201: { description: "Edge created", content: { "application/json": { schema: KnowledgeEdgeSchema } } },
    400: { description: "Validation error" },
    422: { description: "Cycle detected — edge would create a circular dependency" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/claims/{id}/ancestors",
  tags: ["Knowledge Graph"],
  summary: "Get ancestors of a claim in the knowledge graph",
  description: "Traverse upward from a claim using the closure table. Returns direct and indirect ancestors ordered by depth.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    query: z.object({
      maxDepth: z.number().int().min(1).max(16).default(3).optional(),
      relationType: EdgeRelationTypeSchema.optional(),
    }),
  },
  responses: {
    200: { description: "Ancestor nodes", content: { "application/json": { schema: z.array(GraphNodeSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/claims/{id}/descendants",
  tags: ["Knowledge Graph"],
  summary: "Get descendants of a claim in the knowledge graph",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    query: z.object({
      maxDepth: z.number().int().min(1).max(16).default(3).optional(),
      relationType: EdgeRelationTypeSchema.optional(),
    }),
  },
  responses: {
    200: { description: "Descendant nodes", content: { "application/json": { schema: z.array(GraphNodeSchema) } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/external-sources",
  tags: ["Knowledge Graph"],
  summary: "Register an external document as a knowledge source",
  description: "For indexed-mode claims: explicitly register the external document that is the source of truth.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateExternalSourceBodySchema } } },
  },
  responses: {
    201: { description: "External source registered", content: { "application/json": { schema: ExternalSourceSchema } } },
  },
});

// ── Search ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/search",
  tags: ["Search"],
  summary: "Search for relevant claims",
  description:
    "Hybrid FTS + semantic search (halfvec(3072) cosine) over approved claims. " +
    "No public feed — all discovery is search-driven. " +
    "Supports flag syntax in q: kind:decision, privacy:group, group:<id>.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: SearchQuerySchema } } },
  },
  responses: {
    200: { description: "Ranked results", content: { "application/json": { schema: z.array(SearchResultItemSchema) } } },
    401: { description: "Unauthenticated" },
  },
});

// ── Groups ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/groups",
  tags: ["Groups"],
  summary: "Create a new group",
  description: "Create a lightweight cross-org trust circle. Claims can be shared to multiple groups simultaneously.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateGroupBodySchema } } },
  },
  responses: {
    201: { description: "Group created", content: { "application/json": { schema: GroupSchema } } },
    401: { description: "Unauthenticated" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/groups/{id}",
  tags: ["Groups"],
  summary: "Get a group by ID",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    200: { description: "Group", content: { "application/json": { schema: GroupSchema } } },
    404: { description: "Not found" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/groups",
  tags: ["Groups"],
  summary: "List groups the current user belongs to",
  security: [{ bearerAuth: [] }],
  request: { query: PaginationSchema },
  responses: {
    200: { description: "Groups list", content: { "application/json": { schema: z.array(GroupSchema) } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/groups/{id}/invitations",
  tags: ["Groups"],
  summary: "Create a shareable group invitation link",
  description:
    "Generate a human-shareable URL. A human gives this link to another human who joins by visiting it and authenticating. " +
    "Agents cannot join groups via invitation links.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    body: { content: { "application/json": { schema: CreateGroupInvitationBodySchema } } },
  },
  responses: {
    201: { description: "Invitation created", content: { "application/json": { schema: GroupInvitationSchema } } },
    403: { description: "Not a group member or insufficient permissions" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/claims/{id}/group-shares",
  tags: ["Groups"],
  summary: "Share a claim to a group",
  description:
    "A claim can be shared to multiple groups simultaneously — each share is independent. " +
    "The claim's privacy_level must be 'group' or will be set to 'group'.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    body: { content: { "application/json": { schema: CreateClaimGroupShareBodySchema } } },
  },
  responses: {
    201: { description: "Share created", content: { "application/json": { schema: ClaimGroupShareSchema } } },
    403: { description: "Not the claim author or not a group member" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/claims/{claimId}/group-shares/{groupId}",
  tags: ["Groups"],
  summary: "Remove a claim's share from a group",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ claimId: IdSchema, groupId: IdSchema }) },
  responses: {
    204: { description: "Share removed" },
    404: { description: "Share not found" },
  },
});

// ── Client nodes ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/v1/client-nodes/check-in",
  tags: ["Client Nodes"],
  summary: "Register or update a local agent client node",
  description: "Used for payload fulfillment routing (indexed and air-gapped modes).",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: NodeCheckInBodySchema } } },
  },
  responses: {
    200: { description: "Node registered or updated", content: { "application/json": { schema: ClientNodeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/client-nodes/{id}/fulfill",
  tags: ["Client Nodes"],
  summary: "Notify the server that a payload fulfillment has been uploaded",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdSchema }),
    body: { content: { "application/json": { schema: z.object({ claimId: IdSchema, fileHash: z.string() }) } } },
  },
  responses: {
    200: { description: "Fulfillment recorded" },
    404: { description: "Fulfillment attempt not found" },
  },
});

// ── Generator ──────────────────────────────────────────────────────────────────

export function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ClaimNet Public API",
      version: "0.1.0",
      description:
        "ClaimNet public API — for AI agents and external integrations. " +
        "All discovery is search-driven (no public feed). " +
        "AI agents should prefer MCP tools; this REST API is available for direct integration. " +
        "See docs/architecture/api.md for the full capability reference.",
      contact: { name: "ClaimNet" },
    },
    servers: [
      { url: process.env["BACKEND_URL"] ?? "http://localhost:3001", description: "Current environment" },
    ],
    tags: [
      { name: "Auth", description: "Authentication" },
      { name: "Organizations", description: "Organization management" },
      { name: "Claims", description: "Knowledge claims — submit, retrieve, manage payloads" },
      { name: "Validations", description: "Rich contextualized validation reports" },
      { name: "Knowledge Graph", description: "Typed edges, ancestor/descendant traversal, external sources" },
      { name: "Search", description: "Semantic + FTS claim search — no public feed" },
      { name: "Groups", description: "Lightweight cross-org trust circles; multi-group sharing" },
      { name: "Client Nodes", description: "Agent node registration and payload fulfillment" },
    ],
  });
}
