/**
 * Retrieval-index orphan REPAIR (eval-reset contract item b2) — the destructive
 * twin of GET /health/integrity's read-only detection. Admin-only (routes/admin
 * gate it with requireSystem); NOT an agent surface and NOT flag-gated: it only
 * ever deletes DANGLING index rows (embedding sources/chunks/vectors whose
 * backing trace/evidence is already gone), never user content, so admin-JWT +
 * an audit row is sufficient (audit F64).
 *
 * Race safety (audit F64): the sweep is one transaction of set-based deletes
 * guarded by the SAME NOT EXISTS anti-join the integrity read uses. An orphan —
 * a source whose backing trace/evidence row is absent — can only arise from a
 * raw-SQL delete or a crashed import; it cannot be produced by an in-flight
 * import (which inserts the trace BEFORE the worker ever creates its embedding
 * source) nor recreated by the worker's strategy-backfill (which inserts sources
 * only for EXISTING traces via INSERT..SELECT FROM traces FOR UPDATE). So a
 * source with no backing row will not gain one under us, and the atomic
 * NOT EXISTS delete cannot catch a row an import is about to commit.
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface IntegrityRepairBook {
  recipeBookId: string;
  slug: string;
  name: string;
  orphanedSourcesDeleted: number;
  orphanedChunksDeleted: number;
  orphanedVectorsDeleted: number;
}

export interface IntegrityRepairResult {
  books: IntegrityRepairBook[];
  summary: {
    booksRepaired: number;
    orphanedSourcesDeleted: number;
    orphanedChunksDeleted: number;
    orphanedVectorsDeleted: number;
  };
}

/**
 * Sweep every orphaned embedding source across the corpus and delete its chain
 * (vectors → chunks → strategies → source), returning per-book counts. Books
 * whose `groups` row is already gone are attributed by `embedding_sources.group_id`
 * with a null-safe placeholder name so the count is never lost.
 */
export async function repairOrphanedEmbeddings(
  db: PostgresJsDatabase,
): Promise<IntegrityRepairResult> {
  return db.transaction(async (tx) => {
    // 1. Identify orphan sources (id + attribution) under one snapshot.
    const orphanRows = await tx.execute(sql`
      SELECT es.id, es.group_id
      FROM claimnet.embedding_sources es
      WHERE (
        (es.source_type = 'trace' AND NOT EXISTS (
          SELECT 1 FROM claimnet.traces t WHERE t.id = es.source_id))
        OR
        (es.source_type = 'evidence' AND NOT EXISTS (
          SELECT 1 FROM claimnet.evidence e WHERE e.id = es.source_id))
        OR
        (es.source_type = 'reference' AND NOT EXISTS (
          SELECT 1 FROM claimnet.references r WHERE r.id = es.source_id))
      )
    `);
    const orphans = orphanRows as unknown as Array<{ id: string; group_id: string }>;
    if (orphans.length === 0) {
      return { books: [], summary: { booksRepaired: 0, orphanedSourcesDeleted: 0, orphanedChunksDeleted: 0, orphanedVectorsDeleted: 0 } };
    }

    const sourceIds = orphans.map((o) => o.id);
    const idArray = sql`ARRAY[${sql.join(sourceIds.map((i) => sql`${i}::uuid`), sql`,`)}]::uuid[]`;

    // 2. Count chunks/vectors per book BEFORE deleting (attributed by the
    //    orphan source's group_id).
    const chunkCountRows = await tx.execute(sql`
      SELECT es.group_id, COUNT(ec.id)::int AS n
      FROM claimnet.embedding_chunks ec
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
      WHERE es.id = ANY(${idArray})
      GROUP BY es.group_id
    `);
    const vectorCountRows = await tx.execute(sql`
      SELECT es.group_id, COUNT(ev.id)::int AS n
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id
      WHERE es.id = ANY(${idArray})
      GROUP BY es.group_id
    `);

    // 3. Delete the chain bottom-up for exactly these orphan source ids.
    await tx.execute(sql`
      DELETE FROM claimnet.embedding_vectors
      WHERE embedding_chunk_id IN (
        SELECT ec.id FROM claimnet.embedding_chunks ec WHERE ec.embedding_source_id = ANY(${idArray})
      )`);
    await tx.execute(sql`
      DELETE FROM claimnet.embedding_chunks WHERE embedding_source_id = ANY(${idArray})`);
    await tx.execute(sql`
      DELETE FROM claimnet.embedding_chunk_strategies WHERE embedding_source_id = ANY(${idArray})`);
    await tx.execute(sql`
      DELETE FROM claimnet.embedding_sources WHERE id = ANY(${idArray})`);

    // 4. Aggregate per book + resolve names.
    const chunkByGroup = new Map<string, number>();
    for (const r of chunkCountRows as unknown as Array<{ group_id: string; n: number }>) {
      chunkByGroup.set(r.group_id, r.n);
    }
    const vectorByGroup = new Map<string, number>();
    for (const r of vectorCountRows as unknown as Array<{ group_id: string; n: number }>) {
      vectorByGroup.set(r.group_id, r.n);
    }
    const sourceByGroup = new Map<string, number>();
    for (const o of orphans) {
      sourceByGroup.set(o.group_id, (sourceByGroup.get(o.group_id) ?? 0) + 1);
    }

    const groupIds = [...sourceByGroup.keys()];
    const nameRows = await tx.execute(sql`
      SELECT id, slug, name FROM claimnet.groups
      WHERE id = ANY(ARRAY[${sql.join(groupIds.map((g) => sql`${g}::uuid`), sql`,`)}]::uuid[])
    `);
    const nameById = new Map<string, { slug: string; name: string }>();
    for (const r of nameRows as unknown as Array<{ id: string; slug: string; name: string }>) {
      nameById.set(r.id, { slug: r.slug, name: r.name });
    }

    const books: IntegrityRepairBook[] = groupIds.map((gid) => {
      const named = nameById.get(gid);
      return {
        recipeBookId: gid,
        slug: named?.slug ?? "(book already deleted)",
        name: named?.name ?? "(book already deleted)",
        orphanedSourcesDeleted: sourceByGroup.get(gid) ?? 0,
        orphanedChunksDeleted: chunkByGroup.get(gid) ?? 0,
        orphanedVectorsDeleted: vectorByGroup.get(gid) ?? 0,
      };
    }).sort((a, b) => a.slug.localeCompare(b.slug));

    return {
      books,
      summary: {
        booksRepaired: books.length,
        orphanedSourcesDeleted: [...sourceByGroup.values()].reduce((a, b) => a + b, 0),
        orphanedChunksDeleted: [...chunkByGroup.values()].reduce((a, b) => a + b, 0),
        orphanedVectorsDeleted: [...vectorByGroup.values()].reduce((a, b) => a + b, 0),
      },
    };
  });
}
