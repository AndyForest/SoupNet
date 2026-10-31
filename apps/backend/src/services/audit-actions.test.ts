import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_LOG_ACTIONS, ACCOUNT_EVENT_ACTIONS } from "./audit-actions";

/**
 * Every audit action the backend writes is classified exactly once (rubric
 * R-C1, docs/planning/openai-plugin-build/audit-log-retention.md). The scan
 * reads the backend's source, so a new audit write fails here until its
 * action is named as check log or account event.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Actions as the backend writes them: `action: "…"` in writeAudit and
 *  insert(auditLog) calls, quoted literals inside an INSERT INTO
 *  claimnet.audit_log statement, and the values of a `*_ACTIONS` map. */
function writtenActions(): Set<string> {
  const found = new Set<string>();
  const ACTION = /^[a-z_]+\.[a-z_]+$/;
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith("audit-actions.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\baction:\s*["']([a-z_]+\.[a-z_]+)["']/g)) found.add(m[1]!);
    for (const m of text.matchAll(/INSERT INTO claimnet\.audit_log[\s\S]*?`/g)) {
      for (const lit of m[0].matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.add(lit[1]!);
    }
    for (const m of text.matchAll(/[A-Z_]+_ACTIONS[^=]*=\s*\{([\s\S]*?)\}/g)) {
      for (const lit of m[1]!.matchAll(/["']([^"']+)["']/g)) if (ACTION.test(lit[1]!)) found.add(lit[1]!);
    }
  }
  return found;
}

describe("audit actions are classified (R-C1)", () => {
  const checkLog = new Set<string>(CHECK_LOG_ACTIONS);
  const events = new Set<string>(ACCOUNT_EVENT_ACTIONS);
  const written = writtenActions();

  it("finds the writes it is meant to find", () => {
    for (const a of ["recipe.checked", "check.searched", "briefing.issued", "recipe.draft_verified", "recipe_book.reaped", "recipe_book.ownership_transferred"]) {
      expect(written.has(a), a).toBe(true);
    }
  });

  it("every action written is check log or account event, never both", () => {
    for (const a of written) expect(checkLog.has(a) !== events.has(a), `${a} must be in exactly one list`).toBe(true);
  });

  it("the lists name no action the backend no longer writes", () => {
    for (const a of [...checkLog, ...events]) expect(written.has(a), `${a} is listed but not written`).toBe(true);
  });
});
