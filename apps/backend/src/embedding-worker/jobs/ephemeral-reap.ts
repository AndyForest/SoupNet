/**
 * Ephemeral workspace reaper — runs every 5 minutes.
 *
 * The ONLY deleter in the eval-reset destructive tier: agents create
 * born-ephemeral books with a declared TTL and (optionally) expire them early;
 * the system executes that declared policy here. Physically deletes every
 * ephemeral book whose TTL has passed, through the review-confirmed
 * deleteTraceCascade (per-trace lock discipline), then tears down the book's
 * memberships/invitations/scope-bindings and the book row itself.
 *
 * Structurally safe (audit F56): the scan is FROM ephemeral_books, so it can
 * never select a book that has no birth record — a durable book is unreachable
 * from here even if its `groups` row were tampered with. Idempotent and
 * lock-safe: see services/ephemeral-workspace.service.ts reapEphemeralBook.
 *
 * Always registered (not flag-gated): when ALLOW_BENCHMARK_OPS is off, no
 * ephemeral_books rows are ever created, so the scan returns nothing at
 * near-zero cost; keeping it always-on means books created while the flag was
 * on still get reaped if the flag is later turned off (no orphaned-but-alive
 * books). See docs/planning/eval-reset-contract-response.md ("pg-boss executes").
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { reapExpiredEphemeralBooks } from "../../services/ephemeral-workspace.service";

export async function handleEphemeralReap(db: PostgresJsDatabase): Promise<void> {
  const { booksReaped, results } = await reapExpiredEphemeralBooks(db);
  if (booksReaped > 0) {
    const traces = results.reduce((n, r) => n + r.tracesDeleted, 0);
    console.warn(
      `[ephemeral-reaper] Reaped ${booksReaped} expired workspace(s), ${traces} trace(s) cascaded`,
    );
  }
}
