/**
 * /intents — a person's declared intents and their lineage, for reports
 * (drafts-and-triage slice 9). API-key Bearer auth; JSON only.
 *
 * GET /intents?page=&per_page=        the caller's user's intents, newest first
 * GET /intents/:id?page=&per_page=    one intent: its summary and one page of
 *                                     its lineage (shown, deposited, feedback),
 *                                     oldest first
 *
 * Rules (services/intent-read.service.ts, authz/report-scope.ts): the
 * caller's user's intents only (ruling 54); every recipe id in a response is
 * one the presenting key may read now. Another person's intent, an id that
 * never existed, and a malformed id are the same 404 with the same body.
 *
 * The key is taken only as an Authorization: Bearer header: a report's URL
 * gets pasted and logged, and keys stay out of URLs (recipe 58d3741d, the
 * /keys/briefing move). No MCP tool reads this (ruling 54's slice text):
 * reports are made by scripts and by agents outside a session.
 *
 * Rate limiting: the same per-IP and per-credential pair as /recipes.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { authenticateKey } from "../authz";
import type { Principal, ReportViewer } from "../authz";
import { rateLimit, extractMcpBearerKey, getClientIp, hashApiKey } from "../middleware/rate-limit";
import { parseReportQuery } from "../services/report-params";
import { listIntents, getIntent } from "../services/intent-read.service";

export const reportIpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });
export const reportPerKeyRateLimit = rateLimit({
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const token = extractMcpBearerKey(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

/** The 404 every unreadable intent gets, byte for byte (S9-I3). */
export const INTENT_NOT_FOUND = { ok: false as const, error: "Intent not found" };

/**
 * Authenticate the Bearer key of a report request. Returns the principal, or
 * the 401 response to send.
 */
export async function reportPrincipal(c: Context): Promise<Principal | Response> {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header("Authorization") ?? "");
  if (!match) return c.json({ ok: false, error: "Authorization: Bearer <api-key> required" }, 401);
  const principal = await authenticateKey(getDb(), match[1]!.trim());
  if (!principal) return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  return principal;
}

export function keyViewer(principal: Principal): ReportViewer {
  return { kind: "key", userId: principal.userId, readGroupIds: principal.readGroupIds };
}

const intents = new Hono<AppEnv>();

intents.get("/", reportIpRateLimit, reportPerKeyRateLimit, async (c) => {
  const principal = await reportPrincipal(c);
  if (principal instanceof Response) return principal;
  const parsed = parseReportQuery(c.req.queries(), []);
  if (!parsed.ok) return c.json({ ok: false, error: parsed.error, fields: parsed.fields }, 400);
  const data = await listIntents(getDb(), keyViewer(principal), parsed.paging);
  return c.json({ ok: true, data });
});

intents.get("/:id", reportIpRateLimit, reportPerKeyRateLimit, async (c) => {
  const principal = await reportPrincipal(c);
  if (principal instanceof Response) return principal;
  const parsed = parseReportQuery(c.req.queries(), []);
  if (!parsed.ok) return c.json({ ok: false, error: parsed.error, fields: parsed.fields }, 400);
  const data = await getIntent(getDb(), keyViewer(principal), c.req.param("id") ?? "", parsed.paging);
  if (!data) return c.json(INTENT_NOT_FOUND, 404);
  return c.json({ ok: true, data });
});

export { intents as intentRoutes };
