/**
 * Verified domains for company organizations (organization accounts round 1,
 * stream Domains; rubric docs/planning/org-accounts-build/domains.md;
 * scenarios docs/product-specs/organization-domains.feature).
 *
 * The only writer of `claimnet.organization_domains` (OD-M3). The rules are
 * pure and live in @soupnet/domain (org-domains.ts); DNS is one lookup in
 * lib/dns-txt.ts; whether a join may happen on a claim's authority is
 * `domainVerifiedFor` in the authz module, which Core's join checks inside
 * its own transaction. Every join here goes through Core's
 * `joinOrganizationInTx` with a domain authority; nothing here writes a
 * membership row.
 *
 * Three ways an account joins on a domain, all behind the same switch
 * (auto_join, recipe 58eb66f7):
 *   - its verification click (`joinOnVerification`, the password path);
 *   - a Google sign-in whose hd matches (`onGoogleSignIn`, SSO's hook);
 *   - the migration of accounts already verified on the domain
 *     (`migrateDomainAccounts`, the one function every trigger calls).
 * The first two record via 'domain' (the proof step was the notice); the
 * migration records via 'migrated' and Core's notice is sent after commit.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  normalizeDomain,
  domainChallengeRecord,
  applyDomainCheck,
  domainClaimStatus,
  domainLapsesAt,
  challengeExpiresAt,
  isAddressOnDomain,
  addressDomain,
  googleHdMatches,
  domainFailingEmail,
  domainLapsedEmail,
  DOMAIN_RECHECK_HOURS,
  DOMAIN_GRACE_DAYS,
  DOMAIN_CHALLENGE_TTL_DAYS,
} from "@soupnet/domain";
import type { DomainClaimState, DomainClaimStatus, DomainCheckEvent, DomainRefusal } from "@soupnet/domain";
import { accountIsManaged, joinOrganizationInTx, orgMembersOf } from "../authz";
// Not re-exported from the authz index (Core's file); imported directly, as auth.ts does for session-state.
import { domainVerifiedFor } from "../authz/domain-authority";
import type { JoinResult } from "../authz";
import { checkDomainRecord, type TxtLookup } from "../lib/dns-txt";
import { sendJoinNotice } from "./organization.service";
import { sendOrganizationDomainEmail } from "./email.service";

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

/** How many accounts one request migrates; the daily job continues the rest (OD-X3). */
export const MIGRATION_BATCH = 200;

// ── Rows ─────────────────────────────────────────────────────────────────────

interface ClaimRow {
  id: string;
  organization_id: string;
  domain: string;
  challenge_token: string;
  token_issued_at: Date;
  verified_at: Date | null;
  last_checked_at: Date | null;
  last_found_at: Date | null;
  failing_since: Date | null;
  auto_join: boolean;
}

const CLAIM_COLUMNS = sql`id, organization_id, domain, challenge_token, token_issued_at, verified_at,
  last_checked_at, last_found_at, failing_since, auto_join`;

function toDate(v: Date | string | null): Date | null {
  return v === null ? null : v instanceof Date ? v : new Date(v);
}

function rowFrom(raw: Record<string, unknown>): ClaimRow {
  return {
    id: raw["id"] as string,
    organization_id: raw["organization_id"] as string,
    domain: raw["domain"] as string,
    challenge_token: raw["challenge_token"] as string,
    token_issued_at: toDate(raw["token_issued_at"] as Date | string)!,
    verified_at: toDate(raw["verified_at"] as Date | string | null),
    last_checked_at: toDate(raw["last_checked_at"] as Date | string | null),
    last_found_at: toDate(raw["last_found_at"] as Date | string | null),
    failing_since: toDate(raw["failing_since"] as Date | string | null),
    auto_join: raw["auto_join"] === true,
  };
}

