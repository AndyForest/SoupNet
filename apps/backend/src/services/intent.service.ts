/**
 * Declared intents — registration + join resolution (cold-start v2 Phase C).
 *
 * The self-healing contract (operator rulings 2026-08-23, recipes 363e3e0c /
 * 5c55327d; schema rationale in packages/db/src/schema/intents.ts):
 *
 *   - A value matching INTENT_ID_RE joins that intent (ownership-checked;
 *     a cross-user or unknown id resolves to notFound — uniform, no
 *     existence oracle — and the call PROCEEDS untracked, capture-only
 *     leniency like session/feedback tokens).
 *   - Any other non-empty text ALWAYS registers a brand-new intent — even
 *     byte-identical text. Never dedup: two sessions phrasing an intent
 *     identically must not merge ledgers and cross-stub each other. An agent
 *     that lost its id to compaction re-registers → fresh intent → stubs
 *     reset → full text again (the same safe semantics as omitting
 *     session_id).
 *   - Registration has its own budget COUNTed on the intents table (never
 *     audit_log — F29's hot path stays untaxed; the check_feedback budget
 *     pattern). One intent per task is the honest shape, so the caps are
 *     tight; over-budget registration degrades to an untracked call with a
 *     notice, never an error.
 *
 * The feedback path is JOIN-ONLY (recipe abddb65d posture): it never
 *  registers — see feedback.service's intent handling.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export const INTENT_ID_RE = /^int_[A-Za-z0-9]{24}$/;

/** Longest story text accepted for registration; longer degrades to
 *  untracked (stories are a paragraph, not a transcript). */
export const INTENT_STORY_MAX_CHARS = 10_000;

/** Registration budget — tight by design (see header). Env-overridable for
 *  fleets, same envCap pattern as the other agent-surface limits. */
export const INTENT_HOURLY_DEFAULT = 50;
export const INTENT_DAILY_DEFAULT = 200;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** `int_` + 24 base62 chars from CSPRNG bytes (rejection-sampled, unbiased). */
export function mintIntentId(): string {
  let out = "";
  while (out.length < 24) {
    const bytes = crypto.randomBytes(32);
    for (const b of bytes) {
      // Reject 248..255 so each accepted byte maps uniformly onto 62 chars.
      if (b < 248) {
        out += BASE62[b % 62];
        if (out.length === 24) break;
      }
    }
  }
  return `int_${out}`;
}

export interface IntentResolution {
  /** The resolved/registered id, or null when the call runs untracked. */
  intentId: string | null;
  /** True when this call registered a new intent (text was sent). */
  registered: boolean;
  /** The submitted id didn't resolve within this user's intents (unknown or
   *  not yours — deliberately indistinguishable). Call proceeds untracked. */
  notFound?: boolean;
  /** Registration budget reached; call proceeds untracked. */
  budgetExceeded?: boolean;
  /** Story text exceeded INTENT_STORY_MAX_CHARS; call proceeds untracked. */
  storyTooLong?: boolean;
}

function envCapLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve an `intent` param value for the calling user. Never throws for
 * caller mistakes; DB errors propagate (callers already wrap).
 */
export async function resolveIntent(
  db: PostgresJsDatabase,
  input: {
    value: string | undefined;
    userId: string;
    apiKeyId?: string | undefined;
    agentId?: string | undefined;
  },
): Promise<IntentResolution> {
  const value = input.value?.trim();
  if (!value) return { intentId: null, registered: false };

  if (INTENT_ID_RE.test(value)) {
    const rows = await db.execute(sql`
      UPDATE claimnet.intents
      SET last_used_at = NOW()
      WHERE id = ${value} AND user_id = ${input.userId}::uuid
      RETURNING id
    `);
    const row = (rows as unknown as Array<{ id: string }>)[0];
    if (row) return { intentId: row.id, registered: false };
    return { intentId: null, registered: false, notFound: true };
  }

  // Text → registration path. Oversized stories degrade to untracked rather
  // than erroring (the check/search/briefing they ride must never fail on an
  // intent problem).
  if (value.length > INTENT_STORY_MAX_CHARS) {
    return { intentId: null, registered: false, storyTooLong: true };
  }

  const hourly = envCapLocal("INTENT_RATE_LIMIT_HOURLY", INTENT_HOURLY_DEFAULT);
  const daily = envCapLocal("INTENT_RATE_LIMIT_DAILY", INTENT_DAILY_DEFAULT);
  const counts = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE created_at > NOW() - interval '1 hour')::int AS hourly,
      count(*) FILTER (WHERE created_at > NOW() - interval '24 hours')::int AS daily
    FROM claimnet.intents
    WHERE user_id = ${input.userId}::uuid
  `);
  const c = (counts as unknown as Array<{ hourly: number; daily: number }>)[0];
  if (c && (Number(c.hourly) >= hourly || Number(c.daily) >= daily)) {
    return { intentId: null, registered: false, budgetExceeded: true };
  }

  const id = mintIntentId();
  await db.execute(sql`
    INSERT INTO claimnet.intents (id, user_id, api_key_id, agent_id, story)
    VALUES (
      ${id},
      ${input.userId}::uuid,
      ${input.apiKeyId ? sql`${input.apiKeyId}::uuid` : sql`NULL`},
      ${input.agentId ?? null},
      ${value}
    )
  `);
  return { intentId: id, registered: true };
}

/** Delivered-recipe ids for an intent within the rendering window (7 days,
 *  mirroring the session known-set window). RENDERING ONLY — the result
 *  feeds knownIds stub rendering, never ranking. */
export async function fetchIntentShownIds(
  db: PostgresJsDatabase,
  intentId: string,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT trace_id::text AS id FROM claimnet.intent_shown
    WHERE intent_id = ${intentId}
      AND shown_at > NOW() - interval '7 days'
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/** Record delivered recipes against an intent (idempotent). Awaited by
 *  callers for the same teardown reason session_shown recording is. */
export async function recordIntentShown(
  db: PostgresJsDatabase,
  intentId: string,
  traceIds: string[],
): Promise<void> {
  if (traceIds.length === 0) return;
  await db.execute(sql`
    INSERT INTO claimnet.intent_shown (intent_id, trace_id)
    SELECT ${intentId}, unnest(ARRAY[${sql.join(traceIds.map((id) => sql`${id}::uuid`), sql`, `)}])
    ON CONFLICT DO NOTHING
  `);
}

/**
 * One echo line for responses that resolved an intent — shared by check,
 * search, and briefing surfaces so the carry-the-id protocol reads the same
 * everywhere.
 */
export function intentEchoLine(res: IntentResolution): string | null {
  if (res.intentId) {
    const verb = res.registered ? "Intent registered" : "Intent";
    return `${verb}: ${res.intentId} — pass intent: ${res.intentId} on your checks, searches, and feedback for this task (recipes already delivered to it render as id-stubs). Sub-agents pursuing their own goals should state their own intent text instead.`;
  }
  if (res.notFound) {
    return `Intent id not recognized (unknown or not yours — deliberately indistinguishable); this call was not tracked against an intent. Re-send your intent text to register a fresh one.`;
  }
  if (res.budgetExceeded) {
    return `Intent registration budget reached; this call was not tracked against an intent. Reuse an existing intent id, or retry later.`;
  }
  if (res.storyTooLong) {
    return `Intent text too long to register (${INTENT_STORY_MAX_CHARS.toLocaleString("en-US")} char max); this call was not tracked against an intent. Send a shorter story.`;
  }
  return null;
}
