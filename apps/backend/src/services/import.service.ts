/**
 * Corpus import — the inverse of GET /auth/me/export.
 * See docs/planning/corpus-import.md for the full brief.
 *
 * Shape of the operation:
 *   1. Resolve the destination recipe book (existing writable book, or a new
 *      book created lazily — only when the import actually inserts something).
 *   2. ONE all-or-nothing transaction, chunked batch inserts (500 rows per
 *      statement). Transactional (not resumable) is the documented choice for
 *      acceptance criterion 6: a failed import rolls back completely, and
 *      because the import is idempotent (upsert-on-id), re-uploading the same
 *      file IS the resume path. The lock-duration concern that pushed account
 *      deletion to per-trace transactions (recipe 9517f6f4) does not transfer
 *      here: import is insert-only — it takes no locks on rows other users
 *      touch (conflicting ids are read, never written, unless owned by the
 *      importer and overwrite=true).
 *   3. Embeddings stay OFF the write path (design point 2). The transaction
 *      writes no vectors and calls no provider. Imported traces are discovered
 *      by the embedding worker's strategy sweep (strategy-check backfills
 *      sources/chunks/pending vectors within ~1 minute, MAX_TRACES_PER_JOB per
 *      strategy per cycle); imported evidence gets pending stubs here because
 *      the sweep only discovers trace sources. Both drain through vector-check,
 *      which resolves from the content-addressed vector_cache first — text the
 *      instance has embedded before costs zero provider calls (recipe 8ba10d32).
 *
 * Collision semantics (design point 7): default = existing row wins; the
 * result reports id + differing fields + which side was kept. overwrite=true
 * opts into replacing TRACE content (claim text, decided_at, adherence score)
 * for traces the importer owns — book placement is not changed by overwrite,
 * and shared rows (evidence, references) are never overwritten because they
 * may be linked from other users' traces.
 *
 * Isolation → DETERMINISTIC MINT (v1.1, Andy 2026-07-13): import produces a
 * fully independent subgraph per importer. Any row that exists here as (or
 * linked into) ANOTHER user's graph — traces by ownership, evidence and
 * references by being linked from a foreign trace — is minted the importer's
 * own copy under mintImportId(userId, originalId), and every in-file
 * reference to it is rewritten. No cross-user rows are ever shared or linked
 * ("no cross recipe book or cross user connections so that parallel benchmark
 * runs are not cross contaminated, and can also each be easily deleted on
 * their own"). Because the mint is deterministic, a re-import computes the
 * SAME minted ids and flows down the same-owner upsert path — idempotent —
 * while different importers of one source corpus derive disjoint ids. The
 * old→new mapping is returned in `idMap`. The SAME-owner path is unchanged —
 * a re-import of your own corpus still upserts on the preserved ids
 * (idempotency + citation stability), and rows that exist but are linked to
 * nobody else's traces are reused, not copied.
 *
 * Prompt-injection posture (design point 3): everything in the file is stored
 * as data via parameterized inserts; nothing is interpreted, executed, or fed
 * to a model during import. Imported content inherits the same read-path
 * treatment as any shared-book content.
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
import { deleteEmbeddingChainForSource } from "./trace-delete.service";
import type { ParsedExport, ImportTraceRow } from "./import-validate";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ImportOptions {
  userId: string;
  /** Existing destination book (slug or UUID) the user is a member of.
   *  Omitted = create a new book (the default, per design point 5). */
  targetBook?: string | undefined;
  /** Name for the new book when one is created. */
  newBookName?: string | undefined;
  /** Replace owned traces whose content differs (default: existing wins). */
  overwrite: boolean;
}

export interface ImportConflict {
  entity: "trace" | "evidence" | "reference";
  id: string;
  fields: string[];
  kept: "existing" | "incoming";
}