function stateOf(row: ClaimRow): DomainClaimState {
  return {
    verifiedAt: row.verified_at,
    failingSince: row.failing_since,
    lastCheckedAt: row.last_checked_at,
    lastFoundAt: row.last_found_at,
    tokenIssuedAt: row.token_issued_at,
  };
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function audit(db: SqlExecutor, actorUserId: string | null, action: string, claim: Pick<ClaimRow, "id" | "organization_id" | "domain">, extra: Record<string, unknown> = {}): Promise<void> {
  await db.execute(sql`
    INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (${actorUserId}::uuid, ${action}, 'organization', ${claim.organization_id}::uuid,
      ${JSON.stringify({ claimId: claim.id, domain: claim.domain, ...extra })}::jsonb)
  `);
}

// ── What a console shows (OD-A2) ─────────────────────────────────────────────

export interface DomainClaimView {
  id: string;
  domain: string;
  status: DomainClaimStatus;
  recordName: string;
  recordValue: string;
  tokenExpiresAt?: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  failingSince: string | null;
  lapsesAt?: string;
  autoJoin: boolean;
  accountsAwaitingJoin?: number;
  recheckEveryHours: number;
  graceDays: number;
  challengeDays: number;
}

function viewOf(row: ClaimRow, now: Date, awaiting: number | null): DomainClaimView {
  const state = stateOf(row);
  const status = domainClaimStatus(state, now);
  const record = domainChallengeRecord(row.domain, row.challenge_token);
  const lapsesAt = domainLapsesAt(state);
  return {
    id: row.id,
    domain: row.domain,
    status,
    recordName: record.name,
    recordValue: record.value,
    ...(row.verified_at === null ? { tokenExpiresAt: challengeExpiresAt(state).toISOString() } : {}),
    verifiedAt: row.verified_at?.toISOString() ?? null,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    failingSince: row.failing_since?.toISOString() ?? null,
    ...(lapsesAt ? { lapsesAt: lapsesAt.toISOString() } : {}),
    autoJoin: row.auto_join,
    // A count, never a list, and only behind DNS proof (OD-X4).
    ...(row.verified_at !== null && awaiting !== null ? { accountsAwaitingJoin: awaiting } : {}),
    recheckEveryHours: DOMAIN_RECHECK_HOURS,
    graceDays: DOMAIN_GRACE_DAYS,
    challengeDays: DOMAIN_CHALLENGE_TTL_DAYS,
  };
}

/**
 * Accounts that a migration of `domain` would move: a verified email exactly
 * on the domain (OD-J8), in no company organization, not a site-operator
 * account. The SQL narrows by the address's domain part; addresses with
 * non-ASCII characters are fetched as well and decided by `isAddressOnDomain`,
 * which normalizes them as a claim is normalized.
 */
async function eligibleAccounts(db: SqlExecutor, domain: string, limit: number): Promise<Array<{ id: string; email: string }>> {
  const rows = (await db.execute(sql`
    SELECT u.id, u.email FROM claimnet.users u
    WHERE u.email_verified_at IS NOT NULL
      AND u.role <> 'system'
      AND NOT ${accountIsManaged(sql`u.id`)}
      AND (substring(u.email from '@([^@]*)$') = ${domain} OR u.email ~ '[^\\x01-\\x7f]')
    ORDER BY u.created_at, u.id
  `)) as unknown as Array<{ id: string; email: string }>;
  return rows.filter((r) => isAddressOnDomain(r.email, domain)).slice(0, limit);
}

export async function listDomains(db: SqlExecutor, organizationId: string, now = new Date()): Promise<DomainClaimView[]> {
  const rows = ((await db.execute(sql`
    SELECT ${CLAIM_COLUMNS} FROM claimnet.organization_domains
    WHERE organization_id = ${organizationId}::uuid
    ORDER BY created_at, id
  `)) as unknown as Array<Record<string, unknown>>).map(rowFrom);
  const views: DomainClaimView[] = [];
  for (const row of rows) {
    const awaiting = row.verified_at !== null ? (await eligibleAccounts(db, row.domain, Number.MAX_SAFE_INTEGER)).length : null;
    views.push(viewOf(row, now, awaiting));
  }
  return views;
}

async function claimOf(db: SqlExecutor, organizationId: string, claimId: string, lock = false): Promise<ClaimRow | null> {
  const rows = (await db.execute(sql`
    SELECT ${CLAIM_COLUMNS} FROM claimnet.organization_domains
    WHERE id = ${claimId}::uuid AND organization_id = ${organizationId}::uuid
    ${lock ? sql`FOR UPDATE` : sql``}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? rowFrom(rows[0]) : null;
}

// ── Adding, switching, removing ──────────────────────────────────────────────

export type AddDomainResult =
  | { ok: true; created: boolean; claim: DomainClaimView }
  | { ok: false; refusal: Exclude<DomainRefusal, "challenge_expired"> };

/**
 * Add a claim (OD-V1, OD-V2). Adding a domain the organization already holds
 * returns that claim, with a new token only if a pending one has expired. A
 * domain another organization holds verified is refused without naming it.
 * The caller has already checked that the actor manages this company
 * organization.
 */
export async function addDomain(db: PostgresJsDatabase, input: { organizationId: string; actorUserId: string; domain: unknown }, now = new Date()): Promise<AddDomainResult> {
  const normalized = normalizeDomain(input.domain);
  if (!normalized.ok) return { ok: false, refusal: normalized.refusal };
  const domain = normalized.domain;

  return db.transaction(async (tx) => {
    const taken = await tx.execute(sql`
      SELECT 1 FROM claimnet.organization_domains
      WHERE domain = ${domain} AND verified_at IS NOT NULL AND organization_id <> ${input.organizationId}::uuid
    `);
    if ((taken as unknown as unknown[]).length > 0) return { ok: false as const, refusal: "domain_taken" as const };

    const existing = ((await tx.execute(sql`
      SELECT ${CLAIM_COLUMNS} FROM claimnet.organization_domains
      WHERE organization_id = ${input.organizationId}::uuid AND domain = ${domain}
      FOR UPDATE
    `)) as unknown as Array<Record<string, unknown>>).map(rowFrom)[0];

    if (existing) {
      let row = existing;
      if (domainClaimStatus(stateOf(existing), now) === "expired") {
        const reissued = (await tx.execute(sql`
          UPDATE claimnet.organization_domains
          SET challenge_token = ${newToken()}, token_issued_at = ${now.toISOString()}::timestamptz
          WHERE id = ${existing.id}::uuid
          RETURNING ${CLAIM_COLUMNS}
        `)) as unknown as Array<Record<string, unknown>>;
        row = rowFrom(reissued[0]!);
        await audit(tx, input.actorUserId, "organization_domain.token_reissued", row);
      }
      return { ok: true as const, created: false, claim: viewOf(row, now, null) };
    }

    const inserted = (await tx.execute(sql`
      INSERT INTO claimnet.organization_domains (organization_id, domain, challenge_token, token_issued_at, added_by)
      VALUES (${input.organizationId}::uuid, ${domain}, ${newToken()}, ${now.toISOString()}::timestamptz, ${input.actorUserId}::uuid)
      RETURNING ${CLAIM_COLUMNS}
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rowFrom(inserted[0]!);
    await audit(tx, input.actorUserId, "organization_domain.added", row);
    return { ok: true as const, created: true, claim: viewOf(row, now, null) };
  });
}

export interface MigrationSummary {
  joined: number;
  awaitingSeat: number;
}

/**
 * Turn automatic joining on or off (OD-A1). Turning it on while the claim is
 * captured runs the migration and returns its counts.
 */
export async function setAutoJoin(
  db: PostgresJsDatabase,
  input: { organizationId: string; claimId: string; actorUserId: string; autoJoin: boolean },
  now = new Date(),
): Promise<{ ok: true; claim: DomainClaimView; migration?: MigrationSummary } | { ok: false; refusal: "not_found" }> {
  const changed = await db.transaction(async (tx) => {
    const row = await claimOf(tx, input.organizationId, input.claimId, true);
    if (!row) return null;
    if (row.auto_join !== input.autoJoin) {
      await tx.execute(sql`UPDATE claimnet.organization_domains SET auto_join = ${input.autoJoin} WHERE id = ${row.id}::uuid`);
      await audit(tx, input.actorUserId, input.autoJoin ? "organization_domain.auto_join_on" : "organization_domain.auto_join_off", row);
    }
    return { row, turnedOn: input.autoJoin && !row.auto_join };
  });
  if (!changed) return { ok: false, refusal: "not_found" };
  const migration = changed.turnedOn ? await migrateDomainAccounts(db, changed.row.id) : undefined;
  const fresh = (await claimOf(db, input.organizationId, input.claimId))!;
  const views = await listDomainView(db, fresh, now);
  return { ok: true, claim: views, ...(migration ? { migration } : {}) };
}

async function listDomainView(db: SqlExecutor, row: ClaimRow, now: Date): Promise<DomainClaimView> {
  const awaiting = row.verified_at !== null ? (await eligibleAccounts(db, row.domain, Number.MAX_SAFE_INTEGER)).length : null;
  return viewOf(row, now, awaiting);
}

/** Remove a claim (OD-A3). Joining stops at once; no member is touched. */
export async function deleteDomain(db: PostgresJsDatabase, input: { organizationId: string; claimId: string; actorUserId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await claimOf(tx, input.organizationId, input.claimId, true);
    if (!row) return false;
    await tx.execute(sql`DELETE FROM claimnet.organization_domains WHERE id = ${row.id}::uuid`);
    await audit(tx, input.actorUserId, "organization_domain.removed", row);
    return true;
  });
}

