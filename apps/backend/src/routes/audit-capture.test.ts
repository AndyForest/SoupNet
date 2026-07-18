import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the UVP Layer 1 server stamps (WT-4 phase 5):
 * recipe.checked audit metadata carries the returned exemplar ids AND their
 * similarities, plus the connection surface; get_briefing issuance writes a
 * briefing.issued audit row so the briefing→first-check funnel is
 * computable. Nothing user-visible.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";

async function registerAndKey(): Promise<string> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `audit-${uid}@test.local`;
  const password = "audit-test-password-123";
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

async function auditSql() {
  const postgres = (await import("postgres")).default;
  return postgres({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 5633),
    user: process.env["PGUSER"] ?? "claimnet",
    password: process.env["PGPASSWORD"] ?? "claimnet",
    database: process.env["PGDATABASE"] ?? "claimnet",
  });
}

interface CheckedMetadata {
  resultTraceIds?: string[];
  resultSimilarities?: Array<number | null>;
  surface?: string;
  agentId?: string;
  oauthClientId?: string;
}

async function checkAndGetMetadata(
  apiKey: string,
  trace: string,
  headers: Record<string, string> = {},
): Promise<CheckedMetadata> {
  const params = new URLSearchParams({
    key: apiKey,
    trace,
    ef: `Interpretation.\n> "quote"\n-- audit-capture test`,
    format: "json",
  });
  const res = await fetch(`${BASE}/check?${params.toString()}`, {
    headers: { Accept: "application/json", ...headers },
  });
  const json = (await res.json()) as { data?: { checked?: { recipeId?: string } } };
  const recipeId = json.data?.checked?.recipeId;
  if (!recipeId) throw new Error("check failed");

  const sql = await auditSql();
  try {
    const rows: Array<{ metadata: CheckedMetadata }> = await sql`
      SELECT metadata FROM claimnet.audit_log
      WHERE action = 'recipe.checked' AND target_id = ${recipeId}::uuid
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    if (!rows[0]) throw new Error("no audit row");
    return rows[0].metadata;
  } finally {
    await sql.end();
  }
}

describe.skipIf(!BASE)("UVP Layer 1 server stamps", () => {
  let apiKey: string;

  beforeAll(async () => {
    apiKey = await registerAndKey();
    // Seed one recipe so later checks have at least one result to stamp.
    await checkAndGetMetadata(apiKey, `As a developer working on measurement, I chose server stamps so that self-reports become verifiable. (seed ${Date.now()})`);
  }, 60_000);

  it("recipe.checked metadata carries exemplar ids + index-parallel similarities and surface=web", async () => {
    const meta = await checkAndGetMetadata(
      apiKey,
      `As a developer working on measurement, I prefer index-parallel similarity arrays so that feedback joins need no retyping. (${Date.now()})`,
    );
    expect(Array.isArray(meta.resultTraceIds)).toBe(true);
    expect(Array.isArray(meta.resultSimilarities)).toBe(true);
    expect(meta.resultSimilarities!.length).toBe(meta.resultTraceIds!.length);
    expect(meta.resultTraceIds!.length).toBeGreaterThan(0);
    expect(meta.surface).toBe("web");
  }, 30_000);

  it("the stdio proxy's X-SoupNet-Surface header records surface=mcp-stdio", async () => {
    const meta = await checkAndGetMetadata(
      apiKey,
      `As a developer working on measurement, I chose header-based surface capture so that the stdio proxy stays a thin shell. (${Date.now()})`,
      { "X-SoupNet-Surface": "mcp-stdio" },
    );
    expect(meta.surface).toBe("mcp-stdio");
  }, 30_000);

  it("checks through the HTTP MCP tool record surface=mcp-http", async () => {
    const recipe = `As a developer working on measurement, I chose per-surface stamps so that the funnel is segmentable. (${Date.now()})`;
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "check_recipe",
          arguments: { recipe, supporting_evidence: `Interpretation.\n> "q"\n-- test` },
        },
        id: 1,
      }),
    });
    expect(callRes.status).toBe(200);
    const text = await callRes.text();
    const idMatch = text.match(/Recipe checked as #([0-9a-f-]{36})/);
    expect(idMatch).toBeTruthy();

    const sql = await auditSql();
    try {
      const rows: Array<{ metadata: CheckedMetadata }> = await sql`
        SELECT metadata FROM claimnet.audit_log
        WHERE action = 'recipe.checked' AND target_id = ${idMatch![1]!}::uuid
        ORDER BY occurred_at DESC LIMIT 1
      `;
      expect(rows[0]?.metadata.surface).toBe("mcp-http");
    } finally {
      await sql.end();
    }
  }, 30_000);

  it("get_briefing writes a briefing.issued audit row keyed to the api key (funnel numerator)", async () => {
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "get_briefing", arguments: {} },
        id: 2,
      }),
    });
    expect(callRes.status).toBe(200);
    // The MCP handler returns 200 with an error text payload when the briefing
    // fails — assert the briefing actually rendered so a transient compose
    // failure surfaces its error text here instead of as a missing audit row.
    const callBody = await callRes.text();
    expect(callBody).toContain("Soup.net Agent Briefing");

    const sql = await auditSql();
    try {
      // Scope to THIS test's key (hashed at rest) — parallel suites issue
      // briefings of their own, so a global most-recent window is racy.
      const { createHash } = await import("node:crypto");
      const hashed = createHash("sha256").update(apiKey).digest("hex");
      const rows: Array<{ api_key_id: string | null; metadata: { surface?: string | null } }> = await sql`
        SELECT al.api_key_id, al.metadata
        FROM claimnet.audit_log al
        JOIN claimnet.api_keys k ON k.id = al.api_key_id
        WHERE al.action = 'briefing.issued'
          AND k.key = ${hashed}
        ORDER BY al.occurred_at DESC
      `;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.api_key_id).toBeTruthy();
      expect(rows[0]?.metadata.surface).toBe("mcp-http");
    } finally {
      await sql.end();
    }
  }, 30_000);
});
