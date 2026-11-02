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
 * server-side and checked against the role list before it is sent. The
 * directory events' details are read and checked the same way: the status a
 * member changed to, and for a connection its kind, domain, closed-set failure
 * reason and the numbers it cleared.
 */

import { isOrgRole } from "./organizations";
import type { OrgRole } from "./organizations";
import type { DirectoryStatus } from "./directory";

/** The public name of an event, as both views send it. */
export type OrgActivityKind =
  | "joined"
  | "disabled"
  | "enabled"
  | "role_changed"
  | "sharing_changed"
  | "suspended"
  | "unsuspended"
  | "directory_status"
  | "directory_connected"
  | "directory_connect_failed"
  | "directory_disconnected";

/**
 * Who appears as the actor:
 *   - person: the account that acted (an org owner or admin);
 *   - join: the site operator ("Soup.net") or the person's email domain,
 *     from the join's recorded authority;
 *   - soupnet: always "Soup.net", never the operator's address;
 *   - directory: the company's Google Workspace directory, which said so.
 */
type ActorRule = "person" | "join" | "soupnet" | "directory";

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
  // Stream Offboarding's. A status change touched the member, so both views
  // show it; the connection is the organization's business only.
  "organization.member_directory_status": { kind: "directory_status", actor: "directory", orgView: true, memberView: true },
  "organization.directory_connected": { kind: "directory_connected", actor: "person", orgView: true, memberView: false },
  "organization.directory_connect_failed": { kind: "directory_connect_failed", actor: "person", orgView: true, memberView: false },
  "organization.directory_disconnected": { kind: "directory_disconnected", actor: "person", orgView: true, memberView: false },
};

export const SOUPNET_ACTOR_LABEL = "Soup.net";
export const DOMAIN_ACTOR_LABEL = "Your organization's email domain";
export const DIRECTORY_ACTOR_LABEL = "Google Workspace";
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
  /** Only on directory_status: what the directory says now; null when the status was cleared. */
  directoryStatus?: DirectoryStatus | null;
  /** Only on a directory connection event. */
  connectionKind?: DirectoryConnectionKind;
  domain?: string;
  /** Only on a failed admin-consent connection: a service account's reason comes from Google's answer, so it isn't a closed set. */
  connectFailure?: DirectoryConnectFailure;
  /** Only when a connection change cleared recorded statuses: how many of each. */
  cleared?: DirectoryStatusCounts;
}

export type DirectoryConnectionKind = "admin_consent" | "service_account";
export type DirectoryStatusCounts = { suspended: number; archived: number; deleted: number };

/** Why an admin-consent connection failed, as Activity reads it. */
export const DIRECTORY_CONNECT_FAILURE_LABELS = {
  directory_wrong_account: "it wasn't the Google account that signs in here",
  directory_wrong_domain: "that Google account isn't on this domain",
  directory_no_refresh_token: "Google didn't grant lasting access",
  directory_not_admin: "that account can't read the directory",
} as const;
export type DirectoryConnectFailure = keyof typeof DIRECTORY_CONNECT_FAILURE_LABELS;

function isDirectoryStatusOrNull(value: unknown): value is DirectoryStatus | null {
  return value === null || value === "active" || value === "suspended" || value === "archived" || value === "deleted";
}

function isConnectFailure(value: unknown): value is DirectoryConnectFailure {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DIRECTORY_CONNECT_FAILURE_LABELS, value);
}

function count(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
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
  directoryTo?: unknown;
  connectionKind?: unknown;
  connectionDomain?: unknown;
  connectFailure?: unknown;
  cleared?: { suspended?: unknown; archived?: unknown; deleted?: unknown };
}): OrgActivityEvent | null {
  const action = ORG_ACTIVITY_ACTIONS[row.action];
  if (!action) return null;
  let actor: string;
  if (action.actor === "soupnet") actor = SOUPNET_ACTOR_LABEL;
  else if (action.actor === "directory") actor = DIRECTORY_ACTOR_LABEL;
  else if (action.actor === "join") actor = row.joinAuthority === "domain" ? DOMAIN_ACTOR_LABEL : SOUPNET_ACTOR_LABEL;
  else actor = row.actorEmail ?? DELETED_ACTOR_LABEL;
  const event: OrgActivityEvent = { kind: action.kind, actor, target: row.targetEmail, at: row.at };
  if (action.kind === "role_changed" && isOrgRole(row.newRole)) event.role = row.newRole;
  if (action.kind === "directory_status" && isDirectoryStatusOrNull(row.directoryTo)) event.directoryStatus = row.directoryTo;
  if (action.kind === "directory_connected" || action.kind === "directory_connect_failed") {
    const kind = row.connectionKind;
    if (kind === "admin_consent" || kind === "service_account") event.connectionKind = kind;
    if (typeof row.connectionDomain === "string" && row.connectionDomain) event.domain = row.connectionDomain;
    if (action.kind === "directory_connect_failed" && kind === "admin_consent" && isConnectFailure(row.connectFailure)) event.connectFailure = row.connectFailure;
  }
  if (action.kind === "directory_connected" || action.kind === "directory_disconnected") {
    const cleared = { suspended: count(row.cleared?.suspended), archived: count(row.cleared?.archived), deleted: count(row.cleared?.deleted) };
    if (cleared.suspended + cleared.archived + cleared.deleted > 0) event.cleared = cleared;
  }
  return event;
}
