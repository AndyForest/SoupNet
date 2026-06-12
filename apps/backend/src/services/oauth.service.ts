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

// ── Client lookup ────────────────────────────────────────────────────────────

interface OAuthClientRow {
  client_id: string;
  client_secret_hash: string;
  client_name: string | null;
  redirect_uris: string[];
}

export interface OAuthClientPublic {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
}

export async function getClientPublic(
  db: PostgresJsDatabase,
  clientId: string,
): Promise<OAuthClientPublic | null> {
  const rows = await db.execute(sql`
    SELECT client_id, client_secret_hash, client_name, redirect_uris
    FROM claimnet.oauth_clients
    WHERE client_id = ${clientId}
    LIMIT 1
  `);
  const row = (rows as unknown as OAuthClientRow[])[0];
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
  };
}

/** Constant-time verify of client_secret. Returns true if the client exists
 *  and the secret matches. */
export async function verifyClientCredentials(
  db: PostgresJsDatabase,
  clientId: string,
  clientSecret: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT client_secret_hash FROM claimnet.oauth_clients
    WHERE client_id = ${clientId}
    LIMIT 1
  `);
  const row = (rows as unknown as Array<{ client_secret_hash: string }>)[0];
  if (!row) return false;
  const provided = hashOpaque(clientSecret);
  const valid = crypto.timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(row.client_secret_hash, "hex"),
  );
  if (valid) {
    // Fire-and-forget last_used_at stamp (mirrors validateKey's pattern in
    // api-key.service.ts). The F39 sweep uses this to tell DCR spam (never
    // authenticated) from dormant-but-real clients, which are kept.
    void db
      .execute(sql`
        UPDATE claimnet.oauth_clients SET last_used_at = NOW() WHERE client_id = ${clientId}
      `)
      .catch((err) => console.error("[oauth] failed to stamp client last_used_at:", err));
  }
  return valid;
}

// ── Opportunistic cleanup (F39) ───────────────────────────────────────────────
//
// Every grant inserts an oauth_authorization_codes row and every token
// issuance / refresh rotation inserts an api_keys row; anonymous DCR inserts
// oauth_clients rows. Nothing deleted any of them. Following the email-log
// precedent (email.service.ts): purge opportunistically from the hot path —
// no scheduler to maintain, and the tables stay bounded as long as the OAuth
// surface is being used at all. Throttled to once per interval per container.
//
// Retention reasoning:
// - codes: 5-minute TTL; anything past expiry + 1 day is dead weight (consumed
//   codes expire on the same clock, so one predicate covers both).
// - oauth api_keys: expires_at gates BOTH bearer validation and the refresh
//   path (see refreshOAuthTokenBundle's WHERE), so 30 days past expires_at the
//   row is unusable for anything. audit_log.api_key_id has no FK — deleting
//   key rows never deletes audit history (which the F29 limiter reads).
// - clients: only never-authenticated registrations (last_used_at IS NULL)
//   with nothing minted are swept. Dormant-but-real clients are kept so a
//   long-idle connector doesn't silently need re-registration.

export const OAUTH_CODE_SWEEP_DAYS = 1;
export const OAUTH_KEY_SWEEP_DAYS = 30;
export const OAUTH_CLIENT_SWEEP_DAYS = 30;
const OAUTH_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
let lastOAuthCleanupAt = 0;

export async function cleanupOAuthArtifacts(db: SqlExecutor): Promise<void> {
  await db.execute(sql`
    DELETE FROM claimnet.oauth_authorization_codes
    WHERE expires_at < NOW() - make_interval(days => ${OAUTH_CODE_SWEEP_DAYS})
  `);
  await db.execute(sql`
    DELETE FROM claimnet.api_keys
    WHERE key_type = 'oauth'
      AND expires_at < NOW() - make_interval(days => ${OAUTH_KEY_SWEEP_DAYS})
  `);
  await db.execute(sql`
    DELETE FROM claimnet.oauth_clients c
    WHERE c.created_at < NOW() - make_interval(days => ${OAUTH_CLIENT_SWEEP_DAYS})
      AND c.last_used_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.api_keys k WHERE k.oauth_client_id = c.client_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.oauth_authorization_codes ac WHERE ac.client_id = c.client_id
      )
  `);
}

/** Throttled fire-and-forget wrapper, called from the /oauth/token hot path.
 *  Cleanup failure must never block token issuance. */
export function maybeCleanupOAuthArtifacts(db: SqlExecutor): void {
  const now = Date.now();
  if (now - lastOAuthCleanupAt < OAUTH_CLEANUP_INTERVAL_MS) return;
  lastOAuthCleanupAt = now;
  void cleanupOAuthArtifacts(db).catch((err) =>
    console.error("[oauth] artifact cleanup failed:", err),
  );
}

// ── Authorization code mint/redeem ───────────────────────────────────────────

export const AUTH_CODE_TTL_SECONDS = 5 * 60;

export interface MintAuthCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopeReadGroupIds: string[];
  scopeWriteGroupIds: string[];
  scopeDefaultWriteGroupId: string;
}

export async function mintAuthCode(
  db: PostgresJsDatabase,
  input: MintAuthCodeInput,
): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBase62(32);
  const codeHash = hashOpaque(code);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);

  await db.execute(sql`
    INSERT INTO claimnet.oauth_authorization_codes (
      id, code_hash, client_id, user_id, redirect_uri,
      code_challenge, code_challenge_method,
      scope_read_group_ids, scope_write_group_ids, scope_default_write_group_id,
      expires_at, created_at
    ) VALUES (
      gen_random_uuid(),
      ${codeHash},
      ${input.clientId},
      ${input.userId}::uuid,
      ${input.redirectUri},
      ${input.codeChallenge},
      ${input.codeChallengeMethod},
      ${sql`ARRAY[${sql.join(input.scopeReadGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${sql`ARRAY[${sql.join(input.scopeWriteGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${input.scopeDefaultWriteGroupId}::uuid,
      ${expiresAt.toISOString()}::timestamptz,
      NOW()
    )
  `);

  return { code, expiresAt };
}

export class RedeemCodeError extends Error {
  constructor(public oauthError: string, message: string) {
    super(message);
    this.name = "RedeemCodeError";
  }
}

interface AuthCodeRow {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope_read_group_ids: string[];
  scope_write_group_ids: string[];
  scope_default_write_group_id: string;
  consumed_at: Date | null;
  expires_at: Date;
}

export interface RedeemedAuthCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopeReadGroupIds: string[];
  scopeWriteGroupIds: string[];
  scopeDefaultWriteGroupId: string;
}

/**
 * Look up an authorization code, verify PKCE, mark it consumed atomically.
 * Throws RedeemCodeError on any failure path so the route handler can map
 * each to the appropriate OAuth error response.
 */
export async function redeemAuthCode(
  db: PostgresJsDatabase,
  params: { code: string; codeVerifier: string; clientId: string; redirectUri: string },
): Promise<RedeemedAuthCode> {
  const codeHash = hashOpaque(params.code);

  // Single UPDATE...RETURNING that atomically marks the code consumed if and
  // only if it's still valid and unconsumed. Avoids the TOCTOU race a separate
  // SELECT + UPDATE would have.
  const rows = await db.execute(sql`
    UPDATE claimnet.oauth_authorization_codes
    SET consumed_at = NOW()
    WHERE code_hash = ${codeHash}
      AND consumed_at IS NULL
      AND expires_at > NOW()
    RETURNING client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
              scope_read_group_ids, scope_write_group_ids, scope_default_write_group_id,
              consumed_at, expires_at
  `);
  const row = (rows as unknown as AuthCodeRow[])[0];
  if (!row) throw new RedeemCodeError("invalid_grant", "authorization code is invalid, expired, or already used");

  // Client + redirect_uri must match what was issued. We've already consumed
  // the code at this point — that's fine, replaying it would still fail.
  if (row.client_id !== params.clientId) {
    throw new RedeemCodeError("invalid_grant", "client_id does not match the authorization code");
  }
  if (row.redirect_uri !== params.redirectUri) {
    throw new RedeemCodeError("invalid_grant", "redirect_uri does not match the authorization code");
  }

  // PKCE verification. We accept only S256 at issuance time, so this branch
  // is the only one expected. Defensive against future spec additions.
  if (row.code_challenge_method !== "S256") {
    throw new RedeemCodeError("invalid_grant", "unsupported code_challenge_method");
  }
  const computed = crypto
    .createHash("sha256")
    .update(params.codeVerifier)
    .digest("base64url");
  if (computed !== row.code_challenge) {
    throw new RedeemCodeError("invalid_grant", "code_verifier does not match code_challenge");
  }

  return {
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    scopeReadGroupIds: row.scope_read_group_ids,
    scopeWriteGroupIds: row.scope_write_group_ids,
    scopeDefaultWriteGroupId: row.scope_default_write_group_id,
  };
}

// ── Access + refresh token bundle ────────────────────────────────────────────
//
// An OAuth access token IS a Soup.net scoped API key (cn_s_... prefix) — same
// Bearer validation path, same recipe-book scope fields. The refresh_token is
// a separate opaque value stored as refresh_token_hash on the same api_keys
// row. Refresh rotation issues a new row and revokes the old one (expires_at
// set to NOW); the old refresh token is single-use by construction.

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: string;
}

interface MintTokenBundleInput {
  userId: string;
  clientId: string;
  scopeReadGroupIds: string[];
  scopeWriteGroupIds: string[];
  scopeDefaultWriteGroupId: string;
}

/** The subset of the db interface mint needs — lets it run inside a
 *  transaction (F38) as well as on the root connection. */
type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

export async function mintOAuthTokenBundle(
  db: SqlExecutor,
  input: MintTokenBundleInput,
): Promise<OAuthTokenBundle> {
  const accessToken = `cn_s_${randomBase62(32)}`;
  const refreshToken = randomBase62(32);
  const accessTokenHash = hashOpaque(accessToken);
  const refreshTokenHash = hashOpaque(refreshToken);
  const keyPrefix = accessToken.slice(0, 8);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await db.execute(sql`
    INSERT INTO claimnet.api_keys (
      id, key, key_prefix, user_id, read_group_ids, write_group_ids,
      default_write_group_id, label, key_type, refresh_token_hash,
      refresh_token_expires_at, oauth_client_id, expires_at, created_at
    ) VALUES (
      gen_random_uuid(),
      ${accessTokenHash},
      ${keyPrefix},
      ${input.userId}::uuid,
      ${sql`ARRAY[${sql.join(input.scopeReadGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${sql`ARRAY[${sql.join(input.scopeWriteGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${input.scopeDefaultWriteGroupId}::uuid,
      ${`oauth: ${input.clientId}`},
      'oauth',
      ${refreshTokenHash},
      ${refreshExpiresAt.toISOString()}::timestamptz,
      ${input.clientId},
      ${accessExpiresAt.toISOString()}::timestamptz,
      NOW()
    )
  `);

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopeString(input.scopeWriteGroupIds, input.scopeReadGroupIds),
  };
}

interface RefreshableKeyRow {
  user_id: string;
  oauth_client_id: string;
  read_group_ids: string[];
  write_group_ids: string[];
  default_write_group_id: string;
  refresh_token_expires_at: Date;
}

export class RefreshTokenError extends Error {
  constructor(public oauthError: string, message: string) {
    super(message);
    this.name = "RefreshTokenError";
  }
}

/**
 * Rotate a refresh token. Revocation IS the gate (F38, security-audit-
 * 2026-06-11): a single atomic UPDATE...RETURNING consumes the old row by
 * its refresh_token_hash, mirroring the auth-code path's TOCTOU defense —
 * two concurrent refreshes with the same token can no longer both pass a
 * SELECT check and mint two independent token families. The rotation runs
 * in a transaction so a mint failure rolls the revocation back and the
 * caller's refresh token survives (the availability property the old
 * mint-first ordering bought, without the race).
 */
export async function refreshOAuthTokenBundle(
  db: PostgresJsDatabase,
  params: { refreshToken: string; clientId: string },
): Promise<OAuthTokenBundle> {
  const refreshTokenHash = hashOpaque(params.refreshToken);

  return db.transaction(async (tx) => {
    // Atomically consume: expires_at=NOW kills both the access token
    // (validation checks expires_at > NOW) and any concurrent refresh
    // (this same WHERE clause). Under READ COMMITTED the second concurrent
    // UPDATE blocks on the row lock, re-evaluates the predicate after the
    // first commits, matches zero rows, and gets invalid_grant.
    const rows = await tx.execute(sql`
      UPDATE claimnet.api_keys
      SET expires_at = NOW()
      WHERE refresh_token_hash = ${refreshTokenHash}
        AND key_type = 'oauth'
        AND expires_at > NOW()
      RETURNING id, user_id, oauth_client_id, read_group_ids, write_group_ids,
                default_write_group_id, refresh_token_expires_at
    `);
    const row = (rows as unknown as Array<RefreshableKeyRow & { id: string }>)[0];
    if (!row) throw new RefreshTokenError("invalid_grant", "refresh token is invalid or revoked");

    // Throwing past this point rolls the consumption back — a mismatched
    // client_id or an expired refresh window must not burn the legitimate
    // client's token (same observable behavior as before F38).
    if (row.oauth_client_id !== params.clientId) {
      throw new RefreshTokenError("invalid_grant", "client_id does not match the refresh token");
    }
    if (new Date(row.refresh_token_expires_at).getTime() <= Date.now()) {
      throw new RefreshTokenError("invalid_grant", "refresh token has expired");
    }

    return mintOAuthTokenBundle(tx, {
      userId: row.user_id,
      clientId: row.oauth_client_id,
      scopeReadGroupIds: row.read_group_ids,
      scopeWriteGroupIds: row.write_group_ids,
      scopeDefaultWriteGroupId: row.default_write_group_id,
    });
  });
}

function scopeString(writeIds: string[], readIds: string[]): string {
  // Coarse-scope vocabulary: "read" if any read access, "write" if any write
  // access. Per-recipe-book detail is captured in the row's read_group_ids /
  // write_group_ids arrays and surfaced on the consent screen — claude.ai's
  // OAuth UI just shows the coarse strings.
  const parts: string[] = [];
  if (readIds.length > 0) parts.push("read");
  if (writeIds.length > 0) parts.push("write");
  return parts.join(" ");
}
