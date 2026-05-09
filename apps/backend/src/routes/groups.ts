import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { sql } from "drizzle-orm";
import { groups, groupMembers } from "@soupnet/db";
import { writeAudit } from "../services/audit-log.service";

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  organizationId: z.string().uuid(),
  description: z.string().max(1000).optional(),
});

// Slug is intentionally omitted — it stays stable across renames so existing
// API keys, invite links, MCP read_groups args, and URL bookmarks don't break.
// Rename-safe slugs are tracked as future work; for now the slug is a historical
// artifact of the original group name.
const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
});

const groupsRouter = new Hono<AppEnv>();
// Secure-by-default: every JWT-authed route also requires email verification.
// Opt-outs live in routes/auth.ts on the specific endpoints that must work
// pre-verification (/auth/me, /auth/resend-verification).
groupsRouter.use("/*", requireAuth, requireVerifiedEmail);

// GET /groups — list user's groups (with per-user daily-link prefs)
groupsRouter.get("/", async (c) => {
  const user = c.get("user");
  const rows = await getDb().execute(sql`
    SELECT g.id, g.name, g.slug, g.description, g.organization_id, g.created_at,
           gm.role as member_role,
           gm.daily_read as daily_read,
           gm.daily_write as daily_write
    FROM claimnet.groups g
    JOIN claimnet.group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ${user.id}::uuid
    ORDER BY g.created_at DESC
  `);
  return c.json({ ok: true, data: rows });
});

// POST /groups — create a group
groupsRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const { name, slug, organizationId, description } = parsed.data;

  const db = getDb();

  // Verify user owns the organization
  const orgCheck = await db.execute(sql`
    SELECT id FROM claimnet.organizations
    WHERE id = ${organizationId}::uuid AND owner_id = ${user.id}::uuid
  `);
  if ((orgCheck as unknown as Array<unknown>).length === 0) {
    return c.json({ ok: false, error: "Organization not found or not owned by you" }, 403);
  }

  const groupRows = await db.insert(groups).values({
    name, slug, organizationId, description,
  }).returning({ id: groups.id });

  const group = groupRows[0];
  if (!group) return c.json({ ok: false, error: "Failed to create group" }, 500);

  // Add creator as owner, auto-opted-in for daily-link read + write. The
  // "new groups default to excluded" rule applies to memberships gained
  // via invite accept (see invitations.ts), not to groups you create.
  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: user.id,
    role: "owner",
    dailyRead: true,
    dailyWrite: true,
  });

  return c.json({ ok: true, data: { id: group.id, name, slug } }, 201);
});

// PUT /groups/:id — update group name and/or description. Owner-only.
// Slug stays stable (see updateGroupSchema comment).
groupsRouter.put("/:id", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }
  if (parsed.data.name === undefined && parsed.data.description === undefined) {
    return c.json({ ok: false, error: "No fields to update" }, 400);
  }

  const db = getDb();

  // Owner-only. The same pattern DELETE /:id/members/:userId uses.
  const roleRows = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  const role = (roleRows as unknown as Array<{ role: string }>)[0]?.role;
  if (role !== "owner") {
    return c.json({ ok: false, error: "Only group owners can edit group details" }, 403);
  }

  // Capture before-state so the audit log can record what changed and the
  // mutation can short-circuit on no-op edits.
  const beforeRows = await db.execute(sql`
    SELECT name, slug, description FROM claimnet.groups WHERE id = ${groupId}::uuid
  `);
  const before = (beforeRows as unknown as Array<{ name: string; slug: string; description: string | null }>)[0];
  if (!before) return c.json({ ok: false, error: "Group not found" }, 404);

  // Build dynamic UPDATE — only touch fields the caller provided.
  const { name, description } = parsed.data;
  if (name !== undefined && description !== undefined) {
    await db.execute(sql`
      UPDATE claimnet.groups
      SET name = ${name}, description = ${description}
      WHERE id = ${groupId}::uuid
    `);
  } else if (name !== undefined) {
    await db.execute(sql`
      UPDATE claimnet.groups SET name = ${name} WHERE id = ${groupId}::uuid
    `);
  } else if (description !== undefined) {
    await db.execute(sql`
      UPDATE claimnet.groups SET description = ${description} WHERE id = ${groupId}::uuid
    `);
  }

  const updated = await db.execute(sql`
    SELECT id, name, slug, description FROM claimnet.groups WHERE id = ${groupId}::uuid
  `);
  const row = (updated as unknown as Array<{ id: string; name: string; slug: string; description: string | null }>)[0];
  if (!row) return c.json({ ok: false, error: "Group not found" }, 404);

  // Audit-log only fields that actually changed. Description gets its own
  // action so the mcp:update_group_description path and this JWT path
  // produce comparable trail entries.
  const previousDescription = before.description ?? "";
  if (description !== undefined && description !== previousDescription) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: "group.description_updated",
      targetType: "group",
      targetId: groupId,
      metadata: {
        actor: "jwt:put_group",
        previousDescription,
        newDescription: description,
        groupName: row.name,
        groupSlug: row.slug,
      },
    });
  }
  if (name !== undefined && name !== before.name) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: "group.name_updated",
      targetType: "group",
      targetId: groupId,
      metadata: {
        actor: "jwt:put_group",
        previousName: before.name,
        newName: name,
        groupSlug: row.slug,
      },
    });
  }

  return c.json({ ok: true, data: row });
});

