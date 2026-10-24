# Slice 6a: expanded text (2026-10-24)

Frozen on 2026-10-24 and never loaded by code. Each chunk is the fullest untrimmed text of agent-facing copy that slice 6a trimmed to fit a budget, so a later ablation can substitute it and measure the trim. Format and purpose: this directory's README (stream C, PR C1). The served text and its bytes are in [../spec-decision-log.md](../spec-decision-log.md), entry "2026-10-24, Drafts-and-triage slice 6a".

## slice6a.searchQuery

Served in: `MCP_PARAM_DESCRIPTIONS.searchQuery` in `packages/domain/src/recipe-guide-content.ts`, the `query` parameter of `search_recipes` on both MCP servers (remote `/mcp` and the stdio server).

```text
Bare text is one semantic phrase. "Quoted terms" match exact substrings of recipe, evidence, and citations (quote filenames for PR review); group with ("a" OR "b"); -"term" excludes. Qualifiers: author: (email, me, anyone), after:/before: (ISO judgment date), is:draft (your unresolved drafts), intent:int_… (your intent's recipes), impact:/uncertainty: (low|medium|high). author:, is:draft, or intent: lifts the exclude-own default. Qualifier-only: newest first.
```

Trimmed away, to fit the 420-character per-description limit (`mcp-tool-descriptions.test.ts`; the full text is 463 characters, the served text 417): "and" before "citations"; "for PR review" after "quote filenames" (the briefing's Search vs check paragraph keeps the PR-review example); "ISO" before "judgment date" (the date error message spells out the format); "unresolved drafts" shortened to "open drafts"; "author:, is:draft, or intent: lifts the exclude-own default" shortened to "author:/is:draft/intent: lift exclude-own". Stream D's 8a reverses the exclude-own default (recipe `885143c2`) and replaces that last clause; once both merge, the clause is D's, and only the first four trims remain this slice's.
