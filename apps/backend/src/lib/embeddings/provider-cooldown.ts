/**
 * Fleet-wide backoff for an embedding model, kept in system_settings so every task
 * sees it and a restart doesn't forget it. One row per model: a model the provider
 * has stopped serving must not hold up calls to the other model.
 *
 * The sync /check path never waits on this. It only records pushback here, so a
 * 429 on a live check also pauses the rebuild that may be spending the quota.
 * See ADR-0024.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 5 * 60_000;
/** Pushback older than this no longer counts towards the exponential series. */
const ATTEMPT_RESET_MS = 10 * 60_000;

interface CooldownState {
  untilMs: number;
  attempt: number;
}

function settingKey(modelId: string): string {
  return `embeddingsCooldown:${modelId}`;
}

async function readState(db: PostgresJsDatabase, modelId: string): Promise<CooldownState | null> {
  const rows = await db.execute(sql`
    SELECT value FROM claimnet.system_settings WHERE key = ${settingKey(modelId)} LIMIT 1
  `);
  const raw = (rows as unknown as Array<{ value: string }>)[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CooldownState;
  } catch {
    return null;
  }
}

/** Milliseconds left on a model's cooldown; 0 when it may be called. */
export async function cooldownRemainingMs(db: PostgresJsDatabase, modelId: string): Promise<number> {
  const state = await readState(db, modelId);
  return state ? Math.max(0, state.untilMs - Date.now()) : 0;
}

/** Next delay for an attempt: exponential, capped, floored by the provider's own hint. */
export function backoffDelayMs(attempt: number, retryAfterMs?: number): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(exponential, retryAfterMs ?? 0);
}

/**
 * Record that the provider pushed back. Calls during an active cooldown don't bump
 * the series: a burst of in-flight jobs hitting the same limit is one event.
 * Returns the milliseconds until the model may be called again.
 */
export async function recordProviderPushback(
  db: PostgresJsDatabase,
  modelId: string,
  retryAfterMs?: number,
): Promise<number> {
  const now = Date.now();
  const state = await readState(db, modelId);
  let attempt = 1;
  if (state) {
    if (state.untilMs > now) attempt = state.attempt;
    else if (now - state.untilMs < ATTEMPT_RESET_MS) attempt = state.attempt + 1;
  }
  const delay = backoffDelayMs(attempt, retryAfterMs);
  const untilMs = Math.max(state && state.untilMs > now ? state.untilMs : 0, now + delay);
  const value = JSON.stringify({ untilMs, attempt } satisfies CooldownState);
  await db.execute(sql`
    INSERT INTO claimnet.system_settings (key, value, updated_at)
    VALUES (${settingKey(modelId)}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `);
  return untilMs - now;
}
