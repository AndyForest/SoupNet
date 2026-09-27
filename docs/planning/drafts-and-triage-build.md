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
| S3-G7 | With semantic text, results keep the normal pipeline order; a rating qualifier only removes rows. | Layer 3: the same semantic query with and without `impact:high` returns, with the qualifier, the matching subsequence of the unqualified results in the same relative order and with the same similarities. |

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
| S3-A2 | Each action needs the slice 2 write authority on the draft's book, checked inside the resolving statement, and only the draft's subject may resolve it. Resolution is one-way; repeating an action is a no-op reported as already resolved. | | Layer 3, including a role change between listing and acting. |
| S3-A3 | For anyone but the subject (Sam, the book owner, the outsider, the system user) and for a missing id, the not-chosen operation returns the same 404 as a random UUID and writes nothing. | DT-VER-07 | Uniform-response pairs below. |
| S3-A4 | A subject without write authority on the draft's book sees the draft in the queue with the actions unavailable and a reason naming the book; the routes give the subject an honest refusal (open question 25). Everyone else still gets the uniform 404. | | Layer 3 for the refusal; browser for the disabled state. |
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
| S3-AG3 | Sam's `is:draft` search (MCP both formats, `/check?filter=` JSON and HTML) is identical to that of a member with no drafts: zero results, the same zero-result text, and the same in-scope count. | Byte comparison after replacing volatile ids (session, search id). |

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

**Test-first:** not held strictly. The Layer 1 tests were written alongside their functions; the Layer 3 suite (`routes/draft-queue.test.ts`, 31 tests) after the routes. The F1 tests assert statuses the pre-slice code could not produce (409 and 403 where it answered 404).

**Build-both:** not used. The rulings settled every fork this slice met (route shape, order, the exclude-own default, where the rating filter lives, refusal wording), and the remaining choices (page size, whether an acted-on item stays in the link view) were cheap to change later rather than worth building twice.
