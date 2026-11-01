import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { isRegisteredRedirectUri } from "@soupnet/contracts/oauth-redirect";
import {
  checkClientIdUrl,
  isCimdClientId,
  resolveCimdClient,
  resetCimdStateForTests,
  validateClientMetadata,
  verifyClientAssertion,
  CIMD_FETCHES_PER_IP_HOURLY_DEFAULT,
} from "./oauth-cimd.service";
import type { CimdClient, Fetcher } from "./oauth-cimd.service";

/** Rubric O5-3, O5-5 and O5-7, plus the fetch cap and first-party refusal
 *  (docs/planning/openai-plugin-build/oauth.md). No network: the fetcher is
 *  injected. */

const CLIENT_ID = "https://client.example.com/oauth/client.json";
const JWKS_URI = "https://client.example.com/oauth/jwks.json";
const REDIRECT = "https://client.example.com/connector_platform_oauth_redirect";
const TOKEN_ENDPOINT = "https://mcp.example.net/oauth/token";
const ISSUER = "https://mcp.example.net";

const savedEnv = { ...process.env };
beforeEach(() => {
  resetCimdStateForTests();
  process.env["BACKEND_URL"] = "https://mcp.example.net";
  process.env["FRONTEND_URL"] = "https://www.example.net";
  delete process.env["OAUTH_CIMD_DENIED_HOSTS"];
  delete process.env["OAUTH_CIMD_FETCHES_PER_IP_HOURLY"];
});
afterEach(() => {
  process.env = { ...savedEnv };
});

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client_id: CLIENT_ID,
    client_name: "Example Client",
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: "private_key_jwt",
    jwks_uri: JWKS_URI,
    ...overrides,
  };
}

function servingFetcher(routes: Record<string, unknown>): { fetch: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetcher = async (url) => {
    calls.push(url);
    if (!(url in routes)) return { ok: false, reason: "status 404" };
    return { ok: true, body: JSON.stringify(routes[url]) };
  };
  return { fetch, calls };
}

describe("client_id URL checks", () => {
  it("recognises https client ids only", () => {
    expect(isCimdClientId(CLIENT_ID)).toBe(true);
    expect(isCimdClientId("oauth_abc")).toBe(false);
    expect(isCimdClientId("http://client.example.com/c.json")).toBe(false);
  });

  it.each([
    ["http://client.example.com/c.json"],
    ["https://client.example.com"],
    ["https://client.example.com/"],
    ["https://client.example.com/a/../c.json"],
    ["https://CLIENT.example.com/c.json"],
    ["https://client.example.com/c.json#x"],
    ["https://u:p@client.example.com/c.json"],
    ["https://mcp.example.net/uploads/x.json"],
    ["https://www.example.net/c.json"],
    ["https://example.net/c.json"],
    ["https://evil.example.net/c.json"],
  ])("refuses %s", (id) => {
    expect(checkClientIdUrl(id).ok).toBe(false);
  });

  it("does not treat a look-alike as first party", () => {
    expect(checkClientIdUrl("https://example.net.evil.test/c.json").ok).toBe(true);
    expect(checkClientIdUrl("https://notexample.net/c.json").ok).toBe(true);
  });

  it("honours OAUTH_CIMD_DENIED_HOSTS", () => {
    process.env["OAUTH_CIMD_DENIED_HOSTS"] = "soup.net, client.example.com";
    expect(checkClientIdUrl(CLIENT_ID).ok).toBe(false);
    expect(checkClientIdUrl("https://www.soup.net/c.json").ok).toBe(false);
  });
});

describe("document validation (O5-3)", () => {
  it("accepts a private_key_jwt document and a public one", () => {
    const r = validateClientMetadata(CLIENT_ID, doc());
    expect(r.ok && r.client).toMatchObject({ authMethod: "private_key_jwt", domain: "client.example.com", clientName: "Example Client", redirectUris: [REDIRECT] });
    const pub = validateClientMetadata(CLIENT_ID, doc({ token_endpoint_auth_method: "none", jwks_uri: undefined }));
    expect(pub.ok && pub.client.authMethod).toBe("none");
    const absent = validateClientMetadata(CLIENT_ID, doc({ token_endpoint_auth_method: undefined }));
    expect(absent.ok && absent.client.authMethod).toBe("none");
  });

  it.each([
    ["client_id differs", doc({ client_id: "https://client.example.com/other.json" })],
    ["no redirect_uris", doc({ redirect_uris: [] })],
    ["bad redirect_uri", doc({ redirect_uris: ["http://client.example.com/cb"] })],
    ["redirect_uri with fragment", doc({ redirect_uris: ["https://client.example.com/cb#x"] })],
    ["secret method", doc({ token_endpoint_auth_method: "client_secret_post" })],
    ["client_secret present", doc({ client_secret: "s" })],
    ["private_key_jwt without keys", doc({ jwks_uri: undefined })],
    ["jwks_uri on another origin", doc({ jwks_uri: "https://keys.example.org/jwks.json" })],
    ["jwks_uri over http", doc({ jwks_uri: "http://client.example.com/oauth/jwks.json" })],
    ["empty inline jwks", doc({ jwks_uri: undefined, jwks: { keys: [] } })],
    ["long client_name", doc({ client_name: "x".repeat(201) })],
    ["not an object", ["client_id"]],
  ])("refuses a document with %s", (_label, d) => {
    expect(validateClientMetadata(CLIENT_ID, d).ok).toBe(false);
  });
});

