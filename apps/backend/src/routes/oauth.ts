/**
 * OAuth 2.1 endpoints: metadata, Dynamic Client Registration, the consent
 * grant and deny, the token endpoint, and UserInfo.
 *
 * The OpenAI plugin directory round (stream O, docs/planning/openai-plugin-
 * build/oauth.md) added: audience-bound tokens (RFC 8707 `resource`, one
 * canonical identifier in lib/oauth-resource.ts), RFC 9207 `iss` on every
 * authorization response, client ID metadata documents beside DCR
 * (services/oauth-cimd.service.ts), the `openid` and `email` scopes with a
 * UserInfo endpoint, and the domain challenge file.
 *
 * Mounted at /oauth/* and /.well-known/*. Metadata endpoints are public,
 * CORS-open (server-to-server fetch from claude.ai's cloud + browser-side
 * fetches from MCP-aware clients).
 *
 * See ADR-pending and docs/connectors/claude.md for the integration context.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { isRegisteredRedirectUri } from "@soupnet/contracts/oauth-redirect";
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
  verifyClientCredentials,
  maybeCleanupOAuthArtifacts,
  requestedOidcScopes,
  OIDC_SCOPES,
  ACCESS_TOKEN_TTL_SECONDS,
} from "../services/oauth.service";
import {
  resolveOAuthClient,
  isCimdClientId,
  verifyClientAssertion,
  ASSERTION_ALGORITHMS,
  ASSERTION_TYPE,
} from "../services/oauth-cimd.service";
import type { ResolvedOAuthClient } from "../services/oauth-cimd.service";
import { rateLimit, getClientIp } from "../middleware/rate-limit";
import type { AppEnv } from "../types";
import { authenticateKey, inBooks, oauthUserInfo } from "../authz";
import { canonicalResource, normalizeResource, resourceMetadataUrl } from "../lib/oauth-resource";

/** The issuer and the protected resource are one identifier (recipe 0cfb2ec7). */
function getBackendUrl(): string {
  return canonicalResource();
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
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // client_secret_* for DCR clients; none and private_key_jwt for clients
    // identified by a metadata document (CIMD).
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: [...ASSERTION_ALGORITHMS],
    client_id_metadata_document_supported: true,
    // RFC 9207: every authorization response (the grant's and the deny's
    // redirect) carries iss, equal to `issuer` byte for byte.
    authorization_response_iss_parameter_supported: true,
    scopes_supported: ["read", "write", ...OIDC_SCOPES],
  });
});

// Protected resource metadata (RFC 9728) — points clients at the AS. The
// resource is the canonical identifier ChatGPT sends back as `resource`.
oauthWellKnownRoutes.get("/oauth-protected-resource", (c) => {
  const resource = getBackendUrl();
  return c.json({
    resource,
    authorization_servers: [resource],
    bearer_methods_supported: ["header"],
  });
});

// OpenAI's domain verification (plugin portal): the token as plain text, set
// by the operator through OPENAI_APPS_CHALLENGE_TOKEN without a code change.
// Empty or unset means there is nothing to verify: 404.
oauthWellKnownRoutes.get("/openai-apps-challenge", (c) => {
  const token = (process.env["OPENAI_APPS_CHALLENGE_TOKEN"] ?? "").trim();
  if (!token) return c.text("Not found", 404);
  return c.text(token, 200, { "Cache-Control": "no-store" });
});

// ── /oauth/* — registration, authorize, token, userinfo ──────────────────────

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
// client-info is unauthenticated and, for a metadata-document client, can
// cause an outbound fetch; the CIMD service also caps real fetches per IP.
const clientInfoRateLimit = rateLimit({ max: 300, windowMs: 60 * 60 * 1000 });
const userinfoRateLimit = rateLimit({ max: 600, windowMs: 60 * 60 * 1000 });

/** An authorization response's redirect: the client's registered URI, as
 *  requested, with the given parameters, `state` echoed when sent, and RFC 9207 `iss`. */
function authorizationRedirect(redirectUri: string, params: Record<string, string>, state: string): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", getBackendUrl());
  return url.toString();
}

