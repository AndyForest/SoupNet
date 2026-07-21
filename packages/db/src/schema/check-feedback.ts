/**
 * check_feedback — feedback about prior recipe checks, plus the human
 * ground-truth tables (trace reactions, feedback stars) from the UVP
 * measurement architecture (WT-4 / §Validating the UVP, 2026-07-05).
 *
 * Rows are agent-reported OR human-origin. Exactly one actor is present:
 * `api_key_id` for an agent, `actor_user_id` for a signed-in human, enforced
 * by the check_feedback_one_actor CHECK. Human rows arrived with the
 * re-filing feature (2026-07-09, recipe 465df879): when a human corrects an
 * agent's misfiling of a recipe, that correction is calibration signal — a
 * misfile is an agent misapplying a routing rule the corpus already holds
 * recipes about — so it belongs on the recipe's detail page where agents and
 * humans read it, not only in the append-only audit log.
 *
 * check_feedback wire format starts from the field-proven local JSONL schema
 * v1 (kind / impact / disposition / story_fulfilled enums — see
 * @soupnet/domain feedback.ts for the closed vocabulary), extended with
 * server-stamped columns. Server-derivable context (recipe book, user) is
 * NOT denormalized here — it comes by join through trace_id; the trace
 * already carries group_id and user_id.
 *
 * Enum columns are text + service-level strict validation (matches the
 * codebase pattern for users.role / api_keys.key_type — no pg enum types).
 *
 * Rate limiting: feedback writes get their own per-key budget counted on
 * THIS table via the (api_key_id, created_at DESC) index — deliberately not
 * audit_log, which is F29's rate-limit hot path and must stay fast. Human
 * rows carry a NULL api_key_id and so never enter an agent's budget; they are
 * reachable only behind JWT + verified email.
 *
 * FKs cascade on trace/feedback deletion so trace-delete cleanup doesn't
 * need to know about these tables.
 *
 * Idempotency (2026-07-21, mirrors traces.claim_text_hash — see
 * trace.service.ts): content_hash + the dedup unique index below let
 * identical resubmissions (retries, link-preview unfurlers prefetching a
 * GET /feedback URL) land on ON CONFLICT DO NOTHING and return the original
 * row instead of duplicating it.
 */

import {
  uuid,
  text,
  real,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema, traces } from "./traces";
import { users } from "./users";

