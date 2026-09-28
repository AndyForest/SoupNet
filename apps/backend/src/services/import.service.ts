/**
 * Corpus import — the inverse of GET /auth/me/export.
 * See docs/planning/corpus-import.md for the full brief.
 *
 * The rule (recipe 5d541d2c, 2026-09-27): import only creates rows; links
 * only connect rows within the same file; existing ids are always skipped or
 * given fresh ones. Nothing import writes ever changes, reuses, or links into
 * a row that existed before it ran, so no ownership lookup decides anything.
 *
 * Shape of the operation:
 *   1. Resolve the destination recipe book (existing writable book, or a new
 *      book created lazily — only when the import actually inserts something).
 *   2. ONE all-or-nothing transaction, chunked batch inserts (500 rows per
 *      statement). A failed import rolls back completely, and because the
 *      import is idempotent, re-uploading the same file IS the resume path.
 *   3. Embeddings stay OFF the write path (design point 2). Imported traces
 *      are discovered by the embedding worker's strategy sweep; imported
 *      evidence gets pending stubs here because the sweep only discovers trace
 *      sources. Both resolve from the content-addressed vector_cache first
 *      (recipe 8ba10d32).
 *
 * Where each file row lands:
 *   - A trace whose id is new to the server → inserted under that id.
 *   - A trace whose id is the importer's own ordinary recipe → kept as it is:
 *     skipped-identical, or a reported conflict when its content differs.
 *   - An evidence or reference row is written only when a row this import
 *     creates links to it ([F103]), under its id when that is new. One
 *     nothing created links to is kept when its id exists (skipped-existing)
 *     and otherwise not written (orphaned).
 *   - Anything else that exists (someone else's recipe, a draft about someone
 *     else, evidence a created recipe of this file links to) → a fresh id: the
 *     importer's deterministic mint, mintImportId(userId, id), when that is
 *     free; otherwise the mint is kept in the same way as the file id, or a
 *     random id when it cannot be kept ([F100]).
 *   - A row about someone else (onBehalfOf) → always a random id ([F96]).
 *   The mint keeps a re-import idempotent (it derives the same ids, which are
 *   then kept) and parallel importers of one corpus disjoint (recipe
 *   c40fd228). The old→new mapping is returned in `idMap`.
 *
 * Links: a link row is written only when both of its rows were created by
 * this import, after the id remap. A link between two kept rows is counted
 * skipped-existing; a link with any other endpoint (a kept row beside a new
 * one, or an id absent from the file) is counted orphaned. No link is ever
 * written onto a row that existed before the import.
 *
 * Prompt-injection posture (design point 3): everything in the file is stored
 * as data via parameterized inserts; nothing is interpreted, executed, or fed
 * to a model during import.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mintImportId } from "../lib/deterministic-id.js";

import {
  traces as tracesTable,
  evidence as evidenceTable,
  references as referencesTable,
  traceEvidence as traceEvidenceTable,
  traceReferences as traceReferencesTable,
  evidenceReferences as evidenceReferencesTable,
  groups as groupsTable,
  groupMembers as groupMembersTable,
  embeddingSources as embeddingSourcesTable,
  embeddingChunkStrategies as embeddingChunkStrategiesTable,
  embeddingChunks as embeddingChunksTable,
  embeddingVectors as embeddingVectorsTable,
} from "@soupnet/db";
import { getEmbeddingModelId } from "../lib/embeddings/provider";
import { normalizeOnBehalfOf, resolveNameableSubject, onBehalfSubjectOf } from "../authz";
import { onBehalfRefusal } from "@soupnet/domain";
import type {
  ParsedExport,
  ImportTraceRow,
  ImportEvidenceRow,
  ImportReferenceRow,
  ImportTraceEvidenceRow,
  ImportTraceReferenceRow,
  ImportEvidenceReferenceRow,
} from "./import-validate";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ImportOptions {
  userId: string;
  /** Existing destination book (slug or UUID) the user is a member of.
   *  Omitted = create a new book (the default, per design point 5). */
  targetBook?: string | undefined;
  /** Name for the new book when one is created. */
  newBookName?: string | undefined;
}

