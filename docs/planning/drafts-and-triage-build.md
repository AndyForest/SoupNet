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
5. **Headless keys.** A key setting that forces every deposit to be a draft, inherited by derived keys, with its own briefing profile. Designed together with the capability ladder (full, drafts only, nothing). Derived keys are not built yet, so the inheritance rule is recorded in [derived-agent-keys.md](derived-agent-keys.md) and built with them (open question 44).
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
| S1-B5 | A repeat of an identical check (same key, book, text) keeps the first ratings and says so. | DT-RAT-08 | Test depositing twice with different ratings. Blocked on the "Ratings on a repeat check" ruling (open question 4); if the operator rules otherwise, the scenario is edited before the code. |
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

### Slice 1 verification record

Verifier: agent `a-drafts-verify-s1-2026-09-27`, 2026-09-27, which did not build the slice. Verified at `7401da6` in a throwaway detached worktree after `npm ci` and `build:packages`. The comparison worktree was `19c93a6`, the parent of the slice's first commit `dbfa78e`, also with its own `npm ci`. Isolated stack: compose project `soupnet-ci-5604` (postgres on 5604), the slice backend on 3171, and the pre-slice backend on 3172 against a separate `claimnet_pre` database in the same container. Both backends used `test-ci-local.mjs`'s env (stub embeddings, auto-setup, rate limits off). The evidence below comes from the verifier's own probe scripts (JSON-RPC over HTTP to `/mcp`, fetches to `/check`, `psql` reads of `claimnet.traces` and `claimnet.check_feedback`), a spawned stdio server, and test runs. The builder's commit messages were read only after the verdicts were formed. They contain no claim that the evidence contradicts.

**Verdict: accepted with follow-ups.** Nothing fails. S1-B2 and S1-B7 are partial, each for the narrow reason given in its row.

| Criterion | Result | Evidence |
|---|---|---|
| S1-B1 accepted, stored, echoed on every surface | pass | Each value was read back from the `traces` row. Remote MCP structured: `high/medium` stored `high,medium`. MCP markdown: the second line reads "Your ratings: impact low, uncertainty not rated (triage only, never ranking)." `GET /check?format=json`: `high,medium`. `POST /check` urlencoded with a JSON response: `medium,high`. Multipart with a JSON response: `low,low`. Urlencoded with an HTML response: `<p id="check-ratings">` echoes the ratings and the notice, the re-check form keeps `high` selected, and the row stores `high,NULL`. Multipart with an HTML response: `medium,NULL`. The empty HTML form offers `<select name="impact">` and `<select name="uncertainty">`, each with not rated, low, medium, and high, inside the multipart `POST /check` form. Stdio: `createStdioServer` spawned over real stdio against 3171 echoed `{"impact":"high","uncertainty":"low"}` and stored `high,low`. `server.test.ts` passes. |
| S1-B2 omitted means null | partial | Storage and JSON pass: an omitted rating stores `NULL,NULL`, `checked.impact` and `checked.uncertainty` come back `null`, and the published schema defines null as "not rated". The markdown report (the MCP default) prints nothing about ratings when neither was sent, so it does not say "not rated" as DT-RAT-02's last line literally asks. The silence is deliberate (`renderRatingsMarkdown`: "agents that never rate see no extra line"). Recorded as a scenario-wording mismatch for the orchestrator. |
| S1-B3 unrecognized value | pass | `impact=urgent` on `GET /check` and on MCP: 200 with a deposited id, `NULL` stored, and `ratingsNotice` reading "impact \"urgent\" is not a rating value, so it is stored as not rated. Ratings take low \| medium \| high; omit one you have no view on." `impact=new` (a feedback-row word) is treated the same way. Case and whitespace are normalized: `" HIGH "` and `"Low"` store `high,low`. An empty value stores null. |
| S1-B4 independent | pass | Mixed values store independently: `high,low`, `NULL,medium`, `low,NULL`. |
| S1-B5 repeat keeps the first ratings | pass | The first check sent `low`. The repeat sent `high/high` and got the same id, `existingRecipe: true`, and "…its first ratings stand (impact low, uncertainty not rated); this check's ratings were not applied." The row still stores `low,NULL`. A repeat with the same ratings, or with none, gets `existingRecipe` and no notice. The idempotency key `(api_key_id, group_id, claim_text_hash)` is unchanged in the `INSERT … ON CONFLICT`. |
| S1-B6 the two `impact`s never cross | pass | MCP: a check with `impact:"high"` and a ride-along row with `impact:"new"` stored the trace as `high,NULL` and the feedback row as `new\|check-feedback`. URL form: `impact=high&feedback_impact=new` stored the same values. `feedback_impact=big` alone left the trace `NULL,NULL`. `impact=high` inside a feedback row is refused per row: "impact must be one of: none \| new \| subtle \| big \| operational (got \"high\")". |
| S1-B7 detail page | partial | `GET /traces/:id` returns `impact: "high", uncertainty: "medium"`. The page renders "Agent's ratings: …" with hover text saying the ratings are not the person's assessment (code review of `TraceDetailPage.tsx`; `triage-ratings-label.test.ts` passes). The verifier did not run the Layer 4 browser check, so it stays on the operator's handoff list. |
| S1-B8 never ranking | pass | (a) Own corpus: 6 recipes in one book, and three scoped keys that read that book and write to a second one. Rated `high/high`, unrated, and `low/urgent` checks of the same text returned identical `[id, similarity, clusterSize]` lists (6 results, `totalResults` 6/6/6). The same held over MCP structured. DT-RAT-07: two mirrored books with the same six recipes, one rated `high/high` and one unrated, gave identical `[text, similarity]` lists for both `filter` search and check. (b) `git diff 19c93a6 HEAD` over `vector-search.service.ts`, `search-pipeline.ts`, `clustering.service.ts`, `mmr.ts`, `ranking-config.ts`, and `apps/backend/src/authz/` is empty. `ranking-isolation.test.ts` scans the five files. It passes pre-slice as well, as a guard should. (c) `ranking-regression.test.ts` is byte-identical and passes. The only non-test backend readers of the columns are the deposit path, the repeat lookup, and `GET /traces/:id`. |
| S1-Z1 remote ≤ 16,000 | pass | 18,090 → **15,864** bytes (see the table below). |
| S1-Z2 stdio ≤ 13,670 | pass | 13,670 → **12,074** bytes. |
| S1-Z3 cap moves down | pass | The measured total of `MCP_TOOL_DESCRIPTIONS` and `MCP_PARAM_DESCRIPTIONS` went from 5,884 to 5,510. The cap moved 5,950 → 5,550, the next 50 up, with a dated comment. The largest single description is 412. |
| S1-Z4 feedback pointer, every field kept | pass | Every `log_feedback` field was sent on remote `check_recipe`, remote `search_recipes`, and stdio `check_recipe`. The stored `check_feedback` rows matched a direct `log_feedback` row field for field: kind, impact, disposition, story_fulfilled, story, note, agent_id, top_similarity, model, harness, harness_version, related_trace_ids, session_id, intent_id, trace_id. Mutation check: `feedbackRowSchema` swapped to a bare `z.object({})` makes the Layer 3 Z4 and B6-MCP tests and two stdio `server.test.ts` tests fail. The static size test alone would not catch it. |
| S1-Z5 one-line shared params | pass | `intent` 114, `agent_id` 92, `known_recipes` 102 characters, under the new 120 cap. The `CANONICAL_PARAM_SOURCES` drift guard passes. For the concepts dropped, see the copy review. |
| S1-Z6 legacy levers declared and honored | pass | Both servers declare `clusters` and `max_chars` as "Deprecated: use verbosity (still honored)." (42 characters). Remote results: `clusters` 1 → 1 result, 4 → 4; `max_chars` 400 → 2, 8000 → 17. Stdio gave the same counts. The handler code is unchanged apart from the destructure, and the builder's Z6 Layer 3 test passes against both the pre-slice and the slice backend. |
| Deprecated-parameter table | pass | `clusters` and `max_chars` are in the schema and honored. `session_id` keeps its description unchanged on both tools. No parameter was removed from any schema: a pre/post diff of the served tools shows only `impact` and `uncertainty` added. |
| Must NOT change | pass, one note | Ranking, clustering, MMR, vector search, and authz: no diff. Idempotency key: unchanged. The feedback-row `impact` vocabulary is unchanged. `log_feedback` keeps the same field set, types, and required list. Its `agent_id` description did change, because it shares `MCP_PARAM_DESCRIPTIONS.agentId`. The spec log declares that change ("all tools that carry them"). `/briefing` changes only in the two "How to check" edits the declaration names. |
| Briefing-copy declaration | pass | The `spec-decision-log.md` 2026-09-27 entry declares the new `@unreleased` scenario (present in `checking-behavior.feature`), names the three watched scenarios with a rationale for each, and records the bytes before and after, which match the verifier's measurements. Its claim that the sub-agents line survives in the intent echo line checks out (`intent.service.ts:181`). |
| Security property | pass | A non-member's `GET /traces/:id` returns `404 {"ok":false,"error":"Trace not found"}` for both a rated recipe and a random UUID, with no ratings. Check and search `results[]` never carry ratings (0 of 10). `/recipes?ids=` never returns them, and for a non-member it returns `not_found_or_unreadable`. No backend code reads `traces` with a `SELECT *`. |

**Served `tools/list` bytes** (the verifier's own measurement: `createMcpServer` with a stub principal over the SDK `InMemoryTransport`, minified UTF-8 `result`; `createMcpServer` was exported only in the throwaway pre-slice copy to measure it; the stdio figures come from spawning `apps/mcp-server/src/index.ts` and speaking JSON-RPC over real stdin/stdout):

| Server | Before (`19c93a6`) | After (`7401da6`) | Cap |
|---|---|---|---|
| Remote | 18,090 (18,124 with envelope) | 15,864 (15,898 with envelope); `POST /mcp tools/list` over HTTP on 3171 also returned 15,864 | 16,000 |
| Stdio | 13,670 | 12,074 | 13,670 |

Per tool on the remote server, before → after: `check_recipe` 6,829 → 6,012; `search_recipes` 4,058 → 2,988; `get_briefing` 1,672 → 1,381; `log_feedback` 3,152 → 3,104; the other three are unchanged. In `check_recipe`, `feedback` went 866 → 236, `intent` 441 → 150, `agent_id` 174 → 126, `known_recipes` 237 → 136, and `clusters` and `max_chars` 120/117 → 76 each. The new `impact` and `uncertainty` cost 163 and 150.

**Test-first findings.** Each new or changed test file was copied into the pre-slice worktree and run against the pre-slice backend.

- Fail pre-slice, so they show the behavior is new: `triage-ratings.test.ts` (13 of 16 fail); `mcp-tools-list-size.test.ts` (4 of 5, including "served tools/list is 18090 bytes"); `check-response-renderer.test.ts` (2 new cases); `schemas.test.ts` (2 new cases); `check-params.test.ts` (3 new cases).
- Fail pre-slice only because the module under test doesn't exist yet, which shows nothing about behavior: `packages/domain/src/triage-ratings.test.ts`, `apps/mcp-server/src/server.test.ts`, `apps/frontend/src/lib/triage-ratings-label.test.ts`, and `mcp-tool-descriptions.test.ts` (it now reads `server.ts`). By inspection, its new 120-character case would fail pre-slice, where `intent` was over 400 characters.
- Pass pre-slice by design, so fail-first can't be shown: `ranking-isolation.test.ts` (a static guard over files the slice didn't touch); in `triage-ratings.test.ts`, S1-Z4 (the old schema declared every field), S1-B8a (ranking was never affected), and S1-Z6 (the behavior is unchanged). The mutation check under S1-Z4 stands in as the test's proof of teeth. `recipe-guide-content.test.ts` passes too, because the slice only raised its ceiling.

**Copy review.** The new descriptions are in the enabling voice: "Omit it if you have no view", with the notice text "omit one you have no view on", and no rules or capitals. The check-level `impact` is hard to confuse with a feedback row's. Its description ends "Not a feedback row's impact." `check_recipe`'s schema no longer shows a second `impact` inside the feedback items, and the published `IMPACT_DEFINITION` names the other vocabulary. The HTML labels ("your rating of how much rides on this call", "…how unsure you are of the person's position") match the design doc's wording. Phrases that disappeared, and where they went:

- `intent`: "Text ALWAYS registers a NEW intent (identical wording never merges sessions)", lost-id recovery, and "rendering only, never ranking" moved to the new briefing paragraph. "Sub-agents with their own goals send their own text" and the carry-the-id protocol live in the echo line on every response. "stubs reset" (after a re-sent story) went nowhere; the paragraph says only "re-send the story for a fresh one".
- `agent_id`: "stamped on audit records" and "Capture only" were dropped without a new home (declared).
- `known_recipes`: "Client-declared sibling of session_id" is covered by the briefing's "client-declared ids". "logging … and clustering are unchanged" was dropped. "UUIDs" became "ids".
- `feedback`: "trace_id … (full UUID or 8+ char short id)" lives in `log_feedback`'s `trace_id` description. "Rows validate independently" became "A rejected row never blocks this call".
- `clusters` and `max_chars`: "Exact exemplar count (harness/sweep use)" and "Approximate size target in characters" were dropped (declared). Agents now learn only that these parameters are deprecated.

One wording nit in the new briefing paragraph: "if you lose the id, say to context compaction, re-send the story". "say to" means "for example to", and it can read as an instruction to say something.

**Gate.** `TESTCI_PGPORT=5604 npm run test:ci` in the verification worktree: exit code **0** on the first run: typecheck, lint, the data-model drift check, the authz seam check, and the golden-set ranking eval all passed; tests 1,418 passed and 10 skipped across 110 files (3 skipped).

**Deviations.**

- DT-RAT-05's "POST /check with a JSON body" was verified as a form body (urlencoded and multipart), per the orchestrator's ruling.
- `log_feedback`'s `agent_id` description changed through the shared constant, although the rubric lists `log_feedback`'s schema as must-not-change. The field set, types, and required list are unchanged, and the change is declared.
- The builder's frontend commit message (`de7d919`) was seen while reading that diff, after the B7 evidence had been gathered.

**Follow-ups** (none blocks the slice):

1. DT-RAT-02 wording against the silent markdown report. Either edit the scenario to "JSON and structured report null; markdown stays silent when unrated", or print "not rated" in markdown. The first keeps "agents that never rate see no change".
2. Notice grammar when both ratings are invalid: "impact \"urgent\" and uncertainty \"7\" is not a rating value" should be plural.
3. A rating sent with the wrong JSON type on MCP (`impact: 3`) is an SDK validation error that fails the whole check ("Expected string, received number at impact"), which cuts against "never costs the check". A non-object feedback row likewise fails the whole call despite "A rejected row never blocks this call"; that predates the slice (the old item schema was also an object).
4. The open-record feedback items now pass keys the old schema stripped. The feedback service still validates each row strictly: an unknown key is ignored, `impact: 5` and `impact: ["new"]` get the vocabulary marker, a non-array `related_trace_ids` and a numeric `trace_id` get markers, a 20,000-character `model` gets "model too long (max 4000 chars)", and a 100,000-character `story` gets "story too long (max 4000 chars)". A row for a recipe the key can't read and a row for a random UUID get the same marker, "trace_id not found or not readable with this key". What the change widens is benign but new on MCP: the `recipe_id` alias now reaches the service, and a string `top_similarity: "0.9"` is coerced and stored where it used to be an SDK error. Both match REST `/feedback`.
5. A repeated wire parameter (`impact=low&impact=high`) silently takes the first value.
6. The data export (`routes/auth.ts`) doesn't carry `impact` or `uncertainty`. Worth adding with slice 2's export and import work on draft state.
7. Layer 4 manual check of the trace detail page's "Agent's ratings" line (operator handoff).

### Slice 2 rubric: drafts for the key's own user

Consumer: agent (deposit, labelled own drafts, agent verification) and human (reaction verification, detail page). Security-relevant: yes. A new visibility rule and a new agent write, so the security workflow applies in full: a read-only audit by an agent other than the builder and the verifier, findings in the private repo, and a recipe check on each security decision. Depends on the rulings for open questions 5 to 15 below; the rubric states the recommended behavior and changes if a ruling differs.

The checklist is [drafts-and-triage-read-paths.md](drafts-and-triage-read-paths.md): 45 read paths, RP-01 to RP-45. The verifier walks every row and records, for each, the test or static check that proves its disposition, or why it is `irrelevant`.

**Where the rule lives (the core criterion)**

