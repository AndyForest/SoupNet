/**
 * /organizations — an org owner's or admin's actions on members
 * (organization accounts round 1, stream Core; rubric OC-R1, OC-R2).
 *
 *   POST  /organizations/:id/members/:userId/disable
 *   POST  /organizations/:id/members/:userId/enable
 *   PATCH /organizations/:id/members/:userId   { role }
 *   PATCH /organizations/:id                   { requireSso }   (stream SSO)
 *   GET    /organizations/:id/directory         the Workspace directory connection (stream Offboarding)
 *   POST   /organizations/:id/directory/google/start  { binding, domain }
 *   PUT    /organizations/:id/directory/service-account  { key, adminEmail }
 *   DELETE /organizations/:id/directory
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
import { directoryConnectionOf, deleteDirectoryConnection } from "../authz";
import { connectServiceAccount, directoryConnectAvailable, startDirectoryConnect } from "../services/directory-connection.service";
import { forgetDirectoryTokens } from "../services/google-directory.service";
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

// ── The Google Workspace directory connection (stream Offboarding) ─────────
//
// For an active owner or admin of the organization, behind the same uniform
// 404 as every route here. Never returns the credential (OB-K4).

async function directoryGate(c: Context<AppEnv>): Promise<{ organizationId: string } | Response> {
  const organizationId = c.req.param("id");
  if (!organizationId || !uuid.safeParse(organizationId).success) return c.json(NOT_FOUND, 404);
  if (!(await activeOrgManagerRole(getDb(), organizationId, c.get("user").id))) return c.json(NOT_FOUND, 404);
  if (!directoryConnectAvailable()) {
    return c.json({ ok: false, error: "directory_not_configured", message: "This Soup.net server isn't set up to connect a Google Workspace directory." }, 503);
  }
  return { organizationId };
}

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

organizationsRouter.get("/:id/directory", async (c) => {
  const gate = await directoryGate(c);
  if (gate instanceof Response) return gate;
  return c.json({ ok: true, data: await directoryConnectionOf(getDb(), gate.organizationId) });
});

organizationsRouter.post("/:id/directory/google/start", async (c) => {
  const gate = await directoryGate(c);
  if (gate instanceof Response) return gate;
  const body = await jsonBody(c);
  const binding = body["binding"];
  if (typeof binding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(binding)) {
    return c.json({ ok: false, error: "invalid_request", message: "binding must be the base64url SHA-256 of the tab's secret." }, 400);
  }
  const result = await startDirectoryConnect(getDb(), { organizationId: gate.organizationId, userId: c.get("user").id, domain: body["domain"], binding });
  if ("url" in result) return c.json({ ok: true, data: { url: result.url } });
  return c.json({ ok: false, error: result.error, message: result.message }, result.status);
});

organizationsRouter.put("/:id/directory/service-account", async (c) => {
  const gate = await directoryGate(c);
  if (gate instanceof Response) return gate;
  const body = await jsonBody(c);
  const refused = await connectServiceAccount(getDb(), { organizationId: gate.organizationId, userId: c.get("user").id, key: body["key"], adminEmail: body["adminEmail"] });
  if (refused) return c.json({ ok: false, error: refused.error, message: refused.message }, refused.status);
  forgetDirectoryTokens(gate.organizationId);
  return c.json({ ok: true, data: await directoryConnectionOf(getDb(), gate.organizationId) });
});

organizationsRouter.delete("/:id/directory", async (c) => {
  const gate = await directoryGate(c);
  if (gate instanceof Response) return gate;
  const db = getDb();
  const removed = await deleteDirectoryConnection(db, gate.organizationId);
  forgetDirectoryTokens(gate.organizationId);
  if (removed) {
    await writeAudit(db, { actorUserId: c.get("user").id, action: "organization.directory_disconnected", targetType: "organization", targetId: gate.organizationId });
  }
  return c.json({ ok: true, data: { removed } });
});

export default organizationsRouter;
