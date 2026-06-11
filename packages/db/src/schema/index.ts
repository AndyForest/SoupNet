/**
 * Drizzle schema for the `claimnet` PostgreSQL schema.
 *
 * All tables here live at `claimnet.<table>` in Postgres.
 * Single source of truth for all claimnet.* tables.
 * Run `drizzle-kit generate` after any change.
 *
 * Table groups:
 *   traces.ts              — core trace object (stigmergic search-as-logging)
 *   users.ts               — user identity and authentication
 *   organizations.ts       — multi-tenant organization containers
 *   groups.ts              — groups and group membership
 *   evidence.ts            — evidence entries (interpretations)
 *   references.ts          — raw quotes + source citations
 *   links.ts               — N:N linking tables (trace↔evidence, trace↔reference, evidence↔reference)
 *   api-keys.ts            — API keys for agent/user authentication
 *   reference-source-cache.ts — cached fetched content from reference URLs
 *   audit-log.ts           — append-only audit trail
 *   vectors.ts             — four-table embedding pipeline
 *   vector-cache.ts        — content-addressed vector cache (hash → vector, no source text)
 */

export * from "./traces";
export * from "./users";
export * from "./organizations";
export * from "./groups";
export * from "./evidence";
export * from "./references";
export * from "./links";
export * from "./reference-source-cache";
export * from "./api-keys";
export * from "./audit-log";
export * from "./vectors";
export * from "./vector-cache";
export * from "./system-settings";
export * from "./invitations";
export * from "./email-log";
export * from "./uploads";
export * from "./oauth-clients";
export * from "./oauth-authorization-codes";
