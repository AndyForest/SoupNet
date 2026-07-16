import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { systemSettings } from "@soupnet/db";
import {
  DEFAULT_ECHO_SUPPRESSION,
  DEFAULT_RANKING,
  RANKING_ALGORITHM_VERSION,
} from "@soupnet/domain";
import type { EchoSuppressionConfig, RankingConfig } from "@soupnet/domain";

export interface SystemSettingsMap {
  signupCap: number;
  embeddingsEnabled: boolean;
  /** Same-agent/same-session retrieval echo demotion. Global default OFF —
   *  see docs/planning/echo-suppression.md. Per-request `echo_suppress=on|off`
   *  overrides `enabled` for a single check via resolveEchoSuppression(). */
  echoSuppression: EchoSuppressionConfig;
}

const DEFAULTS: SystemSettingsMap = {
  signupCap: 0, // No self-signups until admin sets it
  embeddingsEnabled: true, // Gemini API calls enabled by default
  echoSuppression: DEFAULT_ECHO_SUPPRESSION, // enabled: false
};

export async function getSetting<K extends keyof SystemSettingsMap>(
  db: PostgresJsDatabase,
  key: K,
): Promise<SystemSettingsMap[K]> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(sql`${systemSettings.key} = ${key}`)
    .limit(1);

  const row = rows[0];
  if (!row) return DEFAULTS[key];

  return JSON.parse(row.value) as SystemSettingsMap[K];
}

export async function setSetting<K extends keyof SystemSettingsMap>(
  db: PostgresJsDatabase,
  key: K,
  value: SystemSettingsMap[K],
): Promise<void> {
  const jsonValue = JSON.stringify(value);

  // Upsert
  await db.execute(sql`
    INSERT INTO claimnet.system_settings (key, value, updated_at)
    VALUES (${key}, ${jsonValue}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${jsonValue}, updated_at = now()
  `);
}

export async function getAllSettings(
  db: PostgresJsDatabase,
): Promise<SystemSettingsMap> {
  const rows = await db.select().from(systemSettings);

  const result = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) {
      (result as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    }
  }
  return result;
}

/**
 * Resolve the effective echo-suppression config for a single check: the global
 * `echoSuppression` setting (merged over the shipped defaults so a partial
 * stored value can't drop a field), with an optional per-request override of
 * `enabled` only.
 *
 *   override "off"  → enabled forced false (skips the global read entirely —
 *                     the A/B control arm and the byte-stable path).
 *   override "on"   → enabled forced true; weights/windows come from the global
 *                     setting (or defaults).
 *   override absent → global default (ships OFF).
 */
export async function resolveEchoSuppression(
  db: PostgresJsDatabase,
  override?: "on" | "off" | undefined,
): Promise<EchoSuppressionConfig> {
  // Control arm / disabled: no need to read the setting at all.
  if (override === "off") return { ...DEFAULT_ECHO_SUPPRESSION, enabled: false };

  const stored = await getSetting(db, "echoSuppression");
  const merged: EchoSuppressionConfig = { ...DEFAULT_ECHO_SUPPRESSION, ...stored };
  if (override === "on") merged.enabled = true;
  return merged;
}

/** The resolved ranking configuration for one request, plus provenance. */
export interface ResolvedRanking {
  config: RankingConfig;
  /** Dated algorithm version of the shipped code defaults —
   *  RANKING_ALGORITHM_VERSION. Echoed in responses/audit so consumers can
   *  report which ranking served them. */
  version: string;
  /** Ephemeral per-request overrides applied on top of defaults + settings
   *  (e.g. "echo_suppress=on"). Echoed back, never persisted. */
  overrides: string[];
}

/**
 * Resolve the full ranking config for one check: versioned code defaults
 * (DEFAULT_RANKING) ← the `echoSuppression` system setting ← the per-request
 * `echo_suppress` override. Layering per recipe 8ee8e3ab — numeric knobs live
 * in the versioned code defaults; the settings table carries operational
 * switches; per-request overrides are ephemeral and echoed back.
 */
export async function resolveRankingConfig(
  db: PostgresJsDatabase,
  echoOverride?: "on" | "off" | undefined,
): Promise<ResolvedRanking> {
  const echo = await resolveEchoSuppression(db, echoOverride);
  const config: RankingConfig = { ...DEFAULT_RANKING, echo };
  return {
    config,
    version: RANKING_ALGORITHM_VERSION,
    overrides: echoOverride ? [`echo_suppress=${echoOverride}`] : [],
  };
}

