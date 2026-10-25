# Slice 6a: expanded text (2026-10-24)

Frozen on 2026-10-24 and never loaded by code. Each chunk is the fullest untrimmed text of agent-facing copy that slice 6a trimmed to fit a budget, so a later ablation can substitute it and measure the trim. Format and purpose: this directory's README (stream C, PR C1). The served text and its bytes are in [../spec-decision-log.md](../spec-decision-log.md), entry "2026-10-24, Drafts-and-triage slice 6a".

## slice6a.searchQuery

Served in: `MCP_PARAM_DESCRIPTIONS.searchQuery` in `packages/domain/src/recipe-guide-content.ts`, the `query` parameter of `search_recipes` on both MCP servers (remote `/mcp` and the stdio server).

```text
Bare text is one semantic phrase. "Quoted terms" match exact substrings of recipe, evidence, and citations (quote filenames for PR review); group with ("a" OR "b"); -"term" excludes. Qualifiers: author: (email, me, anyone), after:/before: (ISO judgment date), is:draft (your unresolved drafts), intent:int_… (your intent's recipes), impact:/uncertainty: (low|medium|high). -author:me leaves out your own. Qualifier-only: newest first.
```

Trimmed away, to fit the 420-character per-description limit (`mcp-tool-descriptions.test.ts`; the full text is 434 characters, the served text 406): "and" before "citations"; "for PR review" after "quote filenames" (the briefing's Search vs check paragraph keeps the PR-review example); "ISO" before "judgment date" (the date error message spells out the format); "unresolved drafts" shortened to "open drafts". Updated 2026-10-25 on the rebase onto slice 8a: the last clause is now 8a's "-author:me leaves out your own." (recipe `885143c2`), which replaced this slice's "author:/is:draft/intent: lift exclude-own", so the four trims above are all that remain of this slice's.
