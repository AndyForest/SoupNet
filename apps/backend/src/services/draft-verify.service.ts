/**
 * Agent verification of a draft (drafts-and-triage slice 2) — the one agent
 * operation that changes a draft's state. Served by the MCP `verify_draft`
 * tool and its REST twin, POST /recipes/:id/verify.
 *
 * The flow the design names (docs/planning/drafts-and-triage.md §Verifying a
 * draft): an agent asks its person, gets an answer, and verifies the draft
 * citing that answer. What the server enforces is structural (build log open
 * question 14): a new evidence entry with a verbatim quote and a citation that
 * the draft does not already carry (DT-VER-05, DT-VER-06). It records the
 * verifying key, so the detail page can say "verified by the depositing agent"
 * when that is what happened, and the person can audit it.
 *
 * Authority:
 *   - the key must be allowed to verify (`keyMayVerifyDrafts`; slice 5's
 *     headless keys will not be — build log open question 13);
 *   - the draft must be readable by id through this key (scope ∩ the draft
 *     rule, via lookupRecipes) — anything else is the uniform
 *     `not_found_or_unreadable`, byte-for-byte what get_recipes answers for a
 *     random id (DT-VER-07);
 *   - only the person the draft is about may resolve it; that check lives in
 *     the resolving UPDATE itself (authz/draft-resolution.ts).
 *
 * Nothing is stored unless the draft is verified in the same transaction:
 * the state change runs first and the evidence is attached only if it
 * matched, so a refused call leaves no rows (DT-VER-05, DT-VER-08).
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { validateVerificationEvidence } from "@soupnet/domain";
import { keyMayVerifyDrafts, resolveDraft } from "../authz";
import type { Principal } from "../authz";
import { parseEvidenceMarkdown } from "./evidence-parser";
import { insertEvidenceEntries } from "./trace.service";
import { lookupRecipes } from "./recipe-lookup.service";
import { writeAudit } from "./audit-log.service";

export type VerifyDraftResult =
  | { status: "verified"; recipeId: string; draftState: "verified"; evidenceAdded: number; verifiedByDepositingKey: boolean }
  | { status: "not_found_or_unreadable"; recipeId: string }
  | { status: "ambiguous_prefix"; recipeId: string; candidates: string[] }
  | { status: "not_a_draft"; recipeId: string }
  | { status: "already_resolved"; recipeId: string; draftState: string }
  | { status: "refused"; recipeId: string; error: string };

/** Human-readable text for a result — the MCP tool's reply and the REST error. */
export function describeVerifyResult(r: VerifyDraftResult): string {
  switch (r.status) {
    case "verified":
      return `Draft ${r.recipeId} is verified: it is now an ordinary recipe that collaborators can find, with your new evidence attached (${r.evidenceAdded} entr${r.evidenceAdded === 1 ? "y" : "ies"}).`;
    case "not_found_or_unreadable":
      return `${r.recipeId}: not_found_or_unreadable — this id does not exist or is not readable by this API key (the two cases are deliberately indistinguishable).`;
    case "ambiguous_prefix":
      return `${r.recipeId}: ambiguous_prefix — this short id matches more than one readable recipe (${r.candidates.join(", ")}). Use a longer prefix or the full id.`;
    case "not_a_draft":
      return `${r.recipeId} is not a draft, so there is nothing to verify; nothing was stored.`;
    case "already_resolved":
      return `${r.recipeId} was already resolved (${r.draftState}); resolution is one-way and nothing was stored.`;
    case "refused":
      return r.error;
  }
}

export async function verifyDraft(
  db: PostgresJsDatabase,
  params: { principal: Principal; recipeId: string; evidence: string },
): Promise<VerifyDraftResult> {
  const { principal } = params;
  const recipeId = params.recipeId.trim();

  if (!keyMayVerifyDrafts(principal)) {
    return { status: "refused", recipeId, error: "This API key cannot verify drafts." };
  }

  // Readable by id through this key: scope ∩ the draft rule, with the same
  // uniform marker and prefix semantics as get_recipes.
  const [entry] = await lookupRecipes(db, [recipeId], { readGroupIds: principal.readGroupIds, userId: principal.userId });
  if (!entry || entry.status === "not_found_or_unreadable") {
    return { status: "not_found_or_unreadable", recipeId };
  }
  if (entry.status === "ambiguous_prefix") {
    return { status: "ambiguous_prefix", recipeId, candidates: entry.candidates };
  }

  // A published recipe (never a draft, or already verified) carries no state.
  if (entry.draftState === undefined) return { status: "not_a_draft", recipeId: entry.recipeId };
  if (entry.draftState !== "unverified") {
    return { status: "already_resolved", recipeId: entry.recipeId, draftState: entry.draftState };
  }

  const entries = parseEvidenceMarkdown(params.evidence ?? "");
  const existingQuotes = entry.evidence.flatMap((e) => e.references.map((r) => r.quote ?? "")).filter(Boolean);
  const check = validateVerificationEvidence(entries, existingQuotes);
  if (!check.ok) return { status: "refused", recipeId: entry.recipeId, error: check.error };

  // Attach everything except entries that repeat a quote the draft carries.
  const known = new Set(existingQuotes.map((q) => q.replace(/\s+/g, " ").trim().toLowerCase()));
  const fresh = entries.filter((e) => !e.quote || !known.has(e.quote.replace(/\s+/g, " ").trim().toLowerCase()));
  const bookId = entry.recipeBook?.recipeBookId;
  if (!bookId) return { status: "not_found_or_unreadable", recipeId };

  const outcome = await db.transaction(async (tx) => {
    const resolved = await resolveDraft(tx, {
      traceId: entry.recipeId,
      actorUserId: principal.userId,
      resolution: "verified",
      byKeyId: principal.keyId,
    });
    // Not the person it is about (possible from slice 4), or resolved by a
    // concurrent call: nothing is stored.
    if (!resolved) return null;
    await insertEvidenceEntries({
      db: tx as unknown as PostgresJsDatabase,
      traceId: entry.recipeId,
      traceText: entry.recipe,
      apiKeyId: principal.keyId,
      groupId: bookId,
      entries: fresh,
      stance: "for",
    });
    return resolved;
  });

  if (!outcome) {
    return {
      status: "refused",
      recipeId: entry.recipeId,
      error: "Only the person this draft is about can verify it, through their own agents; nothing was stored.",
    };
  }

  const verifiedByDepositingKey = outcome.depositingKeyId === principal.keyId;
  await writeAudit(db, {
    actorUserId: principal.userId,
    apiKeyId: principal.keyId,
    action: "recipe.draft_verified",
    targetType: "trace",
    targetId: entry.recipeId,
    metadata: { via: "agent", evidenceAdded: fresh.length, verifiedByDepositingKey },
  });

  return { status: "verified", recipeId: entry.recipeId, draftState: "verified", evidenceAdded: fresh.length, verifiedByDepositingKey };
}
