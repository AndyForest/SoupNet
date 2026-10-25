/**
 * Dispatch of nearby open questions (drafts-and-triage slice 10, "drafts as
 * a bus", ruled 2026-10-25, recipe 053c9b97).
 *
 * A check or search whose neighbourhood holds a live draft the caller may
 * read (one it deposited, or one about its user) names that draft in one
 * line after the exemplars, inviting the caller to resolve it when its own
 * context settles it. The line is how a question asked by one of the
 * person's sessions reaches another working nearby.
 *
 * The lookup is its own, not a reading of the displayed exemplars (recipe
 * bff6f47b): search hides the caller's own recipes by default, so a line
 * built from results would never name a question from another of the same
 * person's sessions. It compares the caller's live drafts in the call's book
 * scope (at most OPEN_QUESTION_CANDIDATES, newest first) with the call's
 * query vector, and names the nearest one that is no less similar than the
 * least similar result shown. It never takes an exemplar slot, never touches
 * ranking (the five ranking files are not edited; S10-M3), and reads only
 * drafts the caller could already read, so its absence says nothing (S10-D4).
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { OpenQuestion } from "@soupnet/domain";
import { inBooks, traceVisibleTo, draftLive } from "../authz";
import { fetchTraceVectors, parseVector, cosineSimilarity } from "./search-pipeline";

/** Most drafts one call compares (S10-D6). */
export const OPEN_QUESTION_CANDIDATES = 200;

export interface OpenQuestionParams {
  viewerUserId: string;
  /** The call's effective read scope. */
  groupIds: readonly string[];
  /** The call's query vector; without one (a qualifier-only search) there
   *  is no neighbourhood and no line. */
  queryVectorStr: string | undefined;
  /** The similarities of the results shown; empty means no line. */
  shownSimilarities: ReadonlyArray<number | undefined>;
  /** The recipe this call just deposited, never named (S10-D2). */
  excludeTraceId?: string | undefined;
  /** A headless caller cannot resolve a draft, so it is not invited to (S10-D4). */
  headless: boolean;
}

/** The nearby open question for this call, or undefined for no line. */
export async function findOpenQuestion(db: PostgresJsDatabase, p: OpenQuestionParams): Promise<OpenQuestion | undefined> {
  if (p.headless || !p.queryVectorStr || p.groupIds.length === 0) return undefined;
  const shown = p.shownSimilarities.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (shown.length === 0) return undefined;
  const floor = Math.min(...shown);

  // The caller's own live drafts: the viewer audience holds published recipes
  // and the viewer's live drafts, and draftLive keeps only the drafts.
  const rows = await db.execute(sql`
    SELECT t.id::text AS id, t.created_at AS "createdAt"
    FROM claimnet.traces t
    WHERE ${inBooks(sql`t.group_id`, [...p.groupIds])}
      AND ${traceVisibleTo("t", { viewerUserId: p.viewerUserId })}
      AND ${draftLive("t")}
      ${p.excludeTraceId ? sql`AND t.id <> ${p.excludeTraceId}::uuid` : sql``}
    ORDER BY t.created_at DESC, t.id
    LIMIT ${OPEN_QUESTION_CANDIDATES}
  `);
  const candidates = rows as unknown as Array<{ id: string; createdAt: string | Date }>;
  if (candidates.length === 0) return undefined;

  const query = parseVector(p.queryVectorStr);
  const vectors = await fetchTraceVectors(db, candidates.map((c) => c.id));
  let best: { id: string; createdAt: string | Date; similarity: number } | undefined;
  for (const c of candidates) {
    const v = vectors.get(c.id);
    if (!v || v.length !== query.length) continue;
    const similarity = cosineSimilarity(query, v);
    if (similarity < floor) continue;
    if (!best || similarity > best.similarity) best = { ...c, similarity };
  }
  if (!best) return undefined;
  // The intent's story joins here once slice 6a links a draft to its intent,
  // and only when that intent is the caller's own (S10-D3).
  return { recipeId: best.id, askedAt: new Date(best.createdAt).toISOString() };
}
