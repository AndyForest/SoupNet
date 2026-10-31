/**
 * Company organizations: membership, the join, org-wide books, and the org
 * admin's actions (organization accounts round 1, stream Core; rubric
 * docs/planning/org-accounts-build/core.md).
 *
 * Every statement on `claimnet.organization_members`, and every write of an
 * org-provenance membership row (`group_members.via = 'org'`), lives in this
 * file; the seam guard fails the build on any other reader. Other code asks
 * the functions here, or composes `orgMembersOf` / `orgMemberCount`.
 *
 * The shape (recipes 42044de1, 2e1e4624, 4da95a34):
 *   - An account is managed exactly when it holds a row here; it holds at most
 *     one (unique user_id). There is no flag to drift from the row.
 *   - An org-wide book is ordinary membership rows, one per member, tagged
 *     'org'. Disabled members keep theirs: whether they can act is decided by
 *     the account-state join (account-state.ts), so re-enabling rebuilds
 *     nothing. A row granted directly is never removed or re-roled here.
 *   - One join for every way in. It moves the books the person owns in their
 *     personal organization under the company, adds the org-wide books, and
 *     checks its own authority, because whoever can make it fire takes
 *     control of the account's corpus.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  bookRoleForOrgRole,
  hasFreeSeat,
  orgActionRefusal,
  slugForMovedBook,
} from "@soupnet/domain";
import type { MovedBook, OrgJoinedVia, OrgMemberAction, OrgRole } from "@soupnet/domain";
import type { AuditAction } from "../services/audit-actions";
import { domainVerifiedFor } from "./domain-authority";
import { membershipOf } from "./membership-sql";

/** Runs on the root connection or inside a transaction. */
type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

// ── Fragments for other modules ─────────────────────────────────────────────
//
// A fragment that takes a column of the caller's statement gives its own
// tables prefixed aliases (home_, managed_, count_), never the short ones
// callers use (u, o, om). Otherwise a caller passing sql`u.id` from its own
// `claimnet.users u` would have the subquery's `u` shadow it, so the
// condition would compare a row with itself and match every user (found by
// stream Console). account-state.ts is the opposite convention on purpose:
// its fragments are written against the caller's `u`.

/**
 * An organization's members as a derived table: (user_id, role, joined_via,
 * disabled_at, joined_at). For the console's member list, which joins its
 * aggregates onto it by user id rather than naming the table.
 */
export function orgMembersOf(organizationId: string): SQL {
  return sql`(
    SELECT om.user_id, om.role, om.joined_via, om.disabled_at, om.joined_at
    FROM claimnet.organization_members om
    WHERE om.organization_id = ${organizationId}::uuid
  )`;
}

/**
 * Is the account in `userIdColumn` (a column of the enclosing statement)
 * managed: does it hold a company organization membership, disabled or not?
 * For counts that must leave managed accounts out, such as the public signup
 * cap (org seats are the operator's allowance outside it, recipe 15b767de).
 */
