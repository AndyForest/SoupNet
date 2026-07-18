import { describe, it, expect, afterAll } from "vitest";

/**
 * Layer 3 integration tests for the 2026-07-05 check-surface hardening
 * batch (FF-1):
 *
 *   1. Key-death UX — keyed-but-invalid /check requests get an explicit 401
 *      state (HTML + JSON) with remediation, never the anonymous page;
 *      invalid and expired render byte-identically (anti-enumeration).
 *   2. Missing-params 400 copy — accurate per-request diff in modern
 *      vocabulary (recipe/evidence with aliases), never the static legacy
 *      "key, trace, ef" list.
 *   3. POST /check honors format=json (query param, body param, Accept).
 *   4. %97 em-dash artifact — windows-1252 percent-escapes decode to the
 *      intended characters; exact stored bytes asserted via GET, POST
 *      (urlencoded + multipart), and MCP paths.
 *   7. filter/f — read-only search: no trace, no recipe.checked audit row,
 *      one check.searched accounting row; filter alongside a recipe narrows
 *      the candidate set and logs normally.
 *
 * Requires a running backend (BACKEND_URL) + direct PG access (PG* env) —
 * same pattern as audit-capture.test.ts; runs under `npm run test:ci`.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const EM_DASH = "—";

interface CheckJson {
  ok: boolean;
  error?: string;
  remediation?: { keysUrl?: string; note?: string };
  data?: {
    checked?: { recipeId?: string; recipe?: string };
    searchOnly?: boolean;
    filter?: string;
    notice?: string;
    results?: Array<{ recipeId: string; recipe?: string; known?: boolean }>;
    relatedEvidence?: Array<{ recipeId?: string }>;
    relatedEvidenceHint?: string;
    totalResults?: number;
  };
}

async function setupUserWithKey(tag: string): Promise<{ apiKey: string; jwt: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `checkhard-${tag}-${uid}@test.local`;
  const password = "check-hardening-pw-123";
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
  const jwt = loginBody.data?.token ?? "";
  if (!jwt) throw new Error(`Setup failed: login (${tag})`);
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const apiKey = keyBody.data?.key ?? "";
  if (!apiKey) throw new Error(`Setup failed: key mint (${tag})`);
  return { apiKey, jwt };
}

// Direct DB access for stored-bytes and audit assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlClient: any;

async function getSql() {
  if (!sqlClient) {
    const postgres = (await import("postgres")).default;
    sqlClient = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
  }
  return sqlClient;
}

afterAll(async () => {
  if (sqlClient) await sqlClient.end({ timeout: 2 });
});

async function storedClaimText(traceId: string): Promise<string | undefined> {
  const sql = await getSql();
  const rows = await sql`SELECT claim_text FROM claimnet.traces WHERE id = ${traceId}::uuid`;
  return rows[0]?.claim_text as string | undefined;
}

async function auditCounts(apiKey: string): Promise<{ checked: number; searched: number }> {
  const sql = await getSql();
  const rows = await sql`
    SELECT a.action, COUNT(*)::int AS n
    FROM claimnet.audit_log a
    JOIN claimnet.api_keys k ON k.id = a.api_key_id
    WHERE k.key = encode(sha256(${apiKey}::bytea), 'hex')
    GROUP BY a.action`;
  let checked = 0;
  let searched = 0;
  for (const r of rows) {
    if (r.action === "recipe.checked") checked = r.n;
    if (r.action === "check.searched") searched = r.n;
  }
  return { checked, searched };
}

async function traceCountForKey(apiKey: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS n
    FROM claimnet.traces t
    JOIN claimnet.api_keys k ON k.id = t.api_key_id
    WHERE k.key = encode(sha256(${apiKey}::bytea), 'hex')`;
  return rows[0]?.n ?? 0;
}

function checkUrl(params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${BASE}/check?${qs}`;
}

const RECIPE = (topic: string) =>
  `As a backend developer working on integration tests, I chose ${topic} so that the hardening batch stays verifiable.`;
const EVIDENCE = "The test suite asserts this end to end.\n> \"asserts this end to end\"\n-- check-hardening.test.ts";

// ── 1. Key-death UX ─────────────────────────────────────────────────────────

describe("key-death UX (invalid/expired key states)", () => {
  const GARBAGE_KEY = "cn_s_definitely_not_a_real_key_000000";

  it("keyed-but-invalid GET /check returns an explicit 401 HTML state with remediation, not the anonymous page", async () => {
    const res = await fetch(checkUrl({ key: GARBAGE_KEY }));
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("invalid or expired");
    expect(html).toContain("/app/keys");
    // Not the anonymous instructions page…
    expect(html).not.toContain("How to check a recipe");
    // …and the presented key is never echoed back.
    expect(html).not.toContain(GARBAGE_KEY);
  });

  it("keyed-but-invalid format=json returns 401 JSON with remediation fields", async () => {
    const res = await fetch(checkUrl({ key: GARBAGE_KEY, format: "json" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as CheckJson;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid or expired API key");
    expect(body.error).toContain("/app/keys");
    expect(body.error).toContain("no MCP reconnect");
    expect(body.remediation?.keysUrl).toContain("/app/keys");
  });

  it("Accept: application/json negotiates the same 401 JSON state", async () => {
    const res = await fetch(checkUrl({ key: GARBAGE_KEY }), {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as CheckJson;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("/app/keys");
  });

  it("an EXPIRED key renders byte-identically to an unknown key (anti-enumeration)", async () => {
    const { apiKey } = await setupUserWithKey("expire");
    const sql = await getSql();
    await sql`
      UPDATE claimnet.api_keys
      SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE key = encode(sha256(${apiKey}::bytea), 'hex')`;

    const [expiredJson, unknownJson] = await Promise.all([
      fetch(checkUrl({ key: apiKey, format: "json" })),
      fetch(checkUrl({ key: GARBAGE_KEY, format: "json" })),
    ]);
    expect(expiredJson.status).toBe(401);
    expect(unknownJson.status).toBe(401);
    expect(await expiredJson.text()).toBe(await unknownJson.text());

    const [expiredHtml, unknownHtml] = await Promise.all([
      fetch(checkUrl({ key: apiKey })),
      fetch(checkUrl({ key: GARBAGE_KEY })),
    ]);
    expect(expiredHtml.status).toBe(401);
    expect(await expiredHtml.text()).toBe(await unknownHtml.text());
  });

  it("keeps the legitimate no-key anonymous page (200, full instructions)", async () => {
    const res = await fetch(`${BASE}/check`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("How to check a recipe");
    expect(html).not.toContain("invalid or expired");
  });

  it("a valid key with no recipe still gets the normal form page", async () => {
    const { apiKey } = await setupUserWithKey("validform");
    const res = await fetch(checkUrl({ key: apiKey }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("How to check a recipe");
  });

  it("MCP tool call with a dead Bearer key returns remediation copy", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${GARBAGE_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "check_recipe",
          arguments: { recipe: RECIPE("mcp-dead-key"), supporting_evidence: EVIDENCE },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Invalid or expired API key");
    expect(text).toContain("/app/keys");
    expect(text).toContain("no MCP reconnect");
  });

  it("GET /briefing with a dead Bearer key returns 401 with remediation (stdio proxy inherits this copy)", async () => {
    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${GARBAGE_KEY}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as CheckJson;
    expect(body.error).toContain("Invalid or expired API key");
    expect(body.error).toContain("/app/keys");
  });
});

// ── 2. Missing-params 400 copy ──────────────────────────────────────────────

describe("missing-params 400 copy (accurate diff, modern vocabulary)", () => {
  it("key provided but no recipe → names only recipe+evidence with aliases, never 'key'", async () => {
    const { apiKey } = await setupUserWithKey("params1");
    const res = await fetch(checkUrl({ key: apiKey, format: "json" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as CheckJson;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("recipe (alias: trace)");
    expect(body.error).toContain("evidence (alias: ef)");
    expect(body.error).not.toContain("key, trace, ef");
    expect(body.error).not.toMatch(/\bkey\b/);
    // The sanctioned read-only path is advertised in the same breath.
    expect(body.error).toContain("filter=");
  });

  it("recipe provided but no evidence → names only evidence", async () => {
    const { apiKey } = await setupUserWithKey("params2");
    const res = await fetch(
      checkUrl({ key: apiKey, format: "json", recipe: "As a tester working on copy, I prefer accurate errors so that agents learn the real params." }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as CheckJson;
    expect(body.error).toContain("evidence (alias: ef)");
    expect(body.error).not.toContain("recipe (alias: trace)");
  });

  it("no key at all keeps the key-minting hint", async () => {
    const res = await fetch(checkUrl({ format: "json" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as CheckJson;
    expect(body.error).toContain("No API key provided");
    expect(body.error).toContain("/app/keys");
  });
});

// ── 3. POST /check format parity ────────────────────────────────────────────

describe("POST /check honors format=json (parity with GET)", () => {
  it("format=json as a URL query param on POST returns JSON", async () => {
    const { apiKey } = await setupUserWithKey("post1");
    const body = new URLSearchParams({
      key: apiKey,
      recipe: RECIPE("query-param format negotiation on POST"),
      evidence: EVIDENCE,
    });
    const res = await fetch(`${BASE}/check?format=json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    expect(json.data?.checked?.recipeId).toBeTruthy();
  });

  it("format=json as a body field returns JSON", async () => {
    const { apiKey } = await setupUserWithKey("post2");
    const body = new URLSearchParams({
      key: apiKey,
      recipe: RECIPE("body-field format negotiation on POST"),
      evidence: EVIDENCE,
      format: "json",
    });
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    expect(json.data?.checked?.recipeId).toBeTruthy();
  });

  it("Accept: application/json on POST returns JSON", async () => {
    const { apiKey } = await setupUserWithKey("post3");
    const body = new URLSearchParams({
      key: apiKey,
      recipe: RECIPE("accept-header format negotiation on POST"),
      evidence: EVIDENCE,
    });
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
  });

  it("POST without a format ask still returns HTML", async () => {
    const { apiKey } = await setupUserWithKey("post4");
    const body = new URLSearchParams({
      key: apiKey,
      recipe: RECIPE("default HTML on POST"),
      evidence: EVIDENCE,
    });
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

// ── 4. %97 em-dash artifact (windows-1252 escapes) ──────────────────────────

describe("query decoding stores exact intended bytes (the %97 artifact)", () => {
  it("GET with windows-1252 %97 escapes stores a real em-dash", async () => {
    const { apiKey } = await setupUserWithKey("emdash-get");
    // Raw URL, deliberately NOT encodeURIComponent — this is the cp1252 wire
    // form curl on a Windows console produced (the 2026-07-01 repro).
    const recipeRaw = "As%20a%20developer%20working%20on%20encoding%2C%20I%20chose%20lenient%20decoding%20%97%20windows-1252%20fallback%20%97%20so%20that%20agents%27%20text%20survives.";
    const evidenceRaw = "The%20bench%20traces%20carried%20cp1252%20dashes%20%97%20now%20decoded.%0A%3E%20%22now%20decoded%22%0A--%20latency-bench";
    const res = await fetch(`${BASE}/check?key=${apiKey}&format=json&recipe=${recipeRaw}&evidence=${evidenceRaw}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    expect(json.data?.checked?.recipe).toContain(`decoding ${EM_DASH} windows-1252 fallback ${EM_DASH}`);
    expect(json.data?.checked?.recipe).not.toContain("%97");
    const stored = await storedClaimText(json.data!.checked!.recipeId!);
    expect(stored).toBe(`As a developer working on encoding, I chose lenient decoding ${EM_DASH} windows-1252 fallback ${EM_DASH} so that agents' text survives.`);
  });

  it("GET with proper UTF-8 escapes (em-dash, accents, CJK) is unchanged", async () => {
    const { apiKey } = await setupUserWithKey("emdash-utf8");
    const recipe = `As a café-owner working on 日本 menus, I prefer UTF-8 ${EM_DASH} always ${EM_DASH} so that nothing mangles.`;
    const res = await fetch(checkUrl({ key: apiKey, format: "json", recipe, evidence: EVIDENCE }));
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    const stored = await storedClaimText(json.data!.checked!.recipeId!);
    expect(stored).toBe(recipe);
  });

  it("GET with double-encoded %2597 stores the literal text %97 (no double decode)", async () => {
    const { apiKey } = await setupUserWithKey("emdash-dbl");
    const res = await fetch(
      `${BASE}/check?key=${apiKey}&format=json&recipe=As%20a%20maintainer%20working%20on%20decoding%2C%20I%20documented%20the%20%2597%20artifact%20so%20that%20history%20survives.&evidence=${encodeURIComponent(EVIDENCE)}`,
    );
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    const stored = await storedClaimText(json.data!.checked!.recipeId!);
    expect(stored).toContain("the %97 artifact");
    expect(stored).not.toContain(EM_DASH);
  });

  it("POST urlencoded with %97 escapes stores a real em-dash", async () => {
    const { apiKey } = await setupUserWithKey("emdash-post");
    const rawBody = `key=${apiKey}&format=json&recipe=As%20a%20developer%20working%20on%20POST%20bodies%2C%20I%20chose%20lenient%20decoding%20%97%20again%20%97%20so%20that%20parity%20holds.&evidence=${encodeURIComponent(EVIDENCE)}`;
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    const stored = await storedClaimText(json.data!.checked!.recipeId!);
    expect(stored).toBe(`As a developer working on POST bodies, I chose lenient decoding ${EM_DASH} again ${EM_DASH} so that parity holds.`);
  });

  it("POST multipart with literal UTF-8 em-dash stores exact bytes", async () => {
    const { apiKey } = await setupUserWithKey("emdash-multi");
    const recipe = `As a developer working on multipart, I kept UTF-8 ${EM_DASH} intact ${EM_DASH} so that files and text coexist.`;
    const fd = new FormData();
    fd.set("key", apiKey);
    fd.set("format", "json");
    fd.set("recipe", recipe);
    fd.set("evidence", EVIDENCE);
    const res = await fetch(`${BASE}/check`, { method: "POST", body: fd });
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    const stored = await storedClaimText(json.data!.checked!.recipeId!);
    expect(stored).toBe(recipe);
  });

  it("MCP check_recipe stores exact bytes for em-dash + non-ASCII", async () => {
    const { apiKey } = await setupUserWithKey("emdash-mcp");
    const recipe = `As a développeur working on MCP paths, I verified em-dashes ${EM_DASH} end to end ${EM_DASH} so that no surface mangles text.`;
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "check_recipe", arguments: { recipe, supporting_evidence: EVIDENCE } },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const idMatch = /Recipe checked as #([0-9a-f-]{36})/.exec(text);
    expect(idMatch).toBeTruthy();
    const stored = await storedClaimText(idMatch![1]!);
    expect(stored).toBe(recipe);
  });
});

// ── 7. filter / f — the read-only search path ───────────────────────────────

describe("filter/f read-only search on /check", () => {
  it("filter with no recipe searches without logging anything (no trace, no recipe.checked; one check.searched)", async () => {
    const { apiKey } = await setupUserWithKey("filter1");
    // Seed two recipes so the search has a corpus.
    for (const topic of ["grapefruit clustering", "turnip pagination"]) {
      const seeded = await fetch(checkUrl({ key: apiKey, format: "json", recipe: RECIPE(topic), evidence: EVIDENCE }));
      expect(((await seeded.json()) as CheckJson).ok).toBe(true);
    }
    const before = await auditCounts(apiKey);
    const tracesBefore = await traceCountForKey(apiKey);
    expect(before.checked).toBe(2);
    expect(tracesBefore).toBe(2);

    const res = await fetch(checkUrl({ key: apiKey, format: "json", filter: "grapefruit clustering" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    expect(json.data?.searchOnly).toBe(true);
    expect(json.data?.filter).toBe("grapefruit clustering");
    expect(json.data?.notice).toContain("no recipe was logged");
    expect(json.data?.checked?.recipeId).toBeUndefined();
    expect((json.data?.results?.length ?? 0)).toBeGreaterThan(0);

    const after = await auditCounts(apiKey);
    const tracesAfter = await traceCountForKey(apiKey);
    expect(tracesAfter).toBe(tracesBefore);        // NOTHING logged
    expect(after.checked).toBe(before.checked);    // F29 budget untouched
    expect(after.searched).toBe(before.searched + 1); // accounting row present

    const sql = await getSql();
    const rows = await sql`
      SELECT a.metadata FROM claimnet.audit_log a
      JOIN claimnet.api_keys k ON k.id = a.api_key_id
      WHERE k.key = encode(sha256(${apiKey}::bytea), 'hex') AND a.action = 'check.searched'`;
    expect(rows[0]?.metadata?.filter).toBe("grapefruit clustering");
  });

  it("alias f works and renders the search-only HTML notice", async () => {
    const { apiKey } = await setupUserWithKey("filter2");
    const seeded = await fetch(checkUrl({ key: apiKey, format: "json", recipe: RECIPE("html filter notices"), evidence: EVIDENCE }));
    expect(((await seeded.json()) as CheckJson).ok).toBe(true);

    const res = await fetch(checkUrl({ key: apiKey, f: "filter notices" }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Read-only search");
    expect(html).toContain("no recipe was logged");
    // Not the check confirmation.
    expect(html).not.toContain("Your recipe was checked as #");
    expect(await traceCountForKey(apiKey)).toBe(1);
  });

  it("filter alongside a recipe logs normally and narrows results by keyword", async () => {
    const { apiKey } = await setupUserWithKey("filter3");
    for (const topic of ["grapefruit sharding", "turnip caching"]) {
      const seeded = await fetch(checkUrl({ key: apiKey, format: "json", recipe: RECIPE(topic), evidence: EVIDENCE }));
      expect(((await seeded.json()) as CheckJson).ok).toBe(true);
    }
    const before = await auditCounts(apiKey);

    const res = await fetch(checkUrl({
      key: apiKey,
      format: "json",
      recipe: RECIPE("narrowed checking"),
      evidence: EVIDENCE,
      filter: "grapefruit",
    }));
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    expect(json.data?.checked?.recipeId).toBeTruthy();       // the check logged
    expect(json.data?.searchOnly).toBeUndefined();
    const results = json.data?.results ?? [];
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect((r.recipe ?? "").toLowerCase()).toContain("grapefruit");
    }

    const after = await auditCounts(apiKey);
    expect(after.checked).toBe(before.checked + 1); // normal check accounting
    expect(after.searched).toBe(before.searched);   // not a search-only row
  });

  it("filter search stays within the key's read scope (uses the same resolution as checks)", async () => {
    // Two users, separate personal books — B's filter search must not see A's recipes.
    const a = await setupUserWithKey("filterA");
    const seeded = await fetch(checkUrl({ key: a.apiKey, format: "json", recipe: RECIPE("private rutabaga secrets"), evidence: EVIDENCE }));
    expect(((await seeded.json()) as CheckJson).ok).toBe(true);

    const b = await setupUserWithKey("filterB");
    const res = await fetch(checkUrl({ key: b.apiKey, format: "json", filter: "private rutabaga secrets" }));
    const json = (await res.json()) as CheckJson;
    expect(json.ok).toBe(true);
    for (const r of json.data?.results ?? []) {
      expect(r.recipe ?? "").not.toContain("rutabaga");
    }
  });
});
