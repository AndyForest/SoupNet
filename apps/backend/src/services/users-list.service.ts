/**
 * The users list both admin consoles read (organization accounts round 1,
 * stream Console; rubric docs/planning/org-accounts-build/console.md, CN-M1,
 * CN-G3, CN-U1 to CN-U3; recipe 1fa21e31).
 *
 * One predicate array, one sort whitelist, one count query and one page, for
 * every scope:
 *   - the site operator listing every account (GET /admin/users);
 *   - the site operator listing one organization's members
 *     (GET /admin/organizations/:id/members);
 *   - an org owner or admin listing their own organization's members
 *     (GET /organizations/:id/members).
 *
 * What a viewer gets is decided by `columnsFor` in @soupnet/domain: only
 * those columns are selected, so a column outside an org admin's set is never
 * computed for them. Filters and sorts are whitelisted per viewer in the same
 * spirit: filtering or ordering by a site-only column would tell an org admin
 * that column's value, so an org viewer's request for one is ignored.
 *
 * The caller decides who may ask (the routes' gates); this service only
 * shapes the answer. An org listing anchors on the authz module's
 * `orgMembersOf`, never on the membership table itself.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { columnsFor } from "@soupnet/domain";
import type { AdminViewer } from "@soupnet/domain";
import {
  accountDisabledReason,
  homeOrganizationIdOf,
  orgMemberBookCounts,
  orgMembersOf,
  publishedTrace,
} from "../authz";

export interface UsersListScope {
  viewer: AdminViewer;
  /** List this organization's members; omit to list every account (site operator only). */
  organizationId?: string;
}

/** Query parameters as the routes receive them (strings, unvalidated). */
export type UsersListQuery = Partial<Record<string, string | undefined>>;

export interface UsersListPage {
  users: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  queriedAt: string;
}

/** A live key: not expired and not used up (the other key readers' test). */
const LIVE_KEY = sql`ak.expires_at > now() AND ak.consumed_at IS NULL`;

/**
 * The SELECT expression for each column key, against `u` (the account) and,
 * for an organization listing, `m` (its membership) and `bc` (its book
 * counts). `orgId` is the listed organization, when there is one.
 */
function columnExpression(key: string, orgId: string | undefined): SQL | null {
  switch (key) {
    case "id":
      return sql`u.id`;
    case "email":
      return sql`u.email`;
    case "displayName":
      return sql`u.display_name`;
    case "status":
      // The account-state rule's own reason, so a directory suspension
      // (stream Offboarding) shows here with no change to this file.
      return sql`(CASE ${accountDisabledReason()} WHEN 'suspended' THEN 'suspended' WHEN 'org_disabled' THEN 'disabled' ELSE 'active' END)`;
    case "lastActiveAt":
      return sql`GREATEST(u.last_login_at, (SELECT max(ak.last_used_at) FROM claimnet.api_keys ak WHERE ak.user_id = u.id))`;
    case "recipeCount":
      // Every account: every recipe, as the site list always counted. One
      // organization: published recipes in that organization's books only; a
      // book owned outside the company isn't company data, and an unresolved
      // draft is private to the person it's about (recipe e36bbef8).
      return orgId
        ? sql`(SELECT count(*)::int FROM claimnet.traces t
            JOIN claimnet.groups g ON g.id = t.group_id AND g.organization_id = ${orgId}::uuid
            WHERE t.user_id = u.id AND ${publishedTrace("t")})`
        : sql`(SELECT count(*)::int FROM claimnet.traces t WHERE t.user_id = u.id)`;
    case "activeKeyCount":
      return sql`(SELECT count(*)::int FROM claimnet.api_keys ak WHERE ak.user_id = u.id AND ${LIVE_KEY})`;
    case "orgRole":
      return sql`m.role`;
    case "joinedVia":
      return sql`m.joined_via`;
    case "joinedAt":
      return sql`m.joined_at`;
    case "privateBookCount":
      return sql`COALESCE(bc.private_books, 0)`;
    case "orgWideBookCount":
      return sql`COALESCE(bc.org_wide_books, 0)`;
    case "role":
      return sql`u.role`;
    case "organization":
      return sql`(SELECT o.name FROM claimnet.organizations o WHERE o.id = ${homeOrganizationIdOf(sql`u.id`)} AND NOT o.is_personal)`;
    case "emailVerifiedAt":
      return sql`u.email_verified_at`;
    case "suspendedAt":
      return sql`u.suspended_at`;
    case "suspendedReason":
      return sql`u.suspended_reason`;
    case "waitlistedAt":
      return sql`u.waitlisted_at`;
    case "premiumAt":
      return sql`u.premium_at`;
    case "signupReason":
      return sql`u.signup_reason`;
    case "lastLoginAt":
      return sql`u.last_login_at`;
    case "createdAt":
      return sql`u.created_at`;
    case "groupCount":
      // Site operator only, for display: the count the site list always showed.
      return sql`(SELECT count(*)::int FROM claimnet.group_members gm WHERE gm.user_id = u.id)`;
    default:
      return null;
  }
}

