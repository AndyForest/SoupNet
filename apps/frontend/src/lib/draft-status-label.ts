/**
 * The trace detail page's draft status line (drafts-and-triage slice 2).
 *
 * A draft is a hypothesis an agent parked for the person to confirm: until it
 * is verified, only the person it is about and their agents can see it. The
 * page says so, and after verification it says how: by the person with a
 * reaction, or by one of their agents with new evidence, flagged when that
 * agent is the one that deposited the draft, so the person can audit it
 * (build log open question 14). Null for a recipe that was never a draft.
 */
export interface DraftStatusLike {
  draftState?: string | null;
  draftResolvedAt?: string | null;
  draftResolvedByKeyId?: string | null;
  /** The viewer resolved it themselves ([F83]: "by you" only then). */
  draftResolvedByViewer?: boolean;
  apiKeyId?: string | null;
  /** Slice 4: on a draft about the viewer that someone else's agent
   *  deposited, that person's email. */
  draftDepositedBy?: string | null;
  /** Slice 4: on a draft the viewer's agent deposited about someone else,
   *  that person's email. */
  draftAbout?: string | null;
  /** Slice 10: why an unverified draft expired (its task went quiet), when
   *  it has. It has left the review queue and can still be resolved here. */
  draftExpiry?: "intent_idle" | "age" | null;
}

const EXPIRY_WHY: Record<"intent_idle" | "age", string> = {
  intent_idle: "The agent's task that deposited it has been quiet for over a day",
  age: "It was deposited over a week ago with no task attached",
};

/**
 * Whether the detail page shows the agent (API key) badge ([F93], S4-L2):
 * only when the key belongs to the recipe's author. A verified on-behalf
 * recipe's key is its depositor's, so it shows no key at all rather than
 * "No label set" beside someone else's key id.
 */
export function showsKeyBadge(t: { apiKeyId?: string | null; apiKeyIsAuthors?: boolean }): boolean {
  return !!t.apiKeyId && t.apiKeyIsAuthors !== false;
}

/**
 * The line naming the other party of an unpublished on-behalf draft (slice
 * 4, S4-L1, S4-UI2): text, never colour or an icon alone. Null otherwise.
 */
export function draftPartyLine(t: Pick<DraftStatusLike, "draftDepositedBy" | "draftAbout" | "draftState">): string | null {
  if (t.draftDepositedBy) return `Deposited by ${t.draftDepositedBy}'s agent, on your behalf`;
  // Once resolved there is nothing left for them to confirm or reject.
  if (t.draftAbout) return t.draftState === "unverified" ? `About ${t.draftAbout}: only they can confirm or reject it` : `About ${t.draftAbout}`;
  return null;
}

/**
 * The line beside the detail page's reactions, true for the viewer. The
 * depositor of a draft about someone else is told who reviews it while it is
 * unresolved, and that it is resolved afterwards (post-merge findings,
 * 2026-09-29: the review-link instruction outlived the review).
 */
export function reactionPrompt(t: Pick<DraftStatusLike, "draftAbout" | "draftState"> & { canResolveDraft?: boolean }): string {
  if (t.canResolveDraft) return "Is this draft right? Still true verifies it; Wrong rejects it.";
  if (t.draftAbout) {
    return t.draftState === "unverified"
      ? `Only ${t.draftAbout} can review this draft; send them the review link from your agent.`
      : `${t.draftAbout} has resolved this draft; there is nothing left to review.`;
  }
  return "Is this recipe still right?";
}

export type Reaction = "still_true" | "stale" | "wrong";

/**
 * The reactions the detail page offers. An unresolved draft offers only the
 * two that resolve it, as its prompt says: a Stale reaction is recorded but
 * leaves the draft waiting (the backend's resolutionForReaction), and
 * "no longer true" has no meaning for a hypothesis nobody has confirmed.
 * The viewer's own Stale stays, so it can be cleared.
 */
export function offeredReactions(t: Pick<DraftStatusLike, "draftState">, mine: string | null | undefined): Reaction[] {
  if (t.draftState === "unverified" && mine !== "stale") return ["still_true", "wrong"];
  return ["still_true", "stale", "wrong"];
}

/**
 * The delete control's accessible name on a draft the viewer deposited about
 * someone else (S4-UI2): it says what it removes. Undefined otherwise, so
 * the visible label stands.
 */
