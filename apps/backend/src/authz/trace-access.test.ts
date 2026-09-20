import { describe, it, expect } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { canReadTrace, canReadTraceOfFeedback, readableTraceFor, roleInBookOfTrace } from "./trace-access";

// Layer 1 — the DB-bound trace functions against a canned database. The point:
// the statement only fetches FACTS (the trace's book, whether the viewer wrote
// it, the viewer's role there); the read decision is `mayReadTrace` and
// nothing else. So a row coming back for a viewer who may not read must still
// answer "no" — which a rule living in the SQL could not do here.

const TRACE = "22222222-2222-4222-8222-222222222222";
const BOOK = "33333333-3333-4333-8333-333333333333";
const AUTHOR = "44444444-4444-4444-8444-444444444444";
const VIEWER = "55555555-5555-4555-8555-555555555555";

function row(facts: { isAuthor: boolean; role: string | null }): Record<string, unknown> {
  return {
    traceId: TRACE,
    bookId: BOOK,
    authorId: AUTHOR,
    claimText: "As a test author, I prefer one rule.",
    isAuthor: facts.isAuthor,
    role: facts.role,
    // detail-only columns
    apiKeyId: null,
    formatAdherenceScore: null,
    decidedAt: null,
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
    groupName: "Book",
    apiKeyLabel: null,
    userEmail: "author@test.local",
  };
}

function fakeDb(rows: Array<Record<string, unknown>>): { db: PostgresJsDatabase; statements: () => number } {
  let n = 0;
  const db = {
    execute: async () => {
      n++;
      return rows;
    },
  } as unknown as PostgresJsDatabase;
  return { db, statements: () => n };
}

describe("roleInBookOfTrace", () => {
  it("returns the facts from one statement, or null when the trace does not exist", async () => {
    const found = fakeDb([row({ isAuthor: false, role: "admin" })]);
    expect(await roleInBookOfTrace(found.db, VIEWER, TRACE)).toEqual({
      traceId: TRACE,
      bookId: BOOK,
      authorId: AUTHOR,
      claimText: "As a test author, I prefer one rule.",
      isAuthor: false,
      role: "admin",
    });
    expect(found.statements()).toBe(1);

    const missing = fakeDb([]);
    expect(await roleInBookOfTrace(missing.db, VIEWER, TRACE)).toBeNull();
    expect(missing.statements()).toBe(1);
  });

  it("returns facts for a viewer with no access too — it reports, it does not decide", async () => {
    const { db } = fakeDb([row({ isAuthor: false, role: null })]);
    const facts = await roleInBookOfTrace(db, VIEWER, TRACE);
    expect(facts?.isAuthor).toBe(false);
    expect(facts?.role).toBeNull();
  });

  it("fails closed on a row with no usable facts", async () => {
    const { db } = fakeDb([{ traceId: TRACE, bookId: BOOK, authorId: AUTHOR, claimText: "" }]);
    const facts = await roleInBookOfTrace(db, VIEWER, TRACE);
    expect(facts?.isAuthor).toBe(false);
    expect(facts?.role).toBeNull();
  });
});

describe("the read rule is applied in one place", () => {
  const cases: Array<{ name: string; facts: { isAuthor: boolean; role: string | null }; readable: boolean }> = [
    { name: "author, no membership", facts: { isAuthor: true, role: null }, readable: true },
    { name: "member", facts: { isAuthor: false, role: "member" }, readable: true },
    { name: "a role this module has never seen", facts: { isAuthor: false, role: "viewer" }, readable: true },
    { name: "neither author nor member", facts: { isAuthor: false, role: null }, readable: false },
  ];

  for (const { name, facts, readable } of cases) {
    it(`canReadTrace / canReadTraceOfFeedback / readableTraceFor: ${name} → ${readable}`, async () => {
      expect(await canReadTrace(fakeDb([row(facts)]).db, TRACE, VIEWER)).toBe(readable);
      expect(await canReadTraceOfFeedback(fakeDb([row(facts)]).db, TRACE, VIEWER)).toBe(readable);
      const detail = await readableTraceFor(fakeDb([row(facts)]).db, VIEWER, TRACE);
      expect(detail !== null).toBe(readable);
    });
  }

  it("a missing trace is the same answer as an unreadable one", async () => {
    expect(await canReadTrace(fakeDb([]).db, TRACE, VIEWER)).toBe(false);
    expect(await canReadTraceOfFeedback(fakeDb([]).db, TRACE, VIEWER)).toBe(false);
    expect(await readableTraceFor(fakeDb([]).db, VIEWER, TRACE)).toBeNull();
  });

  it("readableTraceFor returns the detail row and the viewer's facts, in one statement", async () => {
    const { db, statements } = fakeDb([row({ isAuthor: false, role: "owner" })]);
    const found = await readableTraceFor(db, VIEWER, TRACE);
    expect(statements()).toBe(1);
    expect(found?.access).toEqual({
      traceId: TRACE,
      bookId: BOOK,
      authorId: AUTHOR,
      claimText: "As a test author, I prefer one rule.",
      isAuthor: false,
      role: "owner",
    });
    expect(found?.trace).toEqual({
      id: TRACE,
      claimText: "As a test author, I prefer one rule.",
      userId: AUTHOR,
      groupId: BOOK,
      apiKeyId: null,
      formatAdherenceScore: null,
      decidedAt: null,
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      groupName: "Book",
      apiKeyLabel: null,
      userEmail: "author@test.local",
    });
    // The viewer's role drives the route's flags; it is not part of the payload.
    expect("role" in (found?.trace ?? {})).toBe(false);
  });
});
