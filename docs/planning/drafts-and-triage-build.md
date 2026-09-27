# Drafts and triage: build log

The working record for building [drafts-and-triage.md](drafts-and-triage.md). Each slice gets its acceptance rubric written here **before** implementation starts, and its verification record written here **after**, by a different agent from the one that built it. Decisions made along the way are logged as Soup.net recipes and linked from the slice they belong to.

Branch: `feat/drafts-and-triage`. Started 2026-09-27.

## Sequencing, and one assumption questioned

The operator asked for this work before returning to organization accounts. That holds, with one adjustment: the drafts visibility rule, the triage ratings, and the headless key setting all live in the authorization seam and the key-authentication primitive. The seam's remaining three branches (#96, #97, and the unpushed key-authentication slice) are security fixes already built and verified, not org work, so they land first and this branch is built on top of them. Stacking this feature on code that is about to change underneath it would mean building everything twice.

This branch is updated by merging (not rebasing) as those land, so it never needs a force-push.

## How the work is run

One implementation agent at a time, sequential slices. Other agents do research, specs, and verification, and never the implementation they verify.

For each slice:

1. **Rubric first.** Acceptance criteria are written here, specific enough that an independent agent can say pass or fail with evidence: behaviors with the test that proves each, surfaces that must change or must not, measurable budgets (statement counts, context bytes), and the security properties that must hold.
2. **Implement.** A development agent builds the slice test-first on this branch, runs the full gate (recording the exit code, not just the summary), and reports.
3. **Verify.** A separate agent checks the slice against its rubric on an isolated stack, tries to break it, and writes the verification record below. Security-relevant slices also get the read-only audit role from `docs/workflows/security.md`, with findings kept in the private repo.
4. **Record.** Rubric outcome, evidence, deviations, and follow-ups land here; the slice's decisions are recipe-checked with feedback closing the loop.

