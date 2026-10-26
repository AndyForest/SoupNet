/**
 * The lazy Workspace directory check, inside credential validation
 * (organization accounts round 1, stream Offboarding; rubric
 * docs/planning/org-accounts-build/offboarding.md, OB-C1 to OB-C11).
 *
 * When a checked member's credential is presented and their directory status
 * is due (directory-sql.ts), the validation step calls `checkDirectoryIfDue`
 * before answering (recipe 3650aed9):
 *   1. claim the check with one conditional UPDATE, which only one request
 *      across every server task can win while the claim is live (a claim
 *      older than DIRECTORY_CLAIM_SECONDS can be taken over); requests that
 *      lose answer from the last status, and requests inside this process
 *      share the winner's promise;
 *   2. ask Google, outside any transaction, within DIRECTORY_TIMEOUT_MS;
 *   3. record the answer in one short statement: a status (with an audit row
 *      when it changes), or, when Google is slow or refuses our credential,
 *      only the claim's release and the connection's error, so the last
 *      status stands until the stale rule fails the member closed
 *      (recipe 6214370b).
 *
 * Google is reached through a checker the server installs at startup
 * (`installDirectoryChecker`, from services/google-directory.service.ts), so
 * this module holds the rule and no HTTP. Every statement on
 * organization_directory_connections and every directory write to
 * organization_members lives here.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DIRECTORY_WARNING_HOURS, directoryStatusRefuses } from "@soupnet/domain";
import type { DirectoryAnswer, DirectoryStatus } from "@soupnet/domain";
import { open, seal } from "../lib/secret-box";
import type { SealedSecret } from "../lib/secret-box";
import { checkedUnder, directoryCheckDue } from "./directory-sql";

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

export interface DirectoryCheckInput {
  organizationId: string;
  kind: "admin_consent" | "service_account";
  adminEmail: string;
  secret: string;
  member: { email: string; googleSubject: string | null };
}

export type DirectoryChecker = (input: DirectoryCheckInput) => Promise<{ answer: DirectoryAnswer; renamedTo: string | null }>;

/** Told once per outage, six hours in (draft 47f9620f). */
export type DirectoryWarner = (organizationId: string) => Promise<void>;

let installed: { key: Buffer; check: DirectoryChecker; warn: DirectoryWarner } | null = null;

/**
 * Install Google (the server does this at startup when
 * DIRECTORY_CREDENTIALS_KEY is set). Without it no check runs, and checked
 * members fail closed a day after their last successful check.
 */
export function installDirectoryChecker(key: Buffer, check: DirectoryChecker, warn: DirectoryWarner): void {
  installed = { key, check, warn };
}

export function directoryCheckerInstalled(): boolean {
  return installed !== null;
}

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Run the member's check if it is due. Resolves to true when a status was
 * recorded (the caller then judges the credential again), false otherwise.
 * Never throws: a failure here must not become a different answer than the
 * last status gives.
 */
