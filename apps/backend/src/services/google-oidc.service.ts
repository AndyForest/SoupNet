/**
 * The Google leg of Sign in with Google: configuration, the authorization
 * URL, the code exchange, and ID-token verification against Google's key set
 * (organization accounts round 1, stream SSO; rubric
 * docs/planning/org-accounts-build/sso.md, SSO-G1 to SSO-G3, SSO-G7).
 *
 * This module speaks OpenID Connect to Google and nothing else. Which
 * account a verified token belongs to is google-sign-in.service.ts's job, and
 * the browser round trip is routes/google-auth.ts's.
 *
 * We are a confidential client using the authorization code flow with PKCE
 * (S256) and a nonce, asking for `openid email profile` only, with no offline
 * access (round plan). Google's endpoints are constants; a test issuer is
 * honoured only outside production (SSO-G2), so the Layer 3 suite can run a
 * fake Google that signs tokens with its own key.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";

/** Google's two spellings of its issuer; tokens carry either. */
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

/** Google states a maximum of 255 case-sensitive ASCII characters for `sub`. */
const MAX_SUBJECT_LENGTH = 255;
const FETCH_TIMEOUT_MS = 5_000;
/** Tolerated clock skew between Google and us when checking `exp` and `iat`. */
const CLOCK_TOLERANCE_SECONDS = 60;

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  issuers: readonly string[];
  /** True when the endpoints are a test issuer's, never in production. */
  testIssuer: boolean;
}

/** A failure of the Google leg. The message is for logs, never for a redirect. */
export class GoogleOidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleOidcError";
  }
}

/**
 * Google sign-in's configuration, or null when it is off (no client id), in
 * which case the routes answer 404 and the SPA shows no button (SSO-G7).
 */
export function googleOidcConfig(env: Record<string, string | undefined> = process.env): GoogleOidcConfig | null {
  const clientId = env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
  if (!clientId) return null;
  const backendUrl = (env["BACKEND_URL"] ?? "http://localhost:3101").replace(/\/+$/, "");
  const base = {
    clientId,
    clientSecret: env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "",
    redirectUri: `${backendUrl}/auth/google/callback`,
  };
  const testIssuer = env["GOOGLE_OIDC_TEST_ISSUER"]?.trim().replace(/\/+$/, "");
  if (testIssuer && env["NODE_ENV"] !== "production") {
    return {
      ...base,
      authorizationEndpoint: `${testIssuer}/authorize`,
      tokenEndpoint: `${testIssuer}/token`,
      jwksUri: `${testIssuer}/certs`,
      issuers: [testIssuer],
      testIssuer: true,
    };
  }
  return {
    ...base,
    authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    jwksUri: GOOGLE_JWKS_URI,
    issuers: GOOGLE_ISSUERS,
    testIssuer: false,
  };
}

