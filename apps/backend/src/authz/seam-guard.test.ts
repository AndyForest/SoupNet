import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// [F80][F84] The authz seam guard (scripts/check-authz-seam.mjs) against planted
// bypasses of its recipe register, TRACE_READS. Each plant stands in for a
// real file (or adds a new one) through AUTHZ_SEAM_OVERRIDES, so the working
// tree is never touched; every plant must make the guard fail, and the
// unmodified tree must pass.

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const script = join(repo, "scripts", "check-authz-seam.mjs");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "seam-guard-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Run the guard with `overrides` (repo path → content); true when it passes. */
function guardPasses(overrides: Record<string, string>): { ok: boolean; output: string } {
  const map: Record<string, string> = {};
  let i = 0;
  for (const [path, content] of Object.entries(overrides)) {
    const file = join(dir, `plant-${i++}.ts`);
    writeFileSync(file, content);
    map[path] = file;
  }
  try {
    const output = execFileSync(process.execPath, [script], {
      cwd: repo,
      env: { ...process.env, AUTHZ_SEAM_OVERRIDES: JSON.stringify(map) },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function read(path: string): string {
  return readFileSync(join(repo, path), "utf-8");
}

/** Remove the first line matching `pattern` (the plant must actually change the file). */
function withoutLine(text: string, pattern: RegExp): string {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => pattern.test(l));
  if (at < 0) throw new Error(`fixture line not found: ${pattern}`);
  lines.splice(at, 1);
  return lines.join("\n");
}

const NEW_FILE = "apps/backend/src/services/zz-planted.ts";

describe("[F80][F84] the recipe register catches each planted bypass", { timeout: 60_000 }, () => {
  it("the unmodified tree passes", () => {
    expect(guardPasses({}).ok).toBe(true);
  });

  it("deleting the draft condition from hybridSearch's shared predicates fails", () => {
    const path = "apps/backend/src/services/vector-search.service.ts";
    const r = guardPasses({ [path]: withoutLine(read(path), /traceIdVisibleTo\(/) });
    expect(r.ok).toBe(false);
    expect(r.output).toContain(path);
  });

  it("dropping the draft condition from the Index figures' shared scope fails", () => {
    const path = "apps/backend/src/services/book-stats.service.ts";
    const planted = read(path).replace(/const inScope = sql`[^\n]*`;/, "const inScope = inBooks(sql`t.group_id`, groupIds);");
    expect(planted).not.toBe(read(path));
    const r = guardPasses({ [path]: planted });
    expect(r.ok).toBe(false);
    expect(r.output).toContain(path);
  });

  const plants: Array<[string, string]> = [
    ["an unqualified FROM traces", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT id FROM traces`;\n'],
    ["a quoted schema-qualified name", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT id FROM "claimnet"."traces"`;\n'],
    ["an aliased Drizzle import", 'import { traces as T } from "@soupnet/db";\nexport const q = (db: any) => db.select().from(T);\n'],
    ["an interpolated Drizzle table", 'import { sql } from "drizzle-orm";\nimport { traces } from "@soupnet/db";\nexport const q = sql`SELECT * FROM ${traces}`;\n'],
    ["the relational query API", "export const q = (db: any) => db.query.traces.findMany();\n"],
    ["a namespace import", 'import * as s from "@soupnet/db";\nexport const q = (db: any) => db.select().from(s.traces);\n'],
    ["a recipe link table", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT content FROM claimnet.trace_evidence`;\n'],
    ["feedback about recipes", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT related_trace_ids FROM claimnet.check_feedback`;\n'],
    ["reactions on recipes", 'import { checkFeedback, traceReactions } from "@soupnet/db";\nexport const q = (db: any) => db.select().from(traceReactions);\n'],
    // [F84] Forms the line-by-line match missed.
    ["a schema qualifier split across lines", 'import { sql } from "drizzle-orm";\nexport const q = sql`\n  SELECT id\n  FROM\n    claimnet.\n    traces t`;\n'],
    ["FROM and an unqualified table on separate lines", 'import { sql } from "drizzle-orm";\nexport const q = sql`\n  SELECT id FROM\n    traces`;\n'],
    ["sql.identifier", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT id FROM ${sql.identifier("claimnet")}.${sql.identifier("traces")}`;\n'],
    ["a destructured dynamic import", 'export async function q(db: any) {\n  const { traces } = await import("@soupnet/db");\n  return db.select().from(traces);\n}\n'],
    ["a renamed destructured dynamic import", 'export async function q(db: any) {\n  const { traces: T } = await import("@soupnet/db");\n  return db.select().from(T);\n}\n'],
    ["a namespace dynamic import", 'export async function q(db: any) {\n  const s = await import("@soupnet/db");\n  return db.select().from(s.traces);\n}\n'],
    ["the embedded chunk text", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT chunk_text FROM claimnet.embedding_chunks`;\n'],
  ];

  it("[F84] deleting a draft condition from a statement whose table name is split across lines fails", () => {
    const path = "apps/backend/src/services/zz-registered-plant.ts";
    // Not registered at all, so the plant must fail however it is written;
    // this pins that the split form is a mention in the first place.
    const r = guardPasses({ [path]: 'import { sql } from "drizzle-orm";\nexport const q = sql`\n  SELECT count(*) FROM\n  claimnet\n  .traces t`;\n' });
    expect(r.ok, r.output).toBe(false);
    expect(r.output).toContain(path);
  });

  it("[F84] a table name that merely resembles a recipe table does not count", () => {
    const r = guardPasses({ [NEW_FILE]: 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT id FROM\n  claimnet.traces_archive_view`;\n' });
    expect(r.ok, r.output).toBe(true);
  });
  for (const [name, content] of plants) {
    it(`a new unregistered file reading recipes through ${name} fails`, () => {
      const r = guardPasses({ [NEW_FILE]: content });
      expect(r.ok, r.output).toBe(false);
      expect(r.output).toContain(NEW_FILE);
    });
  }
});
