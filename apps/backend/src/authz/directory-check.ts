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
 *      when it changes), or, when Google is slow, refuses our credential or
 *      answers with something that isn't a record of this person (F183), only
 *      the claim's release and the connection's error, so the last status
 *      stands, no success is renewed, and the stale rule fails the member
 *      closed in time (recipe 6214370b).
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
import { checkedUnder, directoryCheckDue, directoryInactive, onDomain } from "./directory-sql";
import { domainClaimCurrentAt } from "./domain-authority";

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

export interface DirectoryCheckInput {
  organizationId: string;
  kind: "admin_consent" | "service_account";
  adminEmail: string;
  secret: string;
  member: { email: string; googleSubject: string | null };
}

export type DirectoryChecker = (input: DirectoryCheckInput) => Promise<{ answer: DirectoryAnswer; renamed: boolean }>;

/** Told once per outage, six hours in (draft 47f9620f). */
export type DirectoryWarner = (organizationId: string) => Promise<void>;

let installed: { key: Buffer; check: DirectoryChecker; warn: DirectoryWarner } | null = null;

/**
 * Install Google (the server does this at startup when
 * DIRECTORY_CREDENTIALS_KEY is set). Without it no check runs, and checked
 * members fail closed a day after their last successful check, which is why a
 * server won't start without it once any connection exists (F186).
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

const CLAIMED_COLUMNS = sql`om.id AS member_id, om.organization_id, om.directory_status AS previous_status, du.email,
      (SELECT i.subject FROM claimnet.user_identities i WHERE i.user_id = du.id AND i.provider = 'google') AS google_subject,
      dc.kind, dc.admin_email, dc.credential_ciphertext, dc.credential_iv, dc.credential_tag, dc.key_version`;

async function runCheck(db: PostgresJsDatabase, userId: string): Promise<boolean> {
  const current = installed;
  if (!current) return false;
  const claimed = (await db.execute(sql`
    UPDATE claimnet.organization_members AS om
    SET directory_check_claimed_at = NOW()
    FROM claimnet.organization_directory_connections dc, claimnet.users du
    WHERE om.user_id = ${userId}::uuid AND du.id = om.user_id
      AND ${checkedUnder()} AND ${directoryCheckDue()}
    RETURNING ${CLAIMED_COLUMNS}
  `)) as unknown as ClaimedRow[];
  const row = claimed[0];
  if (!row) return false;
  return (await askAndRecord(db, current, userId, row)) !== null;
}

/**
 * What the directory says about someone about to end the connection, asked
 * now rather than within the hour. The domain claim doesn't matter here: this
 * is the company's own directory, and a paused claim is no reason to take
 * their word for it (F185).
 *   - `not_on_domain`: the directory was never theirs to answer to;
 *   - `unanswered`: it couldn't say, and the connection last worked recently;
 *   - `unanswered_long`: it couldn't say, and the connection hasn't worked for
 *     DIRECTORY_WARNING_HOURS, so its managers have already been told.
 */
export async function askDirectoryAboutActor(
  db: PostgresJsDatabase,
  organizationId: string,
  userId: string,
): Promise<"not_on_domain" | "active" | "refused" | "unanswered" | "unanswered_long"> {
  const claimed = (await db.execute(sql`
    UPDATE claimnet.organization_members AS om
    SET directory_check_claimed_at = NOW()
    FROM claimnet.organization_directory_connections dc, claimnet.users du
    WHERE om.user_id = ${userId}::uuid AND om.organization_id = ${organizationId}::uuid AND du.id = om.user_id
      AND dc.organization_id = om.organization_id AND ${onDomain(sql`dc.domain`, sql`dc.domain_unicode`)}
    RETURNING ${CLAIMED_COLUMNS}
  `)) as unknown as ClaimedRow[];
  const row = claimed[0];
  if (!row) return "not_on_domain";
  const status = installed ? await askAndRecord(db, installed, userId, row) : null;
  if (status) return directoryStatusRefuses(status) ? "refused" : "active";
  const rows = (await db.execute(sql`
    SELECT COALESCE(last_success_at, connected_at) < NOW() - make_interval(hours => ${DIRECTORY_WARNING_HOURS}) AS long_failing
    FROM claimnet.organization_directory_connections WHERE organization_id = ${organizationId}::uuid
  `)) as unknown as Array<{ long_failing: boolean }>;
  return rows[0]?.long_failing ? "unanswered_long" : "unanswered";
}

