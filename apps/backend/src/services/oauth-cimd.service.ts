/**
 * OAuth client ID metadata documents (CIMD; OpenAI plugin directory round,
 * stream O, recipe c1c4bbd1). A client may use an https URL as its client_id;
 * the document at that URL is its registration. ChatGPT uses
 * https://chatgpt.com/oauth/client.json and authenticates at the token
 * endpoint with private_key_jwt; other clients may be public (`none`, PKCE as
 * the proof). Dynamic registration (oauth_clients) is unchanged beside it.
 *
 * Nothing here is stored: a document is fetched through lib/guarded-fetch.ts
 * (public addresses only, no redirects, size and time caps), validated, and
 * cached in memory for a few minutes. Every failure is one uniform null to the
 * caller, which answers it as an unknown client, so the endpoints are never a
 * probe of what a URL serves.
 *
 * Bounds:
 *   - a document may not live on the server's own origins or their parent
 *     domain: the consent page shows the document's domain as the client's
 *     identity, so a first-party host would read as the service itself;
 *   - real fetches (cache misses) are capped per client IP, because distinct
 *     client ids are free to mint and each miss is an outbound request;
 *   - a private_key_jwt assertion's jti is remembered until its exp, per
 *     process: with several tasks a replay inside the assertion's five-minute
 *     life could land on another task, which is bounded by exp and buys
 *     nothing without a valid code or refresh token, which are single-use.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { guardedFetch } from "../lib/guarded-fetch";
import type { GuardedFetchResult, GuardedFetchOptions } from "../lib/guarded-fetch";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getClientPublic, validateRedirectUri } from "./oauth.service";

export type CimdAuthMethod = "none" | "private_key_jwt";

export interface CimdClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  authMethod: CimdAuthMethod;
  /** The host that published the document: the client's verified identity. */
  domain: string;
  jwks: JsonWebKeyLike[] | null;
  jwksUri: string | null;
}

/** The fields of a JWK this module reads; the rest pass to createPublicKey. */
export interface JsonWebKeyLike {
  kty?: unknown;
  kid?: unknown;
  use?: unknown;
  alg?: unknown;
  [k: string]: unknown;
}

export type Fetcher = (url: string, opts: GuardedFetchOptions) => Promise<GuardedFetchResult>;

export interface CimdDeps {
  fetch?: Fetcher;
  now?: () => number;
  /** The requesting client's IP, for the fetch cap. */
  ip?: string;
}

const DOCUMENT_MAX_BYTES = 5 * 1024;
const JWKS_MAX_BYTES = 20 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const REDIRECT_URIS_MAX = 20;
const CLIENT_NAME_MAX_LEN = 200;
const CLIENT_ID_MAX_LEN = 2000;
export const ASSERTION_ALGORITHMS = ["RS256", "ES256"] as const;
export const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
/** An assertion may not be valid for longer than this ahead of now. */
const ASSERTION_MAX_LIFETIME_S = 5 * 60;
const CLOCK_TOLERANCE_S = 30;

/** Default per-IP cap on real document and key fetches, per hour. */
export const CIMD_FETCHES_PER_IP_HOURLY_DEFAULT = 30;

// ── Identification ───────────────────────────────────────────────────────────

/** A client_id that names a metadata document rather than a registration. */
export function isCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/** The hosts a client document may not live on: this server's own origins
 *  and their parent domains (mcp.soup.net and www.soup.net give soup.net),
 *  plus OAUTH_CIMD_DENIED_HOSTS. A host matches itself and its subdomains. */
export function firstPartyHosts(): string[] {
  const hosts = new Set<string>();
  for (const raw of [process.env["BACKEND_URL"], process.env["FRONTEND_URL"]]) {
    if (!raw) continue;
    try {
      const host = new URL(stripTrailingSlashes(raw)).hostname.toLowerCase();
      hosts.add(host);
      const labels = host.split(".");
      if (labels.length >= 3) hosts.add(labels.slice(1).join("."));
    } catch {
      /* an unparseable env value names nothing */
    }
  }
  for (const extra of (process.env["OAUTH_CIMD_DENIED_HOSTS"] ?? "").split(",")) {
    const h = extra.trim().toLowerCase();
    if (h) hosts.add(h);
  }
  return [...hosts];
}

