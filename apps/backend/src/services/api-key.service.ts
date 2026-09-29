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
  /** 'full' | 'drafts' (headless) — see the api_keys schema comment. */
  depositLevel: string;
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
  depositLevel: DepositLevel;
}

/** The levels a person may mint (drafts-and-triage slice 5). 'none' is
 *  reserved in the schema vocabulary and is not mintable (open question 41). */
export type DepositLevel = "full" | "drafts";

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
  label?: string,
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
      ${label ?? null},
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
    // Daily keys keep the column default (slice 5, S5-O1).
    depositLevel: "full",
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
    /** Chosen once, here, and never changed (slice 5, S5-S2). Default 'full'. */
    depositLevel?: DepositLevel;
  },
): Promise<GenerateKeyResult> {
  const rawKey = generateRawKey("cn_s_");
  const depositLevel: DepositLevel = params.depositLevel ?? "full";
  const hashedKey = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);

  await db.execute(sql`
    INSERT INTO claimnet.api_keys (id, key, key_prefix, user_id, read_group_ids, write_group_ids, default_write_group_id, label, key_type, deposit_level, expires_at, created_at)
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
      ${depositLevel},
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
    depositLevel,
  };
}

// Authenticating a presented key is NOT here. It lives in the authorization
// seam — `authenticateKey` in ../authz/key-auth.ts — together with every other
// statement that authorizes on a key. This file mints, lists, and revokes.

/**
 * List all non-expired keys for a user.
 * Returns prefix (not full key) for display purposes.
 */
export async function listKeys(
  db: PostgresJsDatabase,
  userId: string,
): Promise<ApiKeyListItem[]> {
  const rows = await db.execute(sql`
    SELECT id, key_prefix, key_type, deposit_level, read_group_ids, write_group_ids, default_write_group_id, label, expires_at, created_at
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
    depositLevel: row["deposit_level"] as string,
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
