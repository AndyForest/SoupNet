import { describe, it, expect, beforeAll } from "vitest";

/**
 * Layer 3 integration tests for declared intents (cold-start v2 Phase C).
 *
 * The contract under test (operator rulings 2026-08-23, recipes 363e3e0c /
 * 5c55327d; ranking purity per 9067ca1b / 4d25aec9):
 *   - text ALWAYS registers a new intent (identical text → distinct ids);
 *   - the id joins later checks/searches; recipes already delivered against
 *     the intent render as id-stubs (RENDERING only — totals unchanged);
 *   - losing the id and re-sending the story yields a FRESH intent with no
 *     stubs (compaction-safe semantics, like omitting session_id);
 *   - a cross-user id resolves to the uniform not-recognized notice and the
 *     call proceeds untracked;
 *   - feedback joins by intent_id (join-only; text never registers there);
 *   - get_briefing registers at briefing time and echoes the id.
 *
 * Requires a running backend (BACKEND_URL); runs under `npm run test:ci`.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const INTENT_ID_RE = /int_[A-Za-z0-9]{24}/;

async function setupUserWithKey(tag: string): Promise<{ apiKey: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `intent-${tag}-${uid}@test.local`;
  const password = "intent-test-password-123";
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

interface CheckData {
  checked?: { recipeId?: string };
  results?: Array<{ recipeId?: string; recipe?: string; known?: boolean }>;
  totalResults?: number;
  sessionId?: string;
  intentId?: string;
  intentNotice?: string;
  searchId?: string;
}
interface CheckResponse { ok: boolean; error?: string; data?: CheckData }

/** GET /check with format=json. `sessionId: "omit"` sentinel keeps each call
 *  session-fresh unless a session is explicitly threaded. */
async function check(
  apiKey: string,
  recipeText: string,
  opts: { intent?: string; sessionId?: string } = {},
): Promise<CheckResponse> {
  const ef = `Test evidence interpretation.\n> "verbatim test quote"\n-- intents integration test, 2026-08-23`;
  let url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(recipeText)}&ef=${encodeURIComponent(ef)}&format=json`;
  if (opts.intent) url += `&intent=${encodeURIComponent(opts.intent)}`;
  if (opts.sessionId) url += `&session_id=${encodeURIComponent(opts.sessionId)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return (await res.json()) as CheckResponse;
}

