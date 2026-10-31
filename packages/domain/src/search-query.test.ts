import { describe, expect, it } from "vitest";
import {
  AUTHOR_ME,
  parseSearchQuery,
  SEARCH_QUERY_MAX_AUTHOR_VALUES,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MAX_LEXICAL_TERMS,
} from "./search-query";

function parsed(input: string) {
  const r = parseSearchQuery(input);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.query;
}

function errorOf(input: string): string {
  const r = parseSearchQuery(input);
  if (r.ok) throw new Error(`expected error, got ok: ${JSON.stringify(r.query)}`);
  return r.error;
}

describe("parseSearchQuery — semantic text", () => {
  it("treats a plain query as pure semantic text (today's filter behavior)", () => {
    const q = parsed("narrative read model decisions");
    expect(q.semanticText).toBe("narrative read model decisions");
    expect(q.lexicalGroups).toEqual([]);
    expect(q.authors).toEqual({ kind: "surface-default" });
    expect(q.after).toBeUndefined();
    expect(q.before).toBeUndefined();
  });

  it("keeps kebab-case filenames, dots, and hyphens as semantic text", () => {
    const q = parsed("vector-search.service.ts ranking -lever");
    expect(q.semanticText).toBe("vector-search.service.ts ranking -lever");
  });

  it("keeps URLs as semantic text (scheme colon is not a qualifier)", () => {
    const q = parsed("docs at https://example.com/page");
    expect(q.semanticText).toBe("docs at https://example.com/page");
  });

  it("keeps Windows drive-letter paths as semantic text (single-letter name)", () => {
    const q = parsed("C:\\github\\SoupNet notes");
    expect(q.semanticText).toBe("C:\\github\\SoupNet notes");
  });

  it("keeps a trailing bare colon as prose", () => {
    const q = parsed("note: this matters");
    expect(q.semanticText).toBe("note: this matters");
  });

  it("collapses whitespace runs between tokens", () => {
    const q = parsed("  a   b\t c  ");
    expect(q.semanticText).toBe("a b c");
  });

  it("rejects an empty or whitespace-only query", () => {
    expect(errorOf("")).toMatch(/required/);
    expect(errorOf("   ")).toMatch(/required/);
  });

  it("rejects an over-length query", () => {
    expect(errorOf("x".repeat(SEARCH_QUERY_MAX_LENGTH + 1))).toMatch(/exceeds/);
  });
});

