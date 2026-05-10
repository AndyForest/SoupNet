import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
