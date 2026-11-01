// The OpenAI plugin package (docs/planning/openai-plugin-build/listing.md,
// rows L5 to L9 and L11): the source in plugins/soupnet/ meets every
// submission limit, the ZIP is reproducible, the skill carries no vendor
// wording, and the Codex marketplace points at the package.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_DIR, buildPackage, contrastRatio, pngSize, scanForSecrets, validatePackage, zipFiles } from "./package.mjs";

const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "plugin.json"), "utf-8"));
const ui = manifest.extensions["com.openai"].interface;

describe("the OpenAI plugin package", () => {
  it("rejects the array shape refused by the portal", () => {
    const dir = mkdtempSync(join(tmpdir(), "soupnet-plugin-"));
    try {
      cpSync(PACKAGE_DIR, dir, { recursive: true });
      const copy = structuredClone(manifest);
      copy.extensions["com.openai"].review.test_cases.positive[0].tools_triggered = ["get_briefing"];
      writeFileSync(join(dir, "plugin.json"), JSON.stringify(copy));
      expect(validatePackage(dir)).toContain("positive case 1 needs tools_triggered as a nonempty string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates against the submission limits", () => {
    expect(validatePackage()).toEqual([]);
  });

  it("meets the brand-colour contrast floors (S L9)", () => {
    expect(contrastRatio(ui.brandColor, "#ffffff")).toBeGreaterThanOrEqual(2);
    expect(contrastRatio(ui.brandColorDark, "#212121")).toBeGreaterThanOrEqual(2);
  });

  it("builds the same bytes twice (L8)", () => {
    const first = buildPackage();
    const second = buildPackage();
    expect(first.sha256).toBe(second.sha256);
    expect(first.files).toEqual([...first.files].sort());
    expect(first.files).toEqual(expect.arrayContaining(["plugin.json", "mcp.json", "skills/recipe-check/SKILL.md", "assets/soupnet-icon.png"]));
  });

  it("writes a ZIP whose directory lists every entry", () => {
    const zip = zipFiles([{ name: "a.txt", data: Buffer.from("alpha") }, { name: "b/c.txt", data: Buffer.from("beta") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(2);
  });

  it("names the test cases' tools from the server's real tool roster (L11)", () => {
    const roster = ["check_recipe", "get_briefing", "get_recipes", "list_my_recipe_books", "log_feedback", "search_recipes", "update_recipe_book_description", "verify_draft"];
    const triggered = manifest.extensions["com.openai"].review.test_cases.positive.flatMap((c: { tools_triggered: string }) => {
      expect(typeof c.tools_triggered).toBe("string");
      return c.tools_triggered.split(",").map((tool) => tool.trim());
    });
    for (const tool of triggered) expect(roster).toContain(tool);
  });

  it("keeps listing copy free of pricing, trials and comparisons (L10)", () => {
    const copy = [ui.displayName, ui.shortDescription, ui.longDescription, manifest.description, ...ui.defaultPrompt].join("\n");
    expect(copy).not.toMatch(/\b(free|pricing|price|trial|upgrade|premium|discount|better than|unlike)\b/i);
    expect(copy).not.toMatch(/\b(Claude|Anthropic|Cursor|Gemini|Copilot)\b/);
  });

  it("refuses a package that breaks a limit", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(pngSize(Buffer.from("not a png"))).toBeNull();
  });

  it("refuses credential-shaped strings and private email addresses", () => {
    const fakeKey = ["cn", "d", "Ab3dEf6hIj9kLm2nOp5qRs8t"].join("_");
    expect(scanForSecrets("x.md", `key: ${fakeKey}`)).toEqual(["x.md contains a Soup.net API key"]);
    expect(scanForSecrets("x.md", "Authorization: Bearer abcdefghijklmnopqrstuvwx")).toHaveLength(1);
    expect(scanForSecrets("x.md", "reviewer password: hunter2")).toHaveLength(1);
    expect(scanForSecrets("x.md", "write to reviewer@example.com")).toHaveLength(1);
    expect(scanForSecrets("x.md", "Questions: admin@soup.net. Use Authorization: Bearer YOUR_API_KEY.")).toEqual([]);
  });
});

describe("the recipe-check skill (L5)", () => {
  const skill = readFileSync(join(PACKAGE_DIR, "skills/recipe-check/SKILL.md"), "utf-8");

  it("has name and description frontmatter", () => {
    expect(skill).toMatch(/^---\r?\nname: recipe-check\r?\ndescription: .+\r?\n---/);
  });

  it("carries no vendor or harness names", () => {
    expect(skill).not.toMatch(/\b(Claude|Anthropic|ChatGPT|OpenAI|Codex|Cursor|Gemini|Copilot|Windsurf|CLAUDE\.md|AGENTS\.md)\b/);
  });

  it("covers the when-to-check moments, drafts, search and feedback", () => {
    for (const part of ["Before starting a task", "At a judgment call", "After meaningful work", "draft: true", "search_recipes", "log_feedback", "get_briefing"]) {
      expect(skill).toContain(part);
    }
  });
});

describe("the optional skills", () => {
  for (const [name, parts] of [
    ["options", ["too thin to act on", "check it"]],
    ["seed-from-history", ["decided_at", "The briefing"]],
    ["agent-team", ["is:draft intent:", "verify_draft"]],
  ] as const) {
    const skill = readFileSync(join(PACKAGE_DIR, `skills/${name}/SKILL.md`), "utf-8");

    it(`${name} has frontmatter that calls itself optional`, () => {
      expect(skill).toMatch(new RegExp(`^---\\r?\\nname: ${name}\\r?\\ndescription: Optional .+\\r?\\n---`));
    });

    it(`${name} carries no vendor or harness names`, () => {
      expect(skill).not.toMatch(/\b(Claude|Anthropic|ChatGPT|OpenAI|Codex|Cursor|Gemini|Copilot|Windsurf|CLAUDE\.md|AGENTS\.md)\b/);
    });

    it(`${name} gives no orders`, () => {
      expect(skill).not.toMatch(/\b(must|always|never|required|you should)\b/i);
    });

    it(`${name} keeps to what it is for`, () => {
      for (const part of parts) expect(skill).toContain(part);
    });
  }
});

describe("the Codex marketplace file (L6)", () => {
  const marketplace = JSON.parse(readFileSync(".agents/plugins/marketplace.json", "utf-8"));

  it("lists the package as a local source that resolves to the plugin", () => {
    const [entry] = marketplace.plugins;
    expect(entry.source).toEqual({ source: "local", path: `./${PACKAGE_DIR}` });
    expect(existsSync(join(entry.source.path, "plugin.json"))).toBe(true);
    expect(entry.name).toBe(manifest.name);
    expect(entry.category).toBe(ui.category);
    expect(entry.policy.installation).toBe("AVAILABLE");
  });
});
