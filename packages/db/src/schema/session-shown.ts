/**
 * session_shown — per-session display history for known-set stub rendering.
 *
 * One row = "this session token has been shown this recipe's full text."
 * Written batch-wise after a check renders (ON CONFLICT DO NOTHING), read as
 * part of the known-set (contributed ∪ SHOWN ∪ client-declared) so later
 * checks in the same session render already-shown recipes as id-stubs and
 * walk the ranking down to unseen ones — the session models the agent's
 * context-fill state (operator ruling 2026-07-17, recipe 31d184df; plan:
 * docs/planning/session-novelty-and-pool-diversity.md).
 *
 * RENDERING STATE ONLY — never read by ranking (seam 1). Session tokens are
 * opaque, client-held, zero security weight; rows self-expire via the same
 * 7-day query window the known-set uses (no sweeper needed at current scale;
 * add one if the table's dead-row mass ever matters). No FK to traces: a
 * deleted recipe leaves a harmless orphan row that no longer matches any
 * result, and shown-history must never block trace deletion.
 */

import { uuid, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";

export const sessionShown = claimnetSchema.table(
  "session_shown",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** Opaque session token (shape-validated at the service boundary). */
    sessionId: text("session_id").notNull(),
    /** The recipe whose full text was rendered to this session. */
    traceId: uuid("trace_id").notNull(),

    shownAt: timestamp("shown_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Known-set lookup: all shown ids for a session within the window.
    index("session_shown_session_id_shown_at_idx").on(t.sessionId, t.shownAt.desc()),
    // Idempotent recording: one row per (session, recipe).
    unique("session_shown_session_trace_unique").on(t.sessionId, t.traceId),
  ],
);

export type SessionShownRow = typeof sessionShown.$inferSelect;
export type NewSessionShownRow = typeof sessionShown.$inferInsert;
