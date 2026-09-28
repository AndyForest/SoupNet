/**
 * Who a piece of recipe content belongs to [F98].
 *
 * Evidence and references have no owner column. They belong to whoever
 * authors the recipes they hang off: evidence through `trace_evidence`, a
 * reference through `trace_references` or through the evidence it quotes
 * (`evidence_references` → `trace_evidence`). A row is someone's own only
 * when every recipe it hangs off is theirs and there is at least one; a row
 * that hangs off nobody's recipe belongs to no one.
 *
 * The rule decides which existing rows a caller may link to or reuse by id
 * (corpus import). Linking another person's row would let the caller read it
 * through their own recipe, keep it past the owner's deletion, or attach
 * quotes to the owner's published recipe, so a row that is not the caller's
 * own is treated as absent.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * The recipes an evidence row hangs off are all authored by `userId`, and
 * there is at least one. `idColumn` is SQL the calling statement writes
 * itself (for example sql`e.id`), never request input. `bool_and` over no
 * rows is NULL, so `IS TRUE` makes an unlinked row nobody's.
 */
export function evidenceOwnedBy(idColumn: SQL, userId: string): SQL {
  return sql`(
    SELECT bool_and(ot.user_id = ${userId}::uuid)
    FROM claimnet.trace_evidence ote
    JOIN claimnet.traces ot ON ot.id = ote.trace_id
    WHERE ote.evidence_id = ${idColumn}
  ) IS TRUE`;
}

/**
 * The recipes a reference hangs off, directly or through the evidence it
 * quotes, are all authored by `userId`, and there is at least one.
 */
export function referenceOwnedBy(idColumn: SQL, userId: string): SQL {
  return sql`(
    SELECT bool_and(ot.user_id = ${userId}::uuid)
    FROM (
      SELECT otr.trace_id FROM claimnet.trace_references otr
      WHERE otr.reference_id = ${idColumn}
      UNION ALL
      SELECT ote.trace_id FROM claimnet.evidence_references oer
      JOIN claimnet.trace_evidence ote ON ote.evidence_id = oer.evidence_id
      WHERE oer.reference_id = ${idColumn}
    ) paths
    JOIN claimnet.traces ot ON ot.id = paths.trace_id
  ) IS TRUE`;
}

const OWNED_CHUNK = 500;

/** The subset of `ids` that are existing evidence rows owned by `userId`. */
export async function ownedEvidenceIds(
  db: PostgresJsDatabase,
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const owned = new Set<string>();
  for (let i = 0; i < ids.length; i += OWNED_CHUNK) {
    const chunk = ids.slice(i, i + OWNED_CHUNK);
    const rows = await db.execute(sql`
      SELECT e.id FROM claimnet.evidence e
      WHERE e.id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
        AND ${evidenceOwnedBy(sql`e.id`, userId)}
    `);
    for (const r of rows as unknown as Array<{ id: string }>) owned.add(r.id);
  }
  return owned;
}

/** The subset of `ids` that are existing reference rows owned by `userId`. */
export async function ownedReferenceIds(
  db: PostgresJsDatabase,
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const owned = new Set<string>();
  for (let i = 0; i < ids.length; i += OWNED_CHUNK) {
    const chunk = ids.slice(i, i + OWNED_CHUNK);
    const rows = await db.execute(sql`
      SELECT r.id FROM claimnet.references r
      WHERE r.id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
        AND ${referenceOwnedBy(sql`r.id`, userId)}
    `);
    for (const r of rows as unknown as Array<{ id: string }>) owned.add(r.id);
  }
  return owned;
}
