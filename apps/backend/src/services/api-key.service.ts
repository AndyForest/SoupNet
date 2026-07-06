/**
 * API key management service.
 *
 * Manages keys stored in the Drizzle claimnet.api_keys table.
 * Keys come in two flavors:
 *   - daily:  auto-expire at midnight UTC, embedded in search page URLs
 *   - scoped: user-specified expiry, for integrations and long-lived agent sessions
 *
 * Key format: cn_d_ or cn_s_ prefix + 32 bytes base62 encoded.
 * Keys are stored hashed (SHA-256) — the raw key is only returned once at creation.
 *
 * NOTE: The api_keys table is being created by Workstream 1 (packages/db).
 * This service assumes the table exists with columns:
 *   id, key, keyPrefix, userId, groupIds, label, keyType, expiresAt, lastUsedAt, createdAt
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ── Base62 encoding for URL-safe keys ────────────────────────────────────────

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(bytes: Buffer): string {
  let result = "";
  for (const byte of bytes) {
    // Map each byte to a base62 character (modulo 62)
    result += BASE62_CHARS[byte % 62];
  }
  return result;
}

// ── Key hashing ──────────────────────────────────────────────────────────────
// Store SHA-256 hash of the key, never the raw key itself.

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Placeholder type for the api_keys table until WS1 merges.
 * The actual table will be imported from @soupnet/db.
 */
interface ApiKeyRow {
  id: string;
  key: string;
  keyPrefix: string;
  userId: string;
  readGroupIds: string[];
  writeGroupIds: string[];
  defaultWriteGroupId: string;
  label: string | null;
  keyType: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
}

type ApiKeyListItem = Omit<ApiKeyRow, "key" | "lastUsedAt">;

interface GenerateKeyResult {
  key: string;
  searchUrl: string;
  expiresAt: Date;
  readGroupIds: string[];
  writeGroupIds: string[];
  defaultWriteGroupId: string;
}

interface ValidateKeyResult {
  keyId: string;
  userId: string;
  readGroupIds: string[];
  writeGroupIds: string[];
  defaultWriteGroupId: string;
  /** 'daily' | 'scoped' | 'oauth' — lets callers stamp the connection
   *  surface (UVP Layer 1: OAuth client identity is server-known). */
  keyType: string;
  /** oauth_clients.client_id for key_type='oauth'; null otherwise. */
  oauthClientId: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateRawKey(prefix: string): string {
  const bytes = crypto.randomBytes(32);
  return `${prefix}${toBase62(bytes)}`;
}

function getMidnightUTC(): Date {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1, // next midnight
    0, 0, 0, 0,
  ));
  return midnight;
}

function buildCheckUrl(key: string): string {
  const backendUrl = process.env["BACKEND_URL"] ?? "http://localhost:3101";
  return `${backendUrl}/check?key=${encodeURIComponent(key)}`;
}

// ── Service functions ────────────────────────────────────────────────────────

/**
 * Generate a daily key that expires at midnight UTC.
 * These are meant for "today's search link" use cases — short-lived, ephemeral.
 */
