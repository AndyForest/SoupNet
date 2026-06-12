/**
 * OAuth 2.1 endpoints — metadata, Dynamic Client Registration. The /authorize
 * and /token flows arrive in a follow-up commit.
 *
 * Mounted at /oauth/* and /.well-known/*. Metadata endpoints are public,
 * CORS-open (server-to-server fetch from claude.ai's cloud + browser-side
 * fetches from MCP-aware clients).
 *
 * See ADR-pending and docs/connectors/claude.md for the integration context.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import {
  registerClient,
  RegisterClientError,
  mintAuthCode,
  redeemAuthCode,
  RedeemCodeError,
  mintOAuthTokenBundle,
  refreshOAuthTokenBundle,
  RefreshTokenError,
  getClientPublic,
  verifyClientCredentials,
  maybeCleanupOAuthArtifacts,
  ACCESS_TOKEN_TTL_SECONDS,
} from "../services/oauth.service";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

function getBackendUrl(): string {
  return process.env["BACKEND_URL"] ?? "http://localhost:3101";
}

function getFrontendUrl(): string {
  return process.env["FRONTEND_URL"] ?? "http://localhost:5273";
}

// ── Authorization server metadata (RFC 8414) ─────────────────────────────────
//
// Mounted at /.well-known/oauth-authorization-server. This is a separate
// router from /oauth/* because the well-known prefix lives at the root path.

export const oauthWellKnownRoutes = new Hono<AppEnv>();

oauthWellKnownRoutes.use("/*", cors({ origin: "*", credentials: false }));

oauthWellKnownRoutes.get("/oauth-authorization-server", (c) => {
  const issuer = getBackendUrl();
  // authorization_endpoint points at the frontend — the consent flow is a
  // user-visible SPA page that reuses the existing JWT login. Token, register,
  // and revoke remain on the backend.
  const authorizationEndpoint = `${getFrontendUrl()}/oauth/authorize`;
  return c.json({
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    scopes_supported: ["read", "write"],
  });
});

// Protected resource metadata (RFC 9728) — points clients at the AS.
oauthWellKnownRoutes.get("/oauth-protected-resource", (c) => {
  const resource = getBackendUrl();
  return c.json({
    resource,
    authorization_servers: [resource],
  });
});

// ── /oauth/* — registration, authorize, token, revoke ────────────────────────

export const oauthRoutes = new Hono<AppEnv>();

oauthRoutes.use("/*", cors({ origin: "*", credentials: false }));

// DCR rate limit: registrations should be rare per-IP. Tight bound discourages
// spammy registration of throwaway clients.
const registerRateLimit = rateLimit({ max: 30, windowMs: 60 * 60 * 1000 });

// F39 (security-audit-2026-06-11): /token and /authorize/grant were the only
// unauthenticated-or-cheap OAuth surfaces without a per-IP bound. Brute force
// is infeasible (~190-bit tokens) — these bound row-insertion and DB work per
// IP. A legit client refreshes about once an hour, so 120/h is generous.
const tokenRateLimit = rateLimit({ max: 120, windowMs: 60 * 60 * 1000 });
const grantRateLimit = rateLimit({ max: 60, windowMs: 60 * 60 * 1000 });

// POST /oauth/register — Dynamic Client Registration (RFC 7591).
// Accepts a minimal subset: redirect_uris (required), client_name (optional).
// Returns the standard registration response shape.
oauthRoutes.post("/register", registerRateLimit, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_client_metadata", error_description: "request body must be JSON" }, 400);
  }

  const redirectUris = body["redirect_uris"];
  const clientNameRaw = body["client_name"];
  const clientName = typeof clientNameRaw === "string" ? clientNameRaw : undefined;

  try {
    const result = await registerClient(getDb(), {
      redirectUris: redirectUris as string[],
      clientName,
    });

    return c.json(
      {
        client_id: result.clientId,
        client_secret: result.clientSecret,
        client_id_issued_at: result.clientIdIssuedAt,
        client_name: result.clientName,
        redirect_uris: result.redirectUris,
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  } catch (err) {
    if (err instanceof RegisterClientError) {
      return c.json({ error: err.oauthError, error_description: err.message }, 400);
    }
    throw err;
  }
});

// GET /oauth/client-info?client_id=oauth_xxx
// Public, no client_secret required. Lets the consent-screen SPA render the
// client name + redirect URIs to the user before they authorize. Does NOT
// expose secret material.
oauthRoutes.get("/client-info", async (c) => {
  const clientId = c.req.query("client_id");
  if (!clientId) {
    return c.json({ error: "invalid_request", error_description: "client_id is required" }, 400);
  }
  const client = await getClientPublic(getDb(), clientId);
  if (!client) {
    return c.json({ error: "invalid_client", error_description: "no such client" }, 404);
  }
  return c.json({
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
  });
});

// POST /oauth/authorize/grant
// JWT-authed. The frontend SPA at /oauth/authorize collects user consent
// (recipe-book scope) and POSTs here to mint the authorization code. Returns
// the full redirect URL with code + state so the SPA can navigate to it.
oauthRoutes.post(
  "/authorize/grant",
  grantRateLimit,
  requireAuth,
  requireVerifiedEmail,
  async (c) => {
    const user = c.get("user");
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_request", error_description: "body must be JSON" }, 400);
    }

    const clientId = typeof body["client_id"] === "string" ? body["client_id"] : "";
    const redirectUri = typeof body["redirect_uri"] === "string" ? body["redirect_uri"] : "";
    const state = typeof body["state"] === "string" ? body["state"] : "";
    const codeChallenge = typeof body["code_challenge"] === "string" ? body["code_challenge"] : "";
    const codeChallengeMethod = typeof body["code_challenge_method"] === "string" ? body["code_challenge_method"] : "";
    const responseType = typeof body["response_type"] === "string" ? body["response_type"] : "";
    const scopeRead = Array.isArray(body["scope_read_group_ids"]) ? (body["scope_read_group_ids"] as unknown[]).filter((v) => typeof v === "string") as string[] : [];
    const scopeWrite = Array.isArray(body["scope_write_group_ids"]) ? (body["scope_write_group_ids"] as unknown[]).filter((v) => typeof v === "string") as string[] : [];
    const scopeDefaultWrite = typeof body["scope_default_write_group_id"] === "string" ? body["scope_default_write_group_id"] : "";

    if (responseType !== "code") {
      return c.json({ error: "unsupported_response_type", error_description: "only response_type=code is supported" }, 400);
    }
    if (codeChallengeMethod !== "S256") {
      return c.json({ error: "invalid_request", error_description: "only code_challenge_method=S256 is supported" }, 400);
    }
    if (!codeChallenge) {
      return c.json({ error: "invalid_request", error_description: "code_challenge is required" }, 400);
    }
    if (scopeRead.length === 0 || scopeWrite.length === 0 || !scopeDefaultWrite) {
      return c.json({ error: "invalid_scope", error_description: "scope must include at least one read and one write recipe book and a default write" }, 400);
    }
    if (!scopeWrite.includes(scopeDefaultWrite)) {
      return c.json({ error: "invalid_scope", error_description: "scope_default_write_group_id must be in scope_write_group_ids" }, 400);
    }

    const client = await getClientPublic(getDb(), clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "no such client" }, 400);
    }
    if (!client.redirectUris.includes(redirectUri)) {
      return c.json({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" }, 400);
    }

    // Membership check — user must be a member of every requested recipe
    // book. Mirrors the scoped-key creation guard in /keys/scoped.
    const allGroupIds = [...new Set([...scopeRead, ...scopeWrite])];
    const memberRows = await getDb().execute(sql`
      SELECT group_id FROM claimnet.group_members
      WHERE user_id = ${user.id}::uuid
        AND group_id IN (${sql.join(allGroupIds.map((g) => sql`${g}::uuid`), sql`, `)})
    `);
    const memberSet = new Set((memberRows as unknown as Array<{ group_id: string }>).map((r) => r.group_id));
    if (allGroupIds.some((g) => !memberSet.has(g))) {
      return c.json({ error: "invalid_scope", error_description: "not a member of all requested recipe books" }, 403);
    }

    const { code } = await mintAuthCode(getDb(), {
      clientId,
      userId: user.id,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scopeReadGroupIds: scopeRead,
      scopeWriteGroupIds: scopeWrite,
      scopeDefaultWriteGroupId: scopeDefaultWrite,
    });

    // Build redirect URL with code + state. URLSearchParams handles encoding.
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);

    return c.json({ redirect_url: url.toString() });
  },
);

// POST /oauth/token
// Public, client-authed via client_secret_post (or client_secret_basic).
// Supports grant_type=authorization_code and grant_type=refresh_token.
oauthRoutes.post("/token", tokenRateLimit, async (c) => {
  // F39: opportunistic sweep of expired codes/keys/never-used clients —
  // throttled inside, fire-and-forget, never blocks token issuance.
  maybeCleanupOAuthArtifacts(getDb());

  // Accept form-encoded (the OAuth norm) or JSON.
  const contentType = c.req.header("content-type") ?? "";
  let body: Record<string, string>;
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await c.req.text();
      const params = new URLSearchParams(text);
      body = Object.fromEntries(params.entries());
    } else {
      const json = (await c.req.json()) as Record<string, unknown>;
      body = Object.fromEntries(
        Object.entries(json).filter(([, v]) => typeof v === "string") as Array<[string, string]>,
      );
    }
  } catch {
    return c.json({ error: "invalid_request", error_description: "body must be application/x-www-form-urlencoded or JSON" }, 400);
  }

  // Client auth: client_secret_post in body, or client_secret_basic in Authorization header.
  let clientId = body["client_id"] ?? "";
  let clientSecret = body["client_secret"] ?? "";
  const authHeader = c.req.header("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        clientId = decodeURIComponent(decoded.slice(0, idx));
        clientSecret = decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch {
      return c.json({ error: "invalid_client", error_description: "malformed Basic auth" }, 401);
    }
  }
  if (!clientId || !clientSecret) {
    return c.json({ error: "invalid_client", error_description: "client_id and client_secret are required" }, 401);
  }
  const valid = await verifyClientCredentials(getDb(), clientId, clientSecret);
  if (!valid) {
    return c.json({ error: "invalid_client", error_description: "client authentication failed" }, 401);
  }

  const grantType = body["grant_type"] ?? "";

  if (grantType === "authorization_code") {
    const code = body["code"] ?? "";
    const codeVerifier = body["code_verifier"] ?? "";
    const redirectUri = body["redirect_uri"] ?? "";
    if (!code || !codeVerifier || !redirectUri) {
      return c.json({ error: "invalid_request", error_description: "code, code_verifier, and redirect_uri are required" }, 400);
    }
    try {
      const redeemed = await redeemAuthCode(getDb(), { code, codeVerifier, clientId, redirectUri });
      const bundle = await mintOAuthTokenBundle(getDb(), {
        userId: redeemed.userId,
        clientId: redeemed.clientId,
        scopeReadGroupIds: redeemed.scopeReadGroupIds,
        scopeWriteGroupIds: redeemed.scopeWriteGroupIds,
        scopeDefaultWriteGroupId: redeemed.scopeDefaultWriteGroupId,
      });
      return c.json({
        access_token: bundle.accessToken,
        token_type: "Bearer",
        expires_in: bundle.expiresInSeconds,
        refresh_token: bundle.refreshToken,
        scope: bundle.scope,
      });
    } catch (err) {
      if (err instanceof RedeemCodeError) {
        return c.json({ error: err.oauthError, error_description: err.message }, 400);
      }
      throw err;
    }
  }

  if (grantType === "refresh_token") {
    const refreshToken = body["refresh_token"] ?? "";
    if (!refreshToken) {
      return c.json({ error: "invalid_request", error_description: "refresh_token is required" }, 400);
    }
    try {
      const bundle = await refreshOAuthTokenBundle(getDb(), { refreshToken, clientId });
      return c.json({
        access_token: bundle.accessToken,
        token_type: "Bearer",
        expires_in: bundle.expiresInSeconds,
        refresh_token: bundle.refreshToken,
        scope: bundle.scope,
      });
    } catch (err) {
      if (err instanceof RefreshTokenError) {
        return c.json({ error: err.oauthError, error_description: err.message }, 400);
      }
      throw err;
    }
  }

  return c.json({ error: "unsupported_grant_type", error_description: `grant_type=${grantType} is not supported` }, 400);
});

// Re-export the constant so tests can reference it without re-importing the
// service module.
export { ACCESS_TOKEN_TTL_SECONDS };
