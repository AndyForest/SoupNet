/**
 * Structured search-query grammar for recipe search (operator-ratified 2026-08-19).
 *
 * A restricted Gmail-shaped grammar over one query string: bare text is a
 * single semantic query (embedded whole — no boolean operators over a vector),
 * double-quoted terms are lexical substring matches, and a small allowlisted
 * qualifier vocabulary (`author:`, `after:`, `before:`) carries the structured
 * filters. Design + syntax precedent citations:
 * docs/planning/recipe-search-design.md.
 *
 * SECURITY — secure by default (operator directive, recipe 446bac9f):
 * this parser is the boundary where open-ended agent input becomes structure,
 * so it never produces SQL — only the typed `ParsedSearchQuery` IR below.
 * The SQL layer must treat every IR string as a bind parameter (postgres
 * tagged-template placeholders) and escape LIKE metacharacters before ILIKE
 * use; qualifier structure may select among fixed predicate shapes only.
 * Defenses at this layer: qualifier names are an allowlist (unknown names are
 * a loud parse error, never silent pass-through), dates parse strictly as ISO,
 * and term/value/length caps below bound every list an attacker can grow.
 * Adversarial inputs are pinned in search-query.test.ts.
 */

export const SEARCH_QUERY_MAX_LENGTH = 2000;
export const SEARCH_QUERY_MAX_LEXICAL_TERMS = 8;
export const SEARCH_QUERY_MAX_AUTHOR_VALUES = 8;

export const SEARCH_QUALIFIERS = ["author", "after", "before"] as const;
export type SearchQualifier = (typeof SEARCH_QUALIFIERS)[number];

/** Reserved author values (case-insensitive on the wire, canonical lowercase here). */
export const AUTHOR_ME = "me";
export const AUTHOR_ANYONE = "anyone";

/**
 * Who the search should return recipes by. `surface-default` means no
 * positive `author:` qualifier was written — the consuming surface applies
 * its own default (the MCP search tool excludes the caller; the web filter
 * path applies no author filter). Any positive `author:` replaces that
 * default; negated `-author:` values only ever add exclusions and do NOT
 * disable the surface default.
 */
export type AuthorSelector =
  | { kind: "surface-default" }
  | { kind: "anyone" }
  | { kind: "listed"; values: string[] };

export interface ParsedSearchQuery {
  /** Bare tokens joined in original order — the semantic query. Empty when the query is qualifier/lexical-only (no vector ranking; consumers order by judgment date). */
  semanticText: string;
  /** Lexical term groups: groups AND together, terms inside a group OR together. Raw substrings — LIKE escaping is the SQL layer's job. */
  lexicalGroups: string[][];
  /** Lexical terms that must NOT match (each excluded independently). */
  lexicalNegated: string[];
  /** Positive author selection (see AuthorSelector). Values are lowercase emails or the literal "me". */
  authors: AuthorSelector;
  /** Authors to exclude — lowercase emails or the literal "me". */
  authorsNegated: string[];
  /** Judgment-date lower bound, inclusive (`after:D` ⇒ date ≥ D). ISO string as written. */
  after?: string | undefined;
  /** Judgment-date upper bound, exclusive (`before:D` ⇒ date < D). ISO string as written. */
  before?: string | undefined;
}

export type ParseSearchQueryResult =
  | { ok: true; query: ParsedSearchQuery }
  | { ok: false; error: string };

const QUALIFIER_HELP = "valid qualifiers are author:, after:, before:";

/** `YYYY-MM-DD` or a full ISO datetime; Date.parse re-checks real dates. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Qualifier-attempt shape: 2+ chars so Windows drive letters (`C:\...`) stay
 *  semantic text; `//` after the colon exempts URLs (`https://...`). */
const QUALIFIER_ATTEMPT_RE = /^([A-Za-z][A-Za-z0-9_-]+):(?!\/\/)(.+)$/s;

interface Scanner {
  input: string;
  pos: number;
}

function skipWhitespace(s: Scanner): void {
  while (s.pos < s.input.length && /\s/.test(s.input[s.pos]!)) s.pos++;
}

function atEnd(s: Scanner): boolean {
  return s.pos >= s.input.length;
}