/** The deletion cascade's step: an organization's claims go before the organization row (their foreign key). */
export async function removeDomainsOfOrganizationsOwnedBy(tx: SqlExecutor, userId: string): Promise<void> {
  await tx.execute(sql`
    DELETE FROM claimnet.organization_domains
    WHERE organization_id IN (SELECT id FROM claimnet.organizations WHERE owner_id = ${userId}::uuid)
  `);
}

// ── Checking ─────────────────────────────────────────────────────────────────

export type CheckNowResult =
  | { ok: true; claim: DomainClaimView; event: DomainCheckEvent; recordName: string; migration?: MigrationSummary }
  | { ok: false; refusal: "not_found" | "challenge_expired" | "domain_taken" };

interface AppliedCheck {
  row: ClaimRow;
  event: DomainCheckEvent;
}

/**
 * Apply one DNS outcome to a claim under its row lock, recomputing from the
 * row as it is now, so "check now" and the job can't interleave (OD-R1).
 * Writes the audit row for every state change. A verification that collides
 * with another organization's verified claim on the same domain (the unique
 * index) is refused as domain_taken.
 */
async function applyOutcome(db: PostgresJsDatabase, claimId: string, outcome: "found" | "absent" | "error", now: Date, actorUserId: string | null): Promise<AppliedCheck | "domain_taken" | null> {
  try {
    return await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`SELECT ${CLAIM_COLUMNS} FROM claimnet.organization_domains WHERE id = ${claimId}::uuid FOR UPDATE`)) as unknown as Array<Record<string, unknown>>;
      if (!rows[0]) return null;
      const row = rowFrom(rows[0]);
      const result = applyDomainCheck(stateOf(row), outcome, now);
      if (result.event === "expired") return { row, event: result.event };
      const next = result.next;
      const updated = (await tx.execute(sql`
        UPDATE claimnet.organization_domains SET
          verified_at = ${next.verifiedAt?.toISOString() ?? null}::timestamptz,
          failing_since = ${next.failingSince?.toISOString() ?? null}::timestamptz,
          last_checked_at = ${next.lastCheckedAt?.toISOString() ?? null}::timestamptz,
          last_found_at = ${next.lastFoundAt?.toISOString() ?? null}::timestamptz,
          token_issued_at = ${next.tokenIssuedAt.toISOString()}::timestamptz
          ${result.rotateToken ? sql`, challenge_token = ${newToken()}` : sql``}
        WHERE id = ${row.id}::uuid
        RETURNING ${CLAIM_COLUMNS}
      `)) as unknown as Array<Record<string, unknown>>;
      if (["verified", "failing", "recovered", "lapsed"].includes(result.event)) {
        await audit(tx, actorUserId, `organization_domain.${result.event}`, row);
      }
      return { row: rowFrom(updated[0]!), event: result.event };
    });
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") return "domain_taken";
    throw err;
  }
}