export function checkDirectoryIfDue(db: PostgresJsDatabase, userId: string): Promise<boolean> {
  if (!installed) return Promise.resolve(false);
  const running = inFlight.get(userId);
  if (running) return running;
  const run = runCheck(db, userId)
    .catch((err: unknown) => {
      console.error("[directory] check failed:", err instanceof Error ? err.name : "error");
      return false;
    })
    .finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

interface ClaimedRow {
  member_id: string;
  organization_id: string;
  previous_status: DirectoryStatus | null;
  email: string;
  google_subject: string | null;
  kind: "admin_consent" | "service_account";
  admin_email: string;
  credential_ciphertext: string;
  credential_iv: string;
  credential_tag: string;
  key_version: number;
}

async function runCheck(db: PostgresJsDatabase, userId: string): Promise<boolean> {
  const current = installed;
  if (!current) return false;
  const claimed = (await db.execute(sql`
    UPDATE claimnet.organization_members AS om
    SET directory_check_claimed_at = NOW()
    FROM claimnet.organization_directory_connections dc, claimnet.users du
    WHERE om.user_id = ${userId}::uuid AND du.id = om.user_id
      AND ${checkedUnder()} AND ${directoryCheckDue()}
    RETURNING om.id AS member_id, om.organization_id, om.directory_status AS previous_status, du.email,
      (SELECT i.subject FROM claimnet.user_identities i WHERE i.user_id = du.id AND i.provider = 'google') AS google_subject,
      dc.kind, dc.admin_email, dc.credential_ciphertext, dc.credential_iv, dc.credential_tag, dc.key_version
  `)) as unknown as ClaimedRow[];
  const row = claimed[0];
  if (!row) return false;

  let secret: string;
  try {
    secret = open(current.key, { ciphertext: row.credential_ciphertext, iv: row.credential_iv, tag: row.credential_tag, keyVersion: row.key_version }, row.organization_id);
  } catch {
    await recordConnectionTrouble(db, row, "decrypt_failed");
    return false;
  }

  const result = await current.check({
    organizationId: row.organization_id,
    kind: row.kind,
    adminEmail: row.admin_email,
    secret,
    member: { email: row.email, googleSubject: row.google_subject },
  });

  if (result.answer.kind !== "status") {
    await recordConnectionTrouble(db, row, result.answer.kind === "connection_error" ? result.answer.code : "unreachable");
    return false;
  }

  const status = result.answer.status;
  await db.execute(sql`
    UPDATE claimnet.organization_members
    SET directory_status = ${status}, directory_checked_at = NOW(), directory_check_claimed_at = NULL
    WHERE id = ${row.member_id}::uuid
  `);
  await db.execute(sql`
    UPDATE claimnet.organization_directory_connections
    SET last_success_at = NOW(), warned_at = NULL,
        last_error = ${result.renamedTo ? `renamed: ${row.email} is now ${result.renamedTo} in the directory` : sql`last_error`},
        last_error_at = ${result.renamedTo ? sql`NOW()` : sql`last_error_at`}
    WHERE organization_id = ${row.organization_id}::uuid
  `);
  if (status !== row.previous_status) {
    await db.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (NULL, 'organization.member_directory_status', 'user', ${userId}::uuid,
        ${JSON.stringify({ organizationId: row.organization_id, from: row.previous_status, to: status })}::jsonb)
    `);
  }
  if (directoryStatusRefuses(status) !== directoryStatusRefuses(row.previous_status)) {
    console.warn(`[directory] org ${row.organization_id}: member ${userId} ${status}`);
  }
  return true;
}

/**
 * Google couldn't say: release the claim so the next request tries again, and
 * record the connection's error for the admin and the operator (organization
 * id and code only, never a credential). Warn the organization once when the
 * connection has had no success for DIRECTORY_WARNING_HOURS.
 */
async function recordConnectionTrouble(db: PostgresJsDatabase, row: ClaimedRow, code: string): Promise<void> {
  await db.execute(sql`
    UPDATE claimnet.organization_members SET directory_check_claimed_at = NULL WHERE id = ${row.member_id}::uuid
  `);
  if (code === "unreachable") {
    console.warn(`[directory] org ${row.organization_id}: Google unreachable`);
  } else {
    console.warn(`[directory] org ${row.organization_id}: connection refused (${code})`);
  }
  const due = (await db.execute(sql`
    UPDATE claimnet.organization_directory_connections
    SET last_error = ${code === "unreachable" ? sql`last_error` : sql`${code}`},
        last_error_at = ${code === "unreachable" ? sql`last_error_at` : sql`NOW()`},
        warned_at = CASE
          WHEN warned_at IS NULL AND COALESCE(last_success_at, connected_at) < NOW() - make_interval(hours => ${DIRECTORY_WARNING_HOURS})
          THEN NOW() ELSE warned_at END
    WHERE organization_id = ${row.organization_id}::uuid
    RETURNING (warned_at = NOW()) AS warn_now
  `)) as unknown as Array<{ warn_now: boolean }>;
  if (due[0]?.warn_now) {
    void installed?.warn(row.organization_id).catch(() => undefined);
  }
}

// ── Finding whose credential is presented ────────────────────────────────────

/** The user a live OAuth refresh token belongs to, for the check before rotation. */
export async function userIdForRefreshToken(db: SqlExecutor, refreshTokenHash: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT k.user_id FROM claimnet.api_keys k
    WHERE k.refresh_token_hash = ${refreshTokenHash} AND k.key_type = 'oauth' AND k.consumed_at IS NULL
      AND k.refresh_token_expires_at > NOW()
    LIMIT 1
  `)) as unknown as Array<{ user_id: string }>;
  return rows[0]?.user_id ?? null;
}

/**
 * The owner of a presented key that validation refused, when they are due a
 * check: a member the directory switched off is re-checked on their next
 * attempt, so a restored account works again (OB-C2). Only live keys count.
 */