export interface ImportConflict {
  entity: "trace";
  id: string;
  fields: string[];
  kept: "existing";
}

/** Old→new id remap for a file row that landed under a fresh id. Consumers
 *  holding the export's original ids (e.g. a citation index) use this to
 *  follow the rows into the importer's corpus. Deterministic except for
 *  on-behalf rows and the rare random fallback. */
export interface ImportIdRemap {
  entity: "trace" | "evidence" | "reference";
  from: string;
  to: string;
}

export interface ImportResult {
  book: { id: string; name: string; slug: string; created: boolean } | null;
  counts: {
    traces: {
      inserted: number;
      skippedIdentical: number;
      conflicted: number;
      /** File rows that landed under (or were kept at) a fresh id. On a first
       *  import these are a subset of `inserted`; on a re-import the same
       *  minted ids are kept, so they land in `skippedIdentical` instead.
       *  `idMap` carries the old→new detail. */
      remapped: number;
    };
    /** `orphaned`: file rows nothing this import creates links to and whose
     *  id is new, so they were not written ([F103]). */
    evidence: { inserted: number; skippedExisting: number; orphaned: number; remapped: number };
    references: { inserted: number; skippedExisting: number; orphaned: number; remapped: number };
    links: { inserted: number; skippedExisting: number; orphaned: number };
  };
  /** Per-row collision detail for kept traces, capped at MAX_CONFLICT_DETAIL. */
  conflicts: ImportConflict[];
  conflictsTotal: number;
  idMap: ImportIdRemap[];
  embeddings: {
    /** Evidence rows queued with pending vector stubs in this import. */
    evidenceQueued: number;
    /** Traces the worker sweep will discover and embed asynchronously. */
    tracesPendingBackfill: number;
    note: string;
  };
  originalBooks: Array<{ groupId: string; name: string | null; slug: string | null; mappedTo: string | null }>;
}

export class ImportError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

const CHUNK = 500;

/** Rows decided "create" were not all created: a concurrent import (or a row
 *  planted at the importer's mint while this one ran) claimed some of their
 *  ids first. The whole import rolls back ([F102]); a retry sees those rows
 *  and gives the file's rows fresh ids, so re-uploading stays the resume
 *  path and no run ever gets a 200 with rows silently missing. */
function claimedConcurrently(): ImportError {
  return new ImportError(
    409,
    "Another import claimed some of this file's ids while it ran, so nothing was imported. Retry with the same file: the retry gives those rows their own ids.",
  );
}
const MAX_CONFLICT_DETAIL = 200;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

function* chunks<T>(rows: T[], size: number = CHUNK): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) {
    yield rows.slice(i, i + size);
  }
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

interface ExistingTrace {
  userId: string;
  claimText: string;
  decidedAt: Date | null;
  /** Set on a draft someone deposited about another person (slice 4). */
  subjectUserId: string | null;
}

/** Where a file row lands: `id` is its id after the remap; `create` says
 *  whether import inserts it there or keeps the existing row. */
interface Landing {
  id: string;
  create: boolean;
  /** An evidence or reference row that is neither created nor kept ([F103]). */
  dropped?: true;
}

