/**
 * Published wire schemas — GET /schemas/recipe.json and
 * /schemas/check-response.json.
 *
 * Public like /docs (no auth: the schemas describe shapes, not data), served
 * from the JSON Schemas generated at module load in @soupnet/contracts —
 * the SAME zod objects the response builders are typed against, with every
 * field's canonical description embedded (operator ruling 2026-07-18,
 * recipe 7945fd8a: one specified recipe format; recipe 43ce7ec0: generate
 * docs and validation from one source so they cannot drift). The briefing
 * points here for full field meanings.
 */

import { Hono } from "hono";
import { recipeJsonSchema, checkResponseJsonSchema } from "@soupnet/contracts";

export const schemas = new Hono();

/** Modest cache: schemas change only on deploy; an hour keeps agent traffic
 *  cheap without pinning stale shapes across releases. */
const CACHE_CONTROL = "public, max-age=3600";

schemas.get("/recipe.json", (c) => {
  c.header("Cache-Control", CACHE_CONTROL);
  return c.json(recipeJsonSchema);
});

schemas.get("/check-response.json", (c) => {
  c.header("Cache-Control", CACHE_CONTROL);
  return c.json(checkResponseJsonSchema);
});
