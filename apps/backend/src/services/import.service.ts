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
 * may be linked from other users' traces. Trace ids that exist but belong to
 * another user are never compared or touched; they are counted (notOwned)
 * without field detail.
 *
 * Prompt-injection posture (design point 3): everything in the file is stored
 * as data via parameterized inserts; nothing is interpreted, executed, or fed
 * to a model during import. Imported content inherits the same read-path
 * treatment as any shared-book content.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

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

export interface ImportResult {
  book: { id: string; name: string; slug: string; created: boolean } | null;
  counts: {
    traces: {
      inserted: number;
      skippedIdentical: number;
      conflicted: number;
      overwritten: number;
      notOwned: number;
    };
    evidence: { inserted: number; skippedExisting: number; conflicted: number };
    references: { inserted: number; skippedExisting: number; conflicted: number };
    links: { inserted: number; skippedExisting: number; orphaned: number };
  };
  /** Per-row collision detail, capped at MAX_CONFLICT_DETAIL entries. */
  conflicts: ImportConflict[];
  conflictsTotal: number;
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

    const toInsert: ImportTraceRow[] = [];
    const toOverwrite: ImportTraceRow[] = [];
    let skippedIdentical = 0;
    let conflicted = 0;
    let notOwned = 0;

    for (const t of parsed.traces) {
      const existing = existingTraces.get(t.id);
      if (!existing) {
        toInsert.push(t);
        continue;
      }
      if (existing.userId !== userId) {
        // Never compare or touch another user's row — count without detail.
        notOwned++;
        continue;
      }
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

    // ── 2. Classify evidence + references (shared rows: existing always wins) ──
    const existingEvidence = new Map<string, { content: string }>();
    for (const chunk of chunks(parsed.evidence)) {
      const rows = await tx.execute(sql`
        SELECT id, content FROM claimnet.evidence
        WHERE id IN (${sql.join(chunk.map((e) => sql`${e.id}::uuid`), sql`, `)})
      `);
      for (const r of rows as unknown as Array<{ id: string; content: string }>) {
        existingEvidence.set(r.id, { content: r.content });
      }
    }
    const evidenceToInsert = parsed.evidence.filter((e) => !existingEvidence.has(e.id));
    let evidenceConflicted = 0;
    for (const e of parsed.evidence) {
      const ex = existingEvidence.get(e.id);
      if (ex && ex.content !== e.content) {
        evidenceConflicted++;
        addConflict({ entity: "evidence", id: e.id, fields: ["content"], kept: "existing" });
      }
    }
    const evidenceSkipped = parsed.evidence.length - evidenceToInsert.length;

    const existingReferences = new Map<string, { quote: string; source: string; fileHash: string | null }>();
    for (const chunk of chunks(parsed.references)) {
      const rows = await tx.execute(sql`
        SELECT id, quote, source, file_hash AS "fileHash" FROM claimnet.references
        WHERE id IN (${sql.join(chunk.map((r) => sql`${r.id}::uuid`), sql`, `)})
      `);
      for (const r of rows as unknown as Array<{ id: string; quote: string; source: string; fileHash: string | null }>) {
        existingReferences.set(r.id, r);
      }
    }
    const referencesToInsert = parsed.references.filter((r) => !existingReferences.has(r.id));
    let referencesConflicted = 0;
    for (const r of parsed.references) {
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
    const referencesSkipped = parsed.references.length - referencesToInsert.length;

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
    for (const t of parsed.traces) {
      const existing = existingTraces.get(t.id);
      if (!existing || existing.userId === userId) ownedTraceIds.add(t.id);
    }

    const fileEvidenceIds = new Set(parsed.evidence.map((e) => e.id));
    const fileReferenceIds = new Set(parsed.references.map((r) => r.id));

    // Endpoints referenced by links but absent from the file — verify in DB.
    const unknownEvidenceIds = new Set<string>();
    const unknownReferenceIds = new Set<string>();
    for (const l of parsed.traceEvidence) {
      if (!fileEvidenceIds.has(l.evidenceId)) unknownEvidenceIds.add(l.evidenceId);
    }
    for (const l of parsed.evidenceReferences) {
      if (!fileEvidenceIds.has(l.evidenceId)) unknownEvidenceIds.add(l.evidenceId);
      if (!fileReferenceIds.has(l.referenceId)) unknownReferenceIds.add(l.referenceId);
    }
    for (const l of parsed.traceReferences) {
      if (!fileReferenceIds.has(l.referenceId)) unknownReferenceIds.add(l.referenceId);
    }
    const dbEvidenceIds = await existingIds(tx, "evidence", [...unknownEvidenceIds]);
    const dbReferenceIds = await existingIds(tx, "references", [...unknownReferenceIds]);
    const evidenceExists = (id: string): boolean => fileEvidenceIds.has(id) || dbEvidenceIds.has(id);
    const referenceExists = (id: string): boolean => fileReferenceIds.has(id) || dbReferenceIds.has(id);

    let linksInserted = 0;
    let linksSkipped = 0;
    let linksOrphaned = 0;

    const importableTE = parsed.traceEvidence.filter((l) => {
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

    const importableTR = parsed.traceReferences.filter((l) => {
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

    const importableER = parsed.evidenceReferences.filter((l) => {
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
      parsed,
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
        notOwned,
      },
      evidenceCounts: {
        inserted: insertedEvidence,
        skippedExisting: evidenceSkipped,
        conflicted: evidenceConflicted,
      },
      referenceCounts: {
        inserted: insertedReferences,
        skippedExisting: referencesSkipped,
        conflicted: referencesConflicted,
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
