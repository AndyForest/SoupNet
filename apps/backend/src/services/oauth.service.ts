/**
 * OAuth 2.1 service — client registration, code mint/redeem, token issuance.
 *
 * Tokens issued by this service are Soup.net API keys (cn_s_... prefix) stored
 * in claimnet.api_keys with key_type='oauth'. Bearer-token validation goes
 * through the same validateKey() path as scoped keys — see api-key.service.ts.
 *
 * Format conventions:
 *   client_id      — `oauth_<base62>` (24 bytes random → 24 chars)
 *   client_secret  — opaque base62 (32 bytes random); stored as SHA-256 hash
 *   authorization code — opaque base62 (32 bytes); stored as SHA-256 hash
 *   refresh token  — opaque base62 (32 bytes); stored as SHA-256 hash
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ── Base62 encoding ──────────────────────────────────────────────────────────

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(bytes: Buffer): string {
  let result = "";
  for (const byte of bytes) {
    result += BASE62_CHARS[byte % 62];
  }
  return result;
}

function randomBase62(byteLength: number): string {
  return toBase62(crypto.randomBytes(byteLength));
}

export function hashOpaque(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// ── Client registration (RFC 7591) ───────────────────────────────────────────

export interface RegisterClientInput {
  redirectUris: string[];
  clientName?: string | undefined;
}

export interface RegisterClientResult {
  clientId: string;
  clientSecret: string;
  clientIdIssuedAt: number; // seconds since epoch
  clientName: string | null;
  redirectUris: string[];
}

const REDIRECT_URI_MAX_LEN = 2000;
const CLIENT_NAME_MAX_LEN = 200;

/**
 * Validate a redirect_uri at registration time. RFC 6749 §3.1.2 requires
 * absolute URIs without a fragment. We additionally require https://, with
 * the exception of http://localhost and http://127.0.0.1 for development.
 */
export function validateRedirectUri(uri: string): { ok: true } | { ok: false; reason: string } {
  if (typeof uri !== "string" || uri.length === 0) return { ok: false, reason: "redirect_uri must be a non-empty string" };
  if (uri.length > REDIRECT_URI_MAX_LEN) return { ok: false, reason: "redirect_uri exceeds max length" };
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: "redirect_uri is not a valid absolute URI" };
  }
  if (parsed.hash !== "") return { ok: false, reason: "redirect_uri must not include a fragment" };
  // WHATWG URL surfaces IPv6 hosts in their bracketed form (parsed.hostname === "[::1]").
  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol === "https:") return { ok: true };
  if (parsed.protocol === "http:" && isLocalhost) return { ok: true };
  return { ok: false, reason: "redirect_uri must use https:// (http://localhost is allowed for development)" };
}

export async function registerClient(
  db: PostgresJsDatabase,
  input: RegisterClientInput,
): Promise<RegisterClientResult> {
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
    throw new RegisterClientError("invalid_redirect_uri", "redirect_uris must be a non-empty array");
  }
  for (const uri of input.redirectUris) {
    const result = validateRedirectUri(uri);
    if (!result.ok) throw new RegisterClientError("invalid_redirect_uri", result.reason);
  }
  if (input.clientName !== undefined) {
    if (typeof input.clientName !== "string") {
      throw new RegisterClientError("invalid_client_metadata", "client_name must be a string");
    }
    if (input.clientName.length > CLIENT_NAME_MAX_LEN) {
      throw new RegisterClientError("invalid_client_metadata", "client_name exceeds max length");
    }
  }

  const clientId = `oauth_${randomBase62(24)}`;
  const clientSecret = randomBase62(32);
  const clientSecretHash = hashOpaque(clientSecret);
  const clientName = input.clientName ?? null;
  const issuedAt = new Date();

  await db.execute(sql`
    INSERT INTO claimnet.oauth_clients (id, client_id, client_secret_hash, client_name, redirect_uris, created_at)
    VALUES (
      gen_random_uuid(),
      ${clientId},
      ${clientSecretHash},
      ${clientName},
      ${sql`ARRAY[${sql.join(input.redirectUris.map((u) => sql`${u}`), sql`,`)}]::text[]`},
      ${issuedAt.toISOString()}::timestamptz
    )
  `);

  return {
    clientId,
    clientSecret,
    clientIdIssuedAt: Math.floor(issuedAt.getTime() / 1000),
    clientName,
    redirectUris: input.redirectUris,
  };
}

export class RegisterClientError extends Error {
  constructor(public oauthError: string, message: string) {
    super(message);
    this.name = "RegisterClientError";
  }
}
