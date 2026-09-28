/**
 * Traces — the core content unit in the search-as-logging model.
 *
 * A trace is a structured knowledge claim submitted by an agent or user.
 * userId and groupId are UUID references to claimnet.users and claimnet.groups.
 *
 * The tsvector column for full-text search is added via migration SQL
 * (Drizzle does not support generated columns natively).
 */

import {
  pgSchema,
  uuid,
  text,
  real,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const claimnetSchema = pgSchema("claimnet");

// Forward-declare users and groups tables to avoid circular imports.
// FK constraints for these are established in users.ts and groups.ts respectively.
// We use uuid columns here without .references() to break the circular dependency.
export const traces = claimnetSchema.table(
  "traces",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    userId: uuid("user_id").notNull(),   // FK -> users.id
    groupId: uuid("group_id").notNull(), // FK -> groups.id
    apiKeyId: uuid("api_key_id"), // which agent session created this trace (nullable for pre-existing data)

    claimText: text("claim_text").notNull(),
    claimTextHash: text("claim_text_hash"), // SHA-256 for idempotency check (nullable for pre-existing data)
    formatAdherenceScore: real("format_adherence_score"),

    // When the human originally made this taste/judgment call, if it predates
    // the check (e.g. a decision mined from git history or an old ADR).
    // NULL = the judgment is contemporaneous with the check. created_at stays
    // the insertion time, so the record never claims to have been logged
    // earlier than it was; agent-facing surfaces show
    // COALESCE(decided_at, created_at) as the judgment date.
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    // Opaque client-held session token stamped at deposit (8-64 url-safe
    // chars, validated at the service boundary). Drives known-set stub
    // rendering (token efficiency) only — NEVER ranking; it has no security
    // weight, so there is no sessions table and no server-side validation
    // beyond shape. NULL = pre-session or sessionless deposit. See
    // docs/planning/session-novelty-and-pool-diversity.md.
    sessionId: text("session_id"),

    // Triage ratings (drafts-and-triage slice 1): the depositing agent's own
    // view of how much rides on this call (impact) and how unsure it is of
    // the person's position (uncertainty), each low | medium | high. NULL =
    // not rated — never a stored default (the review queue treats an unrated
    // recipe as medium when it sorts, at read time). Text + service-level
    // validation, the codebase pattern for closed vocabularies
    // (check_feedback, api_keys.key_type); an unrecognized value is stored
    // as NULL with a response notice, never a rejected check (recipe
    // 4cfd166e). Set once at deposit: an idempotent repeat keeps the first
    // ratings. Display and triage only — NEVER read by ranking, clustering,
    // or MMR (self-ratings are unsafe as a relevance signal, recipe
    // ff54eafd); a static test pins that.
    impact: text("impact"),
    uncertainty: text("uncertainty"),

    // Draft state (drafts-and-triage slice 2). NULL = an ordinary recipe,
    // never a draft. Otherwise one of unverified | verified | rejected |
    // not_chosen: a draft is deposited `unverified`, and moves one way to a
    // resolution. Text + service-level validation, the codebase pattern for
    // closed vocabularies. Until verified, a draft is visible only to the
    // person it is about and their agents, and to the depositor; that rule
    // lives once in apps/backend/src/authz/draft-sql.ts (SQL) and roles.ts
    // (`mayReadTrace`), and nothing outside the module writes the condition
    // by hand. A verified draft reads as an ordinary recipe everywhere.
    // NEVER read by ranking, clustering, or MMR (ranking-isolation.test.ts).
    draftState: text("draft_state"),
    // Who resolved the draft and when, set once as draft_state leaves
    // `unverified`. The resolving statement matches only an unverified row
    // (a repeat is a no-op) and writes these itself; an import never
    // supplies them ([F83]). The key is NULL when a person resolved it (a
    // reaction, or an import); set when their agent verified it.
    draftResolvedAt: timestamp("draft_resolved_at", { withTimezone: true }),
    draftResolvedByUserId: uuid("draft_resolved_by_user_id"),
    draftResolvedByKeyId: uuid("draft_resolved_by_key_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("traces_user_id_idx").on(t.userId),
    index("traces_group_id_idx").on(t.groupId),
    index("traces_api_key_id_idx").on(t.apiKeyId),
    index("traces_created_at_idx").on(t.createdAt),
    // Known-set lookup: deposits by session within the recency window.
    index("traces_session_id_created_at_idx").on(t.sessionId, t.createdAt.desc()),
    // Idempotency: same agent + group + claim text = same trace
    unique("traces_api_key_group_claim_unique").on(t.apiKeyId, t.groupId, t.claimTextHash),
    // Judgment-date range queries (recipe search after:/before:, 2026-08-19)
    // and any future recency decay — the display-date convention everywhere
    // is COALESCE(decided_at, created_at), so the index matches it.
    index("traces_judgment_date_idx").using("btree", sql`(COALESCE(${t.decidedAt}, ${t.createdAt}))`),
    // Drafts not yet published (unverified, rejected, not chosen), by the
    // person they are about: small by design. Serves the briefing's
    // "drafts awaiting your review" count and the future review queue.
    // (Vector search probes draft state through the primary key instead;
    // measured in the slice-2 build log.)
    index("traces_unpublished_draft_idx")
      .on(t.userId)
      .where(sql`${t.draftState} IS NOT NULL AND ${t.draftState} <> 'verified'`),
    // tsvector GIN index defined in migration SQL
  ]
);

export type Trace = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;