/** After a check has committed: tell the admins, and migrate if the claim is now captured. */
async function afterCheck(db: PostgresJsDatabase, applied: AppliedCheck): Promise<MigrationSummary | undefined> {
  const { row, event } = applied;
  if (event === "failing") {
    void emailManagers(db, row.organization_id, (organizationName) =>
      domainFailingEmail({ organizationName, domain: row.domain, recordName: domainChallengeRecord(row.domain, row.challenge_token).name, lapsesAt: domainLapsesAt(stateOf(row))! }),
    );
  } else if (event === "lapsed") {
    void emailManagers(db, row.organization_id, (organizationName) => domainLapsedEmail({ organizationName, domain: row.domain }));
  }
  if ((event === "verified" || event === "recovered") && row.auto_join) return migrateDomainAccounts(db, row.id);
  return undefined;
}

/** "Check now" (OD-V3). The DNS answer itself is never returned. */
export async function checkDomainNow(
  db: PostgresJsDatabase,
  input: { organizationId: string; claimId: string; actorUserId: string },
  lookup?: TxtLookup,
  now = new Date(),
): Promise<CheckNowResult> {
  const row = await claimOf(db, input.organizationId, input.claimId);
  if (!row) return { ok: false, refusal: "not_found" };
  if (domainClaimStatus(stateOf(row), now) === "expired") return { ok: false, refusal: "challenge_expired" };
  const record = domainChallengeRecord(row.domain, row.challenge_token);
  const check = await checkDomainRecord(record, lookup ?? txtLookupFor(row.domain, db));
  const applied = await applyOutcome(db, row.id, check.outcome, now, input.actorUserId);
  if (applied === null) return { ok: false, refusal: "not_found" };
  if (applied === "domain_taken") return { ok: false, refusal: "domain_taken" };
  if (applied.event === "expired") return { ok: false, refusal: "challenge_expired" };
  const migration = await afterCheck(db, applied);
  return {
    ok: true,
    claim: await listDomainView(db, applied.row, now),
    event: applied.event,
    recordName: record.name,
    ...(migration ? { migration } : {}),
  };
}

