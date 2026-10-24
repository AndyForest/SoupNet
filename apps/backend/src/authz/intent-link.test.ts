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
 *
 * Shape-matching a statement misses forms it was not written for (a quoted
 * identifier, a column named through an interpolated fragment: the slice 6a
 * verification found four), so the first test pins every mention of the
 * column name, quoted or not, per file, the way scripts/check-authz-seam.mjs
 * pins recipe-table statements. A new mention anywhere fails until someone
 * reads it and updates the register below with a reason. `check_feedback`
 * and `intent_shown` have intent_id columns too, so their mentions are
 * registered here as well.
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

/** The column name, bare or as a quoted identifier, not inside a longer word. */
const COLUMN = /"?\bintent_id\b"?/g;

/**
 * Every file that names an `intent_id` column, with how many times and why.
 * Update a count only after reading the new mention: a write to
 * traces.intent_id anywhere but the deposit is exactly what this stops.
 */
const REGISTER: Readonly<Record<string, { n: number; why: string }>> = {
  "routes/auth.ts": { n: 1, why: "export: reads traces.intent_id, carried only when the exporter owns the intent (S6a-E1)" },
  "routes/check.ts": { n: 1, why: "the feedback_intent_id ride-along param mapped to a check_feedback row field" },
  "routes/feedback.ts": { n: 2, why: "GET /feedback query param for a check_feedback row" },
  "routes/mcp.ts": { n: 1, why: "log_feedback's intent_id parameter (check_feedback)" },
  "routes/traces.ts": { n: 1, why: "reads check_feedback.intent_id for the per-recipe feedback list" },
  "services/draft-queue.service.ts": { n: 2, why: "reads traces.intent_id joined to the viewer's own intents (S6a-G1, S6a-G2)" },
  "services/feedback.service.ts": { n: 4, why: "the check_feedback row's intent_id field" },
  "services/intent.service.ts": { n: 2, why: "intent_shown's intent_id (rendering ledger)" },
  "services/search-selection.ts": { n: 1, why: "reads traces.intent_id in the intent: selection (S6a-Q2)" },
  "services/trace.service.ts": { n: 2, why: "the deposit INSERT, the one raw writer (S6a-S2), and its comment" },
};

/** Each SQL statement starting at `pattern`, up to the end of its tagged template. */
function statements(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(pattern)) {
    const end = text.indexOf("`", m.index);
    out.push(text.slice(m.index, end === -1 ? undefined : end));
  }
  return out;
}

const TRACES_TABLE = /(?:claimnet|"claimnet")\.(?:traces|"traces")\b/;

describe("traces.intent_id has two writers and is never changed (S6a-S4)", () => {
  it("every mention of an intent_id column is registered, file by file", () => {
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = [...f.text.matchAll(COLUMN)].length;
      if (n > 0) found[f.path] = n;
    }
    const expected = Object.fromEntries(Object.entries(REGISTER).map(([path, { n }]) => [path, n]));
    expect(found, "a mention of intent_id changed: read it, then update REGISTER with the reason").toEqual(expected);
  });

  it("no UPDATE of claimnet.traces names the column, quoted or not", () => {
    for (const f of files) {
      for (const stmt of statements(f.text, new RegExp(`UPDATE\\s+${TRACES_TABLE.source}`, "gi"))) {
        expect(stmt, f.path).not.toMatch(/"?\bintent_id\b"?/i);
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

  it("the deposit's one raw INSERT is the only one that writes it, from the resolved intent", () => {
    const writers = files
      .filter((f) => statements(f.text, new RegExp(`INSERT\\s+INTO\\s+${TRACES_TABLE.source}`, "gi")).some((s) => /\bintent_id\b/.test(s)))
      .map((f) => f.path);
    expect(writers).toEqual(["services/trace.service.ts"]);
    const deposit = files.find((f) => f.path === "services/trace.service.ts")!.text;
    expect(deposit).toMatch(/subject_user_id, intent_id\)\s*VALUES \([^`]*\$\{intent\.intentId\}\)/);
    expect(deposit).not.toMatch(/\$\{params\.intent\}/);
  });

  it("the only Drizzle insert into traces that sets intentId is import's, and only from the importer's own intents", () => {
    const setters: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/\.insert\(\s*(traces|tracesTable)\b/g)) {
        const end = f.text.indexOf(".returning(", m.index);
        const call = f.text.slice(m.index, end === -1 ? f.text.indexOf(";", m.index) : end);
        if (!call.includes("intentId")) continue;
        setters.push(f.path);
        const values = [...call.matchAll(/\bintentId:\s*([^,\n]+)/g)].map((v) => v[1]!.trim());
        expect(values, f.path).toEqual(["t.intentId !== null && ownIntents.has(t.intentId) ? t.intentId : null"]);
      }
    }
    expect(setters).toEqual(["services/import.service.ts"]);
    const importer = files.find((f) => f.path === "services/import.service.ts")!.text;
    expect(importer).toMatch(/const ownIntents = await ownedIntentIds\(\s*tx,\s*userId,/);
  });
});