export async function generateDailyKey(
  db: PostgresJsDatabase,
  userId: string,
  readGroupIds: string[],
  writeGroupIds?: string[],
  defaultWriteGroup?: string,
): Promise<GenerateKeyResult> {
  const rawKey = generateRawKey("cn_d_");
  const hashedKey = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8); // e.g. "cn_d_Ab3"
  const expiresAt = getMidnightUTC();
  const effectiveWriteGroupIds = writeGroupIds ?? readGroupIds;
  const effectiveDefaultWrite = defaultWriteGroup ?? effectiveWriteGroupIds[0]!;

  await db.execute(sql`
    INSERT INTO claimnet.api_keys (id, key, key_prefix, user_id, read_group_ids, write_group_ids, default_write_group_id, label, key_type, expires_at, created_at)
    VALUES (
      gen_random_uuid(),
      ${hashedKey},
      ${keyPrefix},
      ${userId},
      ${sql`ARRAY[${sql.join(readGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${sql`ARRAY[${sql.join(effectiveWriteGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${effectiveDefaultWrite}::uuid,
      NULL,
      'daily',
      ${expiresAt.toISOString()}::timestamptz,
      NOW()
    )
  `);

  return {
    key: rawKey,
    searchUrl: buildCheckUrl(rawKey),
    expiresAt,
    readGroupIds,
    writeGroupIds: effectiveWriteGroupIds,
    defaultWriteGroupId: effectiveDefaultWrite,
  };
}

/**
 * Generate a scoped key with user-specified expiry.
 * Used for integrations, long-lived agent sessions, sharing specific group access.
 */
export async function generateScopedKey(
  db: PostgresJsDatabase,
  userId: string,
  params: {
    readGroupIds: string[];
    writeGroupIds: string[];
    defaultWriteGroupId: string;
    expiresAt: Date;
    label?: string;
  },
): Promise<GenerateKeyResult> {
  const rawKey = generateRawKey("cn_s_");
  const hashedKey = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);

  await db.execute(sql`
    INSERT INTO claimnet.api_keys (id, key, key_prefix, user_id, read_group_ids, write_group_ids, default_write_group_id, label, key_type, expires_at, created_at)
    VALUES (
      gen_random_uuid(),
      ${hashedKey},
      ${keyPrefix},
      ${userId},
      ${sql`ARRAY[${sql.join(params.readGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${sql`ARRAY[${sql.join(params.writeGroupIds.map((g) => sql`${g}::uuid`), sql`,`)}]`},
      ${params.defaultWriteGroupId}::uuid,
      ${params.label ?? null},
      'scoped',
      ${params.expiresAt.toISOString()}::timestamptz,
      NOW()
    )
  `);

  return {
    key: rawKey,
    searchUrl: buildCheckUrl(rawKey),
    expiresAt: params.expiresAt,
    readGroupIds: params.readGroupIds,
    writeGroupIds: params.writeGroupIds,
    defaultWriteGroupId: params.defaultWriteGroupId,
  };
}

/**
 * Validate an API key. Returns user/group info if valid, null if expired or not found.
 * Updates lastUsedAt on successful validation.
 */
export async function validateKey(
  db: PostgresJsDatabase,
  key: string,
): Promise<ValidateKeyResult | null> {
  const hashedKey = hashKey(key);

  // F15: defensively reject keys whose owner has not verified their email.
  // Key creation is gated by requireVerifiedEmail middleware, so this branch
  // should not normally fire — but we enforce it here too in case a user is
  // unverified after the fact (e.g. invitation flow, F31).
  const rows = await db.execute(sql`
    SELECT k.id, k.user_id, k.read_group_ids, k.write_group_ids, k.default_write_group_id, k.expires_at, k.key_type, k.oauth_client_id
    FROM claimnet.api_keys k
    JOIN claimnet.users u ON u.id = k.user_id
    WHERE k.key = ${hashedKey}
      AND k.expires_at > NOW()
      AND u.email_verified_at IS NOT NULL
    LIMIT 1
  `);

  if (!rows || rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;

  // Update lastUsedAt asynchronously (fire and forget)
  void db.execute(sql`
    UPDATE claimnet.api_keys SET last_used_at = NOW() WHERE key = ${hashedKey}
  `);

  return {
    keyId: row["id"] as string,
    userId: row["user_id"] as string,
    readGroupIds: row["read_group_ids"] as string[],
    writeGroupIds: row["write_group_ids"] as string[],
    defaultWriteGroupId: row["default_write_group_id"] as string,
    keyType: row["key_type"] as string,
    oauthClientId: (row["oauth_client_id"] as string | null) ?? null,
  };
}

/**
 * List all non-expired keys for a user.
 * Returns prefix (not full key) for display purposes.
 */
export async function listKeys(
  db: PostgresJsDatabase,
  userId: string,
): Promise<ApiKeyListItem[]> {
  const rows = await db.execute(sql`
    SELECT id, key_prefix, key_type, read_group_ids, write_group_ids, default_write_group_id, label, expires_at, created_at
    FROM claimnet.api_keys
    WHERE user_id = ${userId}
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row["id"] as string,
    key: "", // never return the full key
    keyPrefix: row["key_prefix"] as string,
    userId,
    readGroupIds: row["read_group_ids"] as string[],
    writeGroupIds: row["write_group_ids"] as string[],
    defaultWriteGroupId: row["default_write_group_id"] as string,
    label: (row["label"] as string) ?? null,
    keyType: row["key_type"] as string,
    expiresAt: new Date(row["expires_at"] as string),
    createdAt: new Date(row["created_at"] as string),
  }));
}

/**
 * Revoke (delete) a key. Ownership check: userId must match.
 * Returns true if a key was deleted, false if not found or not owned.
 */
export async function revokeKey(
  db: PostgresJsDatabase,
  keyId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM claimnet.api_keys
    WHERE id = ${keyId}
      AND user_id = ${userId}
  `);

  // postgres.js returns rows affected differently; check the command tag
  return (result as unknown as { count?: number }).count !== undefined
    ? ((result as unknown as { count: number }).count > 0)
    : true; // assume success if we can't determine count
}
