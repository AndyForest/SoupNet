/**
 * /workspaces — the agent-callable, purely CONSTRUCTIVE surface of the
 * eval-reset destructive tier: create a born-ephemeral recipe book, and shorten
 * or extend the TTL of one you created. Agents never delete; the pg-boss reaper
 * executes the declared policy (see services/ephemeral-workspace.service.ts and
 * embedding-worker/jobs/ephemeral-reap.ts).
 *
 * Design: docs/planning/eval-reset-contract-response.md, constrained by
 * security-audit-2026-07-21-eval-reset-destructive-tier.md (F55–F64).
 *
 * FLAG GATE (audit F62): every route here is enabled ONLY when
 * ALLOW_BENCHMARK_OPS === "true" (strict equality, independent of NODE_ENV /
 * environment name). When off, the routes behave as if ABSENT — a uniform 404,
 * never a 403 that would confirm the feature exists (anti-enumeration posture,
 * same as the flag-off `?key=` surfaces). The production task definition must
 * NOT set this variable.
 *
 * SCOPED KEYS ONLY (audit F60 / operator answer 1): create is restricted to
 * 'scoped' keys. Daily keys expire at midnight and are the URL-embedded, most
 * leakable tier; oauth access tokens are short-lived and rotate — self-binding
 * a ~60-day workspace to either would orphan it. Non-scoped valid keys get 403.
 *
 * PERSONA HYGIENE (corpus recipe bc30ced3): the `description` you pass renders
 * VERBATIM inside get_briefing for any persona briefed against a key that can
 * read this book. Keep benchmark-framing labels ("EVAL DATA", run ids) OUT of
 * it — they leak the benchmark frame into an otherwise clean persona briefing.
 *
 * Auth is Bearer-only (no `?key=` — these are mutating routes, and request URLs
 * land in access logs). Rate-limited per-IP then per-credential (hashed key),
 * the /recipes + /health/version precedent.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { validateKey } from "../services/api-key.service";
import { writeAudit } from "../services/audit-log.service";
import {
  createEphemeralWorkspace,
  setEphemeralExpiry,
  EphemeralWorkspaceError,
} from "../services/ephemeral-workspace.service";
import { rateLimit, extractMcpBearerKey, getClientIp, hashApiKey } from "../middleware/rate-limit";

/** Strict flag gate (audit F62): exactly "true", never truthiness, never keyed
 *  on the environment name. Exported so the flag-gate test asserts on it. */
export function benchmarkOpsEnabled(): boolean {
  return process.env["ALLOW_BENCHMARK_OPS"] === "true";
}

// Per-IP: 1000/hour (defense in depth, same shape as /recipes' per-IP limiter).
const wsIpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

// Per-credential: 120/hour keyed by hashed Bearer (raw keys must not sit in
// memory as map keys). Tighter than the read endpoints' 600 — each create drags
// in a book + async embedding backfill (real cost), so a leaked/looping key is
// bounded harder here. Falls back to IP bucketing when no Bearer is present.
const wsPerKeyRateLimit = rateLimit({
  max: 120,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const token = extractMcpBearerKey(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

const workspaces = new Hono<AppEnv>();

// Flag gate first — 404 when off, before any auth or DB work, so a disabled
// deployment gives zero confirming signal even to a valid key.
workspaces.use("/*", async (c: Context, next: Next) => {
  if (!benchmarkOpsEnabled()) return c.notFound();
  return next();
});

workspaces.use("/*", wsIpRateLimit, wsPerKeyRateLimit);

/** Bearer extraction (no `?key=` on mutating routes). */
function bearer(c: Context): string | null {
  const auth = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1]!.trim() : null;
}

const createSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  ttlDays: z.number().positive().optional(),
});

// POST /workspaces — create a born-ephemeral workspace, self-bind the key.
workspaces.post("/", async (c) => {
  const rawKey = bearer(c);
  if (!rawKey) {
    return c.json({ ok: false, error: "Authorization: Bearer <api-key> required" }, 401);
  }
  const db = getDb();
  const validated = await validateKey(db, rawKey);
  if (!validated) {
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }
  // Scoped keys only (audit F60 / operator answer 1).
  if (validated.keyType !== "scoped") {
    return c.json(
      { ok: false, error: "Ephemeral workspaces can only be created with a scoped API key." },
      403,
    );
  }

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch { /* empty body → all-defaults create */ }
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  try {
    const result = await createEphemeralWorkspace({
      db,
      keyId: validated.keyId,
      userId: validated.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      ttlDays: parsed.data.ttlDays,
    });

    // Audit the create + scope-widen (audit F58): actor key id + the book its
    // scope was widened to + declared TTL/expiry.
    await writeAudit(db, {
      actorUserId: validated.userId,
      action: "recipe_book.created_ephemeral",
      targetType: "group",
      targetId: result.recipeBookId,
      apiKeyId: validated.keyId,
      metadata: {
        recipeBookId: result.recipeBookId,
        slug: result.slug,
        expiresAt: result.expiresAt,
        ttlDays: parsed.data.ttlDays ?? null,
      },
    });

    return c.json({ ok: true, data: result }, 201);
  } catch (err) {
    if (err instanceof EphemeralWorkspaceError) {
      return c.json({ ok: false, error: err.message }, err.status as 400 | 403 | 409 | 429 | 500);
    }
    throw err;
  }
});

// { expiresAt: ISO-8601 | "now" } — shorten OR extend (no max cap).
const expirySchema = z.object({
  expiresAt: z.string().min(1),
});

// POST /workspaces/:recipeBookId/expiry — creator-key-only TTL change.
workspaces.post("/:recipeBookId/expiry", async (c) => {
  const rawKey = bearer(c);
  if (!rawKey) {
    return c.json({ ok: false, error: "Authorization: Bearer <api-key> required" }, 401);
  }
  const db = getDb();
  const validated = await validateKey(db, rawKey);
  if (!validated) {
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  const recipeBookId = c.req.param("recipeBookId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipeBookId)) {
    // Malformed id → uniform not-found (no oracle).
    return c.json({ ok: false, error: "Workspace not found." }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "JSON body { expiresAt } required" }, 400);
  }
  const parsed = expirySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }

  // "now" is the expire-now shorthand; otherwise an ISO-8601 timestamp.
  const raw = parsed.data.expiresAt.trim();
  let when: Date;
  if (raw.toLowerCase() === "now") {
    when = new Date();
  } else {
    when = new Date(raw);
    if (Number.isNaN(when.getTime())) {
      return c.json(
        { ok: false, error: `Invalid expiresAt "${raw}" — use ISO 8601 (e.g. "2026-09-01T00:00:00Z") or "now".` },
        400,
      );
    }
  }

  try {
    const result = await setEphemeralExpiry(db, recipeBookId, validated.keyId, when);
    // Audit the expire/extend request (F58). No extension-specific rate limit
    // or separate audit shape — the operator waived those; one row records the
    // effective expiry either direction.
    await writeAudit(db, {
      actorUserId: validated.userId,
      action: "recipe_book.expire_requested",
      targetType: "group",
      targetId: recipeBookId,
      apiKeyId: validated.keyId,
      metadata: { recipeBookId, expiresAt: result.expiresAt, tombstoned: result.tombstoned },
    });
    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof EphemeralWorkspaceError) {
      return c.json({ ok: false, error: err.message }, err.status as 400 | 404 | 500);
    }
    throw err;
  }
});

export { workspaces as workspaceRoutes };