/** Existing traces among `ids`, with what classification needs. */
async function loadTraces(tx: PostgresJsDatabase, ids: string[]): Promise<Map<string, ExistingTrace>> {
  const found = new Map<string, ExistingTrace>();
  for (const chunk of chunks(ids)) {
    const rows = await tx.execute(sql`
      SELECT t.id, t.user_id AS "userId", t.claim_text AS "claimText",
             t.decided_at AS "decidedAt", ${onBehalfSubjectOf("t")} AS "subjectUserId"
      FROM claimnet.traces t
      WHERE t.id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    for (const r of rows as unknown as Array<ExistingTrace & { id: string; decidedAt: string | Date | null }>) {
      found.set(r.id, { ...r, decidedAt: r.decidedAt === null ? null : new Date(r.decidedAt) });
    }
  }
  return found;
}

/** The subset of `ids` that exist in `table` (evidence or references). */
async function existingIds(
  tx: PostgresJsDatabase,
  table: "evidence" | "references",
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const from = table === "evidence" ? sql`claimnet.evidence` : sql`claimnet.references`;
  for (const chunk of chunks(ids)) {
    const rows = await tx.execute(sql`
      SELECT id FROM ${from}
      WHERE id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    for (const r of rows as unknown as Array<{ id: string }>) found.add(r.id);
  }
  return found;
}

/**
 * Where an evidence or reference row lands. It is created only when a row
 * this import creates links to it, so every content row import writes is
 * reachable from a recipe and goes when that recipe goes ([F103]): under its
 * id when that is new to the server, else the importer's mint when that is
 * free, else a random id ([F100]). A row nothing created links to is not
 * written: it is kept when its id exists (skipped-existing), and otherwise
 * dropped and counted orphaned.
 */
function landContent(id: string, userId: string, exists: Set<string>, linkedByCreated: boolean): Landing {
  if (!linkedByCreated) return exists.has(id) ? { id, create: false } : { id, create: false, dropped: true };
  if (!exists.has(id)) return { id, create: true };
  const mint = mintImportId(userId, id);
  return exists.has(mint) ? { id: crypto.randomUUID(), create: true } : { id: mint, create: true };
}

/** The exact evidence-embedding text the check path produces
 *  (trace.service.ts insertEvidenceEntries) — byte-identical reconstruction
 *  means a re-imported corpus hits the vector_cache instead of the provider. */
function buildEvidenceEmbeddingText(
  traceText: string,
  interpretation: string,
  quote: string | null,
  source: string | null,
): string {
  return [
    `Recipe context: "${traceText}"`,
    `Supporting evidence: ${interpretation}`,
    quote ? `> "${quote}"` : "",
    source ? `-- ${source}` : "",
  ].filter(Boolean).join("\n");
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function importCorpus(
  db: PostgresJsDatabase,
  parsed: ParsedExport,
  opts: ImportOptions,
): Promise<ImportResult> {
  const { userId } = opts;

  // Resolve an EXISTING destination book up front so a bad `book` param fails
  // before any heavy work. New-book creation is deferred into the transaction
  // and only happens if the import actually inserts rows (a fully-skipped
  // re-import must not litter empty books).
  let destination: { id: string; name: string; slug: string; created: boolean } | null = null;
  if (opts.targetBook) {
    destination = { ...(await resolveWritableBook(db, opts.targetBook, userId)), created: false };
  }

  const conflicts: ImportConflict[] = [];
  let conflictsTotal = 0;

  const result = await db.transaction(async (tx) => {
    const idMap: ImportIdRemap[] = [];

    // ── 1. Traces ─────────────────────────────────────────────────────────
    // Kept only when the id is the importer's own ordinary recipe. A draft
    // they deposited about someone else is not theirs to keep or extend
    // ([F92], [F97]): its text and evidence are what its subject reviews.
    const existingTraces = await loadTraces(tx, parsed.traces.flatMap((t) => [t.id, mintImportId(userId, t.id)]));
    const keepable = (id: string): ExistingTrace | undefined => {
      const ex = existingTraces.get(id);
      return ex && ex.userId === userId && !ex.subjectUserId ? ex : undefined;
    };
    const traceLanding = new Map<string, Landing>();
    const tracesToInsert: ImportTraceRow[] = [];
    let skippedIdentical = 0;
    let conflicted = 0;
    for (const t of parsed.traces) {
      let landing: Landing;
      if (normalizeOnBehalfOf(t.onBehalfOf).present) {
        // A row about someone else never lands under a client-chosen or
        // deterministic id ([F96]): a delete-then-reimport would put new text
        // behind the id its subject is reviewing. The cost: re-importing such
        // a file adds the rows again.
        landing = { id: crypto.randomUUID(), create: true };
      } else if (!existingTraces.has(t.id)) {
        landing = { id: t.id, create: true };
      } else if (keepable(t.id)) {
        landing = { id: t.id, create: false };
      } else {
        const mint = mintImportId(userId, t.id);
        if (!existingTraces.has(mint)) landing = { id: mint, create: true };
        else if (keepable(mint)) landing = { id: mint, create: false };
        else landing = { id: crypto.randomUUID(), create: true }; // [F100]
      }
      traceLanding.set(t.id, landing);
      if (landing.id !== t.id) idMap.push({ entity: "trace", from: t.id, to: landing.id });
      if (landing.create) {
        tracesToInsert.push({ ...t, id: landing.id });
        continue;
      }
      const existing = existingTraces.get(landing.id)!;
      const fields: string[] = [];
      if (existing.claimText !== t.claimText) fields.push("claimText");
      if (!sameInstant(existing.decidedAt, t.decidedAt)) fields.push("decidedAt");
      if (fields.length === 0) {
        skippedIdentical++;
      } else {
        conflicted++;
        conflictsTotal++;
        if (conflicts.length < MAX_CONFLICT_DETAIL) conflicts.push({ entity: "trace", id: landing.id, fields, kept: "existing" });
      }
    }
    const traceCreatedFromFile = (fileId: string): boolean => {
      const l = traceLanding.get(fileId);
      return !!l && l.create;
    };

    // ── 2. Evidence, then references ──────────────────────────────────────
    const existingEvidence = await existingIds(tx, "evidence", parsed.evidence.flatMap((e) => [e.id, mintImportId(userId, e.id)]));
    const evidenceLinkedByCreated = new Set(
      parsed.traceEvidence.filter((l) => traceCreatedFromFile(l.traceId)).map((l) => l.evidenceId),
    );
    const evidenceLanding = new Map<string, Landing>();
    const evidenceToInsert: ImportEvidenceRow[] = [];
    for (const e of parsed.evidence) {
      const landing = landContent(e.id, userId, existingEvidence, evidenceLinkedByCreated.has(e.id));
      evidenceLanding.set(e.id, landing);
      if (landing.id !== e.id) idMap.push({ entity: "evidence", from: e.id, to: landing.id });
      if (landing.create) evidenceToInsert.push({ ...e, id: landing.id });
    }
    const evidenceCreatedFromFile = (fileId: string): boolean => {
      const l = evidenceLanding.get(fileId);
      return !!l && l.create;
    };

    const existingReferences = await existingIds(tx, "references", parsed.references.flatMap((r) => [r.id, mintImportId(userId, r.id)]));
    const referencesLinkedByCreated = new Set([
      ...parsed.traceReferences.filter((l) => traceCreatedFromFile(l.traceId)).map((l) => l.referenceId),
      ...parsed.evidenceReferences.filter((l) => evidenceCreatedFromFile(l.evidenceId)).map((l) => l.referenceId),
    ]);
    const referenceLanding = new Map<string, Landing>();
    const referencesToInsert: ImportReferenceRow[] = [];
    for (const r of parsed.references) {
      const landing = landContent(r.id, userId, existingReferences, referencesLinkedByCreated.has(r.id));
      referenceLanding.set(r.id, landing);
      if (landing.id !== r.id) idMap.push({ entity: "reference", from: r.id, to: landing.id });
      if (landing.create) referencesToInsert.push({ ...r, id: landing.id });
    }

    // ── 3. Resolve/create destination book (lazily for the new-book default) ──
    let dest = destination;
    const willWrite = tracesToInsert.length > 0 || evidenceToInsert.length > 0 || referencesToInsert.length > 0;
    if (!dest && willWrite) {
      dest = await createImportBook(tx, userId, opts.newBookName);
    }

    // ── 4. Insert traces (chunked batches; explicit ids + timestamps) ──────
    // Every insert must return every row it was given; a row claimed by a
    // concurrent import fails the whole import with a retryable 409 ([F102]).
    const insertedTraceIds = new Set<string>();
    if (tracesToInsert.length > 0) {
      if (!dest) throw new ImportError(500, "internal: destination book unresolved");
      const destId = dest.id;
      // On behalf of (slice 4, S4-E2): a row naming someone other than the
      // importer goes through the deposit's naming rule against the
      // destination book. Accepted, it is restored as an unverified draft
      // about that person whatever state the file carries, since only they
      // resolve it; otherwise the import is refused with the uniform naming
      // answer and nothing is stored (the transaction rolls back).
      const subjectOf = new Map<string, string | null>();
      for (const t of tracesToInsert) {
        const naming = normalizeOnBehalfOf(t.onBehalfOf);
        if (!naming.present || subjectOf.has(naming.email)) continue;
        const named = await resolveNameableSubject(tx, { email: naming.email, bookId: destId });
        if (!named) throw new ImportError(400, `A recipe in the file: ${onBehalfRefusal(dest.slug)}`);
        subjectOf.set(naming.email, named.userId === userId ? null : named.userId);
      }
      const subjectFor = (t: ImportTraceRow): string | null => {
        const naming = normalizeOnBehalfOf(t.onBehalfOf);
        return naming.present ? subjectOf.get(naming.email) ?? null : null;
      };
      for (const chunk of chunks(tracesToInsert)) {
        const rows = await tx
          .insert(tracesTable)
          .values(chunk.map((t) => {
            const subjectUserId = subjectFor(t);
            // An on-behalf row is always an unverified draft (S4-E2), and the
            // importer is its author and depositor (S4-E3).
            const draftState = subjectUserId ? "unverified" : t.draftState;
            return {
            id: t.id,
            userId,
            groupId: destId,
            // NULL api_key_id: imports are a human-only control, and NULL also
            // exempts these rows from traces_api_key_group_claim_unique —
            // idempotency for imports is by trace id, not the agent
            // (key, book, text-hash) constraint.
            apiKeyId: null,
            claimText: t.claimText,
            claimTextHash: t.claimTextHash ?? sha256(t.claimText),
            formatAdherenceScore: t.formatAdherenceScore,
            decidedAt: t.decidedAt,
            // Ratings and draft state are restored (DT-VIS-16): a draft
            // exported and re-imported is still a draft.
            impact: t.impact,
            uncertainty: t.uncertainty,
            draftState,
            subjectUserId,
            // Resolution attribution and time are never taken from the file
            // ([F83]): an imported resolved draft is resolved by the importer,
            // now (an import is a human control, so no key); an unverified one
            // carries none, so a later real verification writes its own.
            ...(draftState !== null && draftState !== "unverified"
              ? { draftResolvedAt: new Date(), draftResolvedByUserId: userId, draftResolvedByKeyId: null }
              : { draftResolvedAt: null, draftResolvedByUserId: null, draftResolvedByKeyId: null }),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt ?? t.createdAt,
            };
          }))
          .onConflictDoNothing()
          .returning({ id: tracesTable.id });
        if (rows.length < chunk.length) throw claimedConcurrently();
        for (const r of rows) insertedTraceIds.add(r.id);
      }
    }

    // ── 5. Insert evidence + references ──────────────────────────────────
    const insertedEvidenceIds = new Set<string>();
    for (const chunk of chunks(evidenceToInsert)) {
      const rows = await tx
        .insert(evidenceTable)
        .values(chunk.map((e) => ({
          id: e.id,
          content: e.content,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt ?? e.createdAt,
        })))
        .onConflictDoNothing()
        .returning({ id: evidenceTable.id });
      if (rows.length < chunk.length) throw claimedConcurrently();
      for (const r of rows) insertedEvidenceIds.add(r.id);
    }

    const insertedReferenceIds = new Set<string>();
    for (const chunk of chunks(referencesToInsert)) {
      const rows = await tx
        .insert(referencesTable)
        .values(chunk.map((r) => ({
          id: r.id,
          quote: r.quote,
          source: r.source,
          fileUrl: r.fileUrl,
          fileMimeType: r.fileMimeType,
          fileHash: r.fileHash,
          createdAt: r.createdAt,
        })))
        .onConflictDoNothing()
        .returning({ id: referencesTable.id });
      if (rows.length < chunk.length) throw claimedConcurrently();
      for (const r of rows) insertedReferenceIds.add(r.id);
    }

    // ── 6. Links: only between rows this import created ───────────────────
    let linksInserted = 0;
    let linksSkipped = 0;
    let linksOrphaned = 0;
    /** The link's fate from its two endpoint landings (undefined = the id is
     *  not a row of this file). Returns the remapped endpoint ids when the
     *  link is to be written. */
    const classify = (
      a: Landing | undefined,
      aInserted: Set<string>,
      b: Landing | undefined,
      bInserted: Set<string>,
    ): [string, string] | null => {
      if (a && b && aInserted.has(a.id) && bInserted.has(b.id)) return [a.id, b.id];
      if (a && b && !a.create && !b.create && !a.dropped && !b.dropped) linksSkipped++;
      else linksOrphaned++;
      return null;
    };
    // Every written link gets a fresh id ([F101]). A link table's only key
    // is its id, so keeping the file's id would let a row someone else
    // created under it silently suppress the link. Idempotency does not need
    // link ids: on a re-import both endpoints are kept and the link is
    // counted skipped before any insert.
    const linkId = (): string => crypto.randomUUID();

    const teRows: ImportTraceEvidenceRow[] = [];
    for (const l of parsed.traceEvidence) {
      const ends = classify(traceLanding.get(l.traceId), insertedTraceIds, evidenceLanding.get(l.evidenceId), insertedEvidenceIds);
      if (!ends) continue;
      teRows.push({ ...l, id: linkId(), traceId: ends[0], evidenceId: ends[1] });
    }
    for (const chunk of chunks(teRows)) {
      const rows = await tx
        .insert(traceEvidenceTable)
        .values(chunk.map((l) => ({
          id: l.id,
          traceId: l.traceId,
          evidenceId: l.evidenceId,
          stance: l.stance,
          // NOT NULL, no FK — preserve provenance from the file; a zero UUID
          // stands in when a hand-trimmed file dropped it.
          apiKeyId: l.apiKeyId ?? ZERO_UUID,
          createdAt: l.createdAt,
        })))
        .onConflictDoNothing()
        .returning({ id: traceEvidenceTable.id });
      linksInserted += rows.length;
      linksSkipped += chunk.length - rows.length;
    }

    const trRows: ImportTraceReferenceRow[] = [];
    for (const l of parsed.traceReferences) {
      const ends = classify(traceLanding.get(l.traceId), insertedTraceIds, referenceLanding.get(l.referenceId), insertedReferenceIds);
      if (!ends) continue;
      trRows.push({ ...l, id: linkId(), traceId: ends[0], referenceId: ends[1] });
    }
    for (const chunk of chunks(trRows)) {
      const rows = await tx
        .insert(traceReferencesTable)
        .values(chunk.map((l) => ({
          id: l.id,
          traceId: l.traceId,
          referenceId: l.referenceId,
          apiKeyId: l.apiKeyId ?? ZERO_UUID,
          createdAt: l.createdAt,
        })))
        .onConflictDoNothing()
        .returning({ id: traceReferencesTable.id });
      linksInserted += rows.length;
      linksSkipped += chunk.length - rows.length;
    }

    const erRows: ImportEvidenceReferenceRow[] = [];
    for (const l of parsed.evidenceReferences) {
      const ends = classify(evidenceLanding.get(l.evidenceId), insertedEvidenceIds, referenceLanding.get(l.referenceId), insertedReferenceIds);
      if (!ends) continue;
      erRows.push({ ...l, id: linkId(), evidenceId: ends[0], referenceId: ends[1] });
    }
    for (const chunk of chunks(erRows)) {
      const rows = await tx
        .insert(evidenceReferencesTable)
        .values(chunk.map((l) => ({
          id: l.id,
          evidenceId: l.evidenceId,
          referenceId: l.referenceId,
          createdAt: l.createdAt,
        })))
        .onConflictDoNothing()
        .returning({ id: evidenceReferencesTable.id });
      linksInserted += rows.length;
      linksSkipped += chunk.length - rows.length;
    }

    // ── 7. Pending embedding stubs for inserted evidence ──────────────────
    // The worker sweep discovers traces on its own (strategy-check backfill)
    // but only looks at source_type='trace', so evidence needs its pipeline
    // rows created here — as pending stubs, never provider calls (design
    // point 2). Inserted evidence hangs only off traces this import inserted,
    // so its "Recipe context" is the file's claim text, in the destination
    // book.
    const evidenceQueued = dest
      ? await queueEvidenceStubs(tx, {
          evidence: evidenceToInsert.filter((e) => insertedEvidenceIds.has(e.id)),
          traces: tracesToInsert,
          references: referencesToInsert,
          traceEvidence: teRows,
          evidenceReferences: erRows,
          destGroupId: dest.id,
        })
      : 0;

    return {
      dest,
      traceCounts: {
        inserted: insertedTraceIds.size,
        skippedIdentical,
        conflicted,
        remapped: idMap.filter((m) => m.entity === "trace").length,
      },
      idMap,
      evidenceCounts: {
        inserted: insertedEvidenceIds.size,
        skippedExisting: [...evidenceLanding.values()].filter((l) => !l.create && !l.dropped).length,
        orphaned: [...evidenceLanding.values()].filter((l) => l.dropped).length,
        remapped: idMap.filter((m) => m.entity === "evidence").length,
      },
      referenceCounts: {
        inserted: insertedReferenceIds.size,
        skippedExisting: [...referenceLanding.values()].filter((l) => !l.create && !l.dropped).length,
        orphaned: [...referenceLanding.values()].filter((l) => l.dropped).length,
        remapped: idMap.filter((m) => m.entity === "reference").length,
      },
      linkCounts: { inserted: linksInserted, skippedExisting: linksSkipped, orphaned: linksOrphaned },
      evidenceQueued,
    };
  });

  const tracesPendingBackfill = result.traceCounts.inserted;

  return {
    book: result.dest,
    counts: {
      traces: result.traceCounts,
      evidence: result.evidenceCounts,
      references: result.referenceCounts,
      links: result.linkCounts,
    },
    conflicts,
    conflictsTotal,
    idMap: result.idMap,
    embeddings: {
      evidenceQueued: result.evidenceQueued,
      tracesPendingBackfill,
      note:
        tracesPendingBackfill > 0 || result.evidenceQueued > 0
          ? "Imported recipes are visible in your dashboard immediately and enter semantic search as the embedding worker drains the queue (cache-hits for previously-embedded text cost zero provider calls). Progress: GET /admin/workers/embeddings (admins) or watch recipes appear in check results."
          : "Nothing new to embed.",
    },
    originalBooks: parsed.books.map((b) => ({
      groupId: b.groupId,
      name: b.name,
      slug: b.slug,
      mappedTo: result.dest?.id ?? null,
    })),
  };
}

// ── Destination book helpers ─────────────────────────────────────────────────

async function resolveWritableBook(
  db: PostgresJsDatabase,
  bookRef: string,
  userId: string,
): Promise<{ id: string; name: string; slug: string }> {
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookRef);
  const rows = await db.execute(sql`
    SELECT g.id, g.name, g.slug
    FROM claimnet.groups g
    JOIN claimnet.group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ${userId}::uuid
      AND ${uuidLike ? sql`g.id = ${bookRef}::uuid` : sql`g.slug = ${bookRef}`}
    ORDER BY g.created_at
    LIMIT 1
  `);
  const row = (rows as unknown as Array<{ id: string; name: string; slug: string }>)[0];
  if (!row) {
    throw new ImportError(
      404,
      `Recipe book "${bookRef}" not found among your memberships. Omit ?book= to import into a new book, or pass a book slug/id you are a member of.`,
    );
  }
  return row;
}

async function createImportBook(
  db: PostgresJsDatabase,
  userId: string,
  name: string | undefined,
): Promise<{ id: string; name: string; slug: string; created: boolean }> {
  const orgRows = await db.execute(sql`
    SELECT id FROM claimnet.organizations
    WHERE owner_id = ${userId}::uuid
    ORDER BY created_at
    LIMIT 1
  `);
  const org = (orgRows as unknown as Array<{ id: string }>)[0];
  if (!org) {
    throw new ImportError(400, "No organization owned by this account — cannot create a destination recipe book.");
  }

  const bookName = name && name.trim().length > 0
    ? name.trim().slice(0, 200)
    : `Imported ${new Date().toISOString().slice(0, 10)}`;
  // Timestamp-suffixed slug: unique per org without a retry loop.
  const slug = `imported-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;

  const groupRows = await db
    .insert(groupsTable)
    .values({ name: bookName, slug, organizationId: org.id })
    .returning({ id: groupsTable.id });
  const group = groupRows[0];
  if (!group) throw new ImportError(500, "Failed to create destination recipe book.");

  // Creator-owned book: opted into the daily-link defaults, mirroring
  // POST /recipe-books (the exclude-by-default rule is for invite accepts).
  await db.insert(groupMembersTable).values({
    groupId: group.id,
    userId,
    role: "owner",
    dailyRead: true,
    dailyWrite: true,
  });

  return { id: group.id, name: bookName, slug, created: true };
}

// ── Evidence embedding stubs ─────────────────────────────────────────────────

interface QueueEvidenceStubsOpts {
  /** Evidence rows this import inserted, under their landed ids. */
  evidence: ImportEvidenceRow[];
  /** Everything below is keyed by landed ids too. */
  traces: ImportTraceRow[];
  references: ImportReferenceRow[];
  traceEvidence: ImportTraceEvidenceRow[];
  evidenceReferences: ImportEvidenceReferenceRow[];
  destGroupId: string;
}

async function queueEvidenceStubs(
  db: PostgresJsDatabase,
  opts: QueueEvidenceStubsOpts,
): Promise<number> {
  const { evidence, traces, references, traceEvidence, evidenceReferences, destGroupId } = opts;
  if (evidence.length === 0) return 0;

  const modelId = getEmbeddingModelId();

  // First trace link per evidence gives the "Recipe context" line; first
  // reference link gives quote/source — mirroring the check path, where each
  // evidence entry belongs to exactly one trace and at most one reference.
  const traceByEvidence = new Map<string, string>();
  for (const l of traceEvidence) {
    if (!traceByEvidence.has(l.evidenceId)) traceByEvidence.set(l.evidenceId, l.traceId);
  }
  const referenceByEvidence = new Map<string, string>();
  for (const l of evidenceReferences) {
    if (!referenceByEvidence.has(l.evidenceId)) referenceByEvidence.set(l.evidenceId, l.referenceId);
  }
  const tracesById = new Map(traces.map((t) => [t.id, t]));
  const referencesById = new Map(references.map((r) => [r.id, r]));

  interface Stub {
    sourceId: string; // evidence id
    text: string;
  }
  const stubs: Stub[] = [];
  for (const e of evidence) {
    const traceId = traceByEvidence.get(e.id);
    const claimText = traceId ? tracesById.get(traceId)?.claimText : undefined;
    if (!claimText) continue; // orphan evidence: stored, but no context to embed
    const refId = referenceByEvidence.get(e.id);
    const ref = refId ? referencesById.get(refId) : undefined;
    stubs.push({
      sourceId: e.id,
      text: buildEvidenceEmbeddingText(
        claimText,
        e.content,
        ref?.quote ? ref.quote : null,
        ref?.source ? ref.source : null,
      ),
    });
  }

  // Batched pipeline inserts with client-generated ids (no RETURNING-order
  // dependence): sources → strategies → chunks → pending vectors.
  for (const chunk of chunks(stubs)) {
    const withIds = chunk.map((s) => ({
      ...s,
      embeddingSourceId: crypto.randomUUID(),
      strategyRowId: crypto.randomUUID(),
      chunkId: crypto.randomUUID(),
    }));

    await db.insert(embeddingSourcesTable).values(withIds.map((s) => ({
      id: s.embeddingSourceId,
      sourceType: "evidence",
      sourceId: s.sourceId,
      groupId: destGroupId,
      sourceText: s.text,
      artifactCategory: "text",
    })));

    await db.insert(embeddingChunkStrategiesTable).values(withIds.map((s) => ({
      id: s.strategyRowId,
      embeddingSourceId: s.embeddingSourceId,
      strategyId: "full_document",
      status: "complete",
    })));

    await db.insert(embeddingChunksTable).values(withIds.map((s) => ({
      id: s.chunkId,
      embeddingSourceId: s.embeddingSourceId,
      chunkStrategyId: s.strategyRowId,
      chunkText: s.text,
      chunkHash: sha256(s.text),
      chunkPath: "doc",
      metadata: {},
    })));

    await db.insert(embeddingVectorsTable).values(withIds.map((s) => ({
      embeddingChunkId: s.chunkId,
      modelId,
      taskType: "SEMANTIC_SIMILARITY",
      status: "pending",
      // vector stays NULL — the worker populates it (cache-first).
    })));
  }

  return stubs.length;
}
