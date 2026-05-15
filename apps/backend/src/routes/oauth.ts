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
import { getDb } from "../db";
import {
  registerClient,
  RegisterClientError,
} from "../services/oauth.service";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

function getBackendUrl(): string {
  return process.env["BACKEND_URL"] ?? "http://localhost:3101";
}

// ── Authorization server metadata (RFC 8414) ─────────────────────────────────
//
// Mounted at /.well-known/oauth-authorization-server. This is a separate
// router from /oauth/* because the well-known prefix lives at the root path.

export const oauthWellKnownRoutes = new Hono<AppEnv>();

oauthWellKnownRoutes.use("/*", cors({ origin: "*", credentials: false }));

oauthWellKnownRoutes.get("/oauth-authorization-server", (c) => {
  const issuer = getBackendUrl();
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
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
