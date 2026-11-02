import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Executor = Pick<PostgresJsDatabase, "execute">;

/**
 * Wait until some other connection is blocked on a lock this transaction
 * holds, so a test can force an interleaving rather than sleep and hope.
 * Test-only.
 */
export async function untilBlockedBy(db: Executor, tx: Executor): Promise<void> {
  const rows = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
  const pid = rows[0]!.pid;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`);
    if ((blocked as unknown as unknown[]).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("nothing blocked on this transaction within 10 seconds");
}
