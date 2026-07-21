import { describe, it, expect, beforeAll } from "vitest";
import { RANKING_ALGORITHM_VERSION } from "@soupnet/domain";

/**
 * Layer 3 integration tests for GET /health/version — API-key-authed stack
 * introspection (eval-reset contract item (d) + reduced (f)).
 *
 * Covers: uniform 401 for missing AND garbage keys (with no expiry-data leak,
 * the anti-enumeration boundary); 200 + full shape for a fresh daily key; the
 * presenting key's expiry surfaced as a future ISO date; and the ranking
 * version echoing the @soupnet/domain constant.
 *
 * Requires a running backend (BACKEND_URL) — same pattern as recipes.test.ts /
 * check.test.ts; runs under `npm run test:ci`. Never asserts on GIT_COMMIT
 * being set — only that gitCommit is a non-empty string (the "unknown"
 * fallback is a valid value), so CI (which doesn't set it) stays green.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface VersionResponse {
  ok: boolean;
  error?: string;
  data?: {
    gitCommit: string;
    rankingAlgorithmVersion: string;
    migrations: { count: number; latest: { hash: string; createdAt: string } | null };
    embeddings: { provider: string; modelId: string };
    key: { expiresAt: string; keyType: string };
  };
}

async function setupUserWithKey(tag: string): Promise<{ apiKey: string }> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `version-${tag}-${uid}@test.local`;
  const password = "version-test-password-123";
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

describe.skipIf(!BASE)("GET /health/version — stack introspection", () => {
  let apiKey: string;

  beforeAll(async () => {
    apiKey = (await setupUserWithKey("a")).apiKey;
  }, 60_000);

  // ── Auth: uniform 401, no expiry-data leak ──────────────────────────────

  it("returns 401 without a key", async () => {
    const res = await fetch(`${BASE}/health/version`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as VersionResponse;
    expect(body.ok).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it("returns 401 for a garbage key and leaks no expiry data", async () => {
    const res = await fetch(`${BASE}/health/version`, {
      headers: { Authorization: "Bearer cn_s_definitely-not-a-real-key" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as VersionResponse;
    expect(body.ok).toBe(false);
    expect(body.data).toBeUndefined();
    // Anti-enumeration: the failure response must not carry the key block or
    // any expiry timestamp. The generic error string may say "invalid or
    // expired" by canonical design (invalid and expired are indistinguishable),
    // but no expiresAt field and no ISO datetime may appear in the body.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("expiresAt");
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("accepts the key via ?key= query param too (dual acceptance)", async () => {
    const res = await fetch(`${BASE}/health/version?key=${encodeURIComponent(apiKey)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionResponse;
    expect(body.ok).toBe(true);
  });

  // ── Happy path: full shape ──────────────────────────────────────────────

  it("returns 200 with the full introspection shape for a fresh daily key", async () => {
    const res = await fetch(`${BASE}/health/version`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionResponse;
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data).toBeDefined();

    // gitCommit: a non-empty string (accepts the "unknown" fallback — CI never
    // sets GIT_COMMIT, so we assert type + non-empty, never a specific value).
    expect(typeof data.gitCommit).toBe("string");
    expect(data.gitCommit.length).toBeGreaterThan(0);

    // rankingAlgorithmVersion echoes the domain constant exactly.
    expect(data.rankingAlgorithmVersion).toBe(RANKING_ALGORITHM_VERSION);

    // migrations: count is a positive int, latest carries a hash + ISO date.
    expect(typeof data.migrations.count).toBe("number");
    expect(data.migrations.count).toBeGreaterThan(0);
    expect(data.migrations.latest).not.toBeNull();
    expect(typeof data.migrations.latest!.hash).toBe("string");
    expect(data.migrations.latest!.hash.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(data.migrations.latest!.createdAt))).toBe(false);

    // embeddings: provider + modelId are non-empty strings.
    expect(typeof data.embeddings.provider).toBe("string");
    expect(data.embeddings.provider.length).toBeGreaterThan(0);
    expect(typeof data.embeddings.modelId).toBe("string");
    expect(data.embeddings.modelId.length).toBeGreaterThan(0);

    // key: keyType is 'daily' for a fresh daily key; expiresAt is a future ISO.
    expect(data.key.keyType).toBe("daily");
    const expiry = Date.parse(data.key.expiresAt);
    expect(Number.isNaN(expiry)).toBe(false);
    expect(expiry).toBeGreaterThan(Date.now());
  });
});
