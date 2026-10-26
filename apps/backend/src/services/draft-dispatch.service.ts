/**
 * Dispatch of nearby open questions (drafts-and-triage slice 10, "drafts as
 * a bus", ruled 2026-10-25, recipe 053c9b97).
 *
 * A check or search whose neighbourhood holds a live draft about the
 * caller's user names that draft in one line after the exemplars, inviting
 * the caller to resolve it when its own context settles it. The line is how
 * a question asked by one of the person's sessions reaches another working
 * nearby. A draft the caller's user deposited about a colleague is not
 * named: only its subject's agents can resolve it, and the ruling names
 * them as the ones who see its line (recipe c21da2d1).
 *
 * The lookup is its own, not a reading of the displayed exemplars (recipe
 * bff6f47b): search hides the caller's own recipes by default, so a line
 * built from results would never name a question from another of the same
 * person's sessions. It compares the caller's live drafts in the call's book
 * scope (at most OPEN_QUESTION_CANDIDATES, newest first) with the call's
 * query vector, and names the nearest one that is no less similar than the
 * least similar result shown and within NEARBY_BAND of the best match
 * (`pickOpenQuestion`). It never takes an exemplar slot, never touches
 * ranking (the five ranking files are not edited; S10-M3), and reads only
 * drafts the caller could already read, so its absence says nothing (S10-D4).
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { OpenQuestion } from "@soupnet/domain";
import { inBooks, traceVisibleTo, draftLiveAwaitingReviewBy } from "../authz";
import { fetchTraceVectors, parseVector, cosineSimilarity } from "./search-pipeline";

/** Most drafts one call compares (S10-D6). */
export const OPEN_QUESTION_CANDIDATES = 200;

/**
 * How far below the least similar shown result a draft may score and still
 * count as no less similar: half a percent, the precision results are shown
 * at. The pipeline's score and this cosine come from different arithmetic
 * (and a halfvec copy), so a draft identical to the call can read a hair
 * under 1.
 */
const SIMILARITY_TOLERANCE = 0.005;

/**
 * How far below the best match a draft may score and still be nearby. The
 * shown results are chosen for diversity, so the least similar of them can
 * sit far from the call (the slice 10 verifier saw one at -1%); the band
 * keeps "nearby" relative to the call, the way the ranking bounds relevance
 * by a band below the top score rather than a global cutoff (ranking-config
 * `band` mode, 0.15).
 */
export const NEARBY_BAND = 0.15;

/**
 * The nearest candidate that counts as nearby, or undefined. Pure: the
 * candidates' similarities to the call, and the similarities of the results
 * shown. Nearby means no less similar than the least similar result shown,
 * and within NEARBY_BAND of the best one, each to SIMILARITY_TOLERANCE.
 */
export function pickOpenQuestion<T extends { similarity: number }>(
  candidates: readonly T[],
  shownSimilarities: ReadonlyArray<number | undefined>,
): T | undefined {
  const shown = shownSimilarities.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (shown.length === 0) return undefined;
  const floor = Math.max(Math.min(...shown), Math.max(...shown) - NEARBY_BAND) - SIMILARITY_TOLERANCE;
  let best: T | undefined;
  for (const c of candidates) {
    if (!Number.isFinite(c.similarity) || c.similarity < floor) continue;
    if (!best || c.similarity > best.similarity) best = c;
  }
  return best;
}

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
  if (!p.shownSimilarities.some((s) => typeof s === "number" && Number.isFinite(s))) return undefined;

  // The live drafts about the caller's user, in scope: one bounded statement
  // per call (the review set's partial index), and a vector fetch only when
  // it finds any (S10-D6).
  // The intent's story only when the intent is the caller's user's own
  // (S10-D3): an on-behalf draft carries its depositor's intent, whose story
  // is theirs (recipe f2ae39b8; the queue's join, slice 6a).
  const rows = await db.execute(sql`
    SELECT t.id::text AS id, t.created_at AS "createdAt", oi.story AS story
    FROM claimnet.traces t
    LEFT JOIN claimnet.intents oi ON oi.id = t.intent_id AND oi.user_id = ${p.viewerUserId}::uuid
    WHERE ${inBooks(sql`t.group_id`, [...p.groupIds])}
      AND ${traceVisibleTo("t", { viewerUserId: p.viewerUserId })}
      AND ${draftLiveAwaitingReviewBy("t", p.viewerUserId)}
      ${p.excludeTraceId ? sql`AND t.id <> ${p.excludeTraceId}::uuid` : sql``}
    ORDER BY t.created_at DESC, t.id
    LIMIT ${OPEN_QUESTION_CANDIDATES}
  `);
  const candidates = rows as unknown as Array<{ id: string; createdAt: string | Date; story: string | null }>;
  if (candidates.length === 0) return undefined;

  const query = parseVector(p.queryVectorStr);
  const vectors = await fetchTraceVectors(db, candidates.map((c) => c.id));
  const scored = candidates.flatMap((c) => {
    const v = vectors.get(c.id);
    return v && v.length === query.length ? [{ ...c, similarity: cosineSimilarity(query, v) }] : [];
  });
  const best = pickOpenQuestion(scored, p.shownSimilarities);
  if (!best) return undefined;
  return { recipeId: best.id, askedAt: new Date(best.createdAt).toISOString(), ...(best.story ? { story: best.story } : {}) };
}
