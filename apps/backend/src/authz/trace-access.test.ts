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

function row(facts: {
  isAuthor: boolean;
  role: string | null;
  draftState?: string | null;
  isDraftSubject?: boolean;
  isDraftDepositor?: boolean;
}): Record<string, unknown> {
  return {
    traceId: TRACE,
    bookId: BOOK,
    authorId: AUTHOR,
    claimText: "As a test author, I prefer one rule.",
    isAuthor: facts.isAuthor,
    role: facts.role,
    draftState: facts.draftState ?? null,
    isDraftSubject: facts.isDraftSubject ?? facts.isAuthor,
    isDraftDepositor: facts.isDraftDepositor ?? facts.isAuthor,
    // detail-only columns
    apiKeyId: null,
    formatAdherenceScore: null,
    decidedAt: null,
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
    groupName: "Book",
    apiKeyLabel: null,
    userEmail: "author@test.local",
    impact: null,
    uncertainty: null,
    draftResolvedAt: null,
    draftResolvedByKeyId: null,
    draftResolvedByEmail: null,
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
      draftState: null,
      isDraftSubject: false,
      isDraftDepositor: false,
    });
    expect(found.statements()).toBe(1);

    const missing = fakeDb([]);
    expect(await roleInBookOfTrace(missing.db, VIEWER, TRACE)).toBeNull();
    expect(missing.statements()).toBe(1);
  });

  it("DT-VIS-15: an unpublished draft is null (the route's missing-id 404) to anyone but the person it is about, book owners included", async () => {
    for (const draftState of ["unverified", "rejected", "not_chosen"]) {
      const owner = fakeDb([row({ isAuthor: false, role: "owner", draftState })]);
      expect(await roleInBookOfTrace(owner.db, VIEWER, TRACE), draftState).toBeNull();
      const subject = fakeDb([row({ isAuthor: true, role: "member", draftState })]);
      expect((await roleInBookOfTrace(subject.db, VIEWER, TRACE))?.draftState).toBe(draftState);
    }
    const verified = fakeDb([row({ isAuthor: false, role: "owner", draftState: "verified" })]);
    expect((await roleInBookOfTrace(verified.db, VIEWER, TRACE))?.role).toBe("owner");
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

describe("[F83] verification details are the draft subject's alone", () => {
  const resolved = {
    draftState: "verified",
    draftResolvedAt: "2026-09-27T10:00:00Z",
    draftResolvedByKeyId: "k1",
    draftResolvedByEmail: "author@test.local",
    draftResolvedByUserId: VIEWER,
  };
  it("a collaborator reading a verified draft gets an ordinary recipe", async () => {
    const found = await readableTraceFor(fakeDb([{ ...row({ isAuthor: false, role: "member", draftState: "verified" }), ...resolved }]).db, VIEWER, TRACE);
    expect(found?.trace).toMatchObject({ draftState: null, draftResolvedAt: null, draftResolvedByKeyId: null, draftResolvedByEmail: null, draftResolvedByViewer: false });
  });
  it("the subject sees them, and whether they resolved it", async () => {
    const found = await readableTraceFor(fakeDb([{ ...row({ isAuthor: true, role: "member", draftState: "verified" }), ...resolved }]).db, VIEWER, TRACE);
    expect(found?.trace).toMatchObject({ draftState: "verified", draftResolvedByKeyId: "k1", draftResolvedByViewer: true });
  });
});

describe("the read rule is applied in one place", () => {
  const cases: Array<{ name: string; facts: { isAuthor: boolean; role: string | null; draftState?: string }; readable: boolean }> = [
    { name: "author, no membership", facts: { isAuthor: true, role: null }, readable: true },
    { name: "member", facts: { isAuthor: false, role: "member" }, readable: true },
    { name: "a role this module has never seen", facts: { isAuthor: false, role: "viewer" }, readable: true },
    { name: "neither author nor member", facts: { isAuthor: false, role: null }, readable: false },
    // Drafts (slice 2): only the person it is about, or its depositor.
    { name: "unverified draft, book owner", facts: { isAuthor: false, role: "owner", draftState: "unverified" }, readable: false },
    { name: "unverified draft, its subject", facts: { isAuthor: true, role: null, draftState: "unverified" }, readable: true },
    { name: "rejected draft, member", facts: { isAuthor: false, role: "member", draftState: "rejected" }, readable: false },
    { name: "verified draft, member", facts: { isAuthor: false, role: "member", draftState: "verified" }, readable: true },
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
      draftState: null,
      isDraftSubject: false,
      isDraftDepositor: false,
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
      impact: null,
      uncertainty: null,
      draftState: null,
      draftResolvedAt: null,
      draftResolvedByKeyId: null,
      draftResolvedByEmail: null,
      draftResolvedByViewer: false,
      draftDepositedBy: null,
      draftAbout: null,
    });
    // The viewer's role drives the route's flags; it is not part of the payload.
    expect("role" in (found?.trace ?? {})).toBe(false);
  });
});