describe("parseSearchQuery — quoted lexical terms", () => {
  it("parses a single quoted term as one lexical group", () => {
    const q = parsed('"evaluation-run.server.ts"');
    expect(q.lexicalGroups).toEqual([["evaluation-run.server.ts"]]);
    expect(q.semanticText).toBe("");
  });

  it("ANDs multiple quoted terms as separate groups", () => {
    const q = parsed('"a.ts" "b.ts"');
    expect(q.lexicalGroups).toEqual([["a.ts"], ["b.ts"]]);
  });

  it("mixes semantic text and quoted terms", () => {
    const q = parsed('read model "narrative-evaluation-result.ts" design');
    expect(q.semanticText).toBe("read model design");
    expect(q.lexicalGroups).toEqual([["narrative-evaluation-result.ts"]]);
  });

  it("parses a parenthesized OR-group of quoted terms", () => {
    const q = parsed('("a.ts" OR "b.ts" OR "c/d.ts")');
    expect(q.lexicalGroups).toEqual([["a.ts", "b.ts", "c/d.ts"]]);
  });

  it("parses a top-level OR chain of quoted terms as one group", () => {
    const q = parsed('"a.ts" OR "b.ts"');
    expect(q.lexicalGroups).toEqual([["a.ts", "b.ts"]]);
  });

  it("treats lowercase 'or' as semantic prose, not an operator", () => {
    const q = parsed('"a.ts" or thereabouts');
    expect(q.lexicalGroups).toEqual([["a.ts"]]);
    expect(q.semanticText).toBe("or thereabouts");
  });

  it("negates a quoted term with a leading minus", () => {
    const q = parsed('"keep.ts" -"drop.ts"');
    expect(q.lexicalGroups).toEqual([["keep.ts"]]);
    expect(q.lexicalNegated).toEqual(["drop.ts"]);
  });

  it("rejects a bare-word OR group with quoting guidance", () => {
    expect(errorOf("(alpha OR beta)")).toMatch(/quote each term/);
  });

  // A prose parenthetical is bare text (recipes 8481d9bc, f0c39b29): a group
  // with nothing grammar-shaped inside reads as part of the semantic phrase.
  it("reads a prose parenthetical as semantic text, kept as written", () => {
    const q = parsed("draft PR body (merge order, open questions, verification)");
    expect(q.semanticText).toBe("draft PR body (merge order, open questions, verification)");
    expect(q.lexicalGroups).toEqual([]);
    expect(parsed("(alpha beta) gamma").semanticText).toBe("(alpha beta) gamma");
    expect(parsed("(alpha)").semanticText).toBe("(alpha)");
  });

  it("keeps a prose parenthetical beside quoted terms and qualifiers", () => {
    const q = parsed('"search.ts" ranking (the MMR pass) author:me');
    expect(q.semanticText).toBe("ranking (the MMR pass)");
    expect(q.lexicalGroups).toEqual([["search.ts"]]);
    expect(q.authors).toEqual({ kind: "listed", values: ["me"] });
  });

  it("keeps the strict reading for any group holding grammar", () => {
    expect(errorOf('(alpha "b.ts")')).toMatch(/separated by OR/);
    expect(errorOf("(alpha OR beta)")).toMatch(/quote each term/);
    expect(errorOf("(author:me)")).toMatch(/quote each term/);
    expect(errorOf("(see athor:me)")).toMatch(/separated by OR/);
    expect(errorOf("(outer (inner) words)")).toMatch(/separated by OR/);
    expect(errorOf("prose (unclosed")).toMatch(/unterminated group/);
    expect(errorOf("( )")).toMatch(/empty group/);
  });

  it("rejects OR followed by a bare word at top level", () => {
    expect(errorOf('"a.ts" OR beta')).toMatch(/quote/);
  });

  it("rejects an unterminated quote", () => {
    expect(errorOf('"a.ts')).toMatch(/unterminated quote/);
  });

  it("rejects an empty quoted term", () => {
    expect(errorOf('""')).toMatch(/empty quoted term/);
  });

  it("rejects an unterminated group", () => {
    expect(errorOf('("a.ts" OR "b.ts"')).toMatch(/unterminated group/);
  });

  it("rejects an empty group", () => {
    expect(errorOf("()")).toMatch(/empty group/);
  });

  it("rejects group items not separated by OR", () => {
    expect(errorOf('("a.ts" "b.ts")')).toMatch(/separated by OR/);
  });

  it("rejects a group ending after OR", () => {
    expect(errorOf('("a.ts" OR )')).toMatch(/ends after OR/);
  });

  it("caps the total number of lexical terms", () => {
    const terms = Array.from({ length: SEARCH_QUERY_MAX_LEXICAL_TERMS + 1 }, (_, i) => `"t${i}.ts"`).join(" ");
    expect(errorOf(terms)).toMatch(/too many quoted terms/);
  });

  it("counts negated terms against the same cap", () => {
    const positive = Array.from({ length: SEARCH_QUERY_MAX_LEXICAL_TERMS }, (_, i) => `"t${i}.ts"`).join(" ");
    expect(errorOf(`${positive} -"extra.ts"`)).toMatch(/too many quoted terms/);
  });
});

describe("parseSearchQuery — author qualifier", () => {
  it("defaults to surface-default when author: is absent", () => {
    expect(parsed("anything").authors).toEqual({ kind: "surface-default" });
  });

  it("parses a single email, lowercased", () => {
    const q = parsed("author:Jane@Example.COM");
    expect(q.authors).toEqual({ kind: "listed", values: ["jane@example.com"] });
  });

  it("parses author:me (case-insensitive)", () => {
    expect(parsed("author:ME").authors).toEqual({ kind: "listed", values: [AUTHOR_ME] });
  });

  it("parses author:anyone as the no-filter selector", () => {
    expect(parsed("author:anyone").authors).toEqual({ kind: "anyone" });
  });

  it("parses an OR group of authors including me", () => {
    const q = parsed("author:(me OR jane@example.com)");
    expect(q.authors).toEqual({ kind: "listed", values: [AUTHOR_ME, "jane@example.com"] });
  });

  it("parses a quoted author value", () => {
    const q = parsed('author:"jane@example.com"');
    expect(q.authors).toEqual({ kind: "listed", values: ["jane@example.com"] });
  });

  it("negates authors without disabling the surface default", () => {
    const q = parsed("-author:jane@example.com search terms");
    expect(q.authors).toEqual({ kind: "surface-default" });
    expect(q.authorsNegated).toEqual(["jane@example.com"]);
  });

  it("combines positive and negative author qualifiers", () => {
    const q = parsed("author:(a@x.com OR b@x.com) -author:b@x.com");
    expect(q.authors).toEqual({ kind: "listed", values: ["a@x.com", "b@x.com"] });
    expect(q.authorsNegated).toEqual(["b@x.com"]);
  });

  it("rejects author:anyone combined with other values", () => {
    expect(errorOf("author:(anyone OR jane@x.com)")).toMatch(/cannot combine/);
  });

  it("rejects -author:anyone", () => {
    expect(errorOf("-author:anyone")).toMatch(/not meaningful/);
  });

  it("rejects a non-email non-reserved author value", () => {
    expect(errorOf("author:jane")).toMatch(/email address, me, or anyone/);
  });

  it("rejects author: with no value", () => {
    expect(errorOf("author: something")).toMatch(/needs a value/);
  });

  it("caps author values", () => {
    const emails = Array.from({ length: SEARCH_QUERY_MAX_AUTHOR_VALUES + 1 }, (_, i) => `a${i}@x.com`).join(" OR ");
    expect(errorOf(`author:(${emails})`)).toMatch(/too many author values/);
  });
});

