import { describe, it, expect, beforeAll } from "vitest";

/**
 * Move and delete act on the book they were authorized against — requires
 * running backend + postgres.
 *
 * The route decides "may this user take this recipe out of book A" and then
 * calls the service, which locks the trace row. If the recipe left book A in
 * between, the decision was about a different book than the one the action
 * would touch, so the service refuses instead of acting.
 *
 * The window cannot be hit deterministically over HTTP, so it is simulated the
 * way the brief for this fix allows: the route's view ("it is in book A") is
 * passed to the service after a direct fixture update has put the recipe
 * somewhere else.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let move: typeof import("./trace-move.service");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let del: typeof import("./trace-delete.service");

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();
const PASSWORD = "trace-source-book-pw";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

describe.skipIf(!canConnect() || !BASE)("move / delete refuse when the recipe left the authorized book", () => {
  let token = "";
  let userId = "";
  let bookA = "";
  let bookB = "";
  let elsewhere = "";
  let moveTraceId = "";
  let deleteTraceId = "";
  let untouchedTraceId = "";

  function call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function createBook(label: string, orgId: string): Promise<string> {
    const res = await call("POST", "/recipe-books", {
      name: `Source Book ${label} ${uid}`,
      slug: `source-book-${label}-${uid}`,
      organizationId: orgId,
    });
    const id = ((await res.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!id) throw new Error(`Failed to create book ${label}`);
    return id;
  }

  async function seedTrace(rawKey: string, tag: string): Promise<string> {
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: rawKey,
        trace: `As a source-book test author, I prefer an action to touch the book it was authorized for so that a check never outlives its facts. (${uid}-${tag})`,
        ef: "Seed evidence.\n> \"the book it was authorized for\"\n-- this test",
        format: "json",
      }).toString(),
    });
    const body = (await res.json()) as { ok: boolean; data?: { checked?: { recipeId: string } } };
    const id = body.data?.checked?.recipeId;
    if (!body.ok || !id) throw new Error(`Failed to seed trace: ${JSON.stringify(body)}`);
    return id;
  }

  async function bookOf(traceId: string): Promise<string | null> {
    const rows = await getDb().execute(sql`
      SELECT group_id AS "groupId" FROM claimnet.traces WHERE id = ${traceId}::uuid
    `);
    return (rows as unknown as Array<{ groupId: string }>)[0]?.groupId ?? null;
  }

  /** The fixture shortcut: the recipe leaves book A behind the route's back. */
  async function relocate(traceId: string, toBookId: string): Promise<void> {
    await getDb().execute(sql`
      UPDATE claimnet.traces SET group_id = ${toBookId}::uuid WHERE id = ${traceId}::uuid
    `);
  }

  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;
    move = await import("./trace-move.service");
    del = await import("./trace-delete.service");

    const email = `test-source-book-${uid}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
    });
    const vtok = ((await reg.json()) as { data?: { verificationToken?: string } }).data?.verificationToken;
    if (!vtok) throw new Error(`Setup failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const loginBody = (await login.json()) as { data?: { token?: string; user?: { id: string } } };
    token = loginBody.data?.token ?? "";
    userId = loginBody.data?.user?.id ?? "";
    if (!token || !userId) throw new Error(`Login failed for ${email}`);

    const books = ((await (await call("GET", "/recipe-books")).json()) as {
      data: Array<{ organization_id: string }>;
    }).data;
    const orgId = books[0]?.organization_id ?? "";
    if (!orgId) throw new Error("Missing personal org");

    bookA = await createBook("a", orgId);
    bookB = await createBook("b", orgId);
    elsewhere = await createBook("elsewhere", orgId);

    const keyRes = await call("POST", "/keys/daily", { writeRecipeBookId: bookA });
    const rawKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!rawKey) throw new Error(`Failed to mint a daily key: ${keyRes.status}`);

    moveTraceId = await seedTrace(rawKey, "move");
    deleteTraceId = await seedTrace(rawKey, "delete");
    untouchedTraceId = await seedTrace(rawKey, "untouched");
  }, 90_000);

  it("move: refuses, and changes nothing, when the trace is no longer in the authorized book", async () => {
    await relocate(moveTraceId, elsewhere);

    await expect(
      move.moveTraceToBook({
        db: getDb(),
        traceId: moveTraceId,
        authorizedSourceGroupId: bookA,
        destGroupId: bookB,
        destBookName: "Book B",
        actorUserId: userId,
      }),
    ).rejects.toBeInstanceOf(move.TraceMoveSourceChangedError);

    expect(await bookOf(moveTraceId)).toBe(elsewhere);
    const feedback = await getDb().execute(sql`
      SELECT id FROM claimnet.check_feedback WHERE trace_id = ${moveTraceId}::uuid
    `);
    expect((feedback as unknown as unknown[]).length).toBe(0);
  });

  it("move: the refusal comes before the same-book answer, so it says nothing about where the trace went", async () => {
    // The trace now sits in `elsewhere`. Asking to move it there, while
    // authorized for book A, is still "source changed" — not "already there".
    await expect(
      move.moveTraceToBook({
        db: getDb(),
        traceId: moveTraceId,
        authorizedSourceGroupId: bookA,
        destGroupId: elsewhere,
        destBookName: "Elsewhere",
        actorUserId: userId,
      }),
    ).rejects.toBeInstanceOf(move.TraceMoveSourceChangedError);
  });

  it("move: proceeds when the trace is still in the authorized book", async () => {
    const result = await move.moveTraceToBook({
      db: getDb(),
      traceId: untouchedTraceId,
      authorizedSourceGroupId: bookA,
      destGroupId: bookB,
      destBookName: "Book B",
      actorUserId: userId,
    });
    expect(result.fromGroupId).toBe(bookA);
    expect(result.toGroupId).toBe(bookB);
    expect(await bookOf(untouchedTraceId)).toBe(bookB);
  });

  it("delete: refuses, and deletes nothing, when the trace is no longer in the authorized book", async () => {
    await relocate(deleteTraceId, elsewhere);

    await expect(
      del.deleteTraceCascade({
        db: getDb(),
        traceId: deleteTraceId,
        actorUserId: userId,
        authorizedGroupId: bookA,
      }),
    ).rejects.toBeInstanceOf(del.TraceDeleteSourceChangedError);

    expect(await bookOf(deleteTraceId)).toBe(elsewhere);
    const evidence = await getDb().execute(sql`
      SELECT evidence_id FROM claimnet.trace_evidence WHERE trace_id = ${deleteTraceId}::uuid
    `);
    expect((evidence as unknown as unknown[]).length).toBeGreaterThan(0);
  });

  it("delete: proceeds when the book matches, and for callers that authorize no book at all", async () => {
    const matched = await del.deleteTraceCascade({
      db: getDb(),
      traceId: deleteTraceId,
      actorUserId: userId,
      authorizedGroupId: elsewhere,
    });
    expect(matched.ok).toBe(true);
    expect(await bookOf(deleteTraceId)).toBeNull();

    // System cascades (account deletion, workspace reaping) pass no book.
    const unscoped = await del.deleteTraceCascade({ db: getDb(), traceId: moveTraceId, actorUserId: null });
    expect(unscoped.ok).toBe(true);
    expect(await bookOf(moveTraceId)).toBeNull();
  });

  it("the routes pass the book they authorized on: an ordinary move and delete still succeed", async () => {
    // (The refusal itself maps to 409 in routes/traces.ts; the window that
    // produces it cannot be opened deterministically over HTTP.)
    const res = await call("PATCH", `/traces/${untouchedTraceId}`, { groupId: bookA });
    expect(res.status).toBe(200);
    expect(await bookOf(untouchedTraceId)).toBe(bookA);

    const gone = await call("DELETE", `/traces/${untouchedTraceId}`, {});
    expect(gone.status).toBe(200);
  });
});
