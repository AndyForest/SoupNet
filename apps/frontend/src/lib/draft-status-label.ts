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
}

/**
 * The line naming the other party of an unpublished on-behalf draft (slice
 * 4, S4-L1, S4-UI2): text, never colour or an icon alone. Null otherwise.
 */
export function draftPartyLine(t: Pick<DraftStatusLike, "draftDepositedBy" | "draftAbout">): string | null {
  if (t.draftDepositedBy) return `Deposited by ${t.draftDepositedBy}'s agent, on your behalf`;
  if (t.draftAbout) return `About ${t.draftAbout}: only they can confirm or reject it`;
  return null;
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

export function draftStatusLabel(t: DraftStatusLike): { text: string; title: string } | null {
  const when = t.draftResolvedAt ? ` on ${new Date(t.draftResolvedAt).toLocaleDateString()}` : "";
  switch (t.draftState ?? null) {
    case null:
      return null;
    case "unverified":
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
    case "verified": {
      const by = !t.draftResolvedByKeyId
        ? (t.draftResolvedByViewer ? "by you" : "by the person it is about")
        : t.draftResolvedByKeyId === t.apiKeyId
          ? "by the agent that deposited it"
          : "by your agent";
      return {
        text: `Verified draft (${by}${when})`,
        title: "Verified drafts are ordinary recipes: collaborators can find them. An agent's verification cites your answer in the evidence below.",
      };
    }
    case "rejected":
      return { text: `Rejected draft${when}`, title: "You marked this draft wrong. It stays private to you and your agents." };
    case "not_chosen":
      return { text: `Draft not chosen${when}`, title: "This option lost to another. It stays private to you and your agents." };
    default:
      return { text: "Draft", title: "Only you and your agents can see it." };
  }
}