// ── Member management ───────────────────────────────────────────────────────

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["member", "admin"]).default("member"),
});

// GET /groups/:id/members — list group members
groupsRouter.get("/:id/members", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const db = getDb();

  // Verify requester is a member of the group
  const membership = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  if ((membership as unknown[]).length === 0) {
    return c.json({ ok: false, error: "Not a member of this group" }, 403);
  }

  const members = await db.execute(sql`
    SELECT gm.user_id, u.email, gm.role, gm.joined_at
    FROM claimnet.group_members gm
    JOIN claimnet.users u ON u.id = gm.user_id
    WHERE gm.group_id = ${groupId}::uuid
    ORDER BY gm.joined_at ASC
  `);

  return c.json({ ok: true, data: members });
});

// POST /groups/:id/members — add member by email
groupsRouter.post("/:id/members", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const body = await c.req.json();
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const db = getDb();

  // Verify requester is owner or admin of the group
  const requesterRole = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  const role = (requesterRole as unknown as Array<{ role: string }>)[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return c.json({ ok: false, error: "Only group owners and admins can add members" }, 403);
  }

  // Look up target user by email
  const targetUser = await db.execute(sql`
    SELECT id, email FROM claimnet.users WHERE email = ${parsed.data.email}
  `);
  const target = (targetUser as unknown as Array<{ id: string; email: string }>)[0];
  if (!target) {
    return c.json({
      ok: false,
      error: "Could not add member. The user may not have an account yet — try sending an invitation instead.",
    }, 404);
  }

  // Add to group (ON CONFLICT = already a member, no-op). Directly-added
  // members default to excluded from daily-link read/write — same anti-spam
  // posture as invite-accept. The new member can opt in on the Groups page.
  await db.execute(sql`
    INSERT INTO claimnet.group_members (group_id, user_id, role)
    VALUES (${groupId}::uuid, ${target.id}::uuid, ${parsed.data.role})
    ON CONFLICT (group_id, user_id) DO NOTHING
  `);

  return c.json({
    ok: true,
    data: { userId: target.id, email: target.email, role: parsed.data.role },
  }, 201);
});

