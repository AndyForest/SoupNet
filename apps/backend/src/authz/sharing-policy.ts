/**
 * An organization's sharing policy at the company boundary (organization
 * accounts round 1, stream Console; rubric
 * docs/planning/org-accounts-build/console.md, CN-P2 to CN-P5; recipe
 * 5c76b5ff).
 *
 * This whole file is stream Console's (agreed with stream Core, 2026-10-26):
 * Core's grant paths ask `sharingPolicyAllows` before any membership is
 * written, and Console's own earlier checks (invitation creation, re-filing a
 * recipe) and the Books page's review counts live here beside it, because all
 * of them read organization membership, which only this module may.
 *
 * The rule itself is pure and lives in @soupnet/domain (sharing-policy.ts);
 * the statements here only work out the facts it needs:
 *   - which company organization owns the book, and its policy;
 *   - which company organization manages the joining account, and its policy;
 *   - whether the person bringing them in is an active owner or admin of the
 *     book's organization.
 * Inside an organization means holding its membership row (disabled or not:
 * a disabled member is still the company's), or, for an invitation to an
 * email with no account in it yet, an email on a domain the organization has
 * verified with automatic joining on (`domainVerifiedFor`), since that person
 * joins the company on sign-up. Never an email suffix on its own.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { decideMembershipSharing, decideRefileSharing, emailDomain, isInboundSharing, isOutboundSharing } from "@soupnet/domain";
import type { SharingDecision, SharingPolicy } from "@soupnet/domain";
import { orgMembershipDisabled } from "./account-state";
import { domainVerifiedFor } from "./domain-authority";
import { countsAsMembership } from "./membership-sql";

/** Runs on the root connection or inside a transaction. */
type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

/** A book whose row is gone is refused: the caller asked about a grant that can't happen. */
const NO_BOOK: SharingDecision = { allowed: false, refusal: "outbound_blocked" };

/** The policy stored on a company organization; unknown values fail closed. */
function policyOf(outbound: unknown, inbound: unknown): SharingPolicy {
  return {
    outbound: isOutboundSharing(outbound) ? outbound : "blocked",
    inbound: isInboundSharing(inbound) ? inbound : "blocked",
  };
}

/** Is `actor` (a bound user id) an active owner or admin of the organization in `orgIdColumn`? */
function activeManagerOf(orgIdColumn: SQL, actorUserId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM claimnet.organization_members om
    WHERE om.organization_id = ${orgIdColumn} AND om.user_id = ${actorUserId}::uuid
      AND om.role IN ('owner', 'admin') AND NOT (${orgMembershipDisabled()})
  )`;
}

interface BoundaryRow {
  book_org_id: string;
  book_org_company: boolean;
  book_outbound: string;
  book_inbound: string;
  joiner_org_id: string | null;
  joiner_outbound: string | null;
  joiner_inbound: string | null;
  actor_is_admin: boolean;
}

/**
 * The decision for granting `userId` a membership in `bookId`, brought in by
 * `actorUserId` (the person adding, or an invitation's inviter).
 */
export async function sharingDecisionFor(
  db: SqlExecutor,
  grant: { bookId: string; userId: string; actorUserId: string },
): Promise<SharingDecision> {
  const rows = await db.execute(sql`
    SELECT bo.id AS book_org_id, NOT bo.is_personal AS book_org_company,
           bo.outbound_sharing AS book_outbound, bo.inbound_sharing AS book_inbound,
           jm.organization_id AS joiner_org_id,
           jo.outbound_sharing AS joiner_outbound, jo.inbound_sharing AS joiner_inbound,
           ${activeManagerOf(sql`bo.id`, grant.actorUserId)} AS actor_is_admin
    FROM claimnet.groups g
    JOIN claimnet.organizations bo ON bo.id = g.organization_id
    LEFT JOIN claimnet.organization_members jm ON jm.user_id = ${grant.userId}::uuid
    LEFT JOIN claimnet.organizations jo ON jo.id = jm.organization_id
    WHERE g.id = ${grant.bookId}::uuid
  `);
  const row = (rows as unknown as BoundaryRow[])[0];
  if (!row) return NO_BOOK;
  return decideMembershipSharing({
    bookOrgPolicy: row.book_org_company ? policyOf(row.book_outbound, row.book_inbound) : null,
    joinerOrgPolicy: row.joiner_org_id ? policyOf(row.joiner_outbound, row.joiner_inbound) : null,
    sameOrganization: row.joiner_org_id !== null && row.joiner_org_id === row.book_org_id,
    actorIsBookOrgAdmin: row.actor_is_admin,
  });
}

/**
 * May `userId` be granted a membership in `bookId` under the sharing policy
 * of the organizations on either side? Membership as such (who may invite,
 * roles) is decided by the caller; this only answers the boundary question.
 * Asked by `addMember` and the invitation accept before anything is written.
 */
export async function sharingPolicyAllows(
  db: SqlExecutor,
  grant: { bookId: string; userId: string; actorUserId: string },
): Promise<boolean> {
  return (await sharingDecisionFor(db, grant)).allowed;
}

/**
 * At invitation creation: may `actorUserId` invite `email` into `bookId`?
 * Outbound only. An inbound refusal is the invitee's organization's business
 * and reaches the invitee at accept, so an outside book's owner learns
 * nothing about the invitee's organization here (CN-P3).
 */
export async function outboundSharingAllowsInvitation(
  db: SqlExecutor,
  invitation: { bookId: string; email: string; actorUserId: string },
): Promise<SharingDecision> {
  const books = await db.execute(sql`
    SELECT bo.id AS book_org_id, NOT bo.is_personal AS book_org_company,
           bo.outbound_sharing AS book_outbound, bo.inbound_sharing AS book_inbound,
           ${activeManagerOf(sql`bo.id`, invitation.actorUserId)} AS actor_is_admin
    FROM claimnet.groups g
    JOIN claimnet.organizations bo ON bo.id = g.organization_id
    WHERE g.id = ${invitation.bookId}::uuid
  `);
  const book = (books as unknown as Array<{
    book_org_id: string; book_org_company: boolean; book_outbound: string; book_inbound: string; actor_is_admin: boolean;
  }>)[0];
  if (!book) return NO_BOOK;
  if (!book.book_org_company) return { allowed: true };

  const inside = await db.execute(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM claimnet.organization_members om
        JOIN claimnet.users iu ON iu.id = om.user_id
        WHERE om.organization_id = ${book.book_org_id}::uuid AND lower(iu.email) = lower(${invitation.email})
      )
      OR ${domainVerifiedFor(book.book_org_id, emailDomain(invitation.email))}
    ) AS inside
  `);
  return decideMembershipSharing({
    bookOrgPolicy: policyOf(book.book_outbound, book.book_inbound),
    joinerOrgPolicy: null,
    sameOrganization: (inside as unknown as Array<{ inside: boolean }>)[0]?.inside === true,
    actorIsBookOrgAdmin: book.actor_is_admin,
  });
}