/**
 * The daily job (OD-R1, OD-X1, OD-X3): re-check every verified claim, then
 * migrate every captured one, which continues an unfinished migration and
 * seats accounts that waited for a seat. `organizationId` narrows the run to
 * one organization (tests share a database).
 */
export async function recheckDomains(
  db: PostgresJsDatabase,
  options: { lookup?: TxtLookup; now?: Date; organizationId?: string } = {},
): Promise<{ checked: number; events: Partial<Record<DomainCheckEvent, number>>; migration: MigrationSummary }> {
  const now = options.now ?? new Date();
  const scope = options.organizationId ? sql`AND organization_id = ${options.organizationId}::uuid` : sql``;
  const claims = ((await db.execute(sql`
    SELECT ${CLAIM_COLUMNS} FROM claimnet.organization_domains WHERE verified_at IS NOT NULL ${scope} ORDER BY id
  `)) as unknown as Array<Record<string, unknown>>).map(rowFrom);
  const events: Partial<Record<DomainCheckEvent, number>> = {};
  for (const claim of claims) {
    const check = await checkDomainRecord(domainChallengeRecord(claim.domain, claim.challenge_token), options.lookup ?? txtLookupFor(claim.domain, db));
    if (check.outcome !== "found") console.warn(`[org-domains] re-check of ${claim.domain}: ${check.outcome}${check.code ? ` (${check.code})` : ""}`);
    const applied = await applyOutcome(db, claim.id, check.outcome, now, null);
    if (applied === null || applied === "domain_taken") continue;
    events[applied.event] = (events[applied.event] ?? 0) + 1;
    // The migration below covers every captured claim; afterCheck's own
    // migration would only repeat it, so send just the emails here.
    if (applied.event === "failing" || applied.event === "lapsed") await afterCheck(db, applied);
  }

  // Every verified claim: migrateDomainAccounts checks domainVerifiedFor
  // itself, so a claim that isn't captured migrates nobody.
  const verified = (await db.execute(sql`
    SELECT id FROM claimnet.organization_domains WHERE verified_at IS NOT NULL ${scope} ORDER BY id
  `)) as unknown as Array<{ id: string }>;
  const migration: MigrationSummary = { joined: 0, awaitingSeat: 0 };
  for (const { id } of verified) {
    const m = await migrateDomainAccounts(db, id);
    migration.joined += m.joined;
    migration.awaitingSeat += m.awaitingSeat;
  }
  return { checked: claims.length, events, migration };
}

