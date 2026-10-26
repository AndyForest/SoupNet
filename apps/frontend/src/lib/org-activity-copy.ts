import type { OrgActivityEvent, OrgRole } from "@soupnet/domain";

const ROLE_PHRASE: Record<OrgRole, string> = { owner: "an owner", admin: "an admin", member: "a member" };

/**
 * One plain sentence for an admin-action event, for the org console's
 * Activity page ("org": names the member) and the member's own page ("me":
 * says "you"). The actor is shown beside it.
 */
export function describeOrgEvent(event: OrgActivityEvent, view: "org" | "me"): string {
  const who = view === "me" ? "you" : (event.target ?? "a member");
  // An email address keeps its case; "you" and "a member" start a sentence.
  const Who = view === "org" && event.target ? who : who[0]!.toUpperCase() + who.slice(1);
  switch (event.kind) {
    case "joined":
      return view === "me" ? "You joined the organization" : `${Who} joined`;
    case "disabled":
      return `Disabled ${who}`;
    case "enabled":
      return `Re-enabled ${who}`;
    case "role_changed":
      return event.role ? `Made ${who} ${ROLE_PHRASE[event.role]}` : `Changed ${view === "me" ? "your" : `${who}'s`} role`;
    case "sharing_changed":
      return "Changed the sharing policy";
    case "suspended":
      return `Suspended ${who}`;
    case "unsuspended":
      return `Lifted the suspension on ${who}`;
  }
}