function isFirstPartyHost(host: string): boolean {
  const h = host.toLowerCase();
  return firstPartyHosts().some((fp) => h === fp || h.endsWith(`.${fp}`));
}

/**
 * The checks on the client_id URL itself (CIMD draft): https, a path beyond
 * "/", no fragment or credentials, already in normalized form (so no dot
 * segments or case games), and not on a first-party host.
 */
export function checkClientIdUrl(clientId: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (clientId.length > CLIENT_ID_MAX_LEN) return { ok: false, reason: "client_id too long" };
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return { ok: false, reason: "client_id is not a URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "client_id is not https" };
  if (url.href !== clientId) return { ok: false, reason: "client_id is not in normalized form" };
  if (url.pathname === "/" || url.pathname === "") return { ok: false, reason: "client_id has no path" };
  if (url.hash !== "" || url.username !== "" || url.password !== "") return { ok: false, reason: "client_id has a fragment or credentials" };
  if (isFirstPartyHost(url.hostname)) return { ok: false, reason: "client_id is on a first-party host" };
  return { ok: true, url };
}

// ── Document validation ──────────────────────────────────────────────────────

/**
 * Validate a fetched document against the URL it came from. Returns the
 * client, or a reason (for tests and the server log; never the response).
 */
export function validateClientMetadata(clientId: string, doc: unknown): { ok: true; client: CimdClient } | { ok: false; reason: string } {
  const checked = checkClientIdUrl(clientId);
  if (!checked.ok) return checked;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { ok: false, reason: "document is not an object" };
  const d = doc as Record<string, unknown>;

  if (d["client_id"] !== clientId) return { ok: false, reason: "client_id in the document does not equal its URL" };
  if ("client_secret" in d || "client_secret_expires_at" in d) return { ok: false, reason: "document carries a client secret" };

  const uris = d["redirect_uris"];
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > REDIRECT_URIS_MAX) {
    return { ok: false, reason: "redirect_uris missing or out of bounds" };
  }
  for (const u of uris) {
    if (typeof u !== "string" || !validateRedirectUri(u).ok) return { ok: false, reason: "invalid redirect_uri" };
  }

  const nameRaw = d["client_name"];
  if (nameRaw !== undefined && (typeof nameRaw !== "string" || nameRaw.length > CLIENT_NAME_MAX_LEN)) {
    return { ok: false, reason: "invalid client_name" };
  }

  const methodRaw = d["token_endpoint_auth_method"] ?? "none";
  if (methodRaw !== "none" && methodRaw !== "private_key_jwt") {
    return { ok: false, reason: "token_endpoint_auth_method must be none or private_key_jwt" };
  }

  let jwks: JsonWebKeyLike[] | null = null;
  let jwksUri: string | null = null;
  if (d["jwks"] !== undefined) {
    const keys = (d["jwks"] as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: "jwks has no keys" };
    jwks = keys.filter((k): k is JsonWebKeyLike => typeof k === "object" && k !== null);
  }
  if (d["jwks_uri"] !== undefined) {
    if (typeof d["jwks_uri"] !== "string") return { ok: false, reason: "invalid jwks_uri" };
    let keysUrl: URL;
    try {
      keysUrl = new URL(d["jwks_uri"]);
    } catch {
      return { ok: false, reason: "invalid jwks_uri" };
    }
    if (keysUrl.protocol !== "https:" || keysUrl.origin !== checked.url.origin) {
      return { ok: false, reason: "jwks_uri is not on the document's origin" };
    }
    jwksUri = keysUrl.href;
  }
  if (methodRaw === "private_key_jwt" && jwks === null && jwksUri === null) {
    return { ok: false, reason: "private_key_jwt without keys" };
  }

  return {
    ok: true,
    client: {
      clientId,
      clientName: typeof nameRaw === "string" ? nameRaw : null,
      redirectUris: uris as string[],
      authMethod: methodRaw,
      domain: checked.url.hostname,
      jwks,
      jwksUri,
    },
  };
}

// ── Fetching, caching, the per-IP cap ────────────────────────────────────────

