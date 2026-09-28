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

/**
 * How a draft gets published. With the queue link (slice 3, rubric S3-L6),
 * the agent learns the one URL it can hand its person, in place of "on the
 * recipe's page"; without one (a caller that has no frontend URL), the old
 * wording stands.
 */
function verifyHow(queueUrl: string | undefined): string {
  return (
    "To publish it, ask the person and call verify_draft with their answer quoted and cited "
    + (queueUrl
      ? `(or they confirm it in their review queue: ${queueUrl}).`
      : "(or they confirm it with still true on the recipe's page).")
  );
}

/**
 * The deposit's draft notice: who can see a new draft and how it gets
 * verified, or, on an identical repeat (same key, book, and text), the state
 * the earlier recipe is still in. Undefined for an ordinary check.
 */
export function draftDepositNotice(p: {
  storedState: DraftState | string | null | undefined;
  requestedDraft: boolean;
  existing: boolean;
  /** The person's review queue narrowed to this recipe (`/app/drafts?ids=<id>`). */
  queueUrl?: string | undefined;
  /** Slice 4: the email of the person the stored draft is about, when it is
   *  a draft deposited on their behalf. */
  onBehalfOf?: string | undefined;
  /** This call sent a draft flag read as false that on_behalf_of (slice 4)
   *  or a headless key (slice 5) overrode. */
  draftFlagOverridden?: boolean | undefined;
  /** Slice 5: the depositing key is headless, so the draft was forced and
   *  the key cannot verify it. The on-behalf reason still wins when both
   *  apply, since it names who can review the draft. */
  headless?: boolean | undefined;
}): string | undefined {
  const state = p.storedState ?? null;
  if (p.onBehalfOf) return onBehalfNotice({ ...p, state, subject: p.onBehalfOf });
  if (p.headless && state === "unverified") return headlessNotice({ ...p, existing: p.existing });
  if (!p.existing) {
    if (state !== "unverified") return undefined;
    return (
      "Deposited as a draft: until it is verified, only you and your own agents can see it, "
      + "labelled as a draft; it appears on no shared surface. " + verifyHow(p.queueUrl)
    );
  }
  // An identical earlier check from this key already holds this text
  // (build log open question 5): its state stands, nothing new is stored.
  if (state === "unverified") {
    return (
      "An identical earlier check from this key logged this recipe as a draft, and it is still a draft: "
      + "checking it again does not verify it. " + verifyHow(p.queueUrl)
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
 * The deposit notice for a draft about someone else (slice 4, S4-L3, S4-L4):
 * why it is a draft, who can see it, who alone can confirm it, and the link
 * to hand that person. It never tells the depositor to verify it: only the
 * subject can.
 */
function onBehalfNotice(p: {
  state: string | null;
  existing: boolean;
  subject: string;
  queueUrl?: string | undefined;
  draftFlagOverridden?: boolean | undefined;
}): string | undefined {
  const link = p.queueUrl ? ` Hand them their review link: ${p.queueUrl}` : "";
  if (!p.existing) {
    if (p.state !== "unverified") return undefined;
    return (
      `Deposited as a draft about ${p.subject}, because it is on their behalf`
      + `${p.draftFlagOverridden ? " (your draft flag was overridden)" : ""}. `
      + "Until they verify it, only they and you, with your agents, can see it; only they can confirm or reject it."
      + link
    );
  }
  if (p.state === "unverified") {
    return (
      `An identical earlier check from this key logged this recipe as a draft about ${p.subject}, and it is still a draft: `
      + "checking it again does not verify it; only they can." + link
    );
  }
  return (
    `An identical earlier check from this key logged this recipe as a draft about ${p.subject} that has since been `
    + `${p.state === "rejected" ? "rejected" : "marked not chosen"}; it stays private and nothing new was stored.`
  );
}

/**
 * Where a headless key's person confirms a draft: the queue link when the
 * caller has one, else the recipe's page. Never verify_draft, which the key
 * cannot call successfully.
 */
function personConfirms(queueUrl: string | undefined): string {
  return queueUrl
    ? `hand the person their review link: ${queueUrl}`
    : "the person confirms it with still true on the recipe's page.";
}

/**
 * The deposit notice for a headless key's draft about its own person (slice 5,
 * S5-W2, S5-W4): why it is a draft (the key's setting, chosen at mint), who can
 * see it, and the link to hand the person. It never suggests verify_draft.
 */
function headlessNotice(p: { existing: boolean; queueUrl?: string | undefined; draftFlagOverridden?: boolean | undefined }): string {
  if (p.existing) {
    return (
      "An identical earlier check from this key logged this recipe as a draft, and it is still a draft: "
      + "checking it again does not verify it, and this headless key cannot; " + personConfirms(p.queueUrl)
    );
  }
  return (
    "Deposited as a draft because this API key is headless, a setting chosen when the key was made"
    + `${p.draftFlagOverridden ? " (your draft flag was overridden)" : ""}. `
    + "Until the person confirms it, only you and your own agents can see it; it appears on no shared surface. "
    + "This key cannot verify drafts; " + personConfirms(p.queueUrl)
  );
}

/**
 * The refusal when a headless key calls verify_draft or its REST twin (slice
 * 5, S5-R1). Decided from the key alone, before any lookup, so it reads the
 * same for every id apart from the echo (S5-U1). It names both ways forward:
 * the person confirms it in their queue, or an agent on an ordinary key
 * verifies it with their answer.
 */
export function headlessVerifyRefusal(recipeId: string, queueUrl: string): string {
  return (
    "This API key is headless, a setting chosen when the key was made, so it cannot verify drafts; nothing was stored. "
    + `The person can confirm ${recipeId} in their review queue: ${queueUrl} `
    + "Or an agent on one of their ordinary keys can verify it with their answer quoted and cited."
  );
}

/**
 * The refusal when `on_behalf_of` names nobody who may be named (slice 4,
 * S4-W4, S4-U1): one answer whatever the reason (no account, not a member of
 * the book, a member who cannot act, a malformed address), so it is never an
 * account-existence oracle. It names the way forward and echoes nothing.
 */
export function onBehalfRefusal(bookLabel: string): string {
  return (
    `on_behalf_of must be the email of a person who can write to the recipe book "${bookLabel}"; nothing was stored. `
    + "Name a member with write access to that book, or check without on_behalf_of to record the recipe as your own."
  );
}

/**
 * The honest refusal for the depositor of a draft about someone else who
 * tries to verify, react to, or mark it (slice 4, S4-R2, S4-Q5): she can read
 * it, so saying who reviews it leaks nothing, and the link is the one to
 * hand them.
 */
export function onlySubjectReviewsReason(subjectEmail: string | null, queueUrl?: string | undefined): string {
  const who = subjectEmail ?? "the person it is about";
  return (
    `Only ${who} can review this draft: it is about them. `
    + (queueUrl ? `Hand them their review link: ${queueUrl}` : "Ask them to confirm or reject it in their review queue.")
  );
}

/**
 * The one-line markdown label for a recipe in a draft state the viewer may
 * see. Empty for a published recipe (no state, or verified).
 *
 * Slice 3 (rubric S3-AG2, S3-Z4): the agent's triage ratings join the label
 * when at least one is set, so the person's own agents see what the queue
 * sorts by; an unrated draft's label is unchanged (silence when unrated, the
 * DT-RAT-02 ruling), and a published row never carries ratings.
 */
export function draftLabel(
  state: DraftState | string | null | undefined,
  ratings?: {
    impact?: string | null | undefined;
    uncertainty?: string | null | undefined;
    /** Slice 4 (S4-L1): on a draft about the viewer that someone else's
     *  agent deposited, the depositor's email. */
    draftDepositedBy?: string | null | undefined;
    /** Slice 4: on a draft the viewer's agent deposited about someone
     *  else, that person's email. */
    draftAbout?: string | null | undefined;
  },
): string {
  // The other party, when there is one, follows the state's name (at most
  // the email plus 15 characters, S4-Z3); a self draft's label is unchanged.
  const party = ratings?.draftDepositedBy
    ? `, deposited by ${ratings.draftDepositedBy}`
    : ratings?.draftAbout ? ` about ${ratings.draftAbout}` : "";
  let base: string;
  switch (state) {
    case "unverified":
      base = `[unverified draft${party}: a hypothesis the person has not confirmed; visible only to them and their agents]`;
      break;
    case "rejected":
      base = `[rejected draft${party}: the person said this is wrong]`;
      break;
    case "not_chosen":
      base = `[draft not chosen${party}]`;
      break;
    default:
      return "";
  }
  const impact = ratings?.impact ?? null;
  const uncertainty = ratings?.uncertainty ?? null;
  if (impact === null && uncertainty === null) return base;
  return `${base.slice(0, -1)}; impact ${impact ?? "not rated"}, uncertainty ${uncertainty ?? "not rated"}]`;
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
