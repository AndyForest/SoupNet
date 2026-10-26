/**
 * The columns of the users table that the site admin console and the
 * organization admin console share, and who may see each one. Pure, no I/O.
 * Organization accounts round 1, stream Console (rubric
 * docs/planning/org-accounts-build/console.md, CN-M2; recipe 1fa21e31).
 *
 * The backend's users-list service selects only the columns `columnsFor`
 * returns, so a column outside a viewer's set is never computed for them;
 * leaving it off a page is not what protects it. The end-user page "What your
 * organization's admins can see" renders `memberDescription` from the same
 * list, so it can't drift from what the console shows.
 *
 * An org admin sees aggregates, never private book names or contents (recipes
 * 57fc1eee, 2738f7a9), and nothing the site operator holds for running the
 * service: the reason for a site suspension, a signup reason, premium or
 * waitlist state, the site role, or anything about an API key beyond how many
 * are live.
 */

/** Who is looking: the site operator, or an owner or admin of one organization. */
export type AdminViewer = "site" | "org";

/** What is being listed: every account, or the members of one organization. */
export type AdminListing = "all" | "organization";

interface ColumnBase {
  key: string;
  /** The table header. */
  label: string;
  /**
   * user: a fact about the account, present in every listing.
   * membership: a fact about the account's membership, present only when
   * listing an organization's members.
   */
  anchor: "user" | "membership";
}

/** A column only the site operator sees. */
interface SiteOnlyColumn extends ColumnBase {
  audience: "site";
}

/** A column an org admin sees too, so the member's page must describe it. */
interface SharedColumn extends ColumnBase {
  audience: "everyone";
  /** One plain sentence for the member, completing "Your organization's admins can see ...". */
  memberDescription: string;
}

export type AdminUserColumn = SiteOnlyColumn | SharedColumn;

export const ADMIN_USER_COLUMNS: readonly AdminUserColumn[] = [
  { key: "id", label: "Id", anchor: "user", audience: "everyone", memberDescription: "your account's internal id" },
  { key: "email", label: "Email", anchor: "user", audience: "everyone", memberDescription: "your email address" },
  { key: "displayName", label: "Name", anchor: "user", audience: "everyone", memberDescription: "your display name, if you set one" },
  {
    key: "status",
    label: "Status",
    anchor: "user",
    audience: "everyone",
    memberDescription: "whether your account is active, disabled by your organization, or suspended by Soup.net (never the reason for a suspension)",
  },
  {
    key: "lastActiveAt",
    label: "Last active",
    anchor: "user",
    audience: "everyone",
    memberDescription: "when you last signed in or one of your API keys was last used, whichever is later",
  },
  {
    key: "recipeCount",
    label: "Recipes",
    anchor: "user",
    audience: "everyone",
    memberDescription: "how many published recipes you have in the organization's recipe books (a number, never the recipes)",
  },
  {
    key: "activeKeyCount",
    label: "Live keys",
    anchor: "user",
    audience: "everyone",
    memberDescription: "how many of your API keys are live (a number, never the keys, their names or what they can reach)",
  },

  { key: "orgRole", label: "Role", anchor: "membership", audience: "everyone", memberDescription: "your role in the organization" },
  {
    key: "joinedVia",
    label: "Joined via",
    anchor: "membership",
    audience: "everyone",
    memberDescription: "how you joined: named when the organization was created, added by Soup.net, by your email domain, or moved in from an existing account",
  },
  { key: "joinedAt", label: "Joined", anchor: "membership", audience: "everyone", memberDescription: "when you joined the organization" },
  {
    key: "privateBookCount",
    label: "Private books",
    anchor: "membership",
    audience: "everyone",
    memberDescription: "how many private recipe books you belong to in the organization (a number, never their names or contents)",
  },
  {
    key: "orgWideBookCount",
    label: "Org-wide books",
    anchor: "membership",
    audience: "everyone",
    memberDescription: "how many of the organization's org-wide recipe books you belong to",
  },

  { key: "role", label: "Site role", anchor: "user", audience: "site" },
  { key: "organization", label: "Organization", anchor: "user", audience: "site" },
  { key: "emailVerifiedAt", label: "Verified", anchor: "user", audience: "site" },
  { key: "suspendedAt", label: "Suspended", anchor: "user", audience: "site" },
  { key: "suspendedReason", label: "Suspension reason", anchor: "user", audience: "site" },
  { key: "waitlistedAt", label: "Waitlisted", anchor: "user", audience: "site" },
  { key: "premiumAt", label: "Premium", anchor: "user", audience: "site" },
  { key: "signupReason", label: "Signup reason", anchor: "user", audience: "site" },
  { key: "lastLoginAt", label: "Last login", anchor: "user", audience: "site" },
  { key: "createdAt", label: "Created", anchor: "user", audience: "site" },
  { key: "groupCount", label: "Books", anchor: "user", audience: "site" },
];

/**
 * The columns this viewer gets for this listing. An org admin can only list
 * their own organization's members; asking for every account returns nothing,
 * so a wrongly wired route fails empty rather than open.
 */
export function columnsFor(viewer: AdminViewer, listing: AdminListing): readonly AdminUserColumn[] {
  if (viewer === "org" && listing === "all") return [];
  return ADMIN_USER_COLUMNS.filter(
    (c) => (viewer === "site" || c.audience === "everyone") && (listing === "organization" || c.anchor === "user"),
  );
}

export function columnKeysFor(viewer: AdminViewer, listing: AdminListing): string[] {
  return columnsFor(viewer, listing).map((c) => c.key);
}

/** What the member's page lists under "Your organization's admins can see". */
export function memberVisibleDescriptions(): string[] {
  return columnsFor("org", "organization").flatMap((c) => (c.audience === "everyone" ? [c.memberDescription] : []));
}

/** The account's status as both consoles show it. A site suspension wins over an org disable. */
export type AdminUserStatus = "active" | "disabled" | "suspended";

export function adminUserStatus(input: { suspendedAt: unknown; orgDisabledAt: unknown }): AdminUserStatus {
  if (input.suspendedAt) return "suspended";
  if (input.orgDisabledAt) return "disabled";
  return "active";
}

/** How a member arrived (the membership row's joined_via), as both consoles label it. */
export const ADMIN_JOINED_VIA_LABELS: Readonly<Record<string, string>> = {
  created: "Named at creation",
  operator: "Added by Soup.net",
  domain: "Email domain",
  migrated: "Existing account",
};

/** An organization role, as both consoles label it. */
export const ADMIN_ORG_ROLE_LABELS: Readonly<Record<string, string>> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Labels for the status, with the cause named. */
export const ADMIN_USER_STATUS_LABELS: Record<AdminUserStatus, string> = {
  active: "Active",
  disabled: "Disabled by the organization",
  suspended: "Suspended by Soup.net",
};
