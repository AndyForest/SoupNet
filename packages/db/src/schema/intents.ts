/**
 * intents + intent_shown — the declared-intent mechanism (cold-start v2
 * Phase C; operator rulings 2026-08-23, soupnet-oss recipes 363e3e0c
 * always-new-registration and 5c55327d session-supersession).
 *
 * An intent is an agent's forward-declared task story ("As a [role] working
 * on [goal], I want my agent to ...") registered at briefing/check/search
 * time. The id is client-carried (`int_` + 24 base62 chars — the prefix
 * makes text-vs-id discrimination exact, unlike the session token's bare
 * shape) and joins later checks, searches, and feedback rows into one
 * lineage: declared intent → deliveries → fulfillment.
 *
 * ALWAYS-NEW REGISTRATION — deliberately no content-hash dedup: two agent
 * sessions phrasing an intent identically (template-shaped discovery
 * stories make this likely) must never merge into one delivery ledger and
 * cross-stub each other's results. An agent that loses its id to context
 * compaction re-registers and gets a fresh intent — stubs reset, full text
 * again, the same safe semantics as omitting session_id. The registration
 * rate budget (intent.service.ts), not dedup, is the abuse guard.
 *
 * intent_shown mirrors session_shown's posture exactly: RENDERING STATE
 * ONLY — never read by ranking (seam 1, recipes 9067ca1b/4d25aec9); rows
 * self-expire via the same 7-day query window; no FK to traces so shown
 * history never blocks trace deletion.
 *
 * Retention note: `story` is agent-authored free text retained indefinitely
 * for now — the same posture as check.searched.metadata.filter, tracked in
 * the audit-retention backlog decision.
 */

import { uuid, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { users } from "./users";

export const intents = claimnetSchema.table(
  "intents",
  {
    /** `int_` + 24 base62 chars, minted app-side (intent.service.ts). */
    id: text("id").primaryKey(),

    /** Owning user (the key's user). Every join checks ownership — a
     *  cross-user id resolves to the uniform not-found marker. Cascade on
     *  user deletion (erasure completeness, like check_feedback). */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Capture-only provenance, same posture as check_feedback's columns:
     *  no FKs (keys rotate daily and delete; agent ids are free text). */
    apiKeyId: uuid("api_key_id"),
    agentId: text("agent_id"),

    /** The declared task story — user-story-shaped free text. */
    story: text("story").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Touched on every join — the recency signal for future TTL sweeps. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Registration budget COUNT (own table, never audit_log — F29's hot
    // path stays untaxed; same pattern as check_feedback's budget index).
    index("intents_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const intentShown = claimnetSchema.table(
  "intent_shown",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** The intent this delivery belongs to. Cascade: deleting an intent
     *  (future TTL sweep) drops its ledger with it. */
    intentId: text("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    /** The recipe whose full text was rendered against this intent.
     *  Deliberately NO FK to traces (session_shown precedent). */
    traceId: uuid("trace_id").notNull(),

    shownAt: timestamp("shown_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("intent_shown_intent_id_shown_at_idx").on(t.intentId, t.shownAt.desc()),
    unique("intent_shown_intent_trace_unique").on(t.intentId, t.traceId),
  ],
);

export type IntentRow = typeof intents.$inferSelect;
export type NewIntentRow = typeof intents.$inferInsert;
export type IntentShownRow = typeof intentShown.$inferSelect;
export type NewIntentShownRow = typeof intentShown.$inferInsert;
