/**
 * Sign in with Google: the three steps of the browser round trip
 * (organization accounts round 1, stream SSO; rubric
 * docs/planning/org-accounts-build/sso.md, SSO-G1 to SSO-G7).
 *
 *   POST /auth/google/start     { binding, return } → { url } (Google's)
 *   GET  /auth/google/callback  Google's redirect; always redirects to the
 *                               SPA's /auth/google/complete with a handoff
 *                               code or a closed-list error in the fragment
 *   POST /auth/google/exchange  { handoff, secret } → the session, as
 *                               /auth/login returns it, plus where to go
 *
 * Mounted at /auth/google. All three answer 404 when Google sign-in isn't
 * configured (no GOOGLE_OAUTH_CLIENT_ID), so a self-hosted stack without it
 * is unchanged. The service (services/google-sign-in.service.ts) holds the
 * rules; this file only parses, rate-limits and answers.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { sql } from "drizzle-orm";
import { googleSignInErrorMessage } from "@soupnet/domain";
import { getDb } from "../db";
import { signToken } from "../auth";
import { rateLimit, getClientIp } from "../middleware/rate-limit";
import { googleOidcConfig, createJwksKeySource } from "../services/google-oidc.service";
import type { KeySource } from "../services/google-oidc.service";
import {
  validateReturnTarget,
  beginGoogleSignIn,
  completeGoogleSignIn,
  exchangeHandoff,
  returnPathOf,
} from "../services/google-sign-in.service";
import { recordSignIn } from "../services/audit-log.service";
import type { AppEnv } from "../types";

export const googleAuthRoutes = new Hono<AppEnv>();

// Limits (audit F111): a company signs in from behind one office address,
// so the per-IP limits sit far above an office's morning rate and serve only
// as a flood backstop. The callback is also limited per pending request (by
// its state): a state is good once, so a few tries is plenty, and a flood of
// distinct states still meets the per-IP backstop. The exchange needs no
// per-code limit: a wrong secret consumes nothing and the secret is 256
// random bits. Every start writes a row, so it keeps its per-IP limit.
const WINDOW_MS = 15 * 60 * 1000;
const startRateLimit = rateLimit({ max: 300, windowMs: WINDOW_MS });
const callbackIpRateLimit = rateLimit({ max: 600, windowMs: WINDOW_MS });
const callbackStateRateLimit = rateLimit({ max: 3, windowMs: WINDOW_MS, keyFn: (c) => `state:${c.req.query("state") ?? ""}` });
const exchangeIpRateLimit = rateLimit({ max: 600, windowMs: WINDOW_MS });

/** base64url of 32 bytes, or of a SHA-256: 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function frontendUrl(): string {
  return (process.env["FRONTEND_URL"] ?? "http://localhost:5273").replace(/\/+$/, "");
}

let keys: { uri: string; source: KeySource } | null = null;
function keySourceFor(uri: string): KeySource {
  if (!keys || keys.uri !== uri) keys = { uri, source: createJwksKeySource(uri) };
  return keys.source;
}

function notConfigured(c: Context) {
  return c.json({ ok: false, error: "not_found" }, 404);
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

googleAuthRoutes.post("/start", startRateLimit, async (c) => {
  const config = googleOidcConfig();
  if (!config) return notConfigured(c);
  const body = await jsonBody(c);
  const binding = body?.["binding"];
  if (typeof binding !== "string" || !TOKEN_SHAPE.test(binding)) {
    return c.json({ ok: false, error: "invalid_request", message: "binding must be the base64url SHA-256 of the tab's secret." }, 400);
  }
  const db = getDb();
  const target = await validateReturnTarget(db, body?.["return"], getClientIp(c));
  if (!target) return c.json({ ok: false, error: "invalid_return", message: "That return destination can't be used." }, 400);
  const url = await beginGoogleSignIn(db, config, { binding, target });
  return c.json({ ok: true, data: { url } });
});

googleAuthRoutes.get("/callback", callbackIpRateLimit, callbackStateRateLimit, async (c) => {
  const config = googleOidcConfig();
  if (!config) return notConfigured(c);
  const outcome = await completeGoogleSignIn(getDb(), config, keySourceFor(config.jwksUri), {
    state: c.req.query("state"),
    code: c.req.query("code"),
    googleError: c.req.query("error"),
  });
  const fragment = outcome.ok ? `handoff=${outcome.handoff}` : `error=${outcome.error}`;
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(`${frontendUrl()}/auth/google/complete#${fragment}`, 302);
});

googleAuthRoutes.post("/exchange", exchangeIpRateLimit, async (c) => {
  const config = googleOidcConfig();
  if (!config) return notConfigured(c);
  const body = await jsonBody(c);
  const handoff = body?.["handoff"];
  const secret = body?.["secret"];
  const invalid = () =>
    c.json({ ok: false, error: "invalid_handoff", message: googleSignInErrorMessage("expired") }, 400);
  if (typeof handoff !== "string" || !TOKEN_SHAPE.test(handoff) || typeof secret !== "string" || !TOKEN_SHAPE.test(secret)) {
    return invalid();
  }
  const db = getDb();
  const result = await exchangeHandoff(db, { handoff, secret });
  if (!result.ok) {
    if (result.error === "invalid_handoff") return invalid();
    return c.json({ ok: false, error: result.error, message: googleSignInErrorMessage(result.error) }, 403);
  }

  const rows = await db.execute(sql`
    UPDATE claimnet.users SET last_login_at = now() WHERE id = ${result.userId}::uuid
    RETURNING id, email, role, email_verified_at IS NOT NULL AS "emailVerified"
  `);
  const user = (rows as unknown as Array<{ id: string; email: string; role: string; emailVerified: boolean }>)[0];
  if (!user) return invalid();
  const token = signToken({ sub: user.id, email: user.email, role: user.role, idp: result.idp });
  await recordSignIn(db, user.id, "google");
  return c.json({
    ok: true,
    data: {
      user: { id: user.id, email: user.email, role: user.role },
      token,
      emailVerified: user.emailVerified,
      returnTo: returnPathOf(result.target),
    },
  });
});