/**
 * Normalize the per-request `echo_suppress` query param to a tri-state.
 * Accepts on/true/1/yes and off/false/0/no (case-insensitive); anything else
 * (including absent) → undefined = "use the global default".
 */
export function parseEchoSuppressOverride(
  raw: string | undefined,
): "on" | "off" | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1" || v === "yes") return "on";
  if (v === "off" || v === "false" || v === "0" || v === "no") return "off";
  return undefined;
}

export async function getVerifiedUserCount(db: PostgresJsDatabase): Promise<number> {
  // Waitlisted accounts don't occupy a cap slot — they're the queue FOR
  // slots. They start counting the moment the flag clears (approval or
  // auto-promotion).
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total FROM claimnet.users
    WHERE (email_verified_at IS NOT NULL OR role = 'system')
      AND waitlisted_at IS NULL
  `);
  return ((rows[0] as Record<string, unknown>)?.["total"] as number) ?? 0;
}

export interface CapCheckOptions {
  /**
   * Exclude this invitation from the pending count. Used when the holder of
   * a reservation is the one registering — their own reserved slot must not
   * be counted against them.
   */
  excludeInvitationId?: string;
}

/**
 * Pending non-bypass invitations = reservations against the cap.
 *
 * A reservation stops counting once its email belongs to a registered user
 * — otherwise an invitee who registered but hasn't yet clicked Accept on the
 * recipe-book invite would hold a phantom slot (counted once as a user AND
 * once as a pending invitation) for up to 7 days.
 */
export async function getPendingInvitationCount(
  db: PostgresJsDatabase,
  opts?: CapCheckOptions,
): Promise<number> {
  const excludeId = opts?.excludeInvitationId ?? null;
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total FROM claimnet.invitations i
    WHERE i.accepted_at IS NULL
      AND i.expires_at > now()
      AND i.bypass_cap = false
      AND (${excludeId}::uuid IS NULL OR i.id != ${excludeId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.users u WHERE u.email = i.email
      )
  `);
  return ((rows[0] as Record<string, unknown>)?.["total"] as number) ?? 0;
}

/**
 * Check if a new signup would exceed the cap.
 * Counts verified users + pending non-bypass invitations against the cap.
 */
export async function isSignupCapReached(
  db: PostgresJsDatabase,
  opts?: CapCheckOptions,
): Promise<boolean> {
  const cap = await getSetting(db, "signupCap");
  if (cap === 0) return true; // Cap of 0 means no self-signups

  const verifiedCount = await getVerifiedUserCount(db);
  const pendingCount = await getPendingInvitationCount(db, opts);

  return (verifiedCount + pendingCount) >= cap;
}

/**
 * Atomically check and consume a signup slot using an advisory lock.
 * Prevents race conditions where concurrent registrations both pass the cap check.
 * Returns true if signup is allowed (slot consumed), false if cap is actually reached.
 *
 * Uses pg_advisory_xact_lock (blocking) rather than pg_try_advisory_xact_lock
 * (non-blocking). The non-blocking variant surfaces brief contention as a
 * "waitlist" 403 — a real bug for concurrent users and the source of flaky
 * parallel-test failures (traces.test.ts and others). The blocking variant
 * preserves the no-overshoot guarantee while serializing concurrent attempts
 * for microseconds rather than failing them.
 */
export async function tryConsumeSignupSlot(
  db: PostgresJsDatabase,
  opts?: CapCheckOptions,
): Promise<boolean> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('signup_cap'))`);
  return !(await isSignupCapReached(db, opts));
}

/**
 * Decide whether a registration may proceed under the signup cap.
 *
 * Invite semantics (operator decision, 2026-06-11): a member invitation puts
 * the invitee at the TOP of the waitlist, it does not bypass it. The
 * invitation reserves a slot (counted in getPendingInvitationCount), and the
 * invitee can register only while that reservation fits within the cap —
 * their own pending invitation is excluded from the count so the reservation
 * doesn't block its own holder. When the cap is genuinely full, they wait
 * like everyone else, first in line when the cap rises.
 *
 * Admin invitations (bypassCap) skip the cap entirely — the admin-only
 * full-bypass tool.
 */
export async function mayRegister(
  db: PostgresJsDatabase,
  invitation: { id: string; bypassCap: boolean } | null,
): Promise<boolean> {
  if (invitation?.bypassCap) return true;
  if (invitation) {
    return tryConsumeSignupSlot(db, { excludeInvitationId: invitation.id });
  }
  return tryConsumeSignupSlot(db);
}