export function accountIsManaged(userIdColumn: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM claimnet.organization_members managed_om WHERE managed_om.user_id = ${userIdColumn})`;
}

/**
 * Per member of an organization, how many of its books they hold a
 * membership in, split into private and org-wide: a derived table of
 * (user_id, private_books, org_wide_books). For the console's member list,
 * which shows counts and never book names (program §3.6).
 */
export function orgMemberBookCounts(organizationId: string): SQL {
  return sql`(
    SELECT om.user_id,
           count(g.id) FILTER (WHERE NOT g.org_wide)::int AS private_books,
           count(g.id) FILTER (WHERE g.org_wide)::int AS org_wide_books
    FROM claimnet.organization_members om
    LEFT JOIN claimnet.group_members gm ON ${membershipOf("gm", sql`om.user_id`)}
    LEFT JOIN claimnet.groups g ON g.id = gm.group_id AND g.organization_id = om.organization_id
    WHERE om.organization_id = ${organizationId}::uuid
    GROUP BY om.user_id
  )`;
}

/**
 * How many members the organization in `organizationIdColumn` (a column of
 * the enclosing statement, written by the module's callers, never caller
 * input) has; `activeOnly` counts those who take a seat.
 */
export function orgMemberCount(organizationIdColumn: SQL, options: { activeOnly: boolean }): SQL {
  const active = options.activeOnly ? sql`AND count_om.disabled_at IS NULL` : sql``;
  return sql`(SELECT count(*)::int FROM claimnet.organization_members count_om
    WHERE count_om.organization_id = ${organizationIdColumn} ${active})`;
}

/**
 * The organization new books, imports and workspaces of the account in
 * `userIdColumn` land in: its company organization when it is managed, else
 * its pinned personal organization, else the oldest organization it owns.
 * NULL only for an account that owns none.
 */
export function homeOrganizationIdOf(userIdColumn: SQL): SQL {
  return sql`COALESCE(
    (SELECT home_om.organization_id FROM claimnet.organization_members home_om WHERE home_om.user_id = ${userIdColumn}),
    (SELECT home_u.personal_organization_id FROM claimnet.users home_u WHERE home_u.id = ${userIdColumn}),
    (SELECT home_o.id FROM claimnet.organizations home_o WHERE home_o.owner_id = ${userIdColumn}
      ORDER BY home_o.is_personal DESC, home_o.created_at ASC, home_o.id ASC LIMIT 1)
  )`;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export interface ManagedOrganization {
  organizationId: string;
  name: string;
  role: OrgRole;
  joinedVia: OrgJoinedVia;
  disabledAt: Date | null;
}

/** The company organization that manages this account, or null for a personal account. */
export async function managedOrganizationOf(db: SqlExecutor, userId: string): Promise<ManagedOrganization | null> {
  const rows = await db.execute(sql`
    SELECT om.organization_id, o.name, om.role, om.joined_via, om.disabled_at
    FROM claimnet.organization_members om
    JOIN claimnet.organizations o ON o.id = om.organization_id
    WHERE om.user_id = ${userId}::uuid
  `);
  const row = (rows as unknown as Array<{
    organization_id: string; name: string; role: OrgRole; joined_via: OrgJoinedVia; disabled_at: string | null;
  }>)[0];
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    name: row.name,
    role: row.role,
    joinedVia: row.joined_via,
    disabledAt: row.disabled_at ? new Date(row.disabled_at) : null,
  };
}

/**
 * The caller's role in a company organization when they are an active owner
 * or admin of it, else null (a member, a disabled manager, a non-member, an
 * unknown organization). The gate for an org admin's routes; answer null with
 * the uniform 404 (`ORGANIZATION_NOT_FOUND` in @soupnet/domain).
 */
export async function activeOrgManagerRole(db: SqlExecutor, organizationId: string, userId: string): Promise<"owner" | "admin" | null> {
  const rows = await db.execute(sql`
    SELECT om.role FROM claimnet.organization_members om
    JOIN claimnet.organizations o ON o.id = om.organization_id AND NOT o.is_personal
    WHERE om.organization_id = ${organizationId}::uuid AND om.user_id = ${userId}::uuid
      AND om.disabled_at IS NULL AND om.role IN ('owner', 'admin')
  `);
  return (rows as unknown as Array<{ role: "owner" | "admin" }>)[0]?.role ?? null;
}

/** See `homeOrganizationIdOf`. */
export async function homeOrganizationOf(db: SqlExecutor, userId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT ${homeOrganizationIdOf(sql`${userId}::uuid`)} AS id`);
  return (rows as unknown as Array<{ id: string | null }>)[0]?.id ?? null;
}

/**
 * May this account create a recipe book in this organization? A managed
 * account only in its company organization, as an active member (a disabled
 * one never gets this far); any other account only in an organization it
 * owns. A guest of one of a company's books is neither, so is refused.
 */
