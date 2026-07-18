import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MCP_TOOL_DESCRIPTIONS, MCP_PARAM_DESCRIPTIONS, CANONICAL_PARAM_SOURCES } from "@soupnet/domain";

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoutePath = join(here, "mcp.ts");
const mcpSource = readFileSync(mcpRoutePath, "utf-8");

// Layer 1 regression guard for the Group → Recipe Book rename (Decision A1).
// The MCP tool descriptions are the agent-facing surface — if they regress to
// "group" wording the rename is silently undone. Asserting the source contains
// the renamed names is faster and more stable than booting the MCP server.
describe("MCP tool descriptions — recipe-book rename", () => {
  it("registers the tool as list_my_recipe_books (not the old list_my_groups)", () => {
    expect(mcpSource).toContain('"list_my_recipe_books"');
    expect(mcpSource).not.toContain('"list_my_groups"');
  });

  it("registers the tool as update_recipe_book_description (not the old update_group_description)", () => {
    expect(mcpSource).toContain('"update_recipe_book_description"');
    expect(mcpSource).not.toContain('"update_group_description"');
  });

  it("uses the recipe-book vocabulary in the list-tool description", () => {
    // Find the description string immediately after the tool name. Looking
    // for the marker phrase rather than exact-string match so unrelated
    // wording tweaks don't break the test.
    const sliceFromTool = mcpSource.slice(mcpSource.indexOf('"list_my_recipe_books"'));
    const sliceForDescription = sliceFromTool.slice(0, 600);
    expect(sliceForDescription.toLowerCase()).toContain("recipe book");
  });

  it("renames the check_recipe parameters to recipe_book and read_recipe_books", () => {
    expect(mcpSource).toContain("recipe_book: z.string()");
    expect(mcpSource).toContain("read_recipe_books: z.string()");
  });
});

// WT-3 (2026-07-05): retrieval API. Same layer-1 source-level guard as above —
// if these registrations disappear, the recipe-lookup surface silently drops
// off the HTTP MCP while the stdio mirror keeps advertising it.
describe("MCP tool registrations — WT-3 retrieval API", () => {
  it("registers the get_recipes tool", () => {
    expect(mcpSource).toContain('"get_recipes"');
    expect(mcpSource).toContain("recipe_ids: z.string()");
  });

  it("get_briefing accepts purpose and recipe_ids params", () => {
    expect(mcpSource).toContain("purpose: z.string().optional()");
    expect(mcpSource).toContain("recipe_ids: z.string().optional()");
  });

  it("the stdio mirror registers get_recipes too", () => {
    const stdioSource = readFileSync(
      join(here, "..", "..", "..", "mcp-server", "src", "index.ts"),
      "utf-8",
    );
    expect(stdioSource).toContain('"get_recipes"');
    expect(stdioSource).toContain("purpose: z.string().optional()");
  });
});

// WP2 (2026-07-06): premium `synthesize` opt-in. Both MCP surfaces must expose
// the param — if either registration drops, one surface silently loses the
// feature while the other keeps advertising it (the same drift the WT-3 guard
// above protects against).
describe("MCP tool registrations — WP2 premium synthesize", () => {
  it("the HTTP MCP check_recipe registers the synthesize param", () => {
    expect(mcpSource).toContain("synthesize: z.boolean().optional()");
  });

  it("the stdio mirror registers the synthesize param too", () => {
    const stdioSource = readFileSync(
      join(here, "..", "..", "..", "mcp-server", "src", "index.ts"),
      "utf-8",
    );
    expect(stdioSource).toContain("synthesize: z.boolean().optional()");
  });
});

