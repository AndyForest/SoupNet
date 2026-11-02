import { DIRECTORY_CONNECT_FAILURE_LABELS } from "@soupnet/domain/browser";
import type { DirectoryConnectionKind, DirectoryStatusCounts, OrgActivityEvent, OrgRole } from "@soupnet/domain/browser";

const ROLE_PHRASE: Record<OrgRole, string> = { owner: "an owner", admin: "an admin", member: "a member" };

const CONNECTION_KIND_PHRASE: Record<DirectoryConnectionKind, string> = {
  admin_consent: "with an admin's Google account",
  service_account: "with a service account",
};

/** "; recorded statuses cleared: 2 suspended, 1 archived", numbers only. */
function clearedPhrase(cleared: DirectoryStatusCounts | undefined): string {
  if (!cleared) return "";
  const parts = (["suspended", "archived", "deleted"] as const).filter((k) => cleared[k] > 0).map((k) => `${cleared[k]} ${k}`);
  return parts.length ? `; recorded statuses cleared: ${parts.join(", ")}` : "";
}

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
    case "directory_status": {
      const them = view === "me" ? "you" : who;
      if (event.directoryStatus === "deleted") return `The directory no longer lists ${them}`;
      if (event.directoryStatus === null || event.directoryStatus === undefined) return `The directory status of ${view === "me" ? "your account" : who} changed`;
      return `The directory lists ${them} as ${event.directoryStatus}`;
    }
    case "directory_connected": {
      const on = event.domain ? ` on ${event.domain}` : "";
      const how = event.connectionKind ? ` ${CONNECTION_KIND_PHRASE[event.connectionKind]}` : "";
      return `Connected the Google Workspace directory${on}${how}${clearedPhrase(event.cleared)}`;
    }
    case "directory_connect_failed": {
      const on = event.domain ? ` on ${event.domain}` : "";
      const why = event.connectFailure ? `: ${DIRECTORY_CONNECT_FAILURE_LABELS[event.connectFailure]}` : "";
      return `Couldn't connect the Google Workspace directory${on}${why}`;
    }
    case "directory_disconnected":
      return `Disconnected the Google Workspace directory${clearedPhrase(event.cleared)}`;
  }
}
