import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { MOVE_FEEDBACK } from "@soupnet/domain";
import { deleteEmbeddingChainForSource } from "./trace-delete.service.js";

/**
 * Re-file a trace into a different recipe book.
 *
 * THE LOAD-BEARING DETAIL: vector search scopes by `embedding_sources.group_id`
 * (vector-search.service.ts — trace predicate and evidence predicate both), NOT
 * by `traces.group_id`. `embedding_sources.group_id` is an unenforced cache of
 * the owning trace's book. Update `traces.group_id` alone and the recipe stays
 * searchable in the old book and is invisible in the new one, silently and
 * forever. Both are updated here, in one transaction. No re-embedding is
 * needed: vectors are derived from content, not from the book.
 *
 * Redaction: moving a recipe from a private book into a shared one is a
 * declassification step (recipe 2738f7a9). The human may de-select evidence
 * entries that shouldn't cross the boundary; those are hard-deleted, along with
 * any reference they were the last link to — the same pruning a trace delete
 * performs. Redaction is irreversible and costs the recipe that warrant.
 *
 * Human-only. There is no agent-facing surface for this (recipes aaad8fdf,
 * 4b97ba86); the route sits behind JWT + verified email.
 */

export class TraceMoveNotFoundError extends Error {
  constructor() {
    super("Trace not found");
    this.name = "TraceMoveNotFoundError";
  }
}

export class TraceMoveSameBookError extends Error {
  constructor() {
    super("Trace is already in that recipe book");
    this.name = "TraceMoveSameBookError";
  }
}

export class TraceMoveDuplicateError extends Error {
  constructor() {
    super("An identical recipe from the same agent already exists in that recipe book");
    this.name = "TraceMoveDuplicateError";
  }
}

export class TraceMoveEvidenceNotFoundError extends Error {
  constructor() {
    super("One or more evidence entries do not belong to this trace");
    this.name = "TraceMoveEvidenceNotFoundError";
  }
}

export interface TraceMoveOptions {
  db: PostgresJsDatabase;
  traceId: string;
  destGroupId: string;
  /** Rendered into the human-origin feedback row. Never the SOURCE book name. */
  destBookName: string;
  actorUserId: string;
  /** Evidence entries the human de-selected. Hard-deleted, not hidden. */
  dropEvidenceIds?: string[] | undefined;
  /** The human's correction note, pre-filled client-side then edited. */
  story?: string | undefined;
}

export interface TraceMoveResult {
  ok: true;
  traceId: string;
  fromGroupId: string;
  toGroupId: string;
  evidenceMoved: number;
  evidenceRedacted: number;
  referencesRedacted: number;
  feedbackId: string | null;
}

