/**
 * /organizations — an org owner's or admin's actions on members
 * (organization accounts round 1, stream Core; rubric OC-R1, OC-R2).
 *
 *   POST  /organizations/:id/members/:userId/disable
 *   POST  /organizations/:id/members/:userId/enable
 *   PATCH /organizations/:id/members/:userId   { role }
 *   PATCH /organizations/:id                   { requireSso }   (stream SSO)
 *
 * JWT-auth + verified email, like every JWT router. The decision lives in
 * the authz module (`actOnMember`): the caller must be an active owner or
 * admin of the organization. Anyone else, an organization id that doesn't
 * exist, a malformed id, and a user who isn't a member all get the same 404
 * body, so the route never says who is in an organization or whether it
 * exists. The member list and the rest of the console are stream Console's.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { actOnMember, activeOrgManagerRole } from "../authz";
import { writeAudit } from "../services/audit-log.service";
import type { MemberActionRefusal } from "../authz";
import { ORG_ACTION_MESSAGES, ORGANIZATION_FULL_MESSAGE, ORGANIZATION_NOT_FOUND, isOrgRole } from "@soupnet/domain";
import type { OrgMemberAction } from "@soupnet/domain";

const organizationsRouter = new Hono<AppEnv>();

organizationsRouter.use("/*", requireAuth, requireVerifiedEmail);

const uuid = z.string().uuid();

/** The one not-found body (byte-identical for every reason it is given). */
const NOT_FOUND = ORGANIZATION_NOT_FOUND;

async function act(c: Context<AppEnv>, action: OrgMemberAction): Promise<Response> {
  const organizationId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  if (!organizationId || !targetUserId || !uuid.safeParse(organizationId).success || !uuid.safeParse(targetUserId).success) {
    return c.json(NOT_FOUND, 404);
  }
  const user = c.get("user");
  const refusal = await actOnMember(getDb(), { organizationId, actorUserId: user.id, targetUserId, action });
  return refusal ? refuse(c, refusal) : c.json({ ok: true }, 200);
}

function refuse(c: Context<AppEnv>, refusal: MemberActionRefusal): Response {
  switch (refusal) {
    case "not_found":
      return c.json(NOT_FOUND, 404);
    case "organization_full":
      return c.json({ ok: false, error: "organization_full", message: ORGANIZATION_FULL_MESSAGE }, 409);
    default:
      return c.json({ ok: false, error: refusal, message: ORG_ACTION_MESSAGES[refusal] }, 403);
  }
}

organizationsRouter.post("/:id/members/:userId/disable", (c) => act(c, { kind: "disable" }));
organizationsRouter.post("/:id/members/:userId/enable", (c) => act(c, { kind: "enable" }));

organizationsRouter.patch("/:id/members/:userId", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const role = (body as { role?: unknown } | null)?.role;
  if (!isOrgRole(role)) {
    return c.json({ ok: false, error: "Invalid input", message: "role must be owner, admin or member." }, 400);
  }
  return act(c, { kind: "set_role", role });
});

// PATCH /organizations/:id { requireSso } — an active owner or admin turns
// the organization's require_sso on or off (stream SSO, SSO-R1). Only from a
// Workspace Google session of their own: an account that can't sign in with
// Google would lock itself out. Anyone else gets the uniform 404.
organizationsRouter.patch("/:id", async (c) => {
  const organizationId = c.req.param("id");
  if (!organizationId || !uuid.safeParse(organizationId).success) return c.json(NOT_FOUND, 404);
  const user = c.get("user");
  const db = getDb();
  if (!(await activeOrgManagerRole(db, organizationId, user.id))) return c.json(NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const requireSso = (body as { requireSso?: unknown } | null)?.requireSso;
  if (typeof requireSso !== "boolean" || Object.keys(body as object).length !== 1) {
    return c.json({ ok: false, error: "Invalid input", message: "Send { requireSso: true | false }." }, 400);
  }
  if (user.identityProvider !== "google") {
    return c.json({ ok: false, error: "google_session_required", message: "Sign in with Google before requiring it." }, 403);
  }
  await db.execute(sql`
    UPDATE claimnet.organizations SET require_sso = ${requireSso}, updated_at = NOW()
    WHERE id = ${organizationId}::uuid AND NOT is_personal
  `);
  await writeAudit(db, {
    actorUserId: user.id, action: "organization.require_sso_set", targetType: "organization", targetId: organizationId,
    metadata: { requireSso, by: "org_admin" },
  });
  return c.json({ ok: true });
});

export default organizationsRouter;