/** Ask Google about a claimed member and record what it said. The status, or null when it couldn't say. */
async function askAndRecord(db: PostgresJsDatabase, current: NonNullable<typeof installed>, userId: string, row: ClaimedRow): Promise<DirectoryStatus | null> {
  let secret: string;
  try {
    secret = open(current.key, { ciphertext: row.credential_ciphertext, iv: row.credential_iv, tag: row.credential_tag, keyVersion: row.key_version }, row.organization_id);
  } catch {
    await recordConnectionTrouble(db, row, "decrypt_failed");
    return null;
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
    return null;
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
        last_error = ${result.renamed ? "member_renamed" : sql`last_error`},
        last_error_at = ${result.renamed ? sql`NOW()` : sql`last_error_at`}
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
  return status;
}

/**
 * Google couldn't say: hold the claim, restamped now, so this member's next
 * check waits DIRECTORY_CLAIM_SECONDS instead of every request calling Google
 * again through an outage or a revoked credential (audit F114), and record the connection's error for the admin and the operator (organization
 * id and code only, never a credential). Warn the organization once when the
 * connection has had no success for DIRECTORY_WARNING_HOURS.
 */
async function recordConnectionTrouble(db: PostgresJsDatabase, row: ClaimedRow, code: string): Promise<void> {
  await db.execute(sql`
    UPDATE claimnet.organization_members SET directory_check_claimed_at = NOW() WHERE id = ${row.member_id}::uuid
  `);
  if (code === "unreachable") {
    console.warn(`[directory] org ${row.organization_id}: Google unreachable`);
  } else {
    console.warn(`[directory] org ${row.organization_id}: connection error (${code})`);
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
  /** A short code, ours or Google's sanitized one, never text from the directory (F187). */
  lastError: string | null;
  lastErrorAt: string | null;
  /**
   * Connected, but the domain's claim isn't current (failing, stale, or
   * lapsed), so no member is checked and nobody goes stale until it is;
   * refusals already recorded hold (audit F120, F113).
   */
  checksPaused: boolean;
}

/** What an org admin may see of the connection: never the credential. */
export async function directoryConnectionOf(db: SqlExecutor, organizationId: string): Promise<DirectoryConnectionView> {
  const rows = (await db.execute(sql`
    SELECT dc.kind, dc.domain, dc.admin_email, dc.service_account_email, dc.connected_at, dc.last_success_at, dc.last_error, dc.last_error_at,
      NOT ${domainClaimCurrentAt(sql`dc.organization_id`, sql`dc.domain`)} AS checks_paused
    FROM claimnet.organization_directory_connections dc WHERE dc.organization_id = ${organizationId}::uuid
  `)) as unknown as Array<Record<string, string | null> & { checks_paused: boolean }>;
  const r = rows[0];
  if (!r) return { connected: false, kind: null, domain: null, adminEmail: null, serviceAccountEmail: null, connectedAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null, checksPaused: false };
  return {
    connected: true,
    checksPaused: r.checks_paused,
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

/** How many organizations are connected, for the startup check (F186). */
export async function directoryConnectionCount(db: SqlExecutor): Promise<number> {
  const rows = (await db.execute(sql`SELECT count(*)::int AS n FROM claimnet.organization_directory_connections`)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Does this organization have a directory connection on `domain`? For the domain emails (F120). */
export async function directoryConnectedOn(db: SqlExecutor, organizationId: string, domain: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 FROM claimnet.organization_directory_connections WHERE organization_id = ${organizationId}::uuid AND domain = ${domain}
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/** How many members each refusing status covered when a connection change cleared them, for the audit row. */
export type DirectoryStatusesCleared = Record<"suspended" | "archived" | "deleted", number>;

/**
 * Store (or replace) the organization's connection, sealing the credential
 * with the organization id as additional data. Replacing it clears every
 * member's directory status, so nobody stays switched off by the old one;
 * the refusals it cleared come back for the audit row.
 *
 * Null, storing nothing, when the person connecting is no longer an active
 * owner or admin. A consent takes minutes and a lookup seconds, and either can
 * outlast their role, which would leave a demoted person's token as the
 * company's credential (F182). Read with the write, holding their row, so a
 * demotion lands before this or after it. A manager no check has reached yet has
 * no status, and directoryInactive() is NULL for them, not false: they are often
 * the one repairing a connection that broke before their first check (F194).
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
): Promise<DirectoryStatusesCleared | null> {
  const sealed: SealedSecret = seal(key, input.secret, input.organizationId);
  return db.transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    const manager = (await tx.execute(sql`
      SELECT 1 FROM claimnet.organization_members om
      WHERE om.organization_id = ${input.organizationId}::uuid AND om.user_id = ${input.connectedBy}::uuid
        AND om.role IN ('owner', 'admin') AND om.disabled_at IS NULL AND ${directoryInactive()} IS NOT TRUE
      FOR NO KEY UPDATE OF om
    `)) as unknown as unknown[];
    if (manager.length === 0) return null;
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
    return resetMemberStatuses(tx, input.organizationId);
  });
}

/**
 * Remove the connection: checks stop, and the directory switches nobody off.
 * Says which refusals that lifted, for the audit row.
 */
export async function deleteDirectoryConnection(db: PostgresJsDatabase, organizationId: string): Promise<{ removed: boolean; cleared: DirectoryStatusesCleared }> {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const rows = (await tx.execute(sql`
      DELETE FROM claimnet.organization_directory_connections WHERE organization_id = ${organizationId}::uuid RETURNING id
    `)) as unknown as unknown[];
    const cleared = await resetMemberStatuses(tx, organizationId);
    return { removed: rows.length > 0, cleared };
  });
}

/**
 * Connection changes each update every member's row, so two at once would wait
 * on each other's rows (F195). They take the organization first, in the order
 * member changes already do (organizations.ts), and foreign keys aren't blocked.
 */
async function lockOrganization(tx: SqlExecutor, organizationId: string): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM claimnet.organizations WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`);
}

async function resetMemberStatuses(tx: SqlExecutor, organizationId: string): Promise<DirectoryStatusesCleared> {
  // The subquery reads each row's status before this statement's update.
  const rows = (await tx.execute(sql`
    UPDATE claimnet.organization_members om
    SET directory_status = NULL, directory_checked_at = NULL, directory_check_claimed_at = NULL
    FROM (SELECT id, directory_status FROM claimnet.organization_members WHERE organization_id = ${organizationId}::uuid) before
    WHERE om.id = before.id
    RETURNING before.directory_status AS was
  `)) as unknown as Array<{ was: string | null }>;
  const cleared: DirectoryStatusesCleared = { suspended: 0, archived: 0, deleted: 0 };
  for (const { was } of rows) {
    if (was === "suspended" || was === "archived" || was === "deleted") cleared[was]++;
  }
  return cleared;
}

/**
 * The member as the directory would be asked about them, when they are on this
 * domain (a domain that needn't be connected yet), for a person replacing the
 * connection with a new credential (F185).
 */
export async function directoryMemberOnDomain(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  domain: string,
  domainUnicode: string,
): Promise<{ email: string; googleSubject: string | null } | null> {
  const rows = (await db.execute(sql`
    SELECT du.email, (SELECT i.subject FROM claimnet.user_identities i WHERE i.user_id = du.id AND i.provider = 'google') AS google_subject
    FROM claimnet.organization_members om
    JOIN claimnet.users du ON du.id = om.user_id
    WHERE om.organization_id = ${organizationId}::uuid AND om.user_id = ${userId}::uuid AND ${onDomain(sql`${domain}`, sql`${domainUnicode}`)}
  `)) as unknown as Array<{ email: string; google_subject: string | null }>;
  return rows[0] ? { email: rows[0].email, googleSubject: rows[0].google_subject } : null;
}

/**
 * Owners' and admins' addresses: for the six-hour warning (OB-C8), and, leaving
 * out whoever did it, to tell them the connection was removed or replaced (F185).
 */
export async function directoryManagersOf(db: SqlExecutor, organizationId: string, exceptUserId?: string): Promise<{ name: string; emails: string[] }> {
  const rows = (await db.execute(sql`
    SELECT o.name, u.email, om.user_id FROM claimnet.organization_members om
    JOIN claimnet.users u ON u.id = om.user_id
    JOIN claimnet.organizations o ON o.id = om.organization_id
    WHERE om.organization_id = ${organizationId}::uuid AND om.role IN ('owner', 'admin') AND om.disabled_at IS NULL
  `)) as unknown as Array<{ name: string; email: string; user_id: string }>;
  return { name: rows[0]?.name ?? "", emails: rows.filter((r) => r.user_id !== exceptUserId).map((r) => r.email) };
}
