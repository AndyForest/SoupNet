/**
 * An organization's sharing policy: whether its recipe books may take in
 * people from outside it (outbound), and whether its members may join books
 * owned outside it (inbound). Pure, no I/O. Organization accounts round 1,
 * stream Console (rubric docs/planning/org-accounts-build/console.md, CN-M3,
 * CN-P2 to CN-P6; recipe 5c76b5ff).
 *
 * The two directions are separate settings because the managed-account ruling
 * makes an inbound share the normal way a person brings their own context to
 * work (program §2): blocking outbound sharing must never stop that.
 *
 * Who is inside an organization is not decided here. The authz module's hook
 * (`sharingPolicyAllows`) works that out from membership and verified domains
 * and passes the answer in, so this file never sees an email address.
 */

export type OutboundSharing = "blocked" | "admins_only" | "allowed";
export type InboundSharing = "blocked" | "allowed";

export interface SharingPolicy {
  outbound: OutboundSharing;
  inbound: InboundSharing;
}

const OUTBOUND_VALUES: readonly string[] = ["blocked", "admins_only", "allowed"];
const INBOUND_VALUES: readonly string[] = ["blocked", "allowed"];

export function isOutboundSharing(value: unknown): value is OutboundSharing {
  return typeof value === "string" && OUTBOUND_VALUES.includes(value);
}

export function isInboundSharing(value: unknown): value is InboundSharing {
  return typeof value === "string" && INBOUND_VALUES.includes(value);
}

/** What a new organization starts with: nothing changes until an admin chooses. */
export const DEFAULT_SHARING_POLICY: SharingPolicy = { outbound: "allowed", inbound: "allowed" };

export type SharingRefusal = "outbound_blocked" | "outbound_admins_only" | "inbound_blocked";

export type SharingDecision = { allowed: true } | { allowed: false; refusal: SharingRefusal };

const ALLOWED: SharingDecision = { allowed: true };

function outboundDecision(policy: SharingPolicy, actorIsAdmin: boolean): SharingDecision {
  if (policy.outbound === "blocked") return { allowed: false, refusal: "outbound_blocked" };
  if (policy.outbound === "admins_only" && !actorIsAdmin) return { allowed: false, refusal: "outbound_admins_only" };
  return ALLOWED;
}

export interface MembershipSharingInput {
  /** The policy of the company organization that owns the book; null when no company owns it. */
  bookOrgPolicy: SharingPolicy | null;
  /** The policy of the company organization managing the joining account; null for a personal account. */
  joinerOrgPolicy: SharingPolicy | null;
  /** The book and the joining account are in the same company organization. */
  sameOrganization: boolean;
  /**
   * Whoever is bringing the person in (the inviter, for an invitation being
   * sent or accepted) is an active owner or admin of the book's organization.
   */
  actorIsBookOrgAdmin: boolean;
}

/**
 * May this account become a member of this book? Outbound is checked first,
 * so when two companies meet the book's side answers before the joiner's.
 *
 * `blocked` stops admins too; otherwise it would mean the same as
 * `admins_only`. "Org admins can always set sharing on any org book directly"
 * (program §3.7) is about managing a book's members, removing outsiders
 * included, which this rule never touches.
 */
export function decideMembershipSharing(input: MembershipSharingInput): SharingDecision {
  if (input.sameOrganization) return ALLOWED;
  if (input.bookOrgPolicy) {
    const outbound = outboundDecision(input.bookOrgPolicy, input.actorIsBookOrgAdmin);
    if (!outbound.allowed) return outbound;
  }
  if (input.joinerOrgPolicy?.inbound === "blocked") return { allowed: false, refusal: "inbound_blocked" };
  return ALLOWED;
}

export interface RefileSharingInput {
  /** The policy of the company organization owning the book the recipe leaves; null when no company owns it. */
  sourceOrgPolicy: SharingPolicy | null;
  /** The destination book belongs to the same company organization. */
  destinationInSameOrganization: boolean;
  /** The person moving the recipe is an active owner or admin of the source book's organization. */
  actorIsSourceOrgAdmin: boolean;
}

/**
 * May a recipe be re-filed out of this book? Moving company content into a
 * book outside the company crosses the same boundary an outbound share does.
 * Inbound is about joining books, so a recipe arriving is never refused here.
 */
export function decideRefileSharing(input: RefileSharingInput): SharingDecision {
  if (!input.sourceOrgPolicy || input.destinationInSameOrganization) return ALLOWED;
  return outboundDecision(input.sourceOrgPolicy, input.actorIsSourceOrgAdmin);
}

/**
 * Who reads the refusal:
 *   - sharer: the member sending an invitation or adding someone;
 *   - joiner: the person accepting an invitation;
 *   - mover: the person re-filing a recipe.
 * An inbound refusal only ever reaches the joiner: the outside book's owner
 * sends the invitation normally and learns nothing about the joiner's
 * organization (CN-P3).
 */
export type SharingAudience = "sharer" | "joiner" | "mover";

const MESSAGES: Record<SharingAudience, Record<SharingRefusal, string>> = {
  sharer: {
    outbound_blocked: "Your organization doesn't allow sharing recipe books with people outside it. Ask one of its admins.",
    outbound_admins_only: "Only your organization's admins can share recipe books with people outside it. Ask one of its admins.",
    inbound_blocked: "Your organization doesn't allow joining recipe books owned outside it. Ask one of its admins.",
  },
  joiner: {
    outbound_blocked: "This recipe book's organization doesn't allow sharing it with people outside the organization. Ask the person who invited you.",
    outbound_admins_only: "This recipe book's organization now lets only its admins share it with people outside the organization. Ask one of its admins to invite you.",
    inbound_blocked: "Your organization doesn't allow joining recipe books owned outside it. Ask one of its admins.",
  },
  mover: {
    outbound_blocked: "Your organization doesn't allow moving recipes into recipe books outside it. Ask one of its admins.",
    outbound_admins_only: "Only your organization's admins can move recipes into recipe books outside it. Ask one of its admins.",
    inbound_blocked: "Your organization doesn't allow joining recipe books owned outside it. Ask one of its admins.",
  },
};

export function sharingRefusalMessage(refusal: SharingRefusal, audience: SharingAudience): string {
  return MESSAGES[audience][refusal];
}
