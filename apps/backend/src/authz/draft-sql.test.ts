import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  publishedTrace,
  traceVisibleTo,
  traceIdVisibleTo,
  traceReadableById,
  SHARED_AUDIENCE,
} from "./draft-sql";
import { mayReadTrace, isPublishedDraftState, mayResolveDraft } from "./roles";

// Drafts-and-triage slice 2, S2-M1 / DT-VIS-14: the draft visibility rule is
// written once in the authz module — one JS rule (`mayReadTrace`, roles.ts)
// for single-recipe reads and one set of SQL fragments (this file's subject)
// for every set-returning statement — and nothing outside draft-sql.ts writes
// the condition by hand. The DB-backed half at the bottom proves the SQL and
// the JS rule give the same answer on every combination of facts.

const dialect = new PgDialect();
const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("draft SQL fragments (Layer 1)", () => {
  it("publishedTrace is an ordinary recipe or a verified draft", () => {
    const q = dialect.sqlToQuery(publishedTrace("t"));
    expect(q.sql).toBe("(t.draft_state IS NULL OR t.draft_state = 'verified')");
    expect(q.params).toEqual([]);
  });

  it("the shared audience sees published recipes only, and binds nothing", () => {
    expect(dialect.sqlToQuery(traceVisibleTo("t", SHARED_AUDIENCE))).toEqual(dialect.sqlToQuery(publishedTrace("t")));
  });

  it("a viewer's result sets add their own unverified drafts, with the viewer bound", () => {
    const q = dialect.sqlToQuery(traceVisibleTo("tr", { viewerUserId: VIEWER }));
    expect(q.sql).toContain("tr.draft_state IS NULL OR tr.draft_state = 'verified'");
    expect(q.sql).toContain("tr.draft_state = 'unverified'");
    expect(q.sql).toContain("tr.user_id = $1::uuid");
    expect(q.params.every((p) => p === VIEWER)).toBe(true);
  });

  it("by-id reads add the viewer's own drafts in any state", () => {
    const q = dialect.sqlToQuery(traceReadableById("t", VIEWER));
    expect(q.sql).toContain("t.draft_state IS NULL OR t.draft_state = 'verified'");
    expect(q.sql).not.toContain("'unverified'");
    expect(q.sql).toContain("t.user_id = $1::uuid");
  });

  it("the id-keyed form reads the draft state from claimnet.traces, never from a copy", () => {
    const q = dialect.sqlToQuery(traceIdVisibleTo(sql`es.source_id`, { viewerUserId: VIEWER }));
    expect(q.sql).toContain("claimnet.traces dv");
    expect(q.sql).toContain("dv.id = es.source_id");
    expect(q.sql).not.toMatch(/es\.draft/);
  });

  it("uses an alias from a closed set", () => {
    expect(() => publishedTrace("t; DROP TABLE x" as unknown as "t")).toThrow();
    expect(() => traceReadableById("toString" as unknown as "t", VIEWER)).toThrow();
  });
});

describe("the JS read rule (Layer 1)", () => {
  const base = { isAuthor: false, role: null as string | null, isDraftSubject: false, isDraftDepositor: false };

  it("published recipes keep the old rule: the author, or any membership", () => {
    for (const draftState of [null, "verified"]) {
      expect(mayReadTrace({ ...base, draftState, role: "member" })).toBe(true);
      expect(mayReadTrace({ ...base, draftState, isAuthor: true })).toBe(true);
      expect(mayReadTrace({ ...base, draftState })).toBe(false);
    }
  });

  it("an unpublished draft is readable only by its subject or depositor, whatever the viewer's role", () => {
    for (const draftState of ["unverified", "rejected", "not_chosen", "garbage"]) {
      expect(mayReadTrace({ ...base, draftState, role: "owner" })).toBe(false);
      expect(mayReadTrace({ ...base, draftState, role: "member", isAuthor: true })).toBe(false);
      expect(mayReadTrace({ ...base, draftState, isDraftSubject: true })).toBe(true);
      expect(mayReadTrace({ ...base, draftState, isDraftDepositor: true })).toBe(true);
    }
  });

  it("an unrecognized draft state counts as unpublished (fails closed)", () => {
    expect(isPublishedDraftState("Verified")).toBe(false);
    expect(isPublishedDraftState("")).toBe(false);
    expect(isPublishedDraftState(null)).toBe(true);
    expect(isPublishedDraftState(undefined)).toBe(true);
  });

  it("only the subject may resolve, and only an unverified draft", () => {
    expect(mayResolveDraft({ draftState: "unverified", isDraftSubject: true })).toBe(true);
    expect(mayResolveDraft({ draftState: "unverified", isDraftSubject: false })).toBe(false);
    for (const s of [null, "verified", "rejected", "not_chosen"]) {
      expect(mayResolveDraft({ draftState: s, isDraftSubject: true })).toBe(false);
    }
  });
});