/** May `actorUserId` re-file a recipe from `sourceBookId` into `destinationBookId`? */
export async function sharingAllowsRefile(
  db: SqlExecutor,
  move: { sourceBookId: string; destinationBookId: string; actorUserId: string },
): Promise<SharingDecision> {
  const rows = await db.execute(sql`
    SELECT NOT so.is_personal AS source_org_company,
           so.outbound_sharing AS source_outbound, so.inbound_sharing AS source_inbound,
           dg.organization_id = sg.organization_id AS same_organization,
           ${activeManagerOf(sql`so.id`, move.actorUserId)} AS actor_is_admin
    FROM claimnet.groups sg
    JOIN claimnet.organizations so ON so.id = sg.organization_id
    JOIN claimnet.groups dg ON dg.id = ${move.destinationBookId}::uuid
    WHERE sg.id = ${move.sourceBookId}::uuid
  `);
  const row = (rows as unknown as Array<{
    source_org_company: boolean; source_outbound: string; source_inbound: string; same_organization: boolean; actor_is_admin: boolean;
  }>)[0];
  if (!row) return NO_BOOK;
  return decideRefileSharing({
    sourceOrgPolicy: row.source_org_company ? policyOf(row.source_outbound, row.source_inbound) : null,
    destinationInSameOrganization: row.same_organization,
    actorIsSourceOrgAdmin: row.actor_is_admin,
  });
}

// ── The Books page's review counts (CN-B1, CN-P5) ──────────────────────────

export interface OrgWideBookSummary {
  id: string;
  name: string;
  isDefault: boolean;
  members: number;
  /** Members who don't hold the organization's membership row. */
  outsideMembers: number;
}

export interface OrgBookSummary {
  orgWideBooks: OrgWideBookSummary[];
  /** How many private books the organization holds: a number, never their names or ids. */
  privateBooks: number;
  /** How many distinct people outside the organization belong to any of its private books. */
  outsidePeopleInPrivateBooks: number;
}

/**
 * The organization's books as its owners and admins may see them: org-wide
 * books by name with member and outsider counts, private books only as
 * totals (recipes 57fc1eee, 2738f7a9). Recipe counts are added by the caller.
 */
export async function orgBookSummary(db: SqlExecutor, organizationId: string): Promise<OrgBookSummary> {
  const outsider = sql`NOT EXISTS (
    SELECT 1 FROM claimnet.organization_members om
    WHERE om.organization_id = ${organizationId}::uuid AND om.user_id = gm.user_id
  )`;
  const books = await db.execute(sql`
    SELECT g.id, g.name, g.org_default AS "isDefault",
           (SELECT count(*)::int FROM claimnet.group_members gm WHERE gm.group_id = g.id AND ${countsAsMembership("gm")}) AS members,
           (SELECT count(*)::int FROM claimnet.group_members gm WHERE gm.group_id = g.id AND ${countsAsMembership("gm")} AND ${outsider}) AS "outsideMembers"
    FROM claimnet.groups g
    WHERE g.organization_id = ${organizationId}::uuid AND g.org_wide
    ORDER BY g.org_default DESC, g.name ASC, g.id ASC
  `);
  const totals = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM claimnet.groups g WHERE g.organization_id = ${organizationId}::uuid AND NOT g.org_wide) AS "privateBooks",
      (SELECT count(DISTINCT gm.user_id)::int FROM claimnet.group_members gm
        JOIN claimnet.groups g ON g.id = gm.group_id
        WHERE g.organization_id = ${organizationId}::uuid AND NOT g.org_wide AND ${countsAsMembership("gm")} AND ${outsider}) AS "outsidePeopleInPrivateBooks"
  `);
  const total = (totals as unknown as Array<{ privateBooks: number; outsidePeopleInPrivateBooks: number }>)[0];
  return {
    orgWideBooks: books as unknown as OrgWideBookSummary[],
    privateBooks: total?.privateBooks ?? 0,
    outsidePeopleInPrivateBooks: total?.outsidePeopleInPrivateBooks ?? 0,
  };
}