export async function dueUserForRefusedKey(db: SqlExecutor, hashedKey: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT k.user_id FROM claimnet.api_keys k
    JOIN claimnet.organization_members om ON om.user_id = k.user_id
    WHERE k.key = ${hashedKey} AND k.expires_at > NOW() AND k.consumed_at IS NULL AND ${directoryCheckDue()}
    LIMIT 1
  `)) as unknown as Array<{ user_id: string }>;
  return rows[0]?.user_id ?? null;
}

// ── The connection ───────────────────────────────────────────────────────────

export interface DirectoryConnectionView {
  connected: boolean;
  kind: "admin_consent" | "service_account" | null;
  domain: string | null;
  adminEmail: string | null;
  serviceAccountEmail: string | null;
  connectedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** What an org admin may see of the connection: never the credential. */
export async function directoryConnectionOf(db: SqlExecutor, organizationId: string): Promise<DirectoryConnectionView> {
  const rows = (await db.execute(sql`
    SELECT kind, domain, admin_email, service_account_email, connected_at, last_success_at, last_error, last_error_at
    FROM claimnet.organization_directory_connections WHERE organization_id = ${organizationId}::uuid
  `)) as unknown as Array<Record<string, string | null>>;
  const r = rows[0];
  if (!r) return { connected: false, kind: null, domain: null, adminEmail: null, serviceAccountEmail: null, connectedAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null };
  return {
    connected: true,
    kind: r["kind"] as "admin_consent" | "service_account",
    domain: r["domain"] ?? null,
    adminEmail: r["admin_email"] ?? null,
    serviceAccountEmail: r["service_account_email"] ?? null,
    connectedAt: r["connected_at"] ?? null,
    lastSuccessAt: r["last_success_at"] ?? null,
    lastError: r["last_error"] ?? null,
    lastErrorAt: r["last_error_at"] ?? null,
  };
}

/**
 * Store (or replace) the organization's connection, sealing the credential
 * with the organization id as additional data. Replacing it clears every
 * member's directory status, so nobody stays switched off by the old one.
 */
export async function saveDirectoryConnection(
  db: PostgresJsDatabase,
  key: Buffer,
  input: {
    organizationId: string;
    kind: "admin_consent" | "service_account";
    domain: string;
    domainUnicode: string;
    adminEmail: string;
    serviceAccountEmail: string | null;
    secret: string;
    connectedBy: string;
  },
): Promise<void> {
  const sealed: SealedSecret = seal(key, input.secret, input.organizationId);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO claimnet.organization_directory_connections
        (organization_id, kind, domain, domain_unicode, admin_email, service_account_email,
         credential_ciphertext, credential_iv, credential_tag, key_version, connected_by, connected_at, last_success_at)
      VALUES (${input.organizationId}::uuid, ${input.kind}, ${input.domain}, ${input.domainUnicode}, ${input.adminEmail},
              ${input.serviceAccountEmail}, ${sealed.ciphertext}, ${sealed.iv}, ${sealed.tag}, ${sealed.keyVersion},
              ${input.connectedBy}::uuid, NOW(), NOW())
      ON CONFLICT (organization_id) DO UPDATE SET
        kind = EXCLUDED.kind, domain = EXCLUDED.domain, domain_unicode = EXCLUDED.domain_unicode,
        admin_email = EXCLUDED.admin_email, service_account_email = EXCLUDED.service_account_email,
        credential_ciphertext = EXCLUDED.credential_ciphertext, credential_iv = EXCLUDED.credential_iv,
        credential_tag = EXCLUDED.credential_tag, key_version = EXCLUDED.key_version,
        connected_by = EXCLUDED.connected_by, connected_at = NOW(), last_success_at = NOW(),
        last_error = NULL, last_error_at = NULL, warned_at = NULL
    `);
    await resetMemberStatuses(tx, input.organizationId);
  });
}

/** Remove the connection: checks stop, and the directory switches nobody off. */
export async function deleteDirectoryConnection(db: PostgresJsDatabase, organizationId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      DELETE FROM claimnet.organization_directory_connections WHERE organization_id = ${organizationId}::uuid RETURNING id
    `)) as unknown as unknown[];
    await resetMemberStatuses(tx, organizationId);
    return rows.length > 0;
  });
}

async function resetMemberStatuses(tx: SqlExecutor, organizationId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE claimnet.organization_members
    SET directory_status = NULL, directory_checked_at = NULL, directory_check_claimed_at = NULL
    WHERE organization_id = ${organizationId}::uuid
  `);
}

/** Owners' and admins' addresses, for the six-hour warning (OB-C8). */
export async function directoryManagersOf(db: SqlExecutor, organizationId: string): Promise<{ name: string; emails: string[] }> {
  const rows = (await db.execute(sql`
    SELECT o.name, u.email FROM claimnet.organization_members om
    JOIN claimnet.users u ON u.id = om.user_id
    JOIN claimnet.organizations o ON o.id = om.organization_id
    WHERE om.organization_id = ${organizationId}::uuid AND om.role IN ('owner', 'admin') AND om.disabled_at IS NULL
  `)) as unknown as Array<{ name: string; email: string }>;
  return { name: rows[0]?.name ?? "", emails: rows.map((r) => r.email) };
}
