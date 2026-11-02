/**
 * /organizations/:id/domains — an org owner's or admin's verified domains
 * (organization accounts round 1, stream Domains; rubric
 * docs/planning/org-accounts-build/domains.md, OD-A1 to OD-A4).
 *
 *   GET    /organizations/:id/domains
 *   POST   /organizations/:id/domains                    { domain }
 *   POST   /organizations/:id/domains/:domainId/check
 *   PATCH  /organizations/:id/domains/:domainId          { autoJoin }
 *   DELETE /organizations/:id/domains/:domainId
 *
 * JWT-auth + verified email. The gate is Core's `activeOrgManagerRole`: an
 * active owner or admin of that company organization. Anyone else, an
 * organization id that doesn't exist or is malformed, and a domain id that
 * isn't this organization's all get Core's one 404 body
 * (`ORGANIZATION_NOT_FOUND`), so the routes never say whether an
 * organization exists or who manages it. The work is in
 * services/org-domains.service.ts.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { requireAuth, requireVerifiedEmail } from "../auth";
import type { AppEnv } from "../types";
import { activeOrgManagerRole } from "../authz";
import { rateLimit } from "../middleware/rate-limit";
import { ORGANIZATION_NOT_FOUND, domainRefusalMessage, domainNotFoundMessage, domainInstructions } from "@soupnet/domain";
import type { DomainRefusal } from "@soupnet/domain";
import { addDomain, checkDomainNow, deleteDomain, listDomains, setAutoJoin } from "../services/org-domains.service";
import type { DomainClaimView } from "../services/org-domains.service";

const domainsRouter = new Hono<AppEnv>();

domainsRouter.use("/*", requireAuth, requireVerifiedEmail);

const uuid = z.string().uuid();

/**
 * "Check now" drives a DNS query, so it is limited per organization: ten in
 * fifteen minutes (OD-V4). Keyed by the organization in the path, after the
 * gate, so only a manager's calls count.
 */
export const domainCheckRateLimit = rateLimit({
  max: 10,
  windowMs: 15 * 60 * 1000,
  keyFn: (c) => `org-domain-check:${c.req.param("id") ?? "unknown"}`,
});

function notFound(c: Context<AppEnv>): Response {
  return c.json(ORGANIZATION_NOT_FOUND, 404);
}

/** The organization id when the caller manages it, else null (answer with the uniform 404). */
async function managedOrganization(c: Context<AppEnv>): Promise<string | null> {
  const organizationId = c.req.param("id");
  if (!organizationId || !uuid.safeParse(organizationId).success) return null;
  const role = await activeOrgManagerRole(getDb(), organizationId, c.get("user").id);
  return role ? organizationId : null;
}

function domainIdOf(c: Context<AppEnv>): string | null {
  const id = c.req.param("domainId");
  return id && uuid.safeParse(id).success ? id : null;
}

function withInstructions(claim: DomainClaimView): DomainClaimView & { instructions: string } {
  return { ...claim, instructions: domainInstructions({ name: claim.recordName, value: claim.recordValue }) };
}

function refuse(c: Context<AppEnv>, refusal: DomainRefusal): Response {
  const status = refusal === "invalid_domain" || refusal === "public_email_domain" ? 400 : 409;
  return c.json({ ok: false, error: refusal, message: domainRefusalMessage(refusal) }, status);
}

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

domainsRouter.get("/:id/domains", async (c) => {
  const organizationId = await managedOrganization(c);
  if (!organizationId) return notFound(c);
  const claims = await listDomains(getDb(), organizationId);
  return c.json({ ok: true, data: claims.map(withInstructions) });
});

domainsRouter.post("/:id/domains", async (c) => {
  const organizationId = await managedOrganization(c);
  if (!organizationId) return notFound(c);
  const body = await readJson(c);
  const result = await addDomain(getDb(), { organizationId, actorUserId: c.get("user").id, domain: body?.["domain"] });
  if (!result.ok) return refuse(c, result.refusal);
  return c.json({ ok: true, data: withInstructions(result.claim) }, result.created ? 201 : 200);
});

/** The gate as middleware, so the limiter after it only ever counts a manager's calls. */
async function requireManager(c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | void> {
  if (!(await managedOrganization(c)) || !domainIdOf(c)) return notFound(c);
  await next();
}

/** Events where this check didn't find the record: say where we looked. */
const NOT_FOUND_EVENTS = new Set(["still_pending", "failing", "still_failing", "lapsed"]);

domainsRouter.post("/:id/domains/:domainId/check", requireManager, domainCheckRateLimit, async (c) => {
  const organizationId = c.req.param("id")!;
  const claimId = c.req.param("domainId")!;
  const result = await checkDomainNow(getDb(), { organizationId, claimId, actorUserId: c.get("user").id });
  if (!result.ok) return result.refusal === "not_found" ? notFound(c) : refuse(c, result.refusal);
  return c.json({
    ok: true,
    data: {
      ...withInstructions(result.claim),
      ...(NOT_FOUND_EVENTS.has(result.event) ? { message: domainNotFoundMessage(result.recordName) } : {}),
      ...(result.migration ? { migration: result.migration } : {}),
    },
  });
});

domainsRouter.patch("/:id/domains/:domainId", async (c) => {
  const organizationId = await managedOrganization(c);
  const claimId = domainIdOf(c);
  if (!organizationId || !claimId) return notFound(c);
  const body = await readJson(c);
  const autoJoin = body?.["autoJoin"];
  if (typeof autoJoin !== "boolean") {
    return c.json({ ok: false, error: "Invalid input", message: "autoJoin must be true or false." }, 400);
  }
  const result = await setAutoJoin(getDb(), { organizationId, claimId, actorUserId: c.get("user").id, autoJoin });
  if (!result.ok) return notFound(c);
  return c.json({ ok: true, data: { ...withInstructions(result.claim), ...(result.migration ? { migration: result.migration } : {}) } });
});

domainsRouter.delete("/:id/domains/:domainId", async (c) => {
  const organizationId = await managedOrganization(c);
  const claimId = domainIdOf(c);
  if (!organizationId || !claimId) return notFound(c);
  const removed = await deleteDomain(getDb(), { organizationId, claimId, actorUserId: c.get("user").id });
  return removed ? c.json({ ok: true }) : notFound(c);
});

export default domainsRouter;