export async function mayCreateBookIn(db: SqlExecutor, userId: string, organizationId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM claimnet.organization_members om WHERE om.user_id = ${userId}::uuid)
        THEN EXISTS (
          SELECT 1 FROM claimnet.organization_members om
          WHERE om.user_id = ${userId}::uuid AND om.organization_id = ${organizationId}::uuid
            AND om.disabled_at IS NULL
        )
      ELSE EXISTS (
        SELECT 1 FROM claimnet.organizations o
        WHERE o.id = ${organizationId}::uuid AND o.owner_id = ${userId}::uuid
      )
    END AS allowed
  `);
  return (rows as unknown as Array<{ allowed: boolean }>)[0]?.allowed === true;
}

// ── The join ────────────────────────────────────────────────────────────────

/**
 * Who is making the join happen. The routine checks it itself, in the join's
 * transaction (security audit, rubric stage): a join moves every book a
 * person owns into the company, so it never fires on a caller's say-so.
 *   - operator: the site operator (users.role = 'system');
 *   - domain: a domain the organization has verified, which must also be the
 *     joining account's email domain (Domains supplies `domainVerifiedFor`).
 */
export type JoinAuthority =
  | { kind: "operator"; actorUserId: string }
  | { kind: "domain"; domain: string };

export type JoinRefusal =
  | "not_authorized"
  | "organization_not_found"
  | "unknown_account"
  | "already_a_member"
  | "already_in_an_organization"
  | "organization_full";

export type JoinResult =
  | { ok: true; movedBooks: MovedBook[]; email: string; organizationName: string; noticeOwed: boolean }
  | { ok: false; refusal: JoinRefusal };

export interface JoinInput {
  organizationId: string;
  userId: string;
  role: OrgRole;
  via: OrgJoinedVia;
  authority: JoinAuthority;
}

/** Which arrivals each authority may record. */
const VIA_FOR_AUTHORITY: Record<JoinAuthority["kind"], readonly OrgJoinedVia[]> = {
  operator: ["created", "operator"],
  domain: ["domain", "migrated"],
};

/**
 * Join an account to a company organization, in one transaction. Callers
 * outside the module go through services/organization.service.ts, which sends
 * the notice this records as owed.
 */
export async function joinOrganization(db: PostgresJsDatabase, input: JoinInput): Promise<JoinResult> {
  return db.transaction(async (tx) => joinOrganizationInTx(tx, input));
}

/**
 * The join inside a caller's transaction, for a caller whose own writes must
 * roll back with it (Domains' verification click, SSO's Google sign-up). It
 * takes the organization row lock first, so call it before anything else in
 * the transaction that could wait on that row. A refusal is returned, not
 * thrown: the caller's transaction decides whether to roll back. After the
 * caller commits, it sends the notice with `sendJoinNotice`
 * (services/organization.service.ts).
 */
export async function joinOrganizationInTx(tx: SqlExecutor, input: JoinInput): Promise<JoinResult> {
  const { organizationId, userId, role, via, authority } = input;
  if (!VIA_FOR_AUTHORITY[authority.kind].includes(via)) return { ok: false, refusal: "not_authorized" };

  // The organization row lock serializes joins and re-enables, so two of them
  // racing for the last seat can't both see it free.
  const orgRows = await tx.execute(sql`
    SELECT id, name, seat_limit FROM claimnet.organizations
    WHERE id = ${organizationId}::uuid AND NOT is_personal
    FOR UPDATE
  `);
  const org = (orgRows as unknown as Array<{ id: string; name: string; seat_limit: number | null }>)[0];
  if (!org) return { ok: false, refusal: "organization_not_found" };

  const userRows = await tx.execute(sql`
    SELECT u.email, u.personal_organization_id FROM claimnet.users u
    WHERE u.id = ${userId}::uuid
    FOR UPDATE
  `);
  const account = (userRows as unknown as Array<{ email: string; personal_organization_id: string | null }>)[0];
  if (!account) return { ok: false, refusal: "unknown_account" };

  if (!(await authorityHolds(tx, authority, organizationId, account.email))) {
    return { ok: false, refusal: "not_authorized" };
  }

  const existing = await tx.execute(sql`
    SELECT organization_id FROM claimnet.organization_members WHERE user_id = ${userId}::uuid
  `);
  const current = (existing as unknown as Array<{ organization_id: string }>)[0];
  if (current) {
    return { ok: false, refusal: current.organization_id === organizationId ? "already_a_member" : "already_in_an_organization" };
  }

  if (!hasFreeSeat(org.seat_limit, await activeMemberCount(tx, organizationId))) {
    return { ok: false, refusal: "organization_full" };
  }

  await tx.execute(sql`
    INSERT INTO claimnet.organization_members (organization_id, user_id, role, joined_via)
    VALUES (${organizationId}::uuid, ${userId}::uuid, ${role}, ${via})
  `);

  const movedBooks = await moveOwnBooksInto(tx, userId, account, organizationId);

  // Every org-wide book of the organization, as an 'org' row; a row the
  // account already holds (a direct invitation) is left exactly as it is.
  await tx.execute(sql`
    INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write, via)
    SELECT g.id, ${userId}::uuid, ${bookRoleForOrgRole(role)}, g.org_default, g.org_default, 'org'
    FROM claimnet.groups g
    WHERE g.organization_id = ${organizationId}::uuid AND g.org_wide
    ON CONFLICT (group_id, user_id) DO NOTHING
  `);

  // A new account on a verified domain was just made by the sign-up it
  // arrived through; every other arrival is an account that existed, and is
  // told ("worth doing because it is cheap", settled simplifications). The
  // audit row is the record that the notice is owed; the logged sender's
  // email_log row is the record of how the send went.
  const noticeOwed = via !== "domain";
  await tx.execute(sql`
    INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (
      ${authority.kind === "operator" ? authority.actorUserId : null}::uuid,
      'organization.member_joined', 'organization', ${organizationId}::uuid,
      ${JSON.stringify({ userId, role, via, authority: authority.kind, movedBooks, noticeOwed })}::jsonb
    )
  `);

  return { ok: true, movedBooks, email: account.email, organizationName: org.name, noticeOwed };
}

async function authorityHolds(tx: SqlExecutor, authority: JoinAuthority, organizationId: string, email: string): Promise<boolean> {
  if (authority.kind === "operator") {
    const rows = await tx.execute(sql`
      SELECT 1 FROM claimnet.users WHERE id = ${authority.actorUserId}::uuid AND role = 'system'
    `);
    return (rows as unknown as unknown[]).length > 0;
  }
  const domain = authority.domain.trim().toLowerCase();
  if (!domain || email.slice(email.lastIndexOf("@") + 1).toLowerCase() !== domain) return false;
  const rows = await tx.execute(sql`SELECT ${domainVerifiedFor(organizationId, domain)} AS verified`);
  return (rows as unknown as Array<{ verified: boolean }>)[0]?.verified === true;
}

async function activeMemberCount(tx: SqlExecutor, organizationId: string): Promise<number> {
  const rows = await tx.execute(sql`SELECT ${orgMemberCount(sql`${organizationId}::uuid`, { activeOnly: true })} AS n`);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

/**
 * Move every book in the account's personal organization under the company,
 * keeping ids (and so memberships, keys and recipes), changing a slug only on
 * a collision. Books others shared with the account are in their owners'
 * organizations and stay there. Each move gets its own audit row naming the
 * book's old slug.
 */
async function moveOwnBooksInto(
  tx: SqlExecutor,
  userId: string,
  account: { email: string; personal_organization_id: string | null },
  organizationId: string,
): Promise<MovedBook[]> {
  if (!account.personal_organization_id) return [];
  const books = (await tx.execute(sql`
    SELECT g.id, g.name, g.slug FROM claimnet.groups g
    JOIN claimnet.organizations o ON o.id = g.organization_id
    WHERE g.organization_id = ${account.personal_organization_id}::uuid
      AND o.is_personal AND o.owner_id = ${userId}::uuid
    ORDER BY g.created_at, g.id
    FOR UPDATE OF g
  `)) as unknown as Array<{ id: string; name: string; slug: string }>;
  if (books.length === 0) return [];

  const takenRows = (await tx.execute(sql`
    SELECT slug FROM claimnet.groups WHERE organization_id = ${organizationId}::uuid
  `)) as unknown as Array<{ slug: string }>;
  const taken = new Set(takenRows.map((r) => r.slug));
  const localPart = account.email.slice(0, account.email.lastIndexOf("@"));

  const moved: MovedBook[] = [];
  for (const book of books) {
    const slug = slugForMovedBook(book.slug, localPart, taken);
    taken.add(slug);
    await tx.execute(sql`
      UPDATE claimnet.groups SET organization_id = ${organizationId}::uuid, slug = ${slug}, updated_at = NOW()
      WHERE id = ${book.id}::uuid
    `);
    await tx.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (${userId}::uuid, 'recipe_book.moved_into_organization', 'group', ${book.id}::uuid,
        ${JSON.stringify({ previousOrganizationId: account.personal_organization_id, organizationId, previousSlug: book.slug, slug })}::jsonb)
    `);
    moved.push({ name: book.name, slug, previousSlug: book.slug });
  }
  return moved;
}

