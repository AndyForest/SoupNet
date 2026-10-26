import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// Display-history retention.
//
// session_shown records which recipes a check session has been shown (an
// opaque session token and a recipe id), and intent_shown does the same per
// declared intent, so later checks render those recipes as id stubs. Every
// reader looks back 7 days (trace.service.ts and intent.service.ts), but
// nothing deleted the rows, so the privacy policy could only have called them
// indefinite. They're now deleted 30 days after they were shown: well past
// the 7-day window, so no check renders differently. Disclosed in the privacy
// policy §8 (OpenAI plugin round, stream L, 2026-10-26).
//
// Purged opportunistically from the hot path that writes the rows, throttled
// to once per interval per container, following maybeCleanupOAuthArtifacts
// in oauth.service.ts: no scheduler to maintain, and the tables stay bounded
// as long as checks are being made at all.

export const DISPLAY_HISTORY_RETENTION_DAYS = 30;
const DISPLAY_HISTORY_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
let lastDisplayHistoryCleanupAt = 0;

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

export async function cleanupDisplayHistory(db: SqlExecutor): Promise<void> {
  await db.execute(sql`
    DELETE FROM claimnet.session_shown
    WHERE shown_at < NOW() - make_interval(days => ${DISPLAY_HISTORY_RETENTION_DAYS})
  `);
  await db.execute(sql`
    DELETE FROM claimnet.intent_shown
    WHERE shown_at < NOW() - make_interval(days => ${DISPLAY_HISTORY_RETENTION_DAYS})
  `);
}

/** Throttled fire-and-forget wrapper, called where display history is
 *  written. Cleanup failure must never block a check or a search. */
export function maybeCleanupDisplayHistory(db: SqlExecutor): void {
  const now = Date.now();
  if (now - lastDisplayHistoryCleanupAt < DISPLAY_HISTORY_CLEANUP_INTERVAL_MS) return;
  lastDisplayHistoryCleanupAt = now;
  void cleanupDisplayHistory(db).catch((err) =>
    console.error("[display-history] cleanup failed:", err),
  );
}
