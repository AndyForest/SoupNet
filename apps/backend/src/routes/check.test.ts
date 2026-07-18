import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for /check routes — requires running backend.
 * Skips if BACKEND_URL is not set (sync check, avoids async timing issue).
 * Run with: source .env && npx vitest run
 */

interface CheckResponse {
  ok: boolean;
  error?: string;
  data?: {
    checked?: { recipeId?: string };
    results?: Array<{ recipeId?: string; evidence?: unknown[] }>;
    synthesis?: string;
    synthesisNotice?: string;
  };
}

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

let apiKey = "";
let token = "";
let checkEmail = "";

describe.skipIf(!BASE)("/check routes integration", () => {
  beforeAll(async () => {
    checkEmail = `test-check-${uid}@test.local`;
    const checkPassword = "check-test-password-123";

    // Register a test user. F30: /auth/register no longer auto-logs-in.
    const regRes = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: checkEmail, password: checkPassword, tosAccepted: true }),
    });
    const regBody = (await regRes.json()) as { data?: { verificationToken?: string } };

    // F15: verify the user before creating keys. The dev backend exposes the
    // verification token in the register response when ALLOW_AUTO_SETUP=true.
    const verificationToken = regBody.data?.verificationToken;
    if (!verificationToken) throw new Error("Backend did not return verificationToken — ALLOW_AUTO_SETUP must be true in dev");
    const verifyRes = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verificationToken }),
    });
    if (!verifyRes.ok) throw new Error("Failed to verify test user");

    // Log in to obtain the JWT (F30: not returned from /register anymore).
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: checkEmail, password: checkPassword }),
    });
    const loginBody = (await loginRes.json()) as { data?: { token?: string } };
    token = loginBody.data?.token ?? "";
    if (!token) throw new Error("Failed to log in test user");

    // Generate a daily API key
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const keyBody = (await keyRes.json()) as { data?: { key?: string } };
    apiKey = keyBody.data?.key ?? "";
    if (!apiKey) throw new Error("Failed to generate test API key");
  });
  it("GET /check with key returns HTML page", async () => {
    const res = await fetch(`${BASE}/check?key=${encodeURIComponent(apiKey)}`);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Soup.net");
  });

  it("GET /check with key + trace + ef returns HTML with results header", { timeout: 15_000 }, async () => {
    // The confirmation header is rendered in a Next Steps block that appears
    // whenever a check completes successfully — even when the corpus has no
    // matching recipes (the previous "seed first then search" workaround is
    // no longer needed).
    const trace = `As a test engineer working on automated endpoint tests for ${uid}, I prefer automated endpoint testing`;
    const ef = `Testing the check endpoint.\n> "Automated tests catch regressions"\n-- Testing best practices`;
    const url = `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(trace)}&ef=${encodeURIComponent(ef)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Your recipe was checked as");
  });

  it("GET /check with format=json returns JSON", async () => {
    const trace = encodeURIComponent(`As a test engineer, I prefer JSON format responses for programmatic consumption so that parsing is reliable — test ${uid}`);
    const ef = encodeURIComponent(`JSON is easier to parse than HTML.\n> "Structured data is more reliable"\n— API design principles`);
    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${trace}&ef=${ef}&format=json`,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data?.checked?.recipeId).toBeDefined();
    expect(typeof body.data?.checked?.recipeId).toBe("string");
  });

  it("JSON response includes evidence and references", { timeout: 15_000 }, async () => {
    const trace = encodeURIComponent(`As a test engineer, I prefer enriched results with evidence and references so that consumers get full context — test ${uid}`);
    const ef = encodeURIComponent(`Evidence enrichment improves response quality.\n> "Full context helps agents make better decisions"\n— UX research`);

    // Submit a first trace so there's something in results
    await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${encodeURIComponent(`As a test engineer, I prefer seeding test data before assertions so that results are deterministic — seed ${uid}`)}&ef=${ef}&format=json`,
    );

    const res = await fetch(
      `${BASE}/check?key=${encodeURIComponent(apiKey)}&trace=${trace}&ef=${ef}&format=json`,
    );

    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);

    // If there are results, verify the evidence structure
    if ((body.data?.results?.length ?? 0) > 0) {
      const firstResult = body.data!.results![0]!;
      expect(firstResult).toHaveProperty("evidence");
      expect(Array.isArray(firstResult.evidence)).toBe(true);
    }
  });

  it("POST /check with form data works", async () => {
    const formBody = new URLSearchParams({
      key: apiKey,
      trace: `As a test engineer, I prefer that POST form submissions work identically to GET so that both methods produce the same results — test ${uid}`,
      ef: `POST and GET should be interchangeable.\n> "Same endpoint, same behavior"\n— HTTP design principles`,
      format: "json",
    });

    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.checked?.recipeId).toBeDefined();
  });

  it("missing key returns error", async () => {
    const res = await fetch(
      `${BASE}/check?trace=test&ef=test&format=json`,
    );

    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  // F29: the per-key rate limiter reads from audit_log.api_key_id, so every
  // recipe.checked event must populate that column directly (not just
  // metadata.apiKeyId). This test makes a real /check call and asserts the
  // column is non-null for the row written.
  it("F29: recipe.checked audit row carries api_key_id in its dedicated column", async () => {
    const postgres = (await import("postgres")).default;
    const trace = `As a backend engineer working on plan-04 fix queue ${uid}, I prefer audit-log columns over jsonb extraction so that rate-limit COUNT queries hit a btree index.`;
    const ef = `Indexed columns are faster than jsonb path extraction.\n> "Use the right tool"\n— PG docs`;
    const params = new URLSearchParams({ key: apiKey, trace, ef, format: "json" });

    const res = await fetch(`${BASE}/check?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    const recipeId = body.data?.checked?.recipeId;
    if (!recipeId) throw new Error("recipeId missing from /check JSON response");

    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      const rows: Array<{ api_key_id: string | null; metadata: { apiKeyId?: string } }> = await sql`
        SELECT api_key_id, metadata
        FROM claimnet.audit_log
        WHERE action = 'recipe.checked' AND target_id = ${recipeId}::uuid
        LIMIT 1
      `;
      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row.api_key_id).toBeTruthy();
      // Back-compat: metadata.apiKeyId still present so old queries keep working.
      expect(row.metadata.apiKeyId).toBe(row.api_key_id);
    } finally {
      await sql.end();
    }
  });

  // F11 follow-up: when a /check call carries a file upload, the
  // recipe.checked audit row records hasFile/fileHash/fileMimeType/fileBytes
  // in metadata so future incident response can trace which key uploaded
  // what bytes against which trace. (The ACCEPTED-with-conditions risk
  // posture in security-audit-2026-04-09 hinges on this trail.)
  it("F11: recipe.checked audit row records upload metadata when a file is attached", async () => {
    const postgres = (await import("postgres")).default;
    // 1x1 transparent PNG — same fixture used by uploads.test.ts.
    const TINY_PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const trace = `As a forensic analyst working on F11 audit recovery for ${uid}, I prefer hash and mime metadata recorded inline so that a single audit_log row identifies a leaked-content incident's key and bytes.`;
    const ef = `Upload metadata pinned to the recipe-checked row keeps forensic queries to one table.\n> "Single source of truth"\n— Soup.net audit policy`;

    const form = new FormData();
    form.set("key", apiKey);
    form.set("trace", trace);
    form.set("ef", ef);
    form.set("format", "json");
    form.set("image", new Blob([TINY_PNG], { type: "image/png" }), "tiny.png");

    const res = await fetch(`${BASE}/check`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    const recipeId = body.data?.checked?.recipeId;
    if (!recipeId) throw new Error("recipeId missing from /check JSON response");

    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      const rows: Array<{ metadata: Record<string, unknown> }> = await sql`
        SELECT metadata FROM claimnet.audit_log
        WHERE action = 'recipe.checked' AND target_id = ${recipeId}::uuid
        LIMIT 1
      `;
      expect(rows.length).toBe(1);
      const meta = rows[0]!.metadata;
      expect(meta["hasFile"]).toBe(true);
      expect(meta["fileMimeType"]).toBe("image/png");
      expect(typeof meta["fileHash"]).toBe("string");
      expect((meta["fileHash"] as string).length).toBe(64); // sha256 hex
      expect(meta["fileBytes"]).toBe(TINY_PNG.length);
    } finally {
      await sql.end();
    }
  }, 15_000);

  it("idempotent — same recipe twice returns same ID via JSON", async () => {
    const trace = `As a test engineer, I prefer that repeated identical requests return the same result so that the system is deterministic — idempotent test ${uid}`;
    const ef = `Idempotency is a core design principle.\n> "Same input, same output"\n— REST design principles`;
    const params = new URLSearchParams({
      key: apiKey,
      trace,
      ef,
      format: "json",
    });

    const res1 = await fetch(`${BASE}/check?${params.toString()}`);
    const body1 = (await res1.json()) as CheckResponse;

    const res2 = await fetch(`${BASE}/check?${params.toString()}`);
    const body2 = (await res2.json()) as CheckResponse;

    expect(body1.ok).toBe(true);
    expect(body2.ok).toBe(true);
    expect(body1.data?.checked?.recipeId).toBe(body2.data?.checked?.recipeId);
  });

  // ── Premium synthesis (synthesize param) ────────────────────────────────
  // WP2: the server-side synthesis path. Gate is premiumAt IS NOT NULL AND the
  // features.synthesize preference flag. CI runs SYNTHESIS_PROVIDER=stub, so an
  // eligible caller gets the deterministic stub profile that cites every
  // returned recipe id verbatim. These tests mutate the shared user's premium
  // flag, so they run after the plain-check assertions above and before F28.

  const synthTrace = (n: string) =>
    `As a preference-profiling engineer working on synthesis coverage ${uid}-${n}, I prefer deterministic stub synthesis so that eligibility assertions are stable.`;
  const synthEf = `Determinism keeps the synthesis gate testable.\n> "Same input, same profile"\n-- Synthesis test plan`;

  it("no synthesize param → response carries neither synthesis nor a notice", async () => {
    const params = new URLSearchParams({ key: apiKey, trace: synthTrace("plain"), ef: synthEf, format: "json" });
    const res = await fetch(`${BASE}/check?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.synthesis).toBeUndefined();
    expect(body.data?.synthesisNotice).toBeUndefined();
  });

  it("synthesize=true from a non-premium user → normal response + a one-line notice, no synthesis", async () => {
    const params = new URLSearchParams({ key: apiKey, trace: synthTrace("nonpremium"), ef: synthEf, format: "json", synthesize: "true" });
    const res = await fetch(`${BASE}/check?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);
    // Response is otherwise normal — a recipe was still logged.
    expect(body.data?.checked?.recipeId).toBeDefined();
    expect(body.data?.synthesis).toBeUndefined();
    expect(body.data?.synthesisNotice).toBeDefined();
    expect(body.data?.synthesisNotice).toMatch(/premium/i);
  });

  it("premium user with the flag OFF → notice, no synthesis", async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      // Grant premium but leave the opt-in flag off (default).
      await sql`UPDATE claimnet.users SET premium_at = now() WHERE email = ${checkEmail}`;
    } finally {
      await sql.end();
    }

    const params = new URLSearchParams({ key: apiKey, trace: synthTrace("flagoff"), ef: synthEf, format: "json", synthesize: "true" });
    const res = await fetch(`${BASE}/check?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.synthesis).toBeUndefined();
    expect(body.data?.synthesisNotice).toBeDefined();
  });

  it("premium user with the flag ON → synthesis present, citing returned recipe ids (stub provider)", { timeout: 15_000 }, async () => {
    // premium_at was set in the previous test; flip the opt-in flag on via the
    // JWT-auth preferences endpoint (exercises the real merge path).
    const patchRes = await fetch(`${BASE}/me/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ features: { synthesize: true } }),
    });
    expect(patchRes.status).toBe(200);

    const params = new URLSearchParams({ key: apiKey, trace: synthTrace("flagon"), ef: synthEf, format: "json", synthesize: "true" });
    const res = await fetch(`${BASE}/check?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.synthesisNotice).toBeUndefined();
    expect(typeof body.data?.synthesis).toBe("string");
    // The stub cites every returned recipe id verbatim — assert the top result's
    // id appears in the profile when the corpus returned any exemplars.
    const results = body.data?.results ?? [];
    if (results.length > 0 && results[0]?.recipeId) {
      expect(body.data?.synthesis).toContain(results[0]!.recipeId!);
    }
  });

  // F28: framework-level body size cap. A 22 MiB POST should be rejected
  // before Hono parses the body, so the route handler never runs. This
  // test is intentionally last in the describe block — bodyLimit middleware
  // emits the 413 response before fully draining the request, which can
  // leave the keep-alive socket in a state that breaks the very next
  // request reusing it. Running this last keeps the broken-socket
  // aftermath out of every other test's path.
  it("F28: POST /check rejects bodies over 21 MiB at the framework layer", async () => {
    // Multipart with a single oversized field. We don't need a real file —
    // a chunk of bytes inside the form is enough to push the body past the
    // limit. URL-encoded would also work but multipart is the realistic
    // upload path the audit calls out.
    const oversize = "x".repeat(22 * 1024 * 1024);
    const form = new FormData();
    form.append("key", apiKey);
    form.append("trace", oversize);

    const res = await fetch(`${BASE}/check`, { method: "POST", body: form });
    expect(res.status).toBe(413);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  }, 15_000);
});