// ── Creating an organization ────────────────────────────────────────────────

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerUserId: string;
  seatLimit: number | null;
  actorUserId: string;
}

export type CreateOrganizationResult =
  | { ok: true; organizationId: string; defaultBookId: string; join: Extract<JoinResult, { ok: true }> }
  | { ok: false; refusal: JoinRefusal | "slug_taken" };

/**
 * The site operator creates a company organization (the first release's
 * tracer bullet): the organization, its default book (org-wide, the owner its
 * owner and opted into daily links), and the owner's join. One transaction:
 * if the owner can't join, nothing is created.
 */
export async function createOrganization(db: PostgresJsDatabase, input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  try {
    return await db.transaction(async (tx) => {
      const operator = await tx.execute(sql`
        SELECT 1 FROM claimnet.users WHERE id = ${input.actorUserId}::uuid AND role = 'system'
      `);
      if ((operator as unknown as unknown[]).length === 0) return { ok: false as const, refusal: "not_authorized" as const };

      const slugUsed = await tx.execute(sql`SELECT 1 FROM claimnet.organizations WHERE slug = ${input.slug}`);
      if ((slugUsed as unknown as unknown[]).length > 0) return { ok: false as const, refusal: "slug_taken" as const };

      const orgRows = await tx.execute(sql`
        INSERT INTO claimnet.organizations (name, slug, owner_id, is_personal, seat_limit)
        VALUES (${input.name}, ${input.slug}, ${input.ownerUserId}::uuid, false, ${input.seatLimit})
        RETURNING id
      `);
      const organizationId = (orgRows as unknown as Array<{ id: string }>)[0]!.id;

      const bookRows = await tx.execute(sql`
        INSERT INTO claimnet.groups (name, slug, organization_id, org_wide, org_default)
        VALUES (${input.name}, ${input.slug}, ${organizationId}::uuid, true, true)
        RETURNING id
      `);
      const defaultBookId = (bookRows as unknown as Array<{ id: string }>)[0]!.id;
      await tx.execute(sql`
        INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write, via)
        VALUES (${defaultBookId}::uuid, ${input.ownerUserId}::uuid, 'owner', true, true, 'direct')
      `);

      const join = await joinOrganizationInTx(tx, {
        organizationId,
        userId: input.ownerUserId,
        role: "owner",
        via: "created",
        authority: { kind: "operator", actorUserId: input.actorUserId },
      });
      // Roll the whole creation back when the owner can't join.
      if (!join.ok) throw new JoinRollback(join.refusal);
      return { ok: true as const, organizationId, defaultBookId, join };
    });
  } catch (err) {
    if (err instanceof JoinRollback) return { ok: false, refusal: err.refusal };
    throw err;
  }
}

