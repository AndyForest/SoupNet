/**
 * Domain entity types — single source of truth for all claimnet entities.
 *
 * Derived from Drizzle `$inferSelect` types (packages/db). A DB schema change
 * propagates here as a compile error.
 */

export type { Trace, TraceCreate, TraceSummary } from "./trace";