describe("resolveCimdClient", () => {
  it("fetches once and serves the cache after", async () => {
    const { fetch, calls } = servingFetcher({ [CLIENT_ID]: doc() });
    expect((await resolveCimdClient(CLIENT_ID, { fetch, ip: "1.2.3.4" }))?.clientName).toBe("Example Client");
    expect((await resolveCimdClient(CLIENT_ID, { fetch, ip: "1.2.3.4" }))?.clientName).toBe("Example Client");
    expect(calls).toEqual([CLIENT_ID]);
  });

  it("answers null for an unfetchable or invalid document, and never fetches a first-party URL", async () => {
    const { fetch, calls } = servingFetcher({ [CLIENT_ID]: doc({ client_id: "https://x.example.com/c.json" }) });
    expect(await resolveCimdClient(CLIENT_ID, { fetch })).toBeNull();
    expect(await resolveCimdClient("https://client.example.com/missing.json", { fetch })).toBeNull();
    expect(await resolveCimdClient("https://mcp.example.net/uploads/a.json", { fetch })).toBeNull();
    expect(calls).not.toContain("https://mcp.example.net/uploads/a.json");
  });

  it("caps real fetches per client IP, without counting cache hits", async () => {
    const routes: Record<string, unknown> = {};
    for (let i = 0; i <= CIMD_FETCHES_PER_IP_HOURLY_DEFAULT; i++) {
      const id = `https://c${i}.example.com/client.json`;
      routes[id] = doc({ client_id: id, jwks_uri: `https://c${i}.example.com/jwks.json` });
    }
    const { fetch, calls } = servingFetcher(routes);
    const ids = Object.keys(routes);
    for (const id of ids.slice(0, CIMD_FETCHES_PER_IP_HOURLY_DEFAULT)) {
      expect(await resolveCimdClient(id, { fetch, ip: "9.9.9.9" })).not.toBeNull();
      expect(await resolveCimdClient(id, { fetch, ip: "9.9.9.9" })).not.toBeNull();
    }
    expect(calls).toHaveLength(CIMD_FETCHES_PER_IP_HOURLY_DEFAULT);
    const over = ids[CIMD_FETCHES_PER_IP_HOURLY_DEFAULT]!;
    expect(await resolveCimdClient(over, { fetch, ip: "9.9.9.9" })).toBeNull();
    expect(calls).toHaveLength(CIMD_FETCHES_PER_IP_HOURLY_DEFAULT);
    // Another IP still has its own budget, and the spent IP's refusal was not cached as a bad document.
    expect(await resolveCimdClient(over, { fetch, ip: "8.8.4.4" })).not.toBeNull();
  });

  it("lets the cap be set by OAUTH_CIMD_FETCHES_PER_IP_HOURLY", async () => {
    process.env["OAUTH_CIMD_FETCHES_PER_IP_HOURLY"] = "1";
    const second = "https://second.example.com/client.json";
    const { fetch } = servingFetcher({ [CLIENT_ID]: doc(), [second]: doc({ client_id: second, jwks_uri: undefined, token_endpoint_auth_method: "none" }) });
    expect(await resolveCimdClient(CLIENT_ID, { fetch, ip: "5.5.5.5" })).not.toBeNull();
    expect(await resolveCimdClient(second, { fetch, ip: "5.5.5.5" })).toBeNull();
  });
});

describe("Codex's published document", () => {
  // Saved byte for byte from the URL below on 2026-10-31. Codex listens on an
  // ephemeral port (seen: http://127.0.0.1:57687/callback).
  const CODEX_ID = "https://chatgpt.com/oauth/codex/client.json";
  const codex: unknown = JSON.parse(readFileSync(new URL("../test-fixtures/codex-client-metadata.json", import.meta.url), "utf8"));

  it("resolves as a public client, and its ephemeral port matches", async () => {
    const { fetch } = servingFetcher({ [CODEX_ID]: codex });
    const client = await resolveCimdClient(CODEX_ID, { fetch, ip: "1.2.3.4" });
    expect(client).toMatchObject({ authMethod: "none", domain: "chatgpt.com", clientName: "Codex" });
    expect(client?.redirectUris).toEqual(["http://127.0.0.1/callback", "http://localhost/callback"]);
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/callback", client!.redirectUris)).toBe(true);
    expect(isRegisteredRedirectUri("http://localhost:57687/callback", client!.redirectUris)).toBe(true);
  });

  it("refuses what the document doesn't register", async () => {
    const { fetch } = servingFetcher({ [CODEX_ID]: codex });
    const uris = (await resolveCimdClient(CODEX_ID, { fetch, ip: "1.2.3.4" }))!.redirectUris;
    expect(isRegisteredRedirectUri("http://127.0.0.1:57687/other", uris)).toBe(false);
    expect(isRegisteredRedirectUri("http://[::1]:57687/callback", uris)).toBe(false);
    expect(isRegisteredRedirectUri("https://127.0.0.1:57687/callback", uris)).toBe(false);
    expect(isRegisteredRedirectUri("https://evil.example/callback", uris)).toBe(false);
  });
});

