import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  googleOidcConfig,
  buildGoogleAuthorizationUrl,
  verifyGoogleIdToken,
  exchangeGoogleCode,
  createJwksKeySource,
  pkceChallenge,
  randomToken,
  GOOGLE_ISSUERS,
  GoogleOidcError,
} from "./google-oidc.service";
import type { GoogleOidcConfig, KeySource } from "./google-oidc.service";

/**
 * The Google leg, in process with generated keys (rubric SSO-G1, SSO-G2,
 * SSO-G3; docs/planning/org-accounts-build/sso.md). The live round trip is
 * in routes/google-auth.test.ts against the test issuer.
 */

const CLIENT_ID = "client-123.apps.googleusercontent.com";

const config: GoogleOidcConfig = {
  clientId: CLIENT_ID,
  clientSecret: "secret",
  redirectUri: "https://mcp.example.net/auth/google/callback",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: GOOGLE_ISSUERS,
  testIssuer: false,
};

let rsa: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
let other: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
let keys: KeySource;

beforeAll(() => {
  rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  keys = async (kid) => (kid === "k1" ? rsa.publicKey : null);
});

function sign(claims: Record<string, unknown>, opts: { kid?: string; key?: crypto.KeyObject; alg?: jwt.Algorithm } = {}): string {
  return jwt.sign(
    {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "olive@acme.example",
      email_verified: true,
      hd: "acme.example",
      nonce: "n-1",
      ...claims,
    },
    opts.key ?? rsa.privateKey,
    { algorithm: opts.alg ?? "RS256", keyid: opts.kid ?? "k1", expiresIn: "5m" },
  );
}

