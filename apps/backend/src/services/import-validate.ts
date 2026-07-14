/**
 * Corpus-import parsing + validation — the pure half of POST /import.
 *
 * Takes the already-JSON.parsed body of a `GET /auth/me/export` file and
 * either returns a typed, timestamp-parsed ParsedExport or a single
 * actionable error string. No I/O — Layer 1 unit-testable.
 *
 * Compatibility contract (docs/planning/corpus-import.md, design point 6):
 *   - `schemaVersion` is an integer reserved for BREAKING changes; this
 *     validator accepts exactly the versions in SUPPORTED_SCHEMA_VERSIONS
 *     and rejects everything else with an error naming both versions.
 *   - Unknown ADDITIVE keys (top-level or per-row) are ignored — additive-
 *     by-key-presence, matching the export's documented versioning policy
 *     (see the schemaVersion comment in routes/auth.ts).
 *   - Missing top-level sections are treated as empty arrays, so a client
 *     that subsets an export (by book, date, …) before upload can simply
 *     delete sections. Present-but-wrong-type is a structural error.
 *   - A missing/absent row `id` (PK) is MINTED here rather than rejected
 *     (v1.1, Andy 2026-07-13: "it would be ok for the PK to be missing in
 *     the data to be imported and still be fine to import"). Import is a
 *     corpus export/import tool, not a DB backup/restore — a row without a
 *     PK is still importable content. Only the row's OWN id is minted;
 *     foreign-key endpoints (traceId/evidenceId/referenceId) stay required,
 *     because a link with a missing endpoint has no row to point at. A
 *     minted-id row cannot be cross-referenced within the same file (nothing
 *     could carry the id it never had), so minting here needs no remap; the
 *     ownership-conflict remap that DOES need one lives in import.service.ts.
 */

import crypto from "node:crypto";

// ── Output types ─────────────────────────────────────────────────────────────

export interface ImportTraceRow {
  id: string;
  /** Original (source-instance) book id — used only for the originalBooks report. */
  groupId: string | null;
  claimText: string;
  claimTextHash: string | null;
  formatAdherenceScore: number | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface ImportEvidenceRow {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface ImportReferenceRow {
  id: string;
  quote: string;
  source: string;
  fileUrl: string | null;
  fileMimeType: string | null;
  fileHash: string | null;
  createdAt: Date;
}

export interface ImportTraceEvidenceRow {
  id: string;
  traceId: string;
  evidenceId: string;
  stance: "for" | "against";
  apiKeyId: string | null;
  createdAt: Date;
}

export interface ImportTraceReferenceRow {
  id: string;
  traceId: string;
  referenceId: string;
  apiKeyId: string | null;
  createdAt: Date;
}

export interface ImportEvidenceReferenceRow {
  id: string;
  evidenceId: string;
  referenceId: string;
  createdAt: Date;
}

/** Original book metadata from the export's groupMemberships section. */
export interface ImportBookInfo {
  groupId: string;
  name: string | null;
  slug: string | null;
  description: string | null;
}

export interface ParsedExport {
  schemaVersion: number;
  traces: ImportTraceRow[];
  evidence: ImportEvidenceRow[];
  references: ImportReferenceRow[];
  traceEvidence: ImportTraceEvidenceRow[];
  traceReferences: ImportTraceReferenceRow[];
  evidenceReferences: ImportEvidenceReferenceRow[];
  /** Original book structure, preserved as report metadata (design point 5). */
  books: ImportBookInfo[];
}

export type ParseExportResult =
  | { ok: true; data: ParsedExport }
  | { ok: false; error: string };

export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

/** Row-level problems collected before aborting with an actionable error. */
const MAX_REPORTED_ERRORS = 20;

// ── Field helpers ────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class RowError extends Error {}

function reqUuid(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new RowError(`${key} must be a UUID string, got ${JSON.stringify(v)}`);
  }
  return v.toLowerCase();
}

/**
 * A row's own primary key: a UUID string, or minted when absent (undefined/
 * null) — v1.1 accepts PK-less rows (see file header). A present-but-malformed
 * id is still a hard error: garbage is a broken file, not a PK-less row.
 */
function idOrMint(row: Record<string, unknown>, key: string = "id"): string {
  const v = row[key];
  if (v === undefined || v === null) return crypto.randomUUID();
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new RowError(`${key} must be a UUID string (or absent, to be minted), got ${JSON.stringify(v)}`);
  }
  return v.toLowerCase();
}

function optUuid(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new RowError(`${key} must be a UUID string or null, got ${JSON.stringify(v)}`);
  }
  return v.toLowerCase();
}

function reqString(row: Record<string, unknown>, key: string, opts?: { allowEmpty?: boolean }): string {
  const v = row[key];
  if (typeof v !== "string" || (!opts?.allowEmpty && v.length === 0)) {
    throw new RowError(`${key} must be a non-empty string`);
  }
  return v;
}

function optString(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new RowError(`${key} must be a string or null`);
  return v;
}

function optNumber(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new RowError(`${key} must be a finite number or null`);
  }
  return v;
}

