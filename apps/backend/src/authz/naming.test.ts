import { describe, it, expect } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { normalizeOnBehalfOf, resolveNameableSubject } from "./naming";

// Slice 4 (rubric S4-M1): who may be named is decided once, from one
// statement that is the same whatever the email. The live cases (a writer,
// a member of another book only, an unverified account, an unknown email)
// are walked end to end in routes/drafts-on-behalf.test.ts.

const dialect = new PgDialect();
const BOOK = "33333333-3333-4333-8333-333333333333";

function capturingDb(rows: unknown[]): { db: Pick<PostgresJsDatabase, "execute">; statements: SQL[] } {
  const statements: SQL[] = [];
  const db = {
    execute: async (q: SQL) => {
      statements.push(q);
      return rows;
    },
  } as unknown as Pick<PostgresJsDatabase, "execute">;
  return { db, statements };
}

describe("normalizeOnBehalfOf", () => {
  it("absent, null, and blank mean absent; anything else is trimmed and lower-cased", () => {
    expect(normalizeOnBehalfOf(undefined)).toEqual({ present: false });
    expect(normalizeOnBehalfOf(null)).toEqual({ present: false });
    expect(normalizeOnBehalfOf("   ")).toEqual({ present: false });
    expect(normalizeOnBehalfOf("  Pat@Example.TEST ")).toEqual({ present: true, email: "pat@example.test" });
    expect(normalizeOnBehalfOf("not an email")).toEqual({ present: true, email: "not an email" });
  });

  it("a non-string is present and names nobody (refused like an unknown email)", () => {
    expect(normalizeOnBehalfOf(42)).toEqual({ present: true, email: "" });
    expect(normalizeOnBehalfOf({ email: "x" })).toEqual({ present: true, email: "" });
  });
});

describe("resolveNameableSubject", () => {
  it("runs one statement, the same shape for every input, composing the membership, write-role, and account-state rules", async () => {
    const shapes = new Set<string>();
    for (const email of ["pat@example.test", "  PAT@example.test ", "nobody@example.test", "not an email", ""]) {
      const { db, statements } = capturingDb([]);
      expect(await resolveNameableSubject(db, { email, bookId: BOOK })).toBeNull();
      expect(statements.length).toBe(1);
      const q = dialect.sqlToQuery(statements[0]!);
      shapes.add(q.sql);
      expect(q.sql).toContain("lower(u.email) = ");
      expect(q.sql).toContain("gm.user_id = u.id");
      expect(q.sql).toContain("gm.role IN");
      expect(q.sql).toContain("u.email_verified_at IS NOT NULL");
      expect(q.params).toEqual(expect.arrayContaining([BOOK, "owner", "admin", "member", email.trim().toLowerCase()]));
    }
    expect(shapes.size).toBe(1);
  });

  it("returns the person's id and stored email when the statement finds them", async () => {
    const { db } = capturingDb([{ userId: "u1", email: "Pat@example.test" }]);
    expect(await resolveNameableSubject(db, { email: "pat@example.test", bookId: BOOK })).toEqual({ userId: "u1", email: "Pat@example.test" });
  });
});