/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps driver errors in DrizzleQueryError, so the postgres-js
 * PostgresError carrying `code` sits on `.cause`. Walk the chain rather than
 * checking the top-level error, which never has it.
 */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (
      typeof cur === "object" &&
      "code" in cur &&
      (cur as { code?: unknown }).code === PG_UNIQUE_VIOLATION
    ) {
      return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export async function moveTraceToBook(
  opts: TraceMoveOptions,
): Promise<TraceMoveResult> {
  const { db, traceId, destGroupId, destBookName, actorUserId } = opts;
  const dropEvidenceIds = opts.dropEvidenceIds ?? [];

  try {
    return await db.transaction(async (tx) => {
      // Lock the trace: two concurrent moves of the same recipe must serialize,
      // or both could pass the same-book guard and race on the unique index.
      const traceRows = await tx.execute(sql`
        SELECT group_id AS "groupId" FROM claimnet.traces
        WHERE id = ${traceId}::uuid
        FOR UPDATE
      `);
      const trace = (traceRows as unknown as Array<{ groupId: string }>)[0];
      if (!trace) throw new TraceMoveNotFoundError();

      const fromGroupId = trace.groupId;
      if (fromGroupId === destGroupId) throw new TraceMoveSameBookError();

      // Every evidence row linked to this trace.
      const evidenceRows = await tx.execute(sql`
        SELECT evidence_id AS "id" FROM claimnet.trace_evidence
        WHERE trace_id = ${traceId}::uuid
      `);
      const allEvidenceIds = (
        evidenceRows as unknown as Array<{ id: string }>
      ).map((r) => r.id);

      const dropSet = new Set(dropEvidenceIds);
      for (const id of dropSet) {
        if (!allEvidenceIds.includes(id)) {
          throw new TraceMoveEvidenceNotFoundError();
        }
      }

      // ── Redact de-selected evidence ────────────────────────────────────────
      let evidenceRedacted = 0;
      let referencesRedacted = 0;

      for (const evidenceId of dropSet) {
        const refRows = await tx.execute(sql`
          SELECT reference_id AS "id" FROM claimnet.evidence_references
          WHERE evidence_id = ${evidenceId}::uuid
        `);
        const refIds = (refRows as unknown as Array<{ id: string }>).map((r) => r.id);

        await tx.execute(sql`
          DELETE FROM claimnet.trace_evidence
          WHERE trace_id = ${traceId}::uuid AND evidence_id = ${evidenceId}::uuid
        `);

        // trace_evidence is N:N. Evidence is trace-private in practice today
        // (insertEvidenceEntries always writes fresh rows), but a row shared
        // with another trace must survive — unlinking is all we may do.
        const stillLinked = await tx.execute(sql`
          SELECT 1 FROM claimnet.trace_evidence
          WHERE evidence_id = ${evidenceId}::uuid LIMIT 1
        `);
        if ((stillLinked as unknown as unknown[]).length > 0) continue;

        await tx.execute(sql`
          DELETE FROM claimnet.evidence_references WHERE evidence_id = ${evidenceId}::uuid
        `);
        await deleteEmbeddingChainForSource(tx, "evidence", evidenceId);
        await tx.execute(sql`
          DELETE FROM claimnet.evidence WHERE id = ${evidenceId}::uuid
        `);
        evidenceRedacted++;

        // Prune references this evidence was the last link to.
        for (const referenceId of refIds) {
          const linkedTrace = await tx.execute(sql`
            SELECT 1 FROM claimnet.trace_references
            WHERE reference_id = ${referenceId}::uuid LIMIT 1
          `);
          if ((linkedTrace as unknown as unknown[]).length > 0) continue;

          const linkedEvidence = await tx.execute(sql`
            SELECT 1 FROM claimnet.evidence_references
            WHERE reference_id = ${referenceId}::uuid LIMIT 1
          `);
          if ((linkedEvidence as unknown as unknown[]).length > 0) continue;

          await deleteEmbeddingChainForSource(tx, "reference", referenceId);
          await tx.execute(sql`
            DELETE FROM claimnet.references WHERE id = ${referenceId}::uuid
          `);
          referencesRedacted++;
        }
      }

      // ── Move the trace ─────────────────────────────────────────────────────
      // updated_at feeds the map's corpus-version cache key. Without the bump,
      // a move between two books the map already spans is invisible to it.
      await tx.execute(sql`
        UPDATE claimnet.traces
        SET group_id = ${destGroupId}::uuid, updated_at = now()
        WHERE id = ${traceId}::uuid
      `);

      await tx.execute(sql`
        UPDATE claimnet.embedding_sources
        SET group_id = ${destGroupId}::uuid
        WHERE source_type = 'trace' AND source_id = ${traceId}::uuid
      `);

      // Only evidence still linked to this trace AND to no other trace. A row
      // shared with a trace that stays behind must keep the old book's scope.
      const survivingRows = await tx.execute(sql`
        SELECT te.evidence_id AS "id"
        FROM claimnet.trace_evidence te
        WHERE te.trace_id = ${traceId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM claimnet.trace_evidence other
            WHERE other.evidence_id = te.evidence_id
              AND other.trace_id <> ${traceId}::uuid
          )
      `);
      const survivingEvidenceIds = (
        survivingRows as unknown as Array<{ id: string }>
      ).map((r) => r.id);

      if (survivingEvidenceIds.length > 0) {
        await tx.execute(sql`
          UPDATE claimnet.embedding_sources
          SET group_id = ${destGroupId}::uuid
          WHERE source_type = 'evidence'
            AND source_id IN (${sql.join(
              survivingEvidenceIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
        `);
      }

      // ── The human's correction, as first-class feedback ────────────────────
      const story =
        opts.story?.trim() ||
        `As the owner of this recipe book, I re-filed this recipe into ${destBookName}.`;

      const noteParts = [`Re-filed into ${destBookName}.`];
      if (evidenceRedacted > 0) {
        noteParts.push(
          `${evidenceRedacted} evidence ${
            evidenceRedacted === 1 ? "entry" : "entries"
          } removed before the move.`,
        );
      }

      const feedbackRows = await tx.execute(sql`
        INSERT INTO claimnet.check_feedback
          (trace_id, api_key_id, actor_user_id, kind, impact, disposition,
           story_fulfilled, story, note)
        VALUES (
          ${traceId}::uuid, NULL, ${actorUserId}::uuid,
          ${MOVE_FEEDBACK.kind}, ${MOVE_FEEDBACK.impact}, ${MOVE_FEEDBACK.disposition},
          ${MOVE_FEEDBACK.storyFulfilled}, ${story}, ${noteParts.join(" ")}
        )
        RETURNING id
      `);
      const feedbackId =
        (feedbackRows as unknown as Array<{ id: string }>)[0]?.id ?? null;

      return {
        ok: true as const,
        traceId,
        fromGroupId,
        toGroupId: destGroupId,
        evidenceMoved: survivingEvidenceIds.length,
        evidenceRedacted,
        referencesRedacted,
        feedbackId,
      };
    });
  } catch (err) {
    // traces_api_key_group_claim_unique is (api_key_id, group_id,
    // claim_text_hash) — group_id is part of the idempotency key, so moving a
    // recipe into a book where the same agent already checked the same claim
    // is a duplicate, not a server error.
    if (isUniqueViolation(err)) throw new TraceMoveDuplicateError();
    throw err;
  }
}
