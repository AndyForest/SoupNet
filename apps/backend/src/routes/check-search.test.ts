import { describe, it, expect, beforeAll } from "vitest";

/**
 * Layer 3 integration tests for the structured recipe-search path
 * (docs/planning/recipe-search-design.md, 2026-08-19):
 *
 *   - grammar errors are loud (unknown qualifiers never degrade to semantic),
 *   - quoted terms match lexically through evidence REFERENCE SOURCES (the
 *     measured citation gap the feature exists to close — recipe 5db8edc5),
 *   - author:/after:/before: qualifiers filter structurally,
 *   - searchId closes the feedback loop via search_id, with the uniform
 *     not-found/not-readable marker across users (no existence oracle),
 *   - zero results carry the thin-corpus signal + scope size.
 *
 * Quoted-only and qualifier-only queries run corpus mode (no embedding
 * dependency), so these assertions are deterministic under the stub
 * embeddings provider. Requires a running backend (BACKEND_URL) — same
 * pattern as recipes.test.ts; runs under `npm run test:ci`.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface SearchData {
  searchOnly?: boolean;
  searchId?: string;
  notice?: string;
  searchedCorpusSize?: number;
  totalResults?: number;
  results?: Array<{ recipeId?: string; recipe?: string; known?: boolean }>;
  sessionId?: string;
}

interface SearchResponse {
  ok: boolean;
  error?: string;
  data?: SearchData;
}

async function setupUserWithKey(tag: string): Promise<{ apiKey: string; email: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `search-${tag}-${uid}@test.local`;
  const password = "search-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error(`Setup failed: register (${tag})`);
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
  const jwt = loginBody.data?.token;
  if (!jwt) throw new Error(`Setup failed: login (${tag})`);
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const apiKey = keyBody.data?.key;
  if (!apiKey) throw new Error(`Setup failed: key (${tag})`);
  return { apiKey, email };
}

async function createTrace(
  apiKey: string,
  recipeText: string,
  opts: { evidence?: string; decidedAt?: string } = {},
): Promise<string> {
  const ef = opts.evidence ??
    `Test evidence interpretation.\n> "verbatim test quote"\n-- integration test, 2026-08-19`;
  let url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(recipeText)}&ef=${encodeURIComponent(ef)}&format=json`;
  if (opts.decidedAt) url += `&decided_at=${encodeURIComponent(opts.decidedAt)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as { ok: boolean; data?: { checked?: { recipeId?: string } } };
  const id = body.data?.checked?.recipeId;
  if (!id) throw new Error(`Setup failed: createTrace (${JSON.stringify(body).slice(0, 200)})`);
  return id;
}

async function search(apiKey: string, query: string): Promise<SearchResponse> {
  const url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&filter=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return (await res.json()) as SearchResponse;
}

const CITED_FILE = "search-test-target.service.ts";

describe.skipIf(!BASE)("structured recipe search (/check filter path)", () => {
  let keyA: string;
  let keyB: string;
  let citingTrace: string;
  let otherTrace: string;
  let oldTrace: string;

  beforeAll(async () => {
    const [a, b] = await Promise.all([setupUserWithKey("a"), setupUserWithKey("b")]);
    keyA = a.apiKey;
    keyB = b.apiKey;
    // Trace whose EVIDENCE REFERENCE SOURCE cites the target filename — the
    // claim text deliberately never mentions it, so a lexical hit proves the
    // broadened field scope (claim + evidence + references).
    citingTrace = await createTrace(
      keyA,
      "As a test engineer working on retrieval integration tests, I chose deterministic seed recipes so that lexical assertions are stable.",
      {
        evidence:
          `The design decision is recorded in the service header.\n> "predicates stay parameterized"\n-- ${CITED_FILE}, header comment, 2026-08-19`,
      },
    );
    otherTrace = await createTrace(
      keyA,
      "As a test engineer working on retrieval integration tests, I prefer a second unrelated seed recipe so that exclusion assertions have a survivor.",
    );
    // Backfilled decision for date-qualifier assertions.
    oldTrace = await createTrace(
      keyA,
      "As a test engineer working on retrieval integration tests, I chose a backfilled historical decision so that judgment-date range assertions are testable.",
      { decidedAt: "2020-06-15" },
    );
  }, 90_000);

  // ── Grammar (loud rejection) ─────────────────────────────────────────────

  it("rejects an unknown qualifier with a message naming the valid set", async () => {
    const body = await search(keyA, "athor:someone@example.com stuff");
    expect(body.ok).toBe(false);
    expect(body.error).toContain('unknown qualifier "athor:"');
    expect(body.error).toContain("author:, after:, before:");
  });

  it("rejects an unterminated quote", async () => {
    const body = await search(keyA, '"half-open');
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unterminated quote");
  });

  // ── Lexical matching (the citation-gap fix) ──────────────────────────────

  it("matches a quoted filename through the evidence REFERENCE SOURCE", async () => {
    const body = await search(keyA, `"${CITED_FILE}"`);
    expect(body.ok).toBe(true);
    const ids = (body.data?.results ?? []).map((r) => r.recipeId);
    expect(ids).toContain(citingTrace);
    expect(ids).not.toContain(otherTrace);
  });

  it("negates a quoted term with a leading minus", async () => {
    const body = await search(keyA, `"seed recipe" -"${CITED_FILE}"`);
    expect(body.ok).toBe(true);
    const ids = (body.data?.results ?? []).map((r) => r.recipeId);
    expect(ids).not.toContain(citingTrace);
    expect(ids).toContain(otherTrace);
  });

  it("ORs quoted terms inside a group", async () => {
    const body = await search(keyA, `("${CITED_FILE}" OR "exclusion assertions have a survivor")`);
    expect(body.ok).toBe(true);
    const ids = (body.data?.results ?? []).map((r) => r.recipeId);
    expect(ids).toContain(citingTrace);
    expect(ids).toContain(otherTrace);
  });

  // ── Author + date qualifiers ─────────────────────────────────────────────

  it("author:me returns the caller's recipes; the web path includes own by default", async () => {
    const mine = await search(keyA, "author:me");
    expect(mine.ok).toBe(true);
    const ids = (mine.data?.results ?? []).map((r) => r.recipeId);
    expect(ids).toContain(citingTrace);
  });

  it("an unmatched author email yields honest zero results, not an error", async () => {
    const body = await search(keyA, "author:nobody-here@test.local");
    expect(body.ok).toBe(true);
    expect(body.data?.totalResults).toBe(0);
  });

  it("before:/after: filter on the judgment date (decided_at cascade)", async () => {
    const old = await search(keyA, "author:me before:2021-01-01");
    expect(old.ok).toBe(true);
    const oldIds = (old.data?.results ?? []).map((r) => r.recipeId);
    expect(oldIds).toContain(oldTrace);
    expect(oldIds).not.toContain(citingTrace);

    const recent = await search(keyA, "author:me after:2021-01-01");
    expect(recent.ok).toBe(true);
    const recentIds = (recent.data?.results ?? []).map((r) => r.recipeId);
    expect(recentIds).toContain(citingTrace);
    expect(recentIds).not.toContain(oldTrace);
  });

  // ── ACL scope ────────────────────────────────────────────────────────────

  it("key B never sees key A's recipes regardless of query", async () => {
    const body = await search(keyB, `"${CITED_FILE}" author:anyone`);
    expect(body.ok).toBe(true);
    const ids = (body.data?.results ?? []).map((r) => r.recipeId);
    expect(ids).not.toContain(citingTrace);
  });

  // ── Zero-result signal ───────────────────────────────────────────────────

  it("zero results carry the thin-corpus notice and scope size", async () => {
    const body = await search(keyA, `"zzz-nonexistent-term-xyzzy"`);
    expect(body.ok).toBe(true);
    expect(body.data?.totalResults).toBe(0);
    expect(body.data?.notice).toContain("thin-corpus");
    expect(body.data?.searchedCorpusSize).toBeGreaterThanOrEqual(3);
  });

  // ── searchId + feedback loop ─────────────────────────────────────────────

  it("returns a searchId, accepted by POST /feedback as search_id (own user only)", async () => {
    const body = await search(keyA, `"${CITED_FILE}"`);
    const searchId = body.data?.searchId;
    expect(searchId).toBeTruthy();

    const feedbackRow = {
      search_id: searchId,
      kind: "check-feedback",
      impact: "big",
      disposition: "proceeded",
      story_fulfilled: "yes",
      story: "As a test engineer, I wanted the cited-file search to surface the citing recipe.",
      note: "Integration test — search feedback round trip.",
    };

    const ok = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
      body: JSON.stringify(feedbackRow),
    });
    const okBody = (await ok.json()) as { ok: boolean; data?: { results: Array<{ ok: boolean; searchId?: string; feedbackId?: string }> } };
    expect(okBody.ok).toBe(true);
    expect(okBody.data?.results[0]?.ok).toBe(true);
    expect(okBody.data?.results[0]?.searchId).toBe(searchId);

    // Another user referencing the same searchId gets the uniform marker —
    // byte-identical to an unknown id (no existence oracle).
    const cross = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyB}` },
      body: JSON.stringify(feedbackRow),
    });
    const crossBody = (await cross.json()) as { ok: boolean; data?: { results: Array<{ ok: boolean; error?: string }> } };
    const crossError = crossBody.data?.results[0]?.error;

    const unknown = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyB}` },
      body: JSON.stringify({ ...feedbackRow, search_id: "00000000-0000-4000-8000-00000000dead" }),
    });
    const unknownBody = (await unknown.json()) as { ok: boolean; data?: { results: Array<{ ok: boolean; error?: string }> } };
    expect(crossBody.data?.results[0]?.ok).toBe(false);
    expect(unknownBody.data?.results[0]?.ok).toBe(false);
    expect(crossError).toBe(unknownBody.data?.results[0]?.error);
  });

  it("rejects a row carrying both trace_id and search_id", async () => {
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
      body: JSON.stringify({
        trace_id: citingTrace,
        search_id: "00000000-0000-4000-8000-00000000dead",
        kind: "check-feedback",
        impact: "none",
        disposition: "proceeded",
        story_fulfilled: "unknown",
        story: "Both targets at once.",
      }),
    });
    const body = (await res.json()) as { data?: { results: Array<{ ok: boolean; error?: string }> } };
    expect(body.data?.results[0]?.ok).toBe(false);
    expect(body.data?.results[0]?.error).toContain("exactly one of");
  });

  // ── Backward compatibility ───────────────────────────────────────────────

  it("a plain-text filter still runs the semantic search path without error", async () => {
    const body = await search(keyA, "retrieval integration seed recipes");
    expect(body.ok).toBe(true);
    expect(body.data?.searchOnly).toBe(true);
    expect(body.data?.notice).toContain("no recipe was logged");
  });
});