// POST /groups/:id/invite — create an invitation for an email address.
//
// Spam-safe by design:
//   1. Response is opaque — we never leak whether the email is already
//      registered. Otherwise the endpoint could be used to fish for
//      accounts on the system.
//   2. Soup.net never sends email to non-users from this flow — that would
//      be a spam vector and hurt our sender reputation. If the invitee is
//      already a Soup.net user they'll see the invitation in-app (feed);
//      if not, the inviter gets a copy-pasteable blurb to deliver through
//      their own channel (email, Signal, DM).
//   3. Registered users never auto-join on email verification — they must
//      click Accept. This prevents someone from forcing a new user into a
//      group by planting an invite before they sign up.
groupsRouter.post("/:id/invite", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const body = await c.req.json();
  const parsed = z.object({ email: z.string().email() }).safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid email" }, 400);
  }
  const inviteeEmail = parsed.data.email.toLowerCase().trim();

  const db = getDb();

  // Verify requester is owner or admin
  const requesterRole = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  const role = (requesterRole as unknown as Array<{ role: string }>)[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return c.json({ ok: false, error: "Only group owners and admins can send invitations" }, 403);
  }

  // Look up group name + inviter email for the blurb. We do NOT look up
  // whether an account exists for inviteeEmail — that would let the caller
  // distinguish "account exists" from "account does not" via response
  // timing or separate code paths.
  const groupRow = await db.execute(sql`
    SELECT name, description FROM claimnet.groups WHERE id = ${groupId}::uuid
  `);
  const groupInfo = (groupRow as unknown as Array<{ name: string; description: string | null }>)[0];
  if (!groupInfo) {
    return c.json({ ok: false, error: "Group not found" }, 404);
  }
  const inviterRow = await db.execute(sql`
    SELECT email FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const inviterEmail = (inviterRow as unknown as Array<{ email: string }>)[0]?.email ?? "";

  // Expire any existing pending invitation for this email+group (idempotent)
  await db.execute(sql`
    UPDATE claimnet.invitations
    SET expires_at = NOW()
    WHERE email = ${inviteeEmail}
      AND group_id = ${groupId}::uuid
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND expires_at > NOW()
  `);

  // Create invitation token
  const crypto = await import("node:crypto");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const insertRow = await db.execute(sql`
    INSERT INTO claimnet.invitations (inviter_id, group_id, email, token, bypass_cap, expires_at)
    VALUES (${user.id}::uuid, ${groupId}::uuid, ${inviteeEmail}, ${token}, false, ${expiresAt.toISOString()}::timestamptz)
    RETURNING id
  `);
  const inviteId = (insertRow as unknown as Array<{ id: string }>)[0]?.id;

  const inviteUrl = `${process.env["FRONTEND_URL"] ?? "https://soup.net"}/auth/register?invite=${token}`;
  const blurb = buildInviteBlurb({
    inviterEmail,
    groupName: groupInfo.name,
    groupDescription: groupInfo.description,
    inviteUrl,
  });

  return c.json({
    ok: true,
    data: {
      id: inviteId,
      email: inviteeEmail,
      inviteUrl,
      blurb,
      expiresAt: expiresAt.toISOString(),
    },
  }, 201);
});

/**
 * Build a copy-pasteable blurb the inviter sends to the invitee through their
 * own channel (email, Signal, DM). Framing emphasizes the agent-onboarding
 * value ("your AI agent gets this team's context"), not just "join a group."
 * See docs/design-thinking.md §"The 'inviting in your AI agent' moment".
 */
function buildInviteBlurb(opts: {
  inviterEmail: string;
  groupName: string;
  groupDescription: string | null;
  inviteUrl: string;
}): string {
  const { inviterEmail, groupName, groupDescription, inviteUrl } = opts;
  const lines = [
    `Hey — I'd like to collaborate with you on Soup.net, in the group "${groupName}".`,
  ];
  if (groupDescription) {
    lines.push("", `It's for: ${groupDescription}`);
  }
  lines.push(
    "",
    "Soup.net is shared memory for AI agents. When you accept, your AI agent (Claude, ChatGPT, Gemini — whichever you use) gets immediate access to this group's accumulated taste and judgment, so it can help you contribute without catching up.",
    "",
    "Accept here (link good for 7 days):",
    inviteUrl,
    "",
    `If you're new to Soup.net, you'll sign up first (same email: the invite is bound to it), then accept on your dashboard. — ${inviterEmail}`,
  );
  return lines.join("\n");
}

// GET /groups/:id/invitations — list pending invitations (owner/admin view).
groupsRouter.get("/:id/invitations", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const db = getDb();

  const requesterRole = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  const role = (requesterRole as unknown as Array<{ role: string }>)[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return c.json({ ok: false, error: "Only group owners and admins can view invitations" }, 403);
  }

  const rows = await db.execute(sql`
    SELECT
      i.id,
      i.email,
      i.token,
      i.expires_at AS "expiresAt",
      i.accepted_at AS "acceptedAt",
      i.declined_at AS "declinedAt",
      i.created_at AS "createdAt",
      inviter.email AS "inviterEmail"
    FROM claimnet.invitations i
    JOIN claimnet.users inviter ON inviter.id = i.inviter_id
    WHERE i.group_id = ${groupId}::uuid
      AND i.accepted_at IS NULL
      AND i.declined_at IS NULL
      AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `);
  const invites = rows as unknown as Array<{
    id: string;
    email: string;
    token: string;
    expiresAt: string;
    acceptedAt: string | null;
    declinedAt: string | null;
    createdAt: string;
    inviterEmail: string;
  }>;

  const frontendUrl = process.env["FRONTEND_URL"] ?? "https://soup.net";
  return c.json({
    ok: true,
    data: invites.map((inv) => ({
      id: inv.id,
      email: inv.email,
      inviteUrl: `${frontendUrl}/auth/register?invite=${inv.token}`,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      inviterEmail: inv.inviterEmail,
    })),
  });
});

