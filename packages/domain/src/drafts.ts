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

// ── Drafts as a bus (slice 10) ──────────────────────────────────────────────

/**
 * How long a draft stays live (slice 10, ruled 2026-10-25, recipe 053c9b97):
 * while the intent it was deposited under was used within the last day, or,
 * with no intent, for a week from its deposit (recipe fd614c86). A headless
 * key's drafts never expire: the person's queue is their listener. Liveness
 * is computed at read time from these (authz/draft-sql.ts `draftLive`) and
 * never stored, so a draft revives when its intent is used again.
 */
export const DRAFT_INTENT_IDLE_HOURS = 24;
export const DRAFT_NO_INTENT_LIVE_DAYS = 7;

/** Why an unverified draft is expired: its intent went quiet, or it has no
 *  intent and its week is up. */
export type DraftExpiry = "intent_idle" | "age";

const EXPIRY_REASON: Record<DraftExpiry, string> = {
  intent_idle: `its task has been quiet for over ${DRAFT_INTENT_IDLE_HOURS} hours`,
  age: `it was deposited with no intent over ${DRAFT_NO_INTENT_LIVE_DAYS} days ago`,
};

/** Who resolved a draft, as its subject's agents are told (S10-R1). */
export interface DraftResolutionNote {
  /** `person`: a reaction or the queue; `agent`: one of the subject's keys
   *  other than the depositing one; `depositing_agent`: the key that
   *  deposited it. */
  by: "person" | "agent" | "depositing_agent";
  /** The resolving key's label, when it has one (the subject's own key). */
  keyLabel?: string | null | undefined;
  /** When it was resolved (ISO); rendered as the date. */
  at: string | Date;
}

function describeResolver(r: DraftResolutionNote): string {
  const who = r.by === "person"
    ? "by your user"
    : r.by === "depositing_agent"
      ? "by the agent that deposited it"
      : r.keyLabel ? `by their agent "${r.keyLabel}"` : "by one of their agents";
  return `${who} on ${isoDay(r.at)}`;
}

function isoDay(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toISOString().slice(0, 10);
}

/** The nearby open question a check or search names (S10-D1). */
export interface OpenQuestion {
  recipeId: string;
  /** The first line of the draft's intent story, only when that intent is
   *  the caller's own (S10-D3). */
  story?: string | undefined;
  /** When the draft was deposited (ISO). */
  askedAt: string;
}

/** Longest intent-story excerpt the dispatch line carries. */
export const OPEN_QUESTION_STORY_MAX = 120;

/**
 * The dispatch line (slice 10): one line after the exemplars naming a live
 * draft near this call that the caller may read, inviting it to resolve the
 * draft when its own context settles it. The wording is the ruling's.
 */