// Session-token feedback capture (2026-07-17): feedback rows accept an
// optional session_id joining them to the check lineage their session
// produced. Same drift guard as WT-3/WP2 — if one surface drops the field,
// the other keeps advertising it.
describe("MCP tool registrations — feedback session_id capture", () => {
  it("the HTTP MCP registers session_id on both feedback surfaces", () => {
    // feedbackRowSchema (check_recipe ride-along) + log_feedback flat params.
    const matches = mcpSource.match(/session_id: z\.string\(\)\.optional\(\)/g) ?? [];
    // ≥ 3: check_recipe's own session_id param, the feedback row schema, and
    // the log_feedback tool.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("the stdio mirror registers session_id on both feedback surfaces too", () => {
    const stdioSource = readFileSync(
      join(here, "..", "..", "..", "mcp-server", "src", "index.ts"),
      "utf-8",
    );
    const matches = stdioSource.match(/session_id: z\.string\(\)\.optional\(\)/g) ?? [];
    // ≥ 2: the feedback row schema and the log_feedback tool (the stdio
    // check_recipe has no check-level session_id param yet — see backlog).
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// Description budget (2026-07-06): tool/param descriptions are affordances;
// teaching lives in the briefing. The pre-trim tools/list was ~18KB and spent
// ~4.4k tokens of every connected conversation. These caps keep depth from
// creeping back into schema — when a description wants to grow past them,
// the growth belongs in BRIEFING/docs with a one-line pointer here.
describe("MCP tool description budget", () => {
  const all = { ...MCP_TOOL_DESCRIPTIONS, ...MCP_PARAM_DESCRIPTIONS };

  it("keeps every shared description affordance-sized (≤ 420 chars)", () => {
    for (const [name, text] of Object.entries(all)) {
      expect(text.length, `${name} is ${text.length} chars`).toBeLessThanOrEqual(420);
    }
  });

  it("keeps the shared-copy total under 4,400 chars", () => {
    // 4,000 → 4,300 (2026-07-17): the session_id param joined check_recipe
    // (ranking simplification, plan v2 seam 2) and the previous total sat at
    // 3,998 — the cap had no headroom for a genuinely new param. The cap's
    // job is unchanged: any further growth must be a deliberate, dated raise
    // here, not silent depth creep in existing descriptions.
    // 4,300 → 4,400 (2026-07-17): sessionId gained the operator-directed
    // context-compaction hint (omit the token to refresh the session —
    // recipe 31d184df) with the prior total at 4,279.
    const total = Object.values(all).reduce((n, s) => n + s.length, 0);
    expect(total).toBeLessThanOrEqual(4400);
  });
});

// Derivation drift guard (operator ruling 2026-07-18, recipe 43ce7ec0): the
// budget-capped short-form param descriptions derive from the canonical field
// definitions in @soupnet/contracts (the same source the published JSON
// Schema and validation use). Each short form must keep sharing its source's
// load-bearing concepts — an edit that severs the derivation on either side
// is a red test, not silent drift.
describe("MCP param descriptions — canonical-source derivation", () => {
  const loadBearing: Record<keyof typeof CANONICAL_PARAM_SOURCES, string[]> = {
    // Voice contract: human's voice, transferable role, the recipe shape.
    recipe: ["voice", "transferable", "so that"],
    // Known-stub contract: stub rendering, rendering-only (never ranking).
    knownRecipes: ["stub", "rendering", "ranking"],
    // Session contract: omit-to-refresh, stubs, ranking untouched.
    sessionId: ["omit", "stub", "ranking"],
    // Judgment-date contract: backfilled decisions from dated artifacts.
    decidedAt: ["backfill", "artifact", "8601"],
  };

  it("every derived short form has its canonical constant, and both are non-trivial", () => {
    for (const [param, canonical] of Object.entries(CANONICAL_PARAM_SOURCES)) {
      expect(canonical, `${param} canonical source`).toBeTruthy();
      expect(canonical.length, `${param} canonical length`).toBeGreaterThan(100);
      const short = MCP_PARAM_DESCRIPTIONS[param as keyof typeof CANONICAL_PARAM_SOURCES];
      expect(short, `${param} short form`).toBeTruthy();
    }
  });

  it("each short form shares its canonical source's load-bearing concepts", () => {
    for (const [param, concepts] of Object.entries(loadBearing)) {
      const canonical = CANONICAL_PARAM_SOURCES[param as keyof typeof CANONICAL_PARAM_SOURCES].toLowerCase();
      const short = MCP_PARAM_DESCRIPTIONS[param as keyof typeof CANONICAL_PARAM_SOURCES].toLowerCase();
      for (const concept of concepts) {
        expect(canonical, `${param} canonical mentions "${concept}"`).toContain(concept.toLowerCase());
        expect(short, `${param} short form mentions "${concept}"`).toContain(concept.toLowerCase());
      }
    }
  });
});
