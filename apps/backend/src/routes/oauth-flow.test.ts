import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";

/**
 * End-to-end OAuth 2.1 flow tests: DCR → /authorize/grant → /token → /token
 * (refresh). Plus the rejection paths that matter for security (wrong PKCE,
 * reused code, redirect_uri mismatch, client_secret mismatch, expired code).
 *
 * Requires running backend.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

interface DcrResponse {
  client_id: string;
  client_secret: string;
}

interface GrantResponse {
  redirect_url?: string;
  error?: string;
  error_description?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface RegisterResponse {
  data?: { verificationToken?: string };
}

let userToken = "";
let userEmail = "";
let recipeBookId = "";
let client: DcrResponse;
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

/** Direct DB connection for fixture setup/inspection — same pattern as
 *  check.test.ts. Callers must sql.end() in a finally block. */
function dbConn() {
  return postgres({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 5633),
    user: process.env["PGUSER"] ?? "claimnet",
    password: process.env["PGPASSWORD"] ?? "claimnet",
    database: process.env["PGDATABASE"] ?? "claimnet",
  });
}

/** Mirrors hashOpaque/hashKey — tokens are stored as SHA-256 hex. */
function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function postForm(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

async function grant(opts: {
  codeChallenge: string;
  clientId?: string;
  redirectUri?: string;
}): Promise<GrantResponse> {
  const res = await postJson(
    "/oauth/authorize/grant",
    {
      response_type: "code",
      client_id: opts.clientId ?? client.client_id,
      redirect_uri: opts.redirectUri ?? REDIRECT_URI,
      state: "test-state",
      code_challenge: opts.codeChallenge,
      code_challenge_method: "S256",
      scope_read_group_ids: [recipeBookId],
      scope_write_group_ids: [recipeBookId],
      scope_default_write_group_id: recipeBookId,
    },
    userToken,
  );
  return (await res.json()) as GrantResponse;
}

function extractCode(redirectUrl: string): string {
  return new URL(redirectUrl).searchParams.get("code") ?? "";
}

/** Full grant → code → token exchange. Returns a live token bundle. */
async function mintBundle(): Promise<{ access: string; refresh: string }> {
  const pkce = generatePkcePair();
  const grantBody = await grant({ codeChallenge: pkce.challenge });
  if (!grantBody.redirect_url) throw new Error(`mintBundle: grant failed: ${JSON.stringify(grantBody)}`);
  const code = extractCode(grantBody.redirect_url);
  const res = await postForm("/oauth/token", {
    grant_type: "authorization_code",
    code,
    code_verifier: pkce.verifier,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: REDIRECT_URI,
  });
  if (res.status !== 200) throw new Error(`mintBundle: token exchange failed: ${res.status}`);
  const body = (await res.json()) as TokenResponse;
  if (!body.access_token || !body.refresh_token) throw new Error("mintBundle: incomplete bundle");
  return { access: body.access_token, refresh: body.refresh_token };
}

function refreshWith(refreshToken: string): Promise<Response> {
  return postForm("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.client_id,
    client_secret: client.client_secret,
  });
}

