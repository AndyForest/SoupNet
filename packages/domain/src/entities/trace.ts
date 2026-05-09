/**
 * Trace entity — the core unit of the stigmergic search-as-logging model.
 *
 * A trace is a subjective taste or judgment, typically in Design Thinking
 * user story format: "As a [role] working on [goal], I [prefer/chose] so that [reason]".
 *
 * Persistence type derived from Drizzle $inferSelect.
 */

import type { traces } from "@soupnet/db";

// ── Layer 1: Persistence ────────────────────────────────────────────────────

/** Full trace row as stored in the DB. */
export type Trace = Readonly<typeof traces.$inferSelect>;

// ── Layer 2: Domain ─────────────────────────────────────────────────────────

/** Fields required to create a trace. */
export interface TraceCreate {
  userId: string;
  groupId: string;
  claimText: string;
}

// ── Layer 3: Transport ──────────────────────────────────────────────────────

/** Minimal trace view for search results. */
export interface TraceSummary {
  id: string;
  claimText: string;
  createdAt: string;
  rank: number;
}
