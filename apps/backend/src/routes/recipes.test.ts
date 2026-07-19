import { describe, it, expect, beforeAll } from "vitest";

/**
 * Layer 3 integration tests for GET /recipes (recipe lookup by id, WT-3) and
 * the briefing recipe_ids / purpose params.
 *
 * SECURITY (IDOR-class surface): these tests prove
 *   1. key B cannot read key A's trace by id (ACL = the key's read_group_ids),
 *   2. the marker for "exists but unreadable" is byte-identical to the marker
 *      for "does not exist" — no existence leak,
 *   3. malformed ids get the same marker and never kill the request.
 *
 * Requires a running backend (BACKEND_URL) — same pattern as mcp.test.ts /
 * check.test.ts; runs under `npm run test:ci`.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface LookupEntry {
  recipeId: string;
  status: string;
  recipe?: string;
  recipeBook?: { recipeBookId: string; slug: string; name: string } | null;
  author?: { email: string; displayName?: string } | null;
  createdAt?: string;
  loggedAt?: string;
  evidence?: Array<{ interpretation: string; references: Array<{ quote: string | null; source: string | null }> }>;
}

interface LookupResponse {
  ok: boolean;
  error?: string;
  data?: { recipes: LookupEntry[] };
}

async function setupUserWithKey(tag: string): Promise<{ apiKey: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `recipes-${tag}-${uid}@test.local`;
  const password = "recipes-test-password-123";
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
  return { apiKey };
}

/** Run a recipe check to create a trace (with evidence) owned by this key. */
async function createTrace(apiKey: string, recipeText: string): Promise<string> {
  const ef = `Test evidence interpretation.\n> "verbatim test quote"\n-- integration test, 2026-07-05`;
  const url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(recipeText)}&ef=${encodeURIComponent(ef)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json()) as { ok: boolean; data?: { checked?: { recipeId?: string } } };
  const id = body.data?.checked?.recipeId;
  if (!id) throw new Error("Setup failed: createTrace");
  return id;
}

const UNKNOWN_UUID = "00000000-0000-4000-8000-00000000dead";