describe.skipIf(!BASE)("OAuth 2.1 end-to-end flow", () => {
  beforeAll(async () => {
    // Register + verify + login.
    const email = `oauth-${uid}@test.local`;
    userEmail = email;
    const password = "oauth-test-password-123";
    const regRes = await postJson("/auth/register", { email, password, tosAccepted: true });
    const regBody = (await regRes.json()) as RegisterResponse;
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Setup: missing verificationToken");
    await postJson("/auth/verify", { token: vtok });
    const loginRes = await postJson("/auth/login", { email, password });
    const loginBody = (await loginRes.json()) as { data?: { token?: string } };
    userToken = loginBody.data?.token ?? "";
    if (!userToken) throw new Error("Setup: login failed");

    // Find the user's auto-created personal recipe book.
    const booksRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const booksBody = (await booksRes.json()) as { data: Array<{ id: string }> };
    recipeBookId = booksBody.data[0]?.id ?? "";
    if (!recipeBookId) throw new Error("Setup: no recipe book");

    // Register an OAuth client via DCR.
    const dcrRes = await postJson("/oauth/register", {
      redirect_uris: [REDIRECT_URI],
      client_name: `oauth-test-${uid}`,
    });
    client = (await dcrRes.json()) as DcrResponse;
    if (!client.client_id || !client.client_secret) throw new Error("Setup: DCR failed");
  });

  it("happy path: authorize → token → refresh", async () => {
    const pkce = generatePkcePair();

    // 1. Mint code.
    const grantBody = await grant({ codeChallenge: pkce.challenge });
    expect(grantBody.redirect_url).toBeTruthy();
    const code = extractCode(grantBody.redirect_url!);
    expect(code).toBeTruthy();
    expect(new URL(grantBody.redirect_url!).searchParams.get("state")).toBe("test-state");

    // 2. Exchange code for tokens.
    const tokenRes = await postForm("/oauth/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: REDIRECT_URI,
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as TokenResponse;
    expect(tokenBody.access_token).toMatch(/^cn_s_/);
    expect(tokenBody.refresh_token).toBeTruthy();
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.expires_in).toBe(3600);
    expect(tokenBody.scope).toContain("read");
    expect(tokenBody.scope).toContain("write");

    // 3. Use the access token against /briefing — should work.
    const briefingRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(briefingRes.status).toBe(200);

    // 4. Refresh.
    const refreshRes = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: tokenBody.refresh_token!,
      client_id: client.client_id,
      client_secret: client.client_secret,
    });
    expect(refreshRes.status).toBe(200);
    const refreshBody = (await refreshRes.json()) as TokenResponse;
    expect(refreshBody.access_token).toMatch(/^cn_s_/);
    expect(refreshBody.access_token).not.toBe(tokenBody.access_token);
    expect(refreshBody.refresh_token).not.toBe(tokenBody.refresh_token);

    // 5. Old access token should now be revoked.
    const oldAccessRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(oldAccessRes.status).toBeGreaterThanOrEqual(400);

    // 6. New access token works.
    const newAccessRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${refreshBody.access_token}` },
    });
    expect(newAccessRes.status).toBe(200);

    // 7. Old refresh token is also revoked (rotation).
    const oldRefreshRes = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: tokenBody.refresh_token!,
      client_id: client.client_id,
      client_secret: client.client_secret,
    });
    expect(oldRefreshRes.status).toBe(400);
    const oldRefreshBody = (await oldRefreshRes.json()) as TokenResponse;
    expect(oldRefreshBody.error).toBe("invalid_grant");
  });

  // F38 (security-audit-2026-06-11): refresh rotation consumes the old row
  // via a single atomic UPDATE...RETURNING, so N concurrent refreshes with
  // the same refresh token must yield exactly ONE new token family — not N.
  it("F38: concurrent refreshes with the same token issue exactly one family", async () => {
    const pkce = generatePkcePair();
    const grantBody = await grant({ codeChallenge: pkce.challenge });
    const code = extractCode(grantBody.redirect_url!);

    const tokenRes = await postForm("/oauth/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: REDIRECT_URI,
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as TokenResponse;
    expect(tokenBody.refresh_token).toBeTruthy();

    const refresh = () =>
      postForm("/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token!,
        client_id: client.client_id,
        client_secret: client.client_secret,
      });

    const results = await Promise.all([refresh(), refresh(), refresh(), refresh(), refresh()]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(4);

    // The single winner's tokens are live.
    const winner = results[statuses.indexOf(200)]!;
    const winnerBody = (await winner.json()) as TokenResponse;
    const liveRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${winnerBody.access_token}` },
    });
    expect(liveRes.status).toBe(200);
  });

  // Regression for the 1h refresh bug (backlog 2026-06-29, fixed 2026-07-06):
  // expires_at is the ACCESS token's expiry, and the old refresh gate required
  // expires_at > NOW() — so refreshing after the access token's natural 1-hour
  // life returned invalid_grant even though refresh_token_expires_at (30d) was
  // still valid. This silently killed claude.ai connectors an hour after
  // connect. The gate now reads consumed_at + refresh_token_expires_at only.
  it("refresh succeeds after the access token's natural expiry (1h refresh bug)", async () => {
    const bundle = await mintBundle();

    // Age the access token past its 1h TTL via SQL — simulates a client
    // coming back after the access token died naturally.
    const sql = dbConn();
    try {
      const updated = await sql`
        UPDATE claimnet.api_keys
        SET expires_at = NOW() - INTERVAL '2 hours'
        WHERE key = ${sha256hex(bundle.access)}
        RETURNING id
      `;
      expect(updated).toHaveLength(1);
    } finally {
      await sql.end();
    }

    // The access token is dead...
    const expiredAccessRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${bundle.access}` },
    });
    expect(expiredAccessRes.status).toBeGreaterThanOrEqual(400);

    // ...but the refresh token must still rotate for its full 30-day window.
    const refreshRes = await refreshWith(bundle.refresh);
    expect(refreshRes.status).toBe(200);
    const refreshBody = (await refreshRes.json()) as TokenResponse;
    expect(refreshBody.access_token).toMatch(/^cn_s_/);
    expect(refreshBody.refresh_token).toBeTruthy();

    const newAccessRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${refreshBody.access_token}` },
    });
    expect(newAccessRes.status).toBe(200);
  });

  // Rotation policy (decided 2026-07-06, recipe efeaab7a): the old ACCESS
  // token dies the moment its bundle is rotated — consumption stamps
  // consumed_at (the CAS marker) AND truncates expires_at to the epoch
  // sentinel in one atomic UPDATE, so every liveness reader inherits the
  // revocation through the existing expires_at > NOW() check.
  it("rotation stamps consumed_at and revokes the old access token", async () => {
    const bundle = await mintBundle();

    const refreshRes = await refreshWith(bundle.refresh);
    expect(refreshRes.status).toBe(200);

    const sql = dbConn();
    try {
      const rows = await sql<Array<{ consumed_at: Date | null; expires_at: Date }>>`
        SELECT consumed_at, expires_at
        FROM claimnet.api_keys
        WHERE key = ${sha256hex(bundle.access)}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.consumed_at).not.toBeNull();
      expect(new Date(rows[0]!.expires_at).getTime()).toBe(0); // epoch sentinel
    } finally {
      await sql.end();
    }

    // Old access token rejected by validateKey.
    const oldAccessRes = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${bundle.access}` },
    });
    expect(oldAccessRes.status).toBeGreaterThanOrEqual(400);

    // Replaying the consumed refresh token is invalid_grant.
    const replayRes = await refreshWith(bundle.refresh);
    expect(replayRes.status).toBe(400);
    const replayBody = (await replayRes.json()) as TokenResponse;
    expect(replayBody.error).toBe("invalid_grant");
  });

  // Higher-iteration F38 variant (backlog note: the original 5-way test passed
  // locally even while racy). Ten sequential rounds of concurrent double
  // refresh — each round must mint exactly one new family, and the loser must
  // get invalid_grant, chaining on the winner's rotated token.
  it("F38 hardening: 10 rounds of concurrent double-refresh each mint exactly one family", async () => {
    const bundle = await mintBundle();
    let refreshToken = bundle.refresh;

    for (let round = 1; round <= 10; round++) {
      const results = await Promise.all([refreshWith(refreshToken), refreshWith(refreshToken)]);
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200), `round ${round}: statuses ${statuses.join(",")}`).toHaveLength(1);
      expect(statuses.filter((s) => s === 400), `round ${round}: statuses ${statuses.join(",")}`).toHaveLength(1);

      const loserBody = (await results[statuses.indexOf(400)]!.json()) as TokenResponse;
      expect(loserBody.error).toBe("invalid_grant");

      const winnerBody = (await results[statuses.indexOf(200)]!.json()) as TokenResponse;
      expect(winnerBody.refresh_token).toBeTruthy();
      refreshToken = winnerBody.refresh_token!;
    }

    // The final family is live end-to-end.
    const finalRes = await refreshWith(refreshToken);
    expect(finalRes.status).toBe(200);
  });

  // Plain (non-OAuth) keys: consumed_at must stay NULL and never affect the
  // validation path — and a consumed row must be rejected by validateKey
  // (defense-in-depth: the guard is independent of the expires_at stamp).
  it("plain API keys are unaffected by consumed_at; a consumed row is rejected", async () => {
    const keyRes = await postJson("/keys/daily", { label: `oauth-flow-plain-${uid}` }, userToken);
    expect(keyRes.status).toBe(200);
    const keyBody = (await keyRes.json()) as { ok: boolean; data?: { key?: string } };
    const plainKey = keyBody.data?.key ?? "";
    expect(plainKey).toBeTruthy();

    // Works normally, consumed_at is NULL.
    const okRes = await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${plainKey}` } });
    expect(okRes.status).toBe(200);

    const sql = dbConn();
    try {
      const rows = await sql<Array<{ consumed_at: Date | null }>>`
        SELECT consumed_at FROM claimnet.api_keys WHERE key = ${sha256hex(plainKey)}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.consumed_at).toBeNull();

      // Manually consuming the row must kill it even though expires_at is
      // still in the future — validateKey's consumed_at IS NULL guard.
      await sql`
        UPDATE claimnet.api_keys SET consumed_at = NOW() WHERE key = ${sha256hex(plainKey)}
      `;
    } finally {
      await sql.end();
    }

    const deadRes = await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${plainKey}` } });
    expect(deadRes.status).toBeGreaterThanOrEqual(400);
  });

  // Briefing OAuth branch (backlog: "Reconcile the briefing's API-key-in-URL
  // assumptions for OAuth-connected agents"): an OAuth access token expires
  // within the hour and is refreshed automatically by the client, so the
  // briefing must render NO raw credential and NO key-embedded URL — a
  // claude.ai agent warned its user about a "leaked key" when the raw token
  // rendered in the "## Your API key" section (2026-07-06).
  it("briefing composed for an OAuth access token contains no raw credential and no key-embedded URL", async () => {
    const bundle = await mintBundle();

    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${bundle.access}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { text?: string } };
    const text = body.data?.text ?? "";
    expect(text).toBeTruthy();

    expect(text).not.toContain(bundle.access);
    expect(text).not.toContain("?key=");
    expect(text).not.toContain("&key=");
    expect(text).toContain("## Your connection");
    expect(text).not.toContain("## Your API key");
    expect(text).toContain("You're already connected");
  });

  // Placeholder invariant (2026-07-06): every consumer of GET /briefing
  // supplied the key to fetch it, so echoing the raw key back is redundant —
  // and raw keys must never appear in responses not gated by human-only JWT
  // auth. The needle is the key we authenticated with, plus a shape-match
  // for anything raw-key-like. These are the Bearer-path CI guards (the
  // JWT-path guard lives in keys.test.ts).
  it("GET /briefing for a plain daily key renders the placeholder, never the raw key", async () => {
    const keyRes = await postJson("/keys/daily", { label: `oauth-brief-plain-${uid}` }, userToken);
    expect(keyRes.status).toBe(200);
    const keyBody = (await keyRes.json()) as { ok: boolean; data?: { key?: string } };
    const plainKey = keyBody.data?.key ?? "";
    expect(plainKey).toBeTruthy();

    const res = await fetch(`${BASE}/briefing`, {
      headers: { Authorization: `Bearer ${plainKey}` },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(plainKey);
    const body = JSON.parse(raw) as { ok: boolean; data?: { text?: string } };
    const text = body.data?.text ?? "";
    expect(text).toContain("## Your API key");
    expect(text).toContain("YOUR_API_KEY");
    expect(text).toContain("?key=YOUR_API_KEY");
    expect(text).not.toMatch(/cn_[sd]_[A-Za-z0-9]+/);
    expect(text).not.toContain("## Your connection");
  });

  it("MCP get_briefing renders the placeholder, never the raw key", async () => {
    const keyRes = await postJson("/keys/daily", { label: `oauth-brief-mcp-${uid}` }, userToken);
    const keyBody = (await keyRes.json()) as { ok: boolean; data?: { key?: string } };
    const mcpKey = keyBody.data?.key ?? "";
    expect(mcpKey).toBeTruthy();

    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${mcpKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "get_briefing", arguments: {} },
        id: 1,
      }),
    });
    expect(callRes.status).toBe(200);
    const raw = await callRes.text();
    expect(raw).toContain("Soup.net Agent Briefing");
    expect(raw).not.toContain(mcpKey);
    expect(raw).toContain("YOUR_API_KEY");
    expect(raw).not.toMatch(/cn_[sd]_[A-Za-z0-9]{10,}/);
  });

  // Migration 0028 backfill: rows consumed under the OLD marker scheme carry
  // expires_at = to_timestamp(0) with consumed_at NULL. Without protection,
  // the new refresh gate (which ignores expires_at > NOW()) would resurrect
  // their still-in-window refresh tokens. Two layers prevent that:
  //   1. the WHERE excludes epoch-stamped rows (mixed-version deploy guard),
  //   2. the 0028 backfill stamps consumed_at on them (semantic truth).
  // This test inserts a legacy-shaped row, proves the guard blocks it BEFORE
  // backfill, runs the backfill statement verbatim, and proves it stays dead.
  it("legacy epoch-stamped consumed rows cannot be resurrected; 0028 backfill marks them consumed", async () => {
    const legacyAccess = `legacy-access-${uid}`;
    const legacyRefresh = `legacy-refresh-${uid}`;

    // Warm the opportunistic-cleanup throttle so the fixture (whose epoch
    // expires_at makes it sweepable) isn't deleted mid-test by the first
    // /oauth/token call's fire-and-forget sweep.
    await refreshWith("warmup-nonexistent-token");
    await new Promise((r) => setTimeout(r, 300));

    const sql = dbConn();
    try {
      const users = await sql<Array<{ id: string }>>`
        SELECT id FROM claimnet.users WHERE email = ${userEmail}
      `;
      expect(users).toHaveLength(1);
      const userId = users[0]!.id;

      // Exactly the shape the pre-0028 code left behind after consuming a
      // refresh token: expires_at = epoch, consumed_at not yet in existence.
      await sql`
        INSERT INTO claimnet.api_keys
          (key, key_prefix, user_id, read_group_ids, write_group_ids, default_write_group_id,
           label, key_type, refresh_token_hash, refresh_token_expires_at, oauth_client_id,
           expires_at, created_at)
        VALUES
          (${sha256hex(legacyAccess)}, 'cn_s_leg', ${userId}::uuid,
           ARRAY[${recipeBookId}]::uuid[], ARRAY[${recipeBookId}]::uuid[], ${recipeBookId}::uuid,
           ${"oauth: legacy-consumed-fixture"}, 'oauth',
           ${sha256hex(legacyRefresh)}, NOW() + INTERVAL '10 days', ${client.client_id},
           to_timestamp(0), NOW() - INTERVAL '1 day')
      `;

      // Layer 1: even before any backfill, the epoch guard refuses to rotate.
      const preBackfillRes = await refreshWith(legacyRefresh);
      expect(preBackfillRes.status).toBe(400);
      expect(((await preBackfillRes.json()) as TokenResponse).error).toBe("invalid_grant");

      // Layer 2: the 0028 backfill statement, verbatim from the migration.
      await sql`
        UPDATE claimnet.api_keys
        SET consumed_at = to_timestamp(0)
        WHERE key_type = 'oauth' AND consumed_at IS NULL AND expires_at = to_timestamp(0)
      `;
      const rows = await sql<Array<{ consumed_at: Date | null }>>`
        SELECT consumed_at FROM claimnet.api_keys WHERE key = ${sha256hex(legacyAccess)}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.consumed_at).not.toBeNull();

      // Still dead after backfill.
      const postBackfillRes = await refreshWith(legacyRefresh);
      expect(postBackfillRes.status).toBe(400);
      expect(((await postBackfillRes.json()) as TokenResponse).error).toBe("invalid_grant");
    } finally {
      await sql`DELETE FROM claimnet.api_keys WHERE key = ${sha256hex(legacyAccess)}`.catch(() => undefined);
      await sql.end();
    }
  });

  it("rejects wrong code_verifier (PKCE)", async () => {
    const pkce = generatePkcePair();
    const wrongVerifier = generatePkcePair().verifier;

    const grantBody = await grant({ codeChallenge: pkce.challenge });
    const code = extractCode(grantBody.redirect_url!);

    const tokenRes = await postForm("/oauth/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: wrongVerifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: REDIRECT_URI,
    });
    expect(tokenRes.status).toBe(400);
    const body = (await tokenRes.json()) as TokenResponse;
    expect(body.error).toBe("invalid_grant");
  });

  it("rejects reused authorization code", async () => {
    const pkce = generatePkcePair();
    const grantBody = await grant({ codeChallenge: pkce.challenge });
    const code = extractCode(grantBody.redirect_url!);

    const formBody = {
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: REDIRECT_URI,
    };

    const first = await postForm("/oauth/token", formBody);
    expect(first.status).toBe(200);

    const second = await postForm("/oauth/token", formBody);
    expect(second.status).toBe(400);
    const body = (await second.json()) as TokenResponse;
    expect(body.error).toBe("invalid_grant");
  });

  it("rejects redirect_uri mismatch at /token", async () => {
    const pkce = generatePkcePair();
    const grantBody = await grant({ codeChallenge: pkce.challenge });
    const code = extractCode(grantBody.redirect_url!);

    const tokenRes = await postForm("/oauth/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: "https://claude.ai/different/path",
    });
    expect(tokenRes.status).toBe(400);
    const body = (await tokenRes.json()) as TokenResponse;
    expect(body.error).toBe("invalid_grant");
  });

  it("rejects wrong client_secret", async () => {
    const pkce = generatePkcePair();
    const grantBody = await grant({ codeChallenge: pkce.challenge });
    const code = extractCode(grantBody.redirect_url!);

    const tokenRes = await postForm("/oauth/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      client_id: client.client_id,
      client_secret: "wrong-secret",
      redirect_uri: REDIRECT_URI,
    });
    expect(tokenRes.status).toBe(401);
    const body = (await tokenRes.json()) as TokenResponse;
    expect(body.error).toBe("invalid_client");
  });

  it("rejects redirect_uri not registered for client at /authorize/grant", async () => {
    const pkce = generatePkcePair();
    const grantBody = await grant({
      codeChallenge: pkce.challenge,
      redirectUri: "https://attacker.example/callback",
    });
    expect(grantBody.error).toBeTruthy();
    expect(grantBody.redirect_url).toBeFalsy();
  });

  it("rejects unsupported response_type", async () => {
    const pkce = generatePkcePair();
    const res = await postJson(
      "/oauth/authorize/grant",
      {
        response_type: "token", // implicit flow — not supported
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        state: "s",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        scope_read_group_ids: [recipeBookId],
        scope_write_group_ids: [recipeBookId],
        scope_default_write_group_id: recipeBookId,
      },
      userToken,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as GrantResponse;
    expect(body.error).toBe("unsupported_response_type");
  });

  it("rejects unsupported code_challenge_method (e.g. plain)", async () => {
    const res = await postJson(
      "/oauth/authorize/grant",
      {
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        state: "s",
        code_challenge: "some-string",
        code_challenge_method: "plain",
        scope_read_group_ids: [recipeBookId],
        scope_write_group_ids: [recipeBookId],
        scope_default_write_group_id: recipeBookId,
      },
      userToken,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as GrantResponse;
    expect(body.error).toBe("invalid_request");
  });

  it("rejects /authorize/grant without auth", async () => {
    const pkce = generatePkcePair();
    const res = await fetch(`${BASE}/oauth/authorize/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        state: "s",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        scope_read_group_ids: [recipeBookId],
        scope_write_group_ids: [recipeBookId],
        scope_default_write_group_id: recipeBookId,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects scope_default_write not in scope_write", async () => {
    const pkce = generatePkcePair();
    const res = await postJson(
      "/oauth/authorize/grant",
      {
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        state: "s",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        scope_read_group_ids: [recipeBookId],
        scope_write_group_ids: [recipeBookId],
        scope_default_write_group_id: "00000000-0000-0000-0000-000000000000",
      },
      userToken,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as GrantResponse;
    expect(body.error).toBe("invalid_scope");
  });

  it("rejects unsupported grant_type at /token", async () => {
    const res = await postForm("/oauth/token", {
      grant_type: "password",
      client_id: client.client_id,
      client_secret: client.client_secret,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as TokenResponse;
    expect(body.error).toBe("unsupported_grant_type");
  });

  it("supports client_secret_basic auth at /token", async () => {
    const pkce = generatePkcePair();
    const grantBody = await grant({ codeChallenge: pkce.challenge });
    const code = extractCode(grantBody.redirect_url!);

    const basicAuth = Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64");
    const res = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: pkce.verifier,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenResponse;
    expect(body.access_token).toMatch(/^cn_s_/);
  });

  it("GET /oauth/client-info returns public client info", async () => {
    const res = await fetch(`${BASE}/oauth/client-info?client_id=${client.client_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { client_id: string; client_name: string | null; redirect_uris: string[] };
    expect(body.client_id).toBe(client.client_id);
    expect(body.client_name).toBe(`oauth-test-${uid}`);
    expect(body.redirect_uris).toEqual([REDIRECT_URI]);
  });

  it("GET /oauth/client-info returns 404 for unknown client", async () => {
    const res = await fetch(`${BASE}/oauth/client-info?client_id=oauth_does_not_exist`);
    expect(res.status).toBe(404);
  });
});
