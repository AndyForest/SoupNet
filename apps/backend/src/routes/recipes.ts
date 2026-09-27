/**
 * /recipes — recipe lookup by id (API-key Bearer auth).
 *
 * GET /recipes?ids=<uuid>[,<uuid>...]   (comma- or whitespace-separated, max 20)
 * POST /recipes/:id/verify               (verify a draft; the verify_draft twin)
 *
 * The REST twin of the MCP get_recipes tool — same service, same ACL, same
 * marker semantics (services/recipe-lookup.service.ts). Deliberately shaped so
 * a future citation-link layer could sit on top of it (see the worktree plan's
 * "rejected: public trace fetch" note — by-id lookup stays key-scoped).
 *
 * Rate limiting (WT-3 decision, 2026-07-05): the F29 audit-log limiter counts
 * only recipe.checked rows, so this read-only endpoint gets its own in-memory
 * per-credential cap instead — 600/hour keyed by the hashed Bearer token,
 * mirroring the F43 per-bearer backstop on /mcp (generous: lookups are cheap —
 * no embedding calls — and legitimate fleet use should never hit it first).
 * Trade-off, accepted: in-memory state resets on restart/redeploy; this
 * endpoint writes nothing, so a reset only briefly widens a scrape window that
 * the per-IP limiter still bounds. A per-IP limiter runs first for
 * defense in depth against many-key scraping from one host.
 */
import { Hono } from "hono";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { authenticateKey } from "../authz";
import {
  RECIPE_LOOKUP_MAX_IDS,
  lookupRecipes,
  parseRecipeIds,
} from "../services/recipe-lookup.service";
import { rateLimit, extractMcpBearerKey, getClientIp, hashApiKey } from "../middleware/rate-limit";
import { verifyDraft, describeVerifyResult } from "../services/draft-verify.service";

// Per-IP: 1000/hour (defense in depth, same shape as /mcp's per-IP limiter).
const recipesIpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

// Per-credential: 600/hour keyed by hashed Bearer (raw keys must not sit in
// memory as map keys). Falls back to IP bucketing when no Bearer is present.
const recipesPerKeyRateLimit = rateLimit({
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const token = extractMcpBearerKey(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

const recipes = new Hono<AppEnv>();

// GET /recipes?ids=...
// Authorization: Bearer <api-key>. No JWT — this is an agent surface.
recipes.get("/", recipesIpRateLimit, recipesPerKeyRateLimit, async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    return c.json({ ok: false, error: "Authorization: Bearer <api-key> required" }, 401);
  }
  const rawKey = match[1]!.trim();

  const db = getDb();
  const validated = await authenticateKey(db, rawKey);
  if (!validated) {
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  const idsParam = c.req.query("ids");
  if (!idsParam || idsParam.trim().length === 0) {
    return c.json({ ok: false, error: "ids parameter is required (comma-separated recipe UUIDs or 8+ char short-id prefixes)" }, 400);
  }

  const ids = parseRecipeIds(idsParam);
  if (ids.length === 0) {
    return c.json({ ok: false, error: "ids parameter is required (comma-separated recipe UUIDs or 8+ char short-id prefixes)" }, 400);
  }
  if (ids.length > RECIPE_LOOKUP_MAX_IDS) {
    return c.json(
      {
        ok: false,
        error: `Too many ids: ${ids.length} (max ${RECIPE_LOOKUP_MAX_IDS} per request). Split into multiple requests.`,
      },
      400,
    );
  }

  const entries = await lookupRecipes(db, ids, { readGroupIds: validated.readGroupIds, userId: validated.userId });
  return c.json({ ok: true, data: { recipes: entries } });
});

// POST /recipes/:id/verify — verify a draft with the person's answer
// (drafts-and-triage slice 2). The REST twin of the MCP verify_draft tool;
// every rule lives in services/draft-verify.service.ts. Body (JSON):
// { "supporting_evidence": "<interpretation>, then > the person's answer quoted, then -- where they said it" }
// (`evidence` is accepted as an alias). A draft this key cannot read by id is
// the same 404 as a random id, body included apart from the echoed id.
recipes.post("/:id/verify", recipesIpRateLimit, recipesPerKeyRateLimit, async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    return c.json({ ok: false, error: "Authorization: Bearer <api-key> required" }, 401);
  }
  const db = getDb();
  const principal = await authenticateKey(db, match[1]!.trim());
  if (!principal) {
    return c.json({ ok: false, error: "Invalid or expired API key" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "Body must be JSON: { \"supporting_evidence\": \"...\" }" }, 400);
  }
  const raw = body["supporting_evidence"] ?? body["evidence"];
  const evidence = typeof raw === "string" ? raw : "";

  const result = await verifyDraft(db, { principal, recipeId: c.req.param("id") ?? "", evidence });
  switch (result.status) {
    case "verified":
      return c.json({
        ok: true,
        data: {
          recipeId: result.recipeId,
          draftState: result.draftState,
          evidenceAdded: result.evidenceAdded,
          verifiedByDepositingKey: result.verifiedByDepositingKey,
        },
      });
    case "not_found_or_unreadable":
      return c.json({ ok: false, error: describeVerifyResult(result), recipeId: result.recipeId, status: result.status }, 404);
    case "ambiguous_prefix":
      return c.json({ ok: false, error: describeVerifyResult(result), recipeId: result.recipeId, status: result.status, candidates: result.candidates }, 400);
    case "not_a_draft":
    case "already_resolved":
      return c.json({ ok: false, error: describeVerifyResult(result), recipeId: result.recipeId, status: result.status }, 409);
    case "refused":
      return c.json({ ok: false, error: result.error, recipeId: result.recipeId, status: result.status }, 400);
  }
});

export { recipes as recipeRoutes };
