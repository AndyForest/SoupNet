/**
 * @soupnet/contracts — public API Zod schemas.
 *
 * Source of truth: docs/architecture/api.md
 * Generated OpenAPI spec: packages/api-client/openapi.json
 *
 * To regenerate derived files:
 *   npm run generate:openapi   → packages/api-client/openapi.json
 *   npm run generate:api-client → packages/api-client/src/generated/
 */

export * from "./common";
export * from "./claims";
export * from "./validations";
export * from "./graph";
export * from "./groups";
export * from "./search";
export * from "./organizations";
export * from "./nodes";
export * from "./requests";
// requests.ts is retained (ClaimRequestSchema used for request broker feature — backlog)
// artifacts.ts: retained if it exists (MIME allowlist); artifact_kind concept removed (ADR-0011)
export * from "./recipe";
