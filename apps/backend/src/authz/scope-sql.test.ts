import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { inBooks } from "./scope-sql";

// Layer 1 — a caller's book scope rendered as SQL, without a database.

const dialect = new PgDialect();
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("inBooks", () => {
  it("an empty scope is FALSE: the statement reads nothing and stays valid SQL", () => {
    const q = dialect.sqlToQuery(inBooks(sql`t.group_id`, []));
    expect(q.sql).toBe("FALSE");
    expect(q.params).toEqual([]);
  });

  it("a non-empty scope is an IN list of bound uuids, in order", () => {
    const q = dialect.sqlToQuery(inBooks(sql`es.group_id`, [A, B]));
    expect(q.sql).toBe("es.group_id IN ($1::uuid, $2::uuid)");
    expect(q.params).toEqual([A, B]);
  });
});

describe("book scope reaches SQL only through inBooks", () => {
  // The hand-written form that breaks on an empty scope: a book-id list
  // joined into SQL by hand, whether straight into an IN (…) or through a
  // variable used there later. Any name that says it holds book ids counts
  // (groupIds, params.groupIds, readGroupIds, liveReadGroupIds, bookIds, …).
  // An ARRAY[…] constructor is not an IN list and is left alone.
  const handWritten = /(?<!ARRAY\[\$\{)sql\.join\(\s*\[?\.{0,3}[\w.]*(?:GroupIds|groupIds|BookIds|bookIds)\b/;
  const srcRoot = fileURLToPath(new URL("..", import.meta.url));

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "scope-sql.ts" ? [full] : [];
    });
  }

  it("no backend source file joins a book-id list into SQL by hand", () => {
    const offenders = walk(srcRoot)
      .filter((file) => handWritten.test(readFileSync(file, "utf-8")))
      .map((file) => relative(srcRoot, file).replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });
});