describe("parseSearchQuery — date qualifiers", () => {
  it("parses after: and before: dates", () => {
    const q = parsed("after:2026-06-01 before:2026-06-14");
    expect(q.after).toBe("2026-06-01");
    expect(q.before).toBe("2026-06-14");
  });

  it("parses full ISO datetimes", () => {
    const q = parsed("after:2026-06-01T12:30:00Z");
    expect(q.after).toBe("2026-06-01T12:30:00Z");
  });

  it("is case-insensitive on the qualifier name", () => {
    expect(parsed("AFTER:2026-06-01").after).toBe("2026-06-01");
  });

  it("rejects non-ISO dates", () => {
    expect(errorOf("after:06/01/2026")).toMatch(/ISO date/);
    expect(errorOf("after:yesterday")).toMatch(/ISO date/);
  });

  it("rejects impossible calendar dates", () => {
    expect(errorOf("after:2026-13-45")).toMatch(/ISO date/);
  });

  it("rejects duplicate bounds", () => {
    expect(errorOf("after:2026-01-01 after:2026-02-01")).toMatch(/duplicate after/);
    expect(errorOf("before:2026-01-01 before:2026-02-01")).toMatch(/duplicate before/);
  });

  it("rejects negated date qualifiers with guidance", () => {
    expect(errorOf("-after:2026-01-01")).toMatch(/opposite bound/);
  });

  it("rejects a date group", () => {
    expect(errorOf("after:(2026-01-01 OR 2026-02-01)")).toMatch(/single date/);
  });
});

describe("parseSearchQuery — created-after: and changed-after: (S8b-C3)", () => {
  it("parses a date and a full ISO datetime for each", () => {
    const q = parsed("created-after:2026-10-01 changed-after:2026-10-20T08:15:00Z");
    expect(q.createdAfter).toBe("2026-10-01");
    expect(q.changedAfter).toBe("2026-10-20T08:15:00Z");
    expect(q.semanticText).toBe("");
  });

  it("is case-insensitive on the qualifier name and composes with the others", () => {
    const q = parsed("CHANGED-AFTER:2026-10-01 is:draft author:me cache strategy");
    expect(q.changedAfter).toBe("2026-10-01");
    expect(q.isDraft).toBe(true);
    expect(q.semanticText).toBe("cache strategy");
  });

  it("leaves both unset when absent, and keeps after: the judgment-date bound", () => {
    const q = parsed("after:2026-10-01");
    expect(q.after).toBe("2026-10-01");
    expect(q.createdAfter).toBeUndefined();
    expect(q.changedAfter).toBeUndefined();
  });

  it("rejects a malformed value naming the form", () => {
    expect(errorOf("created-after:yesterday")).toMatch(/created-after: takes an ISO date/);
    expect(errorOf("changed-after:2026-13-45")).toMatch(/changed-after: takes an ISO date/);
    expect(errorOf("changed-after:")).toMatch(/changed-after:/);
  });

  it("rejects a second value, even the same one", () => {
    expect(errorOf("created-after:2026-10-01 created-after:2026-10-02")).toMatch(/duplicate created-after:/);
    expect(errorOf("changed-after:2026-10-01 changed-after:2026-10-01")).toMatch(/duplicate changed-after:/);
  });

  it("rejects a group and a negation", () => {
    expect(errorOf("changed-after:(2026-10-01 OR 2026-10-02)")).toMatch(/single date/);
    expect(errorOf("-changed-after:2026-10-01")).toMatch(/-changed-after: is not supported/);
    expect(errorOf("-created-after:2026-10-01")).toMatch(/-created-after: is not supported/);
  });

  it("a parenthetical holding the qualifier keeps the strict group reading, as (author:me) does", () => {
    expect(errorOf("sweep (changed-after:2026-10-01)")).toMatch(/OR groups apply to lexical terms/);
  });
});

