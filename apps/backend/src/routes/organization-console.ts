/**
 * /organizations — the org console's reads and its one setting (organization
 * accounts round 1, stream Console; rubric
 * docs/planning/org-accounts-build/console.md). Mounted beside Core's member
 * actions (routes/organizations.ts) under the same prefix.
 *
 *   GET   /organizations/:id            the organization at a glance
 *   GET   /organizations/:id/members    members, the org column set (CN-U1 to CN-U3)
 *   GET   /organizations/:id/books      org-wide books, private books as totals (CN-B1, CN-P5)
 *   PATCH /organizations/:id/sharing    { outbound?, inbound? } (CN-P1)
 *   GET   /organizations/:id/activity   admin-action events (CN-L1)
 *
 * JWT-auth + verified email, like every JWT router. Every route needs the
 * caller to be an active owner or admin of `:id`, asked of the authz module
 * (`activeOrgManagerRole`). Anyone else, an organization that doesn't exist,
 * and a malformed id all get Core's not-found body byte for byte, so a route
 * never says whether an organization exists or who runs it (CN-G1). The site
 * operator reads organizations through /admin, not here.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { activeOrgManagerRole, orgBookSummary, orgMemberCount, publishedTrace } from "../authz";
import { ORGANIZATION_NOT_FOUND, isInboundSharing, isOutboundSharing } from "@soupnet/domain";
import { listUsers } from "../services/users-list.service";
import { orgActivity } from "../services/org-activity.service";
import { writeAudit } from "../services/audit-log.service";

const organizationConsoleRouter = new Hono<AppEnv>();

organizationConsoleRouter.use("/*", requireAuth, requireVerifiedEmail);

const uuid = z.string().uuid();

/**
 * The organization id from the path when the caller may manage it, else
 * null (the caller answers with the one not-found body).
 */
async function managedOrgId(c: Context<AppEnv>): Promise<{ id: string; role: "owner" | "admin" } | null> {
  const id = c.req.param("id");
  if (!id || !uuid.safeParse(id).success) return null;
  const role = await activeOrgManagerRole(getDb(), id, c.get("user").id);
  return role ? { id, role } : null;
}

function notFound(c: Context<AppEnv>): Response {
  return c.json(ORGANIZATION_NOT_FOUND, 404);
}

interface OrgRow {
  name: string;
  seatLimit: number | null;
  members: number;
  activeMembers: number;
  outbound: string;
  inbound: string;
}

async function orgRow(id: string): Promise<OrgRow | undefined> {
  const rows = await getDb().execute(sql`
    SELECT o.name, o.seat_limit AS "seatLimit",
           ${orgMemberCount(sql`o.id`, { activeOnly: false })} AS members,
           ${orgMemberCount(sql`o.id`, { activeOnly: true })} AS "activeMembers",
           o.outbound_sharing AS outbound, o.inbound_sharing AS inbound
    FROM claimnet.organizations o
    WHERE o.id = ${id}::uuid AND NOT o.is_personal
  `);
  return (rows as unknown as OrgRow[])[0];
}

organizationConsoleRouter.get("/:id", async (c) => {
  const org = await managedOrgId(c);
  if (!org) return notFound(c);
  const row = await orgRow(org.id);
  if (!row) return notFound(c);
  return c.json({
    ok: true,
    data: {
      id: org.id,
      name: row.name,
      yourRole: org.role,
      seatLimit: row.seatLimit,
      members: row.members,
      activeMembers: row.activeMembers,
      sharing: { outbound: row.outbound, inbound: row.inbound },
    },
  });
});

organizationConsoleRouter.get("/:id/members", async (c) => {
  const org = await managedOrgId(c);
  if (!org) return notFound(c);
  const data = await listUsers(getDb(), { viewer: "org", organizationId: org.id }, c.req.query());
  return c.json({ ok: true, data });
});

organizationConsoleRouter.get("/:id/books", async (c) => {
  const org = await managedOrgId(c);
  if (!org) return notFound(c);
  const db = getDb();
  const summary = await orgBookSummary(db, org.id);
  // Published recipes per org-wide book; private books get no per-book figure.
  const recipeRows = await db.execute(sql`
    SELECT t.group_id AS id, count(*)::int AS recipes
    FROM claimnet.traces t
    JOIN claimnet.groups g ON g.id = t.group_id
    WHERE g.organization_id = ${org.id}::uuid AND g.org_wide AND ${publishedTrace("t")}
    GROUP BY t.group_id
  `);
  const recipes = new Map((recipeRows as unknown as Array<{ id: string; recipes: number }>).map((r) => [r.id, r.recipes]));
  const row = await orgRow(org.id);
  return c.json({
    ok: true,
    data: {
      orgWideBooks: summary.orgWideBooks.map((b) => ({ ...b, recipes: recipes.get(b.id) ?? 0 })),
      privateBooks: summary.privateBooks,
      outsidePeopleInPrivateBooks: summary.outsidePeopleInPrivateBooks,
      sharing: row ? { outbound: row.outbound, inbound: row.inbound } : null,
    },
  });
});

organizationConsoleRouter.patch("/:id/sharing", async (c) => {
  const org = await managedOrgId(c);
  if (!org) return notFound(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const outbound = (body as { outbound?: unknown } | null)?.outbound;
  const inbound = (body as { inbound?: unknown } | null)?.inbound;
  if ((outbound === undefined && inbound === undefined)
    || (outbound !== undefined && !isOutboundSharing(outbound))
    || (inbound !== undefined && !isInboundSharing(inbound))) {
    return c.json({
      ok: false,
      error: "Invalid input",
      message: "Send outbound (blocked, admins_only or allowed) and/or inbound (blocked or allowed).",
    }, 400);
  }
  const db = getDb();
  const before = await orgRow(org.id);
  if (!before) return notFound(c);
  const next = {
    outbound: outbound ?? before.outbound,
    inbound: inbound ?? before.inbound,
  };
  await db.execute(sql`
    UPDATE claimnet.organizations
    SET outbound_sharing = ${next.outbound}, inbound_sharing = ${next.inbound}, updated_at = NOW()
    WHERE id = ${org.id}::uuid
  `);
  await writeAudit(db, {
    actorUserId: c.get("user").id,
    action: "organization.sharing_changed",
    targetType: "organization",
    targetId: org.id,
    metadata: { outbound: next.outbound, inbound: next.inbound, previous: { outbound: before.outbound, inbound: before.inbound } },
  });
  return c.json({ ok: true, data: { sharing: next } });
});

organizationConsoleRouter.get("/:id/activity", async (c) => {
  const org = await managedOrgId(c);
  if (!org) return notFound(c);
  const data = await orgActivity(getDb(), org.id, c.req.query());
  return c.json({ ok: true, data });
});

export default organizationConsoleRouter;