/** Read a double-quoted term; the opening quote is at s.pos. No escape
 *  sequences — a quote always ends the term (documented in the guide). */
function readQuoted(s: Scanner): { ok: true; term: string } | { ok: false; error: string } {
  s.pos++; // opening quote
  const start = s.pos;
  const end = s.input.indexOf('"', s.pos);
  if (end === -1) return { ok: false, error: 'unterminated quote — every " needs a closing "' };
  s.pos = end + 1;
  const term = s.input.slice(start, end).trim();
  if (term.length === 0) return { ok: false, error: "empty quoted term" };
  return { ok: true, term };
}

/** Read a bare token (no whitespace, stops before `)` inside groups). */
function readBareToken(s: Scanner): string {
  const start = s.pos;
  while (s.pos < s.input.length && !/[\s)]/.test(s.input[s.pos]!)) s.pos++;
  return s.input.slice(start, s.pos);
}

/** Peek whether the next non-space run is the OR keyword (uppercase only —
 *  lowercase "or" stays semantic prose, per the Gmail convention). */
function consumeOrKeyword(s: Scanner): boolean {
  const saved = s.pos;
  skipWhitespace(s);
  if (s.input.startsWith("OR", s.pos) && (s.pos + 2 >= s.input.length || /[\s("]/.test(s.input[s.pos + 2]!))) {
    s.pos += 2;
    return true;
  }
  s.pos = saved;
  return false;
}

type GroupItem = { quoted: boolean; text: string };

/** Read a parenthesized OR-group; the `(` is at s.pos. Items are quoted terms
 *  or bare tokens, separated by OR. Mixing is resolved by the caller (author
 *  values may be bare; lexical groups must be quoted). */
function readGroup(s: Scanner): { ok: true; items: GroupItem[] } | { ok: false; error: string } {
  s.pos++; // opening paren
  const items: GroupItem[] = [];
  for (;;) {
    skipWhitespace(s);
    if (atEnd(s)) return { ok: false, error: "unterminated group — every ( needs a closing )" };
    const ch = s.input[s.pos]!;
    if (ch === ")") {
      s.pos++;
      if (items.length === 0) return { ok: false, error: "empty group" };
      return { ok: true, items };
    }
    if (items.length > 0) {
      // Between items only OR is legal.
      if (!consumeOrKeyword(s)) {
        return { ok: false, error: "group items must be separated by OR, e.g. (\"a\" OR \"b\")" };
      }
      skipWhitespace(s);
    }
    const itemCh = s.input[s.pos];
    if (itemCh === '"') {
      const q = readQuoted(s);
      if (!q.ok) return q;
      items.push({ quoted: true, text: q.term });
    } else if (itemCh === ")" || itemCh === undefined) {
      return { ok: false, error: "group ends after OR — add another term or remove the OR" };
    } else {
      const bare = readBareToken(s);
      if (bare.length === 0) return { ok: false, error: "empty group item" };
      items.push({ quoted: false, text: bare });
    }
  }
}

function parseAuthorValue(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim().toLowerCase();
  if (v === AUTHOR_ME || v === AUTHOR_ANYONE) return { ok: true, value: v };
  if (v.includes("@") && v.length >= 3) return { ok: true, value: v };
  return { ok: false, error: `author: takes an email address, me, or anyone — got "${raw}"` };
}

function parseDateValue(qualifier: string, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim().replace(/^"|"$/g, "");
  if (!ISO_DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    return { ok: false, error: `${qualifier}: takes an ISO date (YYYY-MM-DD or full ISO datetime) — got "${raw}"` };
  }
  return { ok: true, value: v };
}

/**
 * Parse a structured search query into the typed IR. Never throws; every
 * failure is a { ok: false } with an agent-comprehensible message (loud
 * rejection is part of the security posture — typos must not silently
 * degrade into semantic text).
 */
export function parseSearchQuery(input: string): ParseSearchQueryResult {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { ok: false, error: "query is required" };
  }
  if (input.length > SEARCH_QUERY_MAX_LENGTH) {
    return { ok: false, error: `query exceeds ${SEARCH_QUERY_MAX_LENGTH} characters` };
  }

  const s: Scanner = { input, pos: 0 };
  const semanticParts: string[] = [];
  const lexicalGroups: string[][] = [];
  const lexicalNegated: string[] = [];
  const authorValues: string[] = [];
  const authorsNegated: string[] = [];
  let sawAuthorQualifier = false;
  let after: string | undefined;
  let before: string | undefined;

  const addLexicalGroup = (terms: string[]): string | null => {
    const count = lexicalGroups.flat().length + lexicalNegated.length + terms.length;
    if (count > SEARCH_QUERY_MAX_LEXICAL_TERMS) {
      return `too many quoted terms — the limit is ${SEARCH_QUERY_MAX_LEXICAL_TERMS}`;
    }
    lexicalGroups.push(terms);
    return null;
  };

  for (;;) {
    skipWhitespace(s);
    if (atEnd(s)) break;

    let negated = false;
    if (s.input[s.pos] === "-" && s.pos + 1 < s.input.length) {
      const next = s.input[s.pos + 1]!;
      const rest = s.input.slice(s.pos + 1);
      // A leading '-' negates only a quoted term or a known qualifier; any
      // other hyphen-leading token is ordinary semantic text (kebab-case etc.).
      if (next === '"' || SEARCH_QUALIFIERS.some((q) => rest.toLowerCase().startsWith(`${q}:`))) {
        negated = true;
        s.pos++;
      }
    }

    const ch = s.input[s.pos]!;

    if (ch === '"') {
      const q = readQuoted(s);
      if (!q.ok) return q;
      if (negated) {
        if (lexicalGroups.flat().length + lexicalNegated.length + 1 > SEARCH_QUERY_MAX_LEXICAL_TERMS) {
          return { ok: false, error: `too many quoted terms — the limit is ${SEARCH_QUERY_MAX_LEXICAL_TERMS}` };
        }
        lexicalNegated.push(q.term);
        continue;
      }
      // Top-level OR chain of quoted terms: "a" OR "b" OR "c".
      const orTerms = [q.term];
      while (consumeOrKeyword(s)) {
        skipWhitespace(s);
        if (s.input[s.pos] !== '"') {
          return { ok: false, error: 'OR joins quoted terms — quote the next term, e.g. "a" OR "b"' };
        }
        const nextQ = readQuoted(s);
        if (!nextQ.ok) return nextQ;
        orTerms.push(nextQ.term);
      }
      const err = addLexicalGroup(orTerms);
      if (err) return { ok: false, error: err };
      continue;
    }

    if (ch === "(") {
      const g = readGroup(s);
      if (!g.ok) return g;
      if (g.items.every((i) => i.quoted)) {
        if (negated) return { ok: false, error: "negation applies to single quoted terms, not groups" };
        const err = addLexicalGroup(g.items.map((i) => i.text));
        if (err) return { ok: false, error: err };
        continue;
      }
      return {
        ok: false,
        error: 'OR groups apply to lexical terms — quote each term: ("a" OR "b"). Bare words search semantically and need no grouping.',
      };
    }

    // Bare token — possibly a qualifier. Three shapes reach here:
    //   author:value      → attached value inside the word
    //   author:           → value opens with " or ( (scanner sits on it), or
    //                       is missing entirely (loud error below)
    //   note: / unknown:  → unknown names: attached value errs loudly,
    //                       trailing bare colon stays prose
    const tokenStart = s.pos;
    const word = readBareTokenAllowingValue(s);
    const attempt = QUALIFIER_ATTEMPT_RE.exec(word);
    const trailingColon = /^([A-Za-z][A-Za-z0-9_-]+):$/.exec(word);
    const qualifierName = (attempt?.[1] ?? trailingColon?.[1])?.toLowerCase();
    if (qualifierName !== undefined && (attempt || (SEARCH_QUALIFIERS as readonly string[]).includes(qualifierName))) {
      const name = qualifierName;
      if ((SEARCH_QUALIFIERS as readonly string[]).includes(name)) {
        const valueResult = readQualifierValue(s, tokenStart, name, word);
        if (!valueResult.ok) return valueResult;
        const { values } = valueResult;
        if (name === "author") {
          if (!negated) sawAuthorQualifier = true;
          for (const raw of values) {
            const parsed = parseAuthorValue(raw);
            if (!parsed.ok) return parsed;
            if (parsed.value === AUTHOR_ANYONE) {
              if (negated) return { ok: false, error: "-author:anyone is not meaningful — remove it or exclude specific authors" };
              if (values.length > 1) return { ok: false, error: "author:anyone cannot combine with other author values" };
              // Marker handled below via sawAuthorQualifier + empty include list.
              authorValues.length = 0;
              authorValues.push(AUTHOR_ANYONE);
            } else {
              (negated ? authorsNegated : authorValues).push(parsed.value);
            }
          }
          const totalAuthors = authorValues.length + authorsNegated.length;
          if (totalAuthors > SEARCH_QUERY_MAX_AUTHOR_VALUES) {
            return { ok: false, error: `too many author values — the limit is ${SEARCH_QUERY_MAX_AUTHOR_VALUES}` };
          }
        } else {
          if (negated) return { ok: false, error: `-${name}: is not supported — use the opposite bound instead` };
          if (values.length !== 1) return { ok: false, error: `${name}: takes a single date` };
          const parsed = parseDateValue(name, values[0]!);
          if (!parsed.ok) return parsed;
          if (name === "after") {
            if (after !== undefined) return { ok: false, error: "duplicate after: — give one lower bound" };
            after = parsed.value;
          } else {
            if (before !== undefined) return { ok: false, error: "duplicate before: — give one upper bound" };
            before = parsed.value;
          }
        }
        continue;
      }
      // Unknown qualifier-shaped token: loud error (never silent semantic
      // fallback) so typos like "athor:" stay visible.
      return {
        ok: false,
        error: `unknown qualifier "${qualifierName}:" — ${QUALIFIER_HELP}. To search for text containing a colon, put it in quotes.`,
      };
    }

    // Plain semantic text. A '-' we consumed above can't reach here; a
    // trailing bare colon ("note:") is prose, not a qualifier.
    if (word.length > 0) semanticParts.push(negated ? `-${word}` : word);
  }

  const anyone = authorValues.includes(AUTHOR_ANYONE);
  const authors: AuthorSelector = anyone
    ? { kind: "anyone" }
    : sawAuthorQualifier
      ? { kind: "listed", values: authorValues }
      : { kind: "surface-default" };

  if (authors.kind === "listed" && authors.values.length === 0) {
    return { ok: false, error: "author: needs a value — an email address, me, or anyone" };
  }

  return {
    ok: true,
    query: {
      semanticText: semanticParts.join(" "),
      lexicalGroups,
      lexicalNegated,
      authors,
      authorsNegated,
      after,
      before,
    },
  };
}

/** Read a bare token, but stop at a colon whose value opens with `"` or `(`
 *  so qualifier values like author:"jane d" and author:(a OR b) parse whole.
 *  The caller re-enters via readQualifierValue for those shapes. */
function readBareTokenAllowingValue(s: Scanner): string {
  const start = s.pos;
  while (s.pos < s.input.length && !/\s/.test(s.input[s.pos]!)) {
    if (s.input[s.pos] === ":" && (s.input[s.pos + 1] === '"' || s.input[s.pos + 1] === "(")) {
      s.pos++; // include the colon; value parsing continues from here
      break;
    }
    s.pos++;
  }
  return s.input.slice(start, s.pos);
}

/** Resolve a qualifier's value list. `word` is what the bare-token scan
 *  captured (e.g. `author:jane@x.com`, or `author:` when the value opens
 *  with a quote or group still sitting at s.pos). */
function readQualifierValue(
  s: Scanner,
  _tokenStart: number,
  name: string,
  word: string,
): { ok: true; values: string[] } | { ok: false; error: string } {
  const attached = word.slice(word.toLowerCase().indexOf(`${name}:`) + name.length + 1);
  if (attached.length > 0) return { ok: true, values: [attached] };
  const ch = s.input[s.pos];
  if (ch === '"') {
    const q = readQuoted(s);
    if (!q.ok) return q;
    return { ok: true, values: [q.term] };
  }
  if (ch === "(") {
    const g = readGroup(s);
    if (!g.ok) return g;
    return { ok: true, values: g.items.map((i) => i.text) };
  }
  return { ok: false, error: `${name}: needs a value — ${QUALIFIER_HELP}` };
}