describe("parseSearchQuery — unknown qualifiers (loud rejection)", () => {
  it("rejects unknown qualifier-shaped tokens naming the valid set", () => {
    const e = errorOf("athor:jane@x.com");
    expect(e).toMatch(/unknown qualifier "athor:"/);
    expect(e).toMatch(/author:, after:, before:, created-after:, changed-after:, is:draft, is:expired, intent: \(an int_… id\), impact: and uncertainty:/);
  });

  it("suggests quoting for colon-bearing text", () => {
    expect(errorOf("recipeID:xyz")).toMatch(/quotes/);
  });
});

describe("parseSearchQuery — combined and adversarial", () => {
  it("parses the PR-review shape end to end", () => {
    const q = parsed(
      'read model ("narrative-evaluation-result.ts" OR "get-activity-filters.server.ts") author:anyone after:2026-06-01 before:2026-06-14',
    );
    expect(q.semanticText).toBe("read model");
    expect(q.lexicalGroups).toEqual([["narrative-evaluation-result.ts", "get-activity-filters.server.ts"]]);
    expect(q.authors).toEqual({ kind: "anyone" });
    expect(q.after).toBe("2026-06-01");
    expect(q.before).toBe("2026-06-14");
  });

  it("passes SQL-injection-shaped input through as inert strings", () => {
    const q = parsed(`"'; DROP TABLE claimnet.traces; --"`);
    expect(q.lexicalGroups).toEqual([["'; DROP TABLE claimnet.traces; --"]]);
  });

  it("passes LIKE metacharacters through raw (escaping is the SQL layer's job)", () => {
    const q = parsed('"100%_done\\"');
    expect(q.lexicalGroups).toEqual([["100%_done\\"]]);
  });

  it("keeps injection-shaped bare text semantic and inert", () => {
    const q = parsed("1 UNION SELECT * FROM users");
    expect(q.semanticText).toBe("1 UNION SELECT * FROM users");
  });

  it("trims whitespace inside quoted terms", () => {
    expect(parsed('"  padded.ts  "').lexicalGroups).toEqual([["padded.ts"]]);
  });
});

// ── Drafts-and-triage slice 3: is:draft, impact:, uncertainty: ─────────────
// Rubric S3-G1 to S3-G6 (docs/planning/drafts-and-triage-build.md).

describe("parseSearchQuery — is:draft (S3-G1, S3-G2)", () => {
  it("is:draft selects the viewer's unresolved drafts, with no semantic text", () => {
    const q = parsed("is:draft");
    expect(q.isDraft).toBe(true);
    expect(q.semanticText).toBe("");
    expect(q.authors).toEqual({ kind: "surface-default" });
  });

  it("the qualifier name and value are case-insensitive, like the others", () => {
    expect(parsed("IS:draft").isDraft).toBe(true);
    expect(parsed("Is:DRAFT").isDraft).toBe(true);
    expect(parsed('is:"draft"').isDraft).toBe(true);
  });

  it("-is:draft leaves the viewer's unresolved drafts out", () => {
    expect(parsed("-is:draft cache").isDraft).toBe(false);
    expect(parsed("-is:draft cache").semanticText).toBe("cache");
  });

  it("a query without the qualifier carries no draft selection", () => {
    expect(parsed("cache strategy").isDraft).toBeUndefined();
  });

  it("repeating is:draft is harmless; is:draft with -is:draft is a contradiction", () => {
    expect(parsed("is:draft is:draft").isDraft).toBe(true);
    expect(errorOf("is:draft -is:draft")).toMatch(/contradict/);
  });

  it("any other value, a group, and a bare is: are errors that name the valid value", () => {
    for (const bad of ["is:drafts", "is:published", "is:open"]) {
      const e = errorOf(bad);
      expect(e, bad).toMatch(/is:draft/);
    }
    expect(errorOf("is:(draft OR published)")).toMatch(/is:draft/);
    expect(errorOf("is:")).toMatch(/is:draft/);
    expect(errorOf("cache is:")).toMatch(/is:draft/);
  });

  it("words that merely start with is stay semantic text", () => {
    expect(parsed("issue isolation -isolate").semanticText).toBe("issue isolation -isolate");
  });
});