describe.skipIf(!BASE)("GET /recipes — recipe lookup by id", () => {
  let keyA: string;
  let keyB: string;
  let traceA: string;

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      setupUserWithKey("a"),
      setupUserWithKey("b"),
    ]);
    keyA = a.apiKey;
    keyB = b.apiKey;
    traceA = await createTrace(
      keyA,
      "As a test engineer working on lookup integration tests, I prefer seeding one canonical trace so that by-id assertions are deterministic.",
    );
  }, 60_000);

  // ── Auth + validation shapes ───────────────────────────────────────────

  it("returns 401 without a Bearer token", async () => {
    const res = await fetch(`${BASE}/recipes?ids=${traceA}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid key", async () => {
    const res = await fetch(`${BASE}/recipes?ids=${traceA}`, {
      headers: { Authorization: "Bearer cn_s_definitely-not-a-real-key" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when ids is missing or empty", async () => {
    const res1 = await fetch(`${BASE}/recipes`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res1.status).toBe(400);
    const res2 = await fetch(`${BASE}/recipes?ids=%20%2C%20`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res2.status).toBe(400);
  });

  it("returns 400 when more than 20 ids are requested", async () => {
    const ids = Array.from({ length: 21 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
    const res = await fetch(`${BASE}/recipes?ids=${ids}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("20");
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it("returns full content for a trace the key can read", async () => {
    const res = await fetch(`${BASE}/recipes?ids=${traceA}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LookupResponse;
    expect(body.ok).toBe(true);
    const entries = body.data?.recipes ?? [];
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.recipeId).toBe(traceA);
    expect(entry.status).toBe("ok");
    expect(entry.recipe).toContain("seeding one canonical trace");
    expect(entry.recipeBook?.recipeBookId).toBeTruthy();
    expect(entry.recipeBook?.slug).toBeTruthy();
    expect(entry.author?.email).toContain("@test.local");
    expect(entry.createdAt).toBeTruthy();
    // No decided_at was set, so the judgment date IS the append time.
    expect(entry.loggedAt).toBe(entry.createdAt);
    expect(entry.evidence?.length).toBeGreaterThan(0);
    expect(entry.evidence?.[0]?.interpretation).toContain("Test evidence interpretation");
    const refs = entry.evidence?.[0]?.references ?? [];
    expect(refs.some((r) => r.quote === "verbatim test quote")).toBe(true);
  });

  it("preserves input order and resolves each id independently", async () => {
    const res = await fetch(`${BASE}/recipes?ids=${UNKNOWN_UUID},${traceA}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    const body = (await res.json()) as LookupResponse;
    const entries = body.data?.recipes ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]!.recipeId).toBe(UNKNOWN_UUID);
    expect(entries[0]!.status).toBe("not_found_or_unreadable");
    expect(entries[1]!.recipeId).toBe(traceA);
    expect(entries[1]!.status).toBe("ok");
  });

  // ── SECURITY: IDOR + existence-leak proofs ──────────────────────────────

  it("IDOR: key B cannot read key A's trace by id — marker only, never content", async () => {
    const res = await fetch(`${BASE}/recipes?ids=${traceA}`, {
      headers: { Authorization: `Bearer ${keyB}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LookupResponse;
    expect(body.ok).toBe(true);
    const entry = body.data?.recipes?.[0];
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("not_found_or_unreadable");
    // Never content, in any field:
    expect(entry!.recipe).toBeUndefined();
    expect(entry!.evidence).toBeUndefined();
    expect(entry!.recipeBook).toBeUndefined();
    expect(entry!.author).toBeUndefined();
    // And the raw response text must not carry the trace's content anywhere.
    expect(JSON.stringify(body)).not.toContain("seeding one canonical trace");
  });

  it("no existence leak: the unreadable-id marker is shape-identical to the unknown-id marker", async () => {
    // traceA exists but is unreadable by key B; UNKNOWN_UUID does not exist.
    const res = await fetch(`${BASE}/recipes?ids=${traceA},${UNKNOWN_UUID}`, {
      headers: { Authorization: `Bearer ${keyB}` },
    });
    const body = (await res.json()) as LookupResponse;
    const [unreadable, unknown] = body.data?.recipes ?? [];
    expect(unreadable).toBeDefined();
    expect(unknown).toBeDefined();
    // Same status, same key set — after normalizing the id, the two markers
    // must be byte-identical so a caller can't distinguish the cases.
    const normalize = (e: LookupEntry) => JSON.stringify({ ...e, recipeId: "X" });
    expect(normalize(unreadable!)).toBe(normalize(unknown!));
  });

  it("malformed ids return the same marker and never kill the batch", async () => {
    const res = await fetch(`${BASE}/recipes?ids=not-a-uuid,${traceA}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LookupResponse;
    const entries = body.data?.recipes ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]!.recipeId).toBe("not-a-uuid");
    expect(entries[0]!.status).toBe("not_found_or_unreadable");
    expect(entries[1]!.status).toBe("ok");
    // Malformed marker is shape-identical to the unknown-id marker too.
    const unknownRes = await fetch(`${BASE}/recipes?ids=${UNKNOWN_UUID}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    const unknownBody = (await unknownRes.json()) as LookupResponse;
    const normalize = (e: LookupEntry) => JSON.stringify({ ...e, recipeId: "X" });
    expect(normalize(entries[0]!)).toBe(normalize(unknownBody.data!.recipes[0]!));
  });
});

describe.skipIf(!BASE)("GET /briefing — recipe_ids + purpose params (WT-3)", () => {
  let keyA: string;
  let keyB: string;
  let traceA: string;

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      setupUserWithKey("brief-a"),
      setupUserWithKey("brief-b"),
    ]);
    keyA = a.apiKey;
    keyB = b.apiKey;
    traceA = await createTrace(
      keyA,
      "As a test engineer working on briefing integration tests, I prefer one canonical requested-recipe fixture so that section assertions are deterministic.",
    );
  }, 60_000);

  it("renders a Requested recipes section with exactly the named recipes", async () => {
    const res = await fetch(`${BASE}/briefing?recipe_ids=${traceA},${UNKNOWN_UUID}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { text: string } };
    expect(body.ok).toBe(true);
    const text = body.data?.text ?? "";
    expect(text).toContain("## Requested recipes");
    expect(text).toContain(traceA);
    expect(text).toContain("one canonical requested-recipe fixture");
    // Unknown id renders as marker inside the same section.
    expect(text).toContain(UNKNOWN_UUID);
    expect(text).toContain("not_found_or_unreadable");
  });

  it("briefing recipe_ids uses the same ACL: key B gets a marker for key A's trace, never content", async () => {
    const res = await fetch(`${BASE}/briefing?recipe_ids=${traceA}`, {
      headers: { Authorization: `Bearer ${keyB}` },
    });
    const body = (await res.json()) as { ok: boolean; data?: { text: string } };
    const text = body.data?.text ?? "";
    expect(text).toContain("## Requested recipes");
    expect(text).toContain("not_found_or_unreadable");
    expect(text).not.toContain("one canonical requested-recipe fixture");
  });

  it("omits the Requested recipes section when recipe_ids is not passed", async () => {
    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    const body = (await res.json()) as { ok: boolean; data?: { text: string } };
    expect(body.data?.text).not.toContain("## Requested recipes");
  });

  it("echoes the purpose as a one-line acknowledgment", async () => {
    const purpose = "adding rate limiting to a new REST endpoint";
    const res = await fetch(`${BASE}/briefing?purpose=${encodeURIComponent(purpose)}`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { text: string } };
    const text = body.data?.text ?? "";
    expect(text).toContain(`Briefing purpose (biased exemplar selection): ${purpose}`);
  });

  it("briefing without purpose has no purpose acknowledgment line", async () => {
    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${keyA}` },
    });
    const body = (await res.json()) as { ok: boolean; data?: { text: string } };
    expect(body.data?.text).not.toContain("Briefing purpose (biased exemplar selection)");
  });
});