At a genuine design fork where nobody can settle the choice in advance and both options are cheap enough to try, the agent may use the "build both" pattern this feature is about: recipe-check both options, try both, log feedback on each with the measurement, then recipe-check the final decision. This build is the first trial of the pattern, so its use (or the reasons it wasn't used) is recorded here too.

## Slices

Planned order. Each one ships something usable and keeps the gate green.

1. **Triage ratings and a tool-description trim.** Optional `impact` and `uncertainty` on checks, stored and returned, never used by ranking. Remove deprecated parameters from tool schemas (still honored), replace repeated schemas with pointers, so the net context cost of the tool roster goes down.
2. **Drafts for the key's own user.** Store the draft state, exclude drafts from every normal read path in one place in the authorization module, show a person's own drafts to their own agents labelled as drafts, and verification by the person (reaction) or their agent (evidence-backed).
3. **Review queue.** The human search page gains a drafts filter and `impact:` / `uncertainty:` qualifiers, sorted for triage, with confirm, reject, and not-chosen actions and an id-list link form.
4. **Drafts on behalf of another person.** Limited to people with write access to the target book; the verified-org-domain case waits for organization accounts.
5. **Headless keys.** A key setting that forces every deposit to be a draft, inherited by derived keys, with its own briefing profile. Designed together with the capability ladder (full, drafts only, nothing).
6. **Option sets.** The recipe-to-intent link, linked drafts under one intent with a rubric set in advance, and resolution into verified and not chosen.
7. **Briefing copy.** The when-to-draft guidance, the "checkable by someone who wasn't there" phrase, and the headless profile, declared under the briefing regression-spec process.

Rubrics for each slice are written in the next section before that slice starts.

## Rubrics and verification records

Specs: [../product-specs/drafts-and-triage.feature](../product-specs/drafts-and-triage.feature) (scenario ids `DT-*`). Read-path checklist: [drafts-and-triage-read-paths.md](drafts-and-triage-read-paths.md) (ids `RP-*`). Every criterion below is pass/fail; the verifier records the evidence (test name and file, command output, byte counts) next to each one in the slice's verification record.

Baselines were measured on 2026-09-27 against `feat/authz-seam-keys` at `3779482` (the `mcp.ts`, `packages/domain/src`, and `apps/mcp-server/src` trees are identical to those at `f73c2bc`, where the measurement ran). Method: `createMcpServer` from `apps/backend/src/routes/mcp.ts` built under tsx with a stub principal, connected to an MCP SDK 1.30.0 `InMemoryTransport`, `initialize` then `tools/list`, and the reply's `result` serialized as minified UTF-8 JSON. The stdio server (`apps/mcp-server/src/index.ts`) was measured the same way. The verifier re-runs the same method on the slice's head commit; the implementation agent should add it as a test so the number is reproducible without a script.

### Slice 1 baseline: MCP `tools/list`

Remote server (`POST /mcp`): **18,090 bytes** (18,124 with the JSON-RPC envelope), 7 tools.

| Tool | Total | Description | inputSchema |
|---|---|---|---|
| check_recipe | 6,829 | 510 | 6,097 |
| search_recipes | 4,058 | 401 | 3,433 |
| log_feedback | 3,152 | 381 | 2,548 |
| get_briefing | 1,672 | 173 | 1,301 |
| update_recipe_book_description | 909 | 238 | 412 |
| get_recipes | 904 | 266 | 437 |
| list_my_recipe_books | 548 | 250 | 85 |

Annotations and execution hints account for about 1,140 bytes across the seven tools.

`check_recipe` properties, bytes as served: feedback 877, region 674, intent 450, session_id 411, recipe 350, file_url 293, response_format 281, decided_at 275, known_recipes 253, verbosity 225, supporting_evidence 210, file_mime_type 204, recipe_book 200, synthesize 194, agent_id 185, file_base64 161, axes 159, read_recipe_books 142, **clusters 131 (deprecated)**, **max_chars 129 (deprecated)**, file_name 115.

`search_recipes` properties: feedback 877, query 466, intent 450, session_id 411, response_format 281, known_recipes 253, verbosity 225, agent_id 185, read_recipe_books 142.

Deprecated and duplicated content:

- **Deprecated in source:** only `clusters` and `max_chars` ("Deprecated — use verbosity … still honored"). `session_id` is not marked deprecated in any schema; the operator marked the session mechanism as *intended* for deprecation in favour of intents (recipe `5c55327d`), which is a backlog status, not a schema one.
- **The inline feedback-row item schema** is identical on `check_recipe` and `search_recipes`: 569 bytes of item schema, 866 to 877 bytes per property.
- **Repeated shared parameters:** `intent` (~441 bytes) on three tools, `agent_id` (174) on three, `known_recipes` (237) on two, `session_id` (411) on two plus a 161-byte row field on `log_feedback`, `response_format` (281) on two, `verbosity` (225) on two plus 205 on `get_briefing`.

Estimated savings, against draft replacement copy: feedback pointer 720 per tool (1,440); `intent` to one line 329 × 3 (987); `agent_id` to one line 88 × 3 (264); `known_recipes` to one line 130 × 2 (260). About 2,950 bytes in all. Adding `impact` and `uncertainty` as enums with one-line descriptions costs about 298 bytes.

Stdio server: **13,670 bytes**, 5 tools (check_recipe 5,038; search_recipes 3,180; log_feedback 2,860; get_briefing 1,672; get_recipes 904). It reuses the `@soupnet/domain` description constants. It has no `list_my_recipe_books` or `update_recipe_book_description`, its `search_recipes` has no `feedback` parameter, and its `log_feedback` has no `search_id`. It does declare `clusters`, `max_chars`, and a check-level `session_id` (so the comment in `mcp-tool-descriptions.test.ts` saying the stdio `check_recipe` has no `session_id` is stale).

The existing guard, `apps/backend/src/routes/mcp-tool-descriptions.test.ts`, caps the characters of `MCP_TOOL_DESCRIPTIONS` plus `MCP_PARAM_DESCRIPTIONS` at 5,950 (current total 5,884) and any single description at 420. It measures description constants, not the served payload, so it cannot see the feedback-row item schema, enums, or JSON Schema scaffolding.

### Slice 1 rubric: triage ratings and a tool-description trim

Consumer: agent (MCP and REST) for the ratings; human for the display on the trace detail page. Security-relevant: no (no new visibility rule or write authority), but the audit role still reviews the migration.

**Behavior**

| # | Criterion | Scenarios | Evidence the verifier looks for |
|---|---|---|---|
| S1-B1 | `impact` and `uncertainty` (`low \| medium \| high`) are accepted on every check surface, stored on the recipe, and echoed in the check response. | DT-RAT-01, DT-RAT-05 | Layer 3 test per surface: remote MCP, `GET /check?format=json`, `POST /check` JSON, the `/check` HTML form, and a stdio proxy test showing the params are forwarded. |
| S1-B2 | Omitted means null ("not rated"), never a stored default. | DT-RAT-02 | Test asserting null columns and "not rated" in the response. |
| S1-B3 | An unrecognized value stores null and returns a notice; the check still deposits. | DT-RAT-04 | Test with `impact=urgent` asserting 200, a deposited id, a null column, and the notice text naming the vocabulary. |
| S1-B4 | Ratings are independent of each other and of any future draft state. | DT-RAT-03 | Covered by S1-B1's test matrix including mixed values. |
| S1-B5 | A repeat of an identical check (same key, book, text) keeps the first ratings and says so. | DT-RAT-08 | Test depositing twice with different ratings. Blocked on the "Ratings on a repeat check" ruling below; if the operator rules otherwise, the scenario is edited before the code. |
| S1-B6 | The check-level `impact` and a feedback row's `impact` never cross, on MCP and on the `feedback_`-prefixed URL form. | DT-RAT-10 | Test sending both in one call on each surface. |
| S1-B7 | The trace detail page shows the ratings as the agent's ratings. | DT-RAT-09 | `GET /traces/:id` returns both fields; frontend shows them; Layer 4 manual check listed in the handoff. |
| S1-B8 | Ratings never change ranking. | DT-RAT-06, DT-RAT-07 | (a) Layer 3 test: two checks from two keys differing only in ratings return identical result ids, order, and similarity. (b) Static test: none of `apps/backend/src/services/vector-search.service.ts`, `search-pipeline.ts`, `clustering.service.ts`, `packages/domain/src/mmr.ts`, or `ranking-config.ts` references the new columns or fields; the test lists the files it scans and fails on a match. (c) `ranking-regression.test.ts` passes unchanged. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S1-Z1 | Remote `tools/list` as served is **at most 16,000 bytes** (baseline 18,090; net shrink required even after adding `impact` and `uncertainty`). Expected landing around 15,400. | A new test that builds the server and asserts the served byte size, replacing hand measurement. The verifier records the exact number. |
| S1-Z2 | Stdio `tools/list` as served does not grow: at most 13,670 bytes, with `impact` and `uncertainty` added. | Same method against `apps/mcp-server`. |
| S1-Z3 | The character cap in `mcp-tool-descriptions.test.ts` moves **down** from 5,950 to the new total rounded up to the next 50, with a dated comment, in the style of its earlier raises (recipe `8dd573b4`). | Diff of the test. |
| S1-Z4 | `feedback` on `check_recipe` and `search_recipes` no longer inlines the row schema; its description points to `log_feedback`. Every row field is still accepted and stored. | DT-TOOL-03. The test must send every `log_feedback` field on both tools and read them back; a bare object item schema would let the SDK strip them. |
| S1-Z5 | `intent`, `agent_id`, and `known_recipes` descriptions are one line each, with depth in the briefing. | Budget test's per-param cap for these three lowered (e.g. 120 chars). The `CANONICAL_PARAM_SOURCES` drift guard still passes; if a load-bearing concept no longer fits one line, the verifier records which and why. |
| S1-Z6 | `clusters` and `max_chars` stay declared (the SDK strips undeclared keys) with a one-line pointer to `verbosity` as their whole description, and are still honored. | DT-TOOL-02 on both servers; the existing "legacy clusters/max_chars stay in both schemas" test still passes. |

**Deprecated parameters: schema versus honored**

| Parameter | Tools | In schema after slice 1 | Honored when sent |
|---|---|---|---|
| `clusters` | check_recipe (remote, stdio) | Yes, one-line pointer description | Yes, unchanged |
| `max_chars` | check_recipe (remote, stdio) | Yes, one-line pointer description | Yes, unchanged |
| `session_id` | check_recipe, search_recipes (remote); check_recipe (stdio) | Yes, unchanged unless the operator rules it deprecated now (see open questions) | Yes |

No parameter is removed from a schema in slice 1. The design doc's "removed from the tool schemas (still honored when sent)" is not achievable with the current SDK; see §Open design questions.

**Surfaces that must change:** `packages/db` (two nullable columns on `traces`, migration, regenerated data-model doc); `trace.service.ts` deposit path; `routes/mcp.ts` and `apps/mcp-server/src/index.ts` schemas; `routes/check.ts` (JSON, form, query parsing); `packages/domain` param descriptions; `packages/contracts` check request and response shapes and the published `/schemas/*.json`; `GET /traces/:id` detail shape and the trace detail page.

**Surfaces that must NOT change:** ranking, clustering, MMR, and vector-search SQL; the idempotency key `(api_key_id, group_id, claim_text_hash)`; `/briefing` output apart from what the declaration below names; `log_feedback`'s own schema; feedback-row `impact` vocabulary; any authz module file.

**Briefing-copy declaration.** Tool and parameter descriptions are briefing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The slice-1 PR appends an entry to `docs/briefing-specs/spec-decision-log.md` (mirrored in the commit body) that:

- declares a new `@unreleased` scenario for the rating parameters (in `checking-behavior.feature`, or a new `triage-ratings.feature` listed in the README): a briefed agent that rates a check uses the `low | medium | high` vocabulary and omits a rating it has no view on, rather than defaulting to medium;
- names as watched, with a rationale for holding: `feedback-loop.feature` "Mid-flow feedback rides on the next check_recipe call" (row fields now learned from `log_feedback`'s schema, not inline), `intent-registration.feature` (all scenarios; `intent` description cut to one line), and `known-recipes-dedup.feature` "Known ids render as compact stubs" (`known_recipes` description cut);
- records the served `tools/list` bytes before and after.

The when-to-draft guidance and the rating guidance in the briefing body belong to slice 7, not here.

**Security properties:** none new. The verifier confirms the ratings columns are not readable through any surface that does not already return the recipe (they ride on the recipe's existing read checks).
