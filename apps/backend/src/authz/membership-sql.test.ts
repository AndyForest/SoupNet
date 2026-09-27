import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { countsAsMembership, membershipOf, membershipOfSomeoneElse } from "./membership-sql";

// Layer 1 — the membership condition, rendered without a database. These pin
// the SQL each fragment produces today, and that every statement in the module
// gets its membership condition from this one file.

const dialect = new PgDialect();
const USER = "11111111-1111-4111-8111-111111111111";

describe("membership SQL fragments", () => {
  it("countsAsMembership is the row-level condition, and today every row counts", () => {
    const q = dialect.sqlToQuery(countsAsMembership("gm"));
    expect(q.sql).toBe("TRUE");
    expect(q.params).toEqual([]);
  });

  it("membershipOf binds the user id and composes the row-level condition", () => {
    const q = dialect.sqlToQuery(membershipOf("gm", USER));
    expect(q.sql).toBe("(gm.user_id = $1::uuid AND TRUE)");
    expect(q.params).toEqual([USER]);
  });

  it("membershipOfSomeoneElse is the same condition for every other user", () => {
    const q = dialect.sqlToQuery(membershipOfSomeoneElse("other", USER));
    expect(q.sql).toBe("(other.user_id <> $1::uuid AND TRUE)");
    expect(q.params).toEqual([USER]);
  });

  it("uses the alias it is given, from a closed set", () => {
    expect(dialect.sqlToQuery(membershipOf("me", USER)).sql).toBe("(me.user_id = $1::uuid AND TRUE)");
    // An alias outside the set is a type error; at runtime it fails rather
    // than reaching the statement as raw text.
    expect(() => membershipOf("gm; DROP TABLE x" as unknown as "gm", USER)).toThrow();
    expect(() => countsAsMembership("toString" as unknown as "gm")).toThrow();
  });
});

describe("the module has one membership condition", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "membership-sql.ts")
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf-8") }));

  it("finds the module's statement files (every file in the directory is held to the rules below)", () => {
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining(["book-access.ts", "book-succession.ts", "memberships.ts", "trace-access.ts"]),
    );
  });

  it("no other file compares a membership row's user id by hand", () => {
    // `gm.user_id = …`, `other.user_id <> …`, `gm.user_id IS NOT NULL`: each is
    // a hand-written copy of the condition. Selecting or joining on the column
    // (`SELECT gm.user_id`, `ON u.id = gm.user_id`) is not.
    const handWritten = /\b(gm|me|other)\.user_id\s*(=|<>|!=|IS\b)/;
    for (const { file, text } of sources) {
      expect(handWritten.test(text), `${file} hand-writes the membership condition`).toBe(false);
    }
  });

  it("every file that reads or gates on the membership table uses the fragments", () => {
    for (const { file, text } of sources) {
      if (!/claimnet\.group_members/.test(text)) continue;
      expect(
        /\$\{(countsAsMembership|membershipOf|membershipOfSomeoneElse)\(/.test(text),
        `${file} touches the membership table without the shared condition`,
      ).toBe(true);
    }
  });

  it("the trace read rule is written once, in roles.ts — no SQL copy of it", () => {
    const access = sources.find((s) => s.file === "trace-access.ts")?.text ?? "";
    expect(access).toContain("mayReadTrace(");
    // The old SQL form: `t.user_id = … OR gm.user_id IS NOT NULL`.
    for (const { file, text } of sources) {
      expect(/\bOR\s+gm\./i.test(text), `${file} decides read access in SQL`).toBe(false);
    }
  });
});