describe("the draft condition is written once", () => {
  const backendSrc = fileURLToPath(new URL("..", import.meta.url));

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }
  const sources = walk(backendSrc)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: relative(backendSrc, f).split(sep).join("/"), text: readFileSync(f, "utf-8") }));

  it("finds the backend's sources, the module's included", () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(["authz/draft-sql.ts", "authz/roles.ts", "services/trace.service.ts"]));
  });

  it("no file but authz/draft-sql.ts compares or tests draft_state in SQL", () => {
    // Selecting the column, inserting it, or setting it in the module's own
    // resolution statement is not a condition; `draft_state IS …`,
    // `draft_state = …` in a WHERE, `draft_state <> …`, `draft_state IN (…)` are.
    const handWritten = /draft_state\s*(=|<>|!=|\bIS\b|\bIN\b)/i;
    for (const { file, text } of sources) {
      if (file === "authz/draft-sql.ts" || file === "authz/draft-resolution.ts") continue;
      expect(handWritten.test(text), `${file} hand-writes the draft condition`).toBe(false);
    }
  });

  it("the JS rule lives in roles.ts and is the only place draft states are judged in JS", () => {
    const roles = sources.find((s) => s.file === "authz/roles.ts")?.text ?? "";
    expect(roles).toContain("export function mayReadTrace(");
    expect(roles).toContain("export function isPublishedDraftState(");
    for (const { file, text } of sources) {
      if (file === "authz/roles.ts") continue;
      expect(/draftState\s*===?\s*["']verified["']/.test(text), `${file} judges publication by hand`).toBe(false);
    }
  });
});

// ── SQL ⇔ JS parity (needs a database; skipped without one) ────────────────

const canConnect = !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);

describe.skipIf(!canConnect)("the SQL fragments and mayReadTrace agree on every combination", () => {
  const states: Array<string | null> = [null, "unverified", "verified", "rejected", "not_chosen", "garbage"];
  const owners = [VIEWER, OTHER];

  it("by-id SQL equals mayReadTrace for an author-or-member viewer", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    for (const draftState of states) {
      for (const owner of owners) {
        const rows = await db.execute(sql`
          SELECT ${traceReadableById("t", VIEWER)} AS ok
          FROM (VALUES (${owner}::uuid, ${draftState}::text)) AS t(user_id, draft_state)
        `);
        const sqlSays = (rows as unknown as Array<{ ok: boolean }>)[0]?.ok === true;
        const own = owner === VIEWER;
        // A viewer who reached a by-id statement through scope is a member (or
        // the author); the JS rule's answer for that viewer:
        const jsSays = mayReadTrace({ isAuthor: own, role: "member", draftState, isDraftSubject: own, isDraftDepositor: own });
        expect(sqlSays, `state=${String(draftState)} own=${own}`).toBe(jsSays);
      }
    }
  });

  it("result-set SQL is the by-id rule narrowed to unverified drafts, and the shared audience sees published only", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    for (const draftState of states) {
      for (const owner of owners) {
        const rows = await db.execute(sql`
          SELECT ${traceVisibleTo("t", { viewerUserId: VIEWER })} AS viewer,
                 ${traceVisibleTo("t", SHARED_AUDIENCE)} AS shared
          FROM (VALUES (${owner}::uuid, ${draftState}::text)) AS t(user_id, draft_state)
        `);
        const row = (rows as unknown as Array<{ viewer: boolean; shared: boolean }>)[0]!;
        const own = owner === VIEWER;
        const published = isPublishedDraftState(draftState);
        expect(row.shared, `shared state=${String(draftState)}`).toBe(published);
        expect(row.viewer, `viewer state=${String(draftState)} own=${own}`).toBe(published || (own && draftState === "unverified"));
      }
    }
  });
});
