import { describe, it, expect } from "vitest";
import { RECIPE_TEXT_DEFINITION, SESSION_ID_DEFINITION } from "@soupnet/contracts";

/**
 * GET /schemas/* — the published wire schemas (canonical Recipe format,
 * operator ruling 2026-07-18, recipe 7945fd8a). Integration half needs a
 * running backend (skipped otherwise); the $ref-integrity checks run on the
 * fetched documents so they cover exactly what agents download.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface JsonSchemaDoc {
  $ref?: string;
  definitions?: Record<string, { properties?: Record<string, { description?: string }> }>;
}

/** Walk the document collecting every local $ref. */
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

/** Resolve a local JSON-pointer $ref ("#/definitions/…", possibly a deep
 *  path — the recursive Recipe emits path-style refs) against the doc. */
function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const rawSeg of ref.slice(2).split("/")) {
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

describe.skipIf(!BASE)("GET /schemas", () => {
  it("serves recipe.json: 200, JSON, resolvable $refs, canonical descriptions embedded", async () => {
    const res = await fetch(`${BASE}/schemas/recipe.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const doc = (await res.json()) as JsonSchemaDoc;

    // Root points into definitions, and every local $ref resolves there.
    expect(doc.$ref).toBe("#/definitions/Recipe");
    for (const ref of collectRefs(doc)) {
      expect(resolvePointer(doc, ref), ref).toBeDefined();
    }

    // The canonical field definitions are embedded verbatim — the schema IS
    // the documentation (recipe 43ce7ec0: one source, no drift).
    const raw = JSON.stringify(doc);
    expect(raw).toContain(RECIPE_TEXT_DEFINITION.slice(0, 60));
    expect(raw).toContain("The recipe's stable id");
    expect(raw).toContain("Raw cosine similarity");
  });

  it("serves check-response.json: 200, resolvable $refs, session description embedded", async () => {
    const res = await fetch(`${BASE}/schemas/check-response.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as JsonSchemaDoc;
    expect(doc.$ref).toBe("#/definitions/CheckResponse");
    for (const ref of collectRefs(doc)) {
      expect(resolvePointer(doc, ref), ref).toBeDefined();
    }
    expect(JSON.stringify(doc)).toContain(SESSION_ID_DEFINITION.slice(0, 60));
    // Public, cacheable-for-an-hour surface.
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
  });
});
