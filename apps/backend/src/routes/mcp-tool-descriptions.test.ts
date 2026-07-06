import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MCP_TOOL_DESCRIPTIONS, MCP_PARAM_DESCRIPTIONS } from "@soupnet/domain";

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

  it("keeps the shared-copy total under 4,000 chars", () => {
    const total = Object.values(all).reduce((n, s) => n + s.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
  });
});
