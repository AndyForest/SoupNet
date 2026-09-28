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
  traceReadableByPerson,
  draftStateShownTo,
  onBehalfSideFor,
  onBehalfPartyFor,
  subjectOf,
  SHARED_AUDIENCE,
} from "./draft-sql";
import { mayReadTrace, isPublishedDraftState, mayResolveDraft, hasWriteAuthority } from "./roles";
import { writeAuthoritySql } from "./draft-resolution";

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
    expect(q.sql).toMatch(/COALESCE\(tr\.subject_user_id, tr\.user_id\) = \$\d::uuid/);
    expect(q.sql).toMatch(/tr\.user_id = \$\d::uuid/);
    expect(q.params.every((p) => p === VIEWER)).toBe(true);
  });

  it("by-id reads add the viewer's own drafts in any state", () => {
    const q = dialect.sqlToQuery(traceReadableById("t", VIEWER));
    expect(q.sql).toContain("t.draft_state IS NULL OR t.draft_state = 'verified'");
    expect(q.sql).not.toContain("'unverified'");
    expect(q.sql).toMatch(/t\.user_id = \$\d::uuid/);
  });

  it("the id-keyed form reads the draft state from claimnet.traces, never from a copy", () => {
    const q = dialect.sqlToQuery(traceIdVisibleTo(sql`es.source_id`, { viewerUserId: VIEWER }));
    expect(q.sql).toContain("claimnet.traces dv");
    expect(q.sql).toContain("dv.id = es.source_id");
    expect(q.sql).not.toMatch(/es\.draft/);
  });

  it("[S4-M2] the subject is the on-behalf column where set, and the author otherwise", () => {
    expect(dialect.sqlToQuery(subjectOf("t")).sql).toBe("COALESCE(t.subject_user_id, t.user_id)");
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
    const write = { canWriteBook: true };
    expect(mayResolveDraft({ draftState: "unverified", isDraftSubject: true, ...write })).toBe(true);
    expect(mayResolveDraft({ draftState: "unverified", isDraftSubject: false, ...write })).toBe(false);
    for (const s of [null, "verified", "rejected", "not_chosen"]) {
      expect(mayResolveDraft({ draftState: s, isDraftSubject: true, ...write })).toBe(false);
    }
  });

  it("[F78][F79] resolving needs write authority on the draft's book at that moment", () => {
    expect(mayResolveDraft({ draftState: "unverified", isDraftSubject: true, canWriteBook: false })).toBe(false);
  });

  it("[F78][F79] write authority: a key's effective write scope, or a live write-capable membership", () => {
    expect(hasWriteAuthority({ kind: "key", writeGroupIds: ["b1"] }, "b1")).toBe(true);
    expect(hasWriteAuthority({ kind: "key", writeGroupIds: ["b2"] }, "b1")).toBe(false);
    expect(hasWriteAuthority({ kind: "key", writeGroupIds: [] }, "b1")).toBe(false);
    for (const role of ["owner", "admin", "member"]) {
      expect(hasWriteAuthority({ kind: "member", role }, "b1"), role).toBe(true);
    }
    for (const role of [null, undefined, "viewer", ""]) {
      expect(hasWriteAuthority({ kind: "member", role }, "b1"), String(role)).toBe(false);
    }
  });

  it("[F78][F79] resolveDraft renders the write-authority condition inside its UPDATE", () => {
    const keySql = dialect.sqlToQuery(writeAuthoritySql("t", { kind: "key", writeGroupIds: ["11111111-1111-4111-8111-111111111111"] }, VIEWER));
    expect(keySql.sql).toContain("t.group_id IN");
    expect(dialect.sqlToQuery(writeAuthoritySql("t", { kind: "key", writeGroupIds: [] }, VIEWER)).sql).toBe("FALSE");
    const memberSql = dialect.sqlToQuery(writeAuthoritySql("t", { kind: "member" }, VIEWER));
    expect(memberSql.sql).toContain("claimnet.group_members me");
    expect(memberSql.sql).toContain("me.group_id = t.group_id");
    expect(memberSql.params).toEqual(expect.arrayContaining([VIEWER, "owner", "admin", "member"]));
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

  it("[S4-M4] only the resolving statement changes an existing recipe's author or subject", () => {
    // An UPDATE of claimnet.traces whose SET names user_id or subject_user_id,
    // or a Drizzle .update(...).set({ userId | subjectUserId }).
    const sqlUpdate = /UPDATE\s+claimnet\.traces\b[^`]*?\bSET\b(?:(?!\bWHERE\b)[^`])*?\b(user_id|subject_user_id)\s*=/i;
    const drizzleUpdate = /\.update\([^)]*\)\s*\.set\(\s*\{[^}]*\b(userId|subjectUserId)\s*:/;
    const writers = sources
      .filter(({ text }) => sqlUpdate.test(text) || drizzleUpdate.test(text))
      .map(({ file }) => file);
    expect(writers).toEqual(["authz/draft-resolution.ts"]);
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

/**
 * Slice 4 (S4-M2): the subject and the depositor vary separately. Each row
 * is an author (the depositor while the draft is unpublished) and an
 * on-behalf subject (NULL: about its author). The viewer is the subject only,
 * the depositor only, both, or neither.
 */
const THIRD = "55555555-5555-4555-8555-555555555555";
const PARTIES: Array<{ author: string; subject: string | null; label: string }> = [
  { author: VIEWER, subject: null, label: "viewer's own (subject and depositor)" },
  { author: OTHER, subject: null, label: "someone else's own" },
  { author: OTHER, subject: VIEWER, label: "viewer is subject only" },
  { author: VIEWER, subject: OTHER, label: "viewer is depositor only" },
  { author: OTHER, subject: THIRD, label: "viewer is neither (on-behalf)" },
];
function factsFor(p: { author: string; subject: string | null }) {
  const subject = p.subject ?? p.author;
  return { isAuthor: p.author === VIEWER, isDraftSubject: subject === VIEWER, isDraftDepositor: p.author === VIEWER };
}

describe.skipIf(!canConnect)("the SQL fragments and mayReadTrace agree on every combination", () => {
  const states: Array<string | null> = [null, "unverified", "verified", "rejected", "not_chosen", "garbage"];

  it("by-id SQL equals mayReadTrace for an author-or-member viewer", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    for (const draftState of states) {
      for (const p of PARTIES) {
        const rows = await db.execute(sql`
          SELECT ${traceReadableById("t", VIEWER)} AS ok
          FROM (VALUES (${p.author}::uuid, ${p.subject}::uuid, ${draftState}::text)) AS t(user_id, subject_user_id, draft_state)
        `);
        const sqlSays = (rows as unknown as Array<{ ok: boolean }>)[0]?.ok === true;
        // A viewer who reached a by-id statement through scope is a member (or
        // the author); the JS rule's answer for that viewer:
        const jsSays = mayReadTrace({ ...factsFor(p), role: "member", draftState });
        expect(sqlSays, `state=${String(draftState)} ${p.label}`).toBe(jsSays);
      }
    }
  });

  it("result-set SQL is the by-id rule narrowed to unverified drafts, and the shared audience sees published only", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    for (const draftState of states) {
      for (const p of PARTIES) {
        const rows = await db.execute(sql`
          SELECT ${traceVisibleTo("t", { viewerUserId: VIEWER })} AS viewer,
                 ${traceVisibleTo("t", SHARED_AUDIENCE)} AS shared
          FROM (VALUES (${p.author}::uuid, ${p.subject}::uuid, ${draftState}::text)) AS t(user_id, subject_user_id, draft_state)
        `);
        const row = (rows as unknown as Array<{ viewer: boolean; shared: boolean }>)[0]!;
        const f = factsFor(p);
        const own = f.isDraftSubject || f.isDraftDepositor;
        const published = isPublishedDraftState(draftState);
        expect(row.shared, `shared state=${String(draftState)}`).toBe(published);
        expect(row.viewer, `viewer state=${String(draftState)} ${p.label}`).toBe(published || (own && draftState === "unverified"));
      }
    }
  });

  it("[F85] the person-level read rule in SQL equals mayReadTrace, membership included", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const BOOK = "33333333-3333-4333-8333-333333333333";
    const ELSEWHERE = "44444444-4444-4444-8444-444444444444";
    for (const draftState of states) {
      for (const p of PARTIES) {
        for (const member of [true, false]) {
          const rows = await db.execute(sql`
            SELECT ${traceReadableByPerson("t", VIEWER, member ? [BOOK] : [ELSEWHERE])} AS ok
            FROM (VALUES (${p.author}::uuid, ${p.subject}::uuid, ${draftState}::text, ${BOOK}::uuid)) AS t(user_id, subject_user_id, draft_state, group_id)
          `);
          const sqlSays = (rows as unknown as Array<{ ok: boolean }>)[0]?.ok === true;
          const jsSays = mayReadTrace({ ...factsFor(p), role: member ? "member" : null, draftState });
          expect(sqlSays, `state=${String(draftState)} ${p.label} member=${member}`).toBe(jsSays);
        }
      }
    }
    // No live books at all: only the viewer's own rows.
    const none = await db.execute(sql`
      SELECT ${traceReadableByPerson("t", VIEWER, [])} AS ok
      FROM (VALUES (${OTHER}::uuid, ${null}::uuid, ${null}::text, ${BOOK}::uuid)) AS t(user_id, subject_user_id, draft_state, group_id)
    `);
    expect((none as unknown as Array<{ ok: boolean }>)[0]?.ok).toBe(false);
  });

  it("[S4-M3] draftStateShownTo: every state for the subject, unpublished states for the depositor, nothing for anyone else", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    for (const draftState of states) {
      for (const p of PARTIES) {
        const rows = await db.execute(sql`
          SELECT ${draftStateShownTo("t", VIEWER)} AS shown
          FROM (VALUES (${p.author}::uuid, ${p.subject}::uuid, ${draftState}::text)) AS t(user_id, subject_user_id, draft_state)
        `);
        const shown = (rows as unknown as Array<{ shown: string | null }>)[0]?.shown ?? null;
        const f = factsFor(p);
        const expected = f.isDraftSubject
          ? draftState
          : f.isDraftDepositor && !isPublishedDraftState(draftState) ? draftState : null;
        expect(shown, `state=${String(draftState)} ${p.label}`).toBe(expected);
      }
    }
  });

  it("[S4-L1] the other party of an unpublished on-behalf draft, from each side", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    for (const draftState of states) {
      for (const p of PARTIES) {
        const rows = await db.execute(sql`
          SELECT ${onBehalfSideFor("t", VIEWER)} AS side, ${onBehalfPartyFor("t", VIEWER)} AS party
          FROM (VALUES (${p.author}::uuid, ${p.subject}::uuid, ${draftState}::text)) AS t(user_id, subject_user_id, draft_state)
        `);
        const row = (rows as unknown as Array<{ side: string | null; party: string | null }>)[0]!;
        const onBehalf = p.subject !== null && !isPublishedDraftState(draftState);
        const expectedSide = !onBehalf ? null : p.subject === VIEWER ? "depositedBy" : p.author === VIEWER ? "about" : null;
        const expectedParty = expectedSide === "depositedBy" ? p.author : expectedSide === "about" ? p.subject : null;
        expect(row.side, `state=${String(draftState)} ${p.label}`).toBe(expectedSide);
        expect(row.party, `state=${String(draftState)} ${p.label}`).toBe(expectedParty);
      }
    }
  });
});