// ── Joining ──────────────────────────────────────────────────────────────────

/**
 * Move every eligible account on a captured claim's domain into its
 * organization (OD-X1): the one function every trigger calls. Each account
 * is its own transaction, whose join Core refuses unless `domainVerifiedFor`
 * holds at that moment, so a claim that stops being captured mid-run stops
 * the run. One audit row per migrated account names the claim. At the seat
 * limit the rest are left as they are and counted (OD-C3).
 */
export async function migrateDomainAccounts(db: PostgresJsDatabase, claimId: string, batch = MIGRATION_BATCH): Promise<MigrationSummary> {
  const summary: MigrationSummary = { joined: 0, awaitingSeat: 0 };
  const rows = (await db.execute(sql`SELECT ${CLAIM_COLUMNS} FROM claimnet.organization_domains WHERE id = ${claimId}::uuid`)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) return summary;
  const claim = rowFrom(rows[0]);

  const precondition = (await db.execute(sql`SELECT ${domainVerifiedFor(claim.organization_id, claim.domain)} AS ok`)) as unknown as Array<{ ok: boolean }>;
  if (precondition[0]?.ok !== true) return summary;

  const accounts = await eligibleAccounts(db, claim.domain, Number.MAX_SAFE_INTEGER);
  for (const [i, account] of accounts.entries()) {
    if (i >= batch) break;
    const result = await db.transaction(async (tx) => {
      const join = await joinOrganizationInTx(tx, {
        organizationId: claim.organization_id,
        userId: account.id,
        role: "member",
        via: "migrated",
        authority: { kind: "domain", domain: claim.domain },
      });
      if (join.ok) {
        await tx.execute(sql`UPDATE claimnet.users SET waitlisted_at = NULL WHERE id = ${account.id}::uuid`);
        await audit(tx, null, "organization_domain.migrated", claim, { userId: account.id });
      }
      return join;
    });
    if (result.ok) {
      summary.joined++;
      sendJoinNotice(result);
    } else if (result.refusal === "organization_full") {
      summary.awaitingSeat = accounts.length - summary.joined;
      break;
    } else if (result.refusal === "not_authorized") {
      break;
    }
  }
  return summary;
}

export type DomainJoinOutcome =
  | { kind: "joined"; organizationName: string; join: JoinResult }
  | { kind: "full" }
  | { kind: "none" };

/**
 * Join at the proof step, inside the caller's transaction: the verification
 * click (OD-J1) or a Google sign-in (OD-J3). Via 'domain', so Core owes no
 * notice. On "full" the caller rolls its transaction back (OD-C1, OD-C2).
 */
async function joinAtProofStep(tx: SqlExecutor, userId: string, email: string): Promise<DomainJoinOutcome> {
  const domain = addressDomain(email);
  if (!domain) return { kind: "none" };
  const candidates = (await tx.execute(sql`
    SELECT d.organization_id, d.domain FROM claimnet.organization_domains d
    WHERE d.domain = ${domain} AND d.verified_at IS NOT NULL
  `)) as unknown as Array<{ organization_id: string; domain: string }>;
  const claim = candidates[0];
  if (!claim) return { kind: "none" };

  const account = (await tx.execute(sql`
    SELECT u.role, ${accountIsManaged(sql`u.id`)} AS managed FROM claimnet.users u WHERE u.id = ${userId}::uuid
  `)) as unknown as Array<{ role: string; managed: boolean }>;
  if (!account[0] || account[0].role === "system" || account[0].managed) return { kind: "none" };

  const join = await joinOrganizationInTx(tx, {
    organizationId: claim.organization_id,
    userId,
    role: "member",
    via: "domain",
    authority: { kind: "domain", domain: claim.domain },
  });
  if (join.ok) {
    await tx.execute(sql`UPDATE claimnet.users SET waitlisted_at = NULL WHERE id = ${userId}::uuid`);
    return { kind: "joined", organizationName: join.organizationName, join };
  }
  if (join.refusal === "organization_full") return { kind: "full" };
  return { kind: "none" };
}

