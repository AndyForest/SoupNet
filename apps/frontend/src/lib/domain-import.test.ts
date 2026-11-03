import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The SPA reaches @soupnet/domain only through its browser-safe entry,
// "@soupnet/domain/browser". The main entry carries modules that import Node
// built-ins (the stub embeddings use crypto), which Vite can't bundle, so an
// import of it typechecks and then fails the deploy's build (stream Console,
// 2026-10-26). Static on purpose: it reads the source, so it fails before
// anything is bundled.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const MAIN_ENTRY = /from\s+["']@soupnet\/domain["']|import\(\s*["']@soupnet\/domain["']\s*\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // This file names the main entry in its own example below.
    return /\.(ts|tsx)$/.test(name) && name !== "domain-import.test.ts" ? [path] : [];
  });
}

describe("the SPA's imports of @soupnet/domain", () => {
  it("go through @soupnet/domain/browser only", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => MAIN_ENTRY.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });

  it("would catch the main entry if it came back", () => {
    expect(MAIN_ENTRY.test('import { columnsFor } from "@soupnet/domain";')).toBe(true);
    expect(MAIN_ENTRY.test('import type { OrgRole } from "@soupnet/domain/browser";')).toBe(false);
  });
});
