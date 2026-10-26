/**
 * The admin-action events an organization's Activity view and a member's own
 * page show (organization accounts round 1, stream Console; rubric
 * docs/planning/org-accounts-build/console.md, CN-L1, CN-L2).
 *
 * Which actions, and how each reads, is @soupnet/domain's allowlist
 * (org-activity.ts). This file finds the rows and reads exactly two facts out
 * of their metadata server-side, the join's authority and a role change's
 * new role, plus the joiner's id to name them; nothing else of the metadata
 * is selected, so it can't be sent.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { orgActivityActionsFor, orgActivityEvent } from "@soupnet/domain";
import type { OrgActivityEvent } from "@soupnet/domain";

export interface OrgActivityPage {
  events: OrgActivityEvent[];
  limit: number;
  offset: number;
}

interface Row {
  action: string;
  at: string;
  actor_email: string | null;
  target_email: string | null;
  join_authority: string | null;
  new_role: string | null;
}

async function readEvents(db: PostgresJsDatabase, actions: string[], scope: SQL, limit: number, offset: number): Promise<OrgActivityEvent[]> {
  if (actions.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT a.action, a.occurred_at AS at, au.email AS actor_email,
           COALESCE(tu.email, ju.email) AS target_email,
           a.metadata->>'authority' AS join_authority,
           CASE WHEN a.action = 'organization.member_set_role' THEN a.metadata->>'role' END AS new_role
    FROM claimnet.audit_log a
    LEFT JOIN claimnet.users au ON au.id = a.actor_user_id
    LEFT JOIN claimnet.users tu ON a.target_type = 'user' AND tu.id = a.target_id
    LEFT JOIN claimnet.users ju ON a.action = 'organization.member_joined'
      AND ju.id::text = a.metadata->>'userId'
    WHERE a.action IN (${sql.join(actions.map((name) => sql`${name}`), sql`, `)})
      AND ${scope}
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return (rows as unknown as Row[]).flatMap((r) => {
    const event = orgActivityEvent({
      action: r.action,
      actorEmail: r.actor_email,
      targetEmail: r.target_email,
      at: new Date(r.at).toISOString(),
      joinAuthority: r.join_authority,
      newRole: r.new_role,
    });
    return event ? [event] : [];
  });
}

function page(query: Partial<Record<string, string | undefined>>): { limit: number; offset: number } {
  return {
    limit: Math.min(parseInt(query["limit"] ?? "50", 10) || 50, 200),
    offset: Math.min(Math.max(parseInt(query["offset"] ?? "0", 10) || 0, 0), 10_000),
  };
}

/** Admin actions on this organization and its members, newest first. */
export async function orgActivity(
  db: PostgresJsDatabase,
  organizationId: string,
  query: Partial<Record<string, string | undefined>>,
): Promise<OrgActivityPage> {
  const { limit, offset } = page(query);
  const scope = sql`(
    (a.target_type = 'organization' AND a.target_id = ${organizationId}::uuid)
    OR (a.target_type = 'user' AND a.metadata->>'organizationId' = ${organizationId})
  )`;
  return { events: await readEvents(db, orgActivityActionsFor("org"), scope, limit, offset), limit, offset };
}

/** The admin actions that touched this person's account, newest first, at most `limit`. */
export async function memberActivity(db: PostgresJsDatabase, userId: string, limit = 20): Promise<OrgActivityEvent[]> {
  const scope = sql`(
    (a.target_type = 'user' AND a.target_id = ${userId}::uuid)
    OR (a.action = 'organization.member_joined' AND a.metadata->>'userId' = ${userId})
  )`;
  return readEvents(db, orgActivityActionsFor("member"), scope, limit, 0);
}

export interface SignIn {
  at: string;
  method: "password" | "google";
}

/** This person's own recent sign-ins (CN-T2): time and method only. Never read for anyone else. */
export async function recentSignIns(db: PostgresJsDatabase, userId: string, limit = 10): Promise<SignIn[]> {
  const rows = await db.execute(sql`
    SELECT a.occurred_at AS at, a.metadata->>'method' AS method
    FROM claimnet.audit_log a
    WHERE a.action = 'auth.signed_in' AND a.actor_user_id = ${userId}::uuid AND a.target_id = ${userId}::uuid
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT ${limit}
  `);
  return (rows as unknown as Array<{ at: string; method: string | null }>).flatMap((r) =>
    r.method === "password" || r.method === "google" ? [{ at: new Date(r.at).toISOString(), method: r.method }] : [],
  );
}