/** The password path: called by POST /auth/verify inside the transaction that sets email_verified_at. */
export function joinOnVerification(tx: SqlExecutor, input: { userId: string; email: string }): Promise<DomainJoinOutcome> {
  return joinAtProofStep(tx, input.userId, input.email);
}

/**
 * SSO's hook (afterGoogleSignIn): joins only when `hd` equals both the
 * claimed domain and the address's domain. With no hd it does nothing; SSO
 * sends such an account our verification email instead.
 */
export async function onGoogleSignIn(tx: SqlExecutor, input: { userId: string; email: string; hd: string | null | undefined }): Promise<"joined" | "full" | "none"> {
  const domain = addressDomain(input.email);
  if (!googleHdMatches(input.hd, input.email, domain)) return "none";
  const outcome = await joinAtProofStep(tx, input.userId, input.email);
  return outcome.kind;
}

/** For the verification email and page: the organization an address would join right now, if any (OD-J1). */
export async function capturingOrganizationName(db: SqlExecutor, email: string): Promise<string | null> {
  const domain = addressDomain(email);
  if (!domain) return null;
  const rows = (await db.execute(sql`
    SELECT o.name, d.organization_id FROM claimnet.organization_domains d
    JOIN claimnet.organizations o ON o.id = d.organization_id
    WHERE d.domain = ${domain} AND d.verified_at IS NOT NULL
  `)) as unknown as Array<{ name: string; organization_id: string }>;
  const claim = rows[0];
  if (!claim) return null;
  const captured = (await db.execute(sql`SELECT ${domainVerifiedFor(claim.organization_id, domain)} AS ok`)) as unknown as Array<{ ok: boolean }>;
  return captured[0]?.ok === true ? claim.name : null;
}

// ── Mail to an organization's managers ───────────────────────────────────────

async function emailManagers(db: SqlExecutor, organizationId: string, build: (organizationName: string) => { subject: string; text: string }): Promise<void> {
  try {
    const rows = (await db.execute(sql`
      SELECT u.email, o.name FROM ${orgMembersOf(organizationId)} m
      JOIN claimnet.users u ON u.id = m.user_id
      JOIN claimnet.organizations o ON o.id = ${organizationId}::uuid
      WHERE m.role IN ('owner', 'admin') AND m.disabled_at IS NULL
    `)) as unknown as Array<{ email: string; name: string }>;
    for (const { email, name } of rows) {
      await sendOrganizationDomainEmail(email, build(name)).catch((err) => {
        console.error("[org-domains] admin email failed to send (the email_log row records it):", err);
      });
    }
  } catch (err) {
    console.error("[org-domains] could not list the organization's managers:", err);
  }
}

// ── The resolver ─────────────────────────────────────────────────────────────

/**
 * The lookup a check uses. Test mode only (ALLOW_AUTO_SETUP=true outside
 * production, the same switch that surfaces verification tokens): names under
 * the reserved `.test` TLD (RFC 6761, never in real DNS) are answered by a
 * deterministic stub so integration tests stay offline. The first label
 * decides: `dns-ok…` answers with the tokens of every claim on that domain,
 * `dns-error…` times out, anything else doesn't exist. Every other name goes
 * to the system resolver.
 */
function txtLookupFor(domain: string, db: SqlExecutor): TxtLookup | undefined {
  const testMode = process.env["ALLOW_AUTO_SETUP"] === "true" && process.env["NODE_ENV"] !== "production";
  if (!testMode || !domain.endsWith(".test")) return undefined;
  return async () => {
    if (domain.startsWith("dns-ok")) {
      const rows = (await db.execute(sql`SELECT challenge_token FROM claimnet.organization_domains WHERE domain = ${domain}`)) as unknown as Array<{ challenge_token: string }>;
      return rows.map((r) => [domainChallengeRecord(domain, r.challenge_token).value]);
    }
    if (domain.startsWith("dns-error")) throw Object.assign(new Error("ETIMEOUT"), { code: "ETIMEOUT" });
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  };
}
