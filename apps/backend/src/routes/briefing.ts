/**
 * /briefing — API-key-authenticated briefing endpoint.
 *
 * Used by the stdio MCP server (apps/mcp-server) which doesn't have a JWT,
 * just the user's Bearer-token API key. The JWT-authenticated surface
 * lives at /keys/briefing (frontend Copy briefing buttons).
 *
 * Both endpoints call into services/briefing.composeBriefing() — single
 * source for the unified briefing.
 */
import { Hono } from "hono";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { composeBriefing } from "../services/briefing";
import { parseVerbosity, VERBOSITY_EXEMPLAR_K } from "@soupnet/domain";
import { validateKey } from "../services/api-key.service";
import { parseRecipeIds } from "../services/recipe-lookup.service";
import { invalidKeyMessage } from "../lib/key-remediation";

const briefing = new Hono<AppEnv>();

// GET /briefing
// Authorization: Bearer <api-key>. No JWT.
briefing.get("/", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    return c.json({ ok: false, error: "Authorization: Bearer <api-key> required" }, 401);
  }
  const rawKey = match[1]!.trim();

  const db = getDb();
  const validated = await validateKey(db, rawKey);
  if (!validated) {
    // Remediation copy rides in the error string so the stdio MCP proxy
    // (which surfaces backend `error` verbatim) inherits it — the bare
    // message stranded agents mid-task (2026-07-05 eval, key-death finding).
    return c.json({ ok: false, error: invalidKeyMessage() }, 401);
  }

  const backendUrl = process.env["BACKEND_URL"] ?? "http://localhost:3101";
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5273";

  const kParam = c.req.query("k");
  const k = kParam ? parseInt(kParam, 10) : undefined;

  // Verbosity lever (2026-07-26): level → exemplar count. Explicit k (the
  // pre-existing power param) wins; omitted verbosity leaves the briefing's
  // preference-driven default untouched.
  const verbosity = parseVerbosity(c.req.query("verbosity"));
  const verbosityK = verbosity ? VERBOSITY_EXEMPLAR_K[verbosity] : undefined;

  // WT-3: purpose biases within-cluster exemplar choice; recipe_ids renders
  // a "Requested recipes" section (same service/ACL/markers as GET /recipes).
  const recipeIdsParam = c.req.query("recipe_ids");
  const recipeIds = recipeIdsParam ? parseRecipeIds(recipeIdsParam) : undefined;

  // Connection surface (cold-start v2 Phase A): the stdio MCP proxy
  // self-identifies via the same X-SoupNet-Surface header it sends on /check;
  // any other Bearer caller of this REST endpoint records "rest". The HTTP
  // MCP tool stamps "mcp-http" itself and the JWT dashboard path stamps
  // "web" — every briefing.issued row now carries a real surface.
  const surface = c.req.header("x-soupnet-surface") === "mcp-stdio" ? "mcp-stdio" : "rest";

  const result = await composeBriefing({
    db,
    rawKey,
    backendUrl,
    frontendUrl,
    surface,
    options: {
      k: k && !Number.isNaN(k) ? k : verbosityK,
      axes: c.req.query("axes"),
      filter: c.req.query("filter"),
      vectorStrategy: c.req.query("strategy"),
      recipeBookIdOrSlug: c.req.query("recipe_book"),
      purpose: c.req.query("purpose"),
      // Declared intent (Phase C): text registers, int_… id joins — the
      // stdio proxy forwards its tool param here.
      intent: c.req.query("intent"),
      ...(recipeIds && recipeIds.length > 0 ? { recipeIds } : {}),
    },
  });

  if (!result.ok) {
    return c.json({ ok: false, error: "Briefing unavailable" }, 500);
  }

  return c.json({
    ok: true,
    data: {
      text: result.text,
      groups: result.groups,
      exemplarCount: result.exemplarCount,
    },
  });
});

export { briefing as briefingRoutes };