export function openQuestionLine(q: OpenQuestion): string {
  const first = (q.story ?? "").split(/\r?\n/)[0]!.trim();
  const story = first.length > OPEN_QUESTION_STORY_MAX ? `${first.slice(0, OPEN_QUESTION_STORY_MAX - 1).trimEnd()}…` : first;
  const asked = `asked ${isoDay(q.askedAt)}`;
  return `Open question near this call: ${q.recipeId} (${story ? `${story}, ` : ""}${asked}). If your context settles it, resolve it; otherwise leave it.`;
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
    /** Slice 10 (S10-R3): why an unverified draft is expired, when it is. */
    expired?: DraftExpiry | null | undefined;
    /** Slice 10 (S10-R1): how and when a resolved draft was resolved, for
     *  its subject only (S4-M3); with it, a verified draft is labelled too. */
    resolution?: DraftResolutionNote | null | undefined;
  },
): string {
  // The other party, when there is one, follows the state's name (at most
  // the email plus 15 characters, S4-Z3); a self draft's label is unchanged.
  const party = ratings?.draftDepositedBy
    ? `, deposited by ${ratings.draftDepositedBy}`
    : ratings?.draftAbout ? ` about ${ratings.draftAbout}` : "";
  const resolved = ratings?.resolution ? describeResolver(ratings.resolution) : "";
  let base: string;
  switch (state) {
    case "unverified":
      base = ratings?.expired
        ? `[expired draft${party}: ${EXPIRY_REASON[ratings.expired]}, so it has left the review queue and results; it can still be verified or rejected by id]`
        : `[unverified draft${party}: a hypothesis the person has not confirmed; visible only to them and their agents]`;
      break;
    case "verified":
      // A verified draft reads as an ordinary recipe, except to its subject's
      // agents, who can tell from this that their question was answered.
      if (!resolved) return "";
      base = `[verified draft${party}: verified ${resolved}]`;
      break;
    case "rejected":
      // Slice 6c: an agent may reject a draft on the settling context (a
      // covering recipe cited by id), so the label no longer says the
      // person said it was wrong; the rejection's evidence carries why.
      base = resolved
        ? `[rejected draft${party}: rejected ${resolved}; its evidence says why]`
        : `[rejected draft${party}: its evidence says why]`;
      break;
    case "not_chosen":
      base = resolved ? `[draft not chosen${party}: marked not chosen ${resolved}]` : `[draft not chosen${party}]`;
      break;
    default:
      return "";
  }
  const impact = ratings?.impact ?? null;
  const uncertainty = ratings?.uncertainty ?? null;
  if (impact === null && uncertainty === null) return base;
  return `${base.slice(0, -1)}; impact ${impact ?? "not rated"}, uncertainty ${uncertainty ?? "not rated"}]`;
}

// ── Agent resolution ────────────────────────────────────────────────────────

/**
 * Where an agent's resolution leaves a draft (slice 6c): the verify operation
 * takes one `outcome`, so `verify_draft` and POST /recipes/:id/verify resolve
 * a draft three ways with one contract (recipe d21d3894). The same three
 * values the review queue writes (slice 3); `verified` is the default.
 */
export const DRAFT_OUTCOMES = ["verified", "rejected", "not_chosen"] as const;
export type DraftOutcome = (typeof DRAFT_OUTCOMES)[number];

/**
 * The verify operation's `outcome` parameter. Absent, null, or empty means
 * `verified`. Unlike the triage ratings (capture-only, recipe 4cfd166e) this
 * fails closed: an unrecognized value stores nothing, since falling through
 * to the default would publish a draft the agent meant to reject.
 */
export function parseDraftOutcome(raw: unknown): { ok: true; outcome: DraftOutcome } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, outcome: "verified" };
  const text = typeof raw === "string" ? raw.trim() : "";
  const found = DRAFT_OUTCOMES.find((o) => o === text);
  if (found) return { ok: true, outcome: found };
  const echo = typeof raw === "string" ? raw : JSON.stringify(raw) ?? String(raw);
  const shown = echo.length > 40 ? `${echo.slice(0, 40)}…` : echo;
  return {
    ok: false,
    error: `outcome "${shown}" is not one of verified | rejected | not_chosen (verified when omitted); nothing was stored.`,
  };
}

export interface VerificationEvidenceEntry {
  interpretation: string;
  quote: string | null | undefined;
  source: string | null | undefined;
}

const normalizeQuote = (q: string): string => q.replace(/\s+/g, " ").trim().toLowerCase();

/** What the refusal asks for, per outcome (slice 6c, S6c-E3). "A person", not
 *  "the person": in a shared book the call may be a colleague's (recipe
 *  5d3ddfc7). */
const EVIDENCE_NEEDED: Record<DraftOutcome, string> = {
  verified:
    "Verifying a draft needs new evidence: an entry with your interpretation, then > \"a person's "
    + "answer, or the words that settle it, quoted verbatim\", then -- where they were said (a citation), "
    + "separated from other entries by a blank line.",
  rejected:
    "Rejecting a draft needs new evidence: an entry with your interpretation, then > \"a person's "
    + "answer, or the words of the verified recipe that covers the same call, quoted verbatim\", then -- "
    + "where they were said (for a recipe, -- recipe <id>), separated from other entries by a blank line.",
  not_chosen:
    "Marking a draft not chosen needs new evidence: an entry with your interpretation, then > \"the "
    + "words that settle the choice (a person's answer, or the measurement), quoted verbatim\", then -- "
    + "where they were said, separated from other entries by a blank line.",
};