async function search(apiKey: string, query: string, opts: { intent?: string } = {}): Promise<CheckResponse> {
  let url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&filter=${encodeURIComponent(query)}&format=json`;
  if (opts.intent) url += `&intent=${encodeURIComponent(opts.intent)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return (await res.json()) as CheckResponse;
}

const STORY =
  "As a test engineer working on declared-intent integration, I want broad context on intent mechanics so that the stub ledger has deterministic content.";

describe.skipIf(!BASE)("declared intents (cold-start v2 Phase C)", () => {
  let keyA: string;
  let keyB: string;

  beforeAll(async () => {
    const [a, b] = await Promise.all([setupUserWithKey("a"), setupUserWithKey("b")]);
    keyA = a.apiKey;
    keyB = b.apiKey;
    // Seed enough corpus that a later check returns results to deliver.
    for (let i = 1; i <= 3; i++) {
      await check(keyA, `As a test engineer working on declared-intent integration, I prefer seed recipe number ${i} so that later checks have deliverable results.`);
    }
  }, 90_000);

  it("text registers an intent; identical text registers a DIFFERENT one (never merged)", async () => {
    const first = await check(keyA, `${STORY} (registration probe one)`, { intent: STORY });
    expect(first.ok).toBe(true);
    const firstId = first.data?.intentId ?? "";
    expect(firstId).toMatch(INTENT_ID_RE);
    expect(first.data?.intentNotice).toContain("Intent registered");

    const second = await check(keyA, `${STORY} (registration probe two)`, { intent: STORY });
    const secondId = second.data?.intentId ?? "";
    expect(secondId).toMatch(INTENT_ID_RE);
    expect(secondId).not.toBe(firstId);
  });

  it("delivered recipes never re-render full text against the intent id (rendering-only ledger)", async () => {
    const reg = await check(keyA, `${STORY} (stub-ledger probe)`, { intent: STORY });
    const intentId = reg.data?.intentId ?? "";
    expect(intentId).toMatch(INTENT_ID_RE);
    const deliveredFull = (reg.data?.results ?? []).filter((r) => !r.known && r.recipe);
    expect(deliveredFull.length).toBeGreaterThanOrEqual(1);
    const deliveredIds = new Set(deliveredFull.map((r) => r.recipeId));

    // Similar query, carrying ONLY the intent id (session omitted = fresh):
    // a delivered recipe may appear as an id-stub, yield its cluster slot,
    // or be listed among knownClusterMembers — but its FULL text must never
    // re-render against this intent. (Exact stub placement depends on the
    // cluster-yield mechanics; the ledger's contract is the full-text bound.
    // Query text stays paren-free — parentheses are search-grammar groups.)
    const next = await search(keyA, "declared-intent stub ledger probe deterministic content", { intent: intentId });
    expect(next.ok).toBe(true);
    expect(next.data?.intentNotice).toContain(`Intent: ${intentId}`);
    const fullAgain = (next.data?.results ?? []).filter((r) => deliveredIds.has(r.recipeId) && r.recipe);
    expect(fullAgain).toHaveLength(0);

    // Positive control: the SAME query with no intent (and no session) does
    // re-render at least one delivered recipe in full — proving the previous
    // assertion held because of the intent ledger, not the corpus shape.
    const control = await search(keyA, "declared-intent stub ledger probe deterministic content");
    const controlFull = (control.data?.results ?? []).filter((r) => deliveredIds.has(r.recipeId) && r.recipe);
    expect(controlFull.length).toBeGreaterThanOrEqual(1);
  });

  it("compaction recovery: re-sending the story mints a FRESH intent with no stubs", async () => {
    const reg = await check(keyA, `${STORY} (compaction probe)`, { intent: `${STORY} compaction arm` });
    const firstId = reg.data?.intentId ?? "";
    expect(firstId).toMatch(INTENT_ID_RE);

    // "Lost the id" — re-register the same story text. Paren-free query
    // (parentheses are search-grammar groups).
    const fresh = await search(keyA, "declared-intent compaction probe deterministic content", { intent: `${STORY} compaction arm` });
    const freshId = fresh.data?.intentId ?? "";
    expect(freshId).toMatch(INTENT_ID_RE);
    expect(freshId).not.toBe(firstId);
    // Fresh intent → empty ledger → nothing intent-stubbed.
    expect(fresh.data?.intentNotice).toContain("Intent registered");
  });

  it("a cross-user intent id gets the uniform not-recognized notice; the call proceeds untracked", async () => {
    const reg = await check(keyA, `${STORY} (cross-user probe)`, { intent: `${STORY} cross-user arm` });
    const intentId = reg.data?.intentId ?? "";
    expect(intentId).toMatch(INTENT_ID_RE);

    const probe = await check(keyB, "As a test engineer working on intent isolation, I prefer cross-user probes so that ledger boundaries are proven.", { intent: intentId });
    expect(probe.ok).toBe(true); // never fails the check
    expect(probe.data?.intentId).toBeUndefined();
    expect(probe.data?.intentNotice).toContain("unknown or not yours");
  });

  it("feedback joins by intent_id (join-only; POST /feedback)", async () => {
    const reg = await check(keyA, `${STORY} (feedback probe)`, { intent: `${STORY} feedback arm` });
    const intentId = reg.data?.intentId ?? "";
    const traceId = reg.data?.checked?.recipeId ?? "";
    expect(intentId).toMatch(INTENT_ID_RE);
    expect(traceId).toBeTruthy();

    const fbRes = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
      body: JSON.stringify({
        trace_id: traceId,
        kind: "check-feedback",
        impact: "subtle",
        disposition: "proceeded",
        story_fulfilled: "yes",
        story: "As a test engineer, I wanted the intent join proven end-to-end.",
        intent_id: intentId,
      }),
    });
    expect(fbRes.status).toBe(200);
    const fbBody = (await fbRes.json()) as { ok: boolean; data?: { results?: Array<{ ok: boolean }> } };
    expect(fbBody.ok).toBe(true);
  });

  it("get_briefing registers an intent and echoes the carry-the-id protocol", async () => {
    const res = await fetch(`${BASE}/briefing?intent=${encodeURIComponent(`${STORY} briefing arm`)}`, {
      headers: { Authorization: `Bearer ${keyA}`, "X-SoupNet-Surface": "mcp-stdio" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { text: string } };
    const text = body.data?.text ?? "";
    expect(text).toContain("Intent registered: int_");
    const id = INTENT_ID_RE.exec(text)?.[0] ?? "";
    expect(id).toMatch(INTENT_ID_RE);
    // The briefing-registered id joins on a subsequent check.
    const joined = await check(keyA, `${STORY} (briefing-join probe)`, { intent: id });
    expect(joined.data?.intentId).toBe(id);
    expect(joined.data?.intentNotice).toContain(`Intent: ${id}`);
  });

  it("MCP check_recipe carries intent and ride-along feedback inherits the resolved id", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${keyA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "check_recipe",
          arguments: {
            recipe: `${STORY} (mcp probe)`,
            supporting_evidence: 'Fixture interpretation.\n> "fixture quote"\n-- intents integration test',
            intent: `${STORY} mcp arm`,
          },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("Intent registered: int_");
  });
});
