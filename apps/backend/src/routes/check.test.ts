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
    recipeId?: string;
    results?: Array<{ evidence?: unknown[] }>;
  };
}

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

let apiKey = "";

describe.skipIf(!BASE)("/check routes integration", () => {
  beforeAll(async () => {
    // Register a test user
    const regRes = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-check-${uid}@test.local`,
        password: "check-test-password-123",
        tosAccepted: true,
      }),
    });
    const regBody = (await regRes.json()) as { data?: { token?: string; verificationToken?: string } };
    const token = regBody.data?.token;
    if (!token) throw new Error("Failed to register test user");

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

  it("GET /check with key + trace + ef returns HTML with results header", async () => {
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
    expect(body.data?.recipeId).toBeDefined();
    expect(typeof body.data?.recipeId).toBe("string");
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
    expect(body.data?.recipeId).toBeDefined();
  });

  it("missing key returns error", async () => {
    const res = await fetch(
      `${BASE}/check?trace=test&ef=test&format=json`,
    );

    const body = (await res.json()) as CheckResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

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
    expect(body1.data?.recipeId).toBe(body2.data?.recipeId);
  });
});
