/**
 * The draft fields a result row carries on the wire (drafts-and-triage
 * slices 2 and 3), shared by /check and the remote MCP tools so the two
 * surfaces cannot drift.
 *
 * A row reaches a result set with a draft state only when it is the viewer's
 * own unpublished draft (the authz module filtered everyone else's), so
 * this is also where the agent's triage ratings join such a row (rubric
 * S3-AG2): `impact` and `uncertainty`, null when unrated. A published row
 * gets nothing here, as in slices 1 and 2.
 */
import { isShownDraftState } from "@soupnet/domain";
import { TRIAGE_RATING_VALUES } from "@soupnet/contracts";
import type { DraftState, TriageRating } from "@soupnet/contracts";

function asRating(v: unknown): TriageRating | null {
  return typeof v === "string" && (TRIAGE_RATING_VALUES as readonly string[]).includes(v) ? (v as TriageRating) : null;
}

export function ownDraftFields(r: {
  draftState?: string | undefined;
  impact?: string | null | undefined;
  uncertainty?: string | null | undefined;
  draftDepositedBy?: string | undefined;
  draftAbout?: string | undefined;
}): {
  draftState?: Exclude<DraftState, "verified">;
  impact?: TriageRating | null;
  uncertainty?: TriageRating | null;
  draftDepositedBy?: string;
  draftAbout?: string;
} {
  if (!isShownDraftState(r.draftState)) return {};
  return {
    draftState: r.draftState,
    impact: asRating(r.impact),
    uncertainty: asRating(r.uncertainty),
    // Slice 4 (S4-L1): only on an on-behalf draft, naming the other party.
    ...(r.draftDepositedBy ? { draftDepositedBy: r.draftDepositedBy } : {}),
    ...(r.draftAbout ? { draftAbout: r.draftAbout } : {}),
  };
}