/** Either kind of client: a DCR registration or a metadata document. */
async function resolveClient(c: Context<AppEnv>, clientId: string): Promise<ResolvedOAuthClient | null> {
  if (!clientId) return null;
  return resolveOAuthClient(getDb(), clientId, { ip: getClientIp(c) });
}

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
//
// A metadata-document client's name comes from the document; its verified
// identity is the domain that published it (`verified_domain`, null for a
// DCR client, whose name is self-reported). An unfetchable or invalid
// document is the same 404 as an unregistered id.
oauthRoutes.get("/client-info", clientInfoRateLimit, async (c) => {
  const clientId = c.req.query("client_id");
  if (!clientId) {
    return c.json({ error: "invalid_request", error_description: "client_id is required" }, 400);
  }
  const client = await resolveClient(c, clientId);
  if (!client) {
    return c.json({ error: "invalid_client", error_description: "no such client" }, 404);
  }
  return c.json({
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    verified_domain: client.domain,
  });
});

// POST /oauth/authorize/grant
// JWT-authed. The frontend SPA at /oauth/authorize collects user consent
// (recipe-book scope) and POSTs here to mint the authorization code. Returns
// the full redirect URL with code + state + iss so the SPA can navigate to it.
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
    const resourceRaw = typeof body["resource"] === "string" ? body["resource"] : "";
    const scopeRaw = typeof body["scope"] === "string" ? body["scope"] : "";

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
    // RFC 8707: the code is bound to the canonical resource; an unknown one
    // mints nothing.
    const resource = normalizeResource(resourceRaw);
    if (!resource.ok) {
      return c.json({ error: "invalid_target", error_description: "resource is not this server" }, 400);
    }

    const client = await resolveClient(c, clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "no such client" }, 400);
    }
    // The code stays bound to the exact URI requested here, port included, and
    // /oauth/token requires that same string.
    if (!isRegisteredRedirectUri(redirectUri, client.redirectUris)) {
      return c.json({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" }, 400);
    }

    // Membership check — user must be a member of every requested recipe
    // book. Mirrors the scoped-key creation guard in /keys/scoped.
    const allGroupIds = [...new Set([...scopeRead, ...scopeWrite])];
    const memberRows = await getDb().execute(sql`
      SELECT group_id FROM claimnet.group_members
      WHERE user_id = ${user.id}::uuid
        AND ${inBooks(sql`group_id`, allGroupIds)}
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
      resource: resource.resource,
      oidcScopes: requestedOidcScopes(scopeRaw),
    });

    return c.json({ redirect_url: authorizationRedirect(redirectUri, { code }, state) });
  },
);

// POST /oauth/authorize/deny
// The consent page's Cancel (RFC 6749 §4.1.2.1 access_denied). Built here,
// not in the browser, so the error response carries RFC 9207 `iss` like the
// success one, and the redirect target is checked server-side against the
// client's registered URIs (F44's Cancel check, moved from the page).
// It carries the grant's request binding: a signed-in, verified session sent
// as a Bearer header (no cookie, so a cross-site form cannot submit it) and
// a registered redirect_uri.
oauthRoutes.post(
  "/authorize/deny",
  grantRateLimit,
  requireAuth,
  requireVerifiedEmail,
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_request", error_description: "body must be JSON" }, 400);
    }
    const clientId = typeof body["client_id"] === "string" ? body["client_id"] : "";
    const redirectUri = typeof body["redirect_uri"] === "string" ? body["redirect_uri"] : "";
    const state = typeof body["state"] === "string" ? body["state"] : "";

    const client = await resolveClient(c, clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "no such client" }, 400);
    }
    if (!isRegisteredRedirectUri(redirectUri, client.redirectUris)) {
      return c.json({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" }, 400);
    }
    return c.json({ redirect_url: authorizationRedirect(redirectUri, { error: "access_denied" }, state) });
  },
);

/** The client_id and secret of a DCR client, from the body or Basic auth. */
function registeredCredentials(
  body: Record<string, string>,
  authHeader: string | undefined,
): { clientId: string; clientSecret: string } | "malformed" {
  let clientId = body["client_id"] ?? "";
  let clientSecret = body["client_secret"] ?? "";
  if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        clientId = decodeURIComponent(decoded.slice(0, idx));
        clientSecret = decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch {
      return "malformed";
    }
  }
  return { clientId, clientSecret };
}

// POST /oauth/token
// Supports grant_type=authorization_code and grant_type=refresh_token.
//
// Client authentication. A DCR client: client_secret_post in the body, or
// client_secret_basic in the Authorization header. A metadata-document
// client (CIMD): `none` (no credential; PKCE is the proof, and refresh tokens
// rotate) or private_key_jwt (a signed assertion checked against the
// document's keys). Neither kind may present the other's credential.
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

  const authFailed = () => c.json({ error: "invalid_client", error_description: "client authentication failed" }, 401);
  const authHeader = c.req.header("authorization");
  const basic = !!authHeader && authHeader.toLowerCase().startsWith("basic ");
  const assertion = body["client_assertion"] ?? "";
  const assertionType = body["client_assertion_type"] ?? "";
  let clientId = body["client_id"] ?? "";
  if (!clientId && assertion) {
    // RFC 7521 §4.2: client_id may be omitted when the assertion names it.
    const claims = jwt.decode(assertion);
    if (claims && typeof claims === "object" && typeof claims.iss === "string") clientId = claims.iss;
  }

  if (isCimdClientId(clientId)) {
    if (body["client_secret"] || basic) return authFailed();
    const cimd = (await resolveClient(c, clientId))?.cimd ?? null;
    if (!cimd) return authFailed();
    if (cimd.authMethod === "none") {
      if (assertion || assertionType) return authFailed();
    } else {
      const issuer = getBackendUrl();
      const ok =
        assertionType === ASSERTION_TYPE &&
        !!assertion &&
        (await verifyClientAssertion(cimd, assertion, { tokenEndpoint: `${issuer}/oauth/token`, issuer }, { ip: getClientIp(c) }));
      if (!ok) return authFailed();
    }
  } else {
    if (assertion || assertionType) return authFailed();
    const creds = registeredCredentials(body, authHeader);
    if (creds === "malformed") {
      return c.json({ error: "invalid_client", error_description: "malformed Basic auth" }, 401);
    }
    if (!creds.clientId || !creds.clientSecret) {
      return c.json({ error: "invalid_client", error_description: "client_id and client_secret are required" }, 401);
    }
    if (!(await verifyClientCredentials(getDb(), creds.clientId, creds.clientSecret))) return authFailed();
    clientId = creds.clientId;
  }

  // RFC 8707 on both grants: an unknown resource is refused before any code
  // or refresh token is touched.
  const resource = normalizeResource(body["resource"]);
  if (!resource.ok) {
    return c.json({ error: "invalid_target", error_description: "resource is not this server" }, 400);
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
      const redeemed = await redeemAuthCode(getDb(), { code, codeVerifier, clientId, redirectUri, resource: resource.resource });
      const bundle = await mintOAuthTokenBundle(getDb(), {
        userId: redeemed.userId,
        clientId: redeemed.clientId,
        scopeReadGroupIds: redeemed.scopeReadGroupIds,
        scopeWriteGroupIds: redeemed.scopeWriteGroupIds,
        scopeDefaultWriteGroupId: redeemed.scopeDefaultWriteGroupId,
        resource: redeemed.resource,
        oidcScopes: redeemed.oidcScopes,
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
      const bundle = await refreshOAuthTokenBundle(getDb(), { refreshToken, clientId, resource: resource.resource });
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

// GET|POST /oauth/userinfo (OpenID Connect Core §5.3, recipe 6ba99331)
// For an OAuth access token granted `openid`: `sub` (the user id), plus
// `email` and `email_verified` when `email` was granted too. No ID tokens are
// issued and no OpenID discovery document is published; this endpoint is what
// a host's workspace domain restriction reads. Any other credential, or none,
// is the protected-resource challenge; a token without `openid` is 403.
async function userinfo(c: Context<AppEnv>): Promise<Response> {
  const challenge = (error?: string) =>
    `Bearer ${error ? `error="${error}", ` : ""}resource_metadata="${resourceMetadataUrl()}"`;
  const header = c.req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    c.header("WWW-Authenticate", challenge());
    return c.json({ error: "invalid_token", error_description: "an OAuth access token is required" }, 401);
  }
  const principal = await authenticateKey(getDb(), header.slice(7));
  const info = principal ? await oauthUserInfo(getDb(), principal) : null;
  if (!principal || !info) {
    c.header("WWW-Authenticate", challenge("invalid_token"));
    return c.json({ error: "invalid_token", error_description: "an OAuth access token is required" }, 401);
  }
  if (!info.oidcScopes.includes("openid")) {
    c.header("WWW-Authenticate", challenge("insufficient_scope"));
    return c.json({ error: "insufficient_scope", error_description: "the openid scope was not granted" }, 403);
  }
  const claims: Record<string, unknown> = { sub: principal.userId };
  if (info.oidcScopes.includes("email")) {
    claims["email"] = info.email;
    claims["email_verified"] = info.emailVerified;
  }
  return c.json(claims);
}

oauthRoutes.get("/userinfo", userinfoRateLimit, userinfo);
oauthRoutes.post("/userinfo", userinfoRateLimit, userinfo);

// Re-export the constant so tests can reference it without re-importing the
// service module.
export { ACCESS_TOKEN_TTL_SECONDS };