interface CacheEntry<T> {
  value: T | null;
  until: number;
}
const documentCache = new Map<string, CacheEntry<CimdClient>>();
const jwksCache = new Map<string, CacheEntry<JsonWebKeyLike[]>>();
const fetchesByIp = new Map<string, number[]>();

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): CacheEntry<T> | undefined {
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit;
  if (hit) cache.delete(key);
  return undefined;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

function fetchCap(): number {
  const raw = Number(process.env["OAUTH_CIMD_FETCHES_PER_IP_HOURLY"]);
  return Number.isFinite(raw) && raw > 0 ? raw : CIMD_FETCHES_PER_IP_HOURLY_DEFAULT;
}

/** Spend one real fetch from the IP's hourly budget; false when spent. */
function takeFetchBudget(ip: string, now: number): boolean {
  const windowMs = 60 * 60 * 1000;
  const recent = (fetchesByIp.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= fetchCap()) {
    fetchesByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  fetchesByIp.set(ip, recent);
  if (fetchesByIp.size > 10_000) {
    for (const [k, v] of fetchesByIp) if (v.every((t) => now - t >= windowMs)) fetchesByIp.delete(k);
  }
  return true;
}

async function fetchJson(url: string, maxBytes: number, deps: CimdDeps, now: number): Promise<unknown> {
  if (!takeFetchBudget(deps.ip ?? "unknown", now)) {
    console.warn("[oauth-cimd] per-IP fetch cap reached");
    return undefined;
  }
  const result = await (deps.fetch ?? guardedFetch)(url, { maxBytes, timeoutMs: FETCH_TIMEOUT_MS });
  if (!result.ok) {
    console.warn(`[oauth-cimd] fetch refused: ${result.reason}`);
    return undefined;
  }
  try {
    return JSON.parse(result.body) as unknown;
  } catch {
    console.warn("[oauth-cimd] fetch refused: body is not JSON");
    return undefined;
  }
}

/**
 * Resolve a CIMD client_id to its validated document, or null for every
 * failure (bad URL, first-party host, fetch refused, cap spent, invalid
 * document). Successes are cached for five minutes, failures for one.
 */
export async function resolveCimdClient(clientId: string, deps: CimdDeps = {}): Promise<CimdClient | null> {
  const now = (deps.now ?? Date.now)();
  if (!checkClientIdUrl(clientId).ok) return null;
  const hit = cacheGet(documentCache, clientId, now);
  if (hit) return hit.value;

  const doc = await fetchJson(clientId, DOCUMENT_MAX_BYTES, deps, now);
  if (doc === undefined) {
    // A spent budget is not cached as a failure: the document may be fine.
    if (fetchCapSpent(deps.ip ?? "unknown", now)) return null;
    cacheSet(documentCache, clientId, { value: null, until: now + NEGATIVE_TTL_MS });
    return null;
  }
  const validated = validateClientMetadata(clientId, doc);
  if (!validated.ok) {
    console.warn(`[oauth-cimd] document refused: ${validated.reason}`);
    cacheSet(documentCache, clientId, { value: null, until: now + NEGATIVE_TTL_MS });
    return null;
  }
  cacheSet(documentCache, clientId, { value: validated.client, until: now + CACHE_TTL_MS });
  return validated.client;
}

function fetchCapSpent(ip: string, now: number): boolean {
  const recent = (fetchesByIp.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  return recent.length >= fetchCap();
}

async function clientKeys(client: CimdClient, deps: CimdDeps, refresh: boolean): Promise<JsonWebKeyLike[]> {
  if (client.jwks) return client.jwks;
  if (!client.jwksUri) return [];
  const now = (deps.now ?? Date.now)();
  if (!refresh) {
    const hit = cacheGet(jwksCache, client.jwksUri, now);
    if (hit?.value) return hit.value;
  }
  const body = await fetchJson(client.jwksUri, JWKS_MAX_BYTES, deps, now);
  const keys = (body as { keys?: unknown } | undefined)?.keys;
  if (!Array.isArray(keys)) return [];
  const usable = keys.filter((k): k is JsonWebKeyLike => typeof k === "object" && k !== null);
  cacheSet(jwksCache, client.jwksUri, { value: usable, until: now + CACHE_TTL_MS });
  return usable;
}

// ── private_key_jwt (RFC 7523 §2.2, RFC 7521 §4.2) ───────────────────────────

const seenJti = new Map<string, number>();

function rememberJti(key: string, exp: number, nowS: number): boolean {
  for (const [k, e] of seenJti) if (e < nowS - CLOCK_TOLERANCE_S) seenJti.delete(k);
  if (seenJti.has(key)) return false;
  seenJti.set(key, exp);
  return true;
}

function pickKey(keys: JsonWebKeyLike[], kid: unknown, alg: string): JsonWebKeyLike | undefined {
  const kty = alg.startsWith("RS") ? "RSA" : "EC";
  const candidates = keys.filter((k) => k.kty === kty && (k.use === undefined || k.use === "sig") && (k.alg === undefined || k.alg === alg));
  if (typeof kid === "string") return candidates.find((k) => k.kid === kid);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Verify a client assertion for a private_key_jwt CIMD client. True only
 * when: the algorithm is RS256 or ES256 (never none or HMAC), a key from the
 * client's JWKS signed it (matched by kid, or the only usable key), iss and
 * sub are the client_id, aud names the token endpoint or the issuer, exp is
 * present and no more than five minutes ahead, and the jti is new.
 */
export async function verifyClientAssertion(
  client: CimdClient,
  assertion: string,
  audiences: { tokenEndpoint: string; issuer: string },
  deps: CimdDeps = {},
): Promise<boolean> {
  if (client.authMethod !== "private_key_jwt") return false;
  const decoded = jwt.decode(assertion, { complete: true });
  if (!decoded || typeof decoded === "string") return false;
  const alg = decoded.header.alg;
  if (!(ASSERTION_ALGORITHMS as readonly string[]).includes(alg)) return false;

  let jwk = pickKey(await clientKeys(client, deps, false), decoded.header.kid, alg);
  if (!jwk && client.jwksUri) jwk = pickKey(await clientKeys(client, deps, true), decoded.header.kid, alg);
  if (!jwk) return false;

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" } as unknown as crypto.JsonWebKeyInput);
  } catch {
    return false;
  }

  const nowS = Math.floor((deps.now ?? Date.now)() / 1000);
  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(assertion, publicKey, {
      algorithms: [alg as jwt.Algorithm],
      issuer: client.clientId,
      subject: client.clientId,
      audience: [audiences.tokenEndpoint, audiences.issuer],
      clockTolerance: CLOCK_TOLERANCE_S,
      clockTimestamp: nowS,
    });
    if (typeof verified === "string") return false;
    payload = verified;
  } catch {
    return false;
  }
  if (typeof payload.exp !== "number" || payload.exp > nowS + ASSERTION_MAX_LIFETIME_S + CLOCK_TOLERANCE_S) return false;
  if (typeof payload.jti !== "string" || payload.jti.length === 0 || payload.jti.length > 256) return false;
  return rememberJti(`${client.clientId} ${payload.jti}`, payload.exp, nowS);
}

/** For tests: forget cached documents, keys, budgets and seen jtis. */
export function resetCimdStateForTests(): void {
  documentCache.clear();
  jwksCache.clear();
  fetchesByIp.clear();
  seenJti.clear();
}

// ── One lookup for both kinds of client ──────────────────────────────────────

export interface ResolvedOAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  /** The verified publishing domain of a metadata-document client; null for
   *  a dynamically registered one, whose name is self-reported (F44). */
  domain: string | null;
  /** The metadata document, for token-endpoint authentication. */
  cimd: CimdClient | null;
}

/** Resolve either kind of client_id, or null when it names no usable client. */
export async function resolveOAuthClient(
  db: PostgresJsDatabase,
  clientId: string,
  deps: CimdDeps = {},
): Promise<ResolvedOAuthClient | null> {
  if (isCimdClientId(clientId)) {
    const cimd = await resolveCimdClient(clientId, deps);
    if (!cimd) return null;
    return { clientId, clientName: cimd.clientName, redirectUris: cimd.redirectUris, domain: cimd.domain, cimd };
  }
  const registered = await getClientPublic(db, clientId);
  if (!registered) return null;
  return { ...registered, domain: null, cimd: null };
}