/** Old→new id remap emitted when an incoming id belonged to (traces) or was
 *  linked into (evidence, references) another user's graph and so was minted
 *  the importer's own deterministic copy-id (v1.1 isolation). Consumers
 *  holding the export's original ids (e.g. a citation index) use this to
 *  follow the rows into the importer's corpus. Deterministic: the same
 *  importer re-importing the same file derives the same mappings. */
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
      overwritten: number;
      /** Traces whose incoming id was owned by another user and so was minted
       *  the importer's own deterministic id. On a FIRST import these are a
       *  subset of `inserted`; on a re-import the same minted ids resolve to
       *  the importer's existing rows and land in `skippedIdentical` /
       *  `conflicted` instead — `remapped` counts remaps, not inserts. `idMap`
       *  carries the old→new detail. */
      remapped: number;
    };
    evidence: { inserted: number; skippedExisting: number; conflicted: number; remapped: number };
    references: { inserted: number; skippedExisting: number; conflicted: number; remapped: number };
    links: { inserted: number; skippedExisting: number; orphaned: number };
  };
  /** Per-row collision detail, capped at MAX_CONFLICT_DETAIL entries. */
  conflicts: ImportConflict[];
  conflictsTotal: number;
  /** Old→new id mappings for mint-on-conflict remaps (v1.1). Empty when no
   *  incoming id collided with another user's row. In-file cross-references
   *  (trace_evidence / trace_references) are already remapped to the new ids
   *  inside the import; this list is for external holders of the old ids. */
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
    public readonly status: 400 | 403 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

