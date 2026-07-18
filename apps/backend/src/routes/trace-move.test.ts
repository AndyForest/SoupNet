import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for PATCH /traces/:id — re-filing a recipe into another
 * recipe book. Requires a running backend (BACKEND_URL).
 *
 * The load-bearing test here is "leaves the source book's SEARCH scope and
 * enters the destination's". Vector search filters `embedding_sources.group_id`
 * — an unenforced cache of the owning trace's book — not `traces.group_id`.
 * An implementation that updates only the trace row passes every other test in
 * this file and silently corrupts search scoping forever. So the assertion is
 * made against QUERY-mode /traces/map (which routes through hybridSearch and
 * `embedding_sources.group_id`), never corpus mode (which reads
 * `traces.group_id` and would happily agree with a broken move).
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

const authorEmail = `test-move-author-${uid}@test.local`;
const strangerEmail = `test-move-stranger-${uid}@test.local`;
const memberEmail = `test-move-member-${uid}@test.local`;
const password = "trace-move-test-pw-abc";

// Named so a leak of the SOURCE book's name into the feedback row is visible.
const SOURCE_BOOK = `Confidential Source ${uid}`;
const DEST_BOOK = `Destination Book ${uid}`;

const CLAIM = `As a recipe-move integration tester working on book re-filing, I prefer misfiled recipes to be movable so that a filing mistake costs no evidence (${uid})`;
const EVIDENCE =
  'The operator asked for it.\n> "Button for human user to change the recipe book"\n-- move test fixture';

let authorToken = "";
let strangerToken = "";
let memberToken = "";
let orgId = "";
let sourceBookId = "";
let destBookId = "";
let strangerBookId = "";
let authorKey = "";
let traceId = "";

async function registerAndVerify(email: string): Promise<string> {
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error(`Setup failed for ${email}`);
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const t = loginBody.data?.token ?? "";
  if (!t) throw new Error(`Login failed for ${email}`);
  return t;
}

async function firstBook(token: string): Promise<{ id: string; orgId: string }> {
  const res = await fetch(`${BASE}/recipe-books`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as {
    data: Array<{ id: string; organization_id: string }>;
  };
  return { id: body.data[0]?.id ?? "", orgId: body.data[0]?.organization_id ?? "" };
}

async function createBook(token: string, name: string, slug: string, org: string): Promise<string> {
  const res = await fetch(`${BASE}/recipe-books`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, slug, organizationId: org }),
  });
  const body = (await res.json()) as { data?: { id: string } };
  const id = body.data?.id ?? "";
  if (!id) throw new Error(`Failed to create book ${name}`);
  return id;
}

async function mintKey(token: string, writeBookId: string): Promise<string> {
  const res = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ writeRecipeBookId: writeBookId }),
  });
  const body = (await res.json()) as { data?: { key?: string } };
  const key = body.data?.key ?? "";
  if (!key) throw new Error("Failed to mint daily key");
  return key;
}

async function seedTrace(key: string, claim: string): Promise<string> {
  const form = new URLSearchParams({ key, trace: claim, ef: EVIDENCE, format: "json" });
  const res = await fetch(`${BASE}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = (await res.json()) as { ok: boolean; data?: { checked?: { recipeId: string } } };
  if (!body.ok || !body.data?.checked?.recipeId) {
    throw new Error(`Failed to seed trace: ${JSON.stringify(body)}`);
  }
  return body.data.checked.recipeId;
}

/**
 * Query-mode map hit count for a book. Query mode routes through hybridSearch,
 * which filters `embedding_sources.group_id` — the column a move must update.
 */
async function searchHits(token: string, bookId: string, query: string): Promise<number> {
  const url = `${BASE}/traces/map?groupId=${encodeURIComponent(bookId)}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return -1;
  const body = (await res.json()) as {
    data?: {
      clusters?: Array<{ memberPreviews: Array<{ text: string }> }>;
      unclustered?: Array<{ claimText: string }>;
    };
  };
  const texts = [
    ...(body.data?.unclustered ?? []).map((t) => t.claimText),
    ...(body.data?.clusters ?? []).flatMap((c) => c.memberPreviews.map((m) => m.text)),
  ];
  return texts.filter((t) => t.includes(String(uid))).length;
}

/** Embeddings are enqueued on pg-boss, so the search index lags the write. */
async function waitForIndexed(token: string, bookId: string, query: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await searchHits(token, bookId, query)) > 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Trace never became searchable — embedding worker did not run");
}

