/**
 * The admin-action events an organization's Activity view and a member's own
 * page show (organization accounts round 1, stream Console; rubric
 * docs/planning/org-accounts-build/console.md, CN-L1, CN-L2).
 *
 * Which actions, and how each reads, is @soupnet/domain's allowlist
 * (org-activity.ts). This file finds the rows and reads named facts out of
 * their metadata server-side: the join's authority, a role change's new role
 * and the joiner's id to name them; a directory status's new value; and for a
 * directory connection its kind, domain, failure reason and the three numbers
 * it cleared. Nothing else of the metadata is selected, so it can't be sent.
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
  directory_to: string | null;
  connection_kind: string | null;
  connection_domain: string | null;
  connect_failure: string | null;
  removed_count: string | null;
  by_operator: boolean;
  cleared_suspended: string | null;
  cleared_archived: string | null;
  cleared_deleted: string | null;
}

const CONNECTION_ACTIONS = sql`('organization.directory_connected', 'organization.directory_connect_failed')`;
const CLEARING_ACTIONS = sql`('organization.directory_connected', 'organization.directory_disconnected')`;

async function readEvents(db: PostgresJsDatabase, actions: string[], scope: SQL, limit: number, offset: number): Promise<OrgActivityEvent[]> {
  if (actions.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT a.action, a.occurred_at AS at, au.email AS actor_email,
           COALESCE(tu.email, ju.email) AS target_email,
           a.metadata->>'authority' AS join_authority,
           CASE WHEN a.action = 'organization.member_set_role' THEN a.metadata->>'role' END AS new_role,
           CASE WHEN a.action = 'organization.member_directory_status' THEN a.metadata->>'to' END AS directory_to,
           CASE WHEN a.action IN ${CONNECTION_ACTIONS} THEN a.metadata->>'kind' END AS connection_kind,
           CASE WHEN a.action IN ${CONNECTION_ACTIONS} THEN a.metadata->>'domain' END AS connection_domain,
           CASE WHEN a.action = 'organization.directory_connect_failed' AND a.metadata->>'kind' = 'admin_consent' THEN a.metadata->>'reason' END AS connect_failure,
           CASE WHEN a.action = 'organization.directory_deletions_noticed' THEN a.metadata->>'count' END AS removed_count,
           COALESCE(a.action = 'organization.directory_disconnected' AND a.metadata->>'by' = 'operator', false) AS by_operator,
           CASE WHEN a.action IN ${CLEARING_ACTIONS} THEN a.metadata->'cleared'->>'suspended' END AS cleared_suspended,
           CASE WHEN a.action IN ${CLEARING_ACTIONS} THEN a.metadata->'cleared'->>'archived' END AS cleared_archived,
           CASE WHEN a.action IN ${CLEARING_ACTIONS} THEN a.metadata->'cleared'->>'deleted' END AS cleared_deleted
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
      directoryTo: r.directory_to,
      connectionKind: r.connection_kind,
      connectionDomain: r.connection_domain,
      connectFailure: r.connect_failure,
      removedCount: r.removed_count,
      byOperator: r.by_operator,
      cleared: { suspended: r.cleared_suspended, archived: r.cleared_archived, deleted: r.cleared_deleted },
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
