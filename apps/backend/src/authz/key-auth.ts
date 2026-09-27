/**
 * API-key authentication for AGENT (Bearer-path) callers: the one place a
 * presented credential is judged, and the one place the recipe books it may
 * touch are decided. The key half of the authorization seam — see
 * docs/engineering-principles.md §7.
 *
 * Every statement that authorizes on a key, or mints a new credential from an
 * old one, lives in this file. Route handlers and services receive a
 * `Principal`; they never look a key up themselves, and
 * `npm run check:authz-seam` fails the build when a new file does.
 *
 * Posture, stated rather than assumed:
 *   - Fail closed, and uniformly. An unknown, expired, consumed, or
 *     wrong-owner key, and a key whose owner fails the user-state predicate,
 *     are all the same `null`. Callers turn `null` into one response per
 *     surface, so a dead key is never an existence oracle (F15, and the
 *     uniform-response rule in lib/key-remediation.ts).
 *   - One round trip. The key, its owner's state, and its effective scope are
 *     resolved by a single statement, so there is no window between judging
 *     the credential and scoping it.
 *   - Scope is computed here, not stored here. The arrays on the key row are
 *     what the key was GRANTED at mint. What it may touch NOW is that grant
 *     intersected with the owner's current memberships (F67), minus any
 *     born-ephemeral book whose expiry has passed (F57/F68). Removing a member,
 *     re-adding them, and disposing a workspace all take effect on the next
 *     request with nothing to sweep.
 *   - Scope only ever narrows after this point. Call-time parameters
 *     (`recipe_book`, `read_recipe_books`) resolve strictly within the
 *     Principal's arrays.
 *   - No caching, and every value is a bound parameter.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { membershipOf } from "./membership-sql";

/** Runs on the root connection or inside a transaction. */
type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

/**
 * An authenticated API key and what it may touch right now.
 *
 * The three scope fields are EFFECTIVE scope (see the file header). Consumers
 * use them as given; none of them re-checks membership or the tombstone.
 */
export interface Principal {
  /** api_keys.id of the presenting key. */
  keyId: string;
  /** The key's owner. */
  userId: string;
  /** 'daily' | 'scoped' | 'oauth'. */
  keyType: string;
  /** oauth_clients.client_id when keyType is 'oauth'; null otherwise. */
  oauthClientId: string | null;
  /** When the presenting key expires. Only ever the caller's own key. */
  expiresAt: Date;
  /** Books the key may read now, in the order they were granted. */
  readGroupIds: string[];
  /** Books the key may write now, in the order they were granted. */
  writeGroupIds: string[];
  /**
   * The book a deposit lands in when the call names none — or null when the
   * key's stored default is not in `writeGroupIds` right now (its owner left
   * that book, or it is a disposed workspace). Null means "this key has no
   * default at the moment": a deposit that names no book is refused rather
   * than redirected to some other book the author did not choose. The stored
   * pointer is left alone, so re-joining the book restores the default.
   */
  defaultWriteGroupId: string | null;
  /**
   * Granted books the owner is still a member of whose ephemeral expiry has
   * passed and which the reaper has not yet deleted. They are in none of the
   * arrays above. This exists for exactly one consumer — the index-integrity
   * report, which tells an eval runner that a disposed workspace is still
   * physically present. Never an input to a read or write decision.
   */
  expiredReadGroupIds: string[];
}

