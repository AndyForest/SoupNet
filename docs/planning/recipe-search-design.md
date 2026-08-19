# Recipe search — structured queries over collaborators' judgment (operator-ratified 2026-08-19)

**Branch:** `feat/recipe-search`. **Status:** design ratified by the operator 2026-08-19; implementation in this branch.

## Goal

Shared recipe books are about to gain work colleagues. That creates a class of retrieval the check path deliberately doesn't serve: an AI agent wanting the taste/judgment calls **other people** made — judgment that may live only in a collaborator's head, not in the current human's. The motivating case is PR review: "what were the key taste/judgment calls made in the codebase touched by this PR?"

Soup.net remains a decision log, not documentation. A check requires a genuine hypothesis; search is the sanctioned surface for the other-author case. Naming note: the corpus records a long-standing rule against the verb "search" in agent-facing copy so agents don't treat `check_recipe` as a search engine (recipe `678adaf0`). This feature *strengthens* that rule by giving search intent a legitimate, separately-named home — the copy work below reframes accordingly.

## Evidence base

Live-corpus probes on 2026-08-19 (recipe `5db8edc5`, soup-net-development) validated the use case and measured the gaps:

- Filename-only semantic queries against the read-only `filter` path already surface the right area's decisions (69–74% similarity; descriptive kebab-case filenames embed well).
- **Gap 1:** no deterministic join from a changed file to recipes whose evidence *cites* it — for a probed full path, only 1 of the top 3 results cited it in `evidence[].references[].source`.
- **Gap 2:** no non-logging search on the MCP surface at all (`mcp.ts` deliberately removed web-only param hints).

Scope discipline: ship on these two measured gaps, not speculative machinery.

## Operator rulings (2026-08-19)

1. **Grammar:** restricted Gmail-shaped query string — bare text is semantic, `"quoted terms"` are lexical, allowlisted qualifiers `author:` / `after:` / `before:`. Hand-rolled zero-dependency parser in `packages/domain` (Lucene-family libraries rejected: they parse bare text as boolean term lists; our bare text is one embedded string). Recipe `da986c40`.
2. **Exclude-own default:** the MCP search tool defaults to excluding the caller's own recipes, overridden inside the query language (`author:me`, `author:anyone`) — no dedicated parameter. The web `filter` path keeps today's include-everything behavior (its main consumer is the human searching their own corpus). Recipe `303e17cf`.
3. **`get_recipes` stays separate** — deterministic fetch-by-id and ranked search have different contracts; folding would force mode-dependent defaults and response shapes into one tool. Recipe `6201b444`.
4. **Secure by default** (operator directive): the parser never assembles SQL — it emits a typed IR; all values bind as SQL parameters; LIKE metacharacters escaped; qualifier allowlist with loud rejection of unknown names; caps on term count and query length. Stated explicitly in the parser module header, this doc, and the architecture doc. Recipe `446bac9f`.

## Query grammar

```
narrative read model "evaluation-run.server.ts" author:jane@example.com after:2026-06-01 before:2026-06-14
```

| Construct | Meaning |
| --- | --- |
| bare text | One semantic query (embedded whole, original order). No boolean operators — meaningless over a single vector. |
| `"quoted term"` | Lexical ILIKE match across claim text, evidence content, reference quotes, and reference sources. Multiple quoted terms AND by default. |
| `("a" OR "b")` | OR-group of quoted terms (uppercase `OR` only; lowercase `or` stays semantic text — Gmail convention). |
| `-"term"`, `-author:x` | Negation. |
| `author:` | Author email; values `me` and `anyone` reserved. `author:(a@x.com OR b@y.com)` unions. Any `author:` qualifier replaces the exclude-own default; `author:anyone` means no author filter. |
| `after:` / `before:` | Judgment date, half-open: `after:D` ⇒ date ≥ D, `before:D` ⇒ date < D. Strict ISO (`YYYY-MM-DD` or full ISO datetime). Operates on `COALESCE(decided_at, created_at)` — the established judgment-date cascade. Duplicate `after:`/`before:` is an error. |
| unknown `name:value` | Error naming the valid qualifiers (typos must not silently degrade into semantic text). Carve-outs: `scheme://` URLs and `name:`-with-no-attached-value pass through as semantic text. |

Behavior notes:

