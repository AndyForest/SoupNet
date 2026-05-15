import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

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
let recipeBookId = "";
let client: DcrResponse;
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

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

describe.skipIf(!BASE)("OAuth 2.1 end-to-end flow", () => {
  beforeAll(async () => {
    // Register + verify + login.
    const email = `oauth-${uid}@test.local`;
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
