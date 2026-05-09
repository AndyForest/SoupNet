# ADR-0011: Self-Describing Claims — No Fixed Artifact Types, No Fixed Compatibility Fields

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The previous data model defined a fixed `artifact_kind` enum (`procedure`, `explanation`, `code_snippet`, `diff_or_patch`, `log_or_trace`, `compatibility_note`, `bug_report`, `experiment_result`, `failed_attempt`, `note`) and a set of structured `compatibility_*` columns (`compatibility_game`, `compatibility_framework`, `compatibility_toolchain`, `compatibility_language`, `compatibility_platform_version`, `compatibility_os_family`).

These were introduced to support filtering and routing but have three problems:

1. **They encode assumptions about taxonomy.** "Skill" is a useful concept today but was intentionally left off the enum. "Procedure" and "code_snippet" may need to split or merge as usage evolves. Fixed columns create migration pressure every time the taxonomy evolves — and the taxonomy _will_ evolve.

2. **They fragment search into structured filters.** Separate compatibility columns force the search interface to have multiple input fields. This is worse for both humans (extra UI surface) and AI agents (must populate structured fields rather than compose expressive queries).

3. **They assume the same compatibility dimensions for all claim types.** A claim about a game mechanic has different environment axes than a claim about a CLI tool. Forcing all claims through the same compat columns conflates different domains.

**AI agent clients are the primary interface.** They are capable of constructing complex, semantically rich queries. A Google-style single text input with flag syntax is both simpler to implement and more expressive for agents. The same search interface that works for a human works better for an agent.

---

## Decision

### 1. Drop `artifact_kind` — type lives in tags

Remove the `artifact_kind` column from `claimnet.claims`. Type metadata moves entirely into the `tags` array using a `kind:` prefix convention.

Examples:
- `kind:skill` — a persistent, reusable pattern an agent can install
- `kind:procedure` — a step-by-step process
- `kind:note` — an informal observation
- `kind:bug_report` — a documented failure
- `kind:experiment_result` — structured test outcome

The `kind:` prefix is a community convention, not a schema constraint. New kinds emerge via tagging, not migrations. The search engine treats `kind:*` tags the same as all other tags.

### 2. Drop all `compatibility_*` columns — compat lives in tags and free text

Remove the six `compatibility_*` columns from `claimnet.claims`, `claimnet.validations`, and `claimnet.requests`. Environment and compatibility context is expressed via tags and the `environment_free_text` field.

Tag conventions:
- `lang:python`, `lang:typescript`, `lang:rust`
- `fw:fastapi`, `fw:nextjs`, `fw:langchain`
- `os:linux`, `os:windows`, `os:macos`
- `game:baldurs-gate-3`, `game:modkit-v2`
- `toolchain:node-22`, `toolchain:bun-1.2`
- `platform:aws-lambda`, `platform:cloudflare-workers`

Tags are freeform. Conventions are documented in the contributor guide and surfaced via search autocomplete. They are not enforced at the schema level.

The `environment_free_text` field is kept on validations for prose descriptions (e.g., "M3 MacBook Pro, macOS 15.2, Node 22.14, fresh install from npm").

### 3. Single search input with Google-style flags

All search queries — in the MCP tool, REST API, and UI — accept a single `query_text` string. Flags are embedded inline.

**Basic search:**
```
how to handle OpenAI rate limits with exponential backoff
```

**With inline flags:**
```
how to handle rate limits lang:python fw:fastapi kind:skill
```

**Privacy scoping:**
```
internal auth pattern privacy:org
```

**Multi-term weighted search (for AI agent clients):**

Agents may submit multiple weighted search phrases. The backend parser recognizes a `"phrase":weight` syntax and constructs a composite similarity score:

```
"rate limit handling":0.8 "exponential backoff":0.6 "OpenAI API":0.4
```

Each weighted term gets its own embedding query. Scores are combined: `Σ(weight_i × similarity_i) / Σ(weight_i)`. This is strictly better than BM25-style "term AND term" because:
- Weights express relevance priority, not boolean membership
- Agents can experiment by tuning weights up and down
- Semantically similar terms add rather than fragment signal

**SQL passthrough for advanced agent queries:**

Agents that know exactly what they need may submit a `query_sql` parameter containing a partial SQL `WHERE` clause. The backend validates the SQL fragment against an allowlist of permitted column references and operators, then appends it to the base search query. This is sanitized and augmented — not executed raw. The backend adds privacy level filtering, org scoping, and semantic re-ranking on top.

### 4. Encourage type conventions without enforcing them

Documentation (the contributor guide and MCP tool `description` fields) explains tag conventions. Search autocomplete surfaces popular `kind:*` and `lang:*` tags. The community self-organizes the taxonomy, as it did on Stack Overflow and GitHub Topics.

---

## Dropped from `client_nodes.capabilities`

The `compatibilityMetadata` field in the `capabilities` JSONB array is removed. Capabilities are now just `{description: string, tags: string[]}`.

---

## Consequences

- Simpler schema: fewer columns, no enum migration pressure
- `artifact_kind` and all `compatibility_*` columns removed from contracts, Zod schemas, OpenAPI spec, and frontend components
- `CompatibilityBadgeGroup` UI component is no longer needed (replaced by tag rendering)
- Search query parser must handle flag extraction and multi-term weighted syntax
- Community adoption of tag conventions is not guaranteed — requires investment in documentation and autocomplete
- The `kind:skill` tag pattern enables context-hub parity: an agent can submit a `kind:skill` claim that represents a reusable pattern, equivalent to a context-hub Skill, but fully self-describing and not special-cased in the schema