describe("googleOidcConfig (SSO-G2, SSO-G7)", () => {
  it("is null without a client id, so Google sign-in is off", () => {
    expect(googleOidcConfig({})).toBeNull();
    expect(googleOidcConfig({ GOOGLE_OAUTH_CLIENT_ID: "  " })).toBeNull();
  });

  it("uses Google's fixed endpoints and the backend's callback", () => {
    const c = googleOidcConfig({ GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "s", BACKEND_URL: "https://mcp.example.net/" });
    expect(c).toMatchObject({
      clientId: "id",
      clientSecret: "s",
      redirectUri: "https://mcp.example.net/auth/google/callback",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      testIssuer: false,
    });
    expect(c?.issuers).toEqual(["https://accounts.google.com", "accounts.google.com"]);
  });

  it("honours a test issuer only outside production", () => {
    const env = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OIDC_TEST_ISSUER: "http://127.0.0.1:3998", BACKEND_URL: "http://localhost:3001" };
    const c = googleOidcConfig(env);
    expect(c).toMatchObject({
      authorizationEndpoint: "http://127.0.0.1:3998/authorize",
      tokenEndpoint: "http://127.0.0.1:3998/token",
      jwksUri: "http://127.0.0.1:3998/certs",
      issuers: ["http://127.0.0.1:3998"],
      testIssuer: true,
    });
    const prod = googleOidcConfig({ ...env, NODE_ENV: "production" });
    expect(prod?.testIssuer).toBe(false);
    expect(prod?.tokenEndpoint).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("buildGoogleAuthorizationUrl (SSO-G1)", () => {
  it("asks for openid email profile with state, nonce and S256, and no offline access", () => {
    const url = new URL(buildGoogleAuthorizationUrl(config, { state: "st", nonce: "nn", codeChallenge: "cc" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(config.redirectUri);
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("state")).toBe("st");
    expect(p.get("nonce")).toBe("nn");
    expect(p.get("code_challenge")).toBe("cc");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("prompt")).toBe("select_account");
    expect(p.has("access_type")).toBe(false);
  });
});

describe("pkce and random tokens", () => {
  it("computes the RFC 7636 S256 challenge", () => {
    // RFC 7636 Appendix B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("mints 43-character base64url tokens that differ", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("verifyGoogleIdToken (SSO-G3)", () => {
  it("returns the claims of a valid token", async () => {
    const claims = await verifyGoogleIdToken(config, sign({ name: "Olive" }), "n-1", keys);
    expect(claims).toEqual({
      issuer: "https://accounts.google.com",
      subject: "1234567890",
      email: "olive@acme.example",
      emailVerified: true,
      hostedDomain: "acme.example",
      name: "Olive",
    });
  });

  it("normalizes the bare issuer form and treats a missing hd as a consumer account", async () => {
    const claims = await verifyGoogleIdToken(config, sign({ iss: "accounts.google.com", hd: undefined }), "n-1", keys);
    expect(claims.issuer).toBe("https://accounts.google.com");
    expect(claims.hostedDomain).toBeNull();
  });

  it("reads email_verified given as the string 'true' as true and anything else as false", async () => {
    expect((await verifyGoogleIdToken(config, sign({ email_verified: "true" }), "n-1", keys)).emailVerified).toBe(true);
    expect((await verifyGoogleIdToken(config, sign({ email_verified: undefined }), "n-1", keys)).emailVerified).toBe(false);
  });

  const refusals: Array<[string, () => string, string?]> = [
    ["the wrong audience", () => sign({ aud: "someone-else" })],
    ["the wrong issuer", () => sign({ iss: "https://evil.example" })],
    ["an expired token", () => jwt.sign({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1", email: "a@gmail.com", nonce: "n-1", exp: Math.floor(Date.now() / 1000) - 600 }, rsa.privateKey, { algorithm: "RS256", keyid: "k1" })],
    ["the wrong nonce", () => sign({ nonce: "n-2" })],
    ["no nonce", () => sign({ nonce: undefined })],
    ["an unknown key id", () => sign({}, { kid: "k9" })],
    ["a signature by another key", () => sign({}, { key: other.privateKey })],
    ["an HMAC algorithm", () => jwt.sign({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1", nonce: "n-1", email: "a@gmail.com" }, "secret", { algorithm: "HS256", keyid: "k1" })],
    ["alg none", () => {
      const h = Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url");
      const b = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1", nonce: "n-1", email: "a@gmail.com", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
      return `${h}.${b}.`;
    }],
    ["no email", () => sign({ email: undefined })],
    ["no sub", () => sign({ sub: undefined })],
    ["an over-long sub", () => sign({ sub: "x".repeat(256) })],
    ["garbage", () => "not.a.jwt"],
  ];

  for (const [label, make] of refusals) {
    it(`refuses ${label}`, async () => {
      await expect(verifyGoogleIdToken(config, make(), "n-1", keys)).rejects.toBeInstanceOf(GoogleOidcError);
    });
  }
});

describe("createJwksKeySource", () => {
  function jwks(kid: string, key: crypto.KeyObject) {
    return { keys: [{ ...(key.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "RS256", use: "sig" }] };
  }

  it("fetches once, caches, and refetches once for an unknown kid", async () => {
    let calls = 0;
    let served = jwks("k1", rsa.publicKey);
    const source = createJwksKeySource("https://keys.example/certs", async () => {
      calls++;
      return new Response(JSON.stringify(served), { status: 200, headers: { "cache-control": "public, max-age=3600" } });
    });
    expect(await source("k1")).not.toBeNull();
    expect(await source("k1")).not.toBeNull();
    expect(calls).toBe(1);
    served = jwks("k2", other.publicKey);
    expect(await source("k2")).not.toBeNull();
    expect(calls).toBe(2);
    // An unknown kid right after a refetch does not hammer the endpoint.
    expect(await source("k3")).toBeNull();
    expect(calls).toBe(2);
  });

  it("returns null when the key set can't be fetched", async () => {
    const source = createJwksKeySource("https://keys.example/certs", async () => new Response("nope", { status: 500 }));
    expect(await source("k1")).toBeNull();
  });
});

describe("exchangeGoogleCode (SSO-G3)", () => {
  it("posts the code, the verifier and the client credentials, and returns the id_token", async () => {
    let body = "";
    const idToken = await exchangeGoogleCode(config, { code: "c-1", codeVerifier: "v-1" }, async (url, init) => {
      expect(url).toBe(config.tokenEndpoint);
      body = String(init?.body);
      return new Response(JSON.stringify({ id_token: "the.id.token", access_token: "ignored" }), { status: 200 });
    });
    expect(idToken).toBe("the.id.token");
    const p = new URLSearchParams(body);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("c-1");
    expect(p.get("code_verifier")).toBe("v-1");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("client_secret")).toBe("secret");
    expect(p.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("throws on a refusal or a response without an id_token", async () => {
    await expect(exchangeGoogleCode(config, { code: "c", codeVerifier: "v" }, async () => new Response('{"error":"invalid_grant"}', { status: 400 }))).rejects.toBeInstanceOf(GoogleOidcError);
    await expect(exchangeGoogleCode(config, { code: "c", codeVerifier: "v" }, async () => new Response("{}", { status: 200 }))).rejects.toBeInstanceOf(GoogleOidcError);
    await expect(exchangeGoogleCode(config, { code: "c", codeVerifier: "v" }, async () => { throw new Error("network"); })).rejects.toBeInstanceOf(GoogleOidcError);
  });
});
