/**
 * Organization accounts: the pure rules (organization accounts round 1,
 * stream Core; rubric docs/planning/org-accounts-build/core.md).
 *
 * The SQL that applies them lives in apps/backend/src/authz/; this file holds
 * what can be decided without I/O — who may act on whom, what a seat count
 * allows, the managed-account key cap — and the copy a person reads when one
 * of them refuses.
 */

/** A member's role in a company organization. */
export type OrgRole = "owner" | "admin" | "member";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

/** How a person arrived in the organization (organization_members.joined_via). */
export type OrgJoinedVia = "created" | "operator" | "domain" | "migrated";

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Owners and admins manage the organization. Deliberately an explicit
 * allowlist, so a role added later fails closed (the trace-move precedent).
 */
export function isOrgManager(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * The role an org-wide book's membership row carries for a member with this
 * org role: owners and admins oversee every org-wide book (program §3.5), so
 * they hold the book's admin role; members hold its member role.
 */
export function bookRoleForOrgRole(role: OrgRole): "admin" | "member" {
  return isOrgManager(role) ? "admin" : "member";
}

/** What an org manager does to another member. */
export type OrgMemberAction =
  | { kind: "disable" }
  | { kind: "enable" }
  | { kind: "set_role"; role: OrgRole };

export type OrgActionRefusal =
  /** The actor is not an active owner or admin of the organization. */
  | "not_a_manager"
  /** Nobody disables themselves or changes their own role. */
  | "cannot_act_on_self"
  /** An admin acting on an owner, or making someone an owner. */
  | "owner_only";

/**
 * May `actorRole` take `action` on a member whose role is `targetRole`?
 * Returns null when allowed, else the refusal.
 *
 * The rules (design-thinking.md archetype 7, "Roles"): only owners and admins
 * act; nobody acts on themselves, so an organization is never left with
 * nobody in charge by its last owner's own click; an admin can't act on an
 * owner or make one; an owner can do everything else.
 */
export function orgActionRefusal(
  actorRole: string | null | undefined,
  targetRole: OrgRole,
  action: OrgMemberAction,
  isSelf: boolean,
): OrgActionRefusal | null {
  if (!isOrgManager(actorRole)) return "not_a_manager";
  if (isSelf) return "cannot_act_on_self";
  if (actorRole === "owner") return null;
  if (targetRole === "owner") return "owner_only";
  if (action.kind === "set_role" && action.role === "owner") return "owner_only";
  return null;
}

/**
 * Whether one more active member fits. `seatLimit` null means no limit.
 * Disabled members don't take a seat (research plan Q7), so `activeMembers`
 * counts only members whose row has no disabled_at.
 */
export function hasFreeSeat(seatLimit: number | null, activeMembers: number): boolean {
  return seatLimit === null || activeMembers < seatLimit;
}

/**
 * The longest a managed account's scoped key may live, in days: a fixed
 * backstop behind the hourly directory check, with no per-organization
 * setting in the first release (recipe d5d0f730; settled simplification
 * "Key lifetimes just scope down. No org-level cap policy").
 */
export const MANAGED_KEY_MAX_DAYS = 90;

/** The longest any other scoped key may live, in days (routes/keys.ts). */
export const SCOPED_KEY_MAX_DAYS = 365;

/** The expiry ceiling, in days, for a scoped key minted by this account. */
export function scopedKeyMaxDays(managed: boolean): number {
  return managed ? MANAGED_KEY_MAX_DAYS : SCOPED_KEY_MAX_DAYS;
}

/**
 * A slug for a book moving into an organization, changed only on a collision
 * (the succession precedent, recipe 1a124507): first `<slug>-<local part>`,
 * then numbered. Slugs are at most 100 characters of [a-z0-9-].
 */
export function slugForMovedBook(slug: string, emailLocalPart: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  const local = emailLocalPart.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "member";
  const base = `${slug}-${local}`.slice(0, 96).replace(/-+$/, "");
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The domain part of an email address, lowercased ("" when there is none). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * May a managed account change its email from `current` to `next`? Only
 * within the same domain: the account belongs to the company because of its
 * address (program §3.4, "Managed accounts can't change their email away
 * from the domain"). A personal account (`managed` false) may change freely.
 * No route changes an email today; any route that does asks this first, and
 * apps/backend/src/authz/managed-email.test.ts fails until it is registered.
 */
export function emailChangeAllowed(managed: boolean, current: string, next: string): boolean {
  return !managed || emailDomain(current) === emailDomain(next);
}

// ── Copy ────────────────────────────────────────────────────────────────────

/**
 * The one not-found body for organization routes: a non-manager, an unknown
 * or malformed organization id, and a user outside the organization all get
 * it, byte for byte, so nobody outside learns who is in an organization or
 * whether it exists.
 */
export const ORGANIZATION_NOT_FOUND = { ok: false, error: "not_found" } as const;

export const ACCOUNT_DISABLED_MESSAGE =
  "Your organization has disabled this account. Ask one of its admins to turn it back on.";

export const ACCOUNT_SUSPENDED_MESSAGE =
  "This account is suspended. Contact Soup.net support.";

export const SESSION_EXPIRED_MESSAGE =
  "This session has ended. Sign in again.";

/** Placeholder until stream SSO words it. */
export const SSO_REQUIRED_MESSAGE =
  "Your organization requires signing in with Google. Sign in again with Google.";

export const ORGANIZATION_FULL_MESSAGE =
  "This organization has no free seats. Ask one of its admins.";

export const MANAGED_EMAIL_CHANGE_MESSAGE =
  "Your organization manages this account, so its email stays on the organization's domain. Ask one of its admins.";

export const MANAGED_ACCOUNT_DELETE_MESSAGE =
  "Your organization manages this account. Ask one of its admins.";

export function keyLifetimeCapMessage(days: number): string {
  return `Keys for an organization's accounts can last at most ${days} days. Choose an expiry within ${days} days.`;
}

export const ORG_ACTION_MESSAGES: Record<OrgActionRefusal, string> = {
  not_a_manager: "Only an organization's owners and admins can do that.",
  cannot_act_on_self: "You can't disable yourself or change your own role. Ask another owner or admin.",
  owner_only: "Only an owner can change an owner, or make someone an owner.",
};

/** A book a join moved under the organization, as the notice names it. */
/**
 * The refusal for a new recipe book whose slug is taken. Members of a company
 * organization share one slug space, so the holder can be a private book of
 * another member's that this person can't see. Slugs are the "short name" the
 * join notice already calls them.
 */
export function bookSlugTakenMessage(slug: string, inCompany: boolean): string {
  return inCompany
    ? `Another recipe book in this organization already uses the short name "${slug}". Choose a different name.`
    : `You already have a recipe book with the short name "${slug}". Choose a different name.`;
}

export interface MovedBook {
  name: string;
  slug: string;
  previousSlug: string;
}

/**
 * The email an account that existed before it joined receives ("tell the user
 * it happened", settled simplifications). Plain text; no links or tokens.
 */
export function organizationJoinNotice(organizationName: string, moved: readonly MovedBook[]): { subject: string; text: string } {
  const lines = [
    `Your Soup.net account is now part of ${organizationName}.`,
    "",
    `${organizationName}'s admins manage this account: they can see how much you use Soup.net, but not what is in your private recipe books or what they are called.`,
  ];
  if (moved.length > 0) {
    lines.push("", `These recipe books moved into ${organizationName} and stay private to you and the people you share them with:`);
    for (const book of moved) {
      const renamed = book.slug === book.previousSlug ? "" : ` (its short name changed from ${book.previousSlug} to ${book.slug})`;
      lines.push(`- ${book.name}${renamed}`);
    }
  }
  const slugChanged = moved.some((book) => book.slug !== book.previousSlug);
  lines.push("", slugChanged
    ? "Your API keys and your agents' connections keep working. An agent that names one of these books by its old short name needs the new one."
    : "Your API keys and your agents' connections keep working as before.");
  return { subject: `Your Soup.net account joined ${organizationName}`, text: lines.join("\n") };
}