export function deleteDraftAccessibleName(t: Pick<DraftStatusLike, "draftAbout"> & { claimText: string }): string | undefined {
  if (!t.draftAbout) return undefined;
  const flat = t.claimText.replace(/\s+/g, " ").trim();
  const text = flat.length > 80 ? `${flat.slice(0, 79).trimEnd()}…` : flat;
  return `Delete draft about ${t.draftAbout}: ${text}`;
}

/**
 * Who resolved a draft, for the subject's own view (the only one that
 * carries the resolver, [F83]): the person through a reaction or the queue,
 * one of their agents with new evidence, or the agent that deposited it.
 */
function resolvedBy(t: DraftStatusLike): string {
  if (!t.draftResolvedByKeyId) return t.draftResolvedByViewer ? "by you" : "by the person it is about";
  return t.draftResolvedByKeyId === t.apiKeyId ? "by the agent that deposited it" : "by your agent";
}

export function draftStatusLabel(t: DraftStatusLike): { text: string; title: string } | null {
  const when = t.draftResolvedAt ? ` on ${new Date(t.draftResolvedAt).toLocaleDateString()}` : "";
  // Slice 6c: an agent may reject a draft or mark it not chosen as well as
  // verify it, so those lines name the resolver the same way (S6c-C2). Only
  // a row that says who resolved it can name them: the detail page sends
  // `draftResolvedByViewer` (and the resolving key), the list rows
  // (dashboard, book page, from GET /traces) send neither, and there the
  // line names nobody rather than guess (verifier's defect 1).
  const knowsResolver = typeof t.draftResolvedByViewer === "boolean" || !!t.draftResolvedByKeyId;
  const resolved = knowsResolver ? ` (${resolvedBy(t)}${when})` : when;
  const byAgent = knowsResolver && !!t.draftResolvedByKeyId;
  const byViewer = knowsResolver && !t.draftResolvedByKeyId && t.draftResolvedByViewer === true;
  switch (t.draftState ?? null) {
    case null:
      return null;
    case "unverified":
      // Slice 10 (S10-C1): an expired draft says so, and that it can still
      // be answered here; the reactions stay offered.
      if (t.draftExpiry) {
        return {
          text: "Unverified draft, expired",
          title: `${EXPIRY_WHY[t.draftExpiry]}, so it has left the review queue. ` + (t.draftAbout
            ? `Only ${t.draftAbout} can still verify or reject it.`
            : "You can still verify it with Still true or reject it with Wrong."),
        };
      }
      if (t.draftAbout) {
        return {
          text: "Unverified draft",
          title: `Your agent deposited this about ${t.draftAbout}. Until they verify it, only they and you, with your agents, can see it.`,
        };
      }
      return {
        text: "Unverified draft",
        title:
          (t.draftDepositedBy
            ? `${t.draftDepositedBy}'s agent parked this as a hypothesis about your taste and judgment. Only you, they, and your agents can see it. `
            : "An agent parked this as a hypothesis about your taste and judgment. Only you and your agents can see it. ") +
          "Still true verifies it and makes it an ordinary recipe; Wrong rejects it and keeps it private.",
      };
    case "verified":
      return {
        text: `Verified draft${resolved}`,
        title: "Verified drafts are ordinary recipes: collaborators can find them. An agent's verification cites your answer in the evidence below.",
      };
    case "rejected":
      // The depositor of a draft about someone else did not resolve it, and
      // this line does not say whether the person or their agent did ([F83],
      // S4-M3); evidence an agent attached shows below it (ruling 56).
      if (t.draftAbout) {
        return { text: `Rejected draft${when}`, title: `${t.draftAbout} rejected this draft. It stays private to them and to you.` };
      }
      return {
        text: `Rejected draft${resolved}`,
        title: byAgent
          ? "An agent of yours rejected this draft; its evidence below says why. It stays private to you and your agents."
          : byViewer
            ? "You marked this draft wrong. It stays private to you and your agents."
            : "This draft was rejected. It stays private to you and your agents.",
      };
    case "not_chosen":
      if (t.draftAbout) {
        return { text: `Draft not chosen${when}`, title: `${t.draftAbout} marked this option not chosen. It stays private to them and to you.` };
      }
      return {
        text: `Draft not chosen${resolved}`,
        title: byAgent
          ? "An agent of yours marked this option not chosen; its evidence below says why. It stays private to you and your agents."
          : "This option lost to another. It stays private to you and your agents.",
      };
    default:
      return { text: "Draft", title: "Only you and your agents can see it." };
  }
}
