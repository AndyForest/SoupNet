import { describe, it, expect, beforeAll } from "vitest";
import { seedVerifiedUser } from "../test-users";
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
    const loginRes = await seedVerifiedUser(email, password);
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
    // Holds a FOR KEY SHARE lock on the fixture row for the rest of the test.
    // The fixture is sweepable by design (epoch expires_at), and
    // oauth.service.test.ts calls cleanupOAuthArtifacts directly, unthrottled,
    // in a parallel worker: in gate runs that sweep deleted the row between
    // the insert and the backfill SELECT below (2026-09-28, "expected [] to
    // have a length of 1"). The sweep's DELETE waits on this lock; the
    // backend's refresh UPDATE and the backfill UPDATE don't, since neither
    // conflicts with FOR KEY SHARE.
    const lock = await sql.reserve();
    try {
      const users = await sql<Array<{ id: string }>>`
        SELECT id FROM claimnet.users WHERE email = ${userEmail}
      `;
      expect(users).toHaveLength(1);
      const userId = users[0]!.id;

      // Exactly the shape the pre-0028 code left behind after consuming a
      // refresh token: expires_at = epoch, consumed_at not yet in existence.
      // Inserted (committed, so the backend sees it) and then locked; a sweep
      // landing in between is retried.
      const insertFixture = () => sql`
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
        ON CONFLICT DO NOTHING
      `;
      await lock`BEGIN`;
      let held = 0;
      for (let attempt = 0; attempt < 3 && held === 0; attempt++) {
        await insertFixture();
        held = (await lock`
          SELECT 1 FROM claimnet.api_keys WHERE key = ${sha256hex(legacyAccess)} FOR KEY SHARE
        `).length;
      }
      expect(held).toBe(1);

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
      await lock`COMMIT`.catch(() => undefined);
      lock.release();
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

  describe("loopback redirect URIs (RFC 8252 §7.3)", () => {
    const LOOPBACK = "http://127.0.0.1/callback";
    const ON_PORT = "http://127.0.0.1:57687/callback";
    let native: DcrResponse;

    beforeAll(async () => {
      const res = await postJson("/oauth/register", { redirect_uris: [LOOPBACK], client_name: `oauth-native-${uid}` });
      native = (await res.json()) as DcrResponse;
    });

    const redeem = (code: string, verifier: string, redirectUri: string) =>
      postForm("/oauth/token", {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: native.client_id,
        client_secret: native.client_secret,
        redirect_uri: redirectUri,
      });

    it("grants on the port the client listens on, and redeems with that exact URI", async () => {
      const pkce = generatePkcePair();
      const grantBody = await grant({ codeChallenge: pkce.challenge, clientId: native.client_id, redirectUri: ON_PORT });
      expect(grantBody.redirect_url).toContain("http://127.0.0.1:57687/callback?code=");
      const res = await redeem(extractCode(grantBody.redirect_url!), pkce.verifier, ON_PORT);
      expect(res.status).toBe(200);
      expect(((await res.json()) as TokenResponse).access_token).toBeTruthy();
    });

    it.each([
      ["a different port", "http://127.0.0.1:57688/callback"],
      ["the registered URI without the port", LOOPBACK],
    ])("refuses to redeem a code with %s", async (_name, redirectUri) => {
      const pkce = generatePkcePair();
      const grantBody = await grant({ codeChallenge: pkce.challenge, clientId: native.client_id, redirectUri: ON_PORT });
      const res = await redeem(extractCode(grantBody.redirect_url!), pkce.verifier, redirectUri);
      expect(res.status).toBe(400);
      expect(((await res.json()) as TokenResponse).error).toBe("invalid_grant");
    });

    it.each([
      ["a different path", "http://127.0.0.1:57687/other"],
      ["a different loopback host", "http://localhost:57687/callback"],
      ["https", "https://127.0.0.1:57687/callback"],
    ])("refuses a grant and a deny on %s", async (_name, redirectUri) => {
      const pkce = generatePkcePair();
      const grantBody = await grant({ codeChallenge: pkce.challenge, clientId: native.client_id, redirectUri });
      expect(grantBody.error).toBe("invalid_request");
      expect(grantBody.redirect_url).toBeFalsy();
      const deny = await postJson("/oauth/authorize/deny", { client_id: native.client_id, redirect_uri: redirectUri }, userToken);
      expect(deny.status).toBe(400);
    });

    it("sends a Cancel to the port the client listens on", async () => {
      const deny = await postJson("/oauth/authorize/deny", { client_id: native.client_id, redirect_uri: ON_PORT, state: "s" }, userToken);
      expect(deny.status).toBe(200);
      expect(((await deny.json()) as GrantResponse).redirect_url).toContain("http://127.0.0.1:57687/callback?error=access_denied");
    });

    it("gives an https or non-loopback registration no port freedom", async () => {
      const pkce = generatePkcePair();
      const https = await grant({ codeChallenge: pkce.challenge, redirectUri: "https://claude.ai:8443/api/mcp/auth_callback" });
      expect(https.error).toBe("invalid_request");
      const loopback = await grant({ codeChallenge: pkce.challenge, redirectUri: ON_PORT });
      expect(loopback.error).toBe("invalid_request");
    });
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

  // ── OpenAI plugin directory round, stream O (docs/planning/openai-plugin-
  // build/oauth.md). The canonical resource is the backend's origin.
  describe("stream O: audience, iss, deny, UserInfo", () => {
    const CANONICAL = BASE.replace(/\/+$/, "");

    async function grantWith(opts: { codeChallenge: string; resource?: string; scope?: string; state?: string }): Promise<Response> {
      return postJson(
        "/oauth/authorize/grant",
        {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          state: opts.state ?? "s-state",
          code_challenge: opts.codeChallenge,
          code_challenge_method: "S256",
          scope_read_group_ids: [recipeBookId],
          scope_write_group_ids: [recipeBookId],
          scope_default_write_group_id: recipeBookId,
          ...(opts.resource !== undefined ? { resource: opts.resource } : {}),
          ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
        },
        userToken,
      );
    }

    function exchange(code: string, verifier: string, resource?: string): Promise<Response> {
      return postForm("/oauth/token", {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: REDIRECT_URI,
        ...(resource !== undefined ? { resource } : {}),
      });
    }

    function refresh(refreshToken: string, resource?: string): Promise<Response> {
      return postForm("/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: client.client_id,
        client_secret: client.client_secret,
        ...(resource !== undefined ? { resource } : {}),
      });
    }

    async function bundleWith(opts: { resource?: string; scope?: string } = {}): Promise<{ access: string; refresh: string; scope: string }> {
      const pkce = generatePkcePair();
      const g = (await (await grantWith({ codeChallenge: pkce.challenge, ...opts })).json()) as GrantResponse;
      const t = await exchange(extractCode(g.redirect_url!), pkce.verifier, opts.resource);
      const body = (await t.json()) as TokenResponse;
      if (!body.access_token || !body.refresh_token) throw new Error(`bundleWith: ${JSON.stringify(body)}`);
      return { access: body.access_token, refresh: body.refresh_token, scope: body.scope ?? "" };
    }

    function mcpInitialize(token: string): Promise<Response> {
      return fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stream-o", version: "0" } },
        }),
      });
    }

    async function audienceOf(access: string): Promise<string | null> {
      const sql = dbConn();
      try {
        const rows = await sql<Array<{ oauth_resource: string | null }>>`
          SELECT oauth_resource FROM claimnet.api_keys WHERE key = ${sha256hex(access)}`;
        return rows[0]?.oauth_resource ?? null;
      } finally {
        await sql.end();
      }
    }

    async function setColumn(access: string, value: string | null): Promise<void> {
      const sql = dbConn();
      try {
        await sql`UPDATE claimnet.api_keys SET oauth_resource = ${value} WHERE key = ${sha256hex(access)}`;
      } finally {
        await sql.end();
      }
    }

    // O3-1, O4-2: the sequence ChatGPT runs, idle included. The 2026-07
    // "invalid_grant after an hour idle" report was fixed in a383fee
    // (migration 0028, deployed 2026-07-06) before this round; this pins it
    // on the reviewer's path.
    it("O3-1: resource on authorize and token, idle past expiry, 401, refresh, the new token works with the same audience", async () => {
      const pkce = generatePkcePair();
      const g = await grantWith({ codeChallenge: pkce.challenge, resource: CANONICAL, scope: "openid email", state: "chatgpt-state" });
      expect(g.status).toBe(200);
      const redirect = new URL(((await g.json()) as GrantResponse).redirect_url!);
      expect(redirect.searchParams.get("iss")).toBe(CANONICAL);
      expect(redirect.searchParams.get("state")).toBe("chatgpt-state");

      const t = await exchange(redirect.searchParams.get("code")!, pkce.verifier, CANONICAL);
      expect(t.status).toBe(200);
      const tokens = (await t.json()) as TokenResponse;
      expect(tokens.scope).toBe("read write openid email");
      expect(await audienceOf(tokens.access_token!)).toBe(CANONICAL);

      const sql = dbConn();
      try {
        await sql`UPDATE claimnet.api_keys SET expires_at = NOW() - INTERVAL '2 hours' WHERE key = ${sha256hex(tokens.access_token!)}`;
      } finally {
        await sql.end();
      }
      const idle = await mcpInitialize(tokens.access_token!);
      expect(idle.status).toBe(401);
      expect(idle.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');

      const r = await refresh(tokens.refresh_token!, CANONICAL);
      expect(r.status).toBe(200);
      const next = (await r.json()) as TokenResponse;
      expect(next.scope).toBe("read write openid email");
      expect((await mcpInitialize(next.access_token!)).status).toBe(200);
      expect(await audienceOf(next.access_token!)).toBe(CANONICAL);
    });

    it("O1-2/O1-3: the MCP endpoint URL is an alias; an absent resource binds to the canonical one", async () => {
      expect(await audienceOf((await bundleWith({ resource: `${CANONICAL}/mcp` })).access)).toBe(CANONICAL);
      expect(await audienceOf((await bundleWith()).access)).toBe(CANONICAL);
    });

    it("O1-3: the grant refuses another resource with invalid_target", async () => {
      const res = await grantWith({ codeChallenge: generatePkcePair().challenge, resource: "https://elsewhere.example.com" });
      expect(res.status).toBe(400);
      expect(((await res.json()) as GrantResponse).error).toBe("invalid_target");
    });

    it("O1-4: the token endpoint refuses another resource before touching the code", async () => {
      const pkce = generatePkcePair();
      const g = (await (await grantWith({ codeChallenge: pkce.challenge })).json()) as GrantResponse;
      const code = extractCode(g.redirect_url!);
      const bad = await exchange(code, pkce.verifier, "https://elsewhere.example.com/mcp");
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as TokenResponse).error).toBe("invalid_target");
      expect((await exchange(code, pkce.verifier, CANONICAL)).status).toBe(200);
    });

    it("O1-4: a code granted for another resource does not redeem here (invalid_grant)", async () => {
      const pkce = generatePkcePair();
      const g = (await (await grantWith({ codeChallenge: pkce.challenge })).json()) as GrantResponse;
      const code = extractCode(g.redirect_url!);
      const sql = dbConn();
      try {
        await sql`UPDATE claimnet.oauth_authorization_codes SET resource = 'https://elsewhere.example.com' WHERE code_hash = ${sha256hex(code)}`;
      } finally {
        await sql.end();
      }
      const res = await exchange(code, pkce.verifier, CANONICAL);
      expect(res.status).toBe(400);
      expect(((await res.json()) as TokenResponse).error).toBe("invalid_grant");
    });

    it("O1-6: refresh refuses another resource without consuming the token, and binds a pre-0043 row to the canonical one", async () => {
      const b = await bundleWith();
      const bad = await refresh(b.refresh, "https://elsewhere.example.com");
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as TokenResponse).error).toBe("invalid_target");

      await setColumn(b.access, null);
      // No wave at deploy (recipe 8b5a7baa): a key without an audience still works.
      expect((await mcpInitialize(b.access)).status).toBe(200);
      const ok = await refresh(b.refresh);
      expect(ok.status).toBe(200);
      expect(await audienceOf(((await ok.json()) as TokenResponse).access_token!)).toBe(CANONICAL);
    });

    it("O1-5: a key bound to another resource is refused at /mcp exactly like a dead key", async () => {
      const b = await bundleWith();
      await setColumn(b.access, "https://elsewhere.example.com");
      const wrong = await mcpInitialize(b.access);
      const unknown = await mcpInitialize("cn_s_never-issued");
      expect(wrong.status).toBe(401);
      expect(wrong.headers.get("www-authenticate")).toBe(unknown.headers.get("www-authenticate"));
      expect(await wrong.text()).toBe(await unknown.text());
      expect((await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${b.access}` } })).status).toBeGreaterThanOrEqual(400);
    });

    it("O4-3: deny redirects with access_denied, state and iss; only to a registered URI; only for a signed-in session", async () => {
      const ok = await postJson("/oauth/authorize/deny", { client_id: client.client_id, redirect_uri: REDIRECT_URI, state: "deny-state" }, userToken);
      expect(ok.status).toBe(200);
      const url = new URL(((await ok.json()) as GrantResponse).redirect_url!);
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
      expect(url.searchParams.get("error")).toBe("access_denied");
      expect(url.searchParams.get("state")).toBe("deny-state");
      expect(url.searchParams.get("iss")).toBe(CANONICAL);

      const unregistered = await postJson("/oauth/authorize/deny", { client_id: client.client_id, redirect_uri: "https://attacker.example/cb" }, userToken);
      expect(unregistered.status).toBe(400);
      const anonymous = await postJson("/oauth/authorize/deny", { client_id: client.client_id, redirect_uri: REDIRECT_URI });
      expect(anonymous.status).toBe(401);
    });

    it("O7-2/O7-3: UserInfo answers by the granted OpenID scopes", async () => {
      const userinfo = (token?: string) =>
        fetch(`${BASE}/oauth/userinfo`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

      const both = await bundleWith({ scope: "openid email profile offline_access" });
      expect(both.scope).toBe("read write openid email");
      const full = await userinfo(both.access);
      expect(full.status).toBe(200);
      const claims = (await full.json()) as Record<string, unknown>;
      expect(claims["email"]).toBe(userEmail);
      expect(claims["email_verified"]).toBe(true);
      expect(typeof claims["sub"]).toBe("string");

      const openidOnly = await userinfo((await bundleWith({ scope: "openid" })).access);
      expect(await openidOnly.json()).toEqual({ sub: claims["sub"] });

      const none = await userinfo((await bundleWith()).access);
      expect(none.status).toBe(403);
      expect(none.headers.get("www-authenticate") ?? "").toContain('error="insufficient_scope"');

      const missing = await userinfo();
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate") ?? "").toContain("resource_metadata=");

      const daily = await fetch(`${BASE}/keys/daily`, { method: "POST", headers: { Authorization: `Bearer ${userToken}` } });
      const dailyKey = ((await daily.json()) as { data?: { key?: string } }).data?.key ?? "";
      expect((await userinfo(dailyKey)).status).toBe(401);
    });

    it("O5-4: a metadata-document client that cannot be fetched is an unknown client everywhere", async () => {
      const cimd = "https://cimd-unresolvable.invalid/oauth/client.json";
      expect((await fetch(`${BASE}/oauth/client-info?client_id=${encodeURIComponent(cimd)}`)).status).toBe(404);
      const token = await postForm("/oauth/token", { grant_type: "authorization_code", code: "x", code_verifier: "y", redirect_uri: REDIRECT_URI, client_id: cimd });
      expect(token.status).toBe(401);
      expect(((await token.json()) as TokenResponse).error).toBe("invalid_client");
      const withSecret = await postForm("/oauth/token", { grant_type: "authorization_code", code: "x", client_id: cimd, client_secret: "s" });
      expect(withSecret.status).toBe(401);
    });

    it("O5-8: a DCR client presenting an assertion instead of its secret is refused", async () => {
      const res = await postForm("/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: "x",
        client_id: client.client_id,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: "a.b.c",
      });
      expect(res.status).toBe(401);
    });
  });
});