| # | Criterion | Evidence |
|---|---|---|
| S2-M1 | The draft visibility rule is written once, in `apps/backend/src/authz/`: the facts it needs (is a draft, who it is about, who deposited it, the viewer's user id) reach `mayReadTrace` for single-recipe reads, and one SQL fragment in the module (the pattern of `membership-sql.ts`) serves every set-returning statement. No file outside the module writes a draft condition by hand. | Code review; a unit test in the module in the style of `membership-sql.test.ts` that fails when another file in the module restates the condition. DT-VIS-14. |
| S2-M2 | `scripts/check-authz-seam.mjs` gains a register for statements that read `claimnet.traces` (and `embedding_sources` where it resolves to traces), with the same fingerprint ratchet as the existing two. Each registered file either composes the module's fragment or carries a one-line reason it is `irrelevant` (write, cascade, by-id helper fed a filtered list). `npm run check:authz-seam` fails on an unregistered file. | The guard's diff; a deliberate unregistered read in a scratch commit makes it fail (the verifier shows the output). |
| S2-M3 | The viewer reaches the three pipeline functions. `runSearchPipeline` today receives `groupIds` only; it must receive the viewer (user id) and pass it to `hybridSearch`, `evidenceSearch`, and `fetchCorpusTraces`. | Code review of the signatures; RP-39 to RP-41. |
| S2-M4 | In `hybridSearch` the condition lives in the shared `searchPredicates` fragment, so the count, the ANN query, and the exhaustive fallback agree. The condition reads the draft state from `traces` (join or `EXISTS`), not from a copy on `embedding_sources`, which would add a second hand-synchronized denormalization next to `group_id` (the one `trace-move.service.ts` calls "the load-bearing detail"). If the ANN plan cost is measurable, the builder records the before and after latency on the ranking eval stack, and a copy is considered only with a guard test that fails when the two disagree. | DT-VIS-02, DT-VIS-11; plan and latency numbers in the verification record. |

**Behavior**

| # | Criterion | Scenarios | Read paths |
|---|---|---|---|
| S2-B1 | `draft` on every check surface stores a draft deposited by that key about the key's user; the response labels it and says who can see it. | DT-VIS-01 | RP-01, RP-13 |
| S2-B2 | A collaborator never sees a draft in check or search results, cluster members, related evidence, or stubs, and every count equals the no-draft count. | DT-VIS-02, DT-VIS-03 | RP-01 to RP-03, RP-13, RP-14, RP-39 to RP-41 |
| S2-B3 | By-id surfaces return the uniform absent response for a collaborator, including short-id prefix scans, which apply the same condition as the main select so `ambiguous_prefix` never names a hidden draft. | DT-VIS-04, DT-VIS-05 | RP-06, RP-08, RP-11, RP-16, RP-18, RP-19 to RP-22 |
| S2-B4 | The person's own agents see their drafts, ranked as if not drafts and labelled in both response formats; drafts never widen a key's scope. | DT-VIS-06, DT-VIS-07 | RP-01, RP-02, RP-06, RP-13, RP-14, RP-16 |
| S2-B5 | Aggregates exclude drafts: briefing Index counts and dates, exemplars (for the person's own agents too), the map for every viewer, the book list for collaborators, integrity. | DT-VIS-08, DT-VIS-09, DT-VIS-17, DT-VIS-18 | RP-07 to RP-10, RP-12, RP-15, RP-17, RP-24, RP-25, RP-26, RP-44 |
| S2-B6 | Export carries the draft state and import restores it; a collaborator's export never holds another person's draft. | DT-VIS-10, DT-VIS-16 | RP-30, RP-35 |
| S2-B7 | Re-checking a draft's text as a non-draft through the same key returns the draft, still a draft, with a verification hint. | DT-VIS-12 | RP-04 |
| S2-B8 | Moving keeps draft state; move and delete of a draft by anyone but the person return the uniform 404 and change nothing. | DT-VIS-13, DT-VIS-15 | RP-23, RP-36 |
| S2-B9 | The person's `still_true` verifies and `wrong` rejects, one-way; a collaborator's reaction is uniformly absent. | DT-VER-01, DT-VER-02, DT-VER-03, DT-VER-07 | RP-21 |
| S2-B10 | The agent verify operation requires a new evidence entry with a quote and a citation, refuses a duplicate of existing evidence, records the verifying key, and refuses non-drafts without storing anything. It is available on MCP and REST (the design's "one new agent-callable operation"). | DT-VER-04, DT-VER-05, DT-VER-06, DT-VER-08 | new surface; add its row to the inventory |
| S2-B11 | Verification changes no ranking input: text, embeddings, judgment date, and ratings are untouched. | DT-VER-09 | RP-39 to RP-41 |

**Uniform responses.** For each of RP-06, RP-11, RP-16, RP-18, RP-19 to RP-23 and the new verify operation, the Layer 3 test compares the collaborator's response for a real draft id against the response for a random UUID and asserts they are equal after replacing the id. Status, body keys, error text, and marker values must match.

**Surfaces that must change:** the `traces` schema (draft state and verification columns per open question 6) and migration; the authz module and the seam guard; `trace.service.ts` deposit and search paths; `search-pipeline.ts`, `vector-search.service.ts`, `recipe-lookup.service.ts`, `feedback.service.ts`, `book-stats.service.ts`, `briefing-exemplars.ts`; `routes/traces.ts` (reaction write, move, delete, list, map); `routes/auth.ts` export and `import.service.ts`; `routes/mcp.ts`, `routes/check.ts`, the stdio proxy, `packages/contracts` for the `draft` parameter, the draft label in responses, and the verify operation; the trace detail page.

**Surfaces that must NOT change:** ranking math (`mmr.ts`, `ranking-config.ts`, the scoring in `hybridSearch`), with `ranking-regression.test.ts` passing unchanged; the idempotency key; `session_shown` and `intent_shown` semantics (rendering only); reaction vocabulary, and the meaning of `fetchBookStats` reaction counts (they count published recipes only, so a hidden draft never moves a shared figure; clarified 2026-09-27); `api_keys` schema (headless is slice 5).

**Security properties the verifier must see proven**

- Every read path in the inventory is covered: a test per row group, or a registered static reason.
- Exclusion is enforced in one place (S2-M1) and guarded statically (S2-M2).
- No existence oracle: uniform responses as above, including prefix ambiguity, feedback acceptance, move, and delete.
- Ratings and draft state are never read by ranking (the static test from slice 1 extended to the draft and verification columns).
- The audit role's findings are recorded in the private repo, and this log records only that the audit happened and whether blocking findings were closed.

**Briefing-copy declaration.** Slice 2 adds the `draft` parameter description and the verify tool description (tool copy, so declared under the regression rule) with a new `@unreleased` briefing-spec scenario: a briefed agent drafts only when it cannot ask and the call clears the impact and uncertainty bar, and says why it couldn't ask in the first evidence interpretation. The full when-to-draft guidance in the briefing body stays in slice 7.

### Slice 2 verification record

Verifier: agent `a-drafts-verify-s2-2026-09-27`, 2026-09-27, which did not build the slice. Verified at `a0be3b7` in a throwaway detached worktree after `npm ci` and `build:packages`; the pre-slice comparison point is `eb29acb`, the parent of `eba35fe`. Isolated stack: compose project `soupnet-ci-5624` (postgres on 5624), the slice backend on 3191 with `test-ci-local.mjs`'s env (stub embeddings, auto-setup, rate limits off), and a second, deliberately mutated backend on 3192 for the seam plants. The evidence comes from the verifier's own probe scripts: JSON-RPC to `/mcp`, fetches to `/check`, `/recipes`, `/feedback`, `/briefing`, `/traces`, `/auth/me/export`, `/import`, `/admin`, and `/health/integrity`, a spawned stdio server, and `psql` reads. Verdicts were formed before reading the builder's commit messages and build notes; nothing in them contradicts the evidence, with the one qualification under S2-M2.

Cast: Pat (member of a shared book, with two full keys, a key without the shared book, and a JWT), Sam (the book's owner), an outsider with no membership, and the system user. Pat's drafts: DU (unverified, rated `high`/`medium`, a unique marker in its text and evidence), DV (verified by Pat's `still_true`), DR (rejected by Pat's `wrong`), DA (verified with `verify_draft`), DA2 and DS (verified with `POST /recipes/:id/verify`, by a different key and by the depositing key), DX (export and import), DD (dates and map cache), and further drafts from the stdio server and the check page. A published recipe was planted (by SQL, no route can choose ids) whose id shares DU's 8-character prefix.

**Verdict: accepted with follow-ups.** Nothing fails. S2-M2 is partial; the security-property row stays open until the audit role reports.

| Criterion | Result | Evidence |
|---|---|---|
| S2-M1 the rule written once | pass | `authz/draft-sql.ts` (fragments) and `mayReadTrace` in `roles.ts` (facts from `trace-access.ts`) are the only expressions. `draft-sql.test.ts` passes; with a hand-written `draft_state` condition planted in `book-stats.service.ts`, its "no file but authz/draft-sql.ts compares or tests draft_state in SQL" case fails. |
| S2-M2 the seam register | partial | `TRACE_READS` has 26 files, 7 composing. `npm run check:authz-seam` exits 0 at the tip. Planted, each in the throwaway worktree then reverted: a new file with an unregistered `claimnet.traces` read fails; deleting the draft line from the `lookupRecipes` main select, the evidence-search `publishedTrace`, the feedback prefix scan, and the search-only scope count each fails ("lines … changed in a registered file"); deleting `fetchCorpusTraces`' only fragment fails ("registered as composing … references none"). **Not caught:** deleting `traceIdVisibleTo` from `hybridSearch`'s `searchPredicates`, because that fragment sits on a line before the statement's table mention and the fingerprint window only runs forward; the file still references `publishedTrace`, so the composes check passes too. The Layer 3 suite catches that mutation (three DT-VIS-02/03 tests fail on a backend built with it), so the gate as a whole holds, but the static guard alone does not. A call site's choice of audience is also outside the guard's view (see follow-up 2). |
| S2-M3 the viewer reaches the pipeline | pass | `runSearchPipeline` takes `audience` (a viewer or `SHARED_AUDIENCE`, default shared) and passes it to `hybridSearch` and `fetchCorpusTraces`. `evidenceSearch` takes no viewer: it applies `publishedTrace` for every viewer, stricter than the rubric's wording and the builder's declared interpretation 1, which the verifier accepts (an own draft quoted there would carry no label). |
| S2-M4 condition in `searchPredicates`, read from `traces` | pass | `EXISTS (SELECT 1 FROM claimnet.traces dv WHERE dv.id = es.source_id AND …)` in the shared predicates, so count, ANN, and fallback agree; no copy on `embedding_sources`. Measurement below. |
| S2-B1 deposit | pass | Stored `unverified` with the key's user and key, and labelled with the notice, via remote MCP (structured and markdown), `GET /check?format=json`, `POST /check` urlencoded (`draft=on`), multipart with an HTML response (the form's checkbox comes back checked, `<p id="check-draft">` carries the notice), and the stdio server. `draft: "maybe"` on MCP deposits a draft with a notice rather than failing. |
| S2-B2 collaborators see nothing | pass | Sam's check with DU's exact text, the same text as a search, a quoted phrase from its evidence, `author:<Pat>`, and `author:anyone`, over JSON, HTML, and MCP both formats: no hidden draft id and no marker in any response; `totalResults`, cluster sizes, and related-evidence parents are the published-only figures (3 → 4 after the prefix twin, 7 after DV, DA, DA2 were verified); no related-evidence entry quotes a draft. The outsider sees nothing either. |
| S2-B3 by-id uniform absence | pass | See the uniform-response results. The prefix shared with the planted twin resolves, for Sam, to the twin alone (`get_recipes`, `GET /recipes`, `POST /feedback`, `verify_draft` all name only the twin); for Pat it is `ambiguous_prefix` naming both. |
| S2-B4 own agents see own drafts, labelled | pass | Pat's `draftState` appears on results and stubs in JSON and structured; `[unverified draft: …]` in markdown results, stubs (`[known to you] [unverified draft …]`), `get_recipes` (`Draft: …`), and the HTML page. Pat's second key sees DU; the key without the shared book gets the uniform marker and finds nothing by quoted marker or check. DS's similarity (0.0057258) and position were identical before and after verification, and equal in Sam's list afterwards. |
| S2-B5 aggregates | pass | With the book's published recipes back-dated to 2026-01-01, Sam's Index line stayed "7 recipes · newest judgment 2026-01-01 · …" after a new draft landed, then moved to 8 and 2026-09-27 only when Pat verified it. Pat's line carries a separate "Drafts: N unverified drafts about your user await their review" (8, then 4, then 5). No draft in exemplars for anyone, including Pat's own briefing at `verbosity: high` and `POST /keys/briefing`. The map (Sam and Pat, default, `query`, and `traceIds` modes) counts published only; the cached layout was byte-identical before and after a draft landed and refreshed on verification. `GET /traces?groupId=` shows Sam no drafts and Pat his own, labelled. Integrity names no draft. |
| S2-B6 export and import | pass | Pat's export carries `draftState` and ratings; Sam's and the outsider's exports hold none of Pat's drafts. DX deleted by Pat, then his export re-imported: DX comes back `unverified`, `low`/`high`. For import uniformity see RP-35. |
| S2-B7 re-check as non-draft | pass | Same key, same text, no flag: same id, `existingRecipe`, `draftState: unverified`, "…it is still a draft: checking it again does not verify it…". A rejected draft's text reports "rejected … nothing new was stored" and stays out of results. A published recipe re-checked with `draft=true` stays published with a notice. A different key of Pat's inserts a new ordinary recipe (accepted in open question 5). |
| S2-B8 move and delete | pass | Pat moved DU to his personal book and back: still `unverified`, `embedding_sources.group_id` followed, Sam found it in neither book. Sam (the book owner), the outsider, and the system user get byte-identical 404s for move and delete of DU and DR against a random id, and nothing changed. |
| S2-B9 reactions | pass | Pat's `still_true` → `verified` (resolver Pat, key null); `wrong` → `rejected`; `stale` → nothing. Clearing DV's reaction, then setting it to `wrong`: still `verified`, reaction row `wrong`. `still_true` on the rejected DR: still `rejected`. Sam's reactions on DU and DR are the uniform 404 and write no row. |
| S2-B10 agent verification | pass | Refused, nothing stored: empty evidence, a quote with no citation, a citation with no quote, a quote the draft already carries (also with different case and spacing), a bad JSON body. A repeat quote plus a new one verifies and attaches only the new entry (`evidenceAdded: 1`). `verifiedByDepositingKey` is true for DS (depositing key) and false for DA2 (Pat's other key); the key is stored and the detail page shows it. On a non-draft: 409 "not a draft", nothing stored; on DR (rejected): "already resolved"; on a verified draft: "not a draft". MCP, REST, and stdio. |
| S2-B11 no ranking input changes | pass | Across verification, claim text, hash, `decided_at`, `created_at`, `impact`, and `uncertainty` are unchanged and the trace vectors hash identically; only the four draft columns and `updated_at` move. |
| Uniform responses | pass | Below. |
| Must NOT change | pass | No diff to `mmr.ts`, `ranking-config.ts`, `clustering.service.ts`, or `ranking-regression.test.ts`; the `hybridSearch` diff adds only the predicate. Idempotency key, `session_shown` / `intent_shown`, reaction vocabulary, and `api_keys` are untouched. Index reaction and feedback counts are published-only, per the ruling. `ranking-isolation.test.ts` now also forbids the draft and verification columns in the five ranking files. |
| Security properties | pass, one open | Every inventory row walked (table below); one place (S2-M1); static guard partial (S2-M2); no existence oracle on the rubric's surfaces; ranking isolation extended. **Open:** this log does not yet record that the audit role reviewed the slice. |
| Briefing-copy declaration | pass | `spec-decision-log.md` 2026-09-27 slice 2 entry: the `draft` and `verify_draft` copy, the Drafts line, the new `@unreleased` scenario (present in `checking-behavior.feature`), watched scenarios with rationale, bytes before and after. |

**Read paths.** "Own" means Pat's own drafts. Pat sees his unverified drafts labelled in result sets, and his drafts in any state by id; Sam and the outsider see only published recipes (including drafts once verified).

| RP | Pat | Sam | Outsider | Result |
|---|---|---|---|---|
| 01 `/check` deposit (JSON, HTML, form) | own unverified, labelled; rejected gone | none; counts published-only | none | pass |
| 02 `/check?filter=` | own labelled | none (text, quoted, `author:`) | none | pass |
| 03 zero-result scope counts | own unverified counted (code review) | "No matches among the 2 recipes in scope" before and after a draft landed, REST and MCP | own book only | pass |
| 04 idempotency hit | state reported, never published | n/a (key-scoped) | n/a | pass |
| 05 known-set and intent ledgers | stubs labelled | stubs only of rows already shown | same | pass (irrelevant) |
| 06 `GET /recipes` (id, prefix) | labelled; `ambiguous_prefix` names both | uniform; prefix resolves to twin alone | uniform | pass |
| 07 `/briefing` | composes 08–10 | composes | composes | pass |
| 08 briefing `recipe_ids` | labelled | uniform | uniform | pass |
| 09 Index lines, Drafts line | published figures + own Drafts line | published only, dates held | no line | pass |
| 10 exemplars | no drafts | no drafts | own book | pass |
| 11 `POST`/`GET /feedback` | accepted on own drafts | uniform `TRACE_NOT_READABLE`; prefix to twin | uniform | pass |
| 12 `/health/integrity` | no draft ids | none | none | pass |
| 13 `check_recipe` (incl. synthesis) | labelled, both formats | none | none | pass (synthesis labelling by unit test, stub provider) |
| 14 `search_recipes` | labelled | none | none | pass |
| 15 `get_briefing` | as 07–10 | as 07–10 | as 07–10 | pass |
| 16 `get_recipes` | labelled | uniform | uniform | pass |
| 17 `list_my_recipe_books` | Index + Drafts line | published only | no line | pass |
| 18 `log_feedback` (+ ride-alongs) | accepted | uniform on MCP, check ride-along, search ride-along, URL form | uniform | pass |
| 19 `GET /traces/:id` | draft state, `canResolveDraft` | uniform 404 | uniform 404 | pass |
| 20 `GET /traces/:id/feedback` | readable | uniform 404 | uniform 404 | pass |
| 21 reaction `PUT`/`DELETE` | resolves (one-way) | uniform 404, no row | uniform 404 | pass |
| 22 star | readable | uniform 404, no row | uniform 404 | pass |
| 23 move, delete | allowed, state kept | uniform 404 (owner) | uniform 404; system user too | pass |
| 24 map (default, `query`, `traceIds`) | no drafts | no drafts | 403 (non-member, as before) | pass |
| 25 `GET /traces?groupId=` | own labelled | published only | 403 | pass |
| 26 `POST /keys/briefing` | no drafts | n/a | n/a | pass |
| 27 `GET /traces` | own, labelled | own | own | pass |
| 28 `GET /traces/count` | counts own drafts (as ruled) | own | own | pass |
| 29 `GET /traces/checks` | own deposits | only ids shown to Sam | own | pass |
| 30 export | own, with state | own only | own only | pass |
| 31–34 admin | operator totals include drafts | n/a | n/a | irrelevant (as inventoried) |
| 35 import | restores state | see note | see note | partial: state round trip passes; uniformity, see private note |
| 36 move/delete services | as 23 | as 23 | as 23 | pass |
| 37, 38 account deletion, reaper | n/a | n/a | n/a | irrelevant (registered) |
| 39 `hybridSearch` | own unverified | published | published | pass |
| 40 `evidenceSearch` | published only | published only | published only | pass |
| 41 `fetchCorpusTraces` | own unverified | published | published | pass |
| 42 by-id enrichers | callers pass filtered ids | same | same | pass (callers checked) |
| 43 embedding pipeline | drafts embedded, vectors unchanged by verification | n/a | n/a | pass |
| 44 map layout cache | pool filtered before clustering, bytes identical across a draft deposit | same | n/a | pass |
| 45 offline evals | n/a | n/a | n/a | irrelevant (registered) |
| 46 `verify_draft`, `POST /recipes/:id/verify` | verifies with new evidence | uniform (MCP text, REST 404) | uniform | pass |

**Uniform responses.** For Sam, the outsider, and (JWT routes only) the system user, each surface was called with DU (unverified) and DR (unverified, then again after rejection), and with a random UUID, and the status plus body compared byte for byte after replacing the id and its 8-character prefix. 27 surfaces for key holders: `GET /recipes` (id, prefix), `get_recipes` (id, prefix), `GET /briefing?recipe_ids=`, `get_briefing recipe_ids`, `POST /feedback` (id, prefix), `GET /feedback`, `log_feedback`, the feedback ride-along on `check_recipe`, `search_recipes`, and the `/check` URL form, `verify_draft` (id, prefix), `POST /recipes/:id/verify` (with and without evidence), `GET /traces/:id`, `GET /traces/:id/feedback`, reaction `PUT` (`still_true`, `wrong`) and `DELETE`, star `PUT`/`DELETE`, move to a personal book, move to the shared book, delete. Result: identical in every pair except, for Sam and DU, the four prefix surfaces, where the prefix resolves to the planted published twin instead of "not found" (the DT-VIS-05 behavior; no candidate list names DU). No reaction, star, or state change was written. Response headers were not compared.

**Verification** results are in rows S2-B9 and S2-B10 above. After resolution Sam finds DV, DA, and DA2 on check and search (JSON, HTML, MCP both formats), the map, the book list, and the Index count, and DS and DD in later check totals; a separate pair showed a draft going from `not_found_or_unreadable` for the collaborator to `ok` (no `draftState` on the wire) by id once verified, with `GET /traces/:id` and feedback accepted. Sam never finds DU, DR, DX, or the other unverified drafts.

**Measurement (S2-M4).** The builder's `bench-draft-condition.mjs`, re-pointed at 5624, run once at 20,000 synthetic recipes (4% drafts): count p50 15.7 ms (none), 29.3 ms (A, the shipped `EXISTS`), 28.5 ms (B); ANN top-60 p50 52.2 / 52.1 / 51.1 ms; HNSW used in all three. The builder reported 16.6 / 32.0 / 29.9 and 51.8 / 51.6 / 51.7. The numbers agree: no ANN cost, the exact count roughly doubles (+14 ms here, +15 ms there). The bench replays the predicates by hand rather than calling `hybridSearch`; the verifier checked that its variant A matches the SQL `traceIdVisibleTo` emits for a viewer.

**Gate.** `TESTCI_PGPORT=5624 npm run test:ci` in the verification worktree: exit code **0** on the first run. Typecheck, lint, the data-model drift check, the authz seam check, and the golden-set ranking eval passed; tests 1,526 passed and 10 skipped across 114 files (3 skipped), `drafts.test.ts` and `ranking-regression.test.ts` included.

**Deviations.**

- The prefix twin was planted by SQL, since no route lets a caller choose an id.
- The uniform comparison covers status and body, not headers.
- RP-13's synthesis labelling was checked by the unit test and code review; the stub synthesis provider cannot show the prompt.
- Layer 4 (the detail page's draft status and reaction prompt in a browser) was not run; it stays on the operator's handoff list.
- The build-log notes and commit messages were read after the verdicts. The builder's statement that the seam guard fingerprints "the whole statement around each mention" is accurate, but it does not cover a fragment built before the mention (S2-M2).

**Follow-ups** (none blocks the slice):

1. S2-M2: make the guard see predicate fragments assembled above the table mention (for example fingerprint the enclosing function, or require each composing file to keep a registered count of fragment calls), so that removing `hybridSearch`'s draft condition fails statically as well as in Layer 3.
2. Test strength on DT-VIS-08 and RP-44: strengthen the Pat-map assertion; see the private note.
3. RP-35: see the private note (pre-existing, already filed by the orchestrator; the verifier confirmed it applies to drafts as to any recipe).
4. A verified draft carries `draftState: "verified"` on `GET /traces?groupId=` and the detail page (with who verified it and the verifying key's id) for collaborators too, while the agent surfaces render a verified draft as an ordinary recipe. Likely intended (the audit display of open question 14), but the design says "a verified draft reads as an ordinary recipe everywhere"; worth a one-line ruling.
5. The security-property row stays open until the audit role's review is recorded here.
6. The shared-description cap rose 5,550 → 6,000 in this slice (declared in the spec log, recipe `8dd573b4`); the orchestrator rulings mention only the `tools/list` cap. Noted for completeness.

### Slice 3 rubric: the review queue

Written 2026-09-27 by agent `a-drafts-rubric-s3-2026-09-27`, before implementation, from the design, the slice 1 and 2 records, and the code at `30e4efe`. Consumer: human (the queue page, its actions, the id-list link) and agent (the new qualifiers on `search_recipes` and `/check?filter=`, and the queue link in the draft deposit notice). Security-relevant: yes. The slice adds a read path that lists drafts, a resolution write (not chosen), and a link whose ids come from an agent, so the security workflow applies in full: a read-only audit by an agent other than the builder and the verifier, findings in the private repo, and a recipe check on each security decision. The slice also gets a browser verification run; its expectations are drafted from this rubric and kept with the operator's working notes.

Depends on the rulings for open questions 21 to 27. The rubric states the recommended behavior; where a ruling differs, the criterion is edited before the code. The largest is question 21: the "human search page" the design builds on does not exist yet, and the daily-key route that open question 19 accepted would miss drafts, so this rubric specifies the queue by outcome (S3-Q1) and recommends a JWT listing route that reuses the grammar.

Terms: an **unresolved draft** is a recipe whose draft state is `unverified`. **The queue** is the SPA page `/app/drafts`. **The listing route** is whatever serves the queue's rows (a JWT route under the recommendation). Cast as in the feature file: Pat (the person), Sam (a collaborator in a shared book), an outsider with no membership, and the system user. Pat's drafts sit in the shared book (included in his daily reads), in a second book he belongs to with daily reads switched off, and in his personal book, deposited by at least two of his keys.

**Baselines** at `30e4efe`, taken from the slice 2 records and the source (not re-measured by this agent; the verifier re-measures): remote `tools/list` 16,854 bytes (cap 17,000); stdio 13,064 (cap 13,670); shared description total 5,965 characters (cap 6,000, per the dated comment in `mcp-tool-descriptions.test.ts`), per-description cap 420; the `searchQuery` description 412 characters; the unverified draft label (`draftLabel` in `packages/domain/src/drafts.ts`) 100 characters.

**Carried in from slice 2** (done first, each as its own commit)

| # | Criterion | Evidence the verifier looks for |
|---|---|---|
| S3-F1 | Honest refusal where the key can already read. `verify_draft` and `POST /recipes/:id/verify` answer "not a draft" for a published recipe the key can read, and a refusal that names the way forward ("needs write access to this recipe book": a key or membership that can write there; recipe `50824e4d`) for the key's own draft in a book outside its write scope. Nothing is stored in either case. Everything the key cannot read keeps the uniform answer (recipe `507d3c9c`). | Layer 3 tests on MCP, REST, and stdio: (a) Pat's draft with a key that reads but cannot write its book gets the specific refusal and the draft stays unverified; (b) a published recipe the key reads gets "not a draft"; (c) Sam's draft, a random UUID, and an 8-character prefix of a hidden draft still get byte-identical uniform answers. The slice 2 uniform-response pairs pass unchanged. |
| S3-F2 | F84: the seam guard matches statements as a whole rather than line by line, and covers the remaining forms the private finding names, `embedding_chunks` included. | `authz/seam-guard.test.ts` gains one plant per newly covered form, each failing the guard; the verifier re-runs the slice 2 plants. This log records only that F84 is closed. |
| S3-F3 | The suspected flaky `oauth-flow.test.ts` "legacy epoch-stamped consumed rows" is filed in `docs/backlog.md` as an `[IMPL]` item naming the suspected cause (the OAuth service's purge of long-dead rows running between write and read), unless the implementer confirms and fixes it in its own commit with a test that pins the cause. | The backlog diff, or the fix commit and a test that fails before it. |

**Where it lives**

| # | Criterion | Evidence |
|---|---|---|
| S3-M1 | "An unresolved draft about this viewer" is expressed once, in `authz/draft-sql.ts` (`draftAwaitingReviewBy`, or a sibling defined there). `is:draft`, the listing route, and the dashboard count compose it together with the module's book-scope and visibility fragments. No file outside the module compares `draft_state`. | `draft-sql.test.ts`'s "no file but authz/draft-sql.ts compares or tests draft_state in SQL" passes; code review of each new statement. |
| S3-M2 | Every new statement that reads `traces` (the listing, the id-list resolution, the rating filters, the dashboard count) is registered in the seam guard's recipe register as composing. | `npm run check:authz-seam` passes; the verifier deletes the draft fragment from the listing statement in a scratch copy and shows the guard fail. |
| S3-M3 | Ratings stay out of ranking. `ranking-isolation.test.ts` passes with its file list and patterns unchanged (its diff, if any, only adds files or terms). The rating filters and the triage order are built outside the five ranking files and reach them, if at all, as opaque predicate fragments, the way the authz fragments do (open question 23). `ranking-regression.test.ts` is unchanged and passes. | Test diff; code review; gate output. |
| S3-M4 | One grammar. The queue's search box, `search_recipes`, and `/check?filter=` all parse with `packages/domain/src/search-query.ts`; the new qualifiers are entries in its allowlist, and its unknown-qualifier error lists them. No second parser or query syntax in the frontend or the listing route (the operator's "general, concise changes", recipe `ded7f5ed`; grammar ruling `da986c40`). | Code review; the Layer 1 tests below. |

**Grammar**

| # | Criterion | Evidence |
|---|---|---|
| S3-G1 | `is:draft` selects the viewer's own unresolved drafts (about the viewer; in slice 3 the subject and the depositor are the same person) within the surface's scope. The qualifier name is case-insensitive like the others. Any other value (`is:drafts`, `is:published`) and a bare `is:` are errors that name the valid value. | Layer 1 cases in `search-query.test.ts`; Layer 3 test that Pat's `is:draft` returns exactly his unresolved drafts in the key's scope. |
| S3-G2 | `-is:draft` excludes the viewer's unresolved drafts; for a viewer with none it changes nothing. | Layer 3: Pat's own-agent search with and without `-is:draft`. |
| S3-G3 | `is:draft` replaces `search_recipes`' exclude-own default, as any `author:` qualifier does (recipe `303e17cf`); otherwise it would always return nothing, since every draft a viewer can list is their own. Without `is:draft` or `author:`, the default is unchanged. `/check?filter=` keeps its include-everything default. | Layer 3 on MCP (remote and stdio) and `/check?filter=`. |
| S3-G4 | `impact:` and `uncertainty:` take `low`, `medium`, or `high` (case-insensitive) and match any recipe the viewer can read whose stored rating equals the value. Unrated recipes never match a positive rating qualifier (DT-QUE-03). Negation (`-impact:low`) excludes recipes with that rating and keeps unrated ones. A repeated positive rating qualifier and an unknown value are errors naming the vocabulary: a query is not a deposit, so the check path's lenient storage does not apply. | Layer 1 parse cases; Layer 3 over a fixture with every rating combination plus unrated rows. |
| S3-G5 | Secure by default, as for the existing qualifiers (recipe `446bac9f`): values bind as parameters, qualifier structure selects among fixed predicate shapes, and the adversarial test file gains injection-shaped values for the new qualifiers, which parse inert or fail loudly. | The adversarial Layer 1 file's diff. |
| S3-G6 | The new qualifiers compose with the existing grammar: `is:draft impact:high after:2026-09-01 "cache"` applies all four. | One Layer 3 combination test. |
| S3-G7 | With semantic text, a rating qualifier only removes rows: on the flat listing (the queue's path) the remaining results keep the same order and similarities; on clustered agent surfaces the qualifier filters before exemplar selection, so similarities are unchanged and the exemplars chosen may change. (Amended 2026-09-27 by the orchestrator's slice 3 fix-pass rulings, accepting the verifier's proposal.) | Layer 3: the same semantic query with and without `impact:high` returns, on the flat listing, the matching subsequence of the unqualified results in the same relative order and with the same similarities. |

**What the queue shows, and to whom**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S3-Q1 | `/app/drafts` (signed in, verified email) lists every unresolved draft about the signed-in person in every book they can currently read, whatever their daily-read and daily-write settings and whichever of their keys deposited it (open question 21). | DT-QUE-01 | Layer 3 on the listing route; browser: the drafts in the book with daily reads off and in the personal book are listed. |
| S3-Q2 | Nothing else: no draft about anyone else, no published or verified recipe, no rejected or not-chosen draft, no draft in a book the person has since left. | DT-QUE-01 | Layer 3 fixture covering each exclusion. |
| S3-Q3 | One figure. The queue's total equals the dashboard entry's count and the briefing's Drafts line for a key whose read scope covers the same books. | | Layer 3 comparing the three for the same person. |
| S3-Q4 | Each item shows the recipe text, its book, the agent's ratings (worded as the agent's, "not rated" when unrated, as on the detail page), when it was deposited, the depositing key's label, the first evidence interpretation without opening the detail page, a link to the detail page, and the three actions. | DT-QUE-05 | Browser; frontend unit test of the item. |
| S3-Q5 | A full list: no clustering, MMR, or verbosity collapse. It pages with an honest total, and every draft is reachable exactly once across pages. | | Layer 3 with 45 drafts: the union of all pages is the 45 ids, no duplicates. |
| S3-Q6 | The page's search box takes the same grammar and always applies `is:draft`, so the person narrows the queue ("I search my drafts with `impact:high`", design-thinking §Reviewing drafts) but cannot turn the page into a general search. An invalid query shows the parser's error text and keeps the last good list. | DT-QUE-03 | Browser; Layer 3 for the route's error response. |
| S3-Q7 | Empty state: a line saying no drafts await review, with no actions; the control is the same page with one draft. | | Browser. |
| S3-Q8 | The dashboard shows a tier-1 entry ("N drafts await your review", linking to `/app/drafts`) when N > 0 and nothing when N = 0 (design-thinking §Dashboard as a Feed, "drafts waiting for my review"). | | Browser; frontend test. |

**Ordering**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S3-O1 | With no semantic text, the queue sorts by triage score, impact × uncertainty with low 1, medium 2, high 3, and an unrated rating counted as medium (an unrated draft scores 4). Ties go to the higher impact, then to the most recently deposited (`created_at`), then to the id, so the order is total. For the feature file's cast this gives (high, high), not rated, (high, low), (low, high) (open question 22). | DT-QUE-02 (as edited by the ruling) | Layer 1 test of the comparator over all 16 combinations; Layer 3 test of the listed order. |
| S3-O2 | With semantic text, the order is the pipeline's (S3-G7); the triage score applies only to the qualifier-only listing. | | Layer 3. |
| S3-O3 | The order is display only. The same drafts, once verified, rank identically whatever their ratings; DT-RAT-06 and DT-RAT-07 still pass. | DT-RAT-07 | The slice 1 tests, unchanged and passing. |

**Actions**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S3-A1 | Confirm writes the `still_true` reaction and verifies; reject writes `wrong` and rejects, through the existing reaction route, recording the reaction row as today. Not chosen is one new JWT operation that writes `not_chosen` through `resolveDraft` (its resolution type widened) and writes no reaction row; the reaction vocabulary is unchanged (the ruling on open question 6: "Not chosen is a queue action, not a fourth reaction"). | DT-QUE-06 | Layer 3 per action: resulting `draft_state`, resolver columns, and `trace_reactions` rows. |
| S3-A2 | Each action needs the slice 2 write authority on the draft's book, checked inside the resolving statement, and only the draft's subject may resolve it. Resolution is one-way; repeating an action is a no-op reported as already resolved. | | Layer 3, including a removal between listing and acting (every membership role can write, so removal is the reachable loss of authority). (Amended 2026-09-27 by the orchestrator's slice 3 fix-pass rulings, accepting the verifier's proposal.) |
| S3-A3 | For anyone but the subject (Sam, the book owner, the outsider, the system user) and for a missing id, the not-chosen operation returns the same 404 as a random UUID and writes nothing. | DT-VER-07 | Uniform-response pairs below. |
| S3-A4 | A subject without write authority on the draft's book sees the draft via the id-list link with the actions unavailable and a reason naming the book; the routes give the subject an honest refusal (open question 25). Everyone else still gets the uniform 404. | | Layer 3 for the refusal; browser for the disabled state. (Amended 2026-09-27 by the orchestrator's slice 3 fix-pass rulings, accepting the verifier's proposal.) |
| S3-A5 | After an action the item leaves the list without a full reload, focus moves to the next item (or the heading when the list empties), and the totals and dashboard count update; a reload shows the same state. A confirmed draft then appears in Sam's agent's search results. | DT-QUE-06, DT-VER-01 | Browser; Layer 3 for Sam's search. |
| S3-A6 | Not chosen writes an audit-log entry in the shape of the reaction resolution's (`metadata.via`), and the not-chosen draft behaves as slice 2 defined: hidden from collaborators, out of the person's own results, readable by id with the "[draft not chosen]" label. | | Layer 3. |
| S3-A7 | No agent gains a reject or not-chosen affordance in this slice: no new MCP tool or parameter, and `verify_draft` changes only as S3-F1 says. Agent resolution of option sets is slice 6. | | `tools/list` diff shows no new tool or property beyond the description edits. |

**The id-list link**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S3-L1 | `/app/drafts?ids=<a>,<b>,…` lists exactly the named recipes the person may read, in the order given, deduplicated, at most 20 (the `/recipes` batch size). Full UUIDs and prefixes of 8 or more characters both resolve, prefixes within the person's readable scope only (recipe `507d3c9c`). | DT-QUE-04 | Layer 3 on the listing route's id form; browser. |
| S3-L2 | Ids the person cannot read, random ids, and malformed ids are omitted. At most one note says how many could not be shown, worded identically whatever the reason, so a hidden draft's id and a random UUID produce the same page. | DT-QUE-04 | Layer 3: the response for Sam's draft id equals that for a random UUID after replacing the id; browser screenshot pair. |
| S3-L3 | A named recipe the person can read that is not an unresolved draft (published, verified, rejected, not chosen) is shown with its state and no actions. | | Layer 3; browser. |
| S3-L4 | More than 20 ids: the first 20 are shown, with a note. | | Layer 3. |
| S3-L5 | A signed-out person who opens the link returns to the same `/app/drafts?ids=…` after signing in. Only same-origin paths under `/app/` are honoured as a return target; an absolute, protocol-relative, or other-path target is ignored (no open redirect). | | Browser; frontend unit test of the return-target check. |
| S3-L6 | The draft deposit notice, for a new draft and for an identical repeat of an unresolved one, gives the queue link for that recipe (`<FRONTEND_URL>/app/drafts?ids=<full id>`) in place of "on the recipe's page", so the agent learns the link where it needs it (open question 26). | | Layer 1 test of `draftDepositNotice`; Layer 3 on MCP and `/check`. |

**Agent side**

| # | Criterion | Evidence |
|---|---|---|
| S3-AG1 | No new tool or parameter. The new qualifiers work on remote `search_recipes`, the stdio `search_recipes`, and `/check?filter=` (JSON and HTML). | Layer 3 per surface; stdio `server.test.ts`. |
| S3-AG2 | A result row that carries a `draftState` (only ever the viewer's own) also carries its `impact` and `uncertainty` in JSON and structured form, `null` when unrated. In markdown the draft label gains the ratings only when at least one is set; an unrated draft's label is unchanged (the DT-RAT-02 ruling: silence when unrated). Rows without a `draftState` carry no ratings, as in slices 1 and 2. The published `/schemas/*.json` describe the new fields. | Layer 3; `schemas.test.ts`; renderer unit tests. |
| S3-AG3 | A collaborator with no drafts (Mo) gets an identical `is:draft` search (MCP both formats, `/check?filter=` JSON and HTML) before and after Pat's drafts land in their shared book: zero results, the same zero-result text, and the same in-scope count. (Amended 2026-09-27 by the orchestrator's slice 3 fix-pass rulings, accepting the verifier's proposal.) | Byte comparison after replacing volatile ids (session, search id). |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S3-Z1 | Remote `tools/list` stays at or under **17,000** bytes and stdio at or under **13,670**, with neither cap raised. Expected growth is under 20 bytes, since only the `search_recipes` query description changes. | `mcp-tools-list-size.test.ts` and `server.test.ts`; the verifier records both exact numbers. |
| S3-Z2 | The shared description total stays at or under **6,000** characters without a raise, and `searchQuery` at or under **420**. It names the new qualifiers; the unknown-qualifier error lists every valid qualifier and value, so the description can stay terse. | `mcp-tool-descriptions.test.ts` passes with its caps untouched; the verifier records the new total and the `searchQuery` length. |
| S3-Z3 | The deposit notice grows by at most the queue URL plus 20 characters. | Layer 1 length assertion. |
| S3-Z4 | Markdown ratings on a draft label add at most **40 bytes** per rated draft and **0** for an unrated draft or any non-draft row. | Renderer unit test measuring the label with every rating combination. |
| S3-Z5 | `/briefing` output is unchanged, unless the implementer adds a queue pointer to the Drafts line; then it is at most **80 bytes**, appears only for an agent whose person has drafts, and is declared. | Byte comparison of a briefing for a person with drafts and one without, before and after. |

**Accessibility and phone width** (checked in the browser verification run)

| # | Criterion | Evidence |
|---|---|---|
| S3-UI1 | axe finds zero serious or critical violations on the queue populated, empty, opened from an id-list link, and in the no-write-authority state, and on the dashboard with its drafts entry. Moderate ones are listed. | axe JSON per page. |
| S3-UI2 | Keyboard only: every item's link and actions are reachable by Tab in reading order with visible focus, and each action's accessible name says what it does to which draft (for example "Confirm draft: As a backend maintainer…"), so a screen-reader user can tell ten "Confirm" buttons apart. | Browser keyboard pass; accessible-name assertions. |
| S3-UI3 | The outcome of an action and any error are announced (a status or alert live region), and ratings are text, not colour alone. | Browser; code review. |
| S3-UI4 | At 412 px: no horizontal scroll on the queue or the dashboard (`scrollWidth <= clientWidth`); long recipe text, URLs, and citations wrap; each action is at least 24 × 24 CSS pixels (WCAG 2.2 target size, minimum). | Browser, mobile project. |

**Uniform responses.** For Sam, the outsider, and (JWT routes) the system user, compare status and body against a random UUID, after replacing the id and its 8-character prefix: the not-chosen operation; the existing reaction routes on an unresolved draft (unchanged from slice 2); the listing route's id form (S3-L2); `verify_draft` and `POST /recipes/:id/verify` after S3-F1, for everything the caller cannot read. For `is:draft`, compare Sam's response against a member's with no drafts (S3-AG3).

**Surfaces that must change:** `packages/domain` (`search-query.ts` and its tests including the adversarial file, the `searchQuery` description, `draftDepositNotice`, the draft label renderer); the authz module (a fragment in `draft-sql.ts` if `draftAwaitingReviewBy` does not fit, `draft-resolution.ts` for `not_chosen`, the seam register); a rating-filter fragment outside the ranking files; the search path in `trace.service.ts`; the listing route (JWT, under the recommendation); a not-chosen operation in `routes/traces.ts`; `verify_draft` and `POST /recipes/:id/verify` for S3-F1; `packages/contracts` and the published schemas for ratings on own-draft rows; the frontend (a queue page and route, the dashboard entry, the sign-in return target); the read-path inventory (new rows for the listing route, its id form, the not-chosen operation, and the dashboard count); the feature file (DT-QUE scenarios edited per the rulings and moved out of `@unreleased`); the grammar table in `recipe-search-design.md` and the grammar sentence in `CLAUDE.md`.

**Surfaces that must NOT change:** the five ranking files' independence from ratings and draft state (S3-M3) and `ranking-regression.test.ts`; the idempotency key; the reaction vocabulary and the meaning of reaction counts (published recipes only); slice 2 visibility on every other surface (`routes/drafts.test.ts` passes unchanged apart from S3-F1's intended changes); the exclude-own default for queries without `is:draft` or `author:`; the map; `CheckRecipePage` (under the recommendation for question 21); the `api_keys` schema; the MCP tool roster (no new tool or parameter).

**Security properties the verifier must see proven**

- The queue is not a way to enumerate or read another person's drafts: the listing composes the subject fragment (S3-M1); the id form omits unreadable ids with a reason-free note (S3-L2); prefixes resolve within the person's scope; `is:draft` for a collaborator is indistinguishable from having no drafts (S3-AG3).
- Resolution keeps slice 2's rule: write authority at that moment, subject only, one-way, and a uniform 404 for everyone else (S3-A2, S3-A3). The honest refusals (S3-F1, S3-A4) are given only to a caller who can already read the recipe.
- Ratings reach no result row but the viewer's own drafts (S3-AG2), and never reach ranking (S3-M3).
- The sign-in return target cannot redirect off the app (S3-L5), and an id list cannot make the server resolve more than 20 ids.
- The audit role's findings are recorded in the private repo; this log records only that the audit happened and whether blocking findings were closed.

**Briefing-copy declaration.** The `searchQuery` description, the unknown-qualifier error text, the deposit notice, and the draft label's ratings are agent-facing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The slice 3 PR appends a `spec-decision-log.md` entry that declares a new `@unreleased` scenario (a briefed agent that has deposited drafts hands its human the queue link for them rather than listing ids in prose), names any watched scenarios with a rationale, and records the bytes before and after for `tools/list`, the shared descriptions, and the notice.

### Slice 3 verification record

Written 2026-09-27 by the functional verifier (agent `a-drafts-verify-s3-2026-09-27`, Soup.net intent `int_1OMwBzYblR3eIWTgcWx6d3xC`), who did not build the slice and changed no application code. Verified at code tip `09d122b` (branch tip `a8e7a1e`) in a throwaway detached worktree after `npm ci` and `npm run build:packages`. Verdicts were formed from the verifier's own probes before the builder's commits and build notes were read; the notes were then checked against that evidence (see "Builder's flagged rows" below).

**Verdict: accepted with minor follow-ups.** 44 rows pass, 2 are partial (S3-L1, and S3-Q5 by an edge the row does not name), 0 fail; the 4 accessibility rows and the browser halves of S3-Q4, Q6 to Q8, A5, and L5 belong to the separate browser verification run and are not judged here.

**How it was verified.**

- **Gate:** `TESTCI_PGPORT=5624 npm run test:ci`, one run, **exit code 0**: 118 test files passed and 3 skipped, 1,654 tests passed and 10 skipped; the golden-set ranking eval reported "All 9 thresholds green."
- **Targeted re-run** against the verifier's own stack (below): the 15 files that carry this slice's criteria (`routes/draft-queue.test.ts`, `routes/drafts.test.ts`, `authz/seam-guard.test.ts`, `authz/draft-sql.test.ts`, `ranking-isolation.test.ts`, `ranking-regression.test.ts`, `search-query.test.ts`, `triage-ratings.test.ts`, `drafts.test.ts`, the frontend `return-target.test.ts` and `draft-queue.test.ts`, the stdio `server.test.ts`, `mcp-tools-list-size.test.ts`, `mcp-tool-descriptions.test.ts`, `schemas.test.ts`): 354 tests passed, none skipped.
- **Independent probe:** a script of the verifier's own (94 assertions) against the built backend on a throwaway stack (compose project `soupnet-ci-5624`, backend on a spare port with the test-ci environment, stub embeddings), torn down afterwards. Cast: Pat; Sam (owner of the shared, quiet, and left books); Mo and Cal (shared-book members with no drafts); Olive (outsider); the system user. Pat deposited through three keys (A: all his books; B: shared and quiet; RO: reads shared, quiet, and personal, writes only personal), with daily reads switched off for the quiet book, and was then removed from the left book. Remote MCP, `/check?filter=` (JSON and HTML), `/check` deposits, and the stdio server (`createStdioServer` over an in-memory transport, with real `fetch` to the stack) were all exercised. Two follow-up probes measured S3-G7 (below).
- **Code review** of the slice's diff (`30e4efe..09d122b`), plus seam-guard mutations in the throwaway tree (reverted).

**Carried in**

| # | Verdict | Evidence |
|---|---|---|
| S3-F1 | pass | Pat's draft in the shared book through key RO (reads, cannot write): MCP and stdio `verify_draft` answer "…needs write access to this recipe book…" naming the book and the queue link; REST answers 403 `needs_write_access`; the draft stays `unverified` and its evidence count is unchanged. A published recipe the key reads: "not a draft" (MCP) and 409 (REST). Sam's draft, a random UUID, an 8-character prefix of Sam's hidden draft, a random 8-character prefix, and an outsider's published recipe: one byte-identical answer per surface after replacing the id (MCP 1 variant, REST 1 variant (404), stdio 1 variant). |
| S3-F2 | pass | `seam-guard.test.ts` (slice 2 plants plus seven F84 forms and the two split-name cases) passed in the gate and in the targeted run; F84 is closed. |
| S3-F3 | pass | `docs/backlog.md` gains the `[IMPL]` item naming the purge in `maybeCleanupOAuthArtifacts` as the suspected cause. |

**Where it lives**

| # | Verdict | Evidence |
|---|---|---|
| S3-M1 | pass | The queue listing, the dashboard count, and `is:draft` all compose `draftAwaitingReviewBy`; no new file compares `draft_state` (remaining mentions outside `authz/` are pre-slice select lists); `draft-sql.test.ts` passes. |
| S3-M2 | pass | `check:authz-seam` passes unmodified (29 registered files, 8 composing). Deleting the draft fragment from the listing statement, from the count statement, or the by-id rule from the item loader each made the guard fail, naming `draft-queue.service.ts`. The id-list resolution statement lives inside `authz/trace-access.ts`. |
| S3-M3 | pass | `ranking-isolation.test.ts` and `ranking-regression.test.ts` have no diff in `30e4efe..09d122b` and pass. `vector-search.service.ts` gains only an opaque `selections` hook that names no rating or draft column; the predicates and `triageOrderSql` live in `services/search-selection.ts`. Ranking eval green. |
| S3-M4 | pass | One parser: the queue route, `search_recipes`, and `/check?filter=` all call `parseSearchQuery`; the new qualifiers are allowlist entries and the unknown-qualifier error lists them. |

**Grammar**

| # | Verdict | Evidence |
|---|---|---|
| S3-G1 | pass | `is:draft` through `/check?filter=` with key A, paged flat, returns exactly Pat's 45 unresolved drafts in its scope; key B returns exactly the 10 in shared and quiet, from both keys. `IS:DRAFT` works. `is:drafts`, `is:published`, and a bare `is:` are errors naming `is:draft` on the queue, MCP, `/check`, and stdio. |
| S3-G2 | pass | `-is:draft author:anyone` drops every one of Pat's unresolved drafts and keeps his published recipe; for Mo, with no drafts, `-is:draft` returns the same ids as the plain query. |
| S3-G3 | pass | `is:draft` lifts the exclude-own default on remote MCP and stdio; without it or `author:`, Pat's own recipes stay excluded on both. `/check?filter=` still lists Pat's own draft without any qualifier. |
| S3-G4 | pass | Over published recipes rated high, rated low, and unrated: `impact:high` matches rated-high only (never unrated, never a hidden draft); `-impact:low` keeps unrated and high; `-impact:high` drops high and keeps unrated; `uncertainty:LOW` is case-insensitive. A repeated positive qualifier and `extreme`, `'high'`, `high,low`, a homoglyph `hіgh`, and a 5,000-character value are errors naming the vocabulary. |
| S3-G5 | pass | Injection-shaped values (quotes, `;DROP TABLE …--`, `)`, percent-encoding, `<script>`) fail with the parser's message on every surface; the `/check` HTML error escapes them; the table was intact afterwards. The adversarial Layer 1 cases passed. |
| S3-G6 | pass | `is:draft impact:high after:2026-01-01 "shared hh"` on the queue returns exactly the one matching draft; `after:2099-01-01` empties it. |
| S3-G7 | pass, wording to amend | On the flat semantic listing (the queue's path), three queries × `impact:high`, `-impact:low`, `uncertainty:low` over 44 drafts each gave an exact order-preserving subsequence. On agent surfaces the automatic verbosity collapse always clusters, and a qualifier filters before exemplar selection, so the displayed exemplars and their cluster order change while every similarity stays identical (measured, 40 recipes, `/check` JSON with `clusters=100` and MCP `high`/default). That is the same filter-before-selection behavior as `author:` and `after:`, and it is not a ranking input (S3-M3). Recipe `a428352c`. |

**What the queue shows, and to whom**

| # | Verdict | Evidence |
|---|---|---|
| S3-Q1 | pass (Layer 3) | The listing holds all 11 unresolved drafts: shared (keys A and B), quiet (daily reads off), and personal. No duplicates. |
| S3-Q2 | pass | Absent: Sam's drafts (shared and personal), Pat's published recipe, his rejected and not-chosen drafts, and his draft in the book he was removed from. Olive's queue is empty. |
| S3-Q3 | pass | Queue total 11 = `/traces/drafts/count` 11 = the Drafts lines of remote MCP `get_briefing` 11 = stdio `get_briefing` 11 (key A after the removal covers the same books). REST `/briefing` without the stdio header is the full profile, which has no per-book Index by design. |
| S3-Q4 | pass (Layer 3) | Item carries text, book, `impact`/`uncertainty` (null when unrated), deposit time, key label, the first evidence interpretation, state, and `canResolve`. Rendering belongs to the browser run. |
| S3-Q5 | partial (out-of-rubric edge) | 45 drafts: total 45, three pages of 20/20/5, a fourth page empty, union exactly 45 ids with no duplicates, and the order across pages equals `compareForTriage`. Pages 0, -1, `abc`, 2.7, and 1e9 are handled; a page number past the bigint range (`99999999999999999999`, `1e308`) answers 500 from the qualifier-only listing's OFFSET. Follow-up: clamp the page. |
| S3-Q6 | pass (Layer 3) | `q=impact:high` narrows to high-impact drafts; `author:<Sam>` gives 0 and `author:anyone` still only Pat's; `-is:draft` is a 400 naming the page's rule; every invalid query is a 400 carrying the parser's message. The frontend fetches before navigating, so a bad query keeps the last list (code review; browser run). |
| S3-Q7 | pass (code, unit) | A member with no drafts gets count 0 and an empty list; the page's empty state renders no actions. |
| S3-Q8 | pass (code, unit) | `dashboardDraftsEntry` returns nothing for 0; the dashboard entry links to `/app/drafts`. |

**Ordering**

| # | Verdict | Evidence |
|---|---|---|
| S3-O1 | pass | The feature file's cast lists as (high, high), not rated, (high, low), (low, high); the whole 11- and 45-draft listings equal a sort by the domain comparator; `order` is `triage`. |
| S3-O2 | pass | Semantic text gives `order: similarity`, still drafts only. |
| S3-O3 | pass | DT-RAT-06/07 tests unchanged and passing; ranking eval green. |

**Actions**

| # | Verdict | Evidence |
|---|---|---|
| S3-A1 | pass | Confirm: `verified`, resolver Pat, no key, one reaction row. Reject: `rejected` plus a reaction row. Not chosen: `not_chosen`, resolver Pat, no reaction row. |
| S3-A2 | pass | A repeat confirm reports `alreadyResolved`; a repeat not chosen, and not chosen on a rejected draft, answer 409 `already_resolved`; confirm on a not-chosen draft leaves it not chosen. 18 concurrent confirm/reject/not-chosen requests on one draft: exactly one resolution won, no 5xx, one resolution audit row; 10 concurrent not-chosen: one 200, nine 409, one audit row. Authority is checked at action time: a draft listed, then its book membership removed, then confirmed, is refused. A role change cannot be staged (see below). |
| S3-A3 | pass | For Sam (the book owner), Mo, Olive, and the system user, not chosen and the reaction route on Pat's draft answer byte-for-byte what a random UUID, an 8-character prefix, and a malformed id get (404 "Trace not found"); nothing is written. An outsider on a published recipe she cannot read gets the same 404; a reader gets 409 "not a draft". |
| S3-A4 | pass | After removal from the book, Pat's confirm and not chosen answer 403 `needs_write_access` naming the book, nothing written; Sam still gets the uniform 404 on that draft; the id-list shows it with `canResolve: false` and a reason naming the book. |
| S3-A5 | pass (Layer 3) | The confirmed draft appears, unlabelled and without ratings, in Sam's agent search. List update, focus, and count refresh are in the page's code (the browser run judges them). |
| S3-A6 | pass | Audit rows `recipe.draft_not_chosen` `{via: "queue"}` beside `recipe.draft_rejected` `{via: "reaction", …}`; the not-chosen draft reads by id for Pat with "[draft not chosen]", is out of his results, and Sam's `get_recipes` for it equals a random id's. |
| S3-A7 | pass | Served tools and their properties are the pre-slice set (no new tool or parameter on remote or stdio); only descriptions changed. |

**The id-list link**

| # | Verdict | Evidence |
|---|---|---|
| S3-L1 | partial | Order kept (two drafts then two published recipes), repeats and upper-case copies collapse to one, 8- and 12-character prefixes resolve, a 7-character prefix does not. But a link naming the same readable recipe by prefix and by full id shows it once and still reports `notShown: 1`, so the page says a recipe "does not exist or you cannot see it" while it is on screen. Follow-up: count distinct resolved recipes, not references. |
| S3-L2 | pass | Sam's hidden draft, a random UUID, their 8-character prefixes, an outsider's recipe, a malformed id, and a one-character-off id all produce the identical body; Sam and the system user opening a link to Pat's draft get a random id's body; mixed links give one reason-free count. |
| S3-L3 | pass | Rejected, not chosen, verified, and published recipes are listed with their state and no actions. |
| S3-L4 | pass | 25 ids: the first 20 in order, `truncated: true`. 300 ids: 20 resolved, `truncated: true`, 26 ms. |
| S3-L5 | pass (unit) | `safeReturnTarget` rejects `//host`, backslash forms, absolute and `javascript:` URLs, `..` and `%2e%2e` escapes out of `/app/`, whitespace and control characters, full-width slashes, `/app` without a slash, `/apps/…`, and over-long values; it keeps `/app/drafts?ids=…`. The redirect uses TanStack's `location.href`, which is path-only. Real navigation is the browser run's. |
| S3-L6 | pass | MCP (structured and markdown) and `/check` deposits carry `<FRONTEND_URL>/app/drafts?ids=<full id>`; an identical repeat of an unresolved draft carries it too. |

**Agent side and budgets**

| # | Verdict | Evidence |
|---|---|---|
| S3-AG1 | pass | The qualifiers work on remote `search_recipes`, stdio `search_recipes`, and `/check?filter=` JSON and HTML (the HTML label reads "…; impact high, uncertainty low]"). |
| S3-AG2 | pass | Own-draft rows carry `impact`/`uncertainty` (null when unrated) in structured MCP, stdio, and `/check` JSON; published rows carry neither; the markdown label names ratings only when one is set. `/schemas/recipe.json` and `check-response.json` describe the fields. |
| S3-AG3 | pass | Mo's `is:draft` before and after Pat's drafts landed in the shared book, Sam's before he had a draft of his own, and Cal's are identical on MCP markdown, MCP structured, `/check` JSON, `/check` HTML, and stdio, after replacing search/session ids and the key echoed into the HTML form. |
| S3-Z1 | pass | Remote `tools/list` **16,853** bytes (cap 17,000); stdio **13,063** (cap 13,670). |
| S3-Z2 | pass | Shared descriptions **5,968** characters (cap 6,000); `searchQuery` **415** (cap 420). |
| S3-Z3 | pass | The notice grows by 60 characters with a 73-character URL, for a new draft and for a repeat. |
| S3-Z4 | pass | A rated label adds at most 38 bytes; unrated and non-draft labels add 0. |
| S3-Z5 | pass | No briefing source changed; no queue pointer on the Drafts line. |
| S3-UI1 to UI4 | not judged here | Browser verification run. The queue CSS sets `overflow-wrap: anywhere` and 32-pixel action targets. |

**Security properties.** Each is shown above: enumeration through the listing, the id form, prefixes, and `is:draft` (S3-M1, L2, AG3); resolution by write authority at that moment, subject only, one-way, uniform 404 for everyone else (A2, A3); honest refusals only to a caller who can already read (F1, A4); ratings only on the viewer's own draft rows and never in ranking (AG2, M3); no off-app return target and at most 20 ids resolved (L5, L4). The unverified-email account gets 403 `email_not_verified` on all three routes, no credential gets 401 on all three, and an API key presented to the listing gets 401. The security audit is a separate role; its findings go to the private repo.

**Builder's flagged rows** (build notes, interpretations 1, 5, 6, and 7). The verifier agrees with all four.

- **S3-A4 / S3-A2 role-change step:** there is no member-role route, and every role (owner, admin, member) is in `WRITE_ROLES`, so the only reachable loss of write authority is removal. Since S3-Q2 keeps a left book's drafts out of the queue, S3-A4's "sees the draft in the queue" can only mean the id-list view, which is what was verified. Amend S3-A4 to "through the id-list link" and S3-A2's step to "a removal between listing and acting".
- **E16 (long URL wrapping on the queue page):** citations are not on the queue page (only the first interpretation), so a citation URL cannot be the test there. The wrap still matters for a long unbroken URL inside the recipe text or the interpretation; retarget E16 to that rather than drop it.
- **S3-AG3's comparison actor:** with a draft of his own in the shared book, Sam's `is:draft` rightly lists it, so he is not a "member with no drafts". The stronger comparison is one collaborator before and after Pat's drafts land, which is what was verified; amend the row to that.
- **S3-G7 observability:** confirmed by measurement (above). Amend the row to "on the flat listing; on clustered surfaces the qualifier filters before exemplar selection and leaves similarities unchanged".

**Follow-ups** (none blocking): clamp the queue's `page` so an out-of-range number cannot reach SQL as an overflowing OFFSET (S3-Q5); count distinct resolved recipes for `notShown` (S3-L1); the four rubric wording amendments above. Informational: agent `search_recipes` shows clustered exemplars of `is:draft` (3 of 45 at the default verbosity, 10 at `high`) with no page parameter, so an agent cannot enumerate a large backlog there; `/check?filter=` pages, and the queue link is the intended hand-off.

### Slice 4 rubric: drafts on behalf of another person

Written 2026-09-27 by agent `a-drafts-rubric-s4-2026-09-27`, before implementation, from the design, the slice 1 to 3 records and rulings, and the code at `0949691`. Consumer: agent (the new `on_behalf_of` check parameter, the labels and notices that name the other party, the depositor's refusals) and human (the subject's review queue and detail page, the depositor's detail page and delete). Security-relevant: yes. The slice lets one person's agent write a hypothesis about another person, adds a lookup of a person by email inside a write path, and adds a second viewer (the depositor) to every draft rule, so the security workflow applies in full: a read-only audit by an agent other than the builder and the verifier, findings in the private repo, and a recipe check on each security decision. The UI changes are small but real, so the slice also gets a browser verification run with expectations drafted from this rubric.

Settled before this rubric (not reopened here): the author is always the owner of the depositing key and "on behalf of" is a separate subject (ruling 16, recipe `9e663b62`: "We always have an author, the person who made the API key that the agent is using. Accountability by design."); an unresolved draft is visible to the person it is about and to the person whose agent deposited it (recipe `94e0e682`); on behalf of someone else always implies draft ("Two server rules follow. \"On behalf of\" someone else always implies draft.", [drafts-and-triage.md](drafts-and-triage.md) §The model); who may be named is limited to people with write access to the target book, and the verified-org-domain case waits for organization accounts (§Slices, item 4); `is:draft` means "unresolved drafts about me" and a depositor finds their deposits with `author:me` (ruling 24); only the subject verifies or resolves, under slice 2's write-authority rule. Two later operator rulings amend the rubric (2026-09-27, rows and questions marked "amended"): **ownership moves at verification** (recipe `b89db1f0`: "I think once the person verifies it, they own it. It's about them after all. But do we change the author? yes, I think we even do that. We still need a log somewhere of who deposited it of course though. Is that a schema cchange? I'd like to avoid that if feasible."), so the author is the depositor until the subject verifies and the subject from then on, with the depositor kept in the append-only audit trail; and **account deletion deletes only what the person owns and never adds anyone to a book** (recipe `23657e4e`, `fix/account-delete-former-coauthors` at `770628b`: "What's wrong with just leaving the book hanging with no owner?... a dev would have to step in, we don't have to cover all of them."). Depends on the rulings for open questions 28 to 40 below; the rubric states the recommended behavior, and where a ruling differs the criterion is edited before the code.

Terms: the **subject** is the person a draft is about; the **depositor** is the owner of the key that deposited it, who is the author (`traces.user_id`) until the subject verifies the draft and is recorded afterwards only in the audit trail (amended, `b89db1f0`). An **on-behalf draft** is one whose subject is not its depositor. Cast, extending the feature file's: Pat (the subject), Dana (the depositor), Sam (a member of the shared book with neither role), Olive (an outsider with no membership), and the system user. Keys: Pat's key P and Dana's key D both read and write the shared book; Pat's key P2 and Dana's key D2 have no scope on it.

**Baselines**, measured by this agent at `0949691` with the slice 1 method (`createMcpServer` with a stub principal, and `createStdioServer`, each over the SDK in-memory transport, `initialize` then `tools/list`, the reply's `result` as minified UTF-8 JSON; description lengths from the `@soupnet/domain` constants as built):

| Measure | Value | Cap | Headroom |
|---|---|---|---|
| Remote `tools/list` | 16,853 bytes (8 tools) | 17,000 (`mcp-tools-list-size.test.ts`) | 147 bytes |
| Stdio `tools/list` | 13,063 bytes (6 tools) | 13,670 (`server.test.ts`) | 607 bytes |
| Shared descriptions (`MCP_TOOL_DESCRIPTIONS` + `MCP_PARAM_DESCRIPTIONS`) | 5,968 characters | 6,000 (`mcp-tool-descriptions.test.ts`) | 32 characters |
| `check_recipe` description as served | remote 506 characters, stdio 402 | | |
| `check_recipe` tool as served | remote 6,227 bytes (schema 5,495), stdio 4,436 | | |
| `draft` property on `check_recipe` as served | 206 bytes; its description 171 characters | per-description 420 | |
| Unverified draft label (`draftLabel`) | 100 characters, at most 38 more with ratings (slice 3 record) | | |

The headroom is the point of the table: the remote roster can take one new property of about 130 bytes before its cap, and the shared descriptions cannot take a new line of any useful length without a trim or a raise (open question 38).

**Carried in** (done first, as its own commit)

| # | Criterion | Evidence the verifier looks for |
|---|---|---|
| S4-F1 | The backlog item "Recipe-read guard register: harden against the F86 residual forms" is closed before the slice adds its own statements, so every new read of the recipe tables lands under the hardened guard: one `seam-guard.test.ts` plant per form the private finding names, each failing the guard. If the implementer judges it separable, it may stay a backlog item, and the verifier then plants each new slice 4 statement's draft fragment deletion by hand (S4-M6). | The guard diff and the plants, or the backlog item left open with the verifier's hand plants recorded. This log records only whether F86 is closed. |

The other slice 3 follow-ups were closed in the fix pass (`2feb9b7`, `8c3ed74`); the workspace-expiry flake and the OAuth flake are unrelated to this slice and stay in the backlog. Browser (Layer 4) items from slices 1 to 3 stay on the operator's handoff list.

**Where it lives**

| # | Criterion | Evidence |
|---|---|---|
| S4-M1 | Who may be named is decided once, in `apps/backend/src/authz/`: one function takes the email and the target book and returns the subject's user id or nothing, from one statement that matches `lower(email)` and composes the module's membership fragment (`membershipOf`), `WRITE_ROLES`, and the account-state predicate key authentication uses (`activeUserPredicate`), so "may be named" is exactly "could resolve it now" (open question 28). No file outside the module reads `group_members` for it; `check:authz-seam` enforces that as it does today. | Code review; a Layer 1 or module test over each case: a live writer, a member of another book only, no membership, no account, a waitlisted or unverified account, a mixed-case and padded email. |
| S4-M2 | (Amended, `b89db1f0`.) The visibility fragments read the subject through one function. `subjectOf` in `authz/draft-sql.ts` returns the subject column where it is set and the author otherwise (`COALESCE(subject, user_id)`: NULL means the recipe is about its author), and `depositorOf` stays `user_id`, which is the depositor for as long as the draft is unpublished. That is the one-function change the slice 2 notes promised ("slice 4 changes `subjectOf` in `draft-sql.ts` and nothing else"). `fetchAccess` and `readableTraceIds` in `trace-access.ts` read `isDraftSubject` and `isDraftDepositor` through the same two functions. | `draft-sql.test.ts` gains the fact dimension "subject is not the depositor" and still proves the SQL fragments equal `mayReadTrace` on every combination (viewer is subject only, depositor only, both, neither; every draft state; member or not). |
| S4-M3 | `draftStateShownTo` (the [F83] rule) shows the subject every state, the depositor the unpublished states (`unverified`, `rejected`, `not_chosen`) of what they deposited, and everyone else nothing; a verified on-behalf recipe reads as an ordinary recipe to the depositor as to everyone but the subject (open question 31). Resolution details (who, when, which key) stay the subject's alone. | Unit test of the fragment over the viewer and state combinations; Layer 3 on `GET /traces/:id` and `GET /traces?groupId=` for Dana. |
| S4-M4 | (Amended, `b89db1f0`.) `resolveDraft` still resolves by `subjectOf`, so a depositor who is not the subject matches no row whatever the caller asked first. Verification moves ownership in the same UPDATE: `user_id` becomes the subject and the subject column is cleared, so a verified on-behalf recipe is an ordinary recipe of the subject's in every column the rules read. Rejection and not chosen change neither column: those drafts stay the depositor's. This is the only statement that changes a recipe's author. | Module tests calling `resolveDraft` directly: as Dana on her on-behalf draft, null and nothing changed; as Pat verifying, `user_id` = Pat and subject NULL in the returned row; as Pat rejecting and marking not chosen, `user_id` = Dana and subject = Pat. A static test that no other file writes `user_id` on an existing `traces` row. |
| S4-M5 | Move and delete of an unpublished draft are decided in the module, not by `isAuthor` in the route: the subject may move or delete it (today the subject passes as the author, which stops being true while the draft is unverified), and the depositor may delete it but not move it (open question 30). Everyone else, the book owner and the system user included, still gets the missing-id 404. After verification the recipe is the subject's and the existing rules apply unchanged (its author, now the subject, or a book owner or admin). | Module unit test of the predicate; Layer 3 per actor (below). |
| S4-M6 | Every new or changed statement that reads the recipe tables (the naming lookup if it joins `traces`, the queue item's depositor email, the export and import changes, the deletion cascade's collection) is registered in the `TRACE_READS` register as composing or with a one-line reason. `ranking-isolation.test.ts` gains the subject column's name among its forbidden terms. | `npm run check:authz-seam` and `ranking-isolation.test.ts` pass; the verifier deletes the draft fragment from one new statement in a scratch copy and shows the guard fail. |

**Storage**

| # | Criterion | Evidence |
|---|---|---|
| S4-S1 | (Amended, `b89db1f0`.) `traces` gains one NULLABLE subject user id column (no foreign key, like `user_id`), NULL for every ordinary recipe and every draft about its own author, with no backfill: it is set only on an on-behalf draft while two people are involved, and cleared when the subject verifies it (S4-M4). No depositor column: the depositor is `user_id` until verification and the audit trail afterwards (S4-S4). Every insert path either leaves it NULL or sets it through the naming rule (S4-M1). | Migration SQL reviewed (one `ADD COLUMN`, no `UPDATE`); data-model doc regenerated (`npm run check:data-model` passes); after migrating a pre-slice database every row's subject is NULL. |
| S4-S2 | (Amended, `b89db1f0`; simplified 2026-09-27.) The idempotency key stays `(api_key_id, group_id, claim_text_hash)`. The one case the subject would separate (the same key depositing identical text in the same book about two people) is rare and is answered as any identical repeat is today: the existing recipe comes back and nothing new is stored. No new notice. | The slice 1 and 2 idempotency tests (DT-RAT-08, DT-VIS-12) pass unchanged. |
| S4-S3 | (Amended 2026-09-27: the operator asked to drop work built on thin assumptions.) No index work in this slice. The awaiting-review count reads `COALESCE(subject, user_id)` through the module fragment; an index is added only if a measured count turns out slow. | Code review: the count composes `draftAwaitingReviewBy`. |
| S4-S4 | (New, `b89db1f0`.) The depositor is recorded durably without a schema change. For an on-behalf deposit, the `recipe.checked` audit row (actor, key, recipe id, the subject in its metadata) is written in the deposit's own transaction, so an on-behalf draft cannot exist without it; today that write is best-effort ("Non-blocking — don't fail the recipe check if audit logging fails"). Verification's audit row, written in the same transaction as the author change, names the previous author in its metadata. `traces.api_key_id` is not the record: revoking a key deletes its row (open question 39). | Layer 3: an on-behalf deposit whose audit insert is made to fail stores no recipe; after verification, the depositor is recoverable from `audit_log` alone, including after Dana's account and keys are deleted (the cascade keeps audit rows). |

**The wire parameter**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S4-W1 | `on_behalf_of` (an email) is accepted on every check surface: remote MCP `check_recipe`, the stdio proxy, `GET /check`, `POST /check` urlencoded and multipart, and the `/check` HTML form, which carries it on the re-check form the way it carries `draft`. It is trimmed and matched case-insensitively. | DT-OBO-01, DT-OBO-09 | Layer 3 per surface storing a draft about Pat; stdio `server.test.ts` showing the parameter forwarded. |
| S4-W2 | Naming anyone but the key's own user, when S4-M1 accepts them, stores an `unverified` draft whose subject is that person, whose author is the key's user, and whose `api_key_id` is the key, whatever `draft` says (absent, false, `"false"`, `"maybe"`). The response labels it and says the draft was forced because the recipe is on that person's behalf. | DT-OBO-01 | Layer 3 reading the row back for each `draft` value. |
| S4-W3 | Naming the key's own user (any case, any padding) is an ordinary check: stored and answered exactly as without the parameter, with `draft` applying as usual. | DT-OBO-05 | Layer 3 comparing the row and the response (after replacing volatile ids) with and without `on_behalf_of`. |
| S4-W4 | An empty value is the same as absent. Any other value S4-M1 does not accept (malformed, unknown, a non-member, a member of another book only, a member who cannot act, a non-string on MCP) refuses the check with the one uniform answer of S4-U1: nothing is deposited, no search runs, and the refusal names the way forward (name a member with write access to this book, or check without `on_behalf_of`). | DT-OBO-02 | Layer 3 over every case listed, asserting no new `traces` row and no `recipe.checked` audit row. |
| S4-W5 | `on_behalf_of` composes with everything else a check takes: `decided_at` (the backfill case), ratings, attachments, `intent`, `known_recipes`, and ride-along feedback rows, which stay the depositor's rows about the depositor's earlier checks. The deposit's `recipe.checked` audit row carries the subject's user id and is written in the deposit's transaction (S4-S4); no row anywhere carries a refused email (open question 39). | | One Layer 3 combination test with `decided_at`, `impact`, and a feedback row; `audit_log` read back after an accepted and a refused naming. |
| S4-W6 | `search_recipes` declares no new parameter; `/check?filter=` (search only) ignores `on_behalf_of`, since nothing is deposited. | | `tools/list` diff; Layer 3. |

**Visibility.** For an unverified on-behalf draft deposited by D about Pat in the shared book. "Labelled" means the row carries its draft state and names the other party (S4-L1).

| Viewer | Result sets (check, search, related evidence, clusters, counts) | By id (`get_recipes`, `/recipes`, briefing `recipe_ids`, feedback targets, prefixes) | Human surfaces | Evidence |
|---|---|---|---|---|
| Pat's agents (P) | Listed, labelled as deposited by Dana; ranked as if published | Readable, labelled | Queue, id-list link, detail page with the actions | Layer 3 MCP both formats and `/check` JSON and HTML |
| Pat's out-of-scope key (P2) | Absent | Uniformly absent | n/a | Layer 3 (drafts never widen scope, DT-VIS-07) |
| Dana's agents (D) | Listed, labelled as about Pat (the `traceVisibleTo` depositor branch, open question 31); in `search_recipes` only under `author:me` or `author:anyone`, never under `is:draft` | Readable, labelled | Detail page and the id-list link, no confirm or reject, with delete (S4-D1); not in her queue or her Drafts figure | Layer 3; browser |
| Dana's out-of-scope key (D2) | Absent | Uniformly absent | n/a | Layer 3 |
| Sam (member), Olive (outsider), system user | Absent; every count and date is the no-draft figure | Uniformly absent | Uniform 404 on every by-id route | Layer 3; uniform pairs (S4-U2) |

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S4-V1 | The table above holds on every inventory row slice 4 touches (see the inventory's "Touched by slice 4" section); the slice 2 and 3 suites pass unchanged, since for a draft about oneself subject and depositor are still one person. | DT-OBO-03 | `routes/drafts.test.ts` and `routes/draft-queue.test.ts` unchanged and green; a new slice 4 Layer 3 file walking the table. |
| S4-V2 | (Amended, `b89db1f0`.) Once Pat verifies it, the recipe is Pat's published recipe under the ordinary rules: Sam finds it; its author is Pat on every surface (`author:<Pat>` finds it, Pat's own list and count hold it, Dana's no longer do); it carries no draft state for anyone but Pat ([F83]) and no on-behalf label for anyone (S4-L2); Dana reads it only as any member of the book does. | DT-OBO-15, DT-OBO-16 | Layer 3 for Sam before and after; `GET /traces/:id`, `GET /traces`, and `author:` search for Sam, Dana, and Pat. |
| S4-V3 | After Pat rejects it or marks it not chosen, it leaves Pat's and Dana's result sets and stays readable by id to both, labelled with its state; Sam still finds it uniformly absent. | | Layer 3. |

**Labels and the notice to the depositor**

| # | Criterion | Evidence |
|---|---|---|
| S4-L1 | A labelled on-behalf row names the other party from the viewer's side: to the subject's agents "deposited by `<depositor email>`", to the depositor's agents "about `<subject email>`", in markdown (inside the draft label) and in JSON and structured form (a field naming the email, present only on on-behalf rows). A draft about oneself keeps today's label byte for byte. | Renderer unit tests over both sides and the self case; Layer 3 structured output; `/schemas/*.json` describe the field. |
| S4-L2 | (Amended, `b89db1f0`.) A verified on-behalf recipe carries no on-behalf label: its author is its subject, so it reads as the subject's ordinary recipe everywhere (open question 33). The depositing key's label is not shown as if it were the author's key: surfaces that show a recipe's key label show it only when the key belongs to the recipe's author (open question 40). | Layer 3 for Sam, Pat, and Dana after verification: no subject field, no Dana key label on `GET /traces/:id` or the queue's id-list view; browser on the detail page. |
| S4-L3 | The deposit notice for an on-behalf draft says, in the enabling voice: the recipe was stored as a draft because it is on the subject's behalf (and, when `draft` was false, that the flag was overridden); until the subject verifies it, only the subject and their agents and the depositor and their agents can see it; only the subject can confirm or reject it; and the link to hand the subject is `<FRONTEND_URL>/app/drafts?ids=<full id>`. It never tells the depositor to call `verify_draft`. | Layer 1 test of the notice function; Layer 3 on MCP and `/check`. |
| S4-L4 | An identical repeat of an on-behalf deposit (same key, book, text, and subject) returns the existing recipe with the slice 2 repeat notices, worded for the subject ("…still a draft about `<email>`…"). | Layer 1; Layer 3. |

**The queue: what the subject sees, and what the depositor sees**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S4-Q1 | Pat's queue (`/app/drafts`), its count, and his agents' briefing Drafts line include drafts about him that anyone deposited, with the slice 3 figures still equal to each other (S3-Q3). | DT-OBO-06 | Layer 3 comparing the three after D deposits about Pat. |
| S4-Q2 | Each queue item for an on-behalf draft shows who deposited it (the depositor's email as well as the key label) and labels its ratings as the depositing agent's (open question 32). A draft Pat's own agent deposited shows what it shows today. | DT-OBO-06 | Layer 3 item shape; browser. |
| S4-Q3 | Pat can narrow his queue to one depositor with `author:<email>`, since the queue's grammar is the search grammar and `author:` selects the recipe's author, who is the depositor (open question 34). | DT-OBO-07 | Layer 3: `is:draft author:<Dana>` in Pat's queue lists exactly Dana's drafts about Pat. |
| S4-Q4 | Dana's queue, count, and Drafts line never include drafts she deposited about someone else; her `is:draft` lists only drafts about her; `author:me` finds her deposits, labelled (ruling 24). | DT-OBO-06, DT-OBO-07 | Layer 3 on the queue route, MCP `search_recipes`, and `/check?filter=`. |
| S4-Q5 | Dana opening `/app/drafts?ids=<her on-behalf draft>` sees it with its state and the actions unavailable, with a reason naming who can review it; the link is the one her notice gave, so she can pass it on. Pat opening the same link sees it with the actions. | | Layer 3 (`canResolve` false with the reason); browser. |

**Verification and resolution**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S4-R1 | Only the subject resolves: Pat's reaction, Pat's queue actions, and Pat's agents' `verify_draft` work exactly as in slices 2 and 3, under the write-authority rule. | DT-OBO-04 | The slice 2 and 3 resolution tests re-run with a Dana-deposited draft. |
| S4-R2 | Dana, who can read the draft, gets an honest refusal rather than the uniform answer (the S3-F1 rule: the uniform answer is for what the caller cannot read): `verify_draft` and `POST /recipes/:id/verify` say only the person it is about can verify it and give the link to hand them; her `still_true` or `wrong` reaction and her not-chosen request are refused with a 403 saying only that person can review it, and write no reaction row and no state. | DT-OBO-04, DT-OBO-11 | Layer 3 per surface: status, text, the draft still `unverified`, no `trace_reactions` row. |
| S4-R3 | (Amended, `b89db1f0`.) A verification by Pat (reaction, queue, or one of Pat's keys) records Pat as resolver, makes Pat the author, and clears the subject, in one statement (S4-M4); "verified by the depositing agent" never appears for an on-behalf draft, since the depositing key is Dana's and cannot resolve it. A rejection or not chosen records Pat as resolver and leaves Dana the author. | DT-OBO-16 | Layer 3 reading the row after each resolution. |
| S4-R4 | (Amended, `b89db1f0`.) The audit rows for resolution keep their slice 2 and 3 shape and the actor is always the subject; a verification that moves the author also names the previous author in its metadata, in the same transaction (S4-S4). | DT-OBO-16 | Layer 3 reading `audit_log`. |

**Deletion and move** (open question 11's remainder)

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S4-D1 | (Amended, `b89db1f0`.) While it is unverified, Dana (its author) may delete her on-behalf draft through the human delete route (`DELETE /traces/:id`, JWT); it leaves Pat's queue and count at once. No agent surface gains a delete (design-thinking §8's append-only agent surfaces). | DT-OBO-08 | Layer 3; the `tools/list` diff shows no new tool. |
| S4-D2 | Dana may not move it: the move route answers her the same 404 as a random id and changes nothing. Pat may move it to a book where he has write access (the existing move rule), and it stays a draft about him, still visible to Dana by id. | DT-OBO-08 | Layer 3 for both. |
| S4-D3 | Sam (the book owner in the fixture), Olive, and the system user get the random-id 404 for move and delete of the unresolved draft, and nothing changes (slice 2's rule, unchanged). | DT-OBO-08 | Uniform pairs (S4-U2). |
| S4-D4 | (Amended, `b89db1f0`.) After Pat verifies it, it is Pat's recipe and the existing rules apply: Pat may delete or move it as its author, and a book owner or admin may too; Dana, no longer its author, gets what any member gets (403 on delete unless she is an owner or admin of the book). A rejected or not-chosen draft stays Dana's to delete, and Pat may still delete it as its subject (open question 30). | DT-OBO-08 | Layer 3 for Dana and Pat before and after each resolution. |

**Account deletion and removal of either party.** (Amended, `b89db1f0` and `23657e4e`.) The deletion cascade collects recipes by author (`SELECT id FROM claimnet.traces WHERE user_id = …`), and author now follows the draft's life: the depositor until verification, the subject after it. The rows below are written against the simplified cascade on `fix/account-delete-former-coauthors` at `770628b` (recipe `23657e4e`): account deletion deletes only what the person owns and never adds anyone to a book. A book with current members still passes to a current member; a book in the departing person's own organizations with no members left but other people's recipes in it stays, memberless, moved into the personal organization of the author of its earliest recipe with nobody added and a `recipe_book.left_without_members` audit row; a book in someone else's organization only loses the membership; and a book is deleted only when it holds no recipes. If that branch has not merged when slice 4 is built, the builder merges main first or records which rows were verified against the older cascade.

| # | Case | Criterion | Scenarios | Evidence |
|---|---|---|---|---|
| S4-A1 | Pat leaves the book (or is removed) | The draft stays where it is. Pat's queue and count drop it (S3-Q2); Pat still opens it through the id-list link with the actions unavailable and the reason naming the book, and the resolution routes answer him the honest 403 (S3-A4). Rejoining restores everything. Dana's view is unchanged. | DT-OBO-12 | Layer 3. |
| S4-A2 | Dana leaves the book (or is removed) | The draft stays, and Pat can still review it: resolution needs Pat's authority, not Dana's. Dana's agents lose it (her keys' effective scope drops the book), while Dana herself still reads it by id and may still delete it while it is unverified (the depositor rule holds whatever her membership, as the subject's does). If Pat verifies it, it becomes Pat's recipe, and Dana's removal no longer matters to it. | DT-OBO-12 | Layer 3. |
| S4-A3 | Pat deletes his account | Everything Pat authored goes, which now includes on-behalf recipes he verified (the author rule, unchanged). Unverified drafts about Pat go too, by one addition to the cascade's collection: unverified drafts whose subject is the departing person (`draftAwaitingReviewBy`, composed from the module), since they exist only for his review and nobody else can ever resolve them (open question 35). Drafts about Pat that he rejected or marked not chosen stay Dana's, visible to her alone. The subject is stored as a user id, never an email, so a new account registered later with Pat's email inherits nothing. | DT-OBO-13 | Layer 3: after deletion, Pat's verified on-behalf recipe and the unverified draft about him are gone (with their embeddings, through `deleteTraceCascade`), the rejected one is still Dana's; a new account with Pat's email sees nothing in its queue, briefing, or by id. |
| S4-A4 | Dana deletes her account | Her unverified, rejected, and not-chosen deposits go with her (she is still their author); unverified ones leave Pat's queue and count. Recipes Pat verified are Pat's and stay. Her `recipe.checked` audit rows stay (the cascade keeps `audit_log`), so the depositor of those recipes is still on record (S4-S4). | DT-OBO-13 | Layer 3 over one draft in each state; `audit_log` read after deletion. |
| S4-A5 | The owner of a book in their own organization deletes their account, and the book's only other content is another person's on-behalf drafts | Nobody is added to the book. With a current member left, it passes to that member as before. With none left, it stays memberless and moves into the personal organization of the author of its earliest recipe (for an unverified on-behalf draft that is the depositor, Dana), with the `recipe_book.left_without_members` audit row; the drafts keep their subject and visibility, so Dana can still read and delete hers and Pat can read his by id but cannot resolve them without write authority. The book is not deleted while it holds any recipe. | DT-OBO-17 | Layer 3 on the merged cascade: such a book survives, has no members, sits in Dana's personal organization, and the audit row exists; no membership row was inserted. |

**Export and import**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S4-E1 | (Amended, `b89db1f0`.) Export stays by author and so follows the flip: Dana's export carries her unverified, rejected, and not-chosen on-behalf drafts with their state and the subject's email; Pat's export carries the on-behalf recipes he verified, as his ordinary recipes, and not the unverified ones about him; Sam's carries neither (open question 36). | DT-OBO-14 | Layer 3 on `GET /auth/me/export` for all three, before and after Pat verifies one. |
| S4-E2 | Import of a row naming a subject other than the importer applies S4-M1 against the target book: accepted, it is restored as an `unverified` draft about that person, whatever state the file carries, since only the subject resolves; otherwise the row is refused with the uniform naming answer and nothing is stored. A row naming the importer imports as today. | DT-OBO-14 | Layer 3: a verified on-behalf row imports unverified; a row naming an unknown email and one naming a non-member get identical row errors. |
| S4-E3 | Import never writes resolution attribution ([F83], unchanged), and an imported on-behalf draft carries the importer as author and depositor. | | Layer 3 reading the row. |

**Admin counts**

| # | Criterion | Evidence |
|---|---|---|
| S4-C1 | (Amended, `b89db1f0`.) Admin per-user recipe counts (RP-31) and totals (RP-32, RP-33) count by author, as today, so they follow the flip: an on-behalf draft counts for its depositor until verified and for its subject afterwards. No admin surface gains the subject. | Layer 3 on `GET /admin/users` after D deposits about Pat (Dana's count moves) and after Pat verifies it (the count moves from Dana to Pat). |

**Uniform responses**

| # | Criterion | Evidence |
|---|---|---|
| S4-U1 | Naming is not an account-existence oracle. For a key that can write the target book, `on_behalf_of` set to an unknown email, the email of an account with no membership anywhere, a member of a different book only, an account in the book that cannot act (waitlisted or unverified), and a malformed address all get the same status and body after replacing the email, on MCP (both formats), `/check` JSON, and `/check` HTML, and on import row errors. The lookup is one statement whether or not the email exists, so no branch runs for the known case that does not run for the unknown one. Membership of the book itself is not secret from a writer of that book (the briefing lists a shared book's members), so the accepted case is not required to look like a refusal. | Byte comparison per surface; code review of the one statement. Timing is not measured; the verifier records that as a deviation. |
| S4-U2 | For Sam, Olive, and the system user, every by-id surface in the slice 2 and 3 uniform-response lists gives the random-id answer for Dana's unresolved draft about Pat, including prefixes, `verify_draft`, move, delete, reaction, and not chosen. For Pat's P2 and Dana's D2 the agent by-id surfaces do the same. | The slice 2 comparison harness re-run with the on-behalf draft. |
| S4-U3 | Honest refusals (S4-R2, S4-Q5, S3-A4) go only to someone who can already read the draft: the subject or the depositor. | Layer 3 showing Sam's attempt at each of those actions returns the uniform answer. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S4-Z1 | Remote `tools/list` stays at or under **17,000** bytes and stdio at or under **13,670**, neither cap raised. With 147 bytes of remote headroom, the `on_behalf_of` property's description is one line of at most 90 characters, and the `draft` description does not grow (the forcing rule lives in the `on_behalf_of` line and the notice). | Both size tests; the verifier records the exact numbers. |
| S4-Z2 | The shared-description total: at or under 6,000 characters by trimming existing copy, each trim declared under the surface-tradeoffs rule, or the cap raised by at most the new description's length with a dated comment (open question 38). Any single description stays at or under 420, and `on_behalf_of` at or under the 120-character one-line cap. | `mcp-tool-descriptions.test.ts` diff. |
| S4-Z3 | The on-behalf label adds at most the other party's email plus 20 bytes to today's draft label; a self draft's label and a published row are unchanged. | Renderer unit test. |
| S4-Z4 | The on-behalf deposit notice is at most 60 characters longer than today's new-draft notice plus the subject's email. | Layer 1 length assertion. |
| S4-Z5 | `/briefing` output is unchanged for a person with no on-behalf drafts; the Drafts line counts drafts about the person with its current wording. | Byte comparison before and after for a person with only self drafts. |

**Accessibility and phone width** (browser verification run)

| # | Criterion | Evidence |
|---|---|---|
| S4-UI1 | axe finds zero serious or critical violations on: Pat's queue with an on-behalf item, Pat's and Dana's detail pages for an unresolved on-behalf draft, Dana's id-list view of it, and the detail page of a verified on-behalf recipe as Sam sees it (Pat as author, no on-behalf line, no Dana key label). | axe JSON per page. |
| S4-UI2 | The "deposited by" and "about" lines on unresolved drafts are text, not colour or an icon alone; the reason the actions are unavailable to Dana is text associated with the action group; Dana's delete control's accessible name says what it removes (for example "Delete draft about pat@…: As a backend maintainer…"). | Browser; accessible-name assertions. |
| S4-UI3 | At 412 px no horizontal scroll on those pages; a long email wraps. | Browser, mobile project. |

**Surfaces that must change:** (amended, `b89db1f0`, `23657e4e`) the `traces` schema (one nullable subject column and the awaiting-review index; the idempotency key is unchanged), migration, and regenerated data-model doc; the authz module (the naming function, `subjectOf`, `draftStateShownTo`, the move and delete predicate, `trace-access.ts` facts, `resolveDraft`'s author change on verification, the seam register); `trace.service.ts` deposit (the transactional audit row for on-behalf deposits) and the idempotency repeat notice; the deletion cascade's collection (unverified drafts about the departing person); the key-label display rule (open question 40); `routes/mcp.ts`, `routes/check.ts` (parameter, form carry, labels), the stdio server; `packages/domain` (the parameter description, the notices, the label, the verify and reaction refusal copy); `packages/contracts` and the published schemas (the parameter, the on-behalf label field on unpublished rows); `draft-verify.service.ts` (the depositor's honest refusal); the reaction and not-chosen routes; `draft-queue.service.ts` (depositor email on items); export (`routes/auth.ts`) and `import.service.ts`; the frontend queue item, detail page, and book list; `ranking-isolation.test.ts`'s term list; the read-path inventory; the feature file (DT-OBO scenarios moved out of `@unreleased` as they pass); C01-R15 needs no edit (already corrected by ruling 20).

**Surfaces that must NOT change:** (amended, `b89db1f0`) the meaning of author everywhere (`user_id`, `author:`, the exclude-own default, admin counts, export ownership, account deletion's collection by author): what changes is only whose id `user_id` holds, once, when the subject verifies; the idempotency key; `is:draft` and the queue for drafts about oneself; slice 2 and 3 visibility for self drafts (their suites pass unchanged); [F83] for everyone but the subject; the reaction vocabulary and the meaning of reaction counts; the five ranking files and `ranking-regression.test.ts`; the MCP tool roster apart from one new `check_recipe` property (no new tool); `search_recipes`' schema; the `api_keys` schema (headless is slice 5); `resolveDraft`'s WHERE clause (who may resolve), which gains only SET columns.

**Security properties the verifier must see proven**

- On behalf of someone else is always a draft, on every surface including import (S4-W2, S4-E2), and the depositor can never publish it: not by `verify_draft`, a reaction, a queue action, import, or re-checking the text (S4-R2, S4-M4, S4-L4).
- Naming is not an account-existence oracle (S4-U1), is decided once in the module (S4-M1), and requires a live, able writer of the target book at the moment of deposit.
- The subject is an id, never an email, so a re-registered email inherits nothing (S4-A3).
- (Amended, `b89db1f0`.) A recipe's author changes in one place only, the subject's verification inside `resolveDraft` (S4-M4), never through import, a re-check, a move, or any agent surface of the depositor's; and the depositor of every on-behalf recipe stays recoverable from the audit trail, written in the same transactions (S4-S4).
- The second viewer widens nothing: drafts never widen a key's scope for either party (P2, D2), collaborators and outsiders see no row, count, date, prefix, or refusal that differs from a random id (S4-U2), and honest refusals go only to the subject or depositor (S4-U3).
- The visibility rule stays in one place (S4-M2, S4-M3, S4-M5), guarded statically (S4-M6), and the subject never reaches ranking.
- The audit role's findings are recorded in the private repo; this log records only that the audit happened and whether blocking findings were closed.

**Briefing-copy declaration.** The `on_behalf_of` description, the on-behalf deposit and repeat notices, the on-behalf labels, and the depositor's refusal copy on `verify_draft` and the reaction route are agent-facing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The slice 4 PR appends a `spec-decision-log.md` entry (mirrored in the commit body) that declares a new `@unreleased` scenario (a briefed agent recording another person's judgment from their own artifacts deposits it with `on_behalf_of`, quotes that person's words as evidence, and hands its human the review link for that person rather than calling the draft verified), names as watched the slice 2 drafting scenario in `checking-behavior.feature` with a rationale, and records the bytes before and after for `tools/list`, the shared descriptions, the notice, and the label. The when-to-draft guidance in the briefing body stays in slice 7.

### Slice 4 verification record

Written 2026-09-27 by the functional verifier (agent `a-drafts-verify-s4-2026-09-27`, Soup.net intent `int_k3zC1wjtvOq0Jrr1c0zSi8NE`), who did not build the slice and changed no application code. Verified at branch tip `f3615d0` in a throwaway detached worktree after `npm ci` and `npm run build:packages`. Verdicts were formed from the verifier's own probes and code review before the builder's build notes were read; the notes were then checked against that evidence (see "Builder's interpretations" below).

**Verdict: accept with minor follow-ups.** Of the 57 rows, 53 pass, three of them with deviations the orchestrator accepted. Three are partial: S4-L2 (the key-id badge), S4-L3 (one untrue clause), and S4-UI3 (a pre-existing heading overflow). One is not met as written: S4-UI1, whose serious contrast violations come from badge and evidence styles the slice did not touch. No security property failed.

**How it was verified.**

- **Gate:** `TESTCI_PGPORT=5724 npm run test:ci`, one run, **exit code 0**: 123 test files passed and 3 skipped, 1,768 tests passed and 10 skipped; the golden-set ranking eval reported "All 9 thresholds green."
- **Targeted re-run** against the verifier's own stack: the ten files that carry this slice's criteria (`routes/drafts-on-behalf.test.ts`, `authz/naming.test.ts`, `authz/draft-sql.test.ts`, `authz/roles.test.ts`, `authz/trace-access.test.ts`, `authz/seam-guard.test.ts`, `services/ranking-isolation.test.ts`, domain `drafts.test.ts`, frontend `draft-queue.test.ts` and `draft-status-label.test.ts`): 180 tests passed, none skipped. The slice 4 Layer 3 suite (35 tests) takes about 14 seconds on an idle stack.
- **Independent probe:** a script of the verifier's own (196 assertions, plus three follow-up probes) against the built backend on a throwaway stack (compose project `soupnet-ci-5724`, backend on :3291 with the test-ci environment and stub embeddings), torn down afterwards. Cast: Pat (subject), Dana (depositor), Sam (owner of the shared book), Olive (outsider, owner of her own book), Mo (a member of Olive's book only), Uma (a shared-book member with an unverified email), and the system user; keys P, P2, D (labelled "Dana laptop agent"), D2, Sam's and Olive's. Account deletion ran on four fresh casts.
- **Tests fail without the slice's rules** (mutations in the throwaway tree, reverted): `subjectOf` back to `user_id` fails 6 tests in `draft-sql.test.ts`; letting the depositor move fails `roles.test.ts`; showing the depositor a verified state fails the S4-M3 parity test.
- **Code review** of the slice's diff (`0949691..f3615d0`, first-parent slice commits `7f7dd54` to `e527e15`).

**Carried in**

| # | Verdict | Evidence |
|---|---|---|
| S4-F1 | pass (separable path) | F86 stays open in `docs/backlog.md`; F89 is closed (`b33b8bd`). The row's fallback was run by hand: deleting the draft fragment from the account-deletion collection (`user-delete.service.ts`), the on-behalf party fragment from the by-id lookup (`recipe-lookup.service.ts`), and the subject fragment from the export (`routes/auth.ts`) each makes `check:authz-seam` exit 1 naming the file and its new fingerprint; the clean tree exits 0. F86 is not closed. |

**Where it lives**

| # | Verdict | Evidence |
|---|---|---|
| S4-M1 | pass | `authz/naming.ts`: one statement over `lower(u.email)` composing `membershipOf`, `WRITE_ROLES`, and `activeUserPredicate` (which reads verified and not waitlisted). Live: an owner-role member is nameable; Mo (another book only), Olive (her own book only), Uma (unverified member), Pat named into a book he is not in, and Pat after removal from the book are all refused. A mixed-case, padded email is accepted. No `group_members` read outside the module (guard green). |
| S4-M2 | pass | `subjectOf` is `COALESCE(t.subject_user_id, t.user_id)`, `depositorOf` is `user_id`; `trace-access.ts` reads both through them. The parity tests vary subject and depositor separately; the mutation above fails them. |
| S4-M3 | pass | Dana's `GET /traces/:id` on her unverified draft: `draftState: unverified`, `draftAbout: <Pat>`, resolution fields null; on the rejected one, `rejected`. After Pat verifies: no state, no `draftAbout`, no key label. Pat sees every state. The mutation fails the parity test. |
| S4-M4 | pass | Pat's confirm: `user_id` Pat, subject NULL, resolver Pat, `api_key_id` still D. Reject and not chosen: `user_id` Dana, subject Pat. The static test passes and a repo grep finds no other `UPDATE claimnet.traces` that sets `user_id` (import's overwrite and the move set other columns). Nothing else moved the author: Dana's identical re-check after verification, her move (refused), and her delete (403) all left it Pat's. The row's "module tests calling `resolveDraft` directly" are Layer 3 tests plus the static test; the verifier's probe covered all three outcomes. |
| S4-M5 | pass | `unpublishedDraftManagement` in `roles.ts`; the detail page gives Dana `canDelete: true, canMove: false`, Pat both. The mutation fails its unit test. |
| S4-M6 | pass | Every changed statement is re-registered with a reason; `ranking-isolation.test.ts` forbids `subject_user_id`, `subjectUserId`, and `onBehalf*` (and its draft pattern now actually matches: it held backspace characters before `ed89afa`). Hand plants: see S4-F1. |

**Storage**

| # | Verdict | Evidence |
|---|---|---|
| S4-S1 | pass | Migration `0039_traces_draft_subject.sql` is one `ALTER TABLE … ADD COLUMN "subject_user_id" uuid;` with no foreign key and no `UPDATE`; `check:data-model` passed in the gate. |
| S4-S2 | pass | Dana repeating identical text naming Sam returns the draft about Pat, subject unchanged; the slice 1 and 2 idempotency tests pass. |
| S4-S3 | pass | No index; the count composes `draftAwaitingReviewBy`. |
| S4-S4 | pass (accepted deviation) | The on-behalf `recipe.checked` insert sits inside the deposit transaction and the verification's audit row is written by the resolving statement itself (a data-modifying CTE), so neither can be skipped. After Dana's account is deleted, `audit_log` alone still names her as the depositor (`recipe.checked` actor) and the previous author (`previousAuthorId` on `recipe.draft_verified`). Accepted deviation: no failure-injection test. |

**The wire parameter**

| # | Verdict | Evidence |
|---|---|---|
| S4-W1 | pass | Remote MCP, `GET /check`, `POST /check` urlencoded and multipart each store a draft about Pat with a padded, upper-cased email; the HTML page shows "draft about <Pat>" and the re-check form carries `name="on_behalf_of" value="<Pat>"`; the stdio test forwards the value. |
| S4-W2 | pass | `draft` absent, `false`, `"false"`, `"maybe"`, `true`: each stores `unverified`, subject Pat, author Dana, key D. |
| S4-W3 | pass | Naming Dana herself (padded, upper case) stores an ordinary recipe; the structured response equals the no-parameter one apart from `totalResults` (one higher, from the probe's own previous deposit); with `draft=true` it is an ordinary self draft. |
| S4-W4 | pass | Empty and whitespace-only values equal absent. 14 unnameable values (unknown, Olive, Mo, Uma, malformed, `pat@`, an injection-shaped string, a `+` alias, a 5,000-character address, a Cyrillic homoglyph, and on MCP a number, array, object, and boolean) store no recipe and write no `recipe.checked` row. |
| S4-W5 | pass | One deposit with `on_behalf_of`, `decided_at`, `impact`, `intent`, `known_recipes`, and a PNG attachment: stored as specified, one audit row carrying `subjectUserId`, `intentId`, and `hasFile`; no audit metadata contains an email, and no row mentions the refused addresses. |
| S4-W6 | pass | `check_recipe` gains exactly one property; `search_recipes` none; `/check?filter=` with an unknown `on_behalf_of` answers 200 with the results and no refusal. |

**Visibility**

| # | Verdict | Evidence |
|---|---|---|
| S4-V1 | pass | Pat's agents: `is:draft` lists it with `draftDepositedBy`, markdown "deposited by <Dana>", in his own check's results, and by prefix. Dana's agents: absent from the default search and from `is:draft`, present under `author:me` (with `draftAbout`) and `author:anyone`, readable by id. P2, D2, Sam's and Olive's keys: absent from `author:anyone` search, and `get_recipes` (full and prefix), `GET /recipes`, `verify_draft`, `POST /recipes/:id/verify`, `log_feedback`'s target, and briefing `recipe_ids` each equal a random id. Sam, Olive, Mo, and the system user: absent from `GET /traces?groupId=`. |
| S4-V2 | pass | After Pat confirms: Sam reads it with Pat as author and no draft state, on-behalf field, or key label; `author:<Pat>` finds it and `author:<Dana>` does not; Pat's `author:me` finds it without on-behalf fields; Dana's `author:me` no longer does. |
| S4-V3 | pass | Rejected: readable by id to Dana ("about Pat") and Pat ("deposited by Dana") with its state, 404 for Sam, gone from Dana's `author:me`, Sam's `get_recipes` equals a random id. |

**Labels and notices**

| # | Verdict | Evidence |
|---|---|---|
| S4-L1 | pass | Structured, markdown, `get_recipes`, and detail-page fields name the other party from each side, only on unpublished on-behalf rows; `/schemas/recipe.json` declares `draftAbout` and `draftDepositedBy`. |
| S4-L2 | partial | After verification there is no on-behalf field for anyone. The API returns a null key label to Pat, Dana, and Sam (the key is Dana's and the author is Pat), and it stays null after Dana's account is deleted. But the detail page's agent badge still shows the key, reading "No label set" and the first eight characters of Dana's key id, to every reader. So the depositing key still appears as the agent of Pat's recipe, and "No label set" is untrue of that key. Follow-up: when the key is not the author's, show no key at all. |
| S4-L3 | partial | The notice names Pat, says it is a draft because it is on his behalf, who can see it, that only he confirms, and gives `<FRONTEND_URL>/app/drafts?ids=<id>`; it never mentions `verify_draft`. But it says "(your draft flag was overridden)" when no `draft` was sent, because the code tests only that the parsed flag is not true (`draftFlagOverridden: !!subject && !requestedDraft.draft`); the rubric scopes that clause to a false flag. Follow-up: send the clause only for an explicit false (recipe `9172f109`). |
| S4-L4 | pass | Repeats with `draft=false` and no `on_behalf_of`, and naming Sam, return the same id with "…logged this recipe as a draft about <Pat>, and it is still a draft: checking it again does not verify it; only they can." and the link. |

**The queue**

| # | Verdict | Evidence |
|---|---|---|
| S4-Q1 | pass | Pat's queue total 6 = `/traces/drafts/count` 6 = briefing "Drafts: 6 unverified drafts about your user…". |
| S4-Q2 | pass | Item carries `depositedBy: <Dana>` and `keyLabel: "Dana laptop agent"`; rendering: browser run. |
| S4-Q3 | pass | `author:<Dana>` narrows Pat's queue to items deposited by Dana. |
| S4-Q4 | pass | Dana's queue holds no item with `about`, and her count equals her total. |
| S4-Q5 | pass | Dana's id-list view: `canResolve: false`, `blockedReason` names Pat and the link; Pat's: `canResolve: true`. |

**Verification and resolution**

| # | Verdict | Evidence |
|---|---|---|
| S4-R1 | pass | Pat's reaction and Pat's agent's `verify_draft` both resolve a Dana-deposited draft; not chosen and reject work from the queue and reaction. The slice 2 and 3 suites pass unchanged but were not re-parameterized with an on-behalf draft (builder's note); the probe covers each route. |
| S4-R2 | pass | Dana's `verify_draft` names Pat and the link; REST verify 403 `only_subject_reviews`; `still_true` and `wrong` 403; not chosen 403; no reaction row, still unverified. |
| S4-R3 | pass | See S4-M4; the agent verification's text and audit say nothing about the depositing agent verifying (`verifiedByDepositingKey: false`). |
| S4-R4 | pass | One `recipe.draft_verified` row per verification, actor Pat, `previousAuthorId` Dana; reject and not chosen rows name Pat and carry no `previousAuthorId`. |

**Deletion and move**

| # | Verdict | Evidence |
|---|---|---|
| S4-D1 | pass | Dana's `DELETE /traces/:id` on her unverified draft: 200, row gone, Pat's count one lower; no agent tool added. |
| S4-D2 | pass | Dana's move equals a random id's 404 byte for byte. Pat moves one into his personal book: still unverified, about Pat, authored by Dana; Dana still reads it by id through the human route, her key D does not (out of scope), Sam gets 404, and Dana can still delete it. |
| S4-D3 | pass | Sam, Olive, Mo, and the system user: move and delete equal a random id byte for byte; nothing changed. |
| S4-D4 | pass | After verification Dana's delete is 403 and her move is refused; Sam (owner) deletes a verified one. Rejected and not-chosen stay Dana's; Pat (subject) deleted an unverified one. |

**Account deletion and removal**

| # | Verdict | Evidence |
|---|---|---|
| S4-A1 | pass | Pat removed: queue drops it; his link shows `canResolve: false` naming the book; his confirm is an honest 403; Dana's view unchanged; Pat cannot be named meanwhile; rejoining restores it. |
| S4-A2 | pass | Dana removed: her key reads it as a random id; she still reads it by id and deletes another of her unverified deposits; Pat verifies one and it becomes his. |
| S4-A3 | pass | Subject deletes his account: his verified on-behalf recipe and the unverified drafts about him go (embeddings too), including one in a book he had already left; the rejected one stays Dana's; a new account with his email has an empty queue and gets a random id's 404; audit rows remain. |
| S4-A4 | pass | Depositor deletes her account: her unverified, rejected, and not-chosen deposits go; Pat's verified one stays his; Pat's count drops by one; `audit_log` still names her. |
| S4-A5 | pass | Owner deletes his account after the other members were removed: the book survives with no members in the depositor's personal organization, with one `recipe_book.left_without_members` row; Dana reads and deletes her draft; Pat reads it but his confirm is refused (403). |

**Export and import**

| # | Verdict | Evidence |
|---|---|---|
| S4-E1 | pass | Dana's export: the unverified and rejected drafts with `onBehalfOf: <Pat>`, not the verified one. Pat's: the verified one without `onBehalfOf`, not the unverified one. Sam's: none. |
| S4-E2 | pass (accepted deviation) | Rows naming Pat (one marked `verified` in the file) import as unverified drafts about Pat by Dana. Refusals: unknown, Olive, and Pat-into-a-book-he-is-not-in give identical 400 bodies; Uma and a malformed address identical 400 bodies in the target book; nothing stored. A row naming the importer imports as today; Pat's verified recipe re-imports as his own. Accepted deviation: the whole file is refused, not the row (recipe `a8916b66`). |
| S4-E3 | pass | Imported on-behalf rows carry Dana as author and no resolution fields. |

**Admin counts, uniform responses, budgets**

| # | Verdict | Evidence |
|---|---|---|
| S4-C1 | pass | `GET /admin/users` `recipeCount`: Dana 15 → 14 and Pat 2 → 3 when Pat verifies. |
| S4-U1 | pass | Over the 14 unnameable values, one variant each on MCP markdown, MCP structured, `/check` JSON, `POST /check` urlencoded, multipart, and `/check` HTML (after replacing the echoed value); import refusals as in S4-E2. The lookup is one statement for every input. Timing not measured (deviation the row allows). |
| S4-U2 | pass (accepted deviation) | The slice 2/3 harness was not re-run (accepted); the verifier's own on-behalf comparison: for Sam, Olive, Mo, and the system user, `GET /traces/:id`, move, delete, `still_true` and `stale` reactions, not chosen, and the id-list link by full id and prefix are byte-identical to a random id (status and body); for P2, D2, Sam's and Olive's keys, the agent by-id surfaces listed under S4-V1. No reaction row was written. |
| S4-U3 | pass | Honest refusals appear only for Pat and Dana; the same actions from Sam, Olive, Mo, and the system user are the uniform 404. |
| S4-Z1 | pass | Remote `tools/list` **16,986** bytes (cap 17,000); stdio **13,196** (cap 13,670); `on_behalf_of` description 83 characters; `draft`'s unchanged at 171. |
| S4-Z2 | pass | Shared descriptions **6,051** characters; cap raised 6,000 → 6,080 (by 80, at most the new description's 83) with a dated comment. |
| S4-Z3 | pass | The label adds " about <email>" (email + 7) or ", deposited by <email>" (email + 15); self and published labels unchanged. |
| S4-Z4 | pass | On-behalf new-draft notice 336 characters against the self notice's 344 (34-character email, same URL). |
| S4-Z5 | pass (code review) | No briefing source changed apart from the new parameter description; the Drafts line counts through `draftAwaitingReviewBy` and read "6 unverified drafts about your user" for Pat. No pre-slice byte comparison was run. |

**Accessibility and phone width** (browser run: expectations and results in the private companion repo under `docs/working/browser-verification/2026-09-27-drafts-slice4/`; spec `tests/e2e/drafts-slice4.spec.ts`, written by a separate verifier agent and not committed; desktop 13 tests, 11 passed; mobile 1 test, failed. The verifier opened the key screenshots itself.)

| # | Verdict | Evidence |
|---|---|---|
| S4-UI1 | not met as written (pre-existing cause) | axe finds no serious or critical violation on Pat's queue or Dana's id-list view. Each of the three detail pages (Pat's and Dana's for the unresolved draft, Sam's for the verified one) has one serious `color-contrast` violation on four nodes: the "Human user" and "Agent (API key)" badge captions and the key-id prefix (1.52:1), and the evidence source line (1.76:1). They come from `--color-outline-variant` in `UserBadge.tsx`, `ApiKeyBadge.tsx`, and the evidence card, which the slice did not change; the new "Deposited by" and "About" lines pass. Not a slice 4 regression, but the row names these pages. |
| S4-UI2 | pass | The party lines are text ("Deposited on your behalf by <Dana>", "About <Pat>: only they can confirm or reject it"). Dana's reason is tied to the `role="group"` action group by `aria-describedby`. Her delete control's accessible name is "Delete draft about <Pat>: As a backend maintainer …", and the keyboard reaches it with a visible focus ring. |
| S4-UI3 | partial (pre-existing cause) | At 412 px the queue and Dana's id-list view have no horizontal scroll and a 90-character email wraps. On a detail page whose recipe text also holds a 90-character unbroken token, the page is 1,232 px wide because the recipe `<h1>` has no `overflow-wrap`, while the party line (`overflowWrap: "anywhere"`) wraps. The same page with ordinary text measures 412. The heading predates the slice and also overflows at 1,440 px. |


**Security properties.** On behalf of someone else is always a draft (S4-W2, S4-E2), and the depositor could not publish it by `verify_draft`, REST verify, reaction, not chosen, import, or re-check (S4-R2, S4-L4, S4-E2). Naming is decided once, by one statement, with one refusal per surface (S4-M1, S4-U1). The subject is a user id; a re-registered email inherits nothing (S4-A3). The author changes only in the resolving statement, and the depositor stays in `audit_log` after her account is gone (S4-M4, S4-S4). Collaborators, outsiders, and out-of-scope keys see a random id's bytes (S4-U2); honest refusals go only to the two parties (S4-U3). The rule is in the module, guarded by the seam check and the parity tests, and the subject cannot reach ranking (S4-M2 to M6). The security audit is a separate role; its findings go to the private repo.

**Builder's interpretations** (build notes, 1 to 5), checked after the verdicts above.

1. The subject's label says "visible only to them and their agents" without naming the depositor: agreed as within the byte budget; the depositor's label has the same ambiguity ("about <Pat>: … visible only to them"). Copy follow-up, not a row failure.
2. The depositor's `stale` reaction is recorded: confirmed (200, one reaction row, no state change). The verifier also found that Dana's `still_true` on a draft Pat already rejected is recorded (200, one row), while on the unverified draft it is a 403. S4-R2 names only the unverified case, so this passes the row, but a depositor's reactions on a draft about someone else are rows in that draft's counts. Follow-up: decide whether a depositor-only viewer reacts at all.
3. Not chosen by the depositor on a resolved draft answers `already_resolved` (409): confirmed, and honest since she can read it.
4. A rejected draft keeps a dangling `subject_user_id` after the subject's account is deleted: agreed; only the naming fragments read it, and it stays visible to its author alone.
5. The on-behalf `recipe.checked` row is completed by an `UPDATE` after the search: agreed; the deposit's fields are committed with the recipe, and one check is still one row.

**The builder's timeout changes.**

- **90-second per-test timeout on the slice 4 suite** (`2882e1b`): absorbs load only. The 35 tests run in about 14 seconds on an idle stack, and a timeout can only fail a slow test; it cannot turn a failing assertion into a pass.
- **S2-B2's embedding wait, 80 s → 200 s** (`e527e15`): absorbs load. The loop is a readiness poll that breaks as soon as the embeddings land, and the assertions are unchanged. A weakness that predates this change: when the poll runs out it falls through silently, and if the draft's own evidence never embedded, "the draft's evidence never surfaces" would pass vacuously. The longer wait makes that less likely, not more. Follow-up: assert the draft's evidence embedded after the loop.

**Found beyond the rubric** (none blocking).

- **Import resurrects a rejected draft.** Dana's export carries rejected drafts about Pat with `onBehalfOf`; importing them into a book Pat writes restores them as fresh unverified drafts in his queue (as S4-E2 specifies: "whatever state the file carries"). A draft Pat rejected can therefore come back for review. Worth an operator ruling on whether rejected and not-chosen rows should import in their state.
- **Import's overwrite path, by code reading (not probed):** `overwrite=true` replaces an owned row's text where `user_id` is the importer, so a depositor can change the text of an unverified draft about someone else after deposit, as any author can for her own recipes. Pat would review whatever text is current when he acts.

**Follow-ups** (none blocking): no key badge on a recipe whose key is not its author's (S4-L2); the pre-existing badge and evidence-source contrast and the detail heading's missing `overflow-wrap` (S4-UI1, S4-UI3); the depositor-facing copy the browser run found (on a rejected draft Dana still reads "only they can confirm or reject it" and the tooltip "You marked this draft wrong"; her id-list view says "Drafts your agent linked"; Pat's detail page says "Agent's ratings" where his queue says "Depositing agent's ratings"; after a delete she lands on the public landing page); the override clause in the on-behalf notice only for an explicit false flag (S4-L3); the label wording for both sides (interpretation 1); whether a depositor-only viewer may react (interpretation 2); whether import should keep a rejected or not-chosen state (above); S2-B2's post-poll assertion; F86 remains open.

### Slice 5 rubric: headless keys and the capability ladder

Written 2026-09-28 by agent `a-drafts-rubric-s5-2026-09-28`, before implementation, from the design, the slice 1 to 4 records and rulings, and the code at `7bcedba` (slices 1 to 4 merged). Consumer: human (the keys page, where the setting is chosen and shown) and agent (the forced draft, its notice, the refusals, and the headless briefing). Security-relevant: yes. The slice adds a setting on a credential that must never be removable by the agent holding it, and a new refusal on the one agent operation that publishes, so the security workflow applies: a read-only audit by an agent other than the builder and the verifier, findings in the private repo, and a recipe check on each security decision. The keys page changes, so the slice also gets a browser verification run with expectations drafted from this rubric.

Settled before this rubric (not reopened here): headless keys, and keys derived from them, cannot verify drafts or resolve option sets (open question 13, accepted; the verify operation already takes its authority from one key predicate, `keyMayVerifyDrafts` in `authz/roles.ts`, which returns true for every key today so that this slice changes one line); the ladder is full, drafts only, nothing, designed once ([drafts-and-triage.md](drafts-and-triage.md) §Headless keys); a headless agent is autonomous but directly supervised, so the slice adds no restriction on the books the person chose for the key (recipe `e0d2c1c9`: "The user already chose the books it has access to when it made the key. You're over thinking security."); the smallest addition to existing concepts, with edge questions answered by the obvious default (recipes `eb4b77eb`, `061a7926`, `23657e4e`).

**Derived keys are not built.** No `parent_key_id` exists at `7bcedba`, so "a key derived from a headless key is headless" cannot be built or tested in this slice. The rule is recorded in [derived-agent-keys.md](derived-agent-keys.md) §What keeps it safe (open question 44), and DT-HDL-02 is retagged to the derived-keys work.

Terms: a **headless key** is one whose stored deposit level is `drafts`; an **ordinary key** is one whose level is `full`. Cast, as in the feature file: Pat (the key's owner), Sam (a member of Pat's shared book), Olive (an outsider). Keys: H is Pat's headless scoped key and K an ordinary scoped key of Pat's with the same books; both read and write the shared book.

**Baselines**, measured by this agent at `7bcedba` with the slice 1 method (`createMcpServer` with a stub principal, and `createStdioServer`, each over the SDK in-memory transport, `initialize` then `tools/list`, the reply's `result` as minified UTF-8 JSON; description totals from the `@soupnet/domain` constants; briefing sizes from `BRIEFING.build` over the fixture in `recipe-guide-content.test.ts`):

| Measure | Value | Cap | Headroom |
|---|---|---|---|
| Remote `tools/list` | 16,986 bytes (8 tools) | 17,000 (`mcp-tools-list-size.test.ts`) | 14 bytes |
| Stdio `tools/list` | 13,196 bytes (6 tools) | 13,670 (`server.test.ts`) | 474 bytes |
| Shared descriptions (`MCP_TOOL_DESCRIPTIONS` + `MCP_PARAM_DESCRIPTIONS`) | 6,051 characters | 6,080 (`mcp-tool-descriptions.test.ts`) | 29 characters |
| Thin (MCP) briefing, fixture | 18,183 characters (18,297 bytes) | 18,200 characters (`recipe-guide-content.test.ts`) | 17 characters |
| Full (web and paste) briefing, fixture | 24,119 characters (24,261 bytes) | none | |
| `verify_draft` tool as served | 774 bytes | | |
| `update_recipe_book_description` tool as served | 909 bytes | | |

The headroom is the point again: nothing in this slice fits in a tool schema or in the ordinary thin briefing, and nothing needs to. Headless is a property of the key, not a parameter, so the tool roster and every ordinary briefing stay byte-identical (S5-Z1 to S5-Z3), and the headless copy lives only in what a headless key is served.

**Where it lives**

| # | Criterion | Evidence the verifier looks for |
|---|---|---|
| S5-M1 | The key's level is read where every key is judged: `authenticateKey`'s one statement selects it and the `Principal` carries it (`depositLevel`). No second lookup of the key anywhere, and no route or service reads the column. | Code review of `key-auth.ts`; `check:authz-seam` passes with only the registered fingerprint changes (S5-S3). |
| S5-M2 | What the level means is decided in two predicates in `authz/roles.ts`, next to each other: `keyForcesDrafts` (true unless the level is exactly `full`) and `keyMayVerifyDrafts` (true only when it is exactly `full`). Both fail closed: `drafts`, `none`, an empty string, and any unknown value force drafts and cannot verify. The doc comment names every operation that must take its authority from `keyMayVerifyDrafts`: `verify_draft` and its REST twin now, option-set resolution (slice 6) and any agent reject or not-chosen outcome later ([pr-review-helpers.md](pr-review-helpers.md) §6). | A Layer 1 table test over `full`, `drafts`, `none`, `""`, and an unknown string for both predicates; a mutation (either predicate returning true for `drafts`) fails it. |
| S5-M3 | Forcing happens in one place: the deposit's state computation in `trace.service.ts` (where `storedDraftState` is set before the one `INSERT INTO claimnet.traces`) reads `keyForcesDrafts(principal)`. `routes/check.ts`, `routes/mcp.ts`, and `apps/mcp-server` gain no headless condition. | Diff review; the S5-W1 matrix passes on every surface. |

**Storage**

| # | Criterion | Evidence |
|---|---|---|
| S5-S1 | `api_keys` gains one column, `deposit_level text NOT NULL DEFAULT 'full'`, in the house style of `key_type` (vocabulary in the schema comment: `'full' \| 'drafts' \| 'none'`, with `none` reserved for the no-deposit principal and not mintable). Every existing key reads `full`. No boolean `headless` column and no second column later (open question 41). | Migration SQL reviewed: one `ALTER TABLE … ADD COLUMN` with the default, no `UPDATE`; `npm run check:data-model` passes; after migrating a pre-slice database every row is `full`. |
| S5-S2 | The level is written once, at mint, and never changed: only the scoped-key `INSERT` in `api-key.service.ts` sets it; the daily-key and OAuth inserts leave the default; no `UPDATE` anywhere sets it (`bindBookToKey` and `consumeRefreshToken` are unchanged). | A static test scanning `apps/backend/src` for `deposit_level` outside the schema, the key-auth `SELECT`, and the one `INSERT`, failing on any `SET … deposit_level`; code review of the OAuth rotation insert. |
| S5-S3 | The seam register stays honest: the changed `claimnet.api_keys` statements are re-fingerprinted with their `why` unchanged or updated (minting still writes, listing still displays). | `check:authz-seam` diff. |

**Forcing drafts on every deposit surface.** There is one deposit statement (`INSERT INTO claimnet.traces` in `trace.service.ts`); every agent surface reaches it through `submitAndSearch`, and the stdio server reaches it through `POST /check`. Import is a JWT (human) route and is untouched.

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S5-W1 | Every check through H stores an `unverified` draft about Pat, whatever `draft` says (absent, `false`, `"false"`, `"maybe"`, `true`), on remote MCP `check_recipe` (markdown and structured), `GET /check`, `POST /check` urlencoded and multipart, and the `/check` HTML form. The same checks through K store what they store today. | DT-HDL-01 | A Layer 3 matrix per surface and `draft` value, reading the row back; the stdio forwarding test is unchanged and still passes. |
| S5-W2 | The response labels the recipe a draft and says why: it was stored as a draft because this API key is headless, a setting chosen when the key was made. "Your draft flag was overridden" appears only when an explicit false was sent (the S4-L3 rule). It gives the queue link `<FRONTEND_URL>/app/drafts?ids=<full id>` and never suggests `verify_draft`. | DT-HDL-01 | Layer 1 test of the notice function; Layer 3 on MCP and `/check` JSON and HTML. |
| S5-W3 | Headless composes with everything a check takes: `on_behalf_of` (an on-behalf draft about the named person, under slice 4's rules unchanged; the notice gives the on-behalf reason, since that one names who can review it), ratings, `decided_at`, attachments, `intent`, `known_recipes`, ride-along feedback, and a deposit into an ephemeral workspace H created. | | One Layer 3 combination test through H with `on_behalf_of`, `decided_at`, `impact`, and a feedback row; one deposit into an H-created workspace stored as a draft. |
| S5-W4 | Nothing H does publishes a recipe: an identical repeat returns its existing draft with the slice 2 repeat notice ("still a draft"), and a repeat after Pat rejected it reports the rejected state (open question 5). | DT-HDL-01 | Layer 3 for both repeats. |
| S5-W5 | H keeps every other agent surface with the same answers as K: `search_recipes` and `/check?filter=`, `get_recipes` and `GET /recipes`, `get_briefing` and `GET /briefing` apart from S5-B1, `list_my_recipe_books`, `log_feedback` and `POST`/`GET /feedback`, intents, `POST /uploads`, `POST /workspaces`, `/health/version`, and `/health/integrity`. What H reads, drafts included, is exactly what K reads (slice 2's own-drafts rule is about the person, not the key). | DT-HDL-06 | One Layer 3 test calling each surface with H and K and comparing the answers after replacing volatile ids, timestamps, and the key's own id and expiry. |
| S5-W6 | `update_recipe_book_description` through H works exactly as through K: the same answers for an owned book, a book H can read but not write, and a slug that does not exist, and the same `group.description_updated` audit row on success. Headless means one thing, that deposits are drafts; a headless agent is autonomous but directly supervised by its person (recipe `e0d2c1c9`), and agents are encouraged to keep book descriptions current (recipe `94e0e682`). Amended 2026-09-28 by the orchestrator's ruling on open question 42, which overrode the recommended refusal. | DT-HDL-07 | Layer 3 on MCP: H updates a book it writes, and H and K get the same answers for the read-only book and the missing slug. |

**Verify and resolve refusals**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S5-R1 | `verify_draft` (remote and stdio) and `POST /recipes/:id/verify` through H are refused before any lookup: the draft stays `unverified`, no evidence row, no reaction row, and no `recipe.draft_verified` audit row. The answer names the way forward: Pat confirms it in his review queue (the link, with the id as the caller gave it), or an agent on one of his ordinary keys verifies it with his quoted answer. REST answers 403 (today's `refused` branch answers 400, which is for malformed input, not missing authority). | DT-HDL-04 | Layer 3 per surface: status, text, and the row, evidence, and audit tables unchanged. |
| S5-R2 | H's drafts are reviewed like any draft: Pat confirms, rejects, or marks not chosen from `/app/drafts` exactly as in slice 3, and K verifies one with evidence exactly as in slice 2 (reported as not verified by the depositing key, since K is not H). | DT-HDL-09 | Layer 3 for the queue actions and K's verification of an H draft. |

**Key creation and display**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S5-K1 | `POST /keys/scoped` accepts an optional `depositLevel` of `"full"` (the default) or `"drafts"`; anything else, `"none"` included, is a 400 and mints nothing. The mint response and every `GET /keys` item carry `depositLevel`. The wire uses the ladder's name so `none` needs no rename later; the page calls `drafts` "headless". | DT-HDL-03 | Layer 3: each accepted value round-trips through `GET /keys`; `"none"`, `true`, `"DRAFTS"`, and `1` are 400 with no new `api_keys` row. |
| S5-K2 | No operation changes the level of an existing key: the keys routes stay mint, list, revoke, and brief; no API-key surface touches it; and the page offers no toggle on an existing key, saying to make a new key instead. | DT-HDL-03 | Route table review; the static test of S5-S2; browser. |
| S5-K3 | The keys page's scoped-key form has a "Headless" checkbox, off by default, whose description says what it does in one sentence (every recipe this key's agent checks waits as a draft for you to review, and the key cannot verify drafts; for agents you expect to run unattended). A headless key's row in the list and the just-created banner say "Headless: deposits drafts only" as text. "Copy briefing" on a headless key's row gives the headless briefing (S5-B1), since `POST /keys/briefing` composes from the key's principal. | DT-HDL-05 | Frontend unit test of the form payload and row label; Layer 3 on `POST /keys/briefing` for H; browser. |

**The headless briefing profile.** Slice 7 owns the guidance (how to draft well, what would settle each draft, triage ratings, building both); slice 5 only selects the profile and says what the key is.

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S5-B1 | A briefing for H, on every surface (`get_briefing` remote and stdio, `GET /briefing`, `POST /keys/briefing`), is the briefing K would get for the same surface plus one short section, selected from the principal and composing with the surface profile: this key is headless, so every recipe it checks is stored as a draft that only Pat and his agents see until he confirms it; it cannot verify drafts; say in each draft why he couldn't be asked and what would settle it; end the session with one `outcome` feedback row listing the draft ids left open. | DT-HDL-05 | Domain test: H's text equals K's with exactly the one section inserted, for both the thin and the full profile; Layer 3 on `get_briefing` for H and K. |

**OAuth and daily keys**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S5-O1 | Daily keys and OAuth keys are always `full` in this slice (open question 43). `POST /keys/daily` with any `depositLevel` other than `"full"` is a 400 that mints nothing, rather than silently giving a full key to someone who asked for headless; the OAuth consent and token endpoints take no level. | DT-HDL-08 | Layer 3 on `POST /keys/daily`; code review of `oauth.service.ts` (no level written; rotation unchanged). |

A note for whoever makes OAuth keys headless later: rotation mints a new `api_keys` row from `consumeRefreshToken`'s return, so that function must return the level and the new row must carry it, or a rotation would silently turn a headless connection into a full one.

**Uniform responses**

| # | Criterion | Evidence |
|---|---|---|
| S5-U1 | H's refusal is decided before any lookup, so it is not an oracle: `verify_draft` answers the same bytes (after replacing the echoed id) for Pat's own draft, a published recipe, Sam's draft, a prefix, and a random id. (The description half of this row was removed with the S5-W6 amendment: H gets K's answers there.) | Byte comparison per surface. |
| S5-U2 | H's drafts are ordinary drafts to everyone else: every slice 2 to 4 visibility rule holds for them unchanged, and Sam, Olive, and their keys get a random id's answer on every by-id surface. | The slice 2, 3, and 4 suites pass unchanged; one Layer 3 test deposits through H and runs the slice 2 uniform-response comparison for Sam. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S5-Z1 | `tools/list` is byte-identical for every key, headless or not: remote 16,986 bytes and stdio 13,196, caps unchanged. The roster is not tailored per key: H sees `verify_draft` and `update_recipe_book_description` and is refused at call time, with the way forward in the refusal. | Both size tests unchanged and green; one Layer 3 or unit test showing the remote `tools/list` for an H principal equals K's byte for byte. |
| S5-Z2 | The shared descriptions stay at 6,051 characters and their 6,080 cap is not raised: no tool or parameter description changes. | `mcp-tool-descriptions.test.ts` unchanged. |
| S5-Z3 | Every ordinary briefing is byte-identical: the thin fixture stays 18,183 characters (ceiling 18,200 unchanged) and the full fixture 24,119. The headless section is at most 400 characters, pinned by a new fixture test (thin headless at most 18,600 characters). | `recipe-guide-content.test.ts`: the existing ceiling unchanged, a new headless fixture assertion; Layer 3 byte comparison of K's `GET /briefing` before and after the slice. |
| S5-Z4 | The headless deposit notice is at most 80 characters longer than the new-draft notice a self draft gets with the same URL, and the verify refusal (S5-R1) is at most 320 characters plus the link. | Layer 1 length assertions. |
| S5-Z5 | Authentication stays one statement and the deposit adds no statement or round trip. | Code review of `authenticateKey` and the deposit path. |

**Accessibility and phone width** (browser verification run)

| # | Criterion | Evidence |
|---|---|---|
| S5-UI1 | axe finds zero serious or critical violations on the keys page with the scoped form open, with a headless key in the list, and with the just-created banner for a headless key. A violation on styles the slice did not change is recorded as pre-existing, as slice 4's record did. | axe JSON per state. |
| S5-UI2 | The checkbox has a visible label and its description is associated with it (`aria-describedby`); "Headless" on a key row is text, not colour or an icon alone; the checkbox is reachable by keyboard with a visible focus ring. | Browser; accessible-name and description assertions. |
| S5-UI3 | At 412 px the keys page has no horizontal scroll with the form open and a headless key listed. | Browser, mobile project. |

**Surfaces that must change:** the `api_keys` schema (one column), migration, and regenerated data-model doc; `authz/key-auth.ts` (the column in the one `SELECT`, `Principal.depositLevel`), `authz/roles.ts` (the two predicates), and the seam register; `trace.service.ts` (the forced state and the notice reason); `draft-verify.service.ts` and `routes/recipes.ts` (the refusal text and the 403); `routes/keys.ts` and `services/api-key.service.ts` (mint input, daily refusal, wire mappers, list); `services/briefing.ts` and `packages/domain` (the headless section, the notice reason, the verify refusal); `apps/frontend/src/pages/ApiKeysPage.tsx`; the feature file (DT-HDL scenarios out of `@unreleased` as they pass); the read-path inventory; `docs/briefing-specs/spec-decision-log.md`.

**Surfaces that must NOT change:** `tools/list` on either server, every tool and parameter description, and `apps/mcp-server` source; the visibility fragments (`authz/draft-sql.ts`, `trace-access.ts`), `resolveDraft`, and the naming rule; the idempotency key; the JWT review routes (queue, reactions, not chosen, move, delete) and import; key scope computation, `bindBookToKey`, `consumeRefreshToken`, and OAuth issuance; the daily key's scope rules; rate limits; ordinary briefings on every surface; the five ranking files and `ranking-regression.test.ts`.

**Security properties the verifier must see proven**

- Every deposit through a headless key is a draft, decided by the server from the key row on every surface, with no parameter that opts out (S5-M3, S5-W1), and nothing the key does publishes: not a repeat, not `verify_draft`, not its REST twin (S5-W4, S5-R1).
- The setting cannot be removed by the agent that holds it, or changed on an existing key by anyone: written once at mint, never updated, with no route that touches it (S5-S2, S5-K2).
- Unknown or reserved levels fail closed: anything but `full` forces drafts and cannot verify (S5-M2).
- The refusals are decided before lookup, so they reveal nothing about ids or books (S5-U1), and a headless key's drafts widen nobody's view (S5-U2).
- A headless key changes a book description exactly as an ordinary key does (S5-W6, as amended): the only write the setting constrains is the deposit.
- Daily and OAuth keys cannot be minted headless, so no path quietly produces a key that is not what the person asked for (S5-O1).
- The audit role's findings are recorded in the private repo; this log records only that the audit happened and whether blocking findings were closed.

**Briefing-copy declaration.** The headless briefing section, the headless deposit notice, and the verify refusal are agent-facing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The slice 5 PR appends a `spec-decision-log.md` entry (mirrored in the commit body) that declares a new `@unreleased` scenario in `briefing-surfaces.feature` (a briefed agent on a headless key says in each draft why its person couldn't be asked and what would settle it, rates impact and uncertainty, does not call `verify_draft`, and ends with one `outcome` row listing the open draft ids), names as watched every `briefing-surfaces.feature` scenario (the profile now also depends on the key) with the rationale that ordinary briefings are byte-identical, and records the bytes before and after for `tools/list`, the shared descriptions, both briefing fixtures, and the headless section. The when-to-draft guidance for every key stays in slice 7.

## Open design questions

Found on contact with the code (`feat/authz-seam-keys`, 2026-09-27). Each has a recommendation; the slice that meets it gets a ruling first. Scenarios marked `# Pending decision:` in the feature file, and `decide` rows in the read-path inventory, point here.

1. **Removing a parameter from the schema drops it (slice 1).** The design says the deprecated parameters can leave the tool schemas while staying "honored when sent". The MCP SDK strips keys a tool's schema doesn't declare, which is why `mcp.ts` keeps `clusters` and `max_chars` declared ("kept in the schema so existing callers stay HONORED, not silently stripped") and why `mcp-tool-descriptions.test.ts` asserts both stay in both servers' schemas (the 2026-07-26 finding, `docs/planning/finding-max-chars-mcp-contract.md`). A passthrough schema would honor them but would also accept every misspelled parameter silently. **Recommendation:** keep them declared, cut each description to a one-line pointer to `verbosity`, and meet the budget with the feedback pointer and the shared-parameter trims. Recipe `cee8fb2d`.
2. **`session_id` isn't deprecated in the schema (slice 1).** The design lists it with the deprecated parameters. The operator marked the session mechanism as intended for deprecation in favour of intents (recipe `5c55327d`), but the schema describes it as live, the briefing teaches it, and it is the only stub mechanism for callers that declare no intent (the backlog's open convergence question). **Recommendation:** leave it in slice 1. If the operator wants the bytes (about 300 per tool), mark it deprecated with a one-line description pointing to `intent`: a copy change under the regression rule, not a removal.
3. **Two fields named `impact` (slice 1).** Feedback rows already carry `impact` with a different vocabulary (`none | new | subtle | big | operational`), and `check_recipe` carries feedback rows. On the URL form the row field is `feedback_impact`, so wire names don't collide, but an agent reading one schema sees two `impact`s. **Recommendation:** keep `impact` (the briefing's own word, "uncertainty × impact"), have its description say "how much rides on this call", and pin non-crossing with DT-RAT-10.
4. **Ratings on a repeat check (slice 1).** Idempotency returns the existing trace when the same key checks the same text in the same book, and silently drops the repeat's new evidence. The design doesn't say whose ratings win. Overwriting would make an append-only surface mutate a stored field and reshuffle a queue sorted by ratings. **Recommendation:** ratings live on the recipe, first write wins, and a repeat with different ratings gets a notice (DT-RAT-08). The audit log already records each call, so a per-call history exists without a new table. Recipe `4cfd166e` covers the related leniency rule for unrecognized values.
5. **Idempotency and drafts (slice 2).** The key is `(api_key_id, group_id, claim_text_hash)`, so only the depositing key can hit it and it is not an existence oracle for anyone else (RP-04). Three consequences for the depositor:
   - The same key re-checking a draft's text without `draft` gets the draft back. It must stay a draft, or re-checking would be self-verification with nothing new; the response says so and points to verification (DT-VIS-12). So verification can't be "re-check without draft".
   - The same key re-checking a *rejected* draft's text gets the rejected draft back, and the check lands nowhere visible. **Recommendation:** the response reports the existing recipe's state; no new row.
   - A *different* key (tomorrow's daily key, a derived key) checking the same text inserts a new ordinary recipe, publishing the claim without verifying the draft. For the person's own non-headless keys that matches the model (an ordinary check is an assertion); headless keys force drafts. **Recommendation:** accept; the queue can later show "also asserted as recipe X".
6. **Does `trace_reactions` fit verification? (slice 2)** Partly. It holds one row per user per recipe, upserted ("the latest click wins"), clearable through `DELETE /traces/:id/reaction`, writable by any reader of the recipe, with the vocabulary `still_true | stale | wrong` and no "not chosen". As the verification state itself, clearing a reaction would un-verify a published recipe, and anyone who can read the draft (the depositor, later) could react on it. `fetchBookStats` also counts reactions per book. **Recommendation:** store the state on the recipe (`verified_at`, the verifying user and key, and a resolution of `verified | rejected | not_chosen`), written in the reaction's transaction only when the reactor is the person the draft is about. The reaction row stays the calibration record it is today. Verification is one-way (DT-VER-03), and setting it with `COALESCE` makes a repeat confirm a no-op, the same shape as the email-verification fix (recipe `e136701f`). Recipe `f1347b19`. "Not chosen" is a queue action, not a fourth reaction, so reaction counts keep their meaning.
7. **Where the one condition lives (slice 2).** `mayReadTrace` in `authz/roles.ts` is the single-recipe rule, applied in JS by `trace-access.ts`. Only 5 of the 45 inventoried read paths use it; 22 take their book scope from the module but filter traces in their own SQL, and nothing guards reads of `claimnet.traces` (20 non-test backend files read it directly). **Recommendation:** extend `mayReadTrace` with the draft facts, add one SQL fragment in the module in the pattern of `membership-sql.ts`, thread the viewer through `runSearchPipeline`, and add a third register to `check-authz-seam.mjs` for trace reads (S2-M1 to S2-M3). The inventory is the register's first content.
8. **Embeddings of drafts, and where vector search filters (slice 2).** Drafts should be embedded like any recipe so verification needs no re-embed; `vector_cache` is content-hash keyed and never returned. The risk is the queries: `hybridSearch` filters on `embedding_sources.group_id`, a copy of the trace's book kept in step by hand in `trace-move.service.ts`, and joins `traces` only when a keyword or structured filter is present. `evidenceSearch` filters on the evidence source's own book. **Recommendation:** read draft state from `traces` in the shared `searchPredicates` fragment (join or `EXISTS`), not from a new copy on `embedding_sources`; measure the ANN plan cost on the ranking eval stack before considering a copy (S2-M4).
9. **Counts, dates, and exemplars (slice 2).** Shared figures (the Index line's recipe count, author count, newest-judgment and last-logged dates; `totalResults`; cluster sizes; the map's `totalTraces`) must not move for a collaborator when a draft lands. **Recommendation:** every shared count and date is of non-draft recipes; the person's own agents get a separate "N drafts await review" line (DT-VIS-09, DT-VIS-18); a person's own drafts are not exemplars, since exemplars sample the confirmed corpus (DT-VIS-17). The person's own recipe count on the dashboard (RP-28) may include their drafts, since only they see it.
10. **The map is a normal surface (slice 2).** The design's exception for seeing drafts is the person's *agents*. **Recommendation:** the map excludes drafts for every viewer, the person included. That also keeps the process-wide map layout cache, which is keyed without a viewer, safe (RP-24, RP-44).
11. **Move and delete are existence oracles today (slice 2).** They return 403 for "exists, not yours" and 404 for missing, and a book owner or admin passes the delete gate for another member's recipe. **Recommendation:** for a draft, only the person it is about may move or delete it; everyone else gets the uniform 404 (DT-VIS-15). Whether the depositor of an on-behalf draft may delete it waits for slice 4.
12. **Export and import (slice 2).** The export format has no draft state, so a draft exported and re-imported comes back as an ordinary recipe. **Recommendation:** export carries draft and verification state; import restores it (DT-VIS-16).
13. **Headless verification (slice 5, but it constrains slice 2's verify operation).** The design forces drafts on headless keys but doesn't say whether they may verify. If they could, the same agent could undo the forcing a moment later. **Recommendation:** headless keys and keys derived from them cannot verify or resolve option sets (DT-HDL-04). Slice 2's verify operation should take its authority from a key property that slice 5 can switch off, rather than from "any key of the person".
14. **"Nothing new" is structural, not semantic (slice 2).** The server can require a new evidence entry with a quote and a citation that duplicates none of the draft's evidence. It can't know the quote is the person's words. **Recommendation:** enforce the structural rule (DT-VER-05, DT-VER-06), record the verifying key, and show "verified by the depositing agent" on the detail page when the verifier is the depositing key, so the person can audit it.
15. **Design-thinking §8 says agents get no update affordance.** "Agents get no update or delete affordance." Agent verification is a state change. The operator has already ruled that agents may update some surfaces (recipe `94e0e682`: "Agents can absolutely update some surfaces"). **Recommendation:** amend §8 in the slice-2 PR to name verification as a forward-only state change backed by appended evidence, which keeps §8's reasoning (no undo that invites carelessness).
16. **Who is the author of a draft on someone's behalf (slice 4).** `traces.user_id` is the depositing key's user today, and author-based rules hang off it: `mayReadTrace`'s `isAuthor`, the delete permission, `author:` search, export, admin per-user counts, and account deletion. **Recommendation:** at slice 4, `user_id` becomes the person the recipe is about and a new column records the depositing user (`api_key_id` still records the key). Get the ruling before slice 4, since it decides what "own recipe" means everywhere.
17. **Resolving an option set: whose rubric? (slice 6)** The server can't tell a rubric the person gave from one the agent wrote. **Recommendation:** resolution by an agent is the same operation as verifying the winner (quote and citation required) plus marking the siblings under the same intent not chosen, in one call. A rubric that is only the agent's own has nothing of the person's to quote, so it stays in the queue. No separate option-set concept.
18. **"Reachable through the winner's evidence" (slice 6).** A not-chosen draft stays hidden, so a collaborator following its id from the winner's evidence gets not-found. **Recommendation:** accept for now (DT-OPT-03); the winner's evidence carries the measurement, which is what a collaborator needs.
19. **The review queue's "human search page" is an API-key surface (slice 3).** `CheckRecipePage` mints the person's daily key and calls `/check`, so the search page is the person's own agent surface (RP-01, RP-02), not a JWT route. That fits: drafts appear there under the label-own rule with no new visibility path. The queue actions (confirm, reject, not chosen) are human-only and belong on JWT routes. **Recommendation:** the queue lists through `/check` search with a drafts qualifier, and acts through JWT routes; name both in the slice 3 rubric.
20. **C01-R15's wording predates the depositor rule.** It says drafts are "visible only to the attributed person until verified"; the ratified rule (recipe `94e0e682`) adds the person whose agent deposited it. **Recommendation:** the operator updates R15 when slice 4 lands; the feature file follows the ratified rule.

21. **There is no human search page yet, and the daily key would narrow the queue (slice 3; revisits 19).** `CheckRecipePage` is a check page: it always sends `trace` to `/check`, which logs a recipe, and never uses the `filter` search path. No SPA page runs the search grammar or lists search results today (the map takes a semantic `query` to focus the map, not the grammar). The org program already plans the "rich human search page" with "a JWT-authenticated route, since search is an agent-key surface today" (org-accounts-program.md). Building the queue on the daily key the page mints has three costs: that key reads only the books the person ticked for daily reads (`POST /keys/daily` uses `memberships.filter((m) => m.dailyRead)`), so a draft a scoped key deposited into any other book never reaches the queue; every queue load writes a `check.searched` audit row and spends the key's search rate limit; and the page fails outright when no book is ticked (the `DailyKeyError` state). The operator's words behind the decision were "Let's keep it DRY with the search engine perhaps?" (recipe `e3a0b211`), which is about reuse, not about the credential. **Recommendation:** a new SPA page, `/app/drafts`, served by a JWT listing route that parses the same grammar with the `packages/domain` parser and composes the same authz fragments over the person's live memberships; agents keep `search_recipes` and `/check?filter=` with the same qualifiers. The route is the first piece of the planned human search page, not a second engine. Recipe `d7319191`.
22. **Queue order: product or lexicographic, and which age (slice 3).** DT-QUE-02 sorts by impact, then uncertainty, newest first, and expects (high, high), (high, low), not rated, (low, high). The design's own phrase is the briefing's "uncertainty × impact" (recipe `0e3cb40e`), and design-thinking §Reviewing drafts puts unrated drafts "in the middle". A product with unrated as medium gives (high, high) 9, not rated 4, (high, low) 3, (low, high) 3; lexicographic lets any high-impact certain call jump every unrated draft. "Newest" is also ambiguous for backfilled drafts, whose judgment date (`decided_at`) can be years old while they have waited in the queue for minutes. **Recommendation:** order by impact × uncertainty (low 1, medium 2, high 3, unrated as medium per rating), then higher impact, then most recently deposited (`created_at`, keeping the "reverse-chronological within a tier" rule from §Dashboard as a Feed), then id; edit DT-QUE-02's expected order to (high, high), not rated, (high, low), (low, high). Recipe `6fa4a9c9`.
23. **The rating filters would land in files the ranking guard forbids (slice 3).** Structured search filters are built by `buildStructuredTracePredicates` in `vector-search.service.ts`, and qualifier-only ordering lives in `fetchCorpusTraces` in `search-pipeline.ts`. Both files are on `ranking-isolation.test.ts`'s list, which fails on the words `impact`, `uncertainty`, or `triage`. Loosening the guard would remove the only static proof that ratings never rank. A rating filter is a selection the viewer asked for, not a score, so it is within "shape display and triage only". **Recommendation:** keep the guard unchanged; build the rating predicate and the triage order in a module outside the five files and pass the predicate in as an opaque fragment, the way `traceIdVisibleTo` reaches `hybridSearch`; apply the triage order only to the qualifier-only `is:draft` listing, which does not need the ranking pipeline at all. `impact:` and `uncertainty:` stay general (any recipe the viewer can read), since readers of a recipe can already see its ratings on the detail page.
24. **`is:draft` against the exclude-own default, and what it means from slice 4 (slice 3).** `search_recipes` excludes the caller's own recipes unless an `author:` qualifier is present (recipe `303e17cf`). In slice 3 every draft a viewer can list is their own, so `is:draft` under that default returns nothing. From slice 4 a viewer can also see drafts they deposited about someone else. DT-QUE-01 already names "drafts Dana deposited about Pat", which cannot exist until slice 4. **Recommendation:** `is:draft` replaces the exclude-own default as `author:` does, and means "unresolved drafts about me" (the review queue is for the person, not the depositor; a depositor finds their deposits with `author:me` and sees the label). Edit DT-QUE-01 to the slice 3 cast (Pat's drafts from two keys, Sam's drafts, published recipes) and move the Dana case to a slice 4 scenario.
25. **Honest refusal on the person's own path (slice 3).** The carried follow-up changes `verify_draft` and its REST twin. The reaction route has the same shape: when the person reacts on their own draft without write authority on its book, it answers the missing-id 404 and records nothing (the F78 fix). In the queue that reads as "not found" on a draft the person is looking at. **Recommendation:** apply the same rule to the JWT resolution paths: the draft's subject, who can read it, gets "needs write access to this recipe book"; everyone else keeps the uniform 404. The queue shows such drafts with the actions unavailable and the reason.
26. **How agents learn the queue link, and signing in loses it (slice 3).** The design says an agent hands its human `/app/drafts?ids=…`, but no agent-facing copy names the URL, and the deposit notice points to "the recipe's page". Separately, a signed-out person who opens any `/app` link is sent to sign in and then to the dashboard (`routeTree.ts` redirects to `/auth/login` with no return target), so the link's ids are lost. **Recommendation:** the deposit notice gives the queue link for the new draft in place of "on the recipe's page" (at most the URL plus 20 characters); sign-in returns to a same-origin `/app/` path only.
27. **One click, irreversible (slice 3).** The design asks for "one action in the review queue", and resolution is one-way, so a mis-click on confirm publishes a draft to collaborators for good. **Recommendation:** keep one click with no confirmation dialog, as designed, and make each button's accessible name and visible label say what it does (confirm publishes to the named book; reject and not chosen keep it private). Revisit only if the browser run or the operator's use shows mis-clicks.

Found while writing the slice 4 rubric (2026-09-27, at `0949691`). Each resolves an edge with the obvious default; none is escalated.

28. **Identifying the subject (slice 4).** The design puts an email on the wire ("`on_behalf_of` (email, default the key's user)"), and an account has exactly one email (`unique("users_email_unique").on(t.email)` in `packages/db/src/schema/users.ts`; there are no secondary addresses or aliases, so `pat+x@…` is simply a different, unknown email). The operator gated naming on "the user existing in the recipe book itself with write access" (recipe `94e0e682`). **Recommendation:** match `lower(email)` as `author:` already does (`WHERE lower(email) IN (…)` in `trace.service.ts`), and accept only a person who holds a live write-capable membership in the target book and whose account can act (`membershipOf`, `WRITE_ROLES`, and `activeUserPredicate`, which on this branch reads `u.email_verified_at IS NOT NULL` and which the unmerged F75 fix extends to waitlisted accounts, recipe `88054ec9`), so that anyone who can be named can resolve the draft at once. Everything else, including an unknown email, gets one uniform refusal that deposits nothing and names the way forward (recipe `50824e4d`); no draft waits for an email that has no account yet, since that is the org-domain case the rulings deferred. Naming yourself is an ordinary check (DT-OBO-05), and a user id is not accepted on the wire, which keeps the parameter as the design named it. The accepted case need not look like a refusal: a book's writers can already see its members ("Members (2): …" on the briefing's Index for a shared book). Recipe `19b3f331`.
29. **Where the subject is stored, and whose idempotency (slice 4).** Slice 2 built the fragments so that "slice 4 changes `subjectOf` in `draft-sql.ts` and nothing else". A nullable column read as `COALESCE(subject, user_id)` would keep ordinary rows untouched but put a function around the column in every fragment and the partial index. Separately, the idempotency key is `(api_key_id, group_id, claim_text_hash)`, so the same key depositing the same text about Pat and then about Sam, or about itself and then about Pat, would get the first recipe back and lose the second claim. ~~**Recommendation:** a `NOT NULL` subject column filled with `user_id` for every existing and ordinary row, and the subject added to the idempotency key.~~ Recipe `502f65b3`, superseded. **Amended (recipe `b89db1f0`):** once verification moves the author to the subject, the subject is needed only while a draft is unverified (and on rejected or not-chosen drafts, which stay the depositor's), because only then are two people involved and `user_id` holds one of them. **Recommendation:** one NULLABLE subject column, NULL for every ordinary recipe and self draft, no backfill, cleared at verification; the fragments read `COALESCE(subject, user_id)`; no index work unless a measured count is slow. Keep the idempotency key as it is: the one case the subject would separate (one key, one book, identical text, two people) is rare, is answered as any identical repeat is today, and a nullable column in a unique key would also need `NULLS NOT DISTINCT` to keep ordinary repeats idempotent.
30. **What the depositor may do to an on-behalf draft (slice 4; question 11's remainder).** Ruling 16 keeps "deletion by the author" and the author is the depositor. Moving is different: the subject must hold write access in the draft's book to review it, so a depositor's move could strand the draft where its subject cannot act. **Recommendation:** the depositor may delete it through the human delete route (withdrawing a wrong attribution is the accountable person's job) but may not move, verify, react to, or mark it not chosen; the subject may move or delete it as in slice 2. The depositor's refusals are honest, since she can read the draft (the S3-F1 rule). Recipe `5f0717b7`. **Amended (recipe `b89db1f0`):** the depositor may delete her deposit only while it is unverified, when she is its author; once the subject verifies it, it is the subject's recipe under the normal author rules (he may delete or move it; she has what any member has). Rejected and not-chosen drafts stay hers, and the subject keeps his slice 2 right to delete them.
31. **What the depositor's agents see (slice 4).** `traceVisibleTo` already admits the depositor's unverified drafts into their result sets (`ownDraft` is "subject or depositor"), so Dana's agents would see her on-behalf drafts in check results. Keeping them out would need a second audience in the fragment; letting them in helps a backfill agent avoid depositing the same decision twice. [F83] shows draft state to the subject only, so Dana's detail page would show her unresolved draft as if published. **Recommendation:** keep the one fragment (depositor's agents see them, labelled "about `<subject>`"); under `search_recipes`' exclude-own default they appear only with `author:me` or `author:anyone`, never with `is:draft` (ruling 24). Show the depositor the unpublished states of what she deposited, since she can only read those because of the draft rule and needs the label to know they are not published; a verified one reads as ordinary to her, and resolution details stay the subject's. No notification of resolution and no Drafts-line figure for the depositor (the thin-context default, `ef844c32`).
32. **What the subject's queue item shows about the depositor (slice 4).** The queue item shows the depositing key's label, which for a colleague's key says little and is set by that colleague. The ratings on the item are the depositing agent's, so a depositor could rate everything high to sort first. **Recommendation:** show the depositor's email beside the key label (accountability by design is the point of ruling 16) and word the ratings as the depositing agent's, as the detail page already does; add no rating correction. Ratings only order the person's own queue and never rank (S3-M3), and the person can narrow to one depositor with `author:` (question 34).
33. **Attribution once published (slice 4).** A verified on-behalf recipe is authored by Dana and claims Pat's judgment in the first person. Showing only the author would misattribute it; [F83] hides draft-process details (state, verifier, key, dates) from everyone but the subject, and naming the subject tells a reader it was once a draft. **Recommendation:** show "on behalf of `<subject email>`" wherever the author is shown, for every reader: whose taste and judgment a recipe records is the claim's meaning, not its process ("**On behalf of**: whose taste and judgment the recipe claims to record", [drafts-and-triage.md](drafts-and-triage.md) §The model), and the Truthfulness principle asks every claim to be true as displayed. [F83]'s process details stay hidden. Only on-behalf rows carry the field, so ordinary rows cost nothing. **Amended (recipe `b89db1f0`):** the operator accepted the label ("Yes, that's fine"), but with ownership moving at verification a published on-behalf recipe is simply the subject's recipe, so there is nothing left to attribute. **Recommendation:** no on-behalf label after verification; the "deposited by" and "about" labels exist only on unpublished drafts, where they are shown only to the two people involved. That also removes the tension with [F83]. The depositing key's label is the remaining trace of the depositor on a published recipe (open question 40).
34. **`author:` and the subject (slice 4).** `author:` selects `user_id`, the depositor, and ruling 16 keeps that meaning. So `author:pat` will not find recipes Dana deposited about Pat after he verifies them, which matters for bulk backfill. **Recommendation:** leave `author:` as it is and add no qualifier in slice 4; in Pat's queue `author:<Dana>` usefully narrows to one depositor. File a backlog item for a subject qualifier (for example `about:`) with the rich human search page's qualifiers (org-accounts-program.md §4.4 already lists `source:backfill`), to be built when backfill ships. **Amended (recipe `b89db1f0`):** with the author flip, `author:pat` finds every on-behalf recipe Pat verified, which removes the backfill gap. **Recommendation:** no subject qualifier and no backlog item; `author:` follows the flip, and in the queue `author:<Dana>` still narrows unverified drafts to their depositor.
35. **Account deletion and removal (slice 4).** The cascade collects recipes by author (`SELECT id FROM claimnet.traces WHERE user_id = …` in `user-delete.service.ts`), and the operator's rule is "deletion removes what that person authored" (recipe `52bbbdc8`). **Recommendation:** apply it literally. The depositor's deletion takes her on-behalf recipes in every state (a verified one leaves its book; the subject can re-deposit it about himself). The subject's deletion removes nothing the depositor wrote: unresolved drafts about him become the depositor's alone (visible and deletable by her, resolvable by nobody), and published ones show the subject as a deleted account. The subject is an id, so a later account with the same email inherits nothing. Leaving a book deletes nothing either way (S4-A1, S4-A2). Recipe `5f0717b7`. **Amended (recipes `b89db1f0`, `23657e4e`):** the author rule stays literal, but the author now changes at verification, so the outcome changes. The depositor's deletion takes her unverified, rejected, and not-chosen deposits and no verified ones, which are the subject's. The subject's deletion takes everything he authored, verified on-behalf recipes included. Unverified drafts about him are still authored by the depositor, so the author rule alone would leave them behind, unresolvable forever. **Recommendation:** drafts about a departing subject go with him, by one addition to the cascade's collection (unverified drafts whose subject is the departing person, composed from `draftAwaitingReviewBy` in the module); rejected and not-chosen drafts about him stay the depositor's, as the ruling keeps them hers. Books follow the simplified cascade of `23657e4e`: nobody is ever added to a book, a book with no members left but others' recipes stays memberless (moved into the personal organization of its earliest recipe's author when the departing person's organization goes), and a book is deleted only when it holds no recipes.
36. **Export and import (slice 4).** Export (RP-30) is by `user_id`. Import restores draft state (slice 2) and would, unchanged, turn an on-behalf row into the importer's own draft or, worse, restore a "verified" state the depositor could never have produced. **Recommendation:** export stays by author and carries the subject's email; the subject's export does not carry what others wrote about him (it is not his authored content, ruling 16). Import applies the deposit's naming rule to a row whose subject is not the importer, restores it as `unverified` whatever the file says, and refuses it with the uniform naming answer otherwise. **Amended (recipe `b89db1f0`):** export and admin counts follow the flip because both are by author: a verified on-behalf recipe is in the subject's export and count, and an unresolved one in the depositor's. A verified row in a file carries no subject (it was cleared), so it imports as the importer's ordinary recipe, as today.
37. **Volume and abuse (slice 4).** A backfill run may deposit hundreds of drafts about one person, and a hostile depositor could flood a colleague's queue. **Recommendation:** no new limit in slice 4. The per-key check rate limit already applies; the depositor must be a writer of a book the subject also writes, so the trust boundary is book membership; the subject can narrow the queue to a depositor (question 34) and leaving the book drops everything from it. No bulk action is planned; the queue's use will show whether one is needed.
38. **Budget headroom (slice 4).** Remote `tools/list` has 147 bytes under its cap and the shared descriptions 32 characters. One new property fits under the served cap with a short description; no new description fits under the shared total. **Recommendation:** hold both served caps (they measure the real per-turn cost), and raise the shared-description cap by no more than the new description's length with a dated comment rather than trimming unrelated copy for a proxy measure, the same trade slice 2 made and the orchestrator accepted. If the operator would rather hold that cap too, the obvious trim is question 2's: `session_id`'s 362-character description down to a one-line pointer to `intent`, a declared copy change.
39. **The audit trail (slice 4).** A deposit writes one `recipe.checked` audit row (`trace.service.ts`), with the key's user as actor. **Recommendation:** add the subject's user id to that row's metadata for an on-behalf deposit and add no new action; a refused naming follows whatever the check path already does for a refused deposit and never records the named email, which may belong to someone with no account, so the audit log does not become a list of addresses people tried. **Amended (recipe `b89db1f0`):** the audit trail is now the only durable record of who deposited a verified on-behalf recipe (the account-deletion cascade keeps `audit_log`; `traces.api_key_id` is not durable, since revoking a key deletes its row). Today the deposit's audit write is best-effort ("Non-blocking — don't fail the recipe check if audit logging fails", `trace.service.ts`). **Recommendation:** for an on-behalf deposit, write the `recipe.checked` row in the deposit's transaction, and write the verification's audit row, naming the previous author, in the same transaction as the author change, so no verified recipe can lose its depositor to a failed write. No schema change. One caveat for later: the append-only log has no retention job today (recipe `569fc2cc`), and one added later must keep these rows or copy the fact elsewhere first. Recipe `c6aa9587`.
40. **The depositing key's label after the author flip (slice 4, new with recipe `b89db1f0`).** `traces.api_key_id` stays the depositing key (it is "which agent session created this trace", and the idempotency key includes it), so after Pat verifies Dana's draft, surfaces that show a recipe's key label (the detail page's `apiKeyLabel`, the queue's key label) would show a label Dana chose under Pat's authorship. **Recommendation:** show a recipe's key label only when that key belongs to the recipe's author (a join condition where the label is read), and show nothing otherwise; the audit trail keeps the depositor for anyone entitled to it. Leave `api_key_id` itself untouched, so "verified by the depositing agent" and idempotency keep working.

Found while writing the slice 5 rubric (2026-09-28, at `7bcedba`). Each resolves an edge with the obvious default; none is escalated.

41. **How to store the ladder, and whether "nothing" is built now (slice 5).** The design asks for full, drafts only, and nothing to be "designed once". A boolean `headless` column is the smallest thing for this slice but needs a second column, or a type change, when "nothing" arrives. "Nothing" itself is not a small step: every key must name a default write book (`defaultWriteGroupId: uuid("default_write_group_id").notNull()` in `packages/db/src/schema/api-keys.ts`, and the key form requires one, [derived-agent-keys.md](derived-agent-keys.md) point 3), and the design leaves the reviewer's level open: "Whether reviewers get drafts-only or no-deposit is a decision for when that principal is built." **Recommendation:** one text column, `deposit_level`, `NOT NULL DEFAULT 'full'`, in the house style of `key_type` (vocabulary in the schema comment, no new pattern); read in `authenticateKey`'s one statement and interpreted fail-closed in the module (anything but `full` forces drafts and cannot verify). Only `full` and `drafts` are mintable. `none` is reserved in the vocabulary and built with the principal that needs it, together with relaxing the NOT NULL default write book. Because the reading fails closed, a `none` row written early would still be drafts-only, never full. Recipe `b6241b3f`.
42. **Book descriptions (slice 5).** Every recipe goes through the forced-draft deposit, but one other agent write reaches collaborators at once and has no draft form: `update_recipe_book_description`, whose own description says "It shapes how every future agent reads and writes there". The headless setting's purpose is that "nothing it writes reaches anyone before the human confirms it" (recipe `e263dc40`). Feedback also renders on a recipe's detail page, but the autonomous-agent persona keeps feedback even for an agent that deposits nothing (design-thinking.md §Agent Type D), and DT-HDL-06 keeps it for headless keys. **Recommendation:** refuse `update_recipe_book_description` for a headless key, before any lookup, with an answer that says the person can change the description on the Recipe Books page or through an ordinary key; keep feedback, intents, uploads, and ephemeral workspaces (a workspace is the person's own book, and its recipes are drafts anyway). This is one condition, and it reopens no scope the person chose. Recipe `4af6394a`. **Overridden (orchestrator, 2026-09-28):** a headless key updates a book description like any other key, with no refusal. A headless agent is autonomous but still directly supervised by its person, autonomous only to save their attention (recipe `e0d2c1c9`), and agents are encouraged to keep book descriptions current (recipe `94e0e682`). Headless means exactly one thing: its deposits are drafts. S5-W6 and DT-HDL-07 are amended to match.
43. **Can daily or OAuth keys be headless? (slice 5)** The design attaches the setting to making a key for an unattended agent. Daily keys are the dashboard's one-click links for a session the person is in. OAuth keys come from connector sign-ins, and their rotation mints a fresh row each hour from the consumed one, so a headless OAuth connection would need a consent-screen choice and a rotation that carries the level forward. The first real consumer, the PR sweep, runs in the person's own agent, and the autonomous-client research lands on long-lived header keys first ([pr-review-helpers.md](pr-review-helpers.md) §6.1). **Recommendation:** only scoped keys can be headless in slice 5; `POST /keys/daily` refuses a non-`full` level loudly instead of ignoring it; OAuth takes no level. If the operator later runs unattended agents through a connector (a scheduled cloud agent, for example), add the consent choice then, with `consumeRefreshToken` returning the level so rotation keeps it. Recipe `7931ac43`.
44. **Derived keys and the level (derived keys, recorded now).** Derived keys are not built (no `parent_key_id` at `7bcedba`), so DT-HDL-02 cannot be built in slice 5. DT-HDL-02 says a request for a non-headless child quietly yields a headless one, while derived-agent-keys.md says scope that would widen is "rejected loudly". **Recommendation:** treat the level exactly as scope: a derived key's level is at most its parent's (full, then drafts only, then nothing); omitted, it inherits the parent's level (inheriting can never widen); asking for a wider level is rejected loudly, like a wider book. So a key derived from a headless key is headless and, like its parent, cannot verify or resolve. Recorded in [derived-agent-keys.md](derived-agent-keys.md) §What keeps it safe; DT-HDL-02 is edited to match and retagged to the derived-keys work.

## Orchestrator rulings on the open questions (2026-09-27)

The operator's standing instruction is to take the obvious, standard answer and escalate only what is both high impact and genuinely uncertain (recipes `061a7926`, `eb4b77eb`). On that basis:

- **Accepted as recommended:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19. For 1, the design doc's "removed from the tool schemas" line is corrected in the same commit. For 3, the check-level ratings keep the operator's words (`impact`, `uncertainty`); the descriptions say plainly that a feedback row's `impact` is a different field, and S1-B6 tests that they never cross.
- **15:** amend design-thinking §8 in slice 2, citing the operator's 2026-09-19 correction that agents may update some surfaces and are encouraged to keep book descriptions current (recipe `94e0e682`).
- **16: decided by the operator (2026-09-27, recipe `9e663b62`).** Every recipe's author is always the person who made the API key the agent used: "Accountability by design." `traces.user_id` stays the depositing key's owner, and "on behalf of" is a separate subject field naming the person the draft is about. Author-based rules (read access for the author, deletion by the author) keep their current meaning; draft visibility rules key off the subject as well.
- **20:** C01-R15 corrected in the same commit to include the depositor.

No question is escalated to the operator at this point. Anything that turns out to need him during a slice is raised then, with the evidence.

## Slice 1: orchestrator rulings after implementation (2026-09-27)

- **DT-RAT-05's "POST /check with a JSON body" was a rubric error.** The spec assumed a surface that doesn't exist: `POST /check` takes urlencoded and multipart bodies. No client has asked for JSON bodies, and adding them would widen the primary agent surface and its rate-limit key extraction for no current need. The row now reads "POST /check with a form body", which the slice covers; the implementing agent's `[DECISION NEEDED]` backlog item is withdrawn. Revisit only if a client needs JSON bodies.
- **Thin-briefing ceiling raised 18,000 → 18,200 characters** (the `intent` depth moved from the tool schema into the briefing's "How to check"). Accepted: the always-loaded tool list fell by 2,226 bytes on the remote server, so the net per-turn context still went down, and the briefing stays the one home for the concept (recipe `d0a661f1`, under the thin-index ruling `ef844c32`).
- **Test-first held only for the domain tests**; the Layer 3 and budget tests were written alongside the code. Recorded as a process deviation; the verifier checks that each test fails against the pre-slice code where that is cheap to show.

### Slice 1: rulings on the verification follow-ups (2026-09-27)

Slice 1 is **accepted**. Follow-ups, handled at the start of slice 2 as their own commits:

- **DT-RAT-02 (partial):** the scenario is edited, not the code. The markdown report stays silent about ratings the agent didn't send; the structured and JSON forms carry `null`, which the published schema defines as "not rated". Silence in the agent-facing text is the thin-context default the operator has ruled for repeatedly (`ef844c32`), and "not rated" on every check would be noise on every response.
- **Dropped phrases:** restore the meaning of "stubs reset" (losing or omitting the intent means recipes render in full again) in the briefing's new intent paragraph, and fix its awkward "say to context compaction" phrasing. "Capture only" on `agent_id` stays dropped: the short description says it labels the lineage, and nothing reads it for authorization.
- **Wrong-type rating on MCP fails the whole check:** fix it so a non-string rating is treated like any unrecognized value (stored unrated, with the notice, the check deposits), matching S1-B3's intent on every surface.
- **Plural notice** when both ratings are invalid.
- **Repeated wire parameter** (`impact=low&impact=high`) keeps taking the first value, as other `/check` parameters do; documented, not changed.
- **Open-record feedback items** letting the `recipe_id` alias and string `top_similarity` through on MCP: accepted, since it matches REST and the service validates each row.
- **A non-object feedback row fails the whole call** despite the "a rejected row never blocks this call" description: pre-existing; fix it in the same commit as the wrong-type rating, since it is the same class.
- **Export doesn't carry the ratings:** folds into slice 2's export work (open question 12).
- **Layer 4 detail-page check:** on the operator's handoff list.


### Slice 2 build notes (implementing agent, 2026-09-27)

Written by the builder (agent `a-drafts-slice2-2026-09-27`) for the verifier; the verification record below it is the verifier's to write. Soup.net intent `int_gk6hwTWT7E0CYKGGtYjm7hAP`.

**Shape.**

- **Storage:** one text column `traces.draft_state` (`unverified | verified | rejected | not_chosen`; NULL for a recipe that was never a draft), plus `draft_resolved_at`, `draft_resolved_by_user_id`, and `draft_resolved_by_key_id` (NULL when the person resolved it with a reaction). Migration `0038_traces_draft_state`, with a partial index on `user_id` over unpublished drafts for the "awaiting review" count. One state column rather than a flag plus a resolution, so "a draft that is not a draft" can't be stored.
- **The rule, once:** `authz/roles.ts` (`mayReadTrace` with draft facts, `isPublishedDraftState`, `mayResolveDraft`, `keyMayVerifyDrafts`) and `authz/draft-sql.ts` (`publishedTrace`, `traceVisibleTo` with a viewer or `SHARED_AUDIENCE`, `traceIdVisibleTo`, `traceReadableById`, `draftAwaitingReviewBy`). The subject and depositor columns are both `user_id` today (ruling 16); slice 4 changes `subjectOf` in `draft-sql.ts` and nothing else. `draft-sql.test.ts` proves the SQL and JS forms agree on every combination of facts against a real database and fails when any backend file outside the module compares `draft_state` by hand.
- **Resolution:** `authz/draft-resolution.ts` (`resolveDraft`) is the one statement that moves a draft out of `unverified`: one-way, COALESCE-guarded, subject check inside the UPDATE. The reaction route writes it in the reaction's transaction; the agent operation writes it before attaching evidence, in one transaction.
- **The agent operation:** a separate `verify_draft` MCP tool (remote and stdio) with a REST twin, `POST /recipes/:id/verify`, rather than a mode of `check_recipe` or a kind of feedback row (recipe `6ae9a299`, following `6201b444` and `c6cff3ad`). The served remote `tools/list` went 15,864 → 16,854 bytes, so its cap moved 16,000 → 17,000 with a dated comment; stdio went 12,074 → 13,064, inside its unchanged cap.
- **Seam guard:** `scripts/check-authz-seam.mjs` gains `TRACE_READS`, 26 files, 7 of them composing the fragments. Unlike the two older registers it fingerprints the whole statement around each mention (the mentioning line to the end of its tagged template), because the draft condition sits on the line after `FROM claimnet.traces`; deleting that line in `recipe-lookup.service.ts` was shown to fail the check. A planted unregistered read in a new file fails it too.

**Build-both (first trial).** S2-M4 left "join or `EXISTS`" open, and both options were cheap, so both were built and measured: A, a positive `EXISTS` probe on `traces` by primary key; B, a `NOT EXISTS` probe against a partial index of unpublished drafts. Recipes: option A `6fa1772e`, option B `540e1069`, final choice `2625feed`; feedback rows `3482de0a` (A) and `3b140524` (B) carry the measurements. Synthetic corpus of stub 3,072-dimension vectors with 4% drafts, `hybridSearch`'s exact predicates, 25 timed runs after 3 warm-ups, on the throwaway 5574 stack:

| Corpus | Variant | Count p50 | ANN top-60 p50 | HNSW used |
|---|---|---|---|---|
| 5,000 | none (pre-slice) | 3.8 ms | 70.4 ms | no |
| 5,000 | A | 5.8 ms | 48.4 ms | yes |
| 5,000 | B | 4.0 ms | 69.2 ms | no |
| 20,000 | none (pre-slice) | 16.6 ms | 51.8 ms | yes |
| 20,000 | A | 32.0 ms | 51.6 ms | yes |
| 20,000 | B | 29.9 ms | 51.7 ms | yes |

Neither variant costs the nearest-neighbour query anything; both roughly double the exact count at 20,000 recipes (+15 ms). B saves about 2 ms on the count and needs a second partial index. A was chosen. A copy of the draft state on `embedding_sources` was not considered further, since the cost it would save is small. The timings include the round trip; `EXPLAIN ANALYZE` put the ANN execution at about 10 ms for all three at 20,000. The rubric asks for the numbers "on the ranking eval stack"; that stack belongs to another session, so the measurement ran on this build's own stack instead (the verifier can re-run `bench-draft-condition.mjs`, which the builder can hand over).

**Interpretations the verifier should check.**

1. Related evidence (RP-40) comes only from published recipes for every viewer, the person included: it is quoted without a label, so an own draft there would read as confirmed. Own drafts reach their person as labelled results instead.
2. Every figure on the briefing Index line now counts published recipes only, including feedback and reaction counts, so a collaborator's line never moves when a draft is annotated. The rubric lists "`fetchBookStats` reaction counts" under must-not-change; the reaction vocabulary and meaning are unchanged, but reactions on unpublished drafts no longer count toward a book's shared figure. Flagged in case the intent was stricter.
3. A viewer's result sets include their own `unverified` drafts only; `rejected` and `not_chosen` leave their results (DT-VER-02) but stay readable by id, labelled.
4. Move and delete of an unpublished draft are for its subject alone: a book owner, a book admin, and a system user all get the missing-id 404 (open question 11 said "everyone else").
5. `SearchPipelineParams.audience` and `HybridSearchParams.audience` are optional and default to `SHARED_AUDIENCE`, the strictest view, so `ranking-regression.test.ts` passes unchanged and a caller that forgets the parameter hides every draft rather than showing one.
6. Import validates `draftState`, `impact`, and `uncertainty` strictly (an unknown value is a row error), unlike the check path's lenient parsing: an import file is not an agent guessing. It restores state on insert only; an overwrite of an existing recipe keeps its current draft state.
7. An unrecognized `draft` value on a check is taken as a draft, with a notice.

**Test-first.** The authz Layer 1 tests (`draft-sql.test.ts`, the draft cases in `trace-access.test.ts`), the domain tests (`drafts.test.ts`, the renderer and briefing cases), and the frontend label test were written before their implementations and failed first. The Layer 3 suite (`routes/drafts.test.ts`, 35 tests) was written after the service code and run against it; its teeth were shown by a mutation run with `publishedTrace` and `traceReadableById` forced to `TRUE`, which failed 16 of its tests.

### Slice 2: orchestrator rulings after implementation (2026-09-27)

- **Index figures count published recipes only**, reactions and feedback included. That is the rubric's intent (a hidden draft must not move anything a collaborator can see); the must-not-change wording was ambiguous and is clarified above.
- **S2-M4 measured on a throwaway stack** instead of the ranking-eval stack, which belongs to another session: accepted.
- **Move and delete of a draft return the missing-id 404 to everyone but its subject, system users included:** accepted. Drafts are the person's until verified; operators have other means for incident work.
- **`verify_draft` as its own tool** (recipe `6ae9a299`) rather than a mode of `check_recipe` or a feedback kind: accepted. It spends 990 of the 2,226 bytes slice 1 saved (remote `tools/list` 16,854, cap moved to 17,000), still 1,236 bytes under the pre-slice-1 roster.
- **Build-both was used for the first time** (EXISTS versus join for the draft condition in search), with both options recipe-checked, measured, and the final choice checked. One lesson for the pattern: both option recipes landed in the production corpus as ordinary recipes, because the production server doesn't have the `draft` parameter yet. That is what the operator proposed for this trial ("recipe check both, and leave feedback on them later and then recipe check the final decision"); the feedback rows mark which option lost. Once drafts ship, the options can be drafts instead, which keeps the losing option out of everyone's results.
- **Import reveals whether a recipe id exists** (pre-existing, found during this slice): filed privately for the audit.

### Slice 2: orchestrator rulings on the security audit and the verification (2026-09-27)

Recorded by the implementing agent from the orchestrator's message of 2026-09-27; the audit itself is private. The audit recommended merging once F78 is fixed.

1. **F78 and F79, one rule.** Resolving a draft (verify, reject, and later not-chosen), by any path (`verify_draft`, `POST /recipes/:id/verify`, the reaction route), requires write authority on the draft's book at that moment: for keys, the book is in the Principal's effective write scope; for people, a live membership with a role that can write. The rule lives once in the authz module next to `mayResolveDraft`, and the subject rule still applies. A resolve without write authority gets the same uniform not-found answer as a missing id.
2. **F80.** Close the recipe register's gaps (unqualified `traces`, aliased or interpolated Drizzle references, `db.query.traces`, the trace link tables), and make deleting the draft condition from the main search predicates and from the Index figures fail the guard itself, keeping the fingerprint style.
3. **F82.** Render `related_trace_ids` filtered by the viewer's access through the module; storage is unchanged.
4. **F83.** On shared surfaces a verified draft is an ordinary recipe: no draft state, verifier, key, or dates; verification details are shown only to the draft's subject, and "by you" only when the viewer resolved it. Import may carry the draft state, but never resolution attribution or timestamps: an imported resolved draft is attributed to the importing user at import time, and an imported timestamp never blocks a later real verification.
5. **F81 accepted for now** (import reveals whether an id exists): it needs the id first, and F82 removes the known source of hidden ids. Backlog item added with the trade-off.

From the functional verifier's record (`a512631`), handled in the same pass: the guard must see fragments that feed a statement from above it (planted as a guard test), and the map's shared audience must be structural, since the process-wide layout cache key names no viewer. The shared-description cap rise 5,550 → 6,000 is accepted with the tool-list one.

**How each is fixed:**

- F78, F79: `hasWriteAuthority` and `WRITE_ROLES` in `authz/roles.ts`; `mayResolveDraft` takes `canWriteBook`; `resolveDraft` takes the authority and checks it inside its UPDATE (`writeAuthoritySql`: the key's write scope via `inBooks`, or a live write-capable membership via the membership fragment). `verifyDraft` answers `not_found_or_unreadable` when the book is not in the key's write scope; the reaction route answers the missing-id 404 and records nothing when the reaction would resolve the viewer's draft without write authority. A verification that loses a race now reports `already_resolved` instead of the misleading "only the person" copy.
- F80: the recipe rule now matches qualified and unqualified SQL names of `traces`, `embedding_sources`, `trace_evidence`, `trace_references`, `check_feedback`, and `trace_reactions`, the Drizzle objects under any import alias or namespace, `${table}` interpolation, and `db.query.<table>`; every line calling a draft fragment is fingerprinted with the statements, so a predicate built above its statement is covered. `authz/seam-guard.test.ts` plants each bypass (including deleting `traceIdVisibleTo` from `searchPredicates` and dropping `publishedTrace` from `fetchBookStats`'s scope) and expects the guard to fail. 27 files registered.
- F82: `readableTraceIds` in `authz/trace-access.ts` fetches the facts in one statement and applies `mayReadTrace`; `GET /traces/:id/feedback` filters every row's `relatedTraceIds` through it.
- F83: `readableTraceFor` returns draft state and resolution details only to the subject, with `draftResolvedByViewer`; list rows use `draftStateShownTo`; the frontend says "by you" only when `draftResolvedByViewer`. Import ignores `draftResolvedAt` from the file, attributes a resolved state to the importer at import time, and leaves an unverified draft with no resolution fields; `resolveDraft` writes the resolution columns outright instead of keeping an earlier value.
- Map cache: `mapLayoutCacheKey` takes the audience typed as `SharedAudience` and throws on any other; the map route runs the pipeline and builds the key from one `MAP_AUDIENCE` constant. A cold-cache Layer 3 test (the draft's own person loads a new book's map first, then the collaborator gets the cached layout) fails when the pipeline is switched to a viewer audience (shown by mutation).

### Slice 2 accepted (2026-09-27)

The functional verification (`a512631`) accepted slice 2 with follow-ups, and a separate read-only security audit found one P2 and five P3 findings (F78 to F83, private repo). The implementation agent fixed them (`eb5542c`, `d006de8`, `d5d84e8`), and the audit's live fix-verification at `d5d84e8` recommends merging: every fix held, and no break attempt on the new write-authority rule succeeded (concurrency, scope changes between read and resolve, OAuth keys, removed members). The security-properties row is now closed. **Slice 2 is accepted.**

Carried into the next slice as follow-ups:

- **Honest refusal where the key can already read.** The uniform not-found answer exists so an unreadable recipe is indistinguishable from a missing one. When the key can read the recipe (a published recipe, or its own draft) but lacks write authority on the book, a specific refusal with the way forward leaks nothing and serves the agent better, per the operator's rulings that dead-end errors carry their recovery path (`50824e4d`) and that the uniform marker is for what the key cannot read (`507d3c9c`). Change `verify_draft` / `POST /recipes/:id/verify` to answer "not a draft" or "needs write access to this recipe book" in those cases, keeping the uniform answer for everything the key cannot read.
- **F84 (P3, guard hardening):** match statements as a whole rather than line by line, and add the remaining forms and `embedding_chunks` (private detail).
- **Suspected flaky test:** `oauth-flow.test.ts` "legacy epoch-stamped consumed rows" sometimes reads back nothing, possibly because the OAuth service's purge of long-dead rows runs in between. Unconfirmed; backlog item.

### Slice 3: orchestrator rulings on open questions 21 to 27 (2026-09-27)

All seven accepted as recommended. Reasons where the call was not mechanical:

- **21, a JWT listing route that reuses the search grammar, reopening ruling 19.** The daily key can only read books ticked for daily reads, so a queue built on it would silently miss drafts, and every queue load would spend the person's search budget and write search audit rows. The operator's words were "keep it DRY with the search engine", which is about reusing the engine, not about which credential the page uses, and he has separately asked for a rich human search page with qualifiers in the one search field (org program §4.4). The `/app/drafts` route is the first piece of that page: same grammar, same authz fragments, the person's live memberships, JWT auth. Ruling 19 is superseded.
- **22, queue order is impact × uncertainty,** the design's own phrase from the operator's "uncertainty × impact" framing, with unrated counted as medium; ties by higher impact, then most recently deposited, then id. DT-QUE-02 is edited to match in the slice's first commit.
- **24, `is:draft` lifts search's exclude-own default** the way `author:` does and means "unresolved drafts about me"; the on-behalf-of case in DT-QUE-01 moves to slice 4.
- **23, 25, 26, 27** as recommended (rating filter as a fragment outside the ranking-guarded files; honest refusal for the draft's own subject, uniform 404 for everyone else; the deposit notice carries the queue link and sign-in returns only to same-origin `/app/` paths; one click, with labels and accessible names that say exactly what each action does).


### Slice 3 build notes (implementing agent, 2026-09-27)

Written by the builder (agent `a-drafts-slice3-2026-09-27`) for the verifier; the verification record is the verifier's to write. Soup.net intent `int_CaW1LC8BJKBgxa1iS2wdDQxx`.

**Shape.**

- **Carried in:** S3-F1 (`7819f77`): `verify_draft` and its REST twin check "not a draft" and "already resolved" before write authority, and refuse the key's own draft outside its write scope with a 403 naming the book and the way forward; what the key cannot read keeps the uniform answer. S3-F2 (`053b034`): F84 is closed. S3-F3 (`807f314`): the oauth-flow flake is a backlog item with its suspected cause, unconfirmed.
- **Grammar** (`packages/domain/src/search-query.ts`): `is:` (value `draft`), `impact:`, `uncertainty:` join the allowlist; the IR gains `isDraft` and two rating selectors from a closed vocabulary.
- **Selections outside the ranking files** (`services/search-selection.ts`): the draft qualifier composes `draftAwaitingReviewBy` (with `IS NOT TRUE` for the negation, so recipes that were never drafts are kept); rating qualifiers are plain column comparisons. They reach `hybridSearch` and `fetchCorpusTraces` as `StructuredTraceFilters.selections`, opaque functions of the alias, so `ranking-isolation.test.ts` is unchanged. The same file holds `triageOrderSql`, the SQL twin of `compareForTriage` in `triage-ratings.ts`.
- **The queue** (`services/draft-queue.service.ts`, routes in `routes/traces.ts`): `GET /traces/drafts` (queue and `?ids=` forms), `GET /traces/drafts/count`, `POST /traces/:id/not-chosen`. Page size 20. Book scope is `booksFor` (live memberships). The id form resolves each reference through the new `resolveReadableTraceRefs` in `authz/trace-access.ts`, which applies `mayReadTrace` in JS (no SQL copy of the rule, as `membership-sql.test.ts` requires).
- **Frontend:** `pages/DraftQueuePage.tsx` with pure view logic in `lib/draft-queue.ts` and the sign-in return target in `lib/return-target.ts`; the dashboard entry; `AdminPagination` is reused for paging.

**Interpretations the verifier should check.**

1. **S3-A4 is reachable only through leaving a book.** Every membership role can write (`WRITE_ROLES` is owner, admin, member), and the queue lists only books the person belongs to now (S3-Q2), so a person without write authority on a draft's book is one who has left it. That draft is still theirs to read, so it appears through the id-list link with the actions unavailable and the reason naming the book, and the reaction and not-chosen routes answer them with the 403. The browser expectation E8 asks for a role change "if the app offers such a role"; it does not, and the reachable equivalent is removal plus the link.
2. **The id form folds an ambiguous prefix into the "not shown" count** rather than naming candidates: the note is reason-free by design (S3-L2), and prefixes resolve only among recipes the viewer may read.
3. **In the id-link view an acted-on item stays, showing its new state**, since it is still a recipe the link named; in the queue view it leaves the list (S3-A5). Focus moves to the next item in both.
4. **A repeated confirm or reject on one's own resolved draft** records the reaction as before (DT-VER-03) and now reports `alreadyResolved` with the state; not chosen answers 409 `already_resolved`.
5. **S3-G7's Layer 3 test calls the search service directly** with no size lever: the JSON and MCP surfaces always apply the automatic verbosity collapse, so the flat pipeline order is only observable below them.
6. **S3-AG3's collaborator is Mo**, a member with no drafts, compared with another member with no drafts; the fixture's Sam owns a draft of his own, which his `is:draft` rightly lists. Sam's view is also checked to name none of Pat's ids or prefixes.
7. **The queue shows the first evidence interpretation, not citations**, so a long citation URL in a draft's evidence does not appear on the queue page (it does on the detail page).
8. **No navigation item for the queue**; the dashboard entry and agents' links reach it.
9. **The cookie notice's privacy link is now underlined:** axe reported it as a serious `link-in-text-block` on every signed-in page, which would have failed S3-UI1 on the queue and dashboard.
10. `/briefing` is unchanged (no queue pointer on the Drafts line, S3-Z5).

**Budgets:** remote `tools/list` 16,854 → 16,853 bytes (cap 17,000); stdio 13,064 → 13,063 (cap 13,670); shared descriptions 5,965 → 5,968 characters (cap 6,000); `searchQuery` 412 → 415 (cap 420); the deposit notice +60 characters with a 73-character URL; a rated draft label at most +38 bytes.

**Gate** (`TESTCI_PGPORT=5574 npm run test:ci`): run 1 exit 1 (vitest worker exit; 15 s and 30 s timeouts in the new suite and `import.test.ts`; S2-B2); run 2 exit 1 (S2-B2 again, the F90 assertion); after the slice 4 suite's per-test timeout and S2-B2's longer embedding wait, run 3 exit 0 (123 files, 1,768 tests passed, 10 skipped) at `e527e15`, and run 4 exit 0 with the same counts at `abef1a5`, after merging `origin/main` again. The flakes are recorded under the backlog's gate-reliability item.

**Test-first:** not held strictly. The Layer 1 tests were written alongside their functions; the Layer 3 suite (`routes/draft-queue.test.ts`, 31 tests) after the routes. The F1 tests assert statuses the pre-slice code could not produce (409 and 403 where it answered 404).

**Build-both:** not used. The rulings settled every fork this slice met (route shape, order, the exclude-own default, where the rating filter lives, refusal wording), and the remaining choices (page size, whether an acted-on item stays in the link view) were cheap to change later rather than worth building twice.

### Slice 3 fix pass (implementing agent, 2026-09-27)

After the functional verification (above), the browser run, and the read-only security audit (private; F85 and F86), all three recommending acceptance after fixes. The rubric rows S3-A2, S3-A4, S3-AG3, and S3-G7 were amended as the orchestrator ruled; the feature file's scenarios needed no change, since none of them names a role change, the comparison actor, or clustered surfaces.

- **F85 closed** (`2feb9b7`): the `?ids=` prefix resolver decides readability in its statement and uses LIMIT 2. The read rule's SQL form is one new module fragment, `traceReadableByPerson` in `authz/draft-sql.ts`, proven equal to `mayReadTrace` over every state, ownership, and membership combination (`draft-sql.test.ts`); the previous JS-only filter and its 50-row cap are gone. `draft-queue.test.ts` "[F85] a crowded prefix range…" plants unreadable rows under a prefix.
- **S3-L1 count** (`2feb9b7`): `notShown` counts references that led to no shown recipe, so a prefix and a full id naming the same recipe report 0.
- **Page clamp** (`2feb9b7`): pages above 100,000 are served as page 100,000 (empty), so no page number reaches SQL as an overflowing OFFSET.
- **E10** (`2feb9b7`, `8c3ed74`): the id-link view shows the draft's own person a `verified` state ("Verified draft: you confirmed it, and it is published to its recipe book"); a collaborator still sees `published` ([F83]).
- **Accessible names** (`8c3ed74`): each action's name adds the draft's short id.
- **Reason label** (`8c3ed74`): "Why your agent drafted it:" only on drafts; a published recipe's first interpretation is labelled "Evidence:".
- **`?next=`** (`8c3ed74`): percent-encoded separators and dots in the path are refused.
- **F86** is filed in the backlog.

### Slice 3 accepted (2026-09-27)

The functional verification, the browser run, and the read-only security audit all recommended accepting after fixes. The fix pass (`2feb9b7`, `8c3ed74`, `0949691`) passed the full gate on its first run. The audit's live fix-verification at `0949691` then recommends merging. It reproduced the original F85 attack against the fix and found no difference in response bytes, status, or timing. When the old resolver was restored, the branch's F85 test failed. The page clamp, the not-shown count, the verified label, and the `?next=` check each held under break attempts. The one new finding, F89 (P3, guard hardening, not exploitable today), joins the F86 backlog item. **Slice 3 is accepted.**

Carried forward:

- **F86 and F89** in one guard-hardening pass (backlog).
- **Slice 4's parity tests** must set the subject and the depositor separately. In slice 3 they come from one variable, so the tests can't tell them apart yet.
- **`traceReadableByPerson` is a signed-in person's full scope.** It belongs on JWT paths only; an API-key path composes the key's narrower scope instead. The guard can't tell the two apart, so this is a review point until F89's fix names it.

### Slice 4 build notes (implementing agent, 2026-09-27)

Written by the builder (agent `a-drafts-build-s4-2026-09-27`) for the verifier; the verification record is the verifier's to write. Soup.net intent `int_EsmK8J2pIlCqGd1IuBwcuInh`. Built on `f6dec77`, with `origin/main` (#100, #109, #110, #111) merged in before the account-deletion rows, so S4-A1 to A5 were built and tested against main's simplified cascade (recipe `23657e4e`).

**Shape.**

- **Storage:** one nullable column, `traces.subject_user_id` (migration `0039_traces_draft_subject`, one `ADD COLUMN`, no backfill, no index). No depositor column: the depositor is `user_id` until verification and the `recipe.checked` audit row after it.
- **The module:** `subjectOf` reads `COALESCE(subject_user_id, user_id)` and is the only place the visibility rules read the column; `depositorOf` stays `user_id`. `draftStateShownTo` shows the depositor the unpublished states. Three naming fragments (`onBehalfSubjectOf`, `onBehalfSideFor`, `onBehalfPartyFor`) let a statement name the other party without reading the column by hand. `authz/naming.ts` holds who may be named (`resolveNameableSubject`, one statement over `lower(email)`, `membershipOf`, `WRITE_ROLES`, and `activeUserPredicate`). `unpublishedDraftManagement` in `roles.ts` decides move and delete of an unpublished draft; `roleInBookOfTrace` now reports such a draft to its depositor as well as its subject.
- **Resolution:** `resolveDraft` sets `user_id` to the subject and clears `subject_user_id` on verification only, and writes its own audit row in the same statement (a data-modifying CTE), with `previousAuthorId` when the author changed and `verifiedByDepositingKey` for an agent. The three callers no longer write resolution audit rows themselves, so none can forget.
- **The deposit:** naming runs right after the target book is resolved, before anything is embedded, stored, or searched. An on-behalf deposit's `recipe.checked` row is inserted inside the deposit transaction and completed with the search's fields afterwards (one row per check, so the per-key budget is unchanged); an ordinary check writes its row after the search as before. The refusal names the target book's slug and echoes no email.
- **Surfaces:** `on_behalf_of` on remote MCP, the stdio proxy, `GET` and `POST /check` (urlencoded and multipart), and the HTML form, carried like `draft`. `draftDepositedBy` and `draftAbout` on result rows (MCP, `/check`, `/recipes`, `get_recipes`, the lookup markdown), on `checked`, on `GET /traces/:id`, and as `depositedBy` / `about` on queue items. Export carries `onBehalfOf`; import runs such rows through the naming rule. A key's label is shown only under its owner's authorship (open question 40), on the detail page and in the queue.
- **Account deletion:** the cascade's collection adds `draftAwaitingReviewBy` for the departing person (S4-A3); everything else is main's cascade.
- **Frontend:** the queue and detail page name the other party as text, word the ratings as the depositing agent's, tie the depositor's reason to the action group, hide the resolving reactions from the depositor, and name what her delete control removes.

**Rubric rows.** Met unless noted.

- S4-F1: partly. F89 is closed (`b33b8bd`: the guard fingerprints `traceReadableByPerson` calls, with a plant). The nine F86 forms stay in the backlog: their detail is in the private audit, which this builder did not have, so the verifier plants each new slice 4 statement's fragment deletion by hand, as the row allows.
- S4-M1 to M5: met. M2's parity tests set the subject and the depositor separately (viewer is subject only, depositor only, both, neither, over every state). M4 has the static test (only `draft-resolution.ts` writes an existing recipe's `user_id` or `subject_user_id`). "No membership anywhere" is not constructible (every account has a personal book), so a member of another book only stands for it.
- S4-M6: met on the builder's side. Every changed statement is re-registered with its reason; the on-behalf fragments are fingerprinted with the statements but do not count toward `composes`. `ranking-isolation.test.ts` forbids the subject terms, and the hand plant is the verifier's.
- S4-S1 to S4-S3: met.
- S4-S4: met, with one simplification (below): the transactional write is proven by code and by reading the rows back, including after the depositor's account is deleted, but no test makes the audit insert fail.
- S4-W1 to W6: met. W3 compares the row and the draft notice with and without the parameter, not the whole response. W5 combines `decided_at`, ratings, and a ride-along feedback row; attachments, `intent`, and `known_recipes` are untouched code paths and not combined in a test.
- S4-V1 to V3, S4-L1 to L4, S4-Q1 to Q5, S4-R1 to R4, S4-D1 to D4, S4-C1: met. R1 is shown with a Dana-deposited draft through the reaction route (which the queue's confirm uses) and `verify_draft`; the slice 2 and 3 resolution suites pass unchanged but were not re-parameterized.
- S4-A1 to A5: met on the merged cascade. A5's owner is a separate person (Owen) rather than Sam, since Sam owns the shared book the rest of the suite uses.
- S4-E1, E3: met. S4-E2: met with a deviation: an unnameable row refuses the whole import (import's existing all-or-nothing validation) rather than skipping the row (recipe `a8916b66`).
- S4-U1: met, byte-compared on MCP markdown, MCP structured, `/check` JSON, and `/check` HTML (after replacing every echo of the typed value), plus import. Timing is not measured.
- S4-U2, U3: met for Sam, Olive, and the system user on `GET /traces/:id`, the reaction, not chosen, move, delete, and the id-list link, and for Sam's key, P2, and D2 on `get_recipes` (full id and prefix) and `verify_draft`. Feedback targets are covered by the slice 2 suite's by-id rule, not re-run with an on-behalf draft.
- S4-Z1 to Z5: met (numbers below).
- S4-UI1 to UI3: built; the browser run is the verifier's.

**Simplified instead of built (thin assumptions, for a ruling).**

1. S4-S4's failure-injection test: making the audit insert fail inside a live deposit needs a trigger or fault hook in the test database, which is machinery for a case the code rules out by construction (the insert is in the transaction). Recorded rather than built.
2. S4-E2's per-row refusal: the whole import is refused instead, matching import's existing validation; a file naming someone who cannot write the target book is rare.
3. S4-U2's full slice 2 and 3 comparison harness is not re-run with an on-behalf draft; the new suite covers the by-id routes that differ.

**Interpretations the verifier should check.**

1. The subject's label still reads "visible only to them and their agents": within the Z3 budget the label names the depositor ("deposited by …") but does not restate that she can see it. The deposit notice, the queue, and the detail page's tooltip say it in full.
2. The depositor's `stale` reaction on an unpublished draft is recorded (it resolves nothing); her `still_true` and `wrong` get the honest 403. The detail page offers her no reactions.
3. A depositor's not-chosen request on a draft that is already rejected answers `already_resolved` (409), since she can read it.
4. After the subject's account deletion, a rejected draft about him keeps its `subject_user_id` (a dangling id): the depositor still sees it as "about" nobody resolvable, and its label has no email. Nothing reads the id except the naming fragments.
5. The on-behalf deposit's `recipe.checked` row is completed by an `UPDATE` of its metadata after the search: the row is still one event written once; only its search fields arrive later.

**Found on the way.**

- `ranking-isolation.test.ts`'s draft-column pattern (slice 2) held two literal backspace characters where `\b` was meant, so it never matched anything: the draft half of that guard was toothless. Fixed in `ed89afa`; the five ranking files pass it.
- `origin/main` as merged after #100 and #110 failed `check:authz-seam` (the recipe register counted two recipe-table mentions in `user-delete.service.ts`, where the merged file has three). This branch refreshed the entry in `93c0857`; main fixed it in #115, and the second merge of `origin/main` (`c816809`) kept this branch's entry, whose fingerprint also covers the S4-A3 fragment.

**Budgets.**

| Measure | Before (slice 3) | After (slice 4) | Cap |
|---|---|---|---|
| Remote `tools/list` | 16,853 bytes | 16,986 | 17,000 (held) |
| Stdio `tools/list` | 13,063 bytes | 13,196 | 13,670 (held) |
| `on_behalf_of` property, remote | | 117 bytes; description 83 characters | one line, at most 90 |
| Shared descriptions | 5,968 characters | 6,051 | 6,000 → 6,080, dated comment |
| Unverified label, 16-character email | 100 bytes | 131 ("deposited by") / 123 ("about") | email + 20 |
| New-draft notice, 73-character URL | 344 characters | 285 on behalf (318 with the override clause) | 344 + 60 + email |

**Test-first:** not held strictly. The domain, module, and frontend tests were written alongside their code; the Layer 3 suite (`routes/drafts-on-behalf.test.ts`, 35 tests) after it. Its teeth: with `subjectOf` forced back to `user_id`, 22 of the 35 fail.

**Build-both:** not used. The rulings and the amended rubric settled every fork this slice met (the column, the idempotency key, who may be named, where the audit row is written, what the depositor may do); the remaining choices (the label wording, the whole-file import refusal) were cheap to change later rather than worth building twice.

### Slice 4 fix pass (implementing agent, 2026-09-27)

After the verification record (`9b30e51`) and the read-only security audit (private, F92 to F95), following the orchestrator's rulings. `origin/main` was merged first (`92227a3`: Turnstile signup and the docs PRs; one import-line conflict in `routes/auth.ts`). Each fix is its own commit, with a test that fails without it.

- **F92 [P2]** (`d7961fe`): import's `overwrite=true` no longer changes a draft the importer deposited about someone else. The row is kept and reported as a conflict (`kept: "existing"`), the way import reports any row it keeps, and the overwrite `UPDATE` itself requires no on-behalf subject (`onBehalfSubjectOf("t") IS NULL`). "Unresolved" is read as "has an on-behalf subject": verification clears the column, so this covers every unverified, rejected, or not-chosen draft about someone else, and a verified one is the subject's own recipe, which the depositor could never overwrite anyway. No confirm-time text hash, as ruled. Recipe `44c5e754`. Test: `drafts-on-behalf.test.ts` "[F92] …" (it counted `overwritten: 1` before the fix).
- **F93 and S4-L2** (`ca45c9b`): both `GET /traces` lists return no key label when the depositing key is not the recipe author's, which covers the book page's "via …" and the dashboard. The detail row gains `apiKeyIsAuthors`, and the detail page shows no agent badge at all when it is false: no "No label set" and no key-id prefix. Raw `apiKeyId` fields and pre-publication feedback rows are unchanged, as ruled. Tests: `drafts-on-behalf.test.ts` "[F93] / S4-L2 …" (Sam's book list carried Dana's label before the fix) and `showsKeyBadge` in `draft-status-label.test.ts`.
- **F94** (`50e91d0`): `memberlessBooksWithOthersRecipes` no longer counts unverified drafts about the departing person (`draftAwaitingReviewBy`), since the S4-A3 cascade deletes them. A book left holding only those is deleted with the person. Test: `drafts-on-behalf.test.ts` "[F94] …" (the book survived before the fix).
- **S4-L3** (`bcb3a3e`): "(your draft flag was overridden)" appears only when a `draft` value was sent and read as false. S4-W2's assertions were tightened first and failed.
- **Depositor-facing copy** (`c40624d`): on a resolved draft she deposited, Dana's party line reads "About <Pat>" without "only they can confirm or reject it", and the tooltip names who resolved it ("<Pat> marked this draft wrong…", "…marked this option not chosen…") instead of "You". The id-list heading says "Drafts your agent linked" only when every linked draft was deposited by the viewer's own agent, and "Linked drafts" otherwise. No new states. Tests in `draft-status-label.test.ts` and `draft-queue.test.ts` failed first.
- **S2-B2** (`20067fc`): after the embedding poll the test asserts that the draft's evidence, and the book's other evidence, embedded, so the absence check can no longer pass vacuously. With the poll cut to zero iterations the new assertion fails, where the old test would have passed.
- **Backlog** (`fa72cc9`): F95 is folded into the F86 guard-hardening item, by F-number only. A new `[IMPL]` item covers the detail page's pre-existing badge and evidence-source contrast and its recipe heading's missing `overflow-wrap`.

**Ruled, not fixed:**
- A depositor's `stale` reaction on an unverified draft about someone else stays allowed.
- A rejected or not-chosen on-behalf draft re-imports as a fresh unverified draft. That is a new deposit, which the subject can reject again.
- The landing page after a delete is unchanged.
- The pre-existing contrast and heading-overflow issues are in the backlog, as above.
- F95 is in the guard-hardening backlog item.

**Gate** (`TESTCI_PGPORT=5574 npm run test:ci`, at `fa72cc9`). It is not green. Three runs all exited 1, and no slice 4 test failed in any of them.

| Run | Exit | Tests | Failures |
|---|---|---|---|
| 1 | 1 | 1,771 passed, 1 failed | `groups.test.ts` "Owner can list + revoke pending invitations": the revoked invitation was still listed. The vitest "Worker exited unexpectedly" error also appeared. |
| 2 | 1 | 1,733 passed | `trace-delete.service.test.ts`: its `beforeAll` timed out at 30 s. The worker exit appeared again. |
| 3 | 1 | 1,778 passed | The `trace-delete.service.test.ts` `beforeAll` timeout again. |

- The invitations failure did not repeat in runs 2 and 3.
- On a fresh stack, `trace-delete.service.test.ts` and `groups.test.ts` pass when run alone: 42 tests in 6.6 s.
- These are flakes the orchestrator has also seen on merged main. The `trace-delete` hook timeout recurs, so it belongs under the backlog's gate-reliability item. The fix pass adds three tests to the slice 4 suite, which adds a little load.

### Slice 4 second fix pass (implementing agent, 2026-09-27)

After the fix verification (private). It confirmed F93 and F94, and found that F92 was closed only on the overwrite path. The orchestrator's ruling replaces the earlier premise that "once overwrite is closed, a draft's text has no other path to change". There is still no confirm-time hash check. Each fix is its own commit, and its test is the audit's reproduction, which failed before the fix.

- **F96** (`306e929`): an imported row that carries `onBehalfOf` always lands under a fresh random id. It never gets the file's id, and never a deterministic mint, which a delete-then-reimport would reproduce. The new id is reported in `idMap`. A delete-then-reimport of the id the subject is reviewing now creates a new draft: his open link, his confirm, and his agent's `verify_draft` on the old id find nothing.
  - The row is named by its `onBehalfOf`, before the naming rule resolves whether the email is the importer's own. A hand-made row naming the importer also gets a fresh id; export never writes such a row.
  - This departs from import's deterministic per-importer mint (recipe `c40fd228`) for these rows only. Re-importing a file with on-behalf rows adds them again rather than skipping them.
  - S4-E2's test now follows the row through `idMap`.
- **F97** (`6214014`): the link step's `ownedTraceIds` excludes existing rows with an on-behalf subject, the same condition as the F92 classification. A file can no longer add evidence, references, or quotes to a draft deposited about someone else. New on-behalf rows in a file have fresh ids (F96), so they are new deposits and take their own links.
- **F98** (import accepting other people's evidence ids) is not fixed here: it is on main already and a separate branch handles it.

**Gate** (`TESTCI_PGPORT=5574 npm run test:ci` at `6214014`, one run): exit 1, 1,783 passed, 2 failed.
- `workspaces.test.ts` "(3) after expire-now …": the known workspace-expiry flake, the "timestamp-at-now" item in the backlog.
- `draft-queue.test.ts` S3-Q2: a 15-second test timeout, not an assertion failure, under the load of the full run.

No slice 4 test failed, and `origin/main` had not moved.

### Slice 5: orchestrator rulings on open questions 41 to 44 (2026-09-28)

- **41, 43, 44: accepted as recommended.** Storage is one `deposit_level` text column, default `full`, minted only as `full` or `drafts`, with `none` reserved. Only scoped keys can be headless. The derived-key rule stays in the derived-keys design and is not built.
- **42: overridden.** A headless key may update a recipe book description like any other key, with no refusal. A headless agent is autonomous but still directly supervised by its person, autonomous only to save their attention (recipe `e0d2c1c9`), and the operator encourages agents to keep book descriptions current (recipe `94e0e682`). Headless means exactly one thing: its deposits are drafts. S5-W6, S5-U1, S5-Z4, the security properties, and DT-HDL-07 were amended to match before any code was written.
- **Standing rule:** no machinery for situations nobody is in. Where a rubric row asks for that, the builder builds the simple version and lists the row.

### Slice 5 build notes (implementing agent, 2026-09-28)

Written by the builder (agent `a-drafts-build-s5-2026-09-28`) for the verifier; the verification record is the verifier's to write. Soup.net intent `int_EOyohT19iZmgSYHAaonKSWdd`. Built on `c91fdce` (slices 1 to 4 merged); `origin/main` had not moved. The rubric was amended for the orchestrator's ruling on question 42 before any code (`dcba918`).

**Shape.**

- **Storage:** `api_keys.deposit_level text NOT NULL DEFAULT 'full'` (migration `0040_api_keys_deposit_level`, one `ADD COLUMN`, no `UPDATE`), vocabulary in the schema comment. No boolean column.
- **The module:** `authenticateKey` selects the column in its one statement and the `Principal` carries `depositLevel`. `keyForcesDrafts` and `keyMayVerifyDrafts` sit together in `authz/roles.ts`; both fail closed (only the exact string `full` is an ordinary key). No route or service compares the level itself.
- **The deposit:** `trace.service.ts` computes `forcedDraft = subject || keyForcesDrafts(principal)` where it already forced drafts for `on_behalf_of`; the stored state, the notice, the override clause, and the audit row's `draft` flag all read it. No surface file changed.
- **Verify:** `verifyDraft` returns a new `key_cannot_verify` status before any lookup; REST answers 403. The stdio proxy is unchanged and relays the REST text (its existing "relays the backend's refusal verbatim" test).
- **Keys:** `POST /keys/scoped` takes `depositLevel: "full" | "drafts"` (zod enum; anything else 400); the mint response and `GET /keys` carry it. `POST /keys/daily` refuses any other level with `daily_keys_are_full`. OAuth is untouched.
- **Briefing:** `HEADLESS_KEY_SECTION` (351 characters) is inserted after the key section when `composeBriefing` sees `keyForcesDrafts(principal)`, so every briefing surface gets it with its own profile.
- **Frontend:** a "Headless" checkbox on the scoped-key form (label, `aria-describedby` description); "Headless: deposits drafts only" as text on the key's row and in the just-created banner; the expanded key says the setting is fixed and to make a new key. Pure helpers in `lib/headless-key.ts`.

**Rubric rows.** Met unless noted.

- S5-M1, M2, M3: met. M2's table covers `full`, `drafts`, `none`, `""`, `FULL`, `full `, and an unknown word. With both predicates mutated to ordinary-key behaviour, 16 of the 18 Layer 3 tests and 6 table rows fail.
- S5-S1: met. The "every pre-slice row reads `full`" check is the column default itself; no test migrates a pre-slice database.
- S5-S2: met by `authz/deposit-level.test.ts`: only `key-auth.ts` and `api-key.service.ts` name the column, nothing assigns it, and the daily mint, revoke, and every OAuth file never name it (recipe `8bd999dd`).
- S5-S3: met; both changed register entries keep their reason and add the slice 5 clause.
- S5-W1: met, simplified. Remote MCP structured runs all five `draft` values; MCP markdown, `GET /check` JSON, `POST /check` urlencoded, multipart, and the HTML `GET` run one value each rather than the full surface-by-value cross product. K's baseline runs absent, false, and true.
- S5-W2, W4: met.
- S5-W3: met for `on_behalf_of`, `decided_at`, `impact`, a ride-along feedback row, and a deposit into an H-created workspace. Attachments, `intent`, and `known_recipes` are untouched code paths and not combined in a test.
- S5-W5: met for `search_recipes`, `get_recipes`, `GET /recipes`, `list_my_recipe_books`, `/check?filter=`, `log_feedback`, `/health/integrity`, `/health/version` (status), `POST /uploads`, and `POST /workspaces` (status and shape); `get_briefing` and `GET /briefing` are covered by S5-B1. `GET`/`POST /feedback` and the intent surfaces are not separately compared. Found on the way: once H creates a workspace, H reads one book K does not, because the workspace binds to its creating key. The parity test therefore runs before the workspace test. This is the existing self-binding rule, not a headless difference.
- S5-W6 (as amended): met. H updates a description it may write, the audit row appears, and H and K get the same answers for the read-only book and a missing slug.
- S5-R1: met on remote MCP and REST (403; row, evidence, reaction, and audit unchanged). Stdio relays the REST text through the unchanged proxy; it is not run live.
- S5-R2, S5-U1, S5-U2: met. U1 compares five ids on MCP and REST. U2 uses Sam's and Olive's keys on `get_recipes`, and Sam's on REST verify and search; the slice 2 to 4 suites run unchanged in the gate.
- S5-K1, K2, O1: met. K2's route check: `PATCH`, `PUT`, and `POST /keys/:id` are 404.
- S5-K3: met on the builder's side (frontend unit test; Layer 3 `POST /keys/briefing` for H and K). The page itself is the browser run's.
- S5-B1: met. The domain test shows, for the thin and full profiles, that the headless text equals the ordinary text with exactly the section inserted; Layer 3 covers remote `get_briefing`, `GET /briefing` with the stdio surface header, and `POST /keys/briefing`.
- S5-Z1 to Z5: met (numbers below). Z3's "before and after the slice" comparison is the domain fixture against the unchanged 18,200 ceiling plus the H-versus-K Layer 3 comparison, not a recorded pre-slice `GET /briefing`.
- S5-UI1 to UI3: built; the browser run is the verifier's.

**Interpretations the verifier should check.**

1. When a headless key also names `on_behalf_of`, the notice is slice 4's on-behalf notice unchanged (as S5-W3 asks), so it does not mention that the key is headless.
2. The daily refusal treats any present `depositLevel` other than the string `full`, `null` included, as a request for a different level.
3. The frontend label fails closed like the server (any level but `full` reads as headless) but reads a missing field as ordinary, so an older server's list shows no label.
4. The verify refusal echoes the id as the caller gave it, in the text and in the queue link.

**Budgets.**

| Measure | Before (slice 4) | After (slice 5) | Cap |
|---|---|---|---|
| Remote `tools/list` | 16,986 bytes | 16,986, identical for H | 17,000 (held) |
| Stdio `tools/list` | 13,196 bytes | 13,196 (no stdio source change) | 13,670 (held) |
| Shared descriptions | 6,051 characters | 6,051 | 6,080 (held) |
| Thin briefing fixture | 18,183 characters | 18,183; headless 18,536 | 18,200 (held); headless 18,600 (new) |
| Full briefing fixture | 24,119 characters | 24,119; headless 24,472 | none |
| Headless section | | 351 characters | 400 |
| New-draft notice, 73-character URL | 344 (self draft) | 338 headless; 371 with the override clause | 344 + 80 |
| Verify refusal | | 289 characters plus the link | 320 plus the link |

**Test-first:** held for the predicate table, the static guard, the domain notice and refusal tests, and the briefing section test; each was run and failed before its code. The frontend helpers and their test were written together, and the Layer 3 suite after the code. The suite's teeth are the mutation run above.

**Build-both:** not used. The rulings settled the forks this slice met (storage, which keys, descriptions). What remained, the notice wording and where the section sits, was cheap to change later rather than worth building twice.