class JoinRollback extends Error {
  constructor(readonly refusal: JoinRefusal) {
    super(`organization join refused: ${refusal}`);
  }
}

// ── Org-wide books ──────────────────────────────────────────────────────────

export type OrgWideRefusal = "not_a_company_book" | "default_book_stays_org_wide" | "book_not_found";

/**
 * Make a book org-wide or private. Org-wide writes an 'org' row for every
 * member of the book's company organization (owners and admins as the book's
 * admin, members as member; daily links excluded, as for any newly joined
 * book), leaving any row a person already holds. Private deletes the 'org'
 * rows and keeps every direct one. The caller has already authorized the
 * actor on the book (book owner or admin).
 */
export async function setBookOrgWide(db: PostgresJsDatabase, bookId: string, orgWide: boolean): Promise<OrgWideRefusal | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT g.org_default, o.is_personal FROM claimnet.groups g
      JOIN claimnet.organizations o ON o.id = g.organization_id
      WHERE g.id = ${bookId}::uuid
      FOR UPDATE OF g
    `);
    const book = (rows as unknown as Array<{ org_default: boolean; is_personal: boolean }>)[0];
    if (!book) return "book_not_found";
    if (orgWide && book.is_personal) return "not_a_company_book";
    if (!orgWide && book.org_default) return "default_book_stays_org_wide";

    await tx.execute(sql`UPDATE claimnet.groups SET org_wide = ${orgWide}, updated_at = NOW() WHERE id = ${bookId}::uuid`);
    if (orgWide) {
      await tx.execute(sql`
        INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write, via)
        SELECT g.id, om.user_id,
               CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' ELSE 'member' END,
               false, false, 'org'
        FROM claimnet.groups g
        JOIN claimnet.organization_members om ON om.organization_id = g.organization_id
        WHERE g.id = ${bookId}::uuid
        ON CONFLICT (group_id, user_id) DO NOTHING
      `);
    } else {
      await tx.execute(sql`DELETE FROM claimnet.group_members WHERE group_id = ${bookId}::uuid AND via = 'org'`);
    }
    return null;
  });
}

// ── The org admin's actions ─────────────────────────────────────────────────

/** A named map so the audit classification's source scan can read them. */
const MEMBER_AUDIT_ACTIONS: Record<OrgMemberAction["kind"], AuditAction> = {
  disable: "organization.member_disable",
  enable: "organization.member_enable",
  set_role: "organization.member_set_role",
};

export type MemberActionRefusal =
  /** The actor is not an active manager of the organization, the
   *  organization doesn't exist, or the target isn't a member: one answer,
   *  so a non-member learns nothing about who is in it. */
  | "not_found"
  | "cannot_act_on_self"
  | "owner_only"
  | "organization_full";

export interface MemberActionInput {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  action: OrgMemberAction;
}

/**
 * Disable, re-enable, or change the role of a member, as an org owner or
 * admin. The decision and the write are one transaction under the
 * organization's row lock (a re-enable takes a seat). Disable and re-enable
 * touch the one row's disabled_at and nothing else: every key, refresh token
 * and session is judged against it on its next request. A role change
 * rewrites the role on the member's 'org' rows only.
 */
export async function actOnMember(db: PostgresJsDatabase, input: MemberActionInput): Promise<MemberActionRefusal | null> {
  const { organizationId, actorUserId, targetUserId, action } = input;
  return db.transaction(async (tx) => {
    const orgRows = await tx.execute(sql`
      SELECT seat_limit FROM claimnet.organizations WHERE id = ${organizationId}::uuid AND NOT is_personal FOR UPDATE
    `);
    const org = (orgRows as unknown as Array<{ seat_limit: number | null }>)[0];
    if (!org) return "not_found";

    const actorRows = await tx.execute(sql`
      SELECT om.role FROM claimnet.organization_members om
      WHERE om.organization_id = ${organizationId}::uuid AND om.user_id = ${actorUserId}::uuid
        AND om.disabled_at IS NULL
    `);
    const actorRole = (actorRows as unknown as Array<{ role: OrgRole }>)[0]?.role ?? null;

    const targetRows = await tx.execute(sql`
      SELECT om.role, om.disabled_at FROM claimnet.organization_members om
      WHERE om.organization_id = ${organizationId}::uuid AND om.user_id = ${targetUserId}::uuid
      FOR UPDATE
    `);
    const target = (targetRows as unknown as Array<{ role: OrgRole; disabled_at: string | null }>)[0];
    if (!target || actorRole === null) return "not_found";

    const refusal = orgActionRefusal(actorRole, target.role, action, actorUserId === targetUserId);
    if (refusal === "not_a_manager") return "not_found";
    if (refusal) return refusal;

    if (action.kind === "disable") {
      await tx.execute(sql`
        UPDATE claimnet.organization_members
        SET disabled_at = COALESCE(disabled_at, NOW()), disabled_by = COALESCE(disabled_by, ${actorUserId}::uuid)
        WHERE organization_id = ${organizationId}::uuid AND user_id = ${targetUserId}::uuid
      `);
    } else if (action.kind === "enable") {
      if (target.disabled_at !== null && !hasFreeSeat(org.seat_limit, await activeMemberCount(tx, organizationId))) {
        return "organization_full";
      }
      await tx.execute(sql`
        UPDATE claimnet.organization_members SET disabled_at = NULL, disabled_by = NULL
        WHERE organization_id = ${organizationId}::uuid AND user_id = ${targetUserId}::uuid
      `);
    } else {
      await tx.execute(sql`
        UPDATE claimnet.organization_members SET role = ${action.role}
        WHERE organization_id = ${organizationId}::uuid AND user_id = ${targetUserId}::uuid
      `);
      await tx.execute(sql`
        UPDATE claimnet.group_members gm SET role = ${bookRoleForOrgRole(action.role)}
        FROM claimnet.groups g
        WHERE gm.group_id = g.id AND g.organization_id = ${organizationId}::uuid
          AND ${membershipOf("gm", targetUserId)} AND gm.via = 'org'
      `);
    }

    await tx.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (${actorUserId}::uuid, ${MEMBER_AUDIT_ACTIONS[action.kind]}, 'user', ${targetUserId}::uuid,
        ${JSON.stringify({ organizationId, ...(action.kind === "set_role" ? { role: action.role, previousRole: target.role } : {}) })}::jsonb)
    `);
    return null;
  });
}