/** How the evidence text was read, entry by entry (S6c-E3): the field's
 *  refusals gave no clue that a blank line had split one entry in two. */
function describeEntries(entries: readonly VerificationEvidenceEntry[]): string {
  if (entries.length === 0) return "No evidence was sent.";
  const parts = entries.slice(0, 10).map((e, i) => {
    const q = (e.quote ?? "").trim() !== "";
    const c = (e.source ?? "").trim() !== "";
    const has = q && c ? "has a quote and a citation" : q ? "has a quote but no citation" : c ? "has a citation but no quote" : "has no quote and no citation";
    return `entry ${i + 1} ${has}`;
  });
  const more = entries.length > 10 ? "; …" : "";
  return `The text was read as ${entries.length} entr${entries.length === 1 ? "y" : "ies"}: ${parts.join("; ")}${more}.`;
}

/**
 * The structural rule for an agent resolving a draft, the same for every
 * outcome (build log open question 14, ruling 46; DT-VER-05, DT-VER-06): at
 * least one evidence entry with a verbatim quote and a citation, whose quote
 * the draft does not already carry. The server cannot know the quote is the
 * person's own words or that a cited recipe covers the call; it can require
 * something new that anyone could check, and it records which key resolved
 * the draft, so the person can audit it. A cited recipe id is never looked
 * up: that would make this operation an existence oracle (S6c-E2).
 */
export function validateVerificationEvidence(
  entries: readonly VerificationEvidenceEntry[],
  existingQuotes: readonly string[],
  outcome: DraftOutcome = "verified",
): { ok: true } | { ok: false; error: string } {
  const need = EVIDENCE_NEEDED[outcome];
  const cited = entries.filter((e) => (e.quote ?? "").trim() !== "" && (e.source ?? "").trim() !== "");
  if (cited.length === 0) {
    return { ok: false, error: `${need} None of the evidence sent has both a quote and a citation. ${describeEntries(entries)}` };
  }
  const known = new Set(existingQuotes.map(normalizeQuote));
  const fresh = cited.filter((e) => !known.has(normalizeQuote(e.quote ?? "")));
  if (fresh.length === 0) {
    return {
      ok: false,
      error: `${need} Every quote sent is already on the draft, so it adds nothing new; quote what settles the question the draft left open.`,
    };
  }
  return { ok: true };
}

/**
 * The verify operation's success reply, per outcome (S6c-B4). Shared by the
 * remote tool and the stdio proxy so both say the same words.
 */
export function describeResolution(recipeId: string, outcome: DraftOutcome, evidenceAdded: number): string {
  const attached = `(${evidenceAdded} entr${evidenceAdded === 1 ? "y" : "ies"})`;
  switch (outcome) {
    case "verified":
      return `Draft ${recipeId} is verified: it is now an ordinary recipe that collaborators can find, with your new evidence attached ${attached}.`;
    case "rejected":
      return `Draft ${recipeId} is rejected: it stays private, leaves the review queue, and no longer appears in results; your evidence is attached ${attached}.`;
    case "not_chosen":
      return `Draft ${recipeId} is marked not chosen: it stays private, leaves the review queue, and no longer appears in results; your evidence is attached ${attached}.`;
  }
}

/**
 * A draft state that is carried on the wire: an unpublished draft the viewer
 * is allowed to see (unverified, rejected, not chosen). A verified draft is an
 * ordinary recipe and carries no state; an unrecognized value is never echoed.
 */
export function isShownDraftState(value: unknown): value is Exclude<DraftState, "verified"> {
  return value === "unverified" || value === "rejected" || value === "not_chosen";
}
