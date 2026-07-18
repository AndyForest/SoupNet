import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for known_recipes dedup, phase 1 (WT-4 phase 4).
 *
 * The binding invariant: RENDERING ONLY. The same check with and without
 * the param must log identically — same trace id (idempotency untouched),
 * one trace row, and the known result still occupying its slot in the
 * response and in the recipe.checked audit metadata (cluster math
 * unchanged).
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface CheckJson {
  ok: boolean;
  data?: {
    recipeId: string;
    results: Array<{
      id: string;
      known?: boolean;
      recipe?: string;
      evidence?: unknown[];
      similarity?: number | null;
    }>;
  };
}

async function registerAndKey(): Promise<string> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `known-${uid}@test.local`;
  const password = "known-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error("register failed");
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
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginBody.data?.token}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const key = keyBody.data?.key ?? "";
  if (!key) throw new Error("key mint failed");
  return key;
}

async function check(apiKey: string, trace: string, extra: Record<string, string> = {}): Promise<CheckJson> {
  const params = new URLSearchParams({
    key: apiKey,
    trace,
    ef: `Interpretation.\n> "quote"\n-- known-recipes test`,
    format: "json",
    ...extra,
  });
  const res = await fetch(`${BASE}/check?${params.toString()}`, { headers: { Accept: "application/json" } });
  return (await res.json()) as CheckJson;
}

describe.skipIf(!BASE)("known_recipes dedup (rendering only)", () => {
  let apiKey: string;
  let seedId: string;
  const seedText = `As a developer working on context budgets, I chose one-line stubs for recipes the agent already holds so that responses spend context on new material. (seed ${Date.now()})`;
  const probeText = `As a developer working on context budgets, I prefer declaring held recipe ids on each check so that repeated exemplars stop re-arriving in full. (probe ${Date.now()})`;

  beforeAll(async () => {
    apiKey = await registerAndKey();
    const seed = await check(apiKey, seedText);
    seedId = seed.data?.recipeId ?? "";
    if (!seedId) throw new Error("seed check failed");
  }, 60_000);

  it("without the param, the seed recipe returns in full; with it, as a one-line stub — same check logs identically", async () => {
    // First probe: no known_recipes.
    const without = await check(apiKey, probeText);
    const probeId = without.data?.recipeId ?? "";
    expect(probeId).toBeTruthy();
    const fullItem = without.data?.results.find((r) => r.id === seedId);
    expect(fullItem).toBeTruthy();
    expect(fullItem?.known).toBeUndefined();
    expect(fullItem?.recipe).toBe(seedText);

    // Same probe again WITH known_recipes — idempotency must return the SAME
    // recipe id (logging unchanged by the param).
    const withParam = await check(apiKey, probeText, { known_recipes: seedId });
    expect(withParam.data?.recipeId).toBe(probeId);

    const stub = withParam.data?.results.find((r) => r.id === seedId);
    expect(stub).toBeTruthy();
    expect(stub?.known).toBe(true);
    // Id-only stub: no recipe text, no evidence body (operator ruling
    // 2026-07-17 — the gist was an ossification risk).
    expect(stub?.recipe).toBeUndefined();
    expect(stub?.evidence).toBeUndefined();
    // Similarity still present — one raw-cosine field (recipe ef245b63).
    expect(stub?.similarity).toBeDefined();

    // Result-set shape unchanged: same ids in both responses (stubs still
    // occupy their slots; clustering unaffected by the param).
    const idsWithout = (without.data?.results ?? []).map((r) => r.id).sort();
    const idsWith = (withParam.data?.results ?? []).map((r) => r.id).sort();
    expect(idsWith).toEqual(idsWithout);
  }, 30_000);

  it("trace logging is byte-identical: exactly one trace row exists for the probe text", async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    try {
      const rows: Array<{ n: number }> = await sql`
        SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE claim_text = ${probeText}
      `;
      expect(rows[0]?.n).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("markdown view renders the known result as a [known to you] stub line", async () => {
    const params = new URLSearchParams({
      key: apiKey,
      trace: probeText,
      ef: `Interpretation.\n> "quote"\n-- known-recipes test`,
      known_recipes: seedId,
    });
    const res = await fetch(`${BASE}/check?${params.toString()}`);
    const html = await res.text();
    expect(html).toContain("[known to you]");
  }, 30_000);
});