const CHUNK = 500;
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
  id: string;
  userId: string;
  groupId: string;
  claimText: string;
  decidedAt: Date | null;
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
  const { userId, overwrite } = opts;

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
  const addConflict = (c: ImportConflict): void => {
    conflictsTotal++;
    if (conflicts.length < MAX_CONFLICT_DETAIL) conflicts.push(c);
  };

  const result = await db.transaction(async (tx) => {
    // ── 1. Classify traces against existing rows ─────────────────────────
    const existingTraces = new Map<string, ExistingTrace>();
    for (const chunk of chunks(parsed.traces)) {
      const rows = await tx.execute(sql`
        SELECT id, user_id AS "userId", group_id AS "groupId",
               claim_text AS "claimText", decided_at AS "decidedAt"
        FROM claimnet.traces
        WHERE id IN (${sql.join(chunk.map((t) => sql`${t.id}::uuid`), sql`, `)})
      `);
      for (const r of rows as unknown as Array<ExistingTrace & { decidedAt: string | Date | null }>) {
        existingTraces.set(r.id, {
          ...r,
          decidedAt: r.decidedAt === null ? null : new Date(r.decidedAt),
        });
      }
    }

    // ── 1a. Isolation remap: deterministic mint for foreign traces ────────
    // A trace id owned by ANOTHER user gets the importer's own deterministic
    // copy-id — mintImportId(userId, originalId) — instead of being skipped.
    // Deterministic, so a re-import derives the SAME minted ids (idempotent
    // through the ordinary same-owner path below) and parallel importers of
    // one source corpus derive disjoint ids (no cross-contamination; each
    // run's subgraph deletes cleanly on its own). Link views are built AFTER
    // the evidence/reference remap in §2a, which needs the same treatment.
    const traceIdRemap = new Map<string, string>();
    for (const t of parsed.traces) {
      const existing = existingTraces.get(t.id);
      if (existing && existing.userId !== userId) {
        traceIdRemap.set(t.id, mintImportId(userId, t.id));
      }
    }
    // A minted id may itself already exist (this importer ran this file
    // before). Fetch those rows into the classification map so the minted
    // trace flows down the same-owner path (skipped-identical / conflicted)
    // instead of colliding on insert.
    for (const chunk of chunks([...traceIdRemap.values()])) {
      const rows = await tx.execute(sql`
        SELECT id, user_id AS "userId", group_id AS "groupId",
               claim_text AS "claimText", decided_at AS "decidedAt"
        FROM claimnet.traces
        WHERE id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
      `);
      for (const r of rows as unknown as Array<ExistingTrace & { decidedAt: string | Date | null }>) {
        existingTraces.set(r.id, {
          ...r,
          decidedAt: r.decidedAt === null ? null : new Date(r.decidedAt),
        });
      }
    }
    const remapTraceId = (id: string): string => traceIdRemap.get(id) ?? id;
    const wTraces = traceIdRemap.size === 0
      ? parsed.traces
      : parsed.traces.map((t) => (traceIdRemap.has(t.id) ? { ...t, id: remapTraceId(t.id) } : t));

    const toInsert: ImportTraceRow[] = [];
    const toOverwrite: ImportTraceRow[] = [];
    let skippedIdentical = 0;
    let conflicted = 0;

    for (const t of wTraces) {
      const existing = existingTraces.get(t.id);
      if (!existing) {
        // New id (never-seen, or a just-minted remap) → insert as importer's.
        toInsert.push(t);
        continue;
      }
      // existing.userId === userId is guaranteed here: any other-user id was
      // remapped above to a fresh id that misses this lookup. Same-owner path
      // is preserved exactly (v1 idempotency criterion stands).
      const fields: string[] = [];
      if (existing.claimText !== t.claimText) fields.push("claimText");
      if (!sameInstant(existing.decidedAt, t.decidedAt)) fields.push("decidedAt");
      if (fields.length === 0) {
        skippedIdentical++;
      } else if (overwrite) {
        toOverwrite.push(t);
        addConflict({ entity: "trace", id: t.id, fields, kept: "incoming" });
      } else {
        conflicted++;
        addConflict({ entity: "trace", id: t.id, fields, kept: "existing" });
      }
    }

    // ── 2. Classify evidence + references ─────────────────────────────────
    // Existing rows are reused ONLY when they aren't part of anyone else's
    // graph. Evidence/references have no owner column; foreignness is being
    // linked (through trace_evidence / trace_references / evidence_references)
    // to a trace the importer doesn't own. Foreign-linked rows are minted the
    // importer's own deterministic copies in §2a — sharing them would create
    // exactly the cross-user edges the isolation ruling forbids, and would
    // leave the importer's runs undeletable-in-isolation.
    const existingEvidence = new Map<string, { content: string }>();
    const fetchEvidenceInto = async (ids: string[]): Promise<void> => {
      for (const chunk of chunks(ids)) {
        const rows = await tx.execute(sql`
          SELECT id, content FROM claimnet.evidence
          WHERE id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
        `);
        for (const r of rows as unknown as Array<{ id: string; content: string }>) {
          existingEvidence.set(r.id, { content: r.content });
        }
      }
    };
    await fetchEvidenceInto(parsed.evidence.map((e) => e.id));

    // ── 2a. Isolation remap for evidence: foreign-linked → mint ───────────
    const evidenceIdRemap = new Map<string, string>();
    {
      const existingIdsList = parsed.evidence.map((e) => e.id).filter((id) => existingEvidence.has(id));
      for (const chunk of chunks(existingIdsList)) {
        const rows = await tx.execute(sql`
          SELECT DISTINCT te.evidence_id AS "id"
          FROM claimnet.trace_evidence te
          JOIN claimnet.traces t ON t.id = te.trace_id
          WHERE te.evidence_id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
            AND t.user_id <> ${userId}::uuid
        `);
        for (const r of rows as unknown as Array<{ id: string }>) {
          evidenceIdRemap.set(r.id, mintImportId(userId, r.id));
        }
      }
    }
    // Minted evidence ids may exist from a prior run of this file — fetch them
    // so re-imports classify as skipped-existing rather than colliding.
    await fetchEvidenceInto([...evidenceIdRemap.values()]);
    const remapEvidenceId = (id: string): string => evidenceIdRemap.get(id) ?? id;
    const wEvidence = evidenceIdRemap.size === 0
      ? parsed.evidence
      : parsed.evidence.map((e) => (evidenceIdRemap.has(e.id) ? { ...e, id: remapEvidenceId(e.id) } : e));

    const evidenceToInsert = wEvidence.filter((e) => !existingEvidence.has(e.id));
    let evidenceConflicted = 0;
    for (const e of wEvidence) {
      const ex = existingEvidence.get(e.id);
      if (ex && ex.content !== e.content) {
        evidenceConflicted++;
        addConflict({ entity: "evidence", id: e.id, fields: ["content"], kept: "existing" });
      }
    }
    const evidenceSkipped = wEvidence.length - evidenceToInsert.length;

    const existingReferences = new Map<string, { quote: string; source: string; fileHash: string | null }>();
    const fetchReferencesInto = async (ids: string[]): Promise<void> => {
      for (const chunk of chunks(ids)) {
        const rows = await tx.execute(sql`
          SELECT id, quote, source, file_hash AS "fileHash" FROM claimnet.references
          WHERE id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
        `);
        for (const r of rows as unknown as Array<{ id: string; quote: string; source: string; fileHash: string | null }>) {
          existingReferences.set(r.id, r);
        }
      }
    };
    await fetchReferencesInto(parsed.references.map((r) => r.id));

    // ── 2b. Isolation remap for references: foreign-linked → mint ─────────
    // Foreign directly (trace_references to another user's trace) or through
    // evidence (evidence_references → trace_evidence → another user's trace).
    const referenceIdRemap = new Map<string, string>();
    {
      const existingIdsList = parsed.references.map((r) => r.id).filter((id) => existingReferences.has(id));
      for (const chunk of chunks(existingIdsList)) {
        const inList = sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `);
        const rows = await tx.execute(sql`
          SELECT DISTINCT tr.reference_id AS "id"
          FROM claimnet.trace_references tr
          JOIN claimnet.traces t ON t.id = tr.trace_id
          WHERE tr.reference_id IN (${inList}) AND t.user_id <> ${userId}::uuid
          UNION
          SELECT DISTINCT er.reference_id AS "id"
          FROM claimnet.evidence_references er
          JOIN claimnet.trace_evidence te ON te.evidence_id = er.evidence_id
          JOIN claimnet.traces t ON t.id = te.trace_id
          WHERE er.reference_id IN (${inList}) AND t.user_id <> ${userId}::uuid
        `);
        for (const r of rows as unknown as Array<{ id: string }>) {
          referenceIdRemap.set(r.id, mintImportId(userId, r.id));
        }
      }
    }
    await fetchReferencesInto([...referenceIdRemap.values()]);
    const remapReferenceId = (id: string): string => referenceIdRemap.get(id) ?? id;
    const wReferences = referenceIdRemap.size === 0
      ? parsed.references
      : parsed.references.map((r) => (referenceIdRemap.has(r.id) ? { ...r, id: remapReferenceId(r.id) } : r));

    const referencesToInsert = wReferences.filter((r) => !existingReferences.has(r.id));
    let referencesConflicted = 0;
    for (const r of wReferences) {
      const ex = existingReferences.get(r.id);
      if (!ex) continue;
      const fields: string[] = [];
      if (ex.quote !== r.quote) fields.push("quote");
      if (ex.source !== r.source) fields.push("source");
      if ((ex.fileHash ?? null) !== (r.fileHash ?? null)) fields.push("fileHash");
      if (fields.length > 0) {
        referencesConflicted++;
        addConflict({ entity: "reference", id: r.id, fields, kept: "existing" });
      }
    }
    const referencesSkipped = wReferences.length - referencesToInsert.length;

    // ── 2c. Link working views ─────────────────────────────────────────────
    // Every link endpoint follows its entity's remap. A link with ANY remapped
    // endpoint is a genuinely new relationship in the importer's subgraph, so
    // its own PK is minted too — deterministically, from the original link id,
    // so a re-import's link insert collides with itself and onConflictDoNothing
    // keeps it idempotent. (Keeping the old PK would collide with the source
    // owner's link row and be silently dropped, orphaning the minted rows.)
    const wTraceEvidence = parsed.traceEvidence.map((l) => {
      const remapped = traceIdRemap.has(l.traceId) || evidenceIdRemap.has(l.evidenceId);
      return remapped
        ? { ...l, id: mintImportId(userId, l.id), traceId: remapTraceId(l.traceId), evidenceId: remapEvidenceId(l.evidenceId) }
        : l;
    });
    const wTraceReferences = parsed.traceReferences.map((l) => {
      const remapped = traceIdRemap.has(l.traceId) || referenceIdRemap.has(l.referenceId);
      return remapped
        ? { ...l, id: mintImportId(userId, l.id), traceId: remapTraceId(l.traceId), referenceId: remapReferenceId(l.referenceId) }
        : l;
    });
    const wEvidenceReferences = parsed.evidenceReferences.map((l) => {
      const remapped = evidenceIdRemap.has(l.evidenceId) || referenceIdRemap.has(l.referenceId);
      return remapped
        ? { ...l, id: mintImportId(userId, l.id), evidenceId: remapEvidenceId(l.evidenceId), referenceId: remapReferenceId(l.referenceId) }
        : l;
    });

    // ── 3. Resolve/create destination book (lazily for the new-book default) ──
    let dest = destination;
    const willWrite = toInsert.length > 0 || toOverwrite.length > 0
      || evidenceToInsert.length > 0 || referencesToInsert.length > 0;
    if (!dest && willWrite) {
      dest = await createImportBook(tx, userId, opts.newBookName);
    }

    // ── 4. Insert new traces (chunked batches; explicit ids + timestamps) ──
    let insertedTraces = 0;
    if (toInsert.length > 0) {
      if (!dest) throw new ImportError(500, "internal: destination book unresolved");
      const destId = dest.id;
      for (const chunk of chunks(toInsert)) {
        const rows = await tx
          .insert(tracesTable)
          .values(chunk.map((t) => ({
            id: t.id,
            userId,
            groupId: destId,
            // NULL api_key_id: imports are a human-only control, and NULL also
            // exempts these rows from traces_api_key_group_claim_unique —
            // idempotency for imports is upsert-on-trace-id, not the agent
            // (key, book, text-hash) constraint.
            apiKeyId: null,
            claimText: t.claimText,
            claimTextHash: t.claimTextHash ?? sha256(t.claimText),
            formatAdherenceScore: t.formatAdherenceScore,
            decidedAt: t.decidedAt,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt ?? t.createdAt,
          })))
          .onConflictDoNothing()
          .returning({ id: tracesTable.id });
        insertedTraces += rows.length;
      }
    }

    // ── 5. Overwrites (owned traces whose content differs, overwrite=true) ──
    // Content-only replacement: the row keeps its current book. Stale
    // embeddings for the old text are removed so the worker sweep re-embeds.
    for (const t of toOverwrite) {
      await tx.execute(sql`
        UPDATE claimnet.traces
        SET claim_text = ${t.claimText},
            claim_text_hash = ${t.claimTextHash ?? sha256(t.claimText)},
            format_adherence_score = ${t.formatAdherenceScore},
            decided_at = ${t.decidedAt ? t.decidedAt.toISOString() : null}::timestamptz,
            updated_at = now()
        WHERE id = ${t.id}::uuid AND user_id = ${userId}::uuid
      `);
      await deleteEmbeddingChainForSource(tx, "trace", t.id);
    }

    // ── 6. Insert evidence + references ──────────────────────────────────
    let insertedEvidence = 0;
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
      insertedEvidence += rows.length;
    }

    let insertedReferences = 0;
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
      insertedReferences += rows.length;
    }

    // ── 7. Links ──────────────────────────────────────────────────────────
    // A link is importable when its trace endpoint is owned by the importer
    // (inserted, skipped-identical, conflicted, or overwritten — all owned)
    // and its other endpoint exists (in the file, or already in the DB).
    const ownedTraceIds = new Set<string>();
    for (const t of wTraces) {
      const existing = existingTraces.get(t.id);
      if (!existing || existing.userId === userId) ownedTraceIds.add(t.id);
    }

    const fileEvidenceIds = new Set(wEvidence.map((e) => e.id));
    const fileReferenceIds = new Set(wReferences.map((r) => r.id));

    // Endpoints referenced by links but absent from the file — verify in DB.
    const unknownEvidenceIds = new Set<string>();
    const unknownReferenceIds = new Set<string>();
    for (const l of wTraceEvidence) {
      if (!fileEvidenceIds.has(l.evidenceId)) unknownEvidenceIds.add(l.evidenceId);
    }
    for (const l of wEvidenceReferences) {
      if (!fileEvidenceIds.has(l.evidenceId)) unknownEvidenceIds.add(l.evidenceId);
      if (!fileReferenceIds.has(l.referenceId)) unknownReferenceIds.add(l.referenceId);
    }
    for (const l of wTraceReferences) {
      if (!fileReferenceIds.has(l.referenceId)) unknownReferenceIds.add(l.referenceId);
    }
    const dbEvidenceIds = await existingIds(tx, "evidence", [...unknownEvidenceIds]);
    const dbReferenceIds = await existingIds(tx, "references", [...unknownReferenceIds]);
    const evidenceExists = (id: string): boolean => fileEvidenceIds.has(id) || dbEvidenceIds.has(id);
    const referenceExists = (id: string): boolean => fileReferenceIds.has(id) || dbReferenceIds.has(id);

    let linksInserted = 0;
    let linksSkipped = 0;
    let linksOrphaned = 0;

    const importableTE = wTraceEvidence.filter((l) => {
      const ok = ownedTraceIds.has(l.traceId) && evidenceExists(l.evidenceId);
      if (!ok) linksOrphaned++;
      return ok;
    });
    for (const chunk of chunks(importableTE)) {
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

    const importableTR = wTraceReferences.filter((l) => {
      const ok = ownedTraceIds.has(l.traceId) && referenceExists(l.referenceId);
      if (!ok) linksOrphaned++;
      return ok;
    });
    for (const chunk of chunks(importableTR)) {
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

    const importableER = wEvidenceReferences.filter((l) => {
      const ok = evidenceExists(l.evidenceId) && referenceExists(l.referenceId);
      if (!ok) linksOrphaned++;
      return ok;
    });
    for (const chunk of chunks(importableER)) {
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

    // ── 8. Pending embedding stubs for INSERTED evidence ─────────────────
    // The worker sweep discovers traces on its own (strategy-check backfill)
    // but only looks at source_type='trace', so evidence needs its pipeline
    // rows created here — as pending stubs, never provider calls (design
    // point 2). Text reconstruction matches the check path byte-for-byte so
    // previously-embedded evidence resolves from vector_cache.
    const evidenceQueued = await queueEvidenceStubs(tx, {
      insertedEvidenceIds: new Set(evidenceToInsert.map((e) => e.id)),
      // Working view: everything embeds against the minted ids so a remapped
      // trace's evidence resolves its "Recipe context" from the rows actually
      // inserted. Minted evidence IS inserted evidence, so isolation copies
      // get their pending stubs (scoped to the importer's book) with no
      // special casing.
      parsed: {
        ...parsed,
        traces: wTraces,
        evidence: wEvidence,
        references: wReferences,
        traceEvidence: wTraceEvidence,
        traceReferences: wTraceReferences,
        evidenceReferences: wEvidenceReferences,
      },
      userId,
      existingTraces,
      destGroupId: dest?.id ?? null,
    });

    return {
      dest,
      traceCounts: {
        inserted: insertedTraces,
        skippedIdentical,
        conflicted,
        overwritten: toOverwrite.length,
        remapped: traceIdRemap.size,
      },
      idMap: [
        ...[...traceIdRemap].map(([from, to]): ImportIdRemap => ({ entity: "trace", from, to })),
        ...[...evidenceIdRemap].map(([from, to]): ImportIdRemap => ({ entity: "evidence", from, to })),
        ...[...referenceIdRemap].map(([from, to]): ImportIdRemap => ({ entity: "reference", from, to })),
      ],
      evidenceCounts: {
        inserted: insertedEvidence,
        skippedExisting: evidenceSkipped,
        conflicted: evidenceConflicted,
        remapped: evidenceIdRemap.size,
      },
      referenceCounts: {
        inserted: insertedReferences,
        skippedExisting: referencesSkipped,
        conflicted: referencesConflicted,
        remapped: referenceIdRemap.size,
      },
      linkCounts: { inserted: linksInserted, skippedExisting: linksSkipped, orphaned: linksOrphaned },
      evidenceQueued,
    };
  });

  const tracesPendingBackfill = result.traceCounts.inserted + result.traceCounts.overwritten;

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

// ── Link/table helpers ───────────────────────────────────────────────────────

async function existingIds(
  db: PostgresJsDatabase,
  table: "evidence" | "references",
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const chunk of chunks(ids)) {
    if (chunk.length === 0) continue;
    const rows = await db.execute(sql`
      SELECT id FROM ${sql.raw(`claimnet."${table}"`)}
      WHERE id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    for (const r of rows as unknown as Array<{ id: string }>) found.add(r.id);
  }
  return found;
}

// ── Evidence embedding stubs ─────────────────────────────────────────────────

interface QueueEvidenceStubsOpts {
  insertedEvidenceIds: Set<string>;
  parsed: ParsedExport;
  userId: string;
  existingTraces: Map<string, ExistingTrace>;
  destGroupId: string | null;
}

async function queueEvidenceStubs(
  db: PostgresJsDatabase,
  opts: QueueEvidenceStubsOpts,
): Promise<number> {
  const { insertedEvidenceIds, parsed, userId, existingTraces, destGroupId } = opts;
  if (insertedEvidenceIds.size === 0) return 0;

  const modelId = getEmbeddingModelId();

  // First trace link per evidence gives the "Recipe context" line; first
  // reference link gives quote/source — mirroring the check path, where each
  // evidence entry belongs to exactly one trace and at most one reference.
  const traceByEvidence = new Map<string, string>();
  for (const l of parsed.traceEvidence) {
    if (!traceByEvidence.has(l.evidenceId)) traceByEvidence.set(l.evidenceId, l.traceId);
  }
  const referenceByEvidence = new Map<string, string>();
  for (const l of parsed.evidenceReferences) {
    if (!referenceByEvidence.has(l.evidenceId)) referenceByEvidence.set(l.evidenceId, l.referenceId);
  }
  const tracesById = new Map(parsed.traces.map((t) => [t.id, t]));
  const referencesById = new Map(parsed.references.map((r) => [r.id, r]));

  interface Stub {
    sourceId: string; // evidence id
    groupId: string;
    text: string;
  }
  const stubs: Stub[] = [];
  for (const e of parsed.evidence) {
    if (!insertedEvidenceIds.has(e.id)) continue;
    const traceId = traceByEvidence.get(e.id);
    if (!traceId) continue; // orphan evidence: stored, but no context to embed
    const fileTrace = tracesById.get(traceId);
    const existing = existingTraces.get(traceId);
    // Embed against the claim text that actually lives in the DB after this
    // import: existing text when the trace was kept, file text when inserted.
    const claimText = existing && existing.userId === userId
      ? existing.claimText
      : fileTrace?.claimText;
    const groupId = existing && existing.userId === userId
      ? existing.groupId
      : (fileTrace ? destGroupId : null);
    if (!claimText || !groupId) continue;
    const ref = referenceByEvidence.has(e.id)
      ? referencesById.get(referenceByEvidence.get(e.id)!)
      : undefined;
    stubs.push({
      sourceId: e.id,
      groupId,
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
      groupId: s.groupId,
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