describe("slice 4: the depositor and the subject of an on-behalf draft", () => {
  const SUBJECT = "66666666-6666-4666-8666-666666666666";
  const onBehalf = (facts: { isAuthor: boolean; isDraftSubject: boolean; isDraftDepositor: boolean; draftState: string }) => ({
    ...row({ role: "member", ...facts }),
    subjectUserId: SUBJECT,
    subjectEmail: "pat@test.local",
    draftResolvedAt: "2026-09-27T10:00:00Z",
    draftResolvedByEmail: "pat@test.local",
    draftResolvedByUserId: SUBJECT,
  });

  it("[S4-M5] roleInBookOfTrace reports an unpublished draft to its depositor as well as its subject, and to nobody else", async () => {
    for (const draftState of ["unverified", "rejected", "not_chosen"]) {
      const dep = fakeDb([onBehalf({ isAuthor: true, isDraftSubject: false, isDraftDepositor: true, draftState })]);
      expect((await roleInBookOfTrace(dep.db, VIEWER, TRACE))?.isDraftDepositor, draftState).toBe(true);
      const subj = fakeDb([onBehalf({ isAuthor: false, isDraftSubject: true, isDraftDepositor: false, draftState })]);
      expect((await roleInBookOfTrace(subj.db, VIEWER, TRACE))?.isDraftSubject, draftState).toBe(true);
      const other = fakeDb([onBehalf({ isAuthor: false, isDraftSubject: false, isDraftDepositor: false, draftState })]);
      expect(await roleInBookOfTrace(other.db, VIEWER, TRACE), draftState).toBeNull();
    }
  });

  it("[S4-M3][S4-L1] the depositor sees the unpublished state and whom it is about, never who resolved it", async () => {
    const found = await readableTraceFor(fakeDb([onBehalf({ isAuthor: true, isDraftSubject: false, isDraftDepositor: true, draftState: "rejected" })]).db, VIEWER, TRACE);
    expect(found?.trace).toMatchObject({
      draftState: "rejected", draftResolvedAt: null, draftResolvedByEmail: null, draftResolvedByViewer: false,
      draftAbout: "pat@test.local", draftDepositedBy: null,
    });
  });

  it("[S4-L1] the subject sees who deposited it, with the resolution details", async () => {
    const found = await readableTraceFor(fakeDb([onBehalf({ isAuthor: false, isDraftSubject: true, isDraftDepositor: false, draftState: "unverified" })]).db, VIEWER, TRACE);
    expect(found?.trace).toMatchObject({ draftState: "unverified", draftDepositedBy: "author@test.local", draftAbout: null });
  });

  it("[S4-L2] no label on anything published", async () => {
    const found = await readableTraceFor(fakeDb([onBehalf({ isAuthor: true, isDraftSubject: false, isDraftDepositor: true, draftState: "verified" })]).db, VIEWER, TRACE);
    expect(found?.trace).toMatchObject({ draftState: null, draftDepositedBy: null, draftAbout: null });
  });
});
