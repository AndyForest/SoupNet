import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard for the key's deposit level (drafts-and-triage slice 5,
 * rubric S5-S2, S5-K2, S5-O1). The level is written once, at mint, by the
 * scoped-key INSERT; it is read by authentication and displayed by the key
 * list; nothing ever updates it. A headless key that could be made full again
 * by any statement would not be headless, so the proof is that no such
 * statement exists in the backend source.
 */

const backendSrc = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

const files = walk(backendSrc).map((f) => ({ path: relative(backendSrc, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));

describe("deposit_level is written once, at mint (S5-S2)", () => {
  it("only authentication and the key service mention the column", () => {
    const mentioning = files.filter((f) => f.text.includes("deposit_level")).map((f) => f.path).sort();
    expect(mentioning).toEqual(["authz/key-auth.ts", "services/api-key.service.ts"]);
  });

  it("no statement assigns it (no UPDATE … SET deposit_level)", () => {
    for (const f of files) {
      expect(f.text, f.path).not.toMatch(/deposit_level\s*=/i);
      expect(f.text, f.path).not.toMatch(/SET[^;`]*deposit_level/i);
    }
  });

  it("authentication only reads it, and the key service names it only in the scoped INSERT and the list SELECT", () => {
    const auth = files.find((f) => f.path === "authz/key-auth.ts")!.text;
    expect(auth).toMatch(/SELECT k\.id,[^`]*k\.deposit_level/);

    const service = files.find((f) => f.path === "services/api-key.service.ts")!.text;
    const functionBody = (name: string): string => {
      const start = service.indexOf(`export async function ${name}(`);
      const next = service.indexOf("export async function ", start + 1);
      return service.slice(start, next === -1 ? undefined : next);
    };
    expect(functionBody("generateScopedKey")).toMatch(/INSERT INTO claimnet\.api_keys \([^)]*deposit_level/);
    expect(functionBody("listKeys")).toMatch(/SELECT[^`]*deposit_level/);
    // The daily key keeps the column default (S5-O1), and revocation deletes.
    expect(functionBody("generateDailyKey")).not.toContain("deposit_level");
    expect(functionBody("revokeKey")).not.toContain("deposit_level");
  });

  it("OAuth issuance and rotation leave the default (S5-O1)", () => {
    for (const f of files.filter((x) => /oauth/i.test(x.path))) {
      expect(f.text, f.path).not.toContain("deposit_level");
      expect(f.text, f.path).not.toContain("depositLevel");
    }
  });
});
