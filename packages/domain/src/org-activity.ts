/**
 * Which audit events an organization's Activity view and a member's own page
 * show, and how each reads. Pure, no I/O. Organization accounts round 1,
 * stream Console (rubric docs/planning/org-accounts-build/console.md, CN-L1,
 * CN-L2; recipe e36bbef8).
 *
 * An allowlist, not a filter: an audit action that isn't named here never
 * appears, so a member's own activity (their checks, searches, intents) and
 * the site operator's other work can't reach an org admin even when new audit
 * actions are added. Each event shows who acted, on whom, what and when. Its
 * metadata never leaves the server: a join's metadata holds the moved books'
 * names and old slugs, which are private book names (recipe 2738f7a9). The
 * one detail shown, a role change's new role, is read from metadata
 * server-side and checked against the role list before it is sent.
 */

import { isOrgRole } from "./organizations";
import type { OrgRole } from "./organizations";

/** The public name of an event, as both views send it. */
export type OrgActivityKind =
  | "joined"
  | "disabled"
  | "enabled"
  | "role_changed"
  | "sharing_changed"
  | "suspended"
  | "unsuspended";

/**
 * Who appears as the actor:
 *   - person: the account that acted (an org owner or admin);
 *   - join: the site operator ("Soup.net") or the person's email domain,
 *     from the join's recorded authority;
 *   - soupnet: always "Soup.net", never the operator's address.
 */
type ActorRule = "person" | "join" | "soupnet";

interface OrgActivityAction {
  kind: OrgActivityKind;
  actor: ActorRule;
  /** Shown in the organization's Activity view. */
  orgView: boolean;
  /** Shown to the member it touched, on their own page. */
  memberView: boolean;
}

/** Audit action name → how it shows. The audit log's action names are Core's and Console's. */
export const ORG_ACTIVITY_ACTIONS: Readonly<Record<string, OrgActivityAction>> = {
  "organization.member_joined": { kind: "joined", actor: "join", orgView: true, memberView: true },
  "organization.member_disable": { kind: "disabled", actor: "person", orgView: true, memberView: true },
  "organization.member_enable": { kind: "enabled", actor: "person", orgView: true, memberView: true },
  "organization.member_set_role": { kind: "role_changed", actor: "person", orgView: true, memberView: true },
  "organization.sharing_changed": { kind: "sharing_changed", actor: "person", orgView: true, memberView: false },
  // A site suspension touched the member's account, so they see it; their
  // organization sees the status on the member list, not the event.
  "user.suspended": { kind: "suspended", actor: "soupnet", orgView: false, memberView: true },
  "user.unsuspended": { kind: "unsuspended", actor: "soupnet", orgView: false, memberView: true },
};

export const SOUPNET_ACTOR_LABEL = "Soup.net";
export const DOMAIN_ACTOR_LABEL = "Your organization's email domain";
/** A person who acted and has since deleted their account. */
export const DELETED_ACTOR_LABEL = "A deleted account";

/** The audit actions one view may read. */
export function orgActivityActionsFor(view: "org" | "member"): string[] {
  return Object.entries(ORG_ACTIVITY_ACTIONS)
    .filter(([, a]) => (view === "org" ? a.orgView : a.memberView))
    .map(([name]) => name);
}

export interface OrgActivityEvent {
  kind: OrgActivityKind;
  actor: string;
  target: string | null;
  at: string;
  /** Only on role_changed: the new role. */
  role?: OrgRole;
}

/**
 * Shape one stored audit row into what a view sends, or null when the action
 * isn't on the allowlist. `joinAuthority` is the join's recorded authority
 * ('operator' or 'domain'), `newRole` a role change's recorded role; both are
 * read from metadata by the caller and nothing else of it is.
 */
export function orgActivityEvent(row: {
  action: string;
  actorEmail: string | null;
  targetEmail: string | null;
  at: string;
  joinAuthority?: unknown;
  newRole?: unknown;
}): OrgActivityEvent | null {
  const action = ORG_ACTIVITY_ACTIONS[row.action];
  if (!action) return null;
  let actor: string;
  if (action.actor === "soupnet") actor = SOUPNET_ACTOR_LABEL;
  else if (action.actor === "join") actor = row.joinAuthority === "domain" ? DOMAIN_ACTOR_LABEL : SOUPNET_ACTOR_LABEL;
  else actor = row.actorEmail ?? DELETED_ACTOR_LABEL;
  const event: OrgActivityEvent = { kind: action.kind, actor, target: row.targetEmail, at: row.at };
  if (action.kind === "role_changed" && isOrgRole(row.newRole)) event.role = row.newRole;
  return event;
}
