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
 *   - the key must be allowed to verify (`keyMayVerifyDrafts`): a headless
 *     key is refused before any lookup (slice 5, S5-R1; build log open
 *     question 13), so the refusal reads the same for every id (S5-U1);
 *   - the draft must be readable by id through this key (scope ∩ the draft
 *     rule, via lookupRecipes) — anything else is the uniform
 *     `not_found_or_unreadable`, byte-for-byte what get_recipes answers for a
 *     random id (DT-VER-07);
 *   - the draft's book must be in the key's effective write scope ([F78]):
 *     publishing is a write. The key can already read the recipe here, so the
 *     answer is honest rather than uniform (slice 3, S3-F1; recipes 50824e4d,
 *     507d3c9c): a published recipe is "not a draft", and the key's own draft
 *     in a book it cannot write is refused with the way forward ("needs write
 *     access to this recipe book"). Only what the key cannot read gets the
 *     uniform marker;
 *   - only the person the draft is about may resolve it; that check, and the
 *     write-authority check again, live in the resolving UPDATE itself
 *     (authz/draft-resolution.ts).
 *
 * Nothing is stored unless the draft is verified in the same transaction:
 * the state change runs first and the evidence is attached only if it
 * matched, so a refused call leaves no rows (DT-VER-05, DT-VER-08).
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { validateVerificationEvidence, onlySubjectReviewsReason, headlessVerifyRefusal } from "@soupnet/domain";
import { keyMayVerifyDrafts, resolveDraft, hasWriteAuthority } from "../authz";
import type { Principal } from "../authz";
import { parseEvidenceMarkdown } from "./evidence-parser";
import { insertEvidenceEntries } from "./trace.service";
import { lookupRecipes } from "./recipe-lookup.service";
import { draftQueueUrl } from "../lib/key-remediation";

export type VerifyDraftResult =
  | { status: "verified"; recipeId: string; draftState: "verified"; evidenceAdded: number; verifiedByDepositingKey: boolean }
  | { status: "not_found_or_unreadable"; recipeId: string }
  | { status: "ambiguous_prefix"; recipeId: string; candidates: string[] }
  | { status: "not_a_draft"; recipeId: string }
  | { status: "already_resolved"; recipeId: string; draftState: string }
  | { status: "needs_write_access"; recipeId: string; recipeBook: { slug: string; name: string } }
  | { status: "only_subject_reviews"; recipeId: string; subjectEmail: string }
  | { status: "key_cannot_verify"; recipeId: string }
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
    case "needs_write_access":
      return `${r.recipeId} is a draft in the recipe book "${r.recipeBook.name}" (${r.recipeBook.slug}), and verifying it needs write access to this recipe book, which this API key does not have; nothing was stored. Verify it with a key that can write ${r.recipeBook.slug}, or ask the person to confirm it in their review queue: ${draftQueueUrl([r.recipeId])}`;
    case "only_subject_reviews":
      return `${onlySubjectReviewsReason(r.subjectEmail, draftQueueUrl([r.recipeId]))} Nothing was stored.`;
    case "key_cannot_verify":
      return headlessVerifyRefusal(r.recipeId, draftQueueUrl([r.recipeId]));
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

  // Decided from the key alone, before anything is looked up, so the answer
  // is the same for every id apart from its echo (S5-U1).
  if (!keyMayVerifyDrafts(principal)) {
    return { status: "key_cannot_verify", recipeId };
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
  // The key can read it, so saying so leaks nothing (S3-F1).
  if (entry.draftState === undefined) return { status: "not_a_draft", recipeId: entry.recipeId };
  if (entry.draftState !== "unverified") {
    return { status: "already_resolved", recipeId: entry.recipeId, draftState: entry.draftState };
  }
  // A draft this key's person deposited about someone else (slice 4, S4-R2):
  // readable, so the refusal is honest; only the person it is about can
  // verify it, and the answer hands over their review link.
  if (entry.draftAbout) {
    return { status: "only_subject_reviews", recipeId: entry.recipeId, subjectEmail: entry.draftAbout };
  }

  // Write authority on the recipe's book ([F78]): publishing into a book is a
  // write. The key can read this draft (it is the key's own person's), so the
  // refusal names the book and the way forward instead of pretending the id
  // does not exist (S3-F1). The resolving statement checks the authority
  // again against the book the row is in at that moment.
  const authority = { kind: "key" as const, writeGroupIds: principal.writeGroupIds };
  const book = entry.recipeBook;
  if (!book) return { status: "not_found_or_unreadable", recipeId };
  const bookId = book.recipeBookId;
  if (!hasWriteAuthority(authority, bookId)) {
    return { status: "needs_write_access", recipeId: entry.recipeId, recipeBook: { slug: book.slug, name: book.name } };
  }

  const entries = parseEvidenceMarkdown(params.evidence ?? "");
  const existingQuotes = entry.evidence.flatMap((e) => e.references.map((r) => r.quote ?? "")).filter(Boolean);
  const check = validateVerificationEvidence(entries, existingQuotes);
  if (!check.ok) return { status: "refused", recipeId: entry.recipeId, error: check.error };

  // Attach everything except entries that repeat a quote the draft carries.
  const known = new Set(existingQuotes.map((q) => q.replace(/\s+/g, " ").trim().toLowerCase()));
  const fresh = entries.filter((e) => !e.quote || !known.has(e.quote.replace(/\s+/g, " ").trim().toLowerCase()));

  const outcome = await db.transaction(async (tx) => {
    // The resolving statement writes the audit row itself, in this
    // transaction, naming the previous author when a draft deposited about
    // this person becomes theirs (S4-R4).
    const resolved = await resolveDraft(tx, {
      traceId: entry.recipeId,
      actorUserId: principal.userId,
      resolution: "verified",
      byKeyId: principal.keyId,
      authority,
      auditMetadata: { via: "agent", evidenceAdded: fresh.length },
    });
    // Resolved by a concurrent call, moved out of the key's write scope
    // meanwhile, or (from slice 4) not the person it is about: nothing is
    // stored.
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
    // A concurrent resolution is reported as such; anything else is the
    // uniform answer for an id this key cannot act on.
    const [now] = await lookupRecipes(db, [entry.recipeId], { readGroupIds: principal.readGroupIds, userId: principal.userId });
    if (now?.status === "ok" && now.draftState !== "unverified") {
      return now.draftState === undefined
        ? { status: "not_a_draft", recipeId: entry.recipeId }
        : { status: "already_resolved", recipeId: entry.recipeId, draftState: now.draftState };
    }
    return { status: "not_found_or_unreadable", recipeId };
  }

  const verifiedByDepositingKey = outcome.depositingKeyId === principal.keyId;

  return { status: "verified", recipeId: entry.recipeId, draftState: "verified", evidenceAdded: fresh.length, verifiedByDepositingKey };
}