/** 32 random bytes, base64url (43 characters): states, nonces, verifiers, handoff codes. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** The RFC 7636 S256 challenge (also the hash the SPA's binding secret is sent as). */
export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Google's authorization URL for one pending sign-in (SSO-G1). */
export function buildGoogleAuthorizationUrl(
  config: GoogleOidcConfig,
  params: { state: string; nonce: string; codeChallenge: string },
  // Stream Offboarding's directory consent: the read-only directory scope
  // with offline access, consent forced (Google returns a refresh token only
  // then), and the Workspace domain as a hint. Sign-in passes nothing.
  directory?: { scope: string; hostedDomain: string },
): string {
  const url = new URL(config.authorizationEndpoint);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: directory ? `openid email ${directory.scope}` : "openid email profile",
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    prompt: directory ? "consent" : "select_account",
  });
  if (directory) {
    query.set("access_type", "offline");
    query.set("hd", directory.hostedDomain);
  }
  url.search = query.toString();
  return url.toString();
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Exchange the authorization code for Google's ID token (SSO-G3). */
export async function exchangeGoogleCode(
  config: GoogleOidcConfig,
  params: { code: string; codeVerifier: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  return (await exchangeGoogleCodeForTokens(config, params, fetchImpl)).idToken;
}

/** The exchange with its refresh token, for the directory consent (stream Offboarding). */
export async function exchangeGoogleCodeForTokens(
  config: GoogleOidcConfig,
  params: { code: string; codeVerifier: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ idToken: string; refreshToken: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        code_verifier: params.codeVerifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GoogleOidcError(`token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new GoogleOidcError(`token endpoint refused the code (${res.status})`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GoogleOidcError("token endpoint answered with non-JSON");
  }
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== "string" || idToken.length === 0) throw new GoogleOidcError("token response carried no id_token");
  const refreshToken = (body as { refresh_token?: unknown } | null)?.refresh_token;
  return { idToken, refreshToken: typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null };
}

/** Resolves a key id to Google's public key, or null when no such key is published. */
export type KeySource = (kid: string) => Promise<crypto.KeyObject | null>;

/**
 * Google's signing keys, fetched from its JWKS endpoint and cached for the
 * response's max-age (an hour when it names none). An unknown key id
 * triggers one refetch, for rotation, at most once a minute.
 */
export function createJwksKeySource(jwksUri: string, fetchImpl: FetchLike = fetch): KeySource {
  let cached: Map<string, crypto.KeyObject> | null = null;
  let cachedUntil = 0;
  let lastMissRefetch = 0;

  async function load(): Promise<void> {
    try {
      const res = await fetchImpl(jwksUri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return;
      const body = (await res.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys)) return;
      const keys = new Map<string, crypto.KeyObject>();
      for (const jwk of body.keys as Array<Record<string, unknown>>) {
        if (typeof jwk["kid"] !== "string" || jwk["kty"] !== "RSA") continue;
        try {
          keys.set(jwk["kid"], crypto.createPublicKey({ key: jwk, format: "jwk" } as unknown as crypto.JsonWebKeyInput));
        } catch {
          // A malformed key is skipped; the others still verify.
        }
      }
      const maxAge = /max-age=(\d+)/i.exec(res.headers.get("cache-control") ?? "")?.[1];
      cached = keys;
      cachedUntil = Date.now() + (maxAge ? Number(maxAge) : 3600) * 1000;
    } catch {
      // Unreachable: keep whatever is cached; verification fails closed on a miss.
    }
  }

  return async (kid) => {
    if (!cached || Date.now() >= cachedUntil) await load();
    const hit = cached?.get(kid);
    if (hit) return hit;
    if (Date.now() - lastMissRefetch < 60_000) return null;
    lastMissRefetch = Date.now();
    await load();
    return cached?.get(kid) ?? null;
  };
}

/** What a verified Google ID token says. `hostedDomain` null means a consumer account. */
export interface GoogleIdClaims {
  /** Normalized to `https://accounts.google.com` for Google's tokens. */
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  hostedDomain: string | null;
  name: string | null;
}

/**
 * Verify a Google ID token (SSO-G3): RS256 only, a key Google publishes, `iss`
 * in Google's two forms, `aud` our client id, unexpired, and `nonce` equal to
 * the pending request's. Nothing from the token is returned until every check
 * passes. Throws GoogleOidcError otherwise.
 */
export async function verifyGoogleIdToken(
  config: GoogleOidcConfig,
  idToken: string,
  expectedNonce: string,
  keys: KeySource,
): Promise<GoogleIdClaims> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded.payload === "string") throw new GoogleOidcError("not a JWT");
  if (decoded.header.alg !== "RS256") throw new GoogleOidcError(`algorithm ${decoded.header.alg} refused`);
  const kid = decoded.header.kid;
  if (typeof kid !== "string") throw new GoogleOidcError("no key id");
  const key = await keys(kid);
  if (!key) throw new GoogleOidcError("unknown key id");

  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(idToken, key, {
      algorithms: ["RS256"],
      audience: config.clientId,
      issuer: [...config.issuers] as [string, ...string[]],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    if (typeof verified === "string") throw new GoogleOidcError("unexpected string payload");
    payload = verified;
  } catch (err) {
    if (err instanceof GoogleOidcError) throw err;
    throw new GoogleOidcError(`verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof payload.exp !== "number") throw new GoogleOidcError("no exp");
  const nonce = payload["nonce"];
  if (typeof nonce !== "string" || !timingSafeEqualStrings(nonce, expectedNonce)) throw new GoogleOidcError("nonce mismatch");
  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) throw new GoogleOidcError("bad sub");
  const email = payload["email"];
  if (typeof email !== "string" || !email.includes("@")) throw new GoogleOidcError("no email");
  const hd = payload["hd"];
  const name = payload["name"];
  const emailVerified = payload["email_verified"];

  return {
    issuer: config.testIssuer ? String(payload.iss) : "https://accounts.google.com",
    subject,
    email,
    emailVerified: emailVerified === true || emailVerified === "true",
    hostedDomain: typeof hd === "string" && hd.length > 0 ? hd.toLowerCase() : null,
    name: typeof name === "string" && name.length > 0 ? name : null,
  };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
