/**
 * Generates docs/architecture/data-model-generated.md from the latest
 * Drizzle migration snapshot JSON.
 *
 * This is the deterministic phase of data model documentation.
 * The output contains:
 *   - Mermaid ER diagram with all tables, columns, and relationships
 *   - Markdown column tables for every table
 *   - Index and constraint listings
 *
 * Usage:
 *   npx tsx scripts/generate-data-model-docs.ts
 *
 * The generated file should NOT be hand-edited. Regenerate after
 * running `drizzle-kit generate` for any schema change.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Types for Drizzle snapshot JSON ─────────────────────────────────────────

interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string;
}

interface SnapshotIndexColumn {
  expression: string;
  isExpression: boolean;
  asc: boolean;
  nulls: string;
}

interface SnapshotIndex {
  name: string;
  columns: SnapshotIndexColumn[];
  isUnique: boolean;
  method: string;
  with?: Record<string, string>;
}

interface SnapshotFK {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
}

interface SnapshotUnique {
  name: string;
  columns: string[];
}

interface SnapshotTable {
  name: string;
  schema: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<string, SnapshotFK>;
  uniqueConstraints: Record<string, SnapshotUnique>;
}

interface Snapshot {
  id: string;
  version: string;
  dialect: string;
  tables: Record<string, SnapshotTable>;
}

// ── Find latest snapshot ────────────────────────────────────────────────────

const projectRoot = process.cwd();

const migrationsMetaDir = join(
  projectRoot,
  "packages",
  "db",
  "migrations",
  "meta"
);

const journalPath = join(migrationsMetaDir, "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
const latestEntry = journal.entries.reduce((a, b) => (b.idx > a.idx ? b : a));
const latestIdx = latestEntry.idx;
const snapshotPath = join(migrationsMetaDir, `${String(latestIdx).padStart(4, "0")}_snapshot.json`);
// Deterministic "as of" date: the latest migration's own timestamp, NOT
// wall-clock. Wall-clock would make this doc differ from its committed copy
// every day, breaking the regenerate-and-diff drift check (npm run
// check:data-model) even when the schema is unchanged.
const latestMigrationDate = new Date(latestEntry.when).toISOString().split("T")[0];

const snapshot: Snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));
const tables = Object.values(snapshot.tables).sort((a, b) =>
  a.name.localeCompare(b.name)
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function sqlTypeShort(type: string): string {
  return type
    .replace("timestamp with time zone", "timestamptz")
    .replace("character varying", "varchar");
}

function mermaidType(type: string): string {
  // Mermaid erDiagram doesn't support special chars well
  return sqlTypeShort(type)
    .replace(/\(.*\)/, "") // strip length/precision
    .replace(/ /g, "_");
}

// Logical table groups for the ToC index and column-table sections.
//
// This map is the ONE hand-maintained input to this generator: it assigns
// every table to a category. When you add a table to the schema, add it here
// too. If you don't, generation FAILS LOUDLY (see the coverage guard below)
// rather than silently dropping the table from the index and the per-table
// column sections — a drift that shipped once (header claimed 27 tables while
// the index listed 20). Fail-loud makes that drift structurally impossible to
// ship; recipe 9d43fe77.
const tableGroups: Record<string, string[]> = {
  "Identity & Access": ["users", "organizations", "groups", "group_members", "ephemeral_books"],
  "Core Content": ["traces", "evidence", "references", "uploads"],
  "Linking": ["trace_evidence", "trace_references", "evidence_references"],
  "Feedback & Reactions": [
    "check_feedback",
    "check_feedback_stars",
    "trace_reactions",
    "session_shown",
  ],
  "Auth & Admin": [
    "api_keys",
    "oauth_clients",
    "oauth_authorization_codes",
    "invitations",
    "system_settings",
    "audit_log",
    "email_log",
  ],
  "Embedding Pipeline": [
    "embedding_sources",
    "embedding_chunk_strategies",
    "embedding_chunks",
    "embedding_vectors",
  ],
  "Caching": ["reference_source_cache", "vector_cache"],
};

// ── Coverage guard: every snapshot table must be categorized ────────────────
//
// Fail loudly if the snapshot contains a table absent from tableGroups, or if
// tableGroups names a table that no longer exists in the snapshot. Either way
// the doc would be wrong (a dropped table, or a broken ToC anchor), so refuse
// to write it and tell the developer exactly what to fix.
{
  const snapshotNames = new Set(tables.map((t) => t.name));
  const categorizedNames = new Set(Object.values(tableGroups).flat());

  const uncategorized = [...snapshotNames]
    .filter((name) => !categorizedNames.has(name))
    .sort();
  const stale = [...categorizedNames]
    .filter((name) => !snapshotNames.has(name))
    .sort();

  if (uncategorized.length > 0 || stale.length > 0) {
    const lines = [
      "data-model doc generation FAILED: tableGroups is out of sync with the Drizzle snapshot.",
      "",
      `Edit the tableGroups map in scripts/generate-data-model-docs.ts (snapshot: ${snapshotPath
        .split(/[\\/]/)
        .pop()}).`,
    ];
    if (uncategorized.length > 0) {
      lines.push(
        "",
        `  Uncategorized (in snapshot, missing from tableGroups): ${uncategorized.join(", ")}`,
        "    → add each to the most fitting category so it appears in the index and gets a column table."
      );
    }
    if (stale.length > 0) {
      lines.push(
        "",
        `  Stale (in tableGroups, no longer in snapshot): ${stale.join(", ")}`,
        "    → remove each; it would produce a broken ToC anchor and an empty section."
      );
    }
    console.error(`\n${lines.join("\n")}\n`);
    process.exit(1);
  }
}

// ── Generate Mermaid ER diagram ─────────────────────────────────────────────

function generateMermaid(): string {
  const lines: string[] = ["erDiagram"];

  // Collect all FK relationships
  const relationships: string[] = [];
  for (const table of tables) {
    for (const fk of Object.values(table.foreignKeys)) {
      // Determine cardinality: if the FK column is in a unique constraint, it's 1:1
      const fkColsSet = new Set(fk.columnsFrom);
      const isUnique = Object.values(table.uniqueConstraints).some(
        (uc) =>
          uc.columns.length === fk.columnsFrom.length &&
          uc.columns.every((c) => fkColsSet.has(c))
      );
      const card = isUnique ? "||--||" : "}o--||";
      relationships.push(
        `    ${fk.tableFrom} ${card} ${fk.tableTo} : "${fk.columnsFrom.join(", ")}"`
      );
    }
  }

  // Add known UUID-ref relationships (no FK constraint in schema)
  const uuidRefs: [string, string, string][] = [
    ["users", "traces", "user_id"],
    ["groups", "traces", "group_id"],
    ["api_keys", "traces", "api_key_id"],
    ["users", "api_keys", "user_id"],
    ["users", "invitations", "inviter_id"],
    ["groups", "invitations", "group_id"],
    ["users", "audit_log", "actor_user_id"],
    ["groups", "embedding_sources", "group_id"],
    ["api_keys", "trace_evidence", "api_key_id"],
    ["api_keys", "trace_references", "api_key_id"],
  ];
  for (const [to, from, col] of uuidRefs) {
    relationships.push(`    ${from} }o..|| ${to} : "${col}"`);
  }

  // Entity definitions with columns
  for (const table of tables) {
    lines.push("");
    lines.push(`    ${table.name} {`);
    for (const col of Object.values(table.columns)) {
      const mType = mermaidType(col.type);
      const pk = col.primaryKey ? "PK" : "";
      // Check if this column is in any FK
      const isFk = Object.values(table.foreignKeys).some((fk) =>
        fk.columnsFrom.includes(col.name)
      );
      const fkMark = !pk && isFk ? "FK" : "";
      const mark = pk || fkMark;
      lines.push(`        ${mType} ${col.name}${mark ? ` ${mark}` : ""}`);
    }
    lines.push("    }");
  }

  // Relationships
  lines.push("");
  for (const rel of relationships) {
    lines.push(rel);
  }

  return lines.join("\n");
}

// ── Generate markdown column tables ─────────────────────────────────────────

function generateColumnTable(table: SnapshotTable): string {
  const lines: string[] = [];

  lines.push(`### \`claimnet.${table.name}\``);
  lines.push("");
  lines.push("| Column | Type | Nullable | Default | PK |");
  lines.push("|---|---|---|---|---|");

  for (const col of Object.values(table.columns)) {
    const type = sqlTypeShort(col.type);
    const nullable = col.notNull ? "NO" : "YES";
    const def = col.default ?? "";
    const pk = col.primaryKey ? "PK" : "";
    lines.push(`| \`${col.name}\` | \`${type}\` | ${nullable} | ${def ? `\`${def}\`` : ""} | ${pk} |`);
  }

  // Foreign keys
  const fks = Object.values(table.foreignKeys);
  if (fks.length > 0) {
    lines.push("");
    lines.push("**Foreign keys:**");
    for (const fk of fks) {
      lines.push(
        `- \`${fk.columnsFrom.join(", ")}\` → \`${fk.tableTo}.${fk.columnsTo.join(", ")}\``
      );
    }
  }

  // Unique constraints
  const ucs = Object.values(table.uniqueConstraints);
  if (ucs.length > 0) {
    lines.push("");
    lines.push("**Unique constraints:**");
    for (const uc of ucs) {
      lines.push(`- \`${uc.name}\`: \`(${uc.columns.join(", ")})\``);
    }
  }

  // Indexes (non-PK, non-unique-constraint)
  const ucNames = new Set(ucs.map((uc) => uc.name));
  const indexes = Object.values(table.indexes).filter(
    (idx) => !idx.isUnique || !ucNames.has(idx.name)
  );
  if (indexes.length > 0) {
    lines.push("");
    lines.push("**Indexes:**");
    for (const idx of indexes) {
      const cols = idx.columns.map((c) => c.expression).join(", ");
      const unique = idx.isUnique ? " (unique)" : "";
      const method = idx.method !== "btree" ? ` [${idx.method}]` : "";
      const withOpts =
        idx.with && Object.keys(idx.with).length > 0
          ? ` WITH (${Object.entries(idx.with).map(([k, v]) => `${k}=${v}`).join(", ")})`
          : "";
      lines.push(`- \`${idx.name}\`: \`(${cols})\`${unique}${method}${withOpts}`);
    }
  }

  return lines.join("\n");
}

// ── Assemble full document ──────────────────────────────────────────────────

function generate(): string {
  const sections: string[] = [];

  sections.push("# ClaimNet Data Model — Generated Reference");
  sections.push("");
  sections.push("> **Auto-generated** from Drizzle migration snapshot `" + snapshotPath.split(/[\\/]/).pop() + "`.");
  sections.push("> Do not edit by hand. Regenerate with: `npx tsx scripts/generate-data-model-docs.ts`");
  sections.push(">");
  sections.push(`> Schema as of migration \`${latestEntry.tag}\` (${latestMigrationDate}).`);
  sections.push(`> Tables: ${tables.length} | Schema: \`claimnet\``);
  sections.push("");
  sections.push("For design rationale, conventions, and context, see [data-model.md](data-model.md).");
  sections.push("");

  // Table of contents
  sections.push("## Tables");
  sections.push("");
  for (const [group, tableNames] of Object.entries(tableGroups)) {
    sections.push(`**${group}:** ${tableNames.map((t) => `[\`${t}\`](#claimnet${t})`).join(" · ")}`);
  }
  sections.push("");
  sections.push("---");

  // ER diagram
  sections.push("");
  sections.push("## Entity-Relationship Diagram");
  sections.push("");
  sections.push("Solid lines = FK constraints. Dotted lines = UUID references (no FK, service-layer enforced).");
  sections.push("");
  sections.push("```mermaid");
  sections.push(generateMermaid());
  sections.push("```");
  sections.push("");

  // Migration-SQL-only objects
  sections.push("### Objects defined in migration SQL (not in Drizzle snapshot)");
  sections.push("");
  sections.push("These are created by raw SQL in migration files and are not captured in the snapshot JSON:");
  sections.push("");
  sections.push("- **`traces.tsv`** — `tsvector` generated column: `to_tsvector('english', claim_text)`. GIN-indexed (`traces_tsv_idx`).");
  sections.push("- **`embedding_vectors_hnsw_idx`** — HNSW index on `embedding_vectors.vector` using `halfvec_cosine_ops` (m=16, ef_construction=64).");
  sections.push("");
  sections.push("---");

  // Column tables grouped
  for (const [group, tableNames] of Object.entries(tableGroups)) {
    sections.push("");
    sections.push(`## ${group}`);
    sections.push("");
    for (const name of tableNames) {
      const table = tables.find((t) => t.name === name);
      if (table) {
        sections.push(generateColumnTable(table));
        sections.push("");
        sections.push("---");
        sections.push("");
      }
    }
  }

  return sections.join("\n");
}

// ── Write output ────────────────────────────────────────────────────────────

const output = generate();
// DATA_MODEL_OUT lets the drift check (scripts/check-data-model-docs.mjs)
// redirect output to a temp file so it can diff against the committed copy
// without mutating it. Unset in normal use → writes the canonical doc.
const outPath =
  process.env.DATA_MODEL_OUT ??
  join(projectRoot, "docs", "architecture", "data-model-generated.md");
writeFileSync(outPath, output, "utf-8");
console.log(`Wrote ${outPath}`);
console.log(`  ${tables.length} tables, ${Object.values(snapshot.tables).reduce((sum, t) => sum + Object.keys(t.columns).length, 0)} columns`);
