# Slice 8b: expanded text (2026-10-26)

Frozen on 2026-10-26 and never loaded by code. Each chunk is the fullest untrimmed text of agent-facing copy that slice 8b items 1 and 2 trimmed to fit a budget, so a later ablation can substitute it and measure the trim. Format and purpose: this directory's README (stream C, PR C1). The served text and its bytes are in [../spec-decision-log.md](../spec-decision-log.md), entry "2026-10-26, Drafts-and-triage slice 8b items 1 and 2".

## slice8b.searchQuery

Served in: `MCP_PARAM_DESCRIPTIONS.searchQuery` in `packages/domain/src/recipe-guide-content.ts`, the `query` parameter of `search_recipes` on both MCP servers (remote `/mcp` and the stdio server).

```text
Bare text is one semantic phrase. "Quoted terms" match exact substrings of recipe, evidence, citations (quote filenames); group with ("a" OR "b"); -"term" excludes. Qualifiers: author: (email, me, anyone), after:/before: (judgment date), created-after:/changed-after: (deposit, any change), is:draft (open drafts), is:expired, intent:int_… (your intent's recipes), impact:/uncertainty: (low|medium|high). -author:me leaves out your own.
```

Trimmed away, to fit the 420-character per-description limit (`mcp-tool-descriptions.test.ts`; the full text is 436 characters, the served text 412): "(your intent's recipes)" after `intent:int_…`. The `intent:` error message says what the id is ("an intent id (int_ and 24 letters or digits)") and that a task story goes in the intent parameter. "Qualifier-only: newest first." is not a trim: the `page` parameter's description replaces it with what a qualifier-only search now returns.

## slice8b.searchPage

Served in: `MCP_PARAM_DESCRIPTIONS.searchPage`, the `page` parameter of `search_recipes` on both MCP servers.

```text
Page of a qualifier-only search, from 1. With no bare text the result is a flat list, 50 per page: newest judgment first, triage order for is:draft, latest change first with changed-after:.
```

Trimmed to fit the 6,600-character total of the shared descriptions (`mcp-tool-descriptions.test.ts`; the full text is 189 characters, the served text 152, and the total 6,593 with it): "Page of a qualifier-only search" became "From 1. No bare text:", and "with changed-after:" became "for changed-after:". The response itself says which page it is and names the next one, so the description carries only the order.
