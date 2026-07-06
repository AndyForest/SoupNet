/**
 * Retrieval-synthesis service — the orchestration half of the premium
 * `synthesize` feature (the prompt shape + stub live in @soupnet/domain
 * synthesis.ts; the provider seam in lib/synthesis/provider.ts). See
 * docs/planning/premium-llm-features.md.
 *
 * Two responsibilities:
 *   1. Eligibility — `premiumAt IS NOT NULL && preferences.features.synthesize`.
 *      Resolved by ONE dedicated SELECT of the user row, run only when a
 *      request actually asked for synthesis (the route guards on the param),
 *      so the security-audited api-key/auth seam stays untouched and every
 *      non-synthesize request pays zero overhead (recipe 5c33168b).
 *   2. Orchestration — map the check's enriched results onto SynthesisInput,
 *      call the provider, and translate the outcome into the two mutually
 *      exclusive response fields the shared renderer understands: `synthesis`
 *      (the profile) or `synthesisNotice` (a one-line, factual hint). A
 *      non-eligible caller or an LLM hiccup yields a notice, never an error —
 *      the check itself must be byte-identical to today apart from that line.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mergeUserPreferences } from "@soupnet/domain";
import type { SynthesisInput } from "@soupnet/domain";
import type { EnrichedResult } from "./result-enricher";
import type { EvidenceSearchResult } from "./vector-search.service";
import { synthesizeProfile } from "../lib/synthesis/provider";

/** Shown when a non-premium (or flag-off) caller passes synthesize. Renders
 *  verbatim to the agent — one line, factual, no error semantics. */
export const SYNTHESIS_INELIGIBLE_NOTICE =
  "Synthesis is a premium feature — not enabled for this account.";

/** Shown when the caller IS eligible but the provider returned null (missing
 *  key, API error, timeout). Soft degradation — the check still succeeded. */
export const SYNTHESIS_UNAVAILABLE_NOTICE =
  "Synthesis unavailable for this check.";

export interface SynthesisResult {
  synthesis?: string;
  synthesisNotice?: string;
}

/**
 * Map a check's enriched results (+ related evidence) onto the pure
 * SynthesisInput the prompt builder and stub consume. Pure — no I/O.
 *
 * judgmentDate is the enriched result's `createdAt`, which the search layer
 * already coalesces to COALESCE(decided_at, created_at) (vector-search.service
 * .ts, 2026-06-10) — so backfilled recipes carry their original judgment date,
 * which is exactly the newest-wins key the synthesis resolves conflicts by.
 */
export function toSynthesisInput(
  checkedRecipe: string,
  results: EnrichedResult[],
  relatedEvidence?: EvidenceSearchResult[] | undefined,
): SynthesisInput {
  return {
    checkedRecipe,
    results: results.map((r) => ({
      id: r.id,
      recipe: r.claimText,
      judgmentDate: r.createdAt,
      evidence: r.evidence.map((e) => e.content),
    })),
    relatedEvidence: (relatedEvidence ?? []).map((e) => ({
      recipeId: e.parentTraceId,
      content: e.evidenceContent,
    })),
  };
}

/**
 * Eligibility: premium (premiumAt not null) AND the feature flag on. One SELECT
 * by userId. Returns false for an unknown user rather than throwing — a
 * missing row degrades to the ineligible notice like any other non-premium
 * caller (the check still succeeds).
 */
export async function isSynthesisEligible(
  db: PostgresJsDatabase,
  userId: string,
): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT premium_at, preferences
    FROM claimnet.users
    WHERE id = ${userId}::uuid
  `)) as unknown as Array<{ premium_at: string | null; preferences: unknown }>;

  const row = rows[0];
  if (!row) return false;
  if (row.premium_at === null || row.premium_at === undefined) return false;
  return mergeUserPreferences(row.preferences).features.synthesize;
}

export interface MaybeSynthesizeParams {
  db: PostgresJsDatabase;
  userId: string;
  /** Whether the caller actually passed synthesize (the route's param gate). */
  requested: boolean;
  checkedRecipe: string;
  results: EnrichedResult[];
  relatedEvidence?: EvidenceSearchResult[] | undefined;
}

/**
 * The single entry point both routes (web /check JSON and /mcp) share. When
 * synthesis wasn't requested, returns an empty object so the response stays
 * byte-identical to today. Otherwise gates on eligibility, calls the provider,
 * and returns exactly one of `synthesis` / `synthesisNotice`.
 */
export async function maybeSynthesize(
  params: MaybeSynthesizeParams,
): Promise<SynthesisResult> {
  if (!params.requested) return {};

  const eligible = await isSynthesisEligible(params.db, params.userId);
  if (!eligible) return { synthesisNotice: SYNTHESIS_INELIGIBLE_NOTICE };

  const input = toSynthesisInput(
    params.checkedRecipe,
    params.results,
    params.relatedEvidence,
  );
  const synthesis = await synthesizeProfile(input);
  if (synthesis === null) {
    return { synthesisNotice: SYNTHESIS_UNAVAILABLE_NOTICE };
  }
  return { synthesis };
}
