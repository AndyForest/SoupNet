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
  apiKeyId?: string | null;
}

export function draftStatusLabel(t: DraftStatusLike): { text: string; title: string } | null {
  const when = t.draftResolvedAt ? ` on ${new Date(t.draftResolvedAt).toLocaleDateString()}` : "";
  switch (t.draftState ?? null) {
    case null:
      return null;
    case "unverified":
      return {
        text: "Unverified draft",
        title:
          "An agent parked this as a hypothesis about your taste and judgment. Only you and your agents can see it. " +
          "Still true verifies it and makes it an ordinary recipe; Wrong rejects it and keeps it private.",
      };
    case "verified": {
      const by = !t.draftResolvedByKeyId
        ? "by you"
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
