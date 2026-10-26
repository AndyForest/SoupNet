/**
 * /organizations — an org owner's or admin's actions on members
 * (organization accounts round 1, stream Core; rubric OC-R1, OC-R2).
 *
 *   POST  /organizations/:id/members/:userId/disable
 *   POST  /organizations/:id/members/:userId/enable
 *   PATCH /organizations/:id/members/:userId   { role }
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
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { actOnMember } from "../authz";
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

export default organizationsRouter;