// ── Account deletion ────────────────────────────────────────────────────────

/**
 * The deletion cascade's first step for company organizations the departing
 * account owns (organizations.owner_id): one that still has other members
 * passes to the longest-standing of its owners, else admins, else members,
 * who is made an owner if they weren't. It stays a company organization, so
 * its books stay under the company and are never handed into anyone's
 * personal organization by book succession. One with no other member is
 * left to the teardown, which deletes it with the account's own books.
 *
 * Self-service deletion never reaches a managed account (DELETE /auth/me
 * refuses it); this is for the cascade's other callers (test-data cleanup).
 */
export async function handOverOrganizationsOwnedBy(tx: SqlExecutor, userId: string): Promise<void> {
  const orgs = (await tx.execute(sql`
    SELECT o.id FROM claimnet.organizations o
    WHERE o.owner_id = ${userId}::uuid AND NOT o.is_personal
    ORDER BY o.id
    FOR UPDATE
  `)) as unknown as Array<{ id: string }>;
  for (const { id } of orgs) {
    const next = (await tx.execute(sql`
      SELECT om.user_id, om.role FROM claimnet.organization_members om
      WHERE om.organization_id = ${id}::uuid AND om.user_id <> ${userId}::uuid
      ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, om.joined_at, om.user_id
      LIMIT 1
    `)) as unknown as Array<{ user_id: string; role: OrgRole }>;
    const successor = next[0];
    if (!successor) continue;
    await tx.execute(sql`UPDATE claimnet.organizations SET owner_id = ${successor.user_id}::uuid, updated_at = NOW() WHERE id = ${id}::uuid`);
    if (successor.role !== "owner") {
      await tx.execute(sql`
        UPDATE claimnet.organization_members SET role = 'owner'
        WHERE organization_id = ${id}::uuid AND user_id = ${successor.user_id}::uuid
      `);
      await tx.execute(sql`
        UPDATE claimnet.group_members gm SET role = 'admin'
        FROM claimnet.groups g
        WHERE gm.group_id = g.id AND g.organization_id = ${id}::uuid
          AND ${membershipOf("gm", successor.user_id)} AND gm.via = 'org'
      `);
    }
    await tx.execute(sql`
      INSERT INTO claimnet.audit_log (actor_user_id, action, target_type, target_id, metadata)
      VALUES (${userId}::uuid, 'organization.owner_handed_over', 'organization', ${id}::uuid,
        ${JSON.stringify({ reason: "owner_account_deleted", newOwnerUserId: successor.user_id })}::jsonb)
    `);
  }
}

/** The deletion cascade's step: the account's company membership row goes before the user row (its foreign key). */
export async function removeOrganizationMembershipOf(tx: SqlExecutor, userId: string): Promise<void> {
  await tx.execute(sql`DELETE FROM claimnet.organization_members WHERE user_id = ${userId}::uuid`);
}