function hashCredential(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── The shared predicates ───────────────────────────────────────────────────

/**
 * The user-state predicate: is the account that owns this credential allowed
 * to act? Written against a `claimnet.users` row aliased `u`.
 *
 * Every statement that authorizes on a credential or mints one from another
 * embeds THIS fragment — key authentication, refresh-token rotation, and
 * workspace scope binding below, plus authorization-code redemption in
 * services/oauth.service.ts — so the rule cannot drift between them (F66).
 *
 * Today the rule is a verified email (F15).
 *
 * ACCOUNT DISABLEMENT LANDS HERE, and only here: add the account-state column
 * test to this fragment (for example `AND u.<disabled column> IS NULL`) and
 * every consumer inherits it, reversibly, with no sweep over keys. Whether
 * that column is the existing `users.suspended_at` or a new one is an open
 * operator decision; until it is made this fragment deliberately does not
 * read `suspended_at`.
 */
export function activeUserPredicate(): SQL {
  return sql`u.email_verified_at IS NOT NULL`;
}

/**
 * The subset of a granted book-id array that is in effect: the owner is a
 * member of the book now, and the book is not a disposed workspace. Order is
 * preserved. Written against an `api_keys` row aliased `k`.
 *
 * "Is a member" is the module's one membership condition (membership-sql.ts),
 * so a condition later added to membership narrows every key's effective
 * scope on its next request with no change here.
 */
function effectiveBooks(grantedColumn: SQL): SQL {
  return sql`(
    SELECT COALESCE(array_agg(granted.book_id ORDER BY granted.ord), '{}'::uuid[])
    FROM unnest(${grantedColumn}) WITH ORDINALITY AS granted(book_id, ord)
    WHERE EXISTS (
        SELECT 1 FROM claimnet.group_members gm
        WHERE gm.group_id = granted.book_id AND ${membershipOf("gm", sql`k.user_id`)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.ephemeral_books eb
        WHERE eb.group_id = granted.book_id AND eb.expires_at <= NOW()
      )
  )`;
}

/** Granted read books the owner still belongs to that are past their
 *  ephemeral expiry — see `Principal.expiredReadGroupIds`. */
function expiredBooks(grantedColumn: SQL): SQL {
  return sql`(
    SELECT COALESCE(array_agg(granted.book_id ORDER BY granted.ord), '{}'::uuid[])
    FROM unnest(${grantedColumn}) WITH ORDINALITY AS granted(book_id, ord)
    WHERE EXISTS (
        SELECT 1 FROM claimnet.group_members gm
        WHERE gm.group_id = granted.book_id AND ${membershipOf("gm", sql`k.user_id`)}
      )
      AND EXISTS (
        SELECT 1 FROM claimnet.ephemeral_books eb
        WHERE eb.group_id = granted.book_id AND eb.expires_at <= NOW()
      )
  )`;
}

/** The effective-scope columns, shared by every statement that returns a
 *  credential's scope so authentication and rotation cannot disagree. */
function effectiveScopeColumns(): SQL {
  return sql`
    ${effectiveBooks(sql`k.read_group_ids`)} AS effective_read_ids,
    ${effectiveBooks(sql`k.write_group_ids`)} AS effective_write_ids,
    ${expiredBooks(sql`k.read_group_ids`)} AS expired_read_ids`;
}

interface ScopeRow {
  default_write_group_id: string;
  effective_read_ids: string[];
  effective_write_ids: string[];
  expired_read_ids: string[];
}

function effectiveDefault(row: ScopeRow): string | null {
  return row.effective_write_ids.includes(row.default_write_group_id)
    ? row.default_write_group_id
    : null;
}

// ── Authentication ──────────────────────────────────────────────────────────

export interface AuthenticateKeyOptions {
  /**
   * Accept the key only when it belongs to this user. For the one JWT route
   * that takes a raw key in its body (the dashboard's copy-briefing call): a
   * signed-in user may only present their own keys (F33). A wrong-owner key
   * is the same `null` as an unknown one.
   */
  ownerUserId?: string | undefined;
}

/**
 * Authenticate a presented API key. Returns the Principal, or null for every
 * kind of failure.
 *
 * The guards, all in the one statement:
 *   - `expires_at > NOW()` — expiry. OAuth rotation also stamps the epoch here,
 *     so a rotated-away access token dies through this same comparison.
 *   - `consumed_at IS NULL` — rotation's consumption marker, enforced
 *     independently of the expiry stamp so "consumed ⇒ dead" survives any
 *     future change to how rotation marks the row. Always NULL for daily and
 *     scoped keys.
 *   - the user-state predicate (`activeUserPredicate`).
 */
export async function authenticateKey(
  db: PostgresJsDatabase,
  rawKey: string,
  options: AuthenticateKeyOptions = {},
): Promise<Principal | null> {
  const hashedKey = hashCredential(rawKey);
  const ownerClause = options.ownerUserId
    ? sql`AND k.user_id = ${options.ownerUserId}::uuid`
    : sql``;

  const rows = await db.execute(sql`
    SELECT k.id, k.user_id, k.key_type, k.oauth_client_id, k.expires_at,
           k.default_write_group_id,
           ${effectiveScopeColumns()}
    FROM claimnet.api_keys k
    JOIN claimnet.users u ON u.id = k.user_id
    WHERE k.key = ${hashedKey}
      AND k.expires_at > NOW()
      AND k.consumed_at IS NULL
      AND ${activeUserPredicate()}
      ${ownerClause}
    LIMIT 1
  `);

  const row = (rows as unknown as Array<ScopeRow & {
    id: string;
    user_id: string;
    key_type: string;
    oauth_client_id: string | null;
    expires_at: string;
  }>)[0];
  if (!row) return null;

  // Telemetry, fire and forget. The catch is load-bearing: an untracked
  // rejection (the pool closing under an in-process caller at test or worker
  // teardown) is otherwise unhandleable and kills the process through Node's
  // default unhandled-rejection behavior — diagnosed 2026-07-17 as a vitest
  // "Worker exited unexpectedly" that only reproduced at full-suite scale.
  // Losing one last_used_at tick is acceptable; killing the caller is not.
  void db.execute(sql`
    UPDATE claimnet.api_keys SET last_used_at = NOW() WHERE key = ${hashedKey}
  `).catch((err) => {
    console.error("[authz] last_used_at update failed (non-fatal):", err);
  });

  return {
    keyId: row.id,
    userId: row.user_id,
    keyType: row.key_type,
    oauthClientId: row.oauth_client_id ?? null,
    expiresAt: new Date(row.expires_at),
    readGroupIds: row.effective_read_ids,
    writeGroupIds: row.effective_write_ids,
    defaultWriteGroupId: effectiveDefault(row),
    expiredReadGroupIds: row.expired_read_ids,
  };
}

// ── OAuth refresh-token rotation ────────────────────────────────────────────

/** What a consumed refresh token entitles the next bundle to. */
export interface ConsumedRefreshToken {
  userId: string;
  oauthClientId: string;
  /** The connection's GRANT, carried forward unchanged. Rotation does not
   *  narrow it: what the new token can actually reach is decided where every
   *  key is decided, at authentication, by intersecting the grant with the
   *  owner's memberships at that moment (F67/F50). So a book the owner has
   *  left is unreachable the instant they leave, and comes back if they are
   *  re-added, exactly as it does for a scoped or daily key. */
  readGroupIds: string[];
  writeGroupIds: string[];
  /** The stored default pointer, carried forward unchanged (the column is NOT
   *  NULL). Whether it is usable is decided at authentication, every time. */
  storedDefaultWriteGroupId: string;
}

/**
 * Atomically consume an OAuth refresh token and return what the next bundle
 * may carry, or null when the token is unknown, expired, already consumed, or
 * its owner fails the user-state predicate (F66). Run it inside the rotation
 * transaction: a caller that throws afterwards rolls the consumption back.
 *
 * Single-use by compare-and-swap (F38). The predicate is `consumed_at IS
 * NULL` — a pure NULL check. NOW() is the transaction-START timestamp and
 * lock-acquisition order is independent of timestamp order, so a predicate
 * comparing a value one transaction WROTE against another transaction's NOW()
 * can race. Under READ COMMITTED a blocked UPDATE re-evaluates this WHERE
 * after the winner commits, finds consumed_at set, matches zero rows, and the
 * loser gets null. `refresh_token_expires_at > NOW()` is safe because no
 * transaction writes that column.
 *
 * The SET stamps two columns in the one statement:
 *   consumed_at = NOW()  — the compare-and-swap marker.
 *   expires_at  = epoch  — the old ACCESS token dies with its bundle, and
 *     every liveness reader (authentication, the rate limiter's counting
 *     lookup, key lists, admin stats) inherits that through
 *     `expires_at > NOW()`. Pre-0028 code marked consumption with exactly this
 *     sentinel; writing it, and excluding epoch-stamped rows below, keeps a
 *     mixed-version deploy race-free in both directions.
 *
 * Deliberately NOT gated on `expires_at > NOW()`: that is the access token's
 * one-hour expiry, and refresh must work for the refresh token's whole life.
 *
 * A refused token is not consumed (the WHERE simply matches nothing), so an
 * owner who fails the user-state predicate today can refresh again once they
 * pass it — the reversible half of the disablement rule.
 */
export async function consumeRefreshToken(
  tx: SqlExecutor,
  refreshTokenHash: string,
): Promise<ConsumedRefreshToken | null> {
  const rows = await tx.execute(sql`
    UPDATE claimnet.api_keys AS k
    SET consumed_at = NOW(), expires_at = to_timestamp(0)
    FROM claimnet.users u
    WHERE k.refresh_token_hash = ${refreshTokenHash}
      AND k.key_type = 'oauth'
      AND k.consumed_at IS NULL
      AND k.expires_at > to_timestamp(0)
      AND k.refresh_token_expires_at > NOW()
      AND u.id = k.user_id
      AND ${activeUserPredicate()}
    RETURNING k.user_id, k.oauth_client_id, k.default_write_group_id,
              k.read_group_ids, k.write_group_ids
  `);
  const row = (rows as unknown as Array<{
    user_id: string;
    oauth_client_id: string;
    default_write_group_id: string;
    read_group_ids: string[];
    write_group_ids: string[];
  }>)[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    oauthClientId: row.oauth_client_id,
    readGroupIds: row.read_group_ids,
    writeGroupIds: row.write_group_ids,
    storedDefaultWriteGroupId: row.default_write_group_id,
  };
}

// ── Workspace scope binding ─────────────────────────────────────────────────

/**
 * Append exactly one book id to a key's own read and write grants — the only
 * statement that ever widens a key (capability self-binding, F60: the book is
 * one the same call just created, never a caller-named target). Returns false
 * when the key is no longer live or its owner fails the user-state predicate;
 * the caller rolls its transaction back so no book is left bound to a dead
 * key.
 */
export async function bindBookToKey(
  tx: SqlExecutor,
  keyId: string,
  bookId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE claimnet.api_keys AS k
    SET read_group_ids = array_append(k.read_group_ids, ${bookId}::uuid),
        write_group_ids = array_append(k.write_group_ids, ${bookId}::uuid)
    FROM claimnet.users u
    WHERE k.id = ${keyId}::uuid
      AND k.expires_at > NOW()
      AND k.consumed_at IS NULL
      AND NOT (${bookId}::uuid = ANY(k.read_group_ids))
      AND u.id = k.user_id
      AND ${activeUserPredicate()}
    RETURNING k.id
  `);
  return (rows as unknown as Array<{ id: string }>).length > 0;
}