describe("private_key_jwt assertions (O5-7)", () => {
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaJwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa-1", use: "sig", alg: "RS256" };
  const ecJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec-1", use: "sig" };
  const NOW_MS = 1_800_000_000_000;
  const NOW_S = NOW_MS / 1000;

  function client(): CimdClient {
    const r = validateClientMetadata(CLIENT_ID, doc());
    if (!r.ok) throw new Error(r.reason);
    return r.client;
  }

  function sign(opts: { key?: crypto.KeyObject; alg?: jwt.Algorithm; kid?: string; claims?: Record<string, unknown> } = {}): string {
    const claims = { iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, exp: NOW_S + 60, iat: NOW_S, jti: crypto.randomUUID(), ...opts.claims };
    return jwt.sign(claims, opts.key ?? rsa.privateKey, { algorithm: opts.alg ?? "RS256", keyid: opts.kid ?? "rsa-1" });
  }

  const deps = () => servingFetcher({ [JWKS_URI]: { keys: [rsaJwk, ecJwk] } });
  const verify = (assertion: string, fetch = deps().fetch) =>
    verifyClientAssertion(client(), assertion, { tokenEndpoint: TOKEN_ENDPOINT, issuer: ISSUER }, { fetch, now: () => NOW_MS });

  it("accepts RS256 and ES256 assertions signed by a key in the JWKS", async () => {
    expect(await verify(sign())).toBe(true);
    expect(await verify(sign({ key: ec.privateKey, alg: "ES256", kid: "ec-1" }))).toBe(true);
    expect(await verify(sign({ claims: { aud: ISSUER } }))).toBe(true);
  });

  it("refuses a replayed jti", async () => {
    const a = sign();
    expect(await verify(a)).toBe(true);
    expect(await verify(a)).toBe(false);
  });

  it.each([
    ["the wrong key", () => sign({ key: other.privateKey })],
    ["an unknown kid", () => sign({ kid: "nope" })],
    ["iss not the client", () => sign({ claims: { iss: "https://evil.example.com/c.json" } })],
    ["sub not the client", () => sign({ claims: { sub: "someone" } })],
    ["aud elsewhere", () => sign({ claims: { aud: "https://other.example.net/oauth/token" } })],
    ["expired", () => sign({ claims: { exp: NOW_S - 120 } })],
    ["exp too far ahead", () => sign({ claims: { exp: NOW_S + 3600 } })],
    ["no exp", () => jwt.sign({ iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, jti: "x1" }, rsa.privateKey, { algorithm: "RS256", keyid: "rsa-1", noTimestamp: true })],
    ["no jti", () => sign({ claims: { jti: undefined } })],
    ["HS256", () => jwt.sign({ iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, exp: NOW_S + 60, jti: "h1" }, "secret", { algorithm: "HS256", keyid: "rsa-1" })],
    ["alg none", () => `${Buffer.from(JSON.stringify({ alg: "none", kid: "rsa-1" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, exp: NOW_S + 60, jti: "n1" })).toString("base64url")}.`],
    ["RS256 signed but labelled ES256 (key-type confusion)", () => sign({ alg: "RS256", kid: "ec-1" })],
    ["garbage", () => "not.a.jwt"],
  ])("refuses an assertion with %s", async (_label, make) => {
    expect(await verify(make())).toBe(false);
  });

  it("refuses for a public client, which has no keys to check against", async () => {
    const pub = validateClientMetadata(CLIENT_ID, doc({ token_endpoint_auth_method: "none", jwks_uri: undefined }));
    if (!pub.ok) throw new Error(pub.reason);
    expect(await verifyClientAssertion(pub.client, sign(), { tokenEndpoint: TOKEN_ENDPOINT, issuer: ISSUER }, { now: () => NOW_MS })).toBe(false);
  });

  it("refetches the JWKS once when the kid is not in the cached set (key rotation)", async () => {
    let served: unknown = { keys: [ecJwk] };
    const calls: string[] = [];
    const fetch: Fetcher = async (url) => {
      calls.push(url);
      return { ok: true, body: JSON.stringify(served) };
    };
    expect(await verify(sign({ key: ec.privateKey, alg: "ES256", kid: "ec-1" }), fetch)).toBe(true);
    served = { keys: [ecJwk, rsaJwk] };
    expect(await verify(sign(), fetch)).toBe(true);
    expect(calls).toEqual([JWKS_URI, JWKS_URI]);
  });
});