export const checkFeedback = claimnetSchema.table(
  "check_feedback",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** The check (trace) this feedback is about. */
    traceId: uuid("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),

    /** The key that submitted the feedback (not necessarily the key that
     *  made the original check). No FK — matches trace_evidence.api_key_id.
     *  NULL when the row is human-origin; see actorUserId. */
    apiKeyId: uuid("api_key_id"),

    /** The signed-in human who submitted the feedback. NULL when the row is
     *  agent-origin. Cascades on account deletion: a user's own words must
     *  not outlive their account, and auth.ts's explicit deletion list has
     *  already proven it won't be updated for new tables. */
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),

    /** Free-text self-reported agent identity (e.g. "a-wt4-checkloop").
     *  Capture only — no dedup behavior until the phase-2 recall evals pass. */
    agentId: text("agent_id"),

    /** Opaque session token the reporting agent presented (2026-07-17) —
     *  joins feedback rows to the check lineage that session produced.
     *  Capture only; shape-validated at the service boundary; NULL for
     *  sessionless or human-origin rows. */
    sessionId: text("session_id"),

    // ── Schema v1 enums (see @soupnet/domain FEEDBACK_* for vocabulary) ──
    kind: text("kind").notNull(),               // check-feedback | operational | outcome
    impact: text("impact").notNull(),           // none | new | subtle | big | operational
    disposition: text("disposition").notNull(), // proceeded | corrected | asked-human | charted-new | deferred
    storyFulfilled: text("story_fulfilled").notNull(), // yes | partial | no | unknown

    /** The agent's user story for the check — why it checked. */
    story: text("story").notNull(),
    /** What the agent did with the result. */
    note: text("note"),

    /** Top similarity the check returned, as the agent saw it (0-1).
     *  Self-reported; the server-observed value lives in the recipe.checked
     *  audit metadata. */
    topSimilarity: real("top_similarity"),

    // Self-reported client identity (refinement over the server-known
    // connection surface).
    model: text("model"),
    harness: text("harness"),
    harnessVersion: text("harness_version"),

    /** Lineage links — traces involved in a correction/reversal arc
     *  (§Validating the UVP Layer 2). */
    relatedTraceIds: uuid("related_trace_ids").array(),

    /** sha256 hex over the validated row's content (fixed field order — see
     *  feedback.service.ts's contentHash construction). Drives the
     *  check_feedback_dedup_unique index below. Nullable: pre-migration rows
     *  are exempt, and Postgres unique indexes treat NULLs as distinct so
     *  NULL never collides with itself. Human-origin rows (actor_user_id
     *  set) never populate this column — see the index comment. */
    contentHash: text("content_hash"),

    /** Server-stamped — the true ingestion time (v1's append-time ambiguity
     *  fix). */
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("check_feedback_trace_id_idx").on(t.traceId),
    // Drives the per-key feedback budget COUNT (mirrors F29's shape on its
    // own table, keeping audit_log's indexed path untouched).
    index("check_feedback_api_key_id_created_at_idx").on(t.apiKeyId, t.createdAt.desc()),
    // Exactly one actor: an agent's key or a human's user id, never both and
    // never neither. Structural, so a future write path can't produce an
    // unattributed row by forgetting to set either column.
    check(
      "check_feedback_one_actor",
      sql`(${t.apiKeyId} IS NULL) <> (${t.actorUserId} IS NULL)`,
    ),
    // Identical agent resubmission (retry, prefetching link-preview bot,
    // re-clicked URL) lands on the conflict and returns the original row;
    // human-origin rows (NULL api_key_id) are deliberately excluded — each
    // human correction is its own event.
    unique("check_feedback_dedup_unique").on(t.apiKeyId, t.traceId, t.contentHash),
  ],
);

export type CheckFeedback = typeof checkFeedback.$inferSelect;
export type NewCheckFeedback = typeof checkFeedback.$inferInsert;

// ── Human reactions (UVP Layer 3) ───────────────────────────────────────────

/** One reaction per user per recipe: still_true | stale | wrong. Upserted —
 *  the latest click wins. The calibration signal for self-graded confirms
 *  and the explicit input for future stigmergic decay. */
export const traceReactions = claimnetSchema.table(
  "trace_reactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    traceId: uuid("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    // FK cascade (matches invitations.inviter_id): account deletion must
    // also remove the user's reactions on OTHER users' shared-book traces —
    // the trace FK only covers reactions on their own (deleted) traces, and
    // auth.ts's explicit deletion list doesn't touch this table.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    reaction: text("reaction").notNull(), // still_true | stale | wrong

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("trace_reactions_trace_id_idx").on(t.traceId),
    unique("trace_reactions_trace_user_unique").on(t.traceId, t.userId),
  ],
);

export type TraceReactionRow = typeof traceReactions.$inferSelect;
export type NewTraceReactionRow = typeof traceReactions.$inferInsert;

/** "This one mattered" star on a feedback row — row existence is the star;
 *  unstar deletes. Starred checks are the human-endorsed narrative seeds. */
export const checkFeedbackStars = claimnetSchema.table(
  "check_feedback_stars",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => checkFeedback.id, { onDelete: "cascade" }),
    // FK cascade — same rationale as trace_reactions.user_id: stars on
    // feedback attached to other users' traces must not outlive the account.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("check_feedback_stars_feedback_id_idx").on(t.feedbackId),
    unique("check_feedback_stars_feedback_user_unique").on(t.feedbackId, t.userId),
  ],
);

export type CheckFeedbackStar = typeof checkFeedbackStars.$inferSelect;
export type NewCheckFeedbackStar = typeof checkFeedbackStars.$inferInsert;