// DELETE /groups/:id/invitations/:inviteId — revoke a pending invitation.
groupsRouter.delete("/:id/invitations/:inviteId", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const inviteId = c.req.param("inviteId");
  const db = getDb();

  const requesterRole = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  const role = (requesterRole as unknown as Array<{ role: string }>)[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return c.json({ ok: false, error: "Only group owners and admins can revoke invitations" }, 403);
  }

  // Revoke = expire. Preserves the row for audit.
  const result = await db.execute(sql`
    UPDATE claimnet.invitations
    SET expires_at = NOW()
    WHERE id = ${inviteId}::uuid
      AND group_id = ${groupId}::uuid
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND expires_at > NOW()
    RETURNING id
  `);
  const updated = (result as unknown as Array<{ id: string }>)[0];
  if (!updated) {
    return c.json({ ok: false, error: "Invitation not found or already closed" }, 404);
  }
  return c.json({ ok: true });
});

// DELETE /groups/:id/members/:userId — remove member
groupsRouter.delete("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const db = getDb();

  // Verify requester is owner
  const requesterRole = await db.execute(sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
  `);
  const role = (requesterRole as unknown as Array<{ role: string }>)[0]?.role;
  if (role !== "owner") {
    return c.json({ ok: false, error: "Only group owners can remove members" }, 403);
  }

  // Prevent removing self if last owner
  if (targetUserId === user.id) {
    const ownerCount = await db.execute(sql`
      SELECT count(*)::int AS total FROM claimnet.group_members
      WHERE group_id = ${groupId}::uuid AND role = 'owner'
    `);
    const count = ((ownerCount as unknown as Array<{ total: number }>)[0]?.total) ?? 0;
    if (count <= 1) {
      return c.json({ ok: false, error: "Cannot remove the last owner of a group" }, 400);
    }
  }

  await db.execute(sql`
    DELETE FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${targetUserId}::uuid
  `);

  return c.json({ ok: true });
});

// PUT /groups/:id/daily-prefs — update the caller's per-user daily-link
// preferences for this group. Powers the "Include in my daily agent reads /
// writes" checkboxes on the Groups page. See design-thinking.md
// §Configurable defaults for the "daily agent link" buttons.
const dailyPrefsSchema = z.object({
  dailyRead: z.boolean().optional(),
  dailyWrite: z.boolean().optional(),
});
groupsRouter.put("/:id/daily-prefs", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const body = await c.req.json();
  const parsed = dailyPrefsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }
  if (parsed.data.dailyRead === undefined && parsed.data.dailyWrite === undefined) {
    return c.json({ ok: false, error: "No fields to update" }, 400);
  }

  const db = getDb();

  // Membership is the only required check — any role can manage their own
  // prefs for groups they're a member of.
  const result = await db.execute(sql`
    UPDATE claimnet.group_members
    SET
      daily_read = COALESCE(${parsed.data.dailyRead ?? null}::boolean, daily_read),
      daily_write = COALESCE(${parsed.data.dailyWrite ?? null}::boolean, daily_write)
    WHERE group_id = ${groupId}::uuid AND user_id = ${user.id}::uuid
    RETURNING daily_read AS "dailyRead", daily_write AS "dailyWrite"
  `);
  const row = (result as unknown as Array<{ dailyRead: boolean; dailyWrite: boolean }>)[0];
  if (!row) {
    return c.json({ ok: false, error: "Not a member of this group" }, 403);
  }
  return c.json({ ok: true, data: row });
});

export { groupsRouter as groupRoutes };
