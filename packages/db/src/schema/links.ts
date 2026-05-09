/**
 * N:N linking tables between traces, evidence, and references.
 *
 * apiKeyId on trace_evidence and trace_references records which API key
 * created the link. No FK constraint — references api_keys.id cross-table.
 */

import {
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { traces } from "./traces";
import { evidence } from "./evidence";
import { references } from "./references";

// ── trace_evidence ────────────────────────────────────────────────────────────

export const traceEvidence = claimnetSchema.table(
  "trace_evidence",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    traceId: uuid("trace_id").notNull().references(() => traces.id),
    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),

    stance: text("stance").notNull(), // 'for' | 'against'

    apiKeyId: uuid("api_key_id").notNull(), // ref -> api_keys.id (no FK)

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("trace_evidence_trace_id_idx").on(t.traceId),
    index("trace_evidence_evidence_id_idx").on(t.evidenceId),
  ]
);

export type TraceEvidence = typeof traceEvidence.$inferSelect;
export type NewTraceEvidence = typeof traceEvidence.$inferInsert;

// ── trace_references ──────────────────────────────────────────────────────────

export const traceReferences = claimnetSchema.table(
  "trace_references",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    traceId: uuid("trace_id").notNull().references(() => traces.id),
    referenceId: uuid("reference_id").notNull().references(() => references.id),

    apiKeyId: uuid("api_key_id").notNull(), // ref -> api_keys.id (no FK)

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("trace_references_trace_id_idx").on(t.traceId),
    index("trace_references_reference_id_idx").on(t.referenceId),
  ]
);

export type TraceReference = typeof traceReferences.$inferSelect;
export type NewTraceReference = typeof traceReferences.$inferInsert;

// ── evidence_references ───────────────────────────────────────────────────────

export const evidenceReferences = claimnetSchema.table(
  "evidence_references",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
    referenceId: uuid("reference_id").notNull().references(() => references.id),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("evidence_references_evidence_id_idx").on(t.evidenceId),
    index("evidence_references_reference_id_idx").on(t.referenceId),
  ]
);

export type EvidenceReference = typeof evidenceReferences.$inferSelect;
export type NewEvidenceReference = typeof evidenceReferences.$inferInsert;