function reqDate(row: Record<string, unknown>, key: string): Date {
  const v = row[key];
  if (typeof v !== "string") throw new RowError(`${key} must be an ISO 8601 timestamp string`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new RowError(`${key} is not a parseable timestamp: ${JSON.stringify(v)}`);
  return d;
}

function optDate(row: Record<string, unknown>, key: string): Date | null {
  const v = row[key];
  if (v === undefined || v === null) return null;
  return reqDate(row, key);
}

// ── Section walker ───────────────────────────────────────────────────────────

function walkSection<T>(
  root: Record<string, unknown>,
  section: string,
  errors: string[],
  parseRow: (row: Record<string, unknown>) => T,
): T[] {
  const raw = root[section];
  if (raw === undefined || raw === null) return []; // client-side subsetting may delete sections
  if (!Array.isArray(raw)) {
    errors.push(`"${section}" must be an array when present`);
    return [];
  }
  const out: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (errors.length >= MAX_REPORTED_ERRORS) break;
    const row = raw[i];
    if (!isRecord(row)) {
      errors.push(`${section}[${i}]: must be an object`);
      continue;
    }
    try {
      out.push(parseRow(row));
    } catch (err) {
      if (err instanceof RowError) {
        errors.push(`${section}[${i}]: ${err.message}`);
      } else {
        throw err;
      }
    }
  }
  return out;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function parseExportPayload(json: unknown): ParseExportResult {
  if (!isRecord(json)) {
    return {
      ok: false,
      error:
        "Import body must be a JSON object — upload the file downloaded from GET /auth/me/export as-is.",
    };
  }

  const schemaVersion = json["schemaVersion"];
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return {
      ok: false,
      error:
        'Missing or non-integer "schemaVersion" — this does not look like a Soup.net export file (expected the JSON from GET /auth/me/export).',
    };
  }
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)) {
    return {
      ok: false,
      error:
        `Unsupported export schemaVersion ${schemaVersion} — this server imports version(s) ` +
        `${SUPPORTED_SCHEMA_VERSIONS.join(", ")}. The version integer only changes on breaking ` +
        `export-format changes, so this file was produced by an incompatible Soup.net version; ` +
        `re-export from a matching instance or upgrade this server.`,
    };
  }

  const errors: string[] = [];

  const traces = walkSection(json, "traces", errors, (row): ImportTraceRow => ({
    id: idOrMint(row),
    groupId: optUuid(row, "groupId"),
    claimText: reqString(row, "claimText"),
    claimTextHash: optString(row, "claimTextHash"),
    formatAdherenceScore: optNumber(row, "formatAdherenceScore"),
    decidedAt: optDate(row, "decidedAt"),
    createdAt: reqDate(row, "createdAt"),
    updatedAt: optDate(row, "updatedAt"),
  }));

  const evidence = walkSection(json, "evidence", errors, (row): ImportEvidenceRow => ({
    id: idOrMint(row),
    content: reqString(row, "content", { allowEmpty: true }),
    createdAt: reqDate(row, "createdAt"),
    updatedAt: optDate(row, "updatedAt"),
  }));

  const references = walkSection(json, "references", errors, (row): ImportReferenceRow => ({
    id: idOrMint(row),
    quote: reqString(row, "quote", { allowEmpty: true }),
    source: reqString(row, "source", { allowEmpty: true }),
    fileUrl: optString(row, "fileUrl"),
    fileMimeType: optString(row, "fileMimeType"),
    fileHash: optString(row, "fileHash"),
    createdAt: reqDate(row, "createdAt"),
  }));

  const traceEvidence = walkSection(json, "traceEvidence", errors, (row): ImportTraceEvidenceRow => {
    const stance = reqString(row, "stance");
    if (stance !== "for" && stance !== "against") {
      throw new RowError(`stance must be "for" or "against", got ${JSON.stringify(stance)}`);
    }
    return {
      id: idOrMint(row),
      traceId: reqUuid(row, "traceId"),
      evidenceId: reqUuid(row, "evidenceId"),
      stance,
      apiKeyId: optUuid(row, "apiKeyId"),
      createdAt: reqDate(row, "createdAt"),
    };
  });

  const traceReferences = walkSection(json, "traceReferences", errors, (row): ImportTraceReferenceRow => ({
    id: idOrMint(row),
    traceId: reqUuid(row, "traceId"),
    referenceId: reqUuid(row, "referenceId"),
    apiKeyId: optUuid(row, "apiKeyId"),
    createdAt: reqDate(row, "createdAt"),
  }));

  const evidenceReferences = walkSection(json, "evidenceReferences", errors, (row): ImportEvidenceReferenceRow => ({
    id: idOrMint(row),
    evidenceId: reqUuid(row, "evidenceId"),
    referenceId: reqUuid(row, "referenceId"),
    createdAt: reqDate(row, "createdAt"),
  }));

  const books = walkSection(json, "groupMemberships", errors, (row): ImportBookInfo => ({
    groupId: reqUuid(row, "groupId"),
    name: optString(row, "name"),
    slug: optString(row, "slug"),
    description: optString(row, "description"),
  }));

  if (errors.length > 0) {
    const truncated = errors.length >= MAX_REPORTED_ERRORS ? " (further errors truncated)" : "";
    return {
      ok: false,
      error: `Export file failed validation:\n- ${errors.join("\n- ")}${truncated}`,
    };
  }

  // Duplicate trace ids inside one file would make insert results ambiguous —
  // keep the first occurrence, drop exact repeats deterministically.
  const seen = new Set<string>();
  const dedupedTraces = traces.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  return {
    ok: true,
    data: {
      schemaVersion,
      traces: dedupedTraces,
      evidence: dedupeById(evidence),
      references: dedupeById(references),
      traceEvidence: dedupeById(traceEvidence),
      traceReferences: dedupeById(traceReferences),
      evidenceReferences: dedupeById(evidenceReferences),
      books,
    },
  };
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