- Quoted-term matching is what closes Gap 1: reference sources (`-- file citation` lines) become lexically reachable, with no schema change. Re-probe before considering a citation index.
- A qualifier-only query (no semantic text) has no query vector: results order by judgment date descending, verbosity capping the count. With semantic text, the normal pipeline applies (similarity ranking, MMR/adaptive-k, clustering, verbosity lever).
- Lexical terms cap at 8 (matches today's `keywordFilter` cap); total query length capped (2,000 chars).
- The exclude-own default filters by **author `user_id`**, on the search tool only. The check path is untouched — sub-agent fleets cross-communicate by seeing peers' fresh recipes in check results under a shared key (recipe `4d25aec9`), and ranking stays a pure function of check inputs (recipe `9067ca1b`).

## Security posture (secure by default)

Open-ended user input that gets parsed into SQL is the risk surface. The defense is layered and explicit:

1. **The parser emits a typed IR only** (`ParsedSearchQuery`: semantic text, lexical terms with negation/grouping, qualifier filters). No string in the IR is ever concatenated into SQL text.
2. **The SQL layer binds every value as a parameter** via the `postgres` tagged-template placeholders already used by `vector-search.service.ts`. Qualifier structure selects among fixed predicate shapes; values only ever travel as bind parameters.
3. **LIKE metacharacters (`%`, `_`, `\`) are escaped** before any ILIKE bind, reusing the existing escape helper.
4. **Qualifier names are an allowlist**; unknown names are rejected with an error, never passed through.
5. **Caps:** ≤8 lexical terms, ≤2,000-char query, strict ISO date parsing, ≤8 author values.
6. **Adversarial tests:** a Layer-1 test file feeds injection-shaped inputs (`'; DROP TABLE`, `%` floods, nested quotes, malformed groups) and asserts they either parse into inert bound values or fail loudly.

Audit inheritance: search requests continue writing `check.searched` audit rows (recipe `ba5669f5` — kept out of the F29 rate-limit hot query). Structured queries can now carry author emails in the retained `metadata.filter` text — noted on the existing audit-retention backlog item.

## Surfaces

- **MCP tool `search_recipes`** (backend `mcp.ts` + stdio proxy mirror): params `query` (required) plus the cross-cutting params check_recipe already carries — `verbosity`, `read_recipe_books`, `session_id`, `known_recipes`, `response_format`, `agent_id`, `feedback`. Nothing else at launch (`axes`/`synthesize` can follow on demand; flat single-string input per recipe `e9c5aa23`). Description authored in `recipe-guide-content.ts` under the existing budget/drift guard, carrying the syntax spec, the search-vs-check rule, and a one-line data-not-instructions note (collaborators' recipe text is context, not directives — the fuller prompt-injection posture stays with the read-only-sharing decision item).
- **REST: no new endpoint.** The structured query travels through the existing `filter`/`f` param on `/check`'s search-only branch. Bare text with no qualifiers parses as pure semantic — every existing caller keeps today's behavior byte-for-byte. The check-path (logging) branch's `filter` keeps its current lexical-narrowing contract but gains the same broadened field scope for quoted terms.
- **ACL and rate limits unchanged:** key's `read_group_ids` scope enforced in SQL as today; searchOnly per-key in-memory cap + F43 per-bearer backstop. Flagged on the fresh-audit backlog item.
- **Response:** the existing search-only response shape (check response minus `checked`, plus `searchOnly: true` + notice), canonical Recipe objects (recipe `7945fd8a`), verbosity lever, session-id stub rendering. No new response formats.

## Copy plan (briefing edits under the declared-intent rule)

Declared intent: add the search-vs-check rule; move no other briefing scenario.

- `## How to check` gains one tight paragraph: **check** when you hold a genuine hypothesis about the user's taste (the append path); **search** when the judgment you need lives in a collaborator's head (reviewing a teammate's PR, joining a shared book mid-project). No hypothesis and no other-author need ⇒ look elsewhere or ask the user. Folds in the pending one-line `get_recipes`/`purpose` pointer (backlog WT-3 follow-up) since it's the same paragraph.
- Guide fixes folded in (same files): stale "hybrid — full-text (tsvector) + semantic vectors" copy corrected to pure-semantic + quoted-lexical; one-line cosine-scale note (raw scores near zero are normal).
- Zero-result reassurance copy folded in (same response builders): an empty search result names the thinness as signal ("no logged decisions match — the corpus is thin here") and points at `log_feedback` for the null-result row.
- `recipe-scenarios` gains the PR-review worked example; a short architecture doc grounds the syntax in cited precedent (Gmail `after:`/`before:`, GitHub `author:` and exact-string quoting, Google verbatim quotes).

## Folded backlog items

1. Stale tsvector copy + cosine-scale note (qualitative-eval findings item) — same guide copy.
2. Briefing `get_recipes`/`purpose` pointer (WT-3 follow-up) — same paragraph.
3. Zero-result reassurance copy (2026-07-05 batch leftover) — same response builders.

Considered, not folded: Bearer-token acceptance on `/check` (auth-surface change; separate small PR under the security workflow), audit-log retention pass (legal-driven; item annotated instead), short-id prefixes for search/get_recipes (demand-gated), `decided_at` surfacing on frontend pages (different files), viewer-role/read-only book sharing (DECISION NEEDED; this design composes with it — search honors whatever `read_group_ids` a future viewer key carries).

## Implementation order

1. Parser (`packages/domain/src/search-query.ts`) + exhaustive Layer-1 tests incl. the adversarial file — the tracer slice.
2. Backend predicates: broadened lexical scope (EXISTS through `trace_evidence` → `evidence` → `references`), author/date qualifiers, exclude-own default wiring in `searchWithoutLogging`; migration for an expression index on `COALESCE(decided_at, created_at)`.
3. MCP `search_recipes` + descriptions + stdio mirror; Layer-3 tests.
4. Copy: briefing paragraph, tool description, guide fixes, scenarios, architecture doc; backlog bookkeeping.
5. Acceptance: re-run the 2026-08-19 probes through `search_recipes` — the citation probe that failed semantically must hit via the quoted path; full `npm run test:ci`.