describe.skipIf(!BASE)("PATCH /traces/:id — re-file a recipe", () => {
  beforeAll(async () => {
    authorToken = await registerAndVerify(authorEmail);
    strangerToken = await registerAndVerify(strangerEmail);
    memberToken = await registerAndVerify(memberEmail);

    const personal = await firstBook(authorToken);
    orgId = personal.orgId;
    if (!orgId) throw new Error("Missing org after register");

    sourceBookId = await createBook(authorToken, SOURCE_BOOK, `move-src-${uid}`, orgId);
    destBookId = await createBook(authorToken, DEST_BOOK, `move-dst-${uid}`, orgId);

    const strangerPersonal = await firstBook(strangerToken);
    strangerBookId = strangerPersonal.id;

    // A plain member of BOTH the author's books, so the source gate — not the
    // destination gate — is what stops them moving someone else's recipe.
    for (const bookId of [sourceBookId, destBookId]) {
      const res = await fetch(`${BASE}/recipe-books/${bookId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
        body: JSON.stringify({ email: memberEmail, role: "member" }),
      });
      if (!res.ok) throw new Error(`Failed to add member to ${bookId}: ${res.status}`);
    }

    authorKey = await mintKey(authorToken, sourceBookId);
    traceId = await seedTrace(authorKey, CLAIM);
    await waitForIndexed(authorToken, sourceBookId, CLAIM);
  }, 120_000);

  it("exposes canMove on the trace detail payload", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { canMove: boolean; canDelete: boolean } };
    expect(body.data.canMove).toBe(true);
  });

  it("rejects a move with no destination (400)", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a move into the book the recipe already lives in (400)", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ groupId: sourceBookId }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a move into a book the actor does not belong to (403)", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ groupId: strangerBookId }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("forbidden_destination");
  });

  it("rejects a plain member moving another author's recipe (403, source gate)", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ groupId: destBookId }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("forbidden_source");
  });

  it("rejects an evidence id that does not belong to the trace (400)", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({
        groupId: destBookId,
        dropEvidenceIds: ["00000000-0000-0000-0000-000000000000"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("moves the recipe and reports both books plus a feedback id", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ groupId: destBookId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        fromGroupId: string;
        toGroupId: string;
        feedbackId: string | null;
        evidenceRedacted: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.fromGroupId).toBe(sourceBookId);
    expect(body.data.toGroupId).toBe(destBookId);
    expect(body.data.feedbackId).toBeTruthy();
    expect(body.data.evidenceRedacted).toBe(0);
  });

  it("reports the destination book on the trace detail page", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    const body = (await res.json()) as { data: { groupId: string; groupName: string } };
    expect(body.data.groupId).toBe(destBookId);
    expect(body.data.groupName).toBe(DEST_BOOK);
  });

  // THE test. A move that updates traces.group_id but not
  // embedding_sources.group_id passes everything above and fails only here.
  it("leaves the source book's search scope and enters the destination's", async () => {
    const destHits = await searchHits(authorToken, destBookId, CLAIM);
    expect(destHits).toBeGreaterThan(0);

    const sourceHits = await searchHits(authorToken, sourceBookId, CLAIM);
    expect(sourceHits).toBe(0);
  }, 30_000);

  it("writes a human-origin feedback row naming the destination, never the source", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        feedback: Array<{
          disposition: string;
          kind: string;
          storyFulfilled: string;
          story: string;
          note: string;
          apiKeyLabel: string | null;
          actorUserId: string | null;
          actorEmail: string | null;
        }>;
      };
    };
    const row = body.data.feedback.find((f) => f.disposition === "corrected");
    expect(row).toBeTruthy();
    expect(row?.actorUserId).toBeTruthy();
    expect(row?.actorEmail).toBe(authorEmail);
    expect(row?.apiKeyLabel).toBeNull();
    // A re-file says nothing about whether the original check's story was met.
    expect(row?.storyFulfilled).toBe("unknown");

    // Declassification: the destination may be named; the source may not.
    const text = `${row?.story ?? ""} ${row?.note ?? ""}`;
    expect(text).toContain(DEST_BOOK);
    expect(text).not.toContain(SOURCE_BOOK);
    expect(text).not.toContain("Confidential");
  });

  it("409s when an identical recipe from the same agent already sits in the destination", async () => {
    // The unique key is (api_key_id, group_id, claim_text_hash). Re-checking the
    // same claim with the same key lands a second trace in the now-empty source
    // book; moving it onto its twin in the destination is a duplicate, not a 500.
    const twinId = await seedTrace(authorKey, CLAIM);
    expect(twinId).not.toBe(traceId);

    const res = await fetch(`${BASE}/traces/${twinId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ groupId: destBookId }),
    });
    expect(res.status).toBe(409);
  }, 30_000);

  it("redacts de-selected evidence rather than carrying it across the boundary", async () => {
    const secondBookId = await createBook(
      authorToken, `Redaction Dest ${uid}`, `move-redact-${uid}`, orgId,
    );

    const detailRes = await fetch(`${BASE}/traces/${traceId}`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    const detail = (await detailRes.json()) as {
      data: { evidence: Array<{ id: string }> };
    };
    const evidenceIds = detail.data.evidence.map((e) => e.id);
    expect(evidenceIds.length).toBeGreaterThan(0);

    const res = await fetch(`${BASE}/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ groupId: secondBookId, dropEvidenceIds: [evidenceIds[0]] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { evidenceRedacted: number } };
    expect(body.data.evidenceRedacted).toBe(1);

    const afterRes = await fetch(`${BASE}/traces/${traceId}`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    const after = (await afterRes.json()) as { data: { evidence: Array<{ id: string }> } };
    expect(after.data.evidence.map((e) => e.id)).not.toContain(evidenceIds[0]);
    expect(after.data.evidence.length).toBe(evidenceIds.length - 1);
  }, 30_000);
});
