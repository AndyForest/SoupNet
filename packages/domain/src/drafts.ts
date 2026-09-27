/**
 * Drafts (drafts-and-triage slice 2): the agent-facing copy and the pure
 * rules around depositing and verifying a draft. No I/O.
 *
 * A draft is a check deposited with `draft: true`: a thin but important
 * hypothesis about the person's taste and judgment, parked until they
 * confirm it. Until verified, only that person and their agents (and its
 * depositor) can see it. Design: docs/planning/drafts-and-triage.md; the
 * visibility rule itself lives in apps/backend/src/authz/.
 */

import type { DraftState } from "@soupnet/contracts";

const TRUE_WORDS = ["true", "1", "on", "yes"];
const FALSE_WORDS = ["false", "0", "off", "no", ""];

/**
 * The check's `draft` parameter. Booleans and the usual wire spellings
 * (HTML checkbox "on", query "1"/"true") parse as expected. An unrecognized
 * value never fails the check (capture-only leniency, recipe 4cfd166e) and
 * is taken as a draft: guessing "published" would show collaborators
 * something the agent may have meant to keep private.
 */
export function parseDraftFlag(raw: unknown): { draft: boolean; notice?: string } {
  if (raw === undefined || raw === null || raw === false) return { draft: false };
  if (raw === true) return { draft: true };
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : JSON.stringify(raw);
  if (TRUE_WORDS.includes(text)) return { draft: true };
  if (FALSE_WORDS.includes(text)) return { draft: false };
  const shown = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return {
    draft: true,
    notice: `draft "${shown}" is not true | false, so the recipe was deposited as a draft (the private choice).`,
  };
}

const VERIFY_HOW =
  "To publish it, ask the person and call verify_draft with their answer quoted and cited "
  + "(or they confirm it with still true on the recipe's page).";

/**
 * The deposit's draft notice: who can see a new draft and how it gets
 * verified, or, on an identical repeat (same key, book, and text), the state
 * the earlier recipe is still in. Undefined for an ordinary check.
 */
export function draftDepositNotice(p: {
  storedState: DraftState | string | null | undefined;
  requestedDraft: boolean;
  existing: boolean;
}): string | undefined {
  const state = p.storedState ?? null;
  if (!p.existing) {
    if (state !== "unverified") return undefined;
    return (
      "Deposited as a draft: until it is verified, only you and your own agents can see it, "
      + "labelled as a draft; it appears on no shared surface. " + VERIFY_HOW
    );
  }
  // An identical earlier check from this key already holds this text
  // (build log open question 5): its state stands, nothing new is stored.
  if (state === "unverified") {
    return (
      "An identical earlier check from this key logged this recipe as a draft, and it is still a draft: "
      + "checking it again does not verify it. " + VERIFY_HOW
    );
  }
  if (state === "rejected" || state === "not_chosen") {
    return (
      `An identical earlier check from this key logged this recipe as a draft that has since been `
      + `${state === "rejected" ? "rejected" : "marked not chosen"}; it stays private and nothing new was stored.`
    );
  }
  if (state === null && p.requestedDraft) {
    return (
      "An identical earlier check from this key already logged this recipe as a published recipe, "
      + "so it stays published; this check's draft flag was not applied."
    );
  }
  return undefined;
}

/**
 * The one-line markdown label for a recipe in a draft state the viewer may
 * see. Empty for a published recipe (no state, or verified).
 */
export function draftLabel(state: DraftState | string | null | undefined): string {
  switch (state) {
    case "unverified":
      return "[unverified draft: a hypothesis the person has not confirmed; visible only to them and their agents]";
    case "rejected":
      return "[rejected draft: the person said this is wrong]";
    case "not_chosen":
      return "[draft not chosen]";
    default:
      return "";
  }
}

// ── Agent verification ───────────────────────────────────────────────────────

export interface VerificationEvidenceEntry {
  interpretation: string;
  quote: string | null | undefined;
  source: string | null | undefined;
}

const normalizeQuote = (q: string): string => q.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The structural rule for an agent verifying a draft (build log open
 * question 14, DT-VER-05, DT-VER-06): at least one evidence entry with a
 * verbatim quote and a citation, whose quote the draft does not already
 * carry. The server cannot know the quote is the person's own words; it can
 * require something new that anyone could check, and it records which key
 * verified, so the person can audit it.
 */
export function validateVerificationEvidence(
  entries: readonly VerificationEvidenceEntry[],
  existingQuotes: readonly string[],
): { ok: true } | { ok: false; error: string } {
  const need =
    "Verifying a draft needs new evidence: an entry with your interpretation, then > \"the person's "
    + "answer, quoted verbatim\", then -- where they said it (a citation), separated from other "
    + "entries by a blank line.";
  const cited = entries.filter((e) => (e.quote ?? "").trim() !== "" && (e.source ?? "").trim() !== "");
  if (cited.length === 0) {
    return { ok: false, error: `${need} None of the evidence sent has both a quote and a citation.` };
  }
  const known = new Set(existingQuotes.map(normalizeQuote));
  const fresh = cited.filter((e) => !known.has(normalizeQuote(e.quote ?? "")));
  if (fresh.length === 0) {
    return {
      ok: false,
      error: `${need} Every quote sent is already on the draft, so it adds nothing new; quote the person's answer to the question the draft left open.`,
    };
  }
  return { ok: true };
}

/**
 * A draft state that is carried on the wire: an unpublished draft the viewer
 * is allowed to see (unverified, rejected, not chosen). A verified draft is an
 * ordinary recipe and carries no state; an unrecognized value is never echoed.
 */
export function isShownDraftState(value: unknown): value is Exclude<DraftState, "verified"> {
  return value === "unverified" || value === "rejected" || value === "not_chosen";
}
