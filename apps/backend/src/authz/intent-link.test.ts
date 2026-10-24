import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard for the recipe-to-intent link (drafts-and-triage slice 6a,
 * rubric S6a-S2, S6a-S4, S6a-E2). `traces.intent_id` is written by two
 * statements and changed by none: the deposit's one INSERT, from the intent
 * that check resolved to the depositor, and import's trace insert, only onto
 * the importer's own intents. Verification, moves, and the on-behalf author
 * flip all leave it as deposited. A link that some later statement could
 * rewrite would let a recipe join a run it was not part of, so the proof is
 * that no such statement exists in the backend source.
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

/** Each SQL statement starting at `pattern`, up to the end of its tagged template. */
function statements(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(pattern)) {
    const end = text.indexOf("`", m.index);
    out.push(text.slice(m.index, end === -1 ? undefined : end));
  }
  return out;
}

describe("traces.intent_id has two writers and is never changed (S6a-S4)", () => {
  it("no UPDATE of claimnet.traces names the column", () => {
    for (const f of files) {
      for (const stmt of statements(f.text, /UPDATE\s+claimnet\.traces\b/gi)) {
        expect(stmt, f.path).not.toMatch(/\bintent_id\b/i);
      }
    }
  });

  it("no Drizzle update of the traces table sets intentId", () => {
    for (const f of files) {
      for (const m of f.text.matchAll(/\.update\(\s*(traces|tracesTable)\b/g)) {
        const call = f.text.slice(m.index, f.text.indexOf(";", m.index));
        expect(call, f.path).not.toContain("intentId");
      }
    }
  });

  it("the deposit's one raw INSERT is the only one that writes it", () => {
    const writers = files
      .filter((f) => statements(f.text, /INSERT\s+INTO\s+claimnet\.traces\b/gi).some((s) => /\bintent_id\b/.test(s)))
      .map((f) => f.path);
    expect(writers).toEqual(["services/trace.service.ts"]);
    const deposit = files.find((f) => f.path === "services/trace.service.ts")!.text;
    // The value is the intent step 1e resolved, never a raw parameter.
    expect(deposit).toMatch(/subject_user_id, intent_id\)\s*VALUES \([^`]*\$\{intent\.intentId\}\)/);
    expect(deposit).not.toMatch(/\$\{params\.intent\}/);
  });

  it("import's trace insert is the only Drizzle insert that sets it, and only from the importer's own intents", () => {
    const setters = files.filter((f) => /\bintentId:\s*t\.intentId\b/.test(f.text)).map((f) => f.path);
    expect(setters).toEqual(["services/import.service.ts"]);
    const importer = files.find((f) => f.path === "services/import.service.ts")!.text;
    expect(importer).toContain("intentId: t.intentId !== null && ownIntents.has(t.intentId) ? t.intentId : null");
    expect(importer).toMatch(/const ownIntents = await ownedIntentIds\(\s*tx,\s*userId,/);
  });
});