// Slice 10 (S10-X3): is:expired, the drafts whose task went quiet.
describe("parseSearchQuery — is:expired (S10-X3)", () => {
  it("selects the viewer's expired drafts, case-insensitively, with or without text", () => {
    expect(parsed("is:expired").isExpired).toBe(true);
    expect(parsed("IS:Expired").isExpired).toBe(true);
    expect(parsed("is:expired cache").semanticText).toBe("cache");
    expect(parsed("is:expired impact:high").impact).toEqual({ equals: "high", excluded: [] });
  });

  it("is:draft is:expired reads as is:expired, in either order", () => {
    for (const q of ["is:draft is:expired", "is:expired is:draft"]) {
      const r = parsed(q);
      expect(r.isExpired, q).toBe(true);
      expect(r.isDraft, q).toBeUndefined();
    }
  });

  it("-is:expired, and is:expired with -is:draft, are refused", () => {
    expect(errorOf("-is:expired")).toMatch(/no effect/);
    expect(errorOf("is:expired -is:draft")).toMatch(/contradict/);
    expect(errorOf("-is:draft is:expired")).toMatch(/contradict/);
  });

  it("an unknown is: value names both values", () => {
    const e = errorOf("is:stale");
    expect(e).toMatch(/is:draft/);
    expect(e).toMatch(/is:expired/);
  });

  it("is:draft alone carries no isExpired", () => {
    expect(parsed("is:draft").isExpired).toBeUndefined();
  });
});

describe("parseSearchQuery — impact: and uncertainty: (S3-G4)", () => {
  it("each takes low, medium, or high, case-insensitively", () => {
    expect(parsed("impact:high").impact).toEqual({ equals: "high", excluded: [] });
    expect(parsed("uncertainty:LOW").uncertainty).toEqual({ equals: "low", excluded: [] });
    expect(parsed("IMPACT:Medium").impact).toEqual({ equals: "medium", excluded: [] });
  });

  it("negation excludes a value (unrated rows are kept by the SQL layer); repeats dedupe", () => {
    expect(parsed("-impact:low -impact:medium -impact:low").impact).toEqual({ excluded: ["low", "medium"] });
    expect(parsed("impact:high -uncertainty:low")).toMatchObject({
      impact: { equals: "high", excluded: [] },
      uncertainty: { excluded: ["low"] },
    });
  });

  it("an unknown value is an error naming the vocabulary (a query is not a deposit)", () => {
    for (const bad of ["impact:urgent", "uncertainty:7", "impact:none", "impact:big"]) {
      expect(errorOf(bad), bad).toMatch(/low, medium, or high/);
    }
  });

  it("a repeated positive rating qualifier is an error naming the vocabulary", () => {
    expect(errorOf("impact:high impact:low")).toMatch(/duplicate impact:.*low, medium, or high/);
    expect(errorOf("uncertainty:high uncertainty:high")).toMatch(/duplicate uncertainty:/);
  });

  it("a group or a bare qualifier is an error", () => {
    expect(errorOf("impact:(high OR low)")).toMatch(/low, medium, or high/);
    expect(errorOf("impact:")).toMatch(/impact:/);
  });

  it("queries without rating qualifiers carry none", () => {
    const q = parsed("cache");
    expect(q.impact).toBeUndefined();
    expect(q.uncertainty).toBeUndefined();
  });
});

describe("parseSearchQuery — the new qualifiers compose (S3-G6) and the error lists them (S3-Z2)", () => {
  it('is:draft impact:high after:2026-09-01 "cache" applies all four', () => {
    const q = parsed('is:draft impact:high after:2026-09-01 "cache"');
    expect(q.isDraft).toBe(true);
    expect(q.impact).toEqual({ equals: "high", excluded: [] });
    expect(q.after).toBe("2026-09-01");
    expect(q.lexicalGroups).toEqual([["cache"]]);
    expect(q.semanticText).toBe("");
  });

  it("semantic text rides along with the qualifiers", () => {
    const q = parsed("cache strategy is:draft uncertainty:high author:me");
    expect(q.semanticText).toBe("cache strategy");
    expect(q.authors).toEqual({ kind: "listed", values: [AUTHOR_ME] });
  });

  it("the unknown-qualifier error lists every valid qualifier and value", () => {
    const e = errorOf("imapct:high");
    for (const part of ["author:", "after:", "before:", "is:draft", "intent:", "int_", "impact:", "uncertainty:", "low", "medium", "high"]) {
      expect(e, part).toContain(part);
    }
  });
});

