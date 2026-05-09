import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";

const invitationsRouter = new Hono<AppEnv>();
// Secure-by-default: every route requires both auth and verified email.
// Invitation accept/decline requires mailbox control (verified) on top of
// the fact that the invite is bound to the user's email.
invitationsRouter.use("/*", requireAuth, requireVerifiedEmail);

// GET /invitations/pending — list pending invitations for the current
// user's email. This is the data source for the dashboard feed card and
// the "group invites" surface on the groups page.
invitationsRouter.get("/pending", async (c) => {
  const user = c.get("user");
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT
      i.id,
      i.group_id AS "groupId",
      i.created_at AS "createdAt",
      i.expires_at AS "expiresAt",
      g.name AS "groupName",
      g.slug AS "groupSlug",
      g.description AS "groupDescription",
      inviter.email AS "inviterEmail"
    FROM claimnet.invitations i
    JOIN claimnet.groups g ON g.id = i.group_id
    JOIN claimnet.users inviter ON inviter.id = i.inviter_id
    WHERE i.email = ${user.email}
      AND i.accepted_at IS NULL
      AND i.declined_at IS NULL
      AND i.expires_at > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM claimnet.group_members gm
        WHERE gm.group_id = i.group_id AND gm.user_id = ${user.id}::uuid
      )
    ORDER BY i.created_at DESC
  `);

  return c.json({ ok: true, data: rows });
});

// POST /invitations/:id/accept — accept a pending invitation.
// Requires: invitation is bound to current user's email, not expired,
// not already accepted/declined. Adds user to the group as 'member'.
invitationsRouter.post("/:id/accept", async (c) => {
  const user = c.get("user");
  const inviteId = c.req.param("id");
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT id, group_id AS "groupId", email
    FROM claimnet.invitations
    WHERE id = ${inviteId}::uuid
      AND email = ${user.email}
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `);
  const invite = (rows as unknown as Array<{ id: string; groupId: string; email: string }>)[0];
  if (!invite) {
    return c.json({ ok: false, error: "Invitation not found, expired, or not for this account" }, 404);
  }

  await db.execute(sql`
    UPDATE claimnet.invitations SET accepted_at = NOW() WHERE id = ${invite.id}::uuid
  `);
  await db.execute(sql`
    INSERT INTO claimnet.group_members (group_id, user_id, role)
    VALUES (${invite.groupId}::uuid, ${user.id}::uuid, 'member')
    ON CONFLICT (group_id, user_id) DO NOTHING
  `);

  // Return group slug so the frontend can route to the post-accept
  // onboarding page (Connect your AI agent).
  const groupRow = await db.execute(sql`
    SELECT slug, name FROM claimnet.groups WHERE id = ${invite.groupId}::uuid
  `);
  const group = (groupRow as unknown as Array<{ slug: string; name: string }>)[0];

  return c.json({
    ok: true,
    data: {
      groupId: invite.groupId,
      groupSlug: group?.slug ?? null,
      groupName: group?.name ?? null,
    },
  });
});

// POST /invitations/:id/decline — decline a pending invitation.
// Requires: invitation is bound to current user's email. We mark it
// declined (preserved for audit) rather than deleting.
invitationsRouter.post("/:id/decline", async (c) => {
  const user = c.get("user");
  const inviteId = c.req.param("id");
  const db = getDb();

  const result = await db.execute(sql`
    UPDATE claimnet.invitations
    SET declined_at = NOW()
    WHERE id = ${inviteId}::uuid
      AND email = ${user.email}
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND expires_at > NOW()
    RETURNING id
  `);
  const updated = (result as unknown as Array<{ id: string }>)[0];
  if (!updated) {
    return c.json({ ok: false, error: "Invitation not found, expired, or not for this account" }, 404);
  }
  return c.json({ ok: true });
});

export { invitationsRouter as invitationRoutes };