/** Sortable keys per viewer and listing; the first is the default. */
function sortKeys(viewer: AdminViewer, listing: "all" | "organization"): readonly string[] {
  if (listing === "all") return ["createdAt", "lastLoginAt", "email"];
  return viewer === "site" ? ["joinedAt", "lastActiveAt", "email", "createdAt", "lastLoginAt"] : ["joinedAt", "lastActiveAt", "email"];
}

function yesNo(value: string | undefined, yes: SQL, no: SQL): SQL | null {
  if (value === "yes") return yes;
  if (value === "no") return no;
  return null;
}

/** The filters a viewer may use. An org viewer's site-only filters are ignored. */
function filters(scope: UsersListScope, query: UsersListQuery): SQL[] {
  const where: SQL[] = [];
  const q = query["q"]?.trim();
  if (q) where.push(sql`u.email ILIKE ${"%" + q + "%"}`);

  if (scope.organizationId) {
    const status = query["status"];
    if (status === "active") where.push(sql`${accountDisabledReason()} IS NULL`);
    if (status === "disabled") where.push(sql`${accountDisabledReason()} = 'org_disabled'`);
    if (status === "suspended") where.push(sql`${accountDisabledReason()} = 'suspended'`);
    const orgRole = query["orgRole"];
    if (orgRole === "owner" || orgRole === "admin" || orgRole === "member") where.push(sql`m.role = ${orgRole}`);
  }

  if (scope.viewer !== "site") return where;

  const liveKey = sql`EXISTS (SELECT 1 FROM claimnet.api_keys ak WHERE ak.user_id = u.id AND ${LIVE_KEY})`;
  const role = query["role"];
  for (const clause of [
    yesNo(query["verified"], sql`u.email_verified_at IS NOT NULL`, sql`u.email_verified_at IS NULL`),
    role ? sql`u.role = ${role}` : null,
    yesNo(query["suspended"], sql`u.suspended_at IS NOT NULL`, sql`u.suspended_at IS NULL`),
    yesNo(query["premium"], sql`u.premium_at IS NOT NULL`, sql`u.premium_at IS NULL`),
    yesNo(query["waitlisted"], sql`u.waitlisted_at IS NOT NULL`, sql`u.waitlisted_at IS NULL`),
    yesNo(query["hasKeys"], liveKey, sql`NOT ${liveKey}`),
  ]) {
    if (clause) where.push(clause);
  }
  return where;
}

const SORT_COLUMN: Record<string, string> = {
  createdAt: "u.created_at",
  lastLoginAt: "u.last_login_at",
  email: "u.email",
  joinedAt: "m.joined_at",
  lastActiveAt: '"lastActiveAt"',
};

/** One page of the list for this scope. */
export async function listUsers(db: PostgresJsDatabase, scope: UsersListScope, query: UsersListQuery): Promise<UsersListPage> {
  const listing = scope.organizationId ? "organization" : "all";
  const keys = columnsFor(scope.viewer, listing).map((c) => c.key);
  const limit = Math.min(parseInt(query["limit"] ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(query["offset"] ?? "0", 10) || 0, 0);
  const sortable = sortKeys(scope.viewer, listing);
  const sortBy = sortable.includes(query["sortBy"] ?? "") ? query["sortBy"]! : sortable[0]!;
  const sortDir: "asc" | "desc" = query["sortDir"] === "asc" ? "asc" : "desc";

  // An org admin can only ever list one organization's members.
  if (keys.length === 0) {
    return { users: [], total: 0, limit, offset, sortBy, sortDir, queriedAt: new Date().toISOString() };
  }

  const select = sql.join(
    keys.flatMap((key) => {
      const expression = columnExpression(key, scope.organizationId);
      return expression ? [sql`${expression} AS ${sql.identifier(key)}`] : [];
    }),
    sql`, `,
  );

  const from = scope.organizationId
    ? sql`${orgMembersOf(scope.organizationId)} m
        JOIN claimnet.users u ON u.id = m.user_id
        LEFT JOIN ${orgMemberBookCounts(scope.organizationId)} bc ON bc.user_id = m.user_id`
    : sql`claimnet.users u`;

  const where = filters(scope, query);
  const whereClause = where.length ? sql.join(where, sql` AND `) : sql`TRUE`;
  // The sort expression for a computed column must be selected; lastActiveAt
  // is in every listing that may sort by it.
  const orderClause = sql.raw(`${SORT_COLUMN[sortBy] ?? "u.created_at"} ${sortDir.toUpperCase()} NULLS LAST, u.id ASC`);

  const rows = await db.execute(sql`
    SELECT ${select}
    FROM ${from}
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `);
  const countRows = await db.execute(sql`SELECT count(*)::int AS total FROM ${from} WHERE ${whereClause}`);
  const total = (countRows as unknown as Array<{ total: number }>)[0]?.total ?? 0;

  return {
    users: rows as unknown as Array<Record<string, unknown>>,
    total,
    limit,
    offset,
    sortBy,
    sortDir,
    queriedAt: new Date().toISOString(),
  };
}