describe("parseSearchQuery — adversarial values for the new qualifiers (S3-G5)", () => {
  // Qualifier structure selects fixed predicate shapes; the only values that
  // reach the SQL layer are members of a closed vocabulary. Anything else
  // fails loudly rather than parsing into a bound string.
  const hostile = [
    "is:draft';DROP TABLE claimnet.traces;--",
    'is:"draft\' OR 1=1 --"',
    "impact:high'--",
    "impact:%",
    "impact:_",
    'uncertainty:"high OR 1=1"',
    "uncertainty:(high OR 1=1)",
    "impact:high%00",
    "is:draft\\",
    'is:"',
  ];
  for (const input of hostile) {
    it(`rejects ${JSON.stringify(input)} loudly`, () => {
      expect(parseSearchQuery(input).ok).toBe(false);
    });
  }

  it("the parsed values are only ever vocabulary members", () => {
    const q = parsed("is:draft impact:HIGH -uncertainty:Low");
    expect(q.isDraft).toBe(true);
    expect(q.impact?.equals).toBe("high");
    expect(q.uncertainty?.excluded).toEqual(["low"]);
  });
});

// ── Drafts-and-triage slice 6a: intent: ─────────────────────────────────────

describe("parseSearchQuery — intent: (S6a-Q1)", () => {
  const ID = "int_AbCdEfGhIjKlMnOpQrStUv01";

  it("intent:<id> selects by the declared intent, keeping the id's case", () => {
    const q = parsed(`intent:${ID}`);
    expect(q.intent).toBe(ID);
    expect(q.semanticText).toBe("");
    expect(parsed(`INTENT:${ID} cache`).intent).toBe(ID);
    expect(parsed(`INTENT:${ID} cache`).semanticText).toBe("cache");
  });

  it("a quoted id is the same id", () => {
    expect(parsed(`intent:"${ID}"`).intent).toBe(ID);
  });

  it("no intent: leaves the field absent", () => {
    expect("intent" in parsed("cache strategy")).toBe(false);
  });

  it("repeating the same id is harmless; two different ids are refused", () => {
    expect(parsed(`intent:${ID} intent:${ID}`).intent).toBe(ID);
    expect(errorOf(`intent:${ID} intent:int_000000000000000000000000`)).toMatch(/one intent:/);
  });

  it("rejects a malformed id, naming the form", () => {
    for (const bad of [
      "intent:int_short",
      "intent:INT_AbCdEfGhIjKlMnOpQrStUv01",
      "intent:int_AbCdEfGhIjKlMnOpQrStUv012",
      "intent:int_AbCdEfGhIjKlMnOpQrStU-01",
      "intent:As-a-developer",
      'intent:"As a developer working on X"',
    ]) {
      expect(errorOf(bad), bad).toMatch(/intent: takes an intent id \(int_ and 24 letters or digits\)/);
    }
    expect(errorOf("intent:")).toMatch(/intent: needs a value/);
  });

  it("refuses a group and a negation", () => {
    expect(errorOf(`intent:(${ID} OR int_000000000000000000000000)`)).toMatch(/one intent:/);
    expect(errorOf(`-intent:${ID}`)).toMatch(/-intent: is not supported/);
  });

  it("composes with every other qualifier (S6a-Q3)", () => {
    const q = parsed(`is:draft intent:${ID} impact:high -uncertainty:low author:me after:2026-10-01 "cache" strategy`);
    expect(q.intent).toBe(ID);
    expect(q.isDraft).toBe(true);
    expect(q.impact?.equals).toBe("high");
    expect(q.uncertainty?.excluded).toEqual(["low"]);
    expect(q.authors).toEqual({ kind: "listed", values: [AUTHOR_ME] });
    expect(q.after).toBe("2026-10-01");
    expect(q.lexicalGroups).toEqual([["cache"]]);
    expect(q.semanticText).toBe("strategy");
  });

  it("hostile values never parse", () => {
    for (const input of [
      `intent:${ID}';DROP TABLE claimnet.traces;--`,
      `intent:"${ID}' OR 1=1 --"`,
      "intent:int_%%%%%%%%%%%%%%%%%%%%%%%%",
      `intent:${ID}%00`,
    ]) {
      expect(parseSearchQuery(input).ok, input).toBe(false);
    }
  });
});
