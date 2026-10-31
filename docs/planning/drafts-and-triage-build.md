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
6. **Option sets**, re-planned on 2026-10-24 after four weeks of field use ([drafts-and-triage-slices-6-7-revision.md](drafts-and-triage-slices-6-7-revision.md), ratified; open questions 45 to 55 ruled there) and split into three PRs in the order the field needs: **6c** agent-side resolution (`outcome: verified | rejected | not_chosen` on `verify_draft` and its REST twin, evidence parsed as `check_recipe` parses it), **6a** the recipe-to-intent link and the `intent:` qualifier, **6b** sets of options under one intent (as drafts, or as ordinary recipes when every option is pursued) with `resolve_siblings`, and ruling 17's server-side rubric test dropped for the confidence rule (6d).
7. **Briefing copy.** The when-to-draft guidance reframed (a draft is a hypothesis the agent cannot yet stand behind from the context it holds; ask when the call is the person's and they are reachable), the tool and web copy that contradicted the rulings, the "checkable by someone who wasn't there" phrase, the headless profile, and eight additions from the field, under one dated cap raise with one slimming lever, declared under the briefing regression-spec process.
8. **Unattended readers.** 8a: the tool-shape fixes the field logged (array ids, whole-row validation errors with the enumerations in the descriptions, `outcome` rows on `intent_id`, a briefing id for feedback, the exclude-own hint, unknown parameters refused or warned). 8b: a flat paged list for qualifier-only searches, changed-since, Members and pending-invites lines, own open drafts set apart in check results, related-item promotion if the ranking guard allows.
9. **Read paths for reports.** `GET /intents`, `GET /intents/:id`, `GET /feedback/rows` under the API key for the caller's own fleet, the intent id rendered on the web, an intent page, intents and feedback in the export. The operator's ask of 2026-10-24.

Slices 6 to 9 run as parallel streams in separate worktrees under [drafts-and-triage-slices-6-9-implementation-plan.md](drafts-and-triage-slices-6-9-implementation-plan.md); each stream writes its rubric under its own heading below before implementing, and puts the questions that need the operator under that heading, numbered on from 56, each with a recommendation.

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
| S4-M3 | `draftStateShownTo` (the [F83] rule) shows the subject every state, the depositor the unpublished states (`unverified`, `rejected`, `not_chosen`) of what they deposited, and everyone else nothing; a verified on-behalf recipe reads as an ordinary recipe to the depositor as to everyone but the subject (open question 31). Resolution details (who, when, which key) stay the subject's alone. Narrowed by ruling 56 (2026-10-24): this covers the resolution columns and the resolving key; evidence the subject's agent attaches when rejecting a draft stays visible to the depositor, with its date, since the draft stays hers. | Unit test of the fragment over the viewer and state combinations; Layer 3 on `GET /traces/:id` and `GET /traces?groupId=` for Dana. |
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
| S4-D1 | (Amended, `b89db1f0`; worded to match the code 2026-09-29.) While it is unpublished (unverified, rejected, or not chosen), Dana (its author) may delete her on-behalf draft through the human delete route (`DELETE /traces/:id`, JWT); it leaves Pat's queue and count at once. No agent surface gains a delete (design-thinking §8's append-only agent surfaces). | DT-OBO-08 | Layer 3; the `tools/list` diff shows no new tool. |
| S4-D2 | Dana may not move it: the move route answers her the same 404 as a random id and changes nothing. Pat may move it to a book where he has write access (the existing move rule), and it stays a draft about him, still visible to Dana by id. | DT-OBO-08 | Layer 3 for both. |
| S4-D3 | Sam (the book owner in the fixture), Olive, and the system user get the random-id 404 for move and delete of the unresolved draft, and nothing changes (slice 2's rule, unchanged). | DT-OBO-08 | Uniform pairs (S4-U2). |
| S4-D4 | (Amended, `b89db1f0`.) After Pat verifies it, it is Pat's recipe and the existing rules apply: Pat may delete or move it as its author, and a book owner or admin may too; Dana, no longer its author, gets what any member gets (403 on delete unless she is an owner or admin of the book). A rejected or not-chosen draft stays Dana's to delete, and Pat may still delete it as its subject (open question 30). | DT-OBO-08 | Layer 3 for Dana and Pat before and after each resolution. |

**Account deletion and removal of either party.** (Amended, `b89db1f0` and `23657e4e`.) The deletion cascade collects recipes by author (`SELECT id FROM claimnet.traces WHERE user_id = …`), and author now follows the draft's life: the depositor until verification, the subject after it. The rows below are written against the simplified cascade on `fix/account-delete-former-coauthors` at `770628b` (recipe `23657e4e`): account deletion deletes only what the person owns and never adds anyone to a book. A book with current members still passes to a current member; a book in the departing person's own organizations with no members left but other people's recipes in it stays, memberless, moved into the personal organization of the author of its earliest recipe with nobody added and a `recipe_book.left_without_members` audit row; a book in someone else's organization only loses the membership; and a book is deleted only when it holds no recipes. If that branch has not merged when slice 4 is built, the builder merges main first or records which rows were verified against the older cascade.

| # | Case | Criterion | Scenarios | Evidence |
|---|---|---|---|---|
| S4-A1 | Pat leaves the book (or is removed) | The draft stays where it is. Pat's queue and count drop it (S3-Q2); Pat still opens it through the id-list link with the actions unavailable and the reason naming the book, and the resolution routes answer him the honest 403 (S3-A4). Rejoining restores everything. Dana's view is unchanged. | DT-OBO-12 | Layer 3. |
| S4-A2 | Dana leaves the book (or is removed) | The draft stays, and Pat can still review it: resolution needs Pat's authority, not Dana's. Dana's agents lose it (her keys' effective scope drops the book), while Dana herself still reads it by id and may still delete it while it is unpublished (the depositor rule holds whatever her membership, as the subject's does). If Pat verifies it, it becomes Pat's recipe, and Dana's removal no longer matters to it. | DT-OBO-12 | Layer 3. |
| S4-A3 | Pat deletes his account | Everything Pat authored goes, which now includes on-behalf recipes he verified (the author rule, unchanged). Unverified drafts about Pat go too, by one addition to the cascade's collection: unverified drafts whose subject is the departing person (`draftAwaitingReviewBy`, composed from the module), since they exist only for his review and nobody else can ever resolve them (open question 35). Drafts about Pat that he rejected or marked not chosen stay Dana's, visible to her alone. The subject is stored as a user id, never an email, so a new account registered later with Pat's email inherits nothing. | DT-OBO-13 | Layer 3: after deletion, Pat's verified on-behalf recipe and the unverified draft about him are gone (with their embeddings, through `deleteTraceCascade`), the rejected one is still Dana's; a new account with Pat's email sees nothing in its queue, briefing, or by id. |
| S4-A4 | Dana deletes her account | Her unverified, rejected, and not-chosen deposits go with her (she is still their author); unverified ones leave Pat's queue and count. Recipes Pat verified are Pat's and stay. Her `recipe.checked` audit rows stay (the cascade keeps `audit_log`), so the depositor of those recipes is still on record (S4-S4). (Amended 2026-10-26 by the audit-log retention ruling, recipe `1d1531da`: her check-log rows are now anonymised, so the `recipe.checked` row keeps the deposit and its subject but not her. S4-S4 holds through `recipe.draft_verified`'s `previousAuthorId`, an account event that deletion leaves as it is.) | DT-OBO-13 | Layer 3 over one draft in each state; `audit_log` read after deletion. |
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

### Slice 5 verification record

Written 2026-09-28 by the functional verifier (agent `a-drafts-verify-s5-2026-09-28`, Soup.net intent `int_68Wpau98A9rS0cF9qePp1WDj`), who did not build the slice and changed no application code. Verified at branch tip `0b044ef` in a throwaway detached worktree after `npm ci` and `npm run build:packages`. Verdicts were formed from the verifier's own probes and code review before the builder's build notes were read; the notes were then checked against that evidence (see "Builder's interpretations" below).

**Verdict: accept with minor follow-ups, once one gate run is green.** Of the 29 rows, 28 pass (three with a note on how they were proven). One is not met as written: S5-UI1, whose serious and critical axe violations all come from elements the slice did not change. No security property failed. The gate was not green in either run, for load timeouts only (below).

**How it was verified.**

- **Gate:** `TESTCI_PGPORT=5834 npm run test:ci`, two runs, both **exit code 1**, with other sessions' gates holding 5814 and 5564. Build, typecheck, lint, the data-model check, and the authz seam check passed in both. Run 1: 1,814 passed, 1 failed, 40 skipped; 3 files failed, all timeouts (`import` and `trace-delete.service` setup hooks at 30 s, `draft-queue` S3-Q2 at 15 s). Run 2: 1,810 passed, 3 failed; the same two hooks, S3-Q2 and `workspaces` (3) at 15 s, and `draft-queue` S3-Q3 counting 4 against 3 because it ran while the timed-out S3-Q2 was still removing a member. No slice 5 test failed and no assertion about slice 5 behaviour failed. The ranking eval did not run, since the tests failed first. The builder's two runs show the same pattern.
- **Isolated re-run** on the verifier's idle stack: the four files that failed plus `drafts-headless.test.ts`, `deposit-level.test.ts`, `roles.test.ts`, and `seam-guard.test.ts`: 8 files, 138 passed, 1 skipped, exit 0.
- **Independent probe:** a script of the verifier's own (214 assertions and three follow-up probes) against the built backend on a throwaway stack (compose project `soupnet-ci-5834`, backend on :3491 with the test-ci environment, stub embeddings, `FRONTEND_URL=http://localhost:5873`), torn down afterwards. Cast: Pat (owner of H, K, and a daily key D), Sam (owns the shared book and a book Pat's keys read but do not write), Olive (outsider); keys H (headless scoped), K (ordinary scoped, same books), S (Sam's), O (Olive's). 208 assertions passed; the six that failed were the probe's own comparison mistakes (the markdown response contains the recipe text, which says "headless"; two description updates echo different previous descriptions), and follow-up probes confirmed the behaviour in each.
- **Tests fail without the slice's rules** (mutations in the throwaway tree, reverted): `keyForcesDrafts` returning false fails 6 of the 20 unit tests in `roles.test.ts` and `deposit-level.test.ts`; `keyMayVerifyDrafts` returning true fails 6; forcing drafts only for the exact value `drafts` (not fail-closed) fails 5; a planted `UPDATE … SET deposit_level` fails the static test and `check:authz-seam` (exit 1); a planted key statement in `routes/keys.ts` fails `check:authz-seam`. Bypassing `keyForcesDrafts` in `trace.service.ts` passes every static check and unit test and is caught only by the live suite: rebuilt and served on a second port, `drafts-headless.test.ts` failed 8 of 18. So the forced deposit is protected by the Layer 3 suite alone, which is what S5-M3 asks for.
- **Code review** of `7bcedba..0b044ef`.

**Where it lives**

| # | Verdict | Evidence |
|---|---|---|
| S5-M1 | pass | `authenticateKey`'s one statement selects `k.deposit_level`; `Principal.depositLevel` is set only there (a repo grep finds no other `depositLevel:` assignment outside tests, and the type makes it required, so every principal comes from it). No route or service reads the column; seam guard green. |
| S5-M2 | pass | The two predicates sit together in `roles.ts`; the doc comment names `verify_draft`, its REST twin, option-set resolution, and agent reject or not-chosen outcomes. Live, keys whose stored level was set by direct SQL on the throwaway database to `none`, `""`, `weird`, `DRAFTS`, and `Full` each deposited an unverified draft with `draft=false`, were refused by `verify_draft`, and got the headless briefing. Mutations above. |
| S5-M3 | pass (Layer 3 carries it) | The only change on the deposit path is `forcedDraft = !!subject \|\| keyForcesDrafts(principal)` beside the existing on-behalf forcing; `check.ts`, `mcp.ts`, and `apps/mcp-server` are unchanged in the diff. The single `INSERT INTO claimnet.traces` is still the only trace insert (grep). The seam guard does not see a bypass of this line (mutation above); the live suite does. |

**Storage**

| # | Verdict | Evidence |
|---|---|---|
| S5-S1 | pass (by code review) | `0040_api_keys_deposit_level.sql` is one `ALTER TABLE … ADD COLUMN "deposit_level" text DEFAULT 'full' NOT NULL;` with no `UPDATE`; `check:data-model` passed in both gate runs. Existing rows read `full` by Postgres's column-default semantics; no pre-slice database was migrated (the builder's note says the same). |
| S5-S2 | pass | Only the scoped `INSERT` in `api-key.service.ts` writes the level; the daily insert and `mintOAuthTokenBundle`'s insert do not name it; `ephemeral-workspace.service.ts`'s `UPDATE claimnet.api_keys` touches scope columns only. `deposit-level.test.ts` pins all of this and fails on a planted `SET deposit_level`. |
| S5-S3 | pass | Two fingerprints re-registered (`api-key.service.ts`, `trace.service.ts`), each keeping its reason and adding a slice 5 clause. |

**Forcing drafts on every deposit surface**

| # | Verdict | Evidence |
|---|---|---|
| S5-W1 | pass | The full cross product the builder simplified: seven surfaces (MCP structured, MCP markdown, `GET /check` JSON, `POST /check` urlencoded, multipart, the HTML `GET`, and the HTML form `POST`) × five `draft` values (absent, `false`, `"false"`, `"maybe"`, `true`). All 35 through H stored `unverified`, author Pat, no subject; all 35 through K stored what they store today (null for absent and false, `unverified` for `maybe` and true). Opt-out attempts (`depositLevel=full`, `deposit_level=full`, `headless=false`, `level=full` on each form surface, and the same as MCP arguments) were ignored. H naming Pat himself in `on_behalf_of` (padded, upper case) is still a headless draft. The stdio server, run live over stdin against the backend, stored a headless draft from `draft: false`. |
| S5-W2 | pass | On all 35 H deposits the notice gives "because this API key is headless, a setting chosen when the key was made", `http://localhost:5873/app/drafts?ids=<full id>`, and no `verify_draft`; "(your draft flag was overridden)" appears for `false` and `"false"` only (absent, `maybe`, and true do not get it). |
| S5-W3 | pass | One MCP deposit through H with `on_behalf_of` Sam, `decided_at` 2025-03-15, `impact` high, `uncertainty` low, `intent` text, `known_recipes`, a base64 PNG, and a ride-along feedback row: stored as an unverified draft about Sam by Pat with the date and ratings, one `trace_references` row, the audit row carrying `intentId` and the file, the feedback row stored, and the on-behalf notice. H's own `POST /uploads` then `file_url` stored a draft with its reference. A deposit into a workspace H created is a draft in that book. |
| S5-W4 | pass | Identical repeats through MCP (`draft` absent then false) and `GET /check` return the same id, still `unverified`, one row, notice "…still a draft: checking it again does not verify it, and this headless key cannot" with the link. After Pat's `wrong` reaction the repeat reports the rejected state, no new row. A repeat of a draft Pat had confirmed returns the same (now published) row; H published nothing. |
| S5-W5 | pass | H and K compared after replacing ids, timestamps, intent ids, and key strings: `search_recipes` (default, `author:me`, `is:draft`, and with intent text), `/check?filter=` (`author:anyone`, `is:draft`, `author:me`, by `recipeId`), `get_recipes`, `GET /recipes`, `list_my_recipe_books`, `get_briefing` (plain and with verbosity, purpose, and recipe ids) and `GET /briefing` minus the section, `log_feedback` (with and without `intent_id`), `POST /feedback` (single and batch), `GET /feedback`, `POST /uploads`, `/health/version` (full body less the key's expiry), `/health/integrity`, and `POST /workspaces`: all equal. |
| S5-W6 | pass | H updates Pat's personal book's description; the answer has K's shape, and both write `group.description_updated` rows. For the read-only book (by slug and by id), the shared book, and a missing slug, H's and K's answers are byte-identical. |

**Verify and resolve refusals**

| # | Verdict | Evidence |
|---|---|---|
| S5-R1 | pass | H's `verify_draft` (remote), `POST /recipes/:id/verify` (403, `status: key_cannot_verify`), and the stdio `verify_draft` (run live) each refuse with the headless reason, the queue link with the id as given, and the ordinary-key alternative. State, evidence count, reactions, and `recipe.draft_*` audit rows unchanged. |
| S5-R2 | pass | K verifies an H draft: published, audit `verifiedByDepositingKey: false`. Pat's queue id-link view lists H's drafts; his `still_true` confirms one and not chosen marks another. |

**Key creation and display**

| # | Verdict | Evidence |
|---|---|---|
| S5-K1 | pass | `drafts`, `full`, and absent round-trip through the mint response and `GET /keys`. `none`, `true`, `"DRAFTS"`, `1`, `null`, `""`, `" drafts"`, `["drafts"]`, `"headless"`, `false`, and an object are 400 and add no `api_keys` row. |
| S5-K2 | pass | `PATCH`, `PUT`, and `POST /keys/:id`, `PATCH`/`POST /keys/:id/deposit-level`, `PATCH /keys`, and `PUT /keys/scoped` are 404 or 405, and H's stored level is still `drafts` afterwards; H itself on `POST /keys/scoped` is 401; `POST /keys/briefing` ignores a `depositLevel`. The page offers no toggle (browser E5). |
| S5-K3 | pass | Browser E1, E3, E6: the checkbox, off by default, with the one-sentence description; "Headless: deposits drafts only" as text in the banner and the row, surviving a reload; Copy agent briefing on the headless key puts the headless section on the clipboard, the ordinary key's has none. |
| S5-B1 | pass | On remote `get_briefing`, `GET /briefing` (full profile), `GET /briefing` with the stdio surface header, the stdio server itself (run live), and `POST /keys/briefing`, H's text is K's with only the section removed; the section follows "## Your API key". A daily key's briefing has none. |
| S5-O1 | pass | `POST /keys/daily` with `drafts`, `none`, `null`, `"FULL"`, `true`, and `""` is 400 `daily_keys_are_full` with no new row; `full` and absent mint, stored `full`. OAuth issuance and rotation are unchanged in the diff and pinned by the static test. |

**Uniform responses**

| # | Verdict | Evidence |
|---|---|---|
| S5-U1 | pass | H's `verify_draft` answer is byte-identical, after replacing the echoed id, for its own draft, K's published recipe, K's draft, Sam's draft, an 8-character prefix, a random UUID, and `not-an-id`; REST likewise (status and body). No side effect on K's or Sam's drafts. |
| S5-U2 | pass | For Sam's and Olive's keys, `get_recipes` and `GET /recipes` on an H draft equal a random id, and `author:anyone` search does not list it; for Sam and Olive, `GET /traces/:id` equals a random id (status and body). The slice 2 to 4 suites passed in the gate and the isolated re-run. |

**Budgets** (measured by the verifier: served lists live, copy lengths from the domain functions over the rubric's fixtures)

| # | Verdict | Evidence |
|---|---|---|
| S5-Z1 | pass | Remote `tools/list` **16,986** bytes for H and for K, byte-identical, `verify_draft` and `update_recipe_book_description` included (cap 17,000); stdio **13,196** for H and K, byte-identical, measured through the running stdio server (cap 13,670). |
| S5-Z2 | pass | Shared descriptions **6,051** characters; cap 6,080 unchanged. |
| S5-Z3 | pass | Thin fixture **18,183** characters (18,297 bytes), full **24,119** (24,261 bytes), both unchanged; with the section 18,536 and 24,472; the section is **351** characters (limit 400); ceilings 18,200 and 18,600 held. No live pre-slice `GET /briefing` was captured; byte-identity rests on the domain test (absent or false equals the ordinary text) and the live H-versus-K comparisons. |
| S5-Z4 | pass | With a 73-character queue URL: headless new-draft notice **338** characters against the self draft's **344**; with the override clause **371** (+27, limit +80). Verify refusal **289** characters plus the link. |
| S5-Z5 | pass (code review) | `authenticateKey` is still one statement with one more column; the deposit adds a pure predicate call and no statement or round trip. |

**Accessibility and phone width** (browser run: expectations and results in the private companion repo under `docs/working/browser-verification/2026-09-28-drafts-slice5/`; spec `tests/e2e/drafts-slice5.spec.ts`, written and run by this verifier and not committed, with a copy in that folder; desktop 2 tests, mobile 1; 2 passed, 1 failed on the soft axe assertions below. No open `handback.md` was found and none was written.)

| # | Verdict | Evidence |
|---|---|---|
| S5-UI1 | not met as written (pre-existing cause) | With the form open: none serious or critical. With the headless banner: a serious `color-contrast` (1.52:1) on the key row's "expires" date (`--color-outline-variant`) and a critical `label` on the banner's read-only raw-key input, both on lines the slice did not change. With a headless key listed, and expanded: the same "expires" contrast. The slice's new elements (checkbox, description, row and banner labels, the fixed-level note) raise none. |
| S5-UI2 | pass | The checkbox's accessible name is "Headless" and its description comes through `aria-describedby` as visible text; the row label is text in `on-surface` weight 600. Tabbing from the label field, past the days field, reaches it; after the transition its focus style is the design system's 2 px `box-shadow` ring (`outline: none`), visible in the close-up though subtle against the checkbox's own dark border; Space ticks it. |
| S5-UI3 | pass | Pixel 7 (412 px): content 412 px with the form open and with the headless row expanded, measured against the configured viewport. |

**Security properties.** Every deposit through a headless key was a draft on all seven surfaces and the stdio server, with no parameter that opts out (S5-W1), and nothing it did published: not a repeat, not `verify_draft` on either server, not the REST twin (S5-W4, S5-R1). No route changes a key's level, and no statement assigns it (S5-K2, S5-S2). Stored values other than exactly `full`, reserved or unknown, fail closed live (S5-M2). The refusal is the same bytes for every id and has no side effect, and a headless key's drafts are a random id to Sam and Olive (S5-U1, S5-U2). A headless key changes a description exactly as an ordinary key does (S5-W6). Daily keys cannot be minted headless (S5-O1). The layer that protects the forced deposit is the live Layer 3 suite, not the seam guard (S5-M3). The security audit is a separate role; its findings go to the private repo.

**Builder's interpretations** (build notes, 1 to 4), checked after the verdicts above.

1. An on-behalf deposit through H gets slice 4's notice unchanged, without the headless reason: confirmed (S5-W3) and agreed, since the on-behalf notice names the one person who can review it.
2. The daily refusal treats `null` as a request for another level: confirmed (400) and agreed; only the string `full` or an absent field mints.
3. The frontend reads a missing `depositLevel` as ordinary: agreed; this server always sends it, and the server's own reading is the one that fails closed.
4. The verify refusal echoes the id as given: confirmed for a prefix and garbage; the refusal is still uniform after replacing the echo (S5-U1).

The builder's simplifications (W1 on one value per surface, W3 without attachments, `intent`, or `known_recipes`, W5 without REST feedback or intents, R1 and B1 without a live stdio run) were all run by the verifier and pass.

**Found beyond the rubric** (none blocking).

- **The W5 parity test's `/check?filter=` pair compares nothing.** `drafts-headless.test.ts` maps `results.map((r) => r.id)`, but `/check` JSON results carry `recipeId`, so both sides are lists of `undefined` and only the count is compared. The verifier's comparison by `recipeId` found the lists equal. Follow-up: read `recipeId`.
- The `/check` HTML form still offers the "Deposit as a draft" checkbox to a headless key, where it has no effect. Copy follow-up at most.
- Pre-existing on the keys page: a key row expands only on a click of a `div` (not keyboard reachable), the "expires" date's contrast, and the unlabelled raw-key input (S5-UI1).

**Follow-ups** (none blocking): one green gate run before merge (the gate-reliability branch addresses the load timeouts); fix the W5 `/check?filter=` comparison; the pre-existing keys-page contrast, input label, and click-only row header; optionally, hide or reword the HTML form's draft checkbox for a headless key.

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

**Gate** (`TESTCI_PGPORT=5824 npm run test:ci` at `5a6c1a1`, with another session's gate running on 5814). It is not green: both runs exited 1, and no slice 5 test and no assertion about slice 5 behaviour failed in either run.

| Run | Exit | Tests | Failures |
|---|---|---|---|
| 1 | 1 | 1,783 passed, 6 failed | Setup-hook timeouts (30 s and 60 s) in `groups`, `import`, `keys` (F33 briefing), `ranking-regression`, `trace-delete.service`, and `vector-search`. 15 s test timeouts in `oauth-flow`, `check`, `workspaces` (3), and `draft-queue` S3-Q2, plus the 60 s cascade test. `draft-queue` S3-Q3 then counted 6 against 5, after S3-Q2 timed out mid-run in the same suite. |
| 2 | 1 | 1,844 passed, 1 failed | `waitlist.test.ts` "register stores the optional signup reason…": a 15 s test timeout. |

- The eleven files that failed in run 1, run alone on a fresh stack, all pass: 206 tests, exit 0.
- These are the known setup-hook and timeout flakes under concurrent load, which the gate-reliability work is fixing.

### Slice 5 fix pass (implementing agent, 2026-09-28)

After the verification record (`b73cc9f`) and the read-only security audit (private); both recommend accepting. `origin/main` had not moved. Each fix has a test that failed before it: 2 of the suite's 20 tests failed before the fixes.

- **Unknown fields on scoped-key creation** (`58d359e`, `9904190`): the `POST /keys/scoped` schema is `.strict()`, so a snake-case or misspelled level field, or `headless: true`, is a 400 that mints nothing, instead of an ordinary key. No client sends extra fields: the keys page, the testing plan's curl, and every test body send only the schema's fields. `POST /keys/daily` still reads its body loosely; the audit's note also names a snake-case level there, which the orchestrator did not ask to change. `9904190` rewords a comment that named the column, which the S5-S2 guard caught in the first gate run.
- **The `/check` HTML form** (`58d359e`): for a headless key the "Deposit as a draft" checkbox is checked and disabled, with the reason ("always on: this API key is headless…"). An ordinary key's form is unchanged.
- **The S5-W5 `/check?filter=` pair** (`58d359e`): it compared `r.id`, which results do not carry, so both sides were lists of `undefined`. It now compares `recipeId` and requires a non-empty list of real ids. With the fix the pair still matches.
- **Backlog** (`ba868fe`): F104 is folded into the F86/F95 guard-hardening item, by number only. The pre-existing contrast item now also names the keys page's 1.52:1 "expires" date, its unlabelled raw-key input, and key rows that expand only on a mouse click.

**Gate** (`TESTCI_PGPORT=5824 npm run test:ci`):

| Run | At | Exit | Tests | Failures |
|---|---|---|---|---|
| 1 | `ba868fe` | 1 | 1,820 passed, 2 failed | `deposit-level.test.ts`: a real failure, fixed in `9904190`. Also an `import.test.ts` setup-hook timeout and a 15 s `waitlist.test.ts` timeout. |
| 2 | `9904190` | 1 | 1,821 passed, 1 failed | Timeouts only: the `import.test.ts` setup hook (30 s) and `waitlist.test.ts` "register stores the optional signup reason" (15 s). |

Per the operator, GitHub CI is the judge when the local gate fails only on timeouts.

### Post-merge findings (2026-09-29)

From the post-merge browser verification of slices 1 to 5 on `main` (`720e71a`; the results are in the private repo), fixed on `fix/drafts-copy-followups` by agent `a-drafts-copy-2026-09-29`. Copy and UI only: no authorization or data change. Each fix has a unit test that failed first.

- **Fixed:**
  - Dana's page for a draft about Pat that Pat rejected or marked not chosen said "Only <Pat> can review this draft; send them the review link…". Once resolved it says "<Pat> has resolved this draft; there is nothing left to review."
  - The id-list page's intro said "Your agents parked these hypotheses about your taste and judgment" to Dana. It says so only when every listed draft is the viewer's own agents' about the viewer (the heading's rule), and otherwise says that only the person a draft is about can confirm or reject it. Dana still reads her own agent's reason as "Why your agent drafted it"; Pat reads "Why <Dana>'s agent drafted it".
  - The ratings label is "Depositing agent's ratings" on the detail page and in the queue (it was "Agent's ratings" on the detail page). It is true of every recipe and keeps S4-Q2's wording.
  - An unresolved draft's page no longer offers Stale. In the backend a Stale reaction on a draft is recorded and resolves nothing (`resolutionForReaction`), so the page offers only the two reactions its prompt names. The viewer's own earlier Stale stays, so it can be cleared. Backend behaviour is unchanged, including the ruling that a depositor's Stale stays allowed. Recipe `8d717a48`.
  - On `/check`, a headless key's forced draft box sits above the collapsed "Advanced" section instead of inside it.
  - A recipe book page takes its heading from the book ("Recipes in <book>"), not from its first visible recipe, so a book whose recipes are all hidden from the viewer keeps its name.
  - The queue page's root carries `data-testid="drafts-queue"` for the browser harness.
- **Intended, not changed:**
  - Dana may delete a draft about Pat after Pat rejects it. A rejected or not-chosen draft stays hers (recipe `b89db1f0`), so the author's delete right applies: `unpublishedDraftManagement` gives the depositor delete on any unpublished draft. S4-D1 and S4-A2 now say "unpublished" rather than "unverified", to match.
  - Before Pat confirms, both detail pages show Dana's agent badge. Dana is the author until verification, so her key is the author's key (open question 40's rule); F93's hiding applies once the recipe is Pat's.
  - "Recipes Checked" on the dashboard counts the person's own drafts. Only the person sees that figure (open question 9).
- **Out of scope:** the `/check` page's horizontal scroll at 412 px with a long unbroken word is one more instance for the backlog's heading-overflow item.

## Slices 6 to 9 (2026-10-24 onward): one heading per stream

Scaffolded by PR A0 so that concurrent streams edit separate hunks. Each stream writes under its own heading: the rubric (pass/fail rows), the build notes, the verification record by a separate agent, and a "Questions for the operator" list numbered on from 56. The rulings on open questions 45 to 55 are in the revision doc.

### Slice 6c rubric: agent-side resolution (stream A)

Written 2026-10-24 by stream A (agent `a-drafts-6c-2026-10-24`) before implementation, from the revision doc's 6c, 6e and 6f, rulings 46 and 55, and the code at `32ffa5c` (the A0 scaffold). Consumer: agent (the verify operation on remote MCP, stdio MCP and REST) and human (the detail page's state line, which today says "You marked this draft wrong" for every rejection). Security-relevant: yes. A draft can now be closed by an agent as well as published, so every authority and uniform-response row of slices 2 to 5 is re-run with the new outcomes. The combined read-only audit after A1, B, D and E covers it (implementation plan), with findings in the private repo.

Settled before this rubric (not reopened): one `outcome` parameter on the existing operation, no second tool and no fourth `superseded` value (recipe `d21d3894`; revision doc, Considered and set aside); a rejection may rest on context alone under the same rule as a verification (ruling 46, recipe `200ed4fe`); the existing audit trail is enough for agent-made resolutions, with no new column (ruling 55); `resolve_siblings` and sets are slice 6b (stream G); the queue's one-click actions and the reaction route are untouched.

**Calls made here** (each recorded in the build notes with its reasoning):

- `outcome` fails closed. Ratings are capture-only (an unknown value becomes NULL plus a notice), but a typo of `rejected` must never fall through to the default and publish. An unknown value stores nothing. It is a plain string on both MCP servers with the values in its description, not a schema enum, so the server can name a bad outcome and every evidence problem in one refusal (agreed with stream D, which owns the "every failing field at once" rule in 8a and leaves `verify_draft` to this stream).
- A covering recipe is cited as an ordinary evidence entry: its words quoted, `-- recipe <id>` as the citation. The server does not look up the cited id. The rule stays structural (ruling 14), and an id lookup would make the operation an existence oracle for ids the caller cannot read.
- The blank-line bug lives in the shared parser, not in a second one. `verify_draft` and `check_recipe` already call the same `parseEvidenceMarkdown`. For "interpretation, blank line, quote, blank line, citation" (the reading of "separated by blank lines" the field used), the parser folds the quote into the interpretation and then leaves the citation as a separate entry with no interpretation. `check_recipe` silently stores that as two entries; the verify rule finds no entry with both a quote and a citation and refuses. The fix is one rule in the parser: an entry closes at its citation, and a block with no interpretation continues the open entry. The fix applies to both tools, so they parse alike.

Terms and cast, as in the feature file: Pat (whose agents deposit and resolve), Sam (a member of Pat's shared book), Dana (who deposits on Pat's behalf). K is an ordinary key of Pat's that can write the book; H is a headless key of Pat's.

**Baselines** at `32ffa5c`, measured with the slice 1 method (`createMcpServer` with a stub principal and `createStdioServer`, each over the SDK in-memory transport, `initialize` then `tools/list`, the reply's `result` as minified UTF-8 JSON; description totals from the `@soupnet/domain` constants):

| Measure | Value | Cap (A0) |
|---|---|---|
| Remote `tools/list` | 16,986 bytes | 18,200 |
| Stdio `tools/list` | 13,196 bytes | 14,700 |
| Shared descriptions | 6,051 characters | 6,600 |
| `verify_draft` as served (remote) | 774 bytes | |

**Where it lives**

| # | Criterion | Evidence |
|---|---|---|
| S6c-M1 | One operation. `verifyDraft` in `draft-verify.service.ts` takes `outcome` and every surface reaches it: remote `verify_draft`, `POST /recipes/:id/verify`, and stdio `verify_draft` through the REST twin. No new tool, route or audit action. `resolveDraft` (`authz/draft-resolution.ts`) is called with the outcome as its `resolution`; its statement, authority check and audit CTE are not edited. | Diff review: `draft-resolution.ts` unchanged. |
| S6c-M2 | The vocabulary is defined once, in `@soupnet/domain` (the three values plus one parse function that returns the outcome or a refusal sentence naming the values). The MCP description, the REST route and the service use it. | Layer 1 test of the parse function: absent, `null` and `""` give `verified`; each value is accepted; `"reject"`, `"REJECTED"`, `true` and `1` are refused. |

**Behaviour**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S6c-B1 | `outcome` omitted means `verified`, with the slice 2, 4 and 5 behaviour unchanged. | DT-VER-04 | The slice 2, 4 and 5 verify tests pass unedited. |
| S6c-B2 | `outcome: rejected` through K writes `draft_state = 'rejected'` and `draft_resolved_at`, `draft_resolved_by_user_id` and `draft_resolved_by_key_id` (K), with `user_id` and `subject_user_id` unchanged. It writes one `recipe.draft_rejected` audit row with `via: "agent"` and `evidenceAdded` (the queue's action and shape), no reaction row, and attaches the new evidence entries. Afterwards the draft is gone from Pat's queue and from his agents' results, Sam still gets the uniform answer for it, and `get_recipes` by id shows Pat's agents a rejected draft. | DT-VER-10 (new) | Layer 3 on remote MCP, reading the row, the audit table, the reaction table and the queue back. |
| S6c-B3 | `outcome: not_chosen` is the same with `draft_state = 'not_chosen'` and `recipe.draft_not_chosen`. | DT-VER-11 (new) | Layer 3 on REST. |
| S6c-B4 | The reply says what happened per outcome, in the same words on every surface: published (as today), rejected (stays private to the person and their agents, out of the queue, evidence attached), or marked not chosen (same). The stdio server words its reply with the same domain function and no copy of its own. | | Layer 1 of the wording; Layer 3 on remote and REST; the stdio unit test against a stubbed backend. |
| S6c-B5 | REST success is 200 with `{ recipeId, draftState, evidenceAdded, verifiedByDepositingKey }`, where `draftState` is the outcome (the existing shape, so slice 2 clients keep working). | | Layer 3 on REST for each outcome. |
| S6c-B6 | An unknown `outcome` is refused and nothing is stored. REST answers 400. The refusal names the three values and also reports what is wrong with the evidence, if anything, so one retry suffices. It is decided before any lookup, so the answer is the same for every id apart from the echo. | | Layer 3 on MCP and REST: `"reject"` with good evidence leaves the draft unverified and stores no row; the same call with no evidence names both problems; Pat's draft and a random UUID get the same bytes after the id is replaced. |
| S6c-B7 | Resolution stays one-way across outcomes. Any outcome on a resolved draft is `already_resolved` (REST 409) and stores nothing. A `verified` and a `rejected` sent concurrently on one draft give exactly one resolution, one audit row and one set of evidence. | DT-VER-03 | Layer 3, including a concurrent pair. |

**Evidence**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S6c-E1 | The structural rule is unchanged for every outcome. It needs at least one entry with a quote and a citation whose quote the draft does not already carry. A rejection that only re-quotes the draft's own evidence is refused with the existing "adds nothing new" message, and the draft stays unverified. | DT-VER-05, DT-VER-06 | Layer 3 for `rejected` and `not_chosen`. |
| S6c-E2 | A rejection whose only new entry quotes a verified recipe and cites it by id (`-- recipe 1a2b3c4d`) passes. The server does not resolve the cited id: a cited id the key cannot read, or one that does not exist, passes the same way. | DT-VER-12 (new) | Layer 3. Code review: no lookup of the citation. |
| S6c-E3 | A refusal for missing evidence says how many entries the text was read as and what each one lacked. Its wording matches the outcome: for a rejection, quote the person's answer or the recipe that covers the call, cited by id. | | Layer 1 on `validateVerificationEvidence`. |
| S6c-E4 | Evidence written as interpretation, blank line, `> quote`, blank line, `-- citation` is one entry. A quote whose paragraphs are separated by blank lines stays one quote in that entry. The same text is accepted by remote `verify_draft`, by REST and by `check_recipe`, and stored as one entry by each. Every existing parser test passes unedited, the `a2c8fb64` regression and "does not fold a second orphaned citation" included. | DT-VER-13 (new) | Layer 1 cases in `evidence-parser.test.ts`; Layer 3: one verify call per surface with the field's shape. |

**Authority and uniform responses** (slices 2 to 5 re-run with the new outcomes)

| # | Criterion | Evidence |
|---|---|---|
| S6c-A1 | H gets `key_cannot_verify` (403) for every outcome, decided before any lookup, with the same bytes for Pat's draft, a published recipe, Sam's draft and a random id (S5-R1, S5-U1). Nothing is stored. | Layer 3 on MCP and REST per outcome. |
| S6c-A2 | Dana, who deposited a draft about Pat, gets the honest `only_subject_reviews` refusal for `rejected` and `not_chosen` (S4-R2), and nothing is stored. Pat's agent rejecting that draft leaves it Dana's: `user_id` and `subject_user_id` are unchanged (recipe `b89db1f0`). | Layer 3 in `drafts-on-behalf.test.ts`. |
| S6c-A3 | Sam's key calling any outcome on Pat's draft gets the same 404 and body as for a random UUID, after the id is replaced, on MCP and REST (DT-VER-07, S3-F1 (c)). | Layer 3 byte comparison per outcome. |
| S6c-A4 | A key of Pat's that can read but not write the draft's book gets `needs_write_access` (403) for every outcome ([F78]), and nothing is stored. | Layer 3. |

**Copy and the web**

| # | Criterion | Evidence |
|---|---|---|
| S6c-C1 | `MCP_TOOL_DESCRIPTIONS.verifyDraft` is the 7b text: "Publish, reject, or mark not chosen a draft about your user once you or they can stand behind the answer: new evidence quoting their words, or the context that settles it. Evidence that adds nothing new is refused." The `outcome` description names the three values and the default, and says what `rejected` and `not_chosen` mean in at most 160 characters. `verificationEvidence` admits a covering recipe's words as the quote. No other tool's or parameter's description changes. The `draft` parameter and the deposit notice are stream C's (C2). | `mcp-tool-descriptions.test.ts`; diff review of `recipe-guide-content.ts`. |
| S6c-C2 | The detail page's state line for a rejected or not-chosen draft says who resolved it, as the verified line does (by you, by your agent, by the agent that deposited it). It no longer says "You marked this draft wrong" when an agent rejected it. The text still starts "Rejected draft" / "Draft not chosen", so `drafts-slice3.spec.ts` holds. | `draft-status-label.test.ts` cases per resolver. |
| S6c-C3 | The agent-facing label for a rejected draft (`draftLabel`) no longer says "the person said this is wrong", since an agent may have rejected it on context. It says the draft was rejected and that its evidence says why. | `packages/domain/src/drafts.test.ts`. |
| S6c-C4 | The feature file gains DT-VER-10 to DT-VER-14 tagged `@slice-6c` (14: an unknown outcome is refused). The Rule's title no longer says verification needs "the person's own words" (ruling 46 and recipe `200ed4fe` allow the settling context). | Diff review. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S6c-Z1 | Remote `tools/list`, stdio `tools/list` and the shared-description total stay under the A0 caps without touching the cap constants. Bytes before and after are recorded in `spec-decision-log.md` and here. | Size tests green; the figures. |
| S6c-Z2 | `tools/list` stays byte-identical for H and K (S5-Z1). | Existing test. |

**Surfaces that must change:** `draft-verify.service.ts`, `routes/recipes.ts` (the verify route), the `verify_draft` schema in `routes/mcp.ts` and `apps/mcp-server/src/server.ts`, `packages/domain/src/drafts.ts` (the vocabulary, the evidence refusal, the reply wording, the rejected label), `MCP_TOOL_DESCRIPTIONS.verifyDraft` and the verify entries of `MCP_PARAM_DESCRIPTIONS`, `services/evidence-parser.ts`, `apps/frontend/src/lib/draft-status-label.ts`, the drafts tests, the feature file, `spec-decision-log.md`.

**Surfaces that must not change:** `authz/draft-resolution.ts` and `authz/draft-sql.ts`; the reaction, queue and not-chosen routes in `routes/traces.ts`; the size-cap constants; every description that is not `verify_draft`'s; the five ranking files and `ranking-regression.test.ts`; the idempotency key; `check_feedback`.

**Security properties the verifier must see proven**

- Closing a draft takes exactly the authority publishing one does: the person's ordinary key, write access to the book, and only the person the draft is about (S6c-A1 to S6c-A4).
- No new oracle. Refusals that do not depend on the id (headless, unknown outcome) are decided before lookup; everything the key cannot read gets the uniform answer; a cited recipe id is never looked up (S6c-B6, S6c-A1, S6c-A3, S6c-E2).
- An agent-made resolution is auditable the way a verification is: resolving key, `via: "agent"`, and the new evidence on the draft (ruling 55).
- A mistyped outcome never publishes (S6c-B6).

**Briefing-copy declaration.** The `verify_draft` description, the `outcome` and evidence parameter descriptions, the reply wording, and the refusal are agent-facing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The PR appends one `spec-decision-log.md` entry with the bytes before and after. The 7b scenario edits for the rest of the tool copy are stream C's (C2).

### Slice 6c build notes (stream A, 2026-10-24)

Branch `drafts/6c-resolution`, from the A0 commit `32ffa5c`. Agent `a-drafts-6c-2026-10-24`, intent `int_cAyrEfRTTxiQvt4shMN6tNGf`.

**What was built**, one commit per unit:

- `235df21` domain: `DRAFT_OUTCOMES` and `parseDraftOutcome` (fail closed), `validateVerificationEvidence` with a per-outcome refusal that says how the text was read, `describeResolution` (the reply for each outcome, shared by both MCP servers), and the rejected-draft label.
- `4cb94ab` the shared evidence parser: an entry closes at its citation, so interpretation, blank line, quote, blank line, citation is one entry, on `check_recipe` as on `verify_draft`.
- `ac30a8a` `outcome` through the service, `POST /recipes/:id/verify`, the remote tool and the stdio proxy; the 7b description; the `outcome` and evidence parameter descriptions. `resolveDraft` is not edited: it already writes all three outcomes, their audit actions and the one-way rule.
- `a4080df` the detail page's rejected and not-chosen lines name who resolved the draft.
- `d7c5bf4` DT-VER-10 to DT-VER-14 and the Rule title in the feature file.
- Layer 3 tests in a new file, `apps/backend/src/routes/drafts-resolution.test.ts`, one test per rubric row group, so that the slice 2, 4 and 5 suites stay unedited (S6c-B1). Decision-log entry in `spec-decision-log.md`.

**Calls made, each recipe-checked in `soupnet-oss` and closed with a feedback row:**

- `outcome` fails closed and is a plain string judged by the service, not a schema enum (check `3f0e1bc1`; the corpus returned `d21d3894` and `10e3d7e1`, the ratings precedent for a described string). The refusal names a bad outcome and any structural evidence problem together; whether a quote is new needs the draft, so that part waits for the lookup.
- A covering recipe is an ordinary evidence entry, and the cited id is never looked up (check `994b1f88`; the corpus returned `12591bef`, ruling 46 in the operator's words, and `507d3c9c`, the anti-oracle rule).
- The blank-line fix is in the one shared parser (check `41e51b60`; the corpus returned `508f71c8`, the operator's May choice of a tolerant parser, which this extends). After verification (defect 2) the join is narrower: a quote continues the open entry only while that entry's quote is still unclosed, so a complete quote waiting for its citation keeps a later, separately cited quote apart, as before 6c (check `3123c1e1`; the verifier's check `1dbea5ed` states the rule: every stored quote stays verbatim under the citation it is filed under).
- "A person", not "the person", wherever the new copy names whose answer settles a draft, since in a shared book the call may be a colleague's (Andy's note of 2026-10-24, checked as recipe `5d3ddfc7`). The rejected and not-chosen replies say "it stays private, leaves the review queue" without naming whose.
- Evidence on a rejected or not-chosen draft is attached with stance `for`, the only stance ingest writes; the interpretation carries why the claim does not hold. The audit row keeps slice 2's shape, so its `verifiedByDepositingKey` key, like the REST field of that name, means "resolved by the depositing key" for the other two outcomes. Renaming either would break the queue's audit shape and slice 2's wire shape for no reader's gain.

**Cross-stream notes** (the plan's rule: a call that changes another stream's surface is written here):

- For C (C1 and C2): the parameter is `outcome` on `verify_draft` and `POST /recipes/:id/verify`, values `verified` (default) | `rejected` | `not_chosen`; a superseded draft is `rejected` quoting the covering recipe and citing `-- recipe <id>`. The briefing scenario for resolving drafts belongs in `checking-behavior.feature` (C's file) and lands with C1, which merges after A1; the A1 decision-log entry says so.
- For D (8a): agreed in session that D does not edit `verify_draft`'s schema, descriptions or service; the "every failing field at once" rule for `verify_draft` is met here (S6c-B6). D's unknown-parameter guard reads the registered schemas, so it picks up `outcome` without a list.
- For B and D, the shared budget: A1 takes remote `tools/list` from 16,986 to 17,297 bytes (cap 18,200), stdio from 13,196 to 13,507 (cap 14,700), and the shared descriptions from 6,051 to 6,316 characters (cap 6,600), leaving 284 characters for B's `intent:` term and D's enumerations.
- For B: 6c never writes `intent_id`; `resolveDraft`'s UPDATE is unchanged.

**Environment note for every stream:** the worktrees were moved from `C:\github\SoupNet-wt\` to `C:\github\SoupNet\SoupNet-wt\`, and the `@soupnet/*` links under each worktree's `node_modules` still pointed at the old path, so vitest silently resolved the main checkout's stale packages (size tests failed on a clean branch). Re-pointing the nine links as junctions fixed it; streams B, C and D confirmed the same fix.

**Questions for the operator:**

56. **Rejection evidence on a draft about someone else, seen by its depositor.** When Pat's agent rejects a draft Dana deposited about Pat, the new evidence is attached to the draft, and Dana, who can still read the draft (it stays hers), now sees that evidence card on her detail page; `GET /traces/:id` also returns the entry's `createdAt`. Before 6c a rejection added no evidence, so S4-M3 ("Resolution details (who, when, which key) stay the subject's alone") was never tested by it. The card names no key, but it shows that an agent resolved the draft and roughly when. **Recommendation: keep it, and narrow S4-M3 to the resolution columns and the resolving key.** A rejected on-behalf draft remains Dana's own recipe (recipe `b89db1f0`), the evidence is the record of why her hypothesis did not hold, which is what she would want, and hiding entries on her own recipe from her would be odd. **The alternative is right** if the subject's activity on a colleague's draft should stay private beyond its outcome: then the read paths (the detail page, `GET /recipes`, `get_recipes`) would leave out, for the depositor, the evidence entries added by the resolving key, through a fragment in the authz module. My recommendation is deposited as draft `1063b420` under this stream's intent; your yes or no settles it, and I will build the alternative on this branch if you choose it. **Ruled 2026-10-24: yes, as recommended** ("Yes to all three, confirm the drafts", in the claimNet planning session; draft `1063b420` verified with those words). No code change: the S4-M3 row above now says what it covers, S6c-A2 pins that Dana sees the rejecting agent's evidence and no resolution columns, and the comments in `trace-access.ts` and `draft-status-label.ts` say the same.

### Slice 6c verification record

Written 2026-10-24 by an independent verifier (agent `v-drafts-6c-2026-10-24`, Soup.net intent `int_3THN35Tz6JCa33aQ3yh9S5hR`), who did not build the slice and changed no product code or tests. Verified in the stream A worktree at `9c96fdd` (the slice is `32ffa5c..9c96fdd`; `9c96fdd` changes copy only, "a person" for "the person", and the byte figures).

**Verdict: accept once defect 1 is fixed or ruled acceptable.** Of the 23 rubric rows, 22 pass and 1 is partial (S6c-C1). All four security properties hold. One defect sits outside the rows' wording (the list rows' state label, defect 1), and the parser fix has a side effect worth a ruling (defect 2).

**How it was verified.**

- **Gate:** the run relied on is `TESTCI_PGPORT=5554 npm run test:ci` at `9c96fdd`, **exit code 0**: build, typecheck, lint, data-model check and authz seam check passed; 133 test files passed and 2 skipped; 1,899 tests passed and 6 skipped; the golden-set ranking eval ran and the script printed "CI tests passed!". Three earlier runs on 5554 exited 1 and are not relied on: runs 1 and 2 (at `f273fb2`) failed 22 and 14 tests on "sorry, too many clients already", and run 3 (`--maxWorkers=8`, at `9c96fdd`) passed every test but ended on a vitest worker that exited unexpectedly. Stream B was running its gate on the same port and compose project at the time, so two backends and two suites shared one database; no failure in those runs was in a slice 6c test or about slice 6c behaviour.
- **Slice tests, verbose:** `TESTCI_PGPORT=5554 node scripts/test-ci-local.mjs -- apps/backend/src/routes/drafts-resolution.test.ts <probe> --reporter verbose`, exit 0: all 13 `drafts-resolution.test.ts` tests passed, with the verifier's 6 probe tests below. Unit files (`drafts.test.ts`, `evidence-parser.test.ts`, `draft-status-label.test.ts`, `apps/mcp-server/src/server.test.ts`, `mcp-tools-list-size.test.ts`, `mcp-tool-descriptions.test.ts`) via `npx vitest run`: 144 passed, exit 0.
- **Probe:** a throwaway Layer 3 file (deleted afterwards) against the gate's backend. P1, non-string and near-miss outcomes over REST (`true`, `false`, `0`, `1`, `{}`, `[]`, `["rejected"]`, `"  "`, `"Rejected"`, `"rejected"` plus a zero-width space, `"not-chosen"`): each 400 `refused`, row and counts unchanged; `null` verifies. P2, an 8-character prefix with each outcome: 200, full id echoed, `draft_resolved_by_key_id` equal to the depositing key, one audit row. P3, 60 entries in one rejection: `evidenceAdded` 60 in the reply and the audit row; 25 uncited entries give a refusal that lists the first 10 and ends "…". P4, uniform answers: the headless key over REST and MCP gives one body for Pat's draft, a published recipe, Sam's draft and a random UUID for each outcome; K on Sam's draft equals K on a random id, with good evidence, with empty evidence, and by 8-character prefix; an unknown outcome gives one body for all four targets on K, H and Sam's key. P5, stdio against the real backend: the success reply and five refusals (unknown outcome, random id, already resolved, no citation, re-quote) are byte-identical to the remote tool's, and so is the headless refusal. P6, eight concurrent calls mixing all three outcomes on one draft: one 200, seven 409, one audit row, one evidence entry added.
- **Bytes** (slice 1 method: `createMcpServer` with a stub principal and `createStdioServer`, each over the SDK in-memory transport, `initialize` then `tools/list`, the `result` as minified UTF-8 JSON): remote 17,259 bytes for an ordinary and a headless principal, byte-identical; stdio 13,469; shared descriptions 6,278 characters; `verify_draft` as served 1,047 bytes on both servers, identical. These match the decision log and build notes at `9c96fdd`.
- **Mutations** (reverted): letting `parseDraftOutcome` fall through to `verified` fails 2 tests in `drafts.test.ts`; restoring the old fold condition (`!prev.quote && !prev.source`) fails the 3 new tests in `evidence-parser.test.ts`.
- **Parser comparison:** the parser at `32ffa5c` and at `9c96fdd` run over 11 evidence shapes (results under defect 2).
- **Code review** of `git diff 32ffa5c..9c96fdd`.

| Row | Result | Evidence |
|---|---|---|
| S6c-M1 | pass | One service, `verifyDraft`, takes `outcome`; remote `verify_draft`, `POST /recipes/:id/verify` and stdio (via REST) reach it. `resolveDraft` is called with `resolution: outcome`. `git diff 32ffa5c..9c96fdd -- apps/backend/src/authz/` is empty. No new tool, route or audit action. |
| S6c-M2 | pass | `DRAFT_OUTCOMES` and `parseDraftOutcome` in `packages/domain/src/drafts.ts`; the service parses with it and stdio reads `DRAFT_OUTCOMES`. The `draftOutcome` description is a hand-written string beside it, not derived. `drafts.test.ts` "parseDraftOutcome" covers absent, `null`, `""`, each value, and `"reject"`, `"REJECTED"`, `true`, `1`. |
| S6c-B1 | pass | `drafts-slice2`, `drafts-on-behalf` and `drafts-headless` test files are unchanged in the diff and pass in the gate; `drafts-resolution.test.ts` "S6c-B1" passes. Two non-verify assertions were edited because the slice requires it: the S2-B10 schema-shape test now lists `outcome`, and the slice 4 label tests take the new wording (S6c-C2, S6c-C3). |
| S6c-B2 | pass | `drafts-resolution.test.ts` "S6c-B2 / DT-VER-10" reads state, resolver, `user_id`/`subject_user_id`, audit action and metadata, reaction count, evidence and queue count. The test only checks the resolving key is not null; probe P2 shows it equals the depositing key. Absence from Pat's agents' results rests on `authz/draft-sql.ts` (unchanged), which admits only `unverified` own drafts. |
| S6c-B3 | pass | "S6c-B3 / S6c-B5 / DT-VER-11" over REST: `not_chosen` and `recipe.draft_not_chosen`. |
| S6c-B4 | pass | `describeResolution` in domain; `drafts.test.ts` "describeResolution"; stdio unit test "S6c-B4"; probe P5 shows stdio and remote byte-identical for success and refusals. |
| S6c-B5 | pass | 200 with `{ recipeId, draftState, evidenceAdded, verifiedByDepositingKey }` in the B3 test and probe P2 for all three outcomes. |
| S6c-B6 | pass | "S6c-B6 / DT-VER-14" (MCP bytes vs a random id, REST 400, counts unchanged); probe P1 (non-strings) and P4 (REST bytes identical across four targets and three keys). |
| S6c-B7 | pass | "S6c-B7 / DT-VER-03" (409 after resolution, concurrent verify/reject pair); probe P6 (eight-way burst, one winner, one audit row). |
| S6c-E1 | pass | "S6c-E1 / DT-VER-06" for `rejected`; probe P5 "requote" for `not_chosen` on both servers; unit test in `drafts.test.ts`. |
| S6c-E2 | pass | "S6c-E2 / DT-VER-12" cites a nonexistent id. Code review: the service looks up only `recipeId`; the evidence is parsed and checked structurally, never resolved. |
| S6c-E3 | pass | `drafts.test.ts` "says how many entries the text was read as"; Layer 3 "S6c-E3"; probe P3 for 25 entries. |
| S6c-E4 | pass | Three new parser unit tests; existing parser tests unedited; "S6c-E4 / DT-VER-13" (check_recipe stores one entry, MCP and REST accept). The REST leg checks the status only. See defect 2 for a side effect. |
| S6c-A1 | pass | "S6c-A1" compares Pat's draft with a random id on MCP; probe P4 adds a published recipe and Sam's draft on both REST and MCP, one body per outcome. |
| S6c-A2 | pass | "S6c-A2" in `drafts-resolution.test.ts` (the rubric named `drafts-on-behalf.test.ts`, which stays unedited for S6c-B1). "Nothing stored" is checked by `draft_state` only. |
| S6c-A3 | pass | "S6c-A3 / DT-VER-07" byte comparison on MCP and REST per outcome; probe P4 adds empty evidence and prefixes. |
| S6c-A4 | pass | "S6c-A4 / [F78]": 403 `needs_write_access` for `rejected` and `not_chosen`; checked by `draft_state` only. |
| S6c-C1 | partial | The tool description is the 7b text exactly. `draftOutcome` (118 characters) names the values and the default and says when to reject, but not what `not_chosen` means. `mcp-tool-descriptions.test.ts` checks budgets only, not the text. No other description changed (diff of `recipe-guide-content.ts`). |
| S6c-C2 | pass (detail page) | `draft-status-label.test.ts` "who resolved a rejected or not-chosen draft"; the verifier's run of `draftStatusLabel` over every resolver and outcome gives the right detail-page line in each case, starting "Rejected draft" / "Draft not chosen". The same function now mislabels list rows (defect 1). |
| S6c-C3 | pass | `draftLabel` gives "[rejected draft: its evidence says why]" (unit test; probe P6 via `get_recipes`). |
| S6c-C4 | pass | DT-VER-10 to DT-VER-14 tagged `@slice-6c`; the Rule title reads "resolved by its person, or by their agent with new evidence that settles it". |
| S6c-Z1 | pass | 17,259 / 13,469 / 6,278 against caps 18,200 / 14,700 / 6,600; cap constants unchanged in the diff. |
| S6c-Z2 | pass | Remote `tools/list` byte-identical for the ordinary and headless principals (17,259). |

**Security properties.** Closing a draft takes the same authority as publishing it (A1 to A4, P4). No new oracle: the outcome and headless refusals are decided before lookup and are identical across four target kinds; unreadable ids, prefixes included, read like random ones; the cited id is never looked up (P4, code review). Agent resolutions record the resolving key, `via: "agent"` and the evidence count (B2, P2, P3). A mistyped outcome never publishes (B6, P1, mutation).

**Surfaces that must not change.** `git diff 32ffa5c..9c96fdd` is empty for `apps/backend/src/authz/`, `apps/backend/src/routes/traces.ts`, the ranking files and `ranking-regression.test.ts`; the cap constants, the idempotency key and `check_feedback` are untouched; the only description changes are `verifyDraft`, `verificationEvidence` and the new `draftOutcome`.

**Defects, ranked**

1. **List rows now say "(by the person it is about)" for every rejected or not-chosen draft.** `draftStatusLabel` also renders the bracketed label on the dashboard (`DashboardPage.tsx`) and the book page (`GroupTracesPage.tsx`), whose rows come from `GET /traces` and carry `draftState` but no resolver fields. With no `draftResolvedByKeyId` and no `draftResolvedByViewer`, `resolvedBy` falls to "by the person it is about". Scenario: Pat's agent rejects his draft with `verify_draft`; on his dashboard the row reads "[Rejected draft (by the person it is about)]", which names Pat in the third person and is false (his agent did it). Before 6c it read "[Rejected draft]". Dana, who deposited a draft about Pat, sees the same words on the book page, a claim about who resolved it that S4-M3 says the depositor is not told (a constant string, so nothing leaks, but it can be false). The verified line has had the same fault in lists since slice 2. Fix: add the resolver clause only when the row carries the resolver, and say nothing otherwise.
2. **The parser fix can put one quote under another block's citation.** An entry now stays open until it has a citation, so a quote-and-citation block with no interpretation joins an earlier entry that has a quote but no citation. Scenario: `check_recipe` evidence `Interp A.` / `> "Quote A."` / blank / `> "Quote B."` / `-- Source B` used to store Quote A uncited and Quote B under Source B; it now stores one reference whose quote is `Quote A." "Quote B.` under Source B. A reader sees Quote A attributed to Source B, and the stored quote is no longer a verbatim passage of either source. The same join produces `Para one." "Para two.` when each paragraph of one answer is quoted separately, and `q0" "q1` for two quote-only blocks. The build notes name the merge but not these two effects. The common shapes are unaffected (canonical entries, interpretation-only entries, an orphan after a cited entry). Rare and low in harm; checked as recipe `1dbea5ed` and left for a ruling: either accept, or join only when the earlier entry has no quote.
3. **`draftOutcome` does not say what `not_chosen` means** (S6c-C1). Agents get "Reject when it does not hold or a verified recipe covers it", and nothing for the third value; 42 characters remain under the row's 160.

**Observations**

- The unknown-outcome refusal appends the evidence problem worded for verifying ("Verifying a draft needs new evidence…") even when the caller plainly meant to reject. The `needs_write_access`, headless and `only_subject_reviews` refusals also still say "verify" or "confirm" on a rejection call.
- The outcome is judged before the headless check, so a headless key with a typo gets the outcome refusal and learns it cannot verify only on retry. Both are id-independent.
- `" rejected "` is accepted (trimmed); a zero-width space is not.
- Splitting one of the draft's own quotes over two blank-line blocks ("Q", blank, "Q", citation) now yields a stored quote "Q Q" that passes the "adds nothing new" rule. The rule was always structural and any edit to a quote passes it, so this is not a new exposure.
- Version skew: a pre-6c backend ignores `outcome`, so a new stdio server (or any client) sending `outcome: rejected` to an older self-hosted backend publishes the draft, and the stdio reply then honestly says "verified". Deploy the backend before shipping a `.mcpb` that sends `outcome`.
- Layer 3 gaps closed by the probe rather than the suite: the resolving key is checked as not null rather than equal to K; "nothing stored" in S6c-A2 and S6c-A4 is checked by state only; S6c-B6's REST byte comparison and S6c-A1's published and Sam's-draft targets are not in the suite. Worth adding when the file is next touched.
- The build notes do not record a gate run.

**Out of scope**

- The verified line's "(by the person it is about)" in list rows predates 6c (slice 2); defect 1's fix covers it.
- The review queue, reaction and not-chosen routes, and option sets (6b), are unchanged here and were not re-verified.

### Slice 6c after verification (stream A, 2026-10-24)

What was done with each finding of the verification record above:

- **Defect 1, list rows misattribute the resolver:** fixed in `42ecc9d`. The resolver clause appears only on a row that says who resolved it (the detail page sends `draftResolvedByViewer` and the resolving key; `GET /traces` rows send neither), so the dashboard and book page read "Rejected draft", "Draft not chosen" or "Verified draft". This also fixes the verified line's list fault from slice 2.
- **Defect 2, a later cited quote joined an earlier uncited one:** fixed in `3afcec6`. A quote continues the open entry only while that entry has no quote or its quote is still unclosed; otherwise it stays its own entry, as before 6c (check `3123c1e1`).
- **Defect 3, S6c-C1 partial:** the `outcome` description now ends "; not_chosen when a viable option lost." (156 characters, under the row's 160).
- **Refusals that said "verify" on a rejection call:** the write-access refusal now says "resolving it needs write access … Resolve it with a key that can write <book>, or hand the review link to the person it is about". The headless refusal keeps slice 5's wording ("cannot verify drafts"), which is still true of every outcome.
- **Headless key with a mistyped outcome gets the outcome refusal first:** left as is. Both refusals are decided before any lookup and neither depends on the id, so the order reveals nothing; the outcome refusal is input validation and comes first on every key.
- **Version skew:** a backend from before 6c ignores `outcome`, so a stdio `.mcpb` built from this branch and pointed at an older backend would publish a draft it meant to reject. The remote MCP tool is served by the backend itself and cannot skew. Deploy the backend before releasing a `.mcpb` that sends `outcome`; the PR says so.
- **Gate runs:** `TESTCI_PGPORT=5544 npm run test:ci` exit 0 at `f273fb2` (133 files and 1,899 tests passed; 2 files and 6 tests skipped); scoped verbose run `drafts-resolution.test.ts` 13/13 with `drafts.test.ts` 45/45; the verifier's run at `9c96fdd` exit 0. After these fixes, `TESTCI_PGPORT=5544 npm run test:ci` exit 0 at `bfd6ba4` (133 files and 1,902 tests passed; 2 files and 6 tests skipped).

### Slice 6c browser verification (2026-10-24)

Run by the browser-verify skill at `5b11a7b` on an isolated stack (the worktree's backend on 127.0.0.1:3144 against a throwaway database, Vite on 127.0.0.1:5294; the shared dev stack untouched). Expectations and results are in the private repo's `docs/working/browser-verification/2026-10-24-drafts-6c/`. Spec: kept as `tests/e2e/drafts-slice6c.spec.ts` (the drafts specs are named by slice), with the verifier's seeding workaround removed (the dev stack disables the rate limit) and E7 corrected: the depositor's line has no date (S4-M3), and she sees the rejecting agent's evidence (ruling 56). 11 passed on desktop and mobile against the isolated stack.

- E1 to E6 and E8 to E10 met. The detail page reads "Rejected draft (by your agent on …)", "(by the agent that deposited it on …)", "Draft not chosen (by your agent on …)" and, after the Wrong reaction or the queue, "(by you on …)"; the dashboard and book page rows read "[Rejected draft]", "[Draft not chosen]" and "[Verified draft]" with no "by"; at 412 px the longest line fits with no horizontal scroll; axe finds nothing beyond the known colour-contrast list.
- E7 not met on one clause, an error in the expectation, not in the app: the depositor's line reads "Rejected draft" without a date, because S4-M3 withholds the resolution date from the depositor.
- Found, not listed: the depositor sees the rejecting agent's evidence (question 56); a person's own resolved draft still offers Still true, Stale and Wrong under "Is this recipe still right?" (pre-existing since slice 2, backlog); the title for a draft rejected by its depositing agent is the same as for another agent's (only the line tells them apart; left as is).
- Harness: the isolated backend ran without `DISABLE_RATE_LIMIT=true`, so seeding hit the auth rate limit; the spec worked around it per actor. Recorded in the run's `handback.md`.

### Slice 6a rubric: the intent link (stream B)

Written 2026-10-24 by agent `a-drafts-6a-2026-10-24` (stream B), before implementation, from the revision doc's 6a and 6f, the implementation plan's stream B, and the code at `32ffa5c`. Consumer: agent (`intent:` on `search_recipes` and `/check?filter=`, the orchestrator's poll) and human (the review queue's intent groups, `intent:` in the queue's search box). Security-relevant: yes. The slice adds a stored link from a recipe to a private per-user object and a qualifier that selects by it, so the qualifier must not become an oracle for other people's intents, and the link must not widen anyone's view of a recipe or of an intent's story. The queue page changes, so the slice also gets a browser verification run.

Settled before this rubric (not reopened here): the qualifier is a selection, built outside the five ranking files as the rating filters were (ruling 23); an intent is the set, no option-set entity (revision doc §Considered and set aside); no MCP tool and no REST route for intents in this slice (slice 9 owns those); export carries the link, and import restores it only for the importer's own intents (6a).

**Decisions this rubric makes**, each recorded in the build notes with its reasoning, and each a reversible call:

1. **Which intent a deposit links to.** The intent the check itself resolved: an `int_…` id the server matched to the caller's own intent, or the intent the same check registered from story text (the check's `intentId` echo). Both are the caller's own by construction, and an orchestrator's first check often registers. Never raw client text, never an id that did not resolve (unknown, another user's, budget exceeded, oversize story): those deposit with `intent_id` NULL, as today.
2. **Whose intents the qualifier selects by.** The viewer's own only. `intent:<id>` resolves the id against the viewer's intents; an unknown id and another person's id yield the same empty set and the same note. Within the viewer's own intent, the ordinary visibility rules still decide which recipes come back.
3. **`intent:` lifts the surface's exclude-own default**, as `is:draft` does (ruling 24): every recipe under the viewer's own intent was deposited by the viewer, so with the default applied the poll would always come back empty.
4. **Queue headings show only the viewer's own intents.** A draft about Pat that Dana's agent deposited under Dana's intent is listed ungrouped in Pat's queue: Dana's intent story is never shown to Pat.
5. **No foreign key** on `traces.intent_id`, in the house style of `traces.user_id` and `check_feedback.intent_id`; a link whose intent is gone (its owner's account erased) is inert, since every read resolves the id against the viewer's intents.

Cast, as in the feature file: Pat (the key's owner), Sam (a member of Pat's shared book), Dana (a writer of the shared book who deposits on Pat's behalf). Intents: I1 and I2 are Pat's; J1 is Sam's; D1 is Dana's.

**Baselines**, measured by this agent at `32ffa5c` with the slice 1 method (after re-pointing the worktree's `node_modules/@soupnet/*` junctions, which pointed at the worktree's old location and so resolved the main checkout's packages):

| Measure | Value | Cap (after A0) | Headroom |
|---|---|---|---|
| Remote `tools/list` | 16,986 bytes | 18,200 | 1,214 |
| Shared descriptions | 6,051 characters | 6,600 | 549 |
| `searchQuery` parameter description | 415 characters | | |

**Storage and the one writer**

| # | Criterion | Evidence the verifier looks for |
|---|---|---|
| S6a-S1 | `traces` gains one nullable column, `intent_id text`, no default, no foreign key, with a schema comment naming its one writer and its read rule, and one partial index `(intent_id) WHERE intent_id IS NOT NULL` serving the qualifier. One Drizzle migration with no `UPDATE`; every existing row reads NULL; `npm run check:data-model` passes with the regenerated doc. | Migration SQL reviewed; data-model check output. |
| S6a-S2 | The deposit writes it in the one deposit statement (`INSERT INTO claimnet.traces` in `trace.service.ts`), from `resolveIntent`'s result only (decision 1). A check carrying an unknown id, another user's id, an over-budget registration, or an oversize story deposits with NULL. | Layer 3: one check per case, the row read back. |
| S6a-S3 | First write wins: an identical repeat under a different intent keeps the stored `intent_id` (the ratings rule, DT-RAT-08). | Layer 3: deposit under I1, repeat under I2, read I1. |
| S6a-S4 | Nothing else writes it: no `UPDATE` of `claimnet.traces` and no Drizzle `.update(traces…)` anywhere in `apps/backend/src` names the column, in any spelling (quoted identifiers, a column named through an interpolated fragment); the only inserts that set it are the deposit and the import (S6a-E2), in any spelling. Verification (`verify_draft`, its REST twin, the queue's reactions and not chosen, stream A's outcomes), moves, and the on-behalf author flip leave it as deposited. | A static test in the `deposit-level.test.ts` style listing the two writers; Layer 3: an I1 draft verified, and an I1 recipe moved to another book, keep I1. |

**The qualifier**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S6a-Q1 | The grammar accepts `intent:<id>` where the id has the `int_` shape (`int_` and 24 letters or digits). One value per query; a malformed value, a second `intent:` naming a different id, a group (`intent:(a OR b)`), and `-intent:` are each a loud parse error naming the form. (Amended 2026-10-24 after the verification, finding 2: as written the row also refused a repeat of the same id; the parser accepts it, as `is:draft is:draft` is accepted, since it selects the same one intent. Recorded here so the narrowing is visible, not silent.) The unknown-qualifier help lists `intent:`. | | Layer 1 table tests in `search-query.test.ts`; 100% branch coverage of the new parser branch. |
| S6a-Q2 | For the viewer's own intent, the qualifier keeps exactly the recipes whose `intent_id` is that id, ANDed with every other selection and with the visibility rule; it only removes rows. With semantic text the pipeline's order among the kept rows is unchanged (the S3-G7 shape). | | Layer 3 on `search_recipes`: deposits under I1 and I2; `intent:I1` returns only I1's; `intent:I1` plus semantic text returns I1's in the same relative order as the same text without the qualifier. |
| S6a-Q3 | It composes with every existing qualifier: `is:draft intent:I1` returns exactly Pat's unresolved drafts under I1 (the orchestrator's poll, field item 5) and none of another session's drafts made in the same hour; `-is:draft`, `author:`, `after:`/`before:`, `impact:`/`uncertainty:`, and quoted terms each narrow it as they narrow any query. | DT-OPT-01 | Layer 3: one test per qualifier pairing on `search_recipes`. |
| S6a-Q4 | Decision 3: `intent:I1` on `search_recipes` returns Pat's own recipes under I1 without `author:me`; `-author:me intent:I1` returns none. | | Layer 3. |
| S6a-Q5 | Not an oracle: `intent:J1` (Sam's real intent, over Sam's published recipes in a book Pat reads) and `intent:` with a random well-formed id give Pat byte-identical answers, on every surface that answers a search (MCP structured and markdown, `/check` JSON and HTML, the queue), after replacing only the id under comparison, per-call ids, and timestamps: zero results and one note that the intent id was not recognized (unknown or not yours, deliberately indistinguishable). Pat's own intent with nothing under it gives zero results without that note. | | Layer 3 byte comparison on `search_recipes` and `/check?filter=` (JSON), and on the queue route (S6a-G4). |
| S6a-Q6 | Visibility holds under the qualifier: Dana's on-behalf draft about Pat deposited under D1 is returned to Dana by `intent:D1` and to nobody by `intent:D1` on another account; after Pat verifies it, it stays under D1 (S6a-S4), so Dana still finds it with `intent:D1` and Pat does not (D1 is not his). Sam never sees Pat's unresolved I1 drafts by any query. | | Layer 3. |
| S6a-Q7 | Three-surface parity: remote MCP `search_recipes`, `/check?filter=` (JSON and HTML), and the stdio server's search forwarding return the same set for the same query and key. The `/check` search help lists `intent:`. | | Layer 3 per surface; the stdio forwarding test passes. |
| S6a-Q8 | Ranking isolation: `intent` (and `intentId`, `intent_id`) joins the guard's forbidden terms for the five ranking files; the selection is built in `search-selection.ts` and reaches the pipeline as an opaque `TraceSelection`. The guard passes; `ranking-regression.test.ts` is unchanged and green. | | `ranking-isolation.test.ts` diff; a mutation (naming `intent_id` in `vector-search.service.ts`) fails it. |
| S6a-Q9 | The ownership lookup is one read of `claimnet.intents` by primary key and user, made only when the query has `intent:`; it does not touch `last_used_at` (a search by intent is a read, not a use of the intent). No query without `intent:` gains a statement. | | Code review; Layer 3: `last_used_at` unchanged after an `intent:` search. |

**The review queue**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S6a-G1 | `GET /traces/drafts` items carry `intent: { id, story } \| null`, set only when the draft's intent is the viewer's own (decision 4); the id-list form carries it the same way. | DT-OPT-01 | Layer 3: Pat's I1 drafts carry I1 and its story; Dana's D1 draft about Pat carries `null` in Pat's queue and D1 in Dana's. |
| S6a-G2 | Triage listing: drafts sharing one of the viewer's intents are contiguous, the group sitting where its highest-placed member would sit in today's triage order, members in triage order within it; drafts with no own intent keep today's relative order. Paging applies to that order, so a group may continue onto the next page. | DT-OPT-01 | Layer 3 with a fixture of mixed ratings across I1, I2, and ungrouped drafts: the exact id order asserted (the triage grouping is SQL; amended 2026-10-24: the Layer 1 test is of `groupByOwnIntent`, the semantic path's page grouping, and of the page's `intentRuns`). |
| S6a-G3 | With semantic text the page keeps the similarity order apart from pulling a group's later members up beside its first (stable); the id-list form keeps the link's order (S3-L1) and groups only adjacent runs. | | Layer 3 for the semantic case; Layer 1 for the link case. |
| S6a-G4 | `intent:I1` works in the queue's search box and lists only Pat's I1 drafts; `intent:` with a foreign or random id lists nothing and shows the same note as search (S6a-Q5). | | Layer 3 on the route; frontend unit test of the note. |
| S6a-G5 | The page renders each group under a heading holding the intent's story (shortened past 200 characters, with the full story in the accessible name), and a link that filters the queue to that intent (`/app/drafts?q=intent:<id>`). Ungrouped drafts render as today. Every existing queue test and the e2e drafts suites pass unchanged, apart from two label assertions that already fail on the base (amended 2026-10-24; they predate the slice, below). | DT-OPT-01 | Frontend unit test of the grouping render; browser run. |

**Export and import**

| # | Criterion | Evidence |
|---|---|---|
| S6a-E1 | `GET /auth/me/export` carries `intentId` on each trace, additive and nullable (`schemaVersion` stays 1), and only when that intent is the exporter's own: an exported recipe whose intent belongs to someone else (a verified on-behalf recipe under Dana's D1, now Pat's) carries `null` in Pat's export. | Layer 3 on the export. |
| S6a-E2 | Import restores `intentId` only when the id names an intent of the importer's (`intents.user_id` = importer); a foreign, unknown, or ill-shaped id string is dropped to NULL and the row is imported otherwise unchanged (a non-string value is a row error, as for every optional string field). A row kept as skipped-identical keeps its stored link (import never changes an existing row). | Layer 3: export, delete, re-import restores I1; a file naming Sam's J1 or a random id imports with NULL; `import-validate.test.ts` covers the new optional field. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S6a-Z1 | One grammar term in the `searchQuery` parameter description (the qualifier and its exclude-own effect), and nothing else in any tool or parameter description. Bytes before and after recorded in `spec-decision-log.md`: remote `tools/list` (16,986 before), stdio `tools/list`, shared descriptions (6,051 before); all under the A0 caps, which this slice does not edit. | Size tests green; the decision-log entry. |
| S6a-Z2 | The deposit adds no statement and no round trip (the column is one more value in the existing `INSERT`); the queue adds no statement beyond one join to `claimnet.intents` in the listing it already runs. | Code review. |

**Authorization and audit**

- The layer touched is the read side of the search grammar and the queue listing; neither gains a book-scope or draft condition of its own. Every recipe the qualifier returns still passes `traceVisibleTo` / `traceIdVisibleTo` and the book scope, and `check:authz-seam` passes with only registered fingerprint changes (a traces read the slice adds to the queue listing is registered with its `why`).
- Uniform answers kept: S6a-Q5 (foreign and random intent ids); the slice 2 to 4 by-id comparisons and S3-L2 unchanged.
- Audit rows: none new. `recipe.checked` and `check.searched` already stamp `intentId` (Phase C); the deposit's row is unchanged.

**Surfaces that must change:** `packages/db/src/schema/traces.ts`, one migration, the regenerated data-model doc; `trace.service.ts` (the deposit `INSERT`; `resolveStructuredFilters` and the exclude-own rule; the not-recognized note); `intent.service.ts` (a read-only ownership lookup); `search-selection.ts` (the selection); `packages/domain/src/search-query.ts` (the qualifier); `draft-queue.service.ts` and the drafts route (the `intent` field, the grouping order, the note); `apps/frontend/src/lib/draft-queue.ts` and `DraftQueuePage.tsx` (headings); `routes/auth.ts` export and `import.service.ts` / `import-validate.ts`; `routes/check.ts` (the search help line only); `MCP_PARAM_DESCRIPTIONS.searchQuery`; `ranking-isolation.test.ts`; `drafts-and-triage.feature` (DT-OPT-01 reworded to what ships, out of `@unreleased` when it passes); `drafts-and-triage-read-paths.md`; `spec-decision-log.md`; `CLAUDE.md`'s qualifier list.

**Surfaces that must NOT change:** the five ranking files and `ranking-regression.test.ts`; the visibility fragments (`authz/draft-sql.ts`, `trace-access.ts`) and `resolveDraft`; `resolveIntent`'s registration and join semantics, `intent_shown`, and every intent echo line; the verify path (stream A's); the cap constants (A0's); every tool description and every parameter description but `searchQuery`; the briefing.

**Security properties the verifier must see proven**

- The link is written only from an intent the server resolved to the depositor, at deposit, and never changed afterwards (S6a-S2, S6a-S4); import cannot attach a recipe to anyone else's intent (S6a-E2).
- `intent:` reveals nothing about intents that are not the viewer's (S6a-Q5, S6a-G4), and widens no one's view of a recipe (S6a-Q6).
- No intent story reaches anyone but its owner (S6a-G1, decision 4); no export carries another person's intent id (S6a-E1).
- Ranking never reads the link (S6a-Q8).

**Briefing-copy declaration.** The `searchQuery` parameter description is agent-facing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The PR appends one `spec-decision-log.md` entry (mirrored in the commit body) with the bytes before and after and the scenario it moves (DT-OPT-01). The briefing's own description of the grammar is stream C's.

### Slice 6a build notes (stream B, agent `a-drafts-6a-2026-10-24`, 2026-10-24)

Intent `int_1ZrN0seqs7S77DSI2H2NXODV`. Branch `drafts/6a-intent-link`: rubric `7247f26`, backend `b7a0000`, then the queue page and docs.

**The decisions, checked.** Each of the rubric's five decisions was checked in `soupnet-oss` before it was built, and each check closed with a feedback row. Own-intents-only qualifier, uniform note, exclude-own lift: `df7ee4da`, consistent with stream D's same-day uniform marker for foreign intent ids on feedback (`831a11ea`) and the uniform-marker precedent (`72737049`). Link from the intent the check resolved, registered or joined: `328c7df1`. Queue headings and export only for the viewer's own intents: `f2ae39b8`, consistent with stream E's per-user intents rule (`389cce42`). One column written at deposit as the whole structure: `407e1cc3` (found by search, not checked again). No recipe contradicted any of them.

**Cross-stream calls, as built.** The column is `traces.intent_id` (text, nullable, partial index `traces_intent_id_idx`). Queue items from `GET /traces/drafts` carry `intent: { id, story } | null`. The group heading links to `/app/drafts?q=intent:<id>`; stream E's intent page (`/app/intents/$intentId`) is not on this branch, so E adds or swaps that link when it rebases (agreed by message). Stream D also mints migration `0041`; D merges first in the plan's order, so this branch regenerates its migration on top of D's (drizzle-kit, not a hand edit of the journal). Stream A's verify path does not touch the column (confirmed by A).

**Where the code sits.** `ownedIntentIds` (`intent.service.ts`) is the one read-only ownership lookup, used by the qualifier and by import; it never touches `last_used_at`. `resolveStructuredFilters` now returns `{ structured, intentNotRecognized }`. The not-recognized sentence is one constant (`INTENT_QUALIFIER_NOT_RECOGNIZED`) behind one zero-result builder (`searchZeroResultLine`) shared by the JSON notice and the markdown report; HTML and the queue use the same constant. The triage listing's grouping is one window over today's order (`min(pos) OVER (PARTITION BY group)`), so ungrouped drafts keep their relative order by construction. The semantic listing regroups the page in JS (`groupByOwnIntent`). The id-list form is not regrouped (S3-L1); the page shows a heading per run (`intentRuns`).

**Found along the way.** The worktree's `node_modules/@soupnet/*` junctions pointed at the worktree's old location, so vitest resolved the main checkout's packages until they were re-pointed (stream A found it first). Shell heredocs turned `\b` into backspace characters in a regex once, the same failure the ranking guard's own comment records; edits since go through UTF-8 script files or the Edit tool.

**Gate.** `TESTCI_PGPORT=5611 npm run test:ci` exit 0: 134 files passed (2 skipped), 1,908 tests passed, 6 skipped, 0 failed, with the Layer 3 suite `routes/intent-link.test.ts` (18 tests) and the static `authz/intent-link.test.ts` in it. Two earlier runs failed on things since fixed in the tests, not the code. (1) Dana's on-behalf draft was looked for in her queue; slice 4 lists it to her only through the id-list link (S4-Q5), so S6a-G1 reads it there. (2) The order check went through `/check?filter=`, where clustering and MMR pick from whatever candidates are present; it now measures the pipeline's own order through the search service, the layer S3-G7 measures. Two other runs were invalidated by a port clash: stream A's verifier was on 5554 too, and two gates on one port share a compose project, so each tears down the other's database. Ports were then agreed by message. Verifier agents run gates as well, so a port that looks free in `docker ps` can be claimed a minute later.

#### Questions for the operator

56. **Ruled 2026-10-24: option A, the trim.** The `searchQuery` description sits at its 420-character per-description limit, and the `intent:` term didn't fit without trimming existing words or raising that limit; A0 raised the four totals but not this one, and the plan gives cap edits to A0 only, so both were built. Option A (this branch) drops "and", "for PR review" (the briefing's Search vs check keeps the example), and "ISO" (the date error spells out the format), and shortens two phrases, for 417 characters. Option B (`drafts/6a-intent-link-option-b`, `a46d313`) kept every word (463) under a dated exception for `searchQuery` alone. The stream first recommended B (add, not remove: recipes `fa35f3b1`, `8dd573b4`), then A once stream C reported the operator-approved expanded-copy history (`docs/briefing-specs/expanded/`), which covers tool descriptions and keeps a trim recoverable for a later ablation; this slice's entry is `expanded/slice6a.md`. The operator: "Yes, I agree with your recommendation, A", and, shown that the planning session had verified the B draft with his earlier "B - agree": "Your recommendation here for A is approved, your reasoning is sound". The ruling is recipe `a2ed0789`. The B draft `d2663a40` stays published with a feedback row marking it superseded, which is how the log is meant to show a decision evolving (recipe `b282a3a2`). Option B's branch is kept until this PR merges.

### Slice 6a verification record

Written 2026-10-24 by the verifier (agent `a-drafts-6a-verify-2026-10-24`, Soup.net intent `int_cRGWDimgWhlMSjT9v9UBWGpE`), who did not build the slice and changed no application code. Verified at `7c65cc1` in the worktree `SoupNet-wt/b-intent-link`, with its `node_modules/@soupnet/*` junctions checked first (all nine point into this worktree). Rows were judged against the rubric and the code, not the build notes. One commit landed on the branch during verification, `2edc3d1` (docs only: a new `docs/briefing-specs/expanded/slice6a.md`); gate run 3 ran with it present, and nothing else here depends on it.

**Verdict: accept, with follow-ups.** Of the 22 rows, 18 pass, 3 are partial, and 1 is not met as written. No security property failed: every one holds under the verifier's own probes. The partial rows are security rows whose rubric-named proof is missing or evadable, graded partial rather than pass after recipe `36875b03` (a static guard that misses a plant is partial with a follow-up); the brief asked for pass, fail, or not run, and "partial" here means the behaviour passes and the named proof is owed. One real defect was found, low severity (finding 1). The gate was green on the third of three runs; the first two failed for reasons outside the slice (below).

**How it was verified.**

- **Gate**, `TESTCI_PGPORT=5654 npm run test:ci`, three runs, logs in the verifier's scratchpad. Build, typecheck, lint, `check:data-model`, and `check:authz-seam` passed in every run. Run 1: **exit 1**; 133 files passed, 2 skipped (135 of 136 reported); 1,901 tests passed, 6 skipped (1,907 of 1,914 reported); 0 failed; 1 unhandled error, "Worker exited unexpectedly" (a vitest fork died, taking one file's 7 tests with it; the reporter does not name the file). Run 2: **exit 1**; 12 files failed, 122 passed, 2 skipped; 9 tests failed, 1,868 passed, 37 skipped; every failure traces to `PostgresError: sorry, too many clients already` (10 occurrences) or to setup that it broke (`waitlist.service.test.ts` building SQL from ids that were never created); `intent-link.test.ts` was not among the failures. Run 3, with nothing else of the verifier's running: **exit 0**, "CI tests passed!"; 134 files passed, 2 skipped (136); 1,908 tests passed, 6 skipped (1,914), 0 failed, no errors; the golden-set ranking eval ran (ndcgFull 0.7883 in all three pool columns). Those totals match the build notes' run on 5611.
- **Independent probes**: a Layer 3 file of the verifier's own (6 tests, all passing; deleted afterwards) against the branch's built backend on a throwaway stack (compose project `soupnet-ci-5655v`, backend on :3219 with the test-ci environment, stub embeddings, `INTENT_RATE_LIMIT_HOURLY=3`), torn down afterwards. Cast as the rubric's, plus Bud (budget) and Quinn (paging).
- **Browser run** on the same stack with the SPA on :5276 (Vite, `VITE_API_BASE` pointed at :3219): a verifier spec (deleted afterwards; report and screenshots kept outside the repo) on the desktop and Pixel 7 projects, both passing; then the existing drafts suites.
- **Mutations** in the worktree, each reverted (`git status` clean after each): listed under S6a-Q8 and S6a-S4.
- **Byte counts** with the slice 1 method (`createMcpServer` with a stub principal over the SDK's in-memory transport, `initialize` then `tools/list`, the result as minified UTF-8 JSON; the stdio twin through `servedToolsList`), probe files deleted afterwards.
- **Code review** of `32ffa5c..7c65cc1`. The five ranking files, `ranking-regression.test.ts`, `authz/draft-sql.ts`, `trace-access.ts`, and the briefing are unchanged in the diff.

**Storage and the one writer**

| # | Verdict | Evidence |
|---|---|---|
| S6a-S1 | pass | `0041_traces_intent_link.sql` (renumbered `0042` on the rebase, below) is one `ADD COLUMN "intent_id" text` (nullable, no default, no FK) and one partial index `traces_intent_id_idx … WHERE intent_id IS NOT NULL`; no `UPDATE`. The schema comment in `traces.ts` names the writer, import's restore, the read rule, and the ranking ban. `check:data-model` passed in all three gate runs. |
| S6a-S2 | partial | The `INSERT` takes `${intent.intentId}` from `resolveIntent`, which returns `intentId: null` for an unknown or foreign id (`notFound`), an oversize story, and an exhausted budget. `intent-link.test.ts` "S6a-S2" covers registered-from-text, by-id, unknown, and foreign; it has no case for an over-budget registration or an oversize story, which the row names. The verifier's probe covered both: a 10,016-character story stored NULL; Bud's fourth registration (cap 3) got "Intent registration budget reached…" and stored NULL. A web `GET /check` deposit with Pat's own id stored that id. |
| S6a-S3 | pass | `ON CONFLICT … DO NOTHING`; "S6a-S3" deposits under I1, repeats under I2, reads I1 and the same id. |
| S6a-S4 | partial | Behaviour: the only `UPDATE claimnet.traces` statements (`authz/draft-resolution.ts`, `trace-move.service.ts`, `eval/ranking-eval.ts`) do not name the column, there is no Drizzle update of traces, and the only inserts are the deposit and import; Layer 3 shows a confirmed draft, a moved recipe, and Dana's on-behalf draft after Pat confirms it keep their link. The static guard `authz/intent-link.test.ts` fails on a planted `UPDATE claimnet.traces SET intent_id = NULL` (M1) and a planted `db.update(traces).set({ intentId: null })` (M4), but passes on four other plants: `UPDATE "claimnet"."traces" SET "intent_id" = NULL` (M2), an `UPDATE claimnet.traces SET ${setIntent(v)}` whose fragment names the column (M3), a second Drizzle `insert(tracesTable).values({ …, intentId: foreignIntent })` (M5), and `INSERT INTO "claimnet"."traces" (…, "intent_id")` (M6). See finding 3. |

**The qualifier**

| # | Verdict | Evidence |
|---|---|---|
| S6a-Q1 | not met as written | The row makes "a second `intent:`" a loud parse error; the parser accepts a second `intent:` naming the same id, and `search-query.test.ts` "repeating the same id is harmless" pins that. Two different ids, a group, `-intent:`, and malformed values (short, upper-case prefix, 25 characters, a hyphen, story text, hostile strings) are errors naming the form; the unknown-qualifier help lists `intent:`. Every branch of the new parser block is reached by a test (by inspection; no coverage provider is installed). See finding 2. |
| S6a-Q2 | pass | `intentSelection` is `t.intent_id = $id` or `FALSE`, ANDed as a `TraceSelection`. "S6a-Q2 / S6a-Q4" and the order test, which compares `searchWithoutLogging` pages with and without the qualifier and finds the narrowed list equal to the full list filtered to the kept ids, with the same similarities. |
| S6a-Q3 | pass | Layer 3 pairs on `/check?filter=` JSON. The verifier's probe repeated them on `search_recipes`: `intent:I1` 2, with `author:me` 2, with `"quoted-term-alpha"` the one quoted recipe, with `after:2000-01-01` 2, `is:draft` the draft only, `-is:draft` the published one only, `impact:high` the draft only. |
| S6a-Q4 | pass | `excludesOwnByDefault` adds `parsed.intent === undefined`; Layer 3 `intent:I1` on MCP returns Pat's own, `-author:me intent:I1` returns 0. |
| S6a-Q5 | pass | Layer 3 compares foreign and random on MCP structured and markdown, `/check` JSON, and the queue. The verifier's probe went further, replacing only the id under comparison with one token (the suite's normalizer replaces every `int_` id, which would hide a leaked third id): byte-identical for MCP structured, MCP markdown, `/check` JSON, `/check` HTML, and the stdio server's `search_recipes`, each for `intent:`, `is:draft intent:`, `author:anyone intent:`, `-is:draft intent:`, a quoted term with `intent:`, and semantic text with `intent:`; and identical queue answers for Pat (Sam's J1 vs random) and for Sam (Pat's I1 vs random). Pat's own empty intent gives no note (Layer 3). |
| S6a-Q6 | pass | Layer 3 "S6a-Q6". The probe also ran four other queries as Sam (`"<marker>"`, `author:<pat>`, `is:draft author:anyone`, a quoted term); none returned Pat's I1 draft. |
| S6a-Q7 | pass | Remote MCP vs `/check` JSON (Layer 3); `/check` HTML lists the same two I1 recipes, and the stdio server returns the same id set (probe); the HTML help names `intent:int_…`. |
| S6a-Q8 | pass | `INTENT_TERMS` joins the guard. Planting ``const MUTATION_PROBE = sql`t.intent_id`;`` in `vector-search.service.ts` failed "vector-search.service.ts does not reference the intent link (slice 6a)" (1 failed, 15 passed); reverted. |
| S6a-Q9 | pass | `ownedIntentIds` is one `SELECT id FROM claimnet.intents WHERE user_id = … AND id IN (…)`, called only when `parsed.intent !== undefined` (short-circuit), with no `UPDATE`. `last_used_at` unchanged after an `intent:` search (Layer 3) and after a queue `intent:` search and an MCP search (probe). |

**The review queue**

| # | Verdict | Evidence |
|---|---|---|
| S6a-G1 | pass | Both the listing and `loadItems` join `intents` on `oi.user_id = viewer`; Layer 3 "S6a-G1" for Pat's I1 drafts, Dana's draft ungrouped (and D1 absent from Pat's JSON), and the id-list form for both. |
| S6a-G2 | pass | The window `min(pos) OVER (PARTITION BY grp), pos` over today's triage order; Layer 3 asserts the exact order. Paging probe: Quinn with one high/high draft and 20 low/low drafts under Q1 plus 2 ungrouped medium drafts; page 1 is the top draft then 19 group members, page 2 opens with the 20th member then the two ungrouped (23 total, 2 pages). No Layer 1 test of a grouping function exists (finding 4). |
| S6a-G3 | pass | Layer 3 "S6a-G3" asserts contiguity on a semantic page; `intentRuns` has Layer 1 tests for the link case. `groupByOwnIntent` (the semantic regrouping) has no test of its own (finding 4). |
| S6a-G4 | pass | Layer 3 "S6a-G4" and the probe (Pat and Sam, foreign vs random). The browser run showed the same note for Sam's id and a random id. No frontend unit test of the note exists (finding 4). |
| S6a-G5 | pass | Browser run, desktop and Pixel 7: two groups under headings holding the stories, I1's two drafts together at the top; the long story's visible heading is at most 200 characters ending in "…" and the heading is found by its full story; the ungrouped and Dana's draft sit outside every group; Dana's story and D1 are absent from Pat's page; "Show only this intent's drafts" goes to `?q=intent:<I1>`, lists two, hides the link, and survives a reload; axe found 0 violations; no horizontal scroll. The existing drafts e2e suites on the same stack: 40 passed, 1 skipped, 2 failed, both asserting the old "Agent's ratings" label (post-merge N1, slice 3 E3), which `eaca1e3`, an ancestor of the base, renamed; the slice does not touch that label. The frontend tests are of the pure helpers, not a render (finding 4). |

**Export and import**

| # | Verdict | Evidence |
|---|---|---|
| S6a-E1 | pass | The export's subquery returns `t.intent_id` only when `intents.user_id` is the exporter; Layer 3 "S6a-E1"; the probe also found D1 on Dana's export row for her unverified draft about Pat. |
| S6a-E2 | partial | `ownedIntentIds(tx, userId, …)` decides each row's link. Layer 3 restores I2, drops Sam's J1, a random id, and a garbled string, and Sam importing Pat's file links nothing. The probe imported Pat's I1 row unchanged but naming I2: `skippedIdentical: 1`, still I1; and `intentId: 5` is a 400 "traces[0]: intentId must be a string or null". Neither of those is in a committed test, and `import-validate.test.ts`, which the row names, does not mention `intentId` (finding 4). |

**Budgets**

| # | Verdict | Evidence |
|---|---|---|
| S6a-Z1 | pass | Measured: remote `tools/list` 16,990 bytes, stdio 13,200, shared descriptions 6,053 characters, `searchQuery` 417 (longest single description 417), each matching the 2026-10-24 slice 6a entry in `spec-decision-log.md` and under the A0 caps (18,200, 14,700, 6,600, 420). No other description changed in the diff. The words trimmed inside `searchQuery` are open question 56, the operator's call; option B was not measured here. |
| S6a-Z2 | pass | Code review: the deposit adds one value to the existing `INSERT`; the queue adds a `LEFT JOIN claimnet.intents` to the listing and to `loadItems`, no new statement; the qualifier's lookup runs only with `intent:` (S6a-Q9). |

**Security properties.** Written only at deposit from the intent the server resolved, never changed: holds (S6a-S2, S6a-S4, with the guard gap in finding 3). Import can't attach a recipe to someone else's intent: holds. `intent:` reveals nothing about others' intents and widens no view: holds on every surface probed (S6a-Q5, S6a-Q6, S6a-G4). No story or foreign id reaches anyone else: holds in the queue JSON, the page, and the export. Ranking never reads the link: holds (S6a-Q8). `check:authz-seam` passed with three re-registered fingerprints (`draft-queue.service.ts`, `import.service.ts`, `trace.service.ts`), each with a slice 6a clause in its `why`. No new audit rows.

**Findings**, real defects first:

1. **Low, defect: the HTML `/check` page never shows the not-recognized note.** `renderPage` builds the results section only when `enriched` is set, and `enriched` is set only when there are results (`check.ts`, the HTML path), so the new `intentNotRecognized` empty line is unreachable, as was the existing "No matches among the N recipes in scope" line before it. A foreign or random `intent:` id on the HTML page shows no results section and no note. The answer stays uniform (byte-identical), so nothing leaks, but the spec-decision-log entry and the `b7a0000` commit body say the note is shared by the HTML page, and it is not. Fix the zero-result branch or drop the claim.
2. **Low, rubric not met as written: a repeated `intent:` with the same id parses.** Harmless (one id either way) and consistent with how `is:draft is:draft` behaves, but S6a-Q1 names a second `intent:` as an error. Either make it an error or amend the row.
3. **Low to medium, test strength: the S6a-S4 static guard is evadable** by quoted identifiers, a column named inside an interpolated fragment, and any Drizzle insert of traces that sets `intentId` from something other than `t.intentId` (plants M2, M3, M5, M6). No such statement exists today. Suggest matching `"?claimnet"?\."?traces"?` and `"?intent_id"?`, and listing every `.insert(traces…)` call in `apps/backend/src` and asserting which set `intentId`.
4. **Evidence owed (no behaviour defect):** Layer 3 cases for an over-budget registration and an oversize story (S6a-S2); a committed skipped-identical import case and the `intentId` field in `import-validate.test.ts` (S6a-E2); a Layer 1 test of `groupByOwnIntent`, an exported pure function with no test, against the project's 100%-branch rule for new pure functions (S6a-G2, S6a-G3); a frontend test of the note and of the grouped render (S6a-G4, S6a-G5).
5. **Gate reliability, not the slice:** run 1 lost a vitest worker and run 2 ran the CI postgres out of connections (100 by default; 21 test files open their own pool, the new suite one more, on a 32-core host); run 3 passed. Neither failure is in slice 6a code. The two stale "Agent's ratings" assertions in the drafts e2e suites predate the base.

Gaps in the rubric itself:

- S6a-Q5 names `/check` JSON only. The HTML page had no row, which is how finding 1 shipped, and the suite's normalizer replaces every `int_` id with one token, so a response that leaked some third intent id would still compare equal. Name every surface, and replace only the id under comparison.
- S6a-S4 does not say which statement forms the guard must catch (quoted identifiers, fragments, Drizzle insert shapes), so a guard catching only the plain spellings meets its letter.
- S6a-G2 asks for "a Layer 1 test of the grouping function", but the triage grouping is SQL; only the semantic path's `groupByOwnIntent` can have one. Name it.
- S6a-G5's "the e2e drafts suites pass unchanged" cannot be met on this base, whose suites already fail two label assertions.

**Calls the verifier made, and what was left for the implementer.** Proceeded on: grading security rows with missing named proof as partial (recipe `36875b03`; the verifier's own draft `21d39214`, which leaned toward pass with a named gap, was corrected by that precedent); treating the HTML note as a defect rather than a rubric gap, because the slice's own log and commit claim it; treating the two e2e label failures as pre-existing. Left for the implementer: findings 1 to 4. Left for the operator: open question 56 (this record measured option A only).

### Slice 6a fix pass (stream B, 2026-10-24)

Each finding from the verification record above, and what was done.

1. **The HTML page's empty-state line was unreachable.** Fixed rather than the claim dropped: the HTML path now gives an empty read-only search an empty result list, so its results section renders with the not-recognized note (or, for any other empty search, the scope count the page always meant to show); synthesis still runs only with results. The older "No matches among N" line had the same defect and is fixed by the same change. Layer 3 "S6a-Q5" now asserts the note on the HTML page and compares foreign and random byte for byte there.
2. **A repeated same-id `intent:` parses.** Kept, and the row amended (S6a-Q1 above), consistent with `is:draft is:draft`.
3. **The static guard missed four statement shapes.** `authz/intent-link.test.ts` now pins every mention of an `intent_id` column, bare or quoted, per file, with a reason per file (the seam check's method), and checks every Drizzle insert into traces for which value sets `intentId`. All four plants (M2, M3, M5, M6) now fail it, re-run by planting each in `trace-move.service.ts` and restoring. Another stream that adds a mention (stream E reading `traces.intent_id`) updates the register with its reason.
4. **Evidence owed.** Added: Layer 3 cases for an oversize story and an over-budget registration (the deposit run in-process with a one-per-hour budget) storing NULL (S6a-S2); a skipped-identical re-import keeping the stored link, and a non-string `intentId` refused as a row error (S6a-E2); `intentId` cases in `import-validate.test.ts`; a Layer 1 test of `groupByOwnIntent` (`services/draft-queue-grouping.test.ts`); and the suite's normalizer now replaces only the id under comparison. Not added: a render test of the queue page's grouping and note, because the frontend has no component-test harness (`draft-queue-page.test.ts` reads the page source); the helpers behind both are tested, and the browser run covered the render.
5. **Not this slice.** The two stale "Agent's ratings" e2e assertions were handed to stream A, which the plan gives the drafts e2e suites. The gate's connection exhaustion and lost worker were not reproduced in this stream's runs.

Gate after the fix pass: `TESTCI_PGPORT=5611 npm run test:ci` exit 0, 135 files passed (2 skipped), 1,916 tests passed, 6 skipped, 0 failed.

The verifier's draft `21d39214` (on grading rows whose named proof is missing) has been ruled and verified by the operator ("Yes to all three, confirm the drafts", 2026-10-24). A row whose behaviour the probes proved, but whose named test is missing or too weak, reads as a pass on behaviour, with the gap stated in the row and listed as a finding to close before merge. It supersedes the "partial" wording of `36875b03` that the record above used. Nothing here changes, because the fix pass closed every gap the record named.

**Added 2026-10-25: prose parentheticals in the grammar.** A field agent's bare-text query "…body (merge order, open questions, verification)" was refused as a malformed group (feedback `c5af93de`, stream D). It is the backlog's Phase C friction note, now seen twice. Settled without the operator by recipes `8481d9bc` (stream D) and `f0c39b29` (this stream), on the precedent of the Gmail-shaped grammar ruling `da986c40`. A top-level group with nothing grammar-shaped inside (no quote, no uppercase `OR`, no nested parenthesis, no qualifier-shaped word) is now kept as written in the semantic text. Every other malformed group keeps its loud error, including `(author:me)` and a misspelled qualifier inside parentheses, so a typo still never turns into silent semantic text. `parseSearchQuery` gains `proseParentheticalEnd`, with Layer 1 cases in `search-query.test.ts`. No agent-facing copy changes, since the descriptions never said a prose parenthesis was an error.

**Rebased onto main at `f6b85f4` (slices 6c and 8a merged), 2026-10-25.** These are the F106 steps from the slice 8a notes. B's migration was dropped and regenerated with drizzle-kit as `0042_traces_intent_link`, with the same SQL and with `0042_snapshot.json`'s `prevId` set to D's `0041` snapshot id. The data-model doc was regenerated. The seam check held with no fingerprint changes: 8a's seam file merged cleanly beside this branch's three entries. The intent-link guard's register gained 8a's `check_feedback` mentions (`routes/feedback.ts` 4, `routes/mcp.ts` 2, `services/feedback.service.ts` 7), none of them a write to `traces`. `searchQuery` keeps question 56's four trims, adds the `intent:` term, and ends with 8a's "-author:me leaves out your own.". This slice's "lift exclude-own" clause is gone, along with the design doc's sentence that `intent:` replaces the exclude-own default, because 8a removed that default from every surface. Sizes on main and after are in the decision log.

**Dependents.** Slice 10 (stream A, "drafts as a bus", `drafts/10-bus`) reads `traces.intent_id` for draft liveness: a draft is live while its intent's `last_used_at` is recent, and falls back to a window from deposit when the link is NULL or the intent row is gone. It relies on the contract above as it stands: one writer at deposit, the depositor's own intent (on-behalf deposits included), restored on import only for the importer's own intents, never updated, and no story shown to anyone but the intent's owner. Changing any of these means telling stream A.

### Slice 7 rubric: briefing copy (stream C)

Written 2026-10-24 by agent `a-drafts-7-2026-10-24` (stream C), before implementation, from the revision doc's 7a to 7e and rulings 48 and 52, the implementation plan's stream C, and the code at `32ffa5c`. Consumer: agent (every briefing surface, and the check response's empty-result line). Security-relevant: no. The slice changes copy only; it touches no authorization layer, no read scope, no audit row, and no uniform-404 pair, so the security workflow's audit role does not apply and the rows below say so where a rubric would otherwise carry them. Two PRs: **C1** (this rubric's rows marked C1) is the briefing body, its scenarios, and one slimming lever; **C2** (rows marked C2, written in full before C2 starts) is the tool and web copy in 7b, after 6c and 6a merge.

Settled before this rubric, not reopened: a draft is a hypothesis the agent cannot yet stand behind from the context it holds (recipe `5d76a576`); the person's own agents ratify drafts under the same confidence rule as an ordinary check (`200ed4fe`); ask when the call is the person's and they are reachable, with a recommendation (ruling 52); orchestration is live (`97f7c34e`); both shapes of building both (`7942b8c0`, `ea930c3d`); one dated raise already made in A0, two PRs under it, one slimming lever in the first (ruling 48); the result-header wording and the context line belong to slice 8 (ruling 49); add rather than remove, guardrails framed as truthfulness tests, not prohibitions (`fa35f3b1`); examine every surface the briefing touches before changing text (`a2c8fb64`); the operator's form for check moments is an example and a goal, never a step owed (`72f788bf`).

**Cross-stream dependency, declared here because it shapes C1's text:** the Drafts section tells agents they can resolve a draft with `verify_draft` as verified, rejected, or not chosen (stream A's `outcome`, contract confirmed by stream A on 2026-10-24), and that an orchestrator polls `is:draft intent:<id>` (stream B's qualifier). C1 is written against both, and since `f8ced57` against stream D's intent-only outcome row too, so it merges after A1, D and B, which is the plan's suggested order (A1, D, B, E, C1); at merge, confirm all three are on `main`. If C1 ever had to merge first, the two clauses would be cut rather than shipped describing behaviour that does not exist yet.

**Baselines**, measured by this agent at `32ffa5c` with the slice 5 method (`BRIEFING.build` over the fixture in `recipe-guide-content.test.ts`; a five-exemplar section built by `buildExemplarsSection` with one to three evidence entries each, for the lever):

| Measure | Value | Cap (A0) |
|---|---|---|
| Thin (MCP) briefing, fixture | 18,183 characters (18,297 bytes) | 21,000 |
| Thin headless briefing, fixture | 18,536 characters | 21,500 |
| Full (web and paste) briefing, fixture | 24,119 characters | none |
| Five-exemplar section (realistic) | 4,990 characters | none |
| Full briefing with that section | 29,059 characters | none |
| Remote `tools/list` / stdio / shared descriptions | 16,986 bytes / 13,196 / 6,051 characters | 18,200 / 14,700 / 6,600 |

One fact the budget turns on: the thin briefing renders no exemplars at its default (`k=0` on the MCP surface, `briefing.ts`), so the `aae000d2` levers shrink the full and paste briefing and every briefing with exemplars opted in, but not the thin fixture. C1's thin growth has to fit the 21,000 ceiling by the copy's own economy. Question 56 below.

**C1: the Drafts section (7a)**

| # | Criterion | Scenario moved | Evidence |
|---|---|---|---|
| S7-A1 | The shared body (thin and full profiles alike) carries one Drafts section that defines a draft as a hypothesis the agent can't yet stand behind from the context it holds, private to the person and their agents until resolved. | `checking-behavior.feature` "An agent drafts only when it cannot ask…", rewritten | Domain test: the section's heading and definition sentence appear in both profiles. |
| S7-A2 | The section gives the order of moves at such a call, as what is useful: acting on it, check it as an ordinary recipe and own it; a person's call and they are reachable, ask plainly with a recommendation, and, when the agent keeps working meanwhile, deposit that recommendation as a draft under its intent so the answer reaches it wherever it is given; neither, draft it, say in the first evidence entry what would settle it, rate it, and come back when that lands. (Amended 2026-10-24 for the operator's 7a addition, revision commit `a7f4d20`; "a person", not "the person".) | same | Domain test on the three moves' key phrases; reviewer reads the section against 7a. |
| S7-A3 | A draft is the agent's to resolve: whichever of a person's agents holds the settling context, the depositing agent included once the work or a reply settles it, resolves it with `verify_draft` (verified, rejected, or not chosen) under the same confidence rule as a check, quoting the person's words wherever they gave them; a draft waits for a person's click only while nothing any agent holds settles it. (Amended 2026-10-24 for the 7a addition, which supersedes the earlier "ask the person when that is useful" clause the verifier found missing.) | same | Domain test. |
| S7-A4 | Orchestration is live: sub-agents decide as they go and raise only high impact × uncertainty calls; the orchestrator polls its run's drafts by intent, corrects mid-run, and resolves what it can before finishing. (Amended 2026-10-24 after the delta verification: "listing the rest with a recommendation" was cut for budget; under the 7a addition a draft left open already carries its recommendation and what would settle it, and the full clause is kept in `expanded/slice-7.md`, chunk `slice7.drafts`.) | new `advanced-workflows.feature` scenario | Domain test; the scenario. |
| S7-A5 | No briefing text on any profile or key (thin, full, headless) says or implies that drafting is for when the person "can't be asked" or "couldn't be asked". | | Domain test over the four compositions (thin, full, each headless) for those strings. |

**C1: the planned slice 7 content (7c)**

| # | Criterion | Scenario moved | Evidence |
|---|---|---|---|
| S7-C1 | Truthfulness says claims and quoted references are true at submission "and checkable by someone who wasn't there". | `evidence-integrity.feature`, new scenario | Domain test on the phrase. |
| S7-C2 | "How to check" names `impact` and `uncertainty` as triage ratings, gives the vocabulary, and says to leave out a rating the agent has no view on rather than defaulting. | `checking-behavior.feature` "A rated check uses the rating vocabulary…" loses `@unreleased` | Domain test. |
| S7-C3 | The headless section says what would settle each draft, the ratings, and drafting the options under one intent when they stay open, and points at the Drafts section; it no longer says "why your user couldn't be asked". At most 400 characters; a headless briefing is still the ordinary one with exactly that one section inserted (S5-B1's test unchanged). Moved into C1 from C2's list because it does not depend on 6c or 6a, and leaving it would contradict the new Drafts section for the interval between the PRs. | `briefing-surfaces.feature` headless scenario, rewritten and out of `@unreleased`; `drafts-and-triage.feature` DT-HDL-05 already says this | Domain tests (S5-B1 and the 400 cap). |
| S7-C4 | Divergent recipe checks carve out building both: when every option will genuinely be pursued, check each as an ordinary recipe; when none can be stood behind yet, draft each under one intent with the rubric stated before measuring; either way, check the chosen path with the outcome as evidence and leave feedback on the others. "Wait for the choice, then check only the chosen one" stays for the ordinary case. | `divergent-checks.feature`, new scenario; "MCP agent waits for the choice" watched | Domain test. |

**C1: the field additions (7d)**, each with its own scenario

| # | Criterion | Scenario moved | Evidence |
|---|---|---|---|
| S7-D1 | A shared "Reading results" section: a returned recipe is a call someone made in their context, not a rule; weigh it against the situation and say how it applies; recurrence is not restatement, so a familiar judgment in a new context is worth logging with that context as evidence. Claims written as choices, one judgment per recipe, no "never" or "must" (placed with D3 if that reads better). | `checking-behavior.feature`, new scenario | Domain test in both profiles. |
| S7-D2 | "When to check" gains two moments in example-and-goal form: extending something that already has a default, and writing for a particular reader in a particular place. | `checking-behavior.feature`, two new scenarios | Domain test. |
| S7-D3 | Authoring for retrieval gains the two-axes paragraph: count and specificity are separate; the claim at the most general level still true, the specifics in the evidence, where they stay checkable. (Amended 2026-10-24: "still read" was cut for budget; kept in `expanded/slice-7.md`, chunk `slice7.two-axes`.) | `recipe-voice.feature`, new scenario | Domain test. |
| S7-D4 | Role patterns gain a fourth: the recipient role for what the person receives, kind of thing received named, goal clause separate, "prefer" or "chose" not "want", with the stays-true-when-they-author-it test. | `recipe-voice.feature`, new scenario | Domain test. |
| S7-D5 | "When to check" gains tension between an instruction and the agent's judgment: check the call you think is right, then proceed; the id is where redirection attaches. | `checking-behavior.feature`, new scenario | Domain test. |
| S7-D6 | Reading results: a neighbor that is the agent's own open draft is its own assumption coming back; weigh it as that. (Amended 2026-10-24: "or deposited today under its intent" was cut for budget; the verifier found it missing.) | `checking-behavior.feature`, new scenario | Domain test. |
| S7-D7 | Search vs check: a probe of the corpus is a search, because a probe made as a check takes exemplar slots. | `checking-behavior.feature` "Probing the system…" watched; new scenario | Domain test. |
| S7-D8 | Thin results mean think harder and check more, not stretch a near miss: one line beside the check response's empty-result message ("No similar recipes found."), where the revision placed it. (Amended during the build: a second clause in Reading results was cut for budget; the response line names the distant-match case itself.) | `checking-behavior.feature`, new scenario | Layer 1 renderer test. |
| S7-V1 | Voice: every sentence C1 adds reads as what is useful, not as a rule. None of the added text uses "must", "never" (outside the quoted "never" of D1), "always", "do not", or "don't", and "taste" and "judgment" appear only as a pair where both are meant. | | Domain test over the added sections; reviewer read. |

**C1: the slimming lever (`aae000d2`)**

| # | Criterion | Evidence |
|---|---|---|
| S7-L1 | Each briefing exemplar renders its first evidence entry only, followed by one line naming how many more it has and how to fetch them (`get_recipes`, or `GET /recipes?ids=` without MCP), when it has more. Claim, metadata, ordering, and selection unchanged; an exemplar with one entry or none renders as before. | Layer 1 tests of `buildExemplarsSection` for zero, one, and three entries. |
| S7-L2 | The five-exemplar section and the full briefing with it shrink, with the before and after recorded; the thin fixture is unaffected by the lever (no exemplars). | Measured in the decision-log entry. |
| S7-L3 | No ranking, selection, or read-scope code changes: `briefing-exemplars.ts` selection, `fetchBriefingExemplars`' queries, and the five ranking files are untouched; the cut is in the pure formatter. DT-VIS's "own drafts are not briefing exemplars" holds unchanged. | Diff review; existing suites. |

**C1: budgets, parity, specs**

| # | Criterion | Evidence |
|---|---|---|
| S7-Z1 | Thin fixture at most 21,000 characters and thin headless at most 21,500, with no cap constant edited (A0 owns them); the net growth is recorded. | `recipe-guide-content.test.ts` green, its ceilings untouched in the diff. |
| S7-Z1b | Added during the build (recipe `63abcc48`): the thin profile drops two paragraphs that repeat the MCP tool schema (the compaction note, which the `session_id` parameter carries, and the evidence-entry shape, which `supporting_evidence` and Recipe format carry); the full profile keeps both. | Domain test: thin omits, full keeps. |
| S7-Z2 | `tools/list` remote and stdio, and the shared descriptions, are byte-identical: C1 changes no tool or parameter description and no deposit notice. | Size tests unchanged and green. |
| S7-P1 | Every briefing surface (`get_briefing` remote and stdio, `GET /briefing`, `POST /keys/briefing`) composes from `BRIEFING.build`, so the new text reaches all of them with no per-surface code. | `briefing-surfaces.test.ts` passes; diff shows no route change. |
| S7-S1 | Each edit lands with the scenario it moves, in the same PR; `@unreleased` comes off the scenarios that slice 7 was the blocker for (rating, drafting, queue link, on-behalf, headless) where the briefing now teaches them, and the README's file table reflects it. | `.feature` diffs. |
| S7-S2 | `spec-decision-log.md` gets one C1 entry: each edit, the scenario it moves, the watched scenarios with reasons, bytes before and after for every measure above; mirrored in the commit body. | The entry. |

**Surfaces that must change (C1):** `packages/domain/src/recipe-guide-content.ts` (`PRINCIPLES`, `WORKFLOW_WHEN`, `ROLE_PATTERNS`, `HEADLESS_KEY_SECTION`, the `BRIEFING` body, `buildExemplarsSection`), `packages/domain/src/check-response-renderer.ts` (the empty-result line), their tests, the briefing-spec `.feature` files named above, `docs/briefing-specs/README.md`, `spec-decision-log.md`.

**Surfaces that must NOT change (C1):** `MCP_TOOL_DESCRIPTIONS`, `MCP_PARAM_DESCRIPTIONS` (the `draft` parameter and `verify_draft` copy are C2 and stream A), the deposit notices in `drafts.ts`, the web pages, every cap constant, `apps/backend` routes and services, the five ranking files.

**C2: tool and web copy (7b), after A1 and B merge.** Each row replaces one sentence that contradicts a ruling; the replacement is 7b's wording unless a measured budget forces a shorter one, which the decision log then records. `verify_draft`'s description is stream A's (A1), and the divergent-checks sentence and `HEADLESS_KEY_SECTION` already moved in C1.

| # | Criterion | Scenario moved | Evidence |
|---|---|---|---|
| S7-B1 | `MCP_PARAM_DESCRIPTIONS.draft` no longer says "the person can't be asked about now"; it reads as 7b's "a high-impact, uncertain call you cannot settle yet from the context you hold", and asks for what would settle it in the first evidence entry rather than why. (Amended 2026-10-25: after 7f and S7-B11 it asks for both, "why it's a draft and what would settle it", so the parameter matches the Drafts section; the reason asked for is the agent's confidence to act, not the person's absence.) Served on both MCP servers. | `checking-behavior.feature` drafting scenario (C1's rewrite) watched | `mcp-tool-descriptions` drift test; served bytes in the log, within the A0 caps (shared descriptions 6,600, remote 18,200, stdio 14,700). |
| S7-B2 | The self-draft deposit notice (`verifyHow` in `packages/domain/src/drafts.ts`) no longer says "ask the person and call verify_draft"; it reads as 7b's "Resolve it with verify_draft when you or another agent acting for the person can settle it, or hand them the queue link", with the link. The on-behalf and headless notices are unchanged (they never mention `verify_draft`). The S3 and S5 length bounds still hold. | `checking-behavior.feature` "hands its person the queue link" watched | Layer 1 notice tests; S3-L6 and S5-Z4 length assertions. |
| S7-B3 | The queue intro (`queueIntro` in `apps/frontend/src/lib/draft-queue.ts`, both variants) and the dashboard drafts card (`DashboardPage.tsx`) no longer say the agents parked drafts "because they could not ask you"; they say what a draft is (a hypothesis an agent could not yet stand behind) and keep every other sentence. | `drafts-and-triage.feature` DT-QUE-05 reworded from "why the agent couldn't ask" to "what would settle it" | Frontend unit tests on both strings; the browser-verify skill on `/app/drafts` and the dashboard (axe, 412 px). |
| S7-B4 | No surface on any profile, key, page, notice, or tool says or implies drafting is for when the person can't be asked: S7-A5's test widened to the tool roster, the notices, and the two web strings. | | Domain and frontend tests over every string. |
| S7-B5 | One C2 entry in `spec-decision-log.md` with the bytes before and after for `tools/list` (remote, stdio), the shared descriptions, and the notices. | | The entry. |

**C2: the briefing body (7f, and the rows carried from C1), before A1 and B merge.** Written 2026-10-25 by stream C (agent `c-briefing-75-c2-2026-10-25`, intent `int_gxl5ZMTtpO9RG0cvgsKXw5lJ`) before implementation, from the revision doc's §7f (ruled 2026-10-25, on `main` at `e77f657`) and question 57's ruling. C2 lands in two commits on `drafts/7-briefing-c2`, stacked on C1: this table now, since it touches only `BRIEFING.build` and depends on nothing C1 does not already depend on; the 7b table above after A1 and B merge. Placement follows each paragraph's subject, and the new copy is tightened rather than any existing text cut (recipes `c9867351`, `80b2fbb5`). "A person", not "the person", wherever the subject could be a colleague.

| # | Criterion | Scenario moved | Evidence |
|---|---|---|---|
| S7-B8 | The briefing opens with what Soup.net is (7f, "The opening, reframed"): the log of calls people and their agents made, with the reasons and the evidence; read as context for the next call (when nothing new is on the table a past call usually stands; when something is, the agent decides and logs the new call beside the old one with its own reason); also how sessions reach each other (a draft asks a question another agent or a person can answer, an intent groups a task's checks, feedback says what happened afterwards); not a source of truth and not a rulebook. The existing opening paragraph (persistence, read-only with an append-only side effect, no destructive operations, check freely, no dry run, search for lookups) follows unchanged. Both profiles. | `briefing-surfaces.feature`, new scenario | Domain test: the new paragraph precedes the existing one in thin and full. |
| S7-B9 | Recipe format carries the evidence-standards paragraph (7f): evidence says what the claim rests on, so a reader who was not there can check it, and names the kinds (a person's words, quoted, with where; a recipe that quotes them, cited by id; a document they approved; their code or artifacts; the agent's inference, named as inference); a check is a hypothesis the agent stands behind, and an inference it would act on is a check; a draft is one it would not act on without the answer; the seam is confidence to act, not the kind of evidence and not whether a person has spoken; a claim with none of their words is not thereby a draft, and a draft with no evidence is a question that did not do its work. Guidance, not a rule (S7-V1's voice test covers it). | `evidence-integrity.feature`, new scenario; `checking-behavior.feature` drafting scenario watched | Domain test in both profiles. |
| S7-B6 | Carried from C1 for headroom (operator's 7a and 7d addition, revision commit `a7f4d20`): the over-caution example-and-goal line in the Drafts section, as kept in `expanded/slice-7.md` chunk `slice7.over-caution-example`: an orchestrator once refused to verify drafts its own context settled because the tool copy spoke of a person confirming; the goal is that a person's agent resolves what it can stand behind, and a person sees only what no agent could. Under question 57's raise (ruled 2026-10-24). | new `checking-behavior.feature` scenario | Domain test; bytes in the log. |
| S7-B7 | From stream D's audit, now in scope under question 57's ruling: one clause in How to check setting the expectation that a tool refuses a parameter name it does not take and the refusal names the ones it does (8a, PR #139), so an unattended reader does not take its first refusal for an outage. Depends on #139 merging first, as C1 already does for D's intent-only row. | new `checking-behavior.feature` scenario | Domain test; bytes in the log. |
| S7-B10 | The C1 delta verifier's note 5: the Drafts section's "you included" is untrue for a draft deposited on a colleague's behalf. The shared-book sentence kept in `expanded/slice-7.md` chunk `slice7.drafts` returns in the served text: in a shared book the call may be a colleague's, and a draft on their behalf is resolved by their agents. | `checking-behavior.feature` "records a colleague's judgment as a draft on their behalf" watched | Domain test. |
| S7-B11 | Added 2026-10-25 (the operator's 7f addition, in his local revision commit `3960743`, relayed by the coordinating session): the Drafts section's first-evidence-entry clause asks why it is a draft rather than a check, as well as what would settle it. The record wants to know how much access to the person's attention the depositing agent had; that reasoning plus the key's capability level carry it, so no display marker. Pairs with S7-B9's "named as inference". The headless section keeps "what would settle it" (398 of its 400 characters) and points at Drafts. | `checking-behavior.feature` "An agent drafts only a call it cannot stand behind…", its first-entry Then extended | Domain test (S7-A2's phrase updated). |
| S7-Z3 | The thin and thin-headless caps move on this branch, dated and reasoned in the style of their earlier raises (plan wording after `d980f8a`), to the measured C2 body figure plus the usual slack; the headless section's 400 and every `tools/list` and shared-description cap are unchanged by this commit. Question 57's ruled figures (21,400 and 21,900) were sized to S7-B6 and S7-B7 alone; 7f came after and is sized into the same raise. | | `recipe-guide-content.test.ts`; the raise named in the PR body. |
| S7-Z4 | Parity and specs as C1: every briefing surface composes from `BRIEFING.build` with no route change (S7-P1), each edit lands with its scenario (S7-S1), and one C2 entry in `spec-decision-log.md` records the edits, watched scenarios, and bytes before and after; the C2 entry grows with the 7b commit (S7-B5). Any copy trimmed to fit keeps its untrimmed text in `expanded/` (recipe `a798b93d`). | | The entry; the `.feature` diffs. |

### Slice 7 build notes, PR C1 (stream C, 2026-10-24)

Agent `a-drafts-7-2026-10-24`, intent `int_YtrwcjA9yqBoBZYQCHlPVFnc`. Everything is in the C1 entry of [../briefing-specs/spec-decision-log.md](../briefing-specs/spec-decision-log.md): each edit, its scenario, the watched scenarios, and the bytes. In short: thin briefing 18,183 → 20,877 characters (cap 21,000), thin headless 18,536 → 21,277 (21,500), headless section 351 → 398 (400), full fixture 24,119 → 27,155; a realistic five-exemplar section 4,990 → 3,732 with the lever; `tools/list` and the shared descriptions unchanged.

Calls made on the way, each recipe-checked in `soupnet-oss` and closed with feedback:

- **The headless section moved from C2 into C1** (recipe `ee7d5eac`). Its correction depends on neither 6c nor 6a, and leaving it would have the headless section ask "why your user couldn't be asked" beside a body that defines drafts by what would settle them.
- **Reading results is a new short section in the shared body** (recipe `4357942f`). The only results-interpretation text was in the paste-only JSON section, which MCP agents never see. Recipe `0c59b8a2` (fix in the existing section, no special-case framing) was the counterweight; its point was not contesting check-freely for one capability profile, and this section applies to every profile.
- **Budget: tighten the new copy first, then drop exact duplicates from the thin profile only** (recipes `c9867351`, refined by `63abcc48`). The first draft was 21,867 characters; tightening every addition brought it to 21,123, still over; dropping the two paragraphs that repeat the MCP tool schema brought it to 20,709, and editorial fixes after a reread to 20,772. The thin-results line went to the check response, as the revision placed it, rather than the briefing.
- **Stream D's intent-only outcome row** (recipe `60bb0fa0`): one clause in Closing the loop, added after the first C1 commit at stream D's prompt (+105 characters), so the headless section's closing outcome row has a target the briefing names; D's briefing-id line describes itself and is not repeated.
- **The operator's 7a addition, "a draft is yours to resolve"** (revision commit `a7f4d20`, recipe `7b89581e`, the planning session's `0d63d839`): when an agent keeps working on a person's call, it asks plainly and deposits its recommendation as a draft under its intent, so the answer reaches it wherever it is given; whichever of the person's agents holds the settling context resolves the draft; a click only for what no agent can settle; "a person", not "the person". Fitted into C1 by tightening my own new copy (the role-pattern parenthetical, the axes paragraph, the probe line, the reader moment, D's clause, and the drafting clauses), no existing text trimmed; thin 20,877 → 20,978. The 7d example-and-goal line about the over-caution case did not fit and is carried to C2 (row S7-B6).
- **Verifier follow-ups taken in C1:** "rate it" restored (S7-A2); "with the instruction quoted" (S7-D5's scenario); "the rubric for choosing" (the undefined rubric); "Running sub-agents, work live" for the jargon; the merge line now names D. Rows S7-A3 and S7-D6 amended rather than padded, as noted in each. The thin-results line still prints only on an empty result, so the "distant match" case reaches no reader; that belongs with slice 8b's result-header work (ruling 49) and is noted here for stream F.
- **Search's exclude-own default reversed** (recipe `885143c2`, superseding `303e17cf`; check `8b66f622`): at stream D's request, "Search vs check" now says search includes your own recipes, `author:<email>` narrows to one person and `-author:me` leaves yours out, and frames search as the path to anything already logged rather than to other people's judgment. Stream D flips the tool in 8a, which merges first. Thin figure unchanged at 20,978 after two trims of this PR's own copy.
- **Cross-stream:** the Drafts section names `verify_draft`'s outcomes (stream A confirmed the contract: `verified` default, `rejected`, `not_chosen`) and the `is:draft intent:<id>` poll (stream B); the feedback clause names stream D's intent-only outcome row, and Search vs check describes D's reversed exclude-own default. C1 merges after A1, D and B.
- **Delta verifier follow-ups taken:** "with your recommendation and its reasoning" restored (recipe `31b80b8b`; the rewritten scenario already said so); "With sub-agents, work live" for the dangling participle; rows S7-A4 and S7-D3 amended, with the dropped clauses kept in the expanded file; the orchestration scenario's Then now matches the copy. Noted, not changed: the served "you included" is wrong for a draft on a colleague's behalf, and it fails safe (the server refuses with `only_subject_reviews`); the expanded chunk carries the shared-book sentence that fixes it, for C2 or the next trim test.
- **Expanded briefing** (operator ruling 2026-10-24, recipe `a798b93d`): `docs/briefing-specs/expanded/` keeps every C1 chunk's untrimmed text, unserved, for ablation; covers tool and parameter descriptions too (at stream B's question).

#### Questions for the operator

57. **Where the over-caution example goes (row S7-B6).** The 7d example-and-goal line carried to C2 is about 230 characters; after C1 the thin briefing has 7 characters of headroom (20,993 of 21,000), and every remaining trim of C1's copy now removes meaning a verifier flagged. The caps belong to stream A. **Recommendation:** C2 carries a small dated raise, thin 21,000 → 21,400 and thin headless 21,500 → 21,900, sized to the measured line, since every cap is re-tightened to the measured figure after 8b and 6b anyway. **The alternative is right** if you want the thin number held: the line stays only in `expanded/slice-7.md` (chunk `slice7.over-caution-example`), where an ablation can show whether it earns its bytes. Deposited as draft `294d5aeb` under this stream's intent, so the answer reaches the stream wherever it is given. **Ruled 2026-10-24: the raise, approved** (draft `294d5aeb` verified by the planning session with the operator's words: "Yes, approved. This seems obvious though, leave feedback that this is a good assumption for a normal recipe check."). C2 moves the thin caps on its branch, dated and sized to the measured lines (S7-B6, and S7-B7 now that stream D's #139 refuses unknown parameter names), and names the raise in its PR. Feedback row `ab47487e` records that this should have been an ordinary check (plan wording fixed in `d980f8a`).

56. **The slimming lever does not reach the thin briefing.** Ruling 48 asked for one `aae000d2` lever in C1 "so the thin briefing's net growth stays small". Both levers act on exemplars, and the thin MCP briefing renders none at its default (`k=0`), so the lever shrinks the full and paste briefing (a realistic five-exemplar section 4,990 → 3,732 characters, −25%) and any briefing with exemplars opted in, but the thin fixture not at all. The thin growth (+2,589 characters at the time of asking, under the 21,000 ceiling with 228 to spare; +2,795 with 22 to spare after `f8ced57` and the 7a addition) was held down instead by tightening every addition and by dropping two paragraphs from the thin profile that repeat what the MCP tool schema already says (both kept in the full profile). **Recommendation:** accept this as C1 ships it: the lever as planned, plus the thin-only duplicate removal, with the cap re-tightened to the measured figure after F and G as A0 planned. **The alternative would be right** if you want the thin number itself held near 18,200: then the next candidates are thin-only too (the `/uploads` curl example, about 600 characters, whose pointer is already in the `file_url` parameter; or compressing the changed-mind paragraph's measurements), each a removal I would surface line by line before making. **Ruled 2026-10-24: the operator accepted the recommendation** ("Proceed with your recommendation on Question 56"): C1 ships the lever plus the thin-only duplicate removal; the thin cap is re-tightened to the measured figure after F and G, as A0 planned.

### Slice 7 verification record, PR C1

Written 2026-10-24 by the verifier (agent `a-drafts-7-verify-2026-10-24`, Soup.net intent `int_r0SQKlv5GFhOQVfbWlDxQcK7`), who did not build C1 and changed no code. Verified at `167a013` (code as of `f8ced57`) in the `c-briefing` worktree. Verdicts come from the verifier's own composition of the briefings, a reading of `git diff 32ffa5c..167a013`, the revision doc's 7a to 7e, and the C1 decision-log entry, then the tests.

**Verdict: accept with minor copy follow-ups, merged only after A1, D and B.** Of the 27 C1 rows, 24 pass (seven with a note) and 3 are not met as written (S7-A2, S7-A3, S7-D6): each drops one clause the row names. None blocks. Both surface lists hold. The gate is green: `TESTCI_PGPORT=5594 npm run test:ci` at `167a013`, **exit code 0** (132 files passed and 2 skipped; 1,892 tests passed and 6 skipped; all 9 ranking thresholds green). An earlier run at the same commit exited 1 when one vitest worker exited unexpectedly ("Worker exited unexpectedly", 1,870 passed, no assertion failed) while another session's gate (`soupnet-ci-5574`) ran concurrently and wrote into the same scratch log; the clean run above followed with only the 5554 and 5564 gates up. A first run started at `b1288ed` passed but saw `f8ced57` land partway through, so it does not count.

**How it was verified.**

- **Compositions:** a script of the verifier's own (`BRIEFING.build` over the test fixture: thin = surface `mcp` with no exemplars section, full = default with the `(exemplars)` placeholder, each with `headless` false and true), run against `32ffa5c`'s `recipe-guide-content.ts` and HEAD's. Every figure the decision log claims matches exactly: thin 18,183 → 20,877 characters (18,297 → 20,990 bytes), thin headless 18,536 → 21,277, full 24,119 → 27,155, full headless 24,472 → 27,555, headless section 351 → 398. Thin headless minus thin is 400, the section plus its blank line, and a line diff of the two shows only that section inserted, in both profiles.
- **Lever:** the verifier's own five-exemplar fixture (one to three entries each, longer evidence than the builder's) goes 5,011 → 3,807 characters (−24%; the builder's 4,990 → 3,732 is −25%), and the full briefing with it 29,080 → 30,912. `buildExemplarsSection` output for a one-entry exemplar, an empty-evidence exemplar, and one with `evidenceBlocks` undefined is byte-identical between `32ffa5c` and HEAD.
- **Tests:** `npx vitest run` over `recipe-guide-content.test.ts`, `check-response-renderer.test.ts`, `mcp-tool-descriptions.test.ts`, `mcp-tools-list-size.test.ts` and `apps/mcp-server/src/server.test.ts`: 5 files, 142 passed.
- **Reading:** the composed thin headless briefing read end to end as a fresh agent, and every added sentence scanned for rule words and solo "taste" or "judgment".

| Row | Verdict | Evidence |
|---|---|---|
| S7-A1 | pass | "## Drafts" in all four compositions with "a hypothesis you can't yet stand behind from the context you hold; only your user and their agents see it until it's resolved". Test "…carries the Drafts section with the definition, the order of moves, resolution, and live orchestration" (×4), `recipe-guide-content.test.ts`. Scenario rewritten in `checking-behavior.feature`. |
| S7-A2 | not met as written | The three moves and "A draft is your hypothesis to own, not your user's to-do item." are present and asserted. The row's "rate it" in the draft move is absent: the section reads "otherwise draft it, say in the first evidence entry what would settle it, and return when that lands". Rating is taught in How to check and the headless section only. 7a itself does not list rating, so this is a rubric-to-copy drift, not a ruling contradicted. The test does not assert it. |
| S7-A3 | not met as written | "`verify_draft` it (verified, rejected, or not chosen) with that context as new evidence" is present and asserted. The row's "ask the person when that is useful" (7a: "ask the person only when you judge it necessary or useful (`200ed4fe`)") is absent and not asserted. |
| S7-A4 | pass (note) | "they decide as they go and raise only high impact × uncertainty calls; poll `is:draft intent:<id>`, correct mid-run, and before finishing resolve what you can and list the rest with a recommendation". New `advanced-workflows.feature` scenario. Note: 7a's "without blocking" is not carried, and "raise" does not say how (a draft, by implication of the poll). |
| S7-A5 | pass | Test "nothing frames drafting as the move for when the person can't be asked" (×4). The verifier's grep of the four compositions for `be asked`, `can't ask`, `cannot ask`, `couldn't ask`, `unreachable`, `absent`: no hits. |
| S7-C1 | pass | "…true at the moment you submit, and checkable by someone who wasn't there." Test S7-C1 (thin and full). New `evidence-integrity.feature` scenario. |
| S7-C2 | pass | "`impact` and `uncertainty` (triage ratings, low \| medium \| high; leave out one you have no view on)" in How to check, both profiles. Test S7-C2. The rating scenario is out of `@unreleased`. |
| S7-C3 | pass | 398 characters (cap 400 at test line 374, unchanged). "Drafting well is the work (see Drafts): say in each what would settle it, rate it, and draft open options under one intent." No "couldn't be asked". S5-B1's test has no hunk in the diff. `briefing-surfaces.feature` headless scenario rewritten and out of `@unreleased`. |
| S7-C4 | pass (note) | Building-both clause after the unchanged "wait for the choice, then check only the chosen one." Test S7-C4. New `divergent-checks.feature` scenario. Note: "with the rubric stated first" names a rubric the briefing defines nowhere, so a fresh agent has to guess where it goes (the scenario says "in the evidence"). |
| S7-D1 | pass | "## Reading results" in all four compositions: "A returned recipe is a call someone made in their context, not a rule: weigh it against yours and say how it applies. A familiar judgment in a new context is worth logging, with that context as evidence." Claims as choices placed with D3, as the row allowed. Two new scenarios. |
| S7-D2 | pass | Two When-to-check bullets, each a question and a goal ("It may not feel like a call; a check finds your user's principle if they've stated one."; "a check before writing finds them"). Test; two new scenarios. |
| S7-D3 | pass | "Granularity and generality are separate axes: … State the claim at the most general level that's still true, as a choice rather than a "must", and put the specifics in the evidence, where they stay read and checkable." Test; `recipe-voice.feature` scenario. |
| S7-D4 | pass | "Four patterns keep it transferable" and the recipient bullet with "prefer" or "chose", not "want", and the authors-the-next-one test. Test; `recipe-voice.feature` scenario. |
| S7-D5 | pass (note) | "An instruction pulling against your judgment? Check the call you think is right, then proceed; its id is where redirection attaches." Test; scenario. Note: the scenario's Then-clause "with the instruction quoted in the evidence" is not in the copy, so a fresh agent is not taught it; see finding 5. |
| S7-D6 | not met as written | "A neighbor that is your own open draft is your assumption coming back; weigh it as that." The row's (and 7d item 6's) second case, "or deposited today under its intent", is absent. The build notes record one Reading-results clause cut for budget, for D8, not this one. |
| S7-D7 | pass | "Probing the corpus itself (what's there, how a role clusters) is a search too; a probe made as a check takes exemplar slots from real recipes." Test; scenario. "Probing the system does not log junk recipes" stays `@unreleased` on its own blocker (FF-1), correctly. |
| S7-D8 | pass (note) | Renderer line on the check's empty result (`check-response-renderer.ts:349`), the search branch untouched; renderer test green. It reaches MCP and the `/check` HTML page, whose `md-result` block renders the same markdown (`check.ts:775`); the page's own `<p>No matching recipes found.</p>` is web copy, outside C1. Note: the line shows only on zero results, so the distant-match case it names never sees it; see finding 4. |
| S7-V1 | pass (note) | Test S7-V1 green over Drafts, Reading results, the When-to-check additions, and the headless section. The verifier's scan of every added line: "must" only as the quoted mention in D3; no "never", "always", "do not", "don't". Solo "judgment" three times (finding 7). No added sentence reads as a rule, contradicts check-freely, or says drafting is for when the person can't be asked; the first move named is "check it as an ordinary recipe and own it". Recipe `d1d07fcc`. |
| S7-L1 | pass | Four `buildExemplarsSection` tests (three entries, two, one, blank only). Byte-identical old and new output for one, zero and undefined evidence (above). The pointer matches the check response's existing "get_recipes (MCP) or GET /recipes?ids=<id>" wording, and `GET /recipes?ids=` exists (`routes/recipes.ts:52`). |
| S7-L2 | pass | 5,011 → 3,807 on the verifier's fixture; same direction and size as the log's 4,990 → 3,732; the thin fixture has no exemplars section. |
| S7-L3 | pass | Diff touches only `recipe-guide-content.ts`, `check-response-renderer.ts` and their tests under `packages/`; `briefing-exemplars.ts`, every `apps/` file and the ranking files are untouched. DT-VIS suites ran in the gate. |
| S7-Z1 | pass | 20,877 ≤ 21,000 and 21,277 ≤ 21,500; the caps (test lines 260, 374, 386) are unchanged in the diff. Net growth +2,694 thin, +2,741 thin headless, recorded in the log. |
| S7-Z1b | pass | Test "thin omits them" and "full keeps them". The content does live in the schema on both servers: `session_id` "Compacted your context? Omit it next check for full text again." and `supporting_evidence` "Each entry: interpretation text, then '> direct quote', then '-- source citation'" (`mcp.ts:411,428`; `apps/mcp-server/src/server.ts:134,146`). |
| S7-Z2 | pass | No hunk in `recipe-guide-content.ts` after line 834 (`MCP_TOOL_DESCRIPTIONS` at 906, `MCP_PARAM_DESCRIPTIONS` at 986); `drafts.ts`, `apps/` and the frontend untouched. Size tests green with caps unchanged: `REMOTE_TOOLS_LIST_MAX_BYTES = 18_200`, `STDIO_TOOLS_LIST_MAX_BYTES = 14_700`, shared descriptions `6600`. |
| S7-P1 | pass | No route or service change; every surface composes from `BRIEFING.build`; `briefing-surfaces.test.ts` ran in the gate. |
| S7-S1 | pass (note) | Edits 1 to 13 each have their scenario on this branch. `@unreleased` came off exactly the five named (rating, drafting, queue link, on-behalf, headless), each of whose comment named slice 7 as the blocker; the README row is updated. Notes: edit 14 (`f8ced57`) moves a `feedback-loop.feature` scenario that lives on stream D's branch, not this one; and the queue-link and on-behalf scenarios are taught by the deposit notice and the `on_behalf_of` parameter, not the briefing body, which mentions neither (their own stated blocker, "the briefing body teaches drafting", is met). |
| S7-S2 | pass (note) | One C1 entry, fourteen items, watched scenarios, and a measure table that matches the verifier's figures exactly. The commit bodies mirror it (`38d9ba1` at the pre-`f8ced57` figures, `f8ced57` with the update), without the full-with-section row. |
| Must change | pass | `PRINCIPLES`, `WORKFLOW_WHEN`, `ROLE_PATTERNS`, `HEADLESS_KEY_SECTION`, the `BRIEFING` body, `buildExemplarsSection`, the renderer, their tests, the named `.feature` files, the README and the log all changed. |
| Must NOT change | pass | No change to `MCP_TOOL_DESCRIPTIONS`, `MCP_PARAM_DESCRIPTIONS`, `drafts.ts`, web pages, any cap constant, `apps/backend`, or the ranking files. |

**Findings, by severity**

1. **Medium: the copy describes three behaviours this branch's backend does not have, and the merge condition names two.** The Drafts section names `verify_draft`'s three outcomes (stream A, A1) and the `is:draft intent:<id>` poll (stream B), and `f8ced57` adds an intent-only outcome row (stream D, 8a); on this branch `validateFeedbackRow` (`feedback.service.ts:242`) still refuses a row without a `trace_id` or `search_id`. The rubric's cross-stream paragraph and the build notes' "C1 merges after A1 and B" were not updated for D. Recommendation: add D to that line, and at merge confirm all three are on main (the plan's order A1, D, B, E, C1 already has it).
2. **Low: three rubric clauses dropped from the copy (S7-A2 "rate it", S7-A3 "ask the person when that is useful", S7-D6 "deposited today under its intent").** S7-A3's is the most worth restoring: it is the half of `200ed4fe` that 7a quotes. Together they cost about 90 characters against 123 of thin headroom. Recommendation: add all three if the operator wants the rubric as written; otherwise amend the three rows to the shipped text. Open for the operator.
3. **Low: stale figures in question 56.** It was ruled on "+2,589 characters … 228 to spare"; after `f8ced57` the thin growth is +2,694 with 123 to spare. The ruling's substance does not turn on it. Recommendation: correct the figures beside the ruling.
4. **Low: the thin-results line cannot reach the case it names.** It prints only when a check returns nothing, so "rather than stretching a distant match" is read only when there is no match, and the scenario's "or only distant ones" Given has no copy behind it. Recommendation: accept for C1 and carry the distant-match cue to slice 8's result-header work (ruling 49).
5. **Low: the instruction-tension bullet and its scenario disagree.** The scenario expects the instruction quoted in the evidence; the copy says only "Check the call you think is right, then proceed". Without the quote, a fresh agent may log its own preference in the person's voice while the person said otherwise, which the voice test in Role patterns calls false. Recommendation: add "with the instruction quoted" (about 27 characters), or drop the Then-clause.
6. **Low (copy, for C2 polish):** "with the rubric stated first" (divergent checks) names an undefined rubric; "Orchestrating sub-agents is live" reads as jargon to a fresh agent.
7. **Note: solo "judgment" three times in added copy** ("pulling against your judgment", "one judgment per recipe", "A familiar judgment in a new context"). Passed under S7-V1's "where both are meant", since the first two mean only judgment; the third arguably means the person's taste and judgment and is flagged per the pairing rule's refinement.

**Recipe checks by the verifier** (`soupnet-oss`, each closed with feedback): `50c5b20e`, grading a dropped rubric clause as "not met as written", non-blocking (neighbours `9172f109` and `589cec64` agreed); `d1d07fcc`, passing solo "judgment" in tight lines with a flag. **Proceeded on:** both of those gradings. **Left open for the operator:** findings 1 to 5.

### Slice 7 verification record, PR C1 delta (9cc9a0b)

Written 2026-10-24 by a second verifier (agent `a-drafts-7-verify2-2026-10-24`, Soup.net intent `int_rySP4u7bhiy5LOMuOAs4ZXNh`), who did not build C1 and changed no code. Scope: `git diff 167a013..9cc9a0b` only, read against the 7a addition "A draft is yours to resolve" (revision commit `a7f4d20`, on `main`), the amended rows S7-A2, S7-A3, S7-D6, the new C2 row S7-B6, and the updated C1 entry in `spec-decision-log.md`. The delta also tightens copy outside the Drafts section, so every row whose named clause the delta touched was re-graded, not only the three amended ones. `a9fc1a6` (the search exclude-own reversal, which landed during this verification and carried an in-progress draft of this section) is outside this scope and not graded here.

**Verdict: accept; no blocker.** The Drafts section carries the 7a addition faithfully and keeps asking first. The three amended rows pass. Two untouched rows (S7-A4, S7-D3) now drop a clause the delta removed, one recipe-anchored clause ("its reasoning") left the copy while its scenario kept it, and one build-notes merge line was not updated; all low. test:ci was not re-run: the delta is copy, specs and test strings, the two affected test files pass, and nothing found casts doubt on the implementer's green gate at `9cc9a0b`.

| Check | Result | Evidence |
|---|---|---|
| 1. Drafts text carries 7a | pass (notes) | Composed thin "## Drafts": "if it's a person's call and they're reachable, ask plainly with your recommendation, and if you keep working meanwhile, draft that recommendation under your intent so their answer reaches you wherever it's given"; "A draft is yours to resolve: whichever of a person's agents holds the settling context, you included once the work or a reply settles it, resolves it with `verify_draft` (verified, rejected, or not chosen) under the same confidence rule as any check, quoting their words wherever they gave them. A draft waits for a person's click only while nothing any agent holds settles it." Every element of `a7f4d20` is present; "a person" throughout, "the person" only in "private to the person it's about" (a specific draft's subject, correct). Asking stays the move for a reachable person's call (ruling 52, recipe `31b80b8b`); the draft accompanies the question only when work continues, and "And it does not park a draft for a person to settle later in place of asking" pins it in the scenario. No added sentence uses a rule word or contests check-freely; the click sentence reads as a description, not a prohibition. Notes in findings 2, 5, 6. |
| 2a. S7-A2 (amended) | pass | Three moves, "a person's call", the recommendation drafted under the intent as the return path, "rate it" restored. Test asserts each phrase. |
| 2b. S7-A3 (amended) | pass | Whoever holds the settling context, depositor included, `verify_draft` with all three outcomes, same confidence rule, quoting their words, click only when no agent settles it. Test asserts each phrase. |
| 2c. S7-D6 (amended) | pass | "A neighbor that is your own open draft is your assumption coming back; weigh it as that." matches the amended row. |
| 2d. S7-D5 scenario vs copy | pass | Copy "Check the call you think is right, with the instruction quoted, then proceed"; scenario "with the instruction quoted in the evidence". They now agree (previous finding 5 closed). |
| 2e. S7-A4 (not amended) | not met as written | Row: "resolves what it can before finishing, listing the rest with a recommendation". Copy now ends "and resolve what you can before finishing."; the test assertion for "list the rest with a recommendation" was replaced. `advanced-workflows.feature` still expects "either resolved with verify_draft or listed to the person with a recommendation". See finding 1. |
| 2f. S7-D3 (not amended) | not met as written (minor) | Row: "the specifics in the evidence, where they are still read and checkable" (7d item 3: "still read and still checkable"); copy now "where they stay checkable". See finding 3. |
| 2g. Other touched rows (S7-C4, S7-D2, S7-D4, S7-D7, S7-V1) | pass (notes) | C4 "with the rubric for choosing stated first" (previous finding 6, first half, closed); D4 keeps "As a reader of weekly status reports..." after the parenthetical's removal; D7 "Probing the corpus ... is a search too; a probe check takes exemplar slots"; V1: grep of added lines finds no new "must", "never", "always", "do not", "don't", solo "taste", or new solo "judgment". Notes in finding 6. |
| 3. Byte figures | pass | Verifier's own script (`BRIEFING.build` over the test fixture, imported by `file:///` URL, stdin from `/dev/null`): thin 20,978 characters (21,091 bytes), thin headless 21,378, full 27,256, full headless 27,656, headless section 398. All four expected figures and the log's bytes match exactly. 21,000 − 20,978 = 22 characters of thin headroom. Cap constants identical to `32ffa5c` (`21_000` line 260, `400` line 374, `21_500` line 386 in both); no `apps/` file or tools-list cap touched since `32ffa5c`. |
| 4. Tests | pass | `npx vitest run packages/domain/src/recipe-guide-content.test.ts packages/domain/src/check-response-renderer.test.ts`: 2 files, 95 passed (worktree's own `@soupnet/*` junctions). |
| Previous findings | mostly closed | 1 (merge names D) closed in the rubric paragraph, not in the build notes (finding 4); 2 closed by amendment; 3 closed (question 56 now "+2,795 with 22 to spare", which matches); 5 closed; 6 closed for the rubric, partly for the jargon (finding 6); 4 and 7 carried as noted. |

**Findings, by severity**

1. **Low: S7-A4 drops "list the rest with a recommendation", unrecorded.** 7a's orchestration bullet says "resolve your sub-agents' drafts or list them with a recommendation (`97f7c34e`)", the row and the `advanced-workflows.feature` scenario still say so, and the build notes' "amended rather than padded, as noted in each" names S7-A3 and S7-D6 but not this one. The 7a addition does not supersede it: drafts no agent can settle still wait for a person, and the plan's stream guidance has the final message carry the open ones. Restoring it (about 40 characters) does not fit the 22 left. Recommendation: amend the row and the scenario's last Then to the shipped text and record the drop in the build notes, or restore it with a matching trim; open for the operator.
2. **Low: "with your recommendation and its reasoning" became "with your recommendation".** Recipe `31b80b8b` (ruling 52) says "with a recommendation and its reasoning", and the scenario rewritten in this same commit still says "asks that person plainly with its recommendation and reasoning", so the copy and its scenario disagree. The amended S7-A2 row omits reasoning, so the row passes. Restoring " and its reasoning" is 18 characters and fits (thin would be 20,996). Recommendation: restore it; the alternative is to drop "and reasoning" from the scenario.
3. **Low: S7-D3's "still read" dropped.** "where they stay read and checkable" became "where they stay checkable". The dropped half said the specifics are still read once they move to the evidence; "checkable" alone carries most of that. Recommendation: amend the row to the shipped text.
4. **Low: the build notes' cross-stream bullet still reads "C1 merges after A1 and B."** The rubric paragraph now names D and "at merge, confirm all three are on `main`", and the follow-ups bullet says "the merge line now names D", but the Cross-stream bullet at the end of the C1 build notes was not changed. Recommendation: add D there too.
5. **Note: "you included" for an on-behalf draft.** "whichever of a person's agents holds the settling context, you included" is true for a self-draft; for a draft deposited on a colleague's behalf the depositor is not that person's agent, and 7a's parenthetical ("a draft on their behalf is resolved by their agents") did not make the copy. The server already refuses that case with `only_subject_reviews` (`draft-verify.service.ts:115`), so it fails safe. Recommendation: none for C1; worth a word if C2 has room.
6. **Note (copy polish):** "Running sub-agents, work live:" still reads awkwardly (a dangling participle; "When running sub-agents, work live:" would read cleanly at +5 characters). "quoting their words wherever they gave them" can be read as the agents' words. "A check before writing finds the corrections already logged" presupposes they exist, where the earlier "often already logged" did not. The divergent clause lost "(each is true when checked)", the reason checking every option does not break the preceding truthfulness sentence; S7-C4 does not require it.
7. **Note: S7-B6 will not fit as-is.** The carried example-and-goal line is over 200 characters against 22 of thin headroom, so C2 needs the "measured trim of C1's own copy" the row allows, or a dated raise. Naming it now so the trim is planned, not discovered.

**Recipe checks by this verifier** (`soupnet-oss`, each closed with feedback): `246803ee`, re-grading rows a delta silently breaks even when the implementer did not amend them, "not met as written", non-blocking (neighbours `50c5b20e` and `8f55a8d7` agreed); `2fef6572`, passing an amended row on its new wording while recording a recipe-anchored clause the amendment dropped as a separate finding (neighbours `e0880609` and `861310a6` agreed). **Proceeded on:** both gradings, and on not re-running test:ci. **Left open for the operator:** findings 1 to 4 (amend or restore in each case), and whether C2 trims C1 copy or raises the cap for S7-B6 (finding 7).

### Slice 7 build notes, PR C2, briefing body (stream C, 2026-10-25)

Agent `c-briefing-75-c2-2026-10-25`, intent `int_gxl5ZMTtpO9RG0cvgsKXw5lJ`, branch `drafts/7-briefing-c2` stacked on C1. Everything is in the C2 entry of [../briefing-specs/spec-decision-log.md](../briefing-specs/spec-decision-log.md). In short: the 7f opening and evidence-standards paragraph, the over-caution line (S7-B6), the unknown-parameter clause (S7-B7), and the on-behalf sentence (S7-B10, the C1 delta verifier's note 5); thin briefing 20,993 → 22,681 characters, thin headless 21,393 → 23,081, caps moved on this branch to 22,800 and 23,200 (S7-Z3; question 57's figures predate 7f). Nothing trimmed, so `expanded/` is unchanged.

Stream C took the branch over at `2a206f8` (the C2 brief had reached another session, which wrote `55ee953`, `1c52bf2` and `2a206f8` and made placement check `80b2fbb5` under its own intent `int_gxl5ZMTtpO9RG0cvgsKXw5lJ`; that intent and agent id are its, and the work is stream C's from here). Review against revision §7f and question 57: the opening and evidence-standards paragraphs match 7f in substance and voice; the over-caution line is S7-B6 verbatim; the on-behalf sentence closes C1's "you included" gap. One fix (`142492f`): the unknown-parameter clause now says "An MCP tool refuses", since 8a's guard wraps only the two MCP transports and the full profile serves the sentence to web agents too; figures re-measured (thin 22,681, thin headless 23,081, full 28,959). Gate: `test:ci` on C2 merged with main (#137 in, the decision-log top conflict resolved by keeping both entries) passed on the second run, 133 files and 1,942 tests; the first run's only failure was a vitest worker exiting while another stream's gate ran, with every reported test passing. The slice 10 bus line stays with stream A's `drafts/10-bus`, since expiry only becomes true there; A also carries the books-block Drafts count line.

The 7b commit (S7-B1 to S7-B5) came after the rebase onto `main` (#137 and #139 merged; backup branch `backup/c2-pre-rebase-f9eab1e`), since none of its copy names B's `intent:` term. Changes: the `draft` parameter, the self-draft notice, both queue intros, and the dashboard card (moved to `DRAFTS_CARD_TEXT`). DT-QUE-05 is reworded, and the can't-be-asked test now covers tools, notices, and web strings. Bytes are in the C2 log entry: remote `tools/list` 17,642 → 17,691, stdio 14,145 → 14,194, shared descriptions 6,386 → 6,435 (measured on `main` with 6a, after the second rebase), all under unchanged caps. Wording check `5ee7ba5f`; its neighbour `5d3ddfc7` ("a person" in shared-book copy) was weighed, and the self-draft notice keeps "the person" because a self draft has exactly one person. `test:ci` passed (136 files, 2,015 tests). Browser verification of the queue intros and the dashboard card met every expectation (8 of 8, axe clean on the changed text, 412 px). It also found two loose ends, both fixed in this PR: the card said "your agents" for a draft another person's agent made on your behalf (it now says "agents"; the mismatch predates C2), and the `/check` page's draft box still said "the person could not be asked". The draft parameter's wording replaces that label.

After B (6a, #142) merged, `main` was merged into C1 (`drafts/7-briefing`; the decision log was the only conflict, both entries kept) and C2 was rebased onto that merge. The rebase also dropped three of 6a's names from an import in `draft-queue.test.ts`; that line is restored, and every line the C2 diff removes from `main` is one of slice 7's intended copy changes.

- **Placement** (recipe `80b2fbb5`): each paragraph where its subject already lives, the existing opening kept whole after the new one. Evidence standards sit in Recipe format, not Drafts, because only their last two sentences are about drafts.
- **Not added: the "drafts as a bus" briefing line** (revision §"A proposed slice 10", "C2 or with this slice"). It describes expiry, which does not exist until slice 10; it ships with that slice.
- **"Why it's a draft rather than a check" (S7-B11):** the coordinating session's brief asked for it, and 7f on `origin/main` did not have it. Asked; the coordinating session confirmed it is the operator's addition of 2026-10-25, in his local revision commit `3960743` (not yet pushed; read in this repository). The Drafts section's first-entry clause now asks for both the why and what would settle it. When the 7b commit rewrites the `draft` parameter (S7-B1), it should carry the same pair if the shared-description budget allows.

### Slice 8a rubric: tool shapes (stream D)

Written 2026-10-24 by stream D (agent `a-drafts-8a-2026-10-24`), before implementation, from the revision doc's slice 8 items 4 to 7 and its "Tool-shape gaps logged by sessions", and from the code at `32ffa5c` (the A0 scaffold). Branch `drafts/8a-tool-shapes`. Consumer: agents (MCP remote and stdio, REST). No web change. Security-relevant: yes, in two places: the id parser feeds the uniform-marker lookup, and the two new feedback targets (a briefing, an intent alone) are new read-scope checks on a write path. Both join the combined audit after A1, B, D and E merge.

**Baselines**, measured by this agent at `32ffa5c` with the slice 1 method (`createMcpServer` with a stub principal and `createStdioServer`, each over the SDK in-memory transport, `initialize` then `tools/list`, the reply's `result` as minified UTF-8 JSON):

| Measure | Value | Cap (A0) |
|---|---|---|
| Remote `tools/list` | 16,986 bytes (`get_recipes` 904, `get_briefing` 1,381, `log_feedback` 3,104, `search_recipes` 2,987) | 18,200 |
| Stdio `tools/list` | 13,196 bytes (`get_recipes` 904, `get_briefing` 1,381, `log_feedback` 2,812) | 14,700 |
| Shared descriptions | 6,051 characters | 6,600 |

The A0 raise is shared by A (`outcome` on `verify_draft`), B (one grammar term) and D. D's share is set at most 700 bytes remote, 600 stdio, and 200 shared-description characters; the remainder is left for A and B.

**Decisions this stream makes that touch other streams' surfaces** (written before building on them, per the plan):

- `check_feedback` gains one nullable column, `briefing_audit_id uuid` (a soft pointer to a `briefing.issued` audit row, like `search_audit_id`), and the one-target CHECK becomes: exactly one of `trace_id`, `search_audit_id`, `briefing_audit_id`, or none of them when `kind = 'outcome'` and `intent_id` is set. One migration; it will collide by number with stream B's `traces.intent_id` migration on purpose, and whichever merges second regenerates. Stream E's `GET /feedback/rows` must expect rows whose `traceId` is null with either a `briefingId` or an `intentId` alone, and its export of `check_feedback` carries the new column.
- The split with stream A on `verify_draft` (agreed with stream A, 2026-10-24): A1 owns `verify_draft`'s schema, its parameter descriptions and its validation. In A1, `outcome` is a plain string whose description reads "verified (default) | rejected | not_chosen", and one refusal reports a bad `outcome` and every evidence problem together. 8a does not edit `verify_draft`. 8a's unknown-parameter guard reads each tool's accepted names from the registered schemas at call time, so `outcome` is accepted the moment A1 registers it.
- Stream C may want one line in the briefing's feedback section naming the intent-only `outcome` row and `briefing_id`. 8a does not edit the briefing body; the tool descriptions and the briefing's own id line carry it until then.

**Item 4: `get_recipes` takes an array**

| # | Criterion | Evidence |
|---|---|---|
| S8a-I1 | `get_recipes` (remote and stdio) accepts `recipe_ids` as a JSON array of strings or as the comma- or whitespace-separated string, and both forms give byte-identical answers for the same ids. | Layer 3 on remote MCP; stdio test that the proxied `GET /recipes` URL is the same for both forms. |
| S8a-I2 | A string that is itself a JSON array (`'["a","b"]'`, the form three field sessions sent) resolves the ids inside it instead of yielding markers for `["a` and `"b"]`. Brackets and quotes around ids are stripped; nothing else is (an id with a stray character is still a marker). | Layer 1 table test of `parseRecipeIds` over string, array, JSON-array string, mixed separators, duplicates, empty entries. |
| S8a-I3 | `GET /recipes` accepts the same forms in `ids`, plus a repeated `ids` parameter; `get_briefing`'s `recipe_ids` and `GET /briefing?recipe_ids=` take the same forms through the same parser. | Layer 3 on REST and on `get_briefing`. |
| S8a-I4 | The array form changes nothing about access: the 20-id cap applies after parsing; an id the key cannot read is the uniform `not_found_or_unreadable` marker in either form, byte-identical to a random id's (the RP pair: another person's draft vs a random UUID, and a published recipe in an unreadable book vs a random UUID). | Layer 3 uniform-response comparison in array form. |

**Item 5: every failing field at once, with the enumerations in the descriptions**

| # | Criterion | Evidence |
|---|---|---|
| S8a-V1 | `validateFeedbackRow` reports every failing field in one error, in schema order, each with its allowed values and what was received; a row with one failing field gets exactly today's message for that field. | Layer 1: a row with bad `kind`, `impact`, `disposition`, `story_fulfilled`, missing `story` and a bad `top_similarity` names all six in one error. |
| S8a-V2 | The same all-fields error reaches the agent on every feedback surface: `log_feedback` (remote and stdio), a ride-along row on `check_recipe` and `search_recipes`, `POST /feedback`, `GET /feedback`, and `feedback_*` on `/check`. | Layer 3 on remote `log_feedback` and `POST /feedback`; stdio relays the backend error verbatim (existing test shape). |
| S8a-V3 | `log_feedback`'s parameter descriptions name each enumeration and the requirement agents tripped on: `story` is required on every row; give exactly one of `trace_id`, `search_id`, `briefing_id`, or, for an `outcome` row, `intent_id` alone. The remote and stdio `log_feedback` schemas serve identical properties apart from the description of `trace_id`. | Test comparing the two served schemas; snapshot of the served descriptions. |
| S8a-V4 | `verify_draft` is covered by stream A's A1 rows (see the split above); 8a adds no `verify_draft` row of its own. | Pointer to A1's rubric. |

**Item 6: `outcome` rows on `intent_id` alone, and an id from `get_briefing`**

| # | Criterion | Evidence |
|---|---|---|
| S8a-O1 | A row with `kind: outcome`, a valid `intent_id`, and no `trace_id`, `search_id` or `briefing_id` is stored with all three targets null and the intent id set. The same row with any other kind is refused with a message naming the allowed targets. | Layer 3 on `log_feedback` and `POST /feedback`, reading the row back. |
| S8a-O2 | The intent must be the caller's user's. An unknown or other user's intent id gets one uniform marker (`intent_id not found or not readable with this key`), byte-identical across the two cases, and no row. A malformed id is a shape error like any other field's (the `int_` format is public, so the shape says nothing about anyone's intents). When a row has another target, `intent_id` stays capture-only exactly as today (a bad one stores null, never a refusal). Amended by the implementer before verification: the first wording put "malformed" under the uniform marker. | Layer 3 uniform comparison with two users. |
| S8a-O3 | An identical intent-only resubmission returns the original row (`dup`), as the other targets do. | Layer 3. |
| S8a-O4 | `get_briefing` (remote and stdio) and `GET /briefing` return a briefing id: the id of the `briefing.issued` audit row that call wrote. MCP text ends with one line naming it and `briefing_id`; REST returns `data.briefingId`. The JWT copy-briefing path (`POST /keys/briefing`) adds no line, since a pasted briefing is reused across sessions. If the audit write fails, the briefing still returns, without an id. | Layer 3 on each surface; Layer 1 on the line. |
| S8a-O5 | A row with `briefing_id` attaches to that briefing when its audit row has `action = 'briefing.issued'` and the caller's user as actor. Any other id (unknown, another user's briefing, a search's audit id) gets one uniform marker and no row. Exactly one target per row, and naming two is refused. | Layer 3 uniform comparison. |
| S8a-O6 | Schema: one migration adds `briefing_audit_id` and replaces the CHECK as above, plus a dedup unique for briefing rows and a partial unique for intent-only rows. `check:data-model` passes, and a pre-migration row is untouched. The CHECK refuses a row with no target and kind other than `outcome`. | Migration SQL reviewed; a direct-insert Layer 3 test of the constraint. |

**Item 7: the exclude-own message**

| # | Criterion | Evidence |
|---|---|---|
| S8a-E1 | When a search under the exclude-own default returns nothing and the caller's own recipes in scope were excluded, the notice's first line gives the same query with `author:me` added, ready to paste (`author:me <the query as sent>`), with the count. The JSON carries it as `ownExcludedQuery`. Markdown shows it as the line after the header. | Layer 1 on the notice and renderer; Layer 3 on remote `search_recipes` (markdown and structured). |
| S8a-E1′ | **Replaces E1 and E2 after the operator's reversal of 2026-10-24 (recipe `885143c2`, superseding `303e17cf`).** MCP `search_recipes` and the stdio search (`/check` with its surface header) include the caller's own recipes by default, drafts under their label; `-author:me` leaves them out; nothing reports own recipes as excluded. The author:me lead E1 asked for is removed, since there is nothing to recover. | Layer 3: `tool-shapes.test.ts` S8a-E1/E2 (as amended), and the updated `check-search`, `draft-queue`, `drafts` and `drafts-on-behalf` tests. |
| S8a-E2 | Responses with results, and searches where the default did not apply (an `author:` or `is:draft` query, the web `/check` filter), are byte-identical to today. | Layer 1 and the existing search tests unchanged. |

**Unknown parameter names**

| # | Criterion | Evidence |
|---|---|---|
| S8a-U1 | One constant, `UNKNOWN_PARAM_MODE` (`"refuse"` or `"warn"`), governs a guard at MCP dispatch on both servers. It sits on the transport and is called once from the `/mcp` route and once from the stdio entry. No tool handler changes, and accepted names come from each tool's registered schema at call time. | Code review; a test that a parameter added to a tool's schema is accepted with no other edit. |
| S8a-U2 | Refuse: a `tools/call` naming any parameter the tool does not declare runs nothing and answers an MCP tool error (`isError: true`) listing the unknown names, the tool's accepted names, and a near-miss suggestion where one is obvious (`recipe_id` → `recipe_ids`). | Layer 3 on remote and stdio: no `recipe.checked` audit row and no trace after a refused `check_recipe`. |
| S8a-U3 | Warn: the call runs as today (the unknown name is ignored, as the SDK strips it) and the reply's first content block is one warning line with the same facts. `structuredContent` is unchanged. | Layer 3 on remote and stdio. |
| S8a-U4 | Calls with only declared names are byte-identical to today in both modes, and `tools/list`, `initialize` and every other method pass through untouched. | The existing MCP suites pass unchanged in both modes (run once with each). |
| S8a-U5 | Both responses are shown to the operator (question 56) and the default is set by the ruling. | The two responses pasted under this heading. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S8a-Z1 | Remote `tools/list` grows by at most 700 bytes, stdio by at most 600, shared descriptions by at most 200 characters. The before and after figures are recorded in `spec-decision-log.md`. Caps unchanged (A0 owns them). | Size tests green; the figures. |
| S8a-Z2 | The thin and full briefing fixtures are byte-identical: the briefing id line is composed outside `BRIEFING.build`. | `recipe-guide-content.test.ts` unchanged. |

**Surfaces that must change:** `services/recipe-lookup.service.ts` (`parseRecipeIds`), `routes/recipes.ts` (the GET route only), `services/feedback.service.ts`, `routes/feedback.ts` only where the service result shape needs it, `services/briefing.ts` and `routes/briefing.ts`, the `get_recipes`, `get_briefing`, `log_feedback` registrations in `routes/mcp.ts` and `apps/mcp-server/src/server.ts`, the `/mcp` route handler (one call), the stdio entry (one call), `services/trace.service.ts` and `check-response-renderer.ts` (the exclude-own notice), `MCP_PARAM_DESCRIPTIONS.recipeIds`, `MCP_TOOL_DESCRIPTIONS.logFeedback` if needed, `packages/db/src/schema/check-feedback.ts` with its migration and the regenerated data-model doc, `docs/briefing-specs/feedback-loop.feature` and `intent-registration.feature` (one scenario each), `spec-decision-log.md`.

**Surfaces that must NOT change:** `verify_draft` (stream A), the briefing body and `BRIEFING.build` (stream C), the `search_recipes` description's qualifier list (stream B), the size-cap constants (A0), the five ranking files, the authz visibility fragments, the lookup's ACL and marker text.

**Briefing-copy declaration.** The `get_recipes` and `log_feedback` descriptions, the briefing id line, the exclude-own notice and the unknown-parameter messages are agent-facing copy under the regression rule. The PR appends one `spec-decision-log.md` entry naming the scenarios moved (`feedback-loop.feature`: an `outcome` row closes an intent with no single recipe; `intent-registration.feature` "Feedback closes the declared loop" gains the intent-only row) and the ones watched.

**Soup.net:** intent registered with `agent_id` `a-drafts-8a-2026-10-24`. Checks in `soupnet-oss` are listed under the build notes with their feedback rows.

### Slice 8a build notes (stream D, 2026-10-24)

What shipped, against the rubric. Branch `drafts/8a-tool-shapes`.

**Gate:** `TESTCI_PGPORT=5644 npm run test:ci` exited 0, with 1,930 tests passed and 6 skipped (136 files). Typecheck, lint (0 errors; the 5 warnings are existing `console.log` lines), the data-model check and the authz seam all passed, as did the golden-set ranking eval. Slice 8a's own suites: `routes/tool-shapes.test.ts` (Layer 3, 20 tests), `domain/unknown-params.test.ts`, and the new rows in `feedback.service.test.ts`, `recipe-lookup.service.test.ts`, `check-response-renderer.test.ts` and `mcp-server/server.test.ts`.

**Bytes (S8a-Z1, Z2):** remote `tools/list` 16,986 → 17,318 (+332 of the 700 share; `get_recipes` 904 → 979, `get_briefing` 1,381 → 1,436, `log_feedback` 3,104 → 3,306). Stdio 13,196 → 13,821 (+625, 25 bytes over the 600 share this rubric set itself). The overage is the `search_id` the stdio `log_feedback` never had, and I recorded it rather than trimming unrelated copy to meet my own number; 879 bytes remain under the stdio cap for A and B. Shared descriptions 6,051 → 6,110 characters (+59 of 200). The thin and full briefing fixtures are unchanged.

**Seam register:** two fingerprints were refreshed in `scripts/check-authz-seam.mjs`. `feedback.service.ts` goes from 19 to 26 lines matched, because `check_feedback` is a watched table and the briefing and intent-only statements are new. `trace.service.ts`'s import line moved, with no SQL change. Stream B also edits `trace.service.ts`, so whichever of us merges second refreshes that entry (reference: two green PRs can break `main` via seam fingerprints).

**Fixed in passing:** `GET /feedback` refused any row without `trace_id`, so search feedback had never worked over the URL form. It now takes any target the service accepts. Sweep check `1bbc63f1`.

- **Array ids (S8a-I1 to I4).** `parseRecipeIds` takes a string or an array, and reads a string that is itself a JSON array as the ids inside it. It strips only brackets and quotes around an id, so a stray character inside one still reaches its marker. `get_recipes` and `get_briefing` take `recipe_ids` as a string or an array on both servers (the stdio proxy joins an array before forwarding). `GET /recipes` reads every `ids` value, so a repeated parameter works.
- **All fields at once (S8a-V1, V2).** `validateFeedbackRow` collects every failing field in schema order: "N fields need fixing: …". A single failure reads exactly as before. Every feedback surface goes through it. `POST /feedback` no longer 400s a row object that lacks `trace_id`/`search_id`: the service now names the missing target together with any other failing fields, rather than a coarse 400 that hid them.
- **Descriptions (S8a-V3).** On both servers `log_feedback` now says "Required on every row" on `story` and states the one-target rule on `trace_id`, and gains `briefing_id`. The stdio `log_feedback` had a required `trace_id` and no `search_id` at all; it now serves the same properties as the remote one. `MCP_PARAM_DESCRIPTIONS.recipeIds` names the array form, and `MCP_TOOL_DESCRIPTIONS.logFeedback` names the search, briefing and intent targets.
- **Intent-only outcome rows and the briefing id (S8a-O1 to O6).** These need one migration, `0041_check_feedback_briefing_and_intent_targets`: a `briefing_audit_id` column, the CHECK relaxed, a dedup unique for briefing rows, and a partial dedup unique for intent-only rows. `composeBriefing` now writes its `briefing.issued` row with `returning` (the same swallow-on-failure posture as before) and returns its id. MCP prints it as the briefing's last line, and `GET /briefing` returns `data.briefingId`. The JWT copy path doesn't print it. The ACL for both new targets is own-user, with uniform markers.
- **Exclude-own (S8a-E1, E2).** This change is additive: the existing "No matches … (all N are your own recipes …)" sentence is kept, and a first line is added, "Your own recipes were left out by default (n of the N in scope). The same search including them: author:me <query>". It goes on the remote tool's markdown and notice, and on `/check`'s notice, which is what the stdio search reads with its surface header. `ownExcludedQuery` carries it for structured callers. The web `/check` filter has no exclude-own default and is unchanged.
- **Unknown parameter names (S8a-U1 to U4).** `packages/domain/src/unknown-params.ts`: `UNKNOWN_PARAM_MODE`, a near-miss suggester, the message, and `guardUnknownParams`. The guard wraps the transport's `onmessage` and `send` after `connect`, once in the `/mcp` route and once in the stdio entry, and changes no tool handler. Accepted names come from the SDK's tool registry at call time (a private field, read-only). If a future SDK moves it, the guard passes everything through and the Layer 3 refusal tests fail, rather than refusing declared names.
- **Not done, deliberately:** `feedback_briefing_id` on the `/check` ride-along. URL-building agents close briefing feedback with `GET /feedback?briefing_id=…`, which works, so I didn't add a fourth `feedback_*` parameter to `/check` (stream F's file) and left it out. Intent-only rows can't ride along on `/check` either, because the ride-along triggers on `feedback_trace_id`/`feedback_search_id`. An end-of-session outcome row has no next check to ride on anyway. On MCP they can, and that's intended (the verifier's finding 4): a target-less `outcome` row riding on `check_recipe` or `search_recipes` inherits the carrying call's resolved intent through `withCheckDefaults`, which is always the caller's own, so it lands as an intent-only row.
- **Coordination:** stream A agreed the `verify_draft` split (S8a-V4). Stream E's `GET /feedback/rows` already treats a null `trace_id` as no recipe; E adds `briefingId` and the export column after D merges and adds no migration. Stream C's C1 adds one clause to "Closing the loop" naming the intent-only outcome row and declares the `feedback-loop.feature` scenario moved. Stream B was told its migration number will collide with `0041`.

**Soup.net checks** (`soupnet-oss`, intent `int_yK6rVcW8kQZY6VBqT0PtP9Y3`). Each was closed with a feedback row riding on the next check: `3e881f37` (briefing id from the `briefing.issued` row; precedent `9a9e1efe`), `831a11ea` (intent-only outcome rows, own-user ACL; `227e89cf`, `98b30eee`), `fc4d3038` (guard on the transport, names from the registry; `3dc8c00c`, and `10e3d7e1`/`4cfd166e` on leniency, carried into question 56), `6ec24dc2` (array ids), `218f055c` (author:me lead; `303e17cf`). Question 56 is deposited as draft `095ca91f`, since it awaits the operator's ruling. Streams A (`3f0e1bc1`) and E (`3bd3b3d7`) independently chose fail-closed refusal for their own unknown or wrong parameters today.

#### Questions for the operator (stream D)

56. **Ruled 2026-10-24: refuse.** The operator accepted the recommendation in the planning session ("Yes to your recommendations on both those 2 questions for stream D and E"). The planning session verified draft `095ca91f` with those words, and this stream read the answer there. `UNKNOWN_PARAM_MODE` stays `"refuse"`; the warn path stays built and tested, for the case named below. The question as asked:

    **Unknown parameter names: refuse or warn?** Both are built behind `UNKNOWN_PARAM_MODE` in `packages/domain/src/unknown-params.ts`, and the default is `"refuse"`. For the same call, `get_recipes` with `{ recipe_ids: <id>, recipe_id: <id> }`:
    - Refuse: nothing runs, and the result is a tool error (`isError: true`): `Error: get_recipes does not take recipe_id (did you mean recipe_ids?). Nothing was run; send it again with the names it takes: recipe_ids.`
    - Warn: the call runs as today, and the first content block is `Warning: get_recipes ignored recipe_id (did you mean recipe_ids?), which it does not take; the call ran without it. It takes: recipe_ids.`, followed by the normal answer ("Requested recipes — 1 of 1 resolved …").

    **Recommendation: refuse.** A name an agent sends is almost always one it meant to use, and ignoring it does harm without a sound. A check with a misspelled `recipe_book` deposits into the default book. A search with an ignored filter returns a wider set the agent reads as answering its question; the field case was exactly that, and so were streams A's and E's calls today. Refusal costs one retry, and the message names the fix. **Warn would be right if** a client in the field turns out to add its own keys to tool arguments as a matter of course. Then every call from it would fail under refuse, and warn (or refuse with a small allowlist for that client's keys) is the fix. Nothing seen so far does that. The counter-argument is the leniency principle for values (recipe `4cfd166e`: an unrecognized rating value never costs the check). It doesn't carry over to names: a bad rating value is a side field the agent can live without, while a bad name is usually the parameter the call depended on.

### Slice 8a verification record

Written 2026-10-24 by the verifier (agent `a-drafts-8a-verify-2026-10-24`, Soup.net intent `int_BvxusiyvV9FovyxW4BpqnXzo`), who did not build the slice and changed no application code. Verified at `8e60fe6` in the stream D worktree, against this worktree's backend on `127.0.0.1:3164` and its isolated postgres (compose project `soupnet-ci-5564`), with the `node_modules/@soupnet/*` links pointing at this worktree and the package `dist` rebuilt from it.

**Verdict: accept with follow-ups, none blocking.** Of the 22 rows, 18 pass, 3 are partial and 1 fails as written. The three partials are security-relevant rows whose property held under every probe, but whose committed regression test covers less than the rubric names (S8a-I4, S8a-U2, S8a-V3). The failure is the stdio byte share (S8a-Z1): 25 bytes over the 600 the rubric set for itself, with the cap held. No security property failed: every target the slice added is uniform to the byte between another user's id and an unknown one, and a refused call writes nothing on either server.

**How it was verified.**

- **Gate:** `TESTCI_PGPORT=5654 TESTCI_BACKEND_PORT=3297 npm run test:ci` exited 0, with 1,930 tests passed and 6 skipped (134 files passed, 2 skipped). Build, typecheck, lint (0 errors and the 5 existing warnings), the data-model check, the authz seam check and the golden-set ranking eval all passed. An earlier run on the derived backend port 3218 is void: another process held that port, the CI backend failed to bind (`EADDRINUSE`), and the tests reached whatever was listening there (they saw `get_recipes` refuse an array). The explicit backend port is the fix for that.
- **Slice suites** against the worktree backend: `tool-shapes.test.ts`, `unknown-params.test.ts`, `feedback.service.test.ts`, `recipe-lookup.service.test.ts`, `check-response-renderer.test.ts`, `mcp-server/src/server.test.ts`, `mcp-tools-list-size.test.ts`, `mcp-tool-descriptions.test.ts` and `recipe-guide-content.test.ts`: 9 files, 227 tests passed.
- **Independent probes:** two probe suites of the verifier's own, run from a temporary file under `apps/backend/src/routes/` and deleted afterwards, against the same backend. Cast: users A and B, each with a fresh daily key; A's published recipe; B's published recipe in B's personal book (unreadable to A); B's unverified draft. The stdio server was driven both in-process (`createStdioServer` over the SDK in-memory transport, with the live backend behind it) and as a live child process (`npx tsx apps/mcp-server/src/index.ts`, JSON-RPC over stdin, so the guard is the one the stdio entry installs).
- **Bytes** re-measured with the slice 1 method: `createMcpServer` with a stub principal and `createStdioServer`, each over the in-memory transport, `initialize` then `tools/list`, the reply's `result` as minified UTF-8 JSON. The baseline was not re-measured at `32ffa5c`: `git diff 0b044ef 32ffa5c` is empty for `routes/mcp.ts`, `mcp-server/src/server.ts` and `recipe-guide-content.ts`, so the slice 5 verifier's live figures (16,986 and 13,196) are the baseline.
- **Code review** of `d2d1b79..8e60fe6`.

**Item 4: `get_recipes` takes an array**

| # | Verdict | Evidence |
|---|---|---|
| S8a-I1 | pass | Suite: string and array forms give identical text. Probe: `"<id> <id>"` and `[<id>]` byte-identical on remote MCP. Stdio, live process: `[A, B]` and `"A,B"` gave identical text; in-process, the array and string calls gave identical replies. |
| S8a-I2 | pass | Layer 1 table in `recipe-lookup.service.test.ts` covers string, array, JSON-array text, mixed separators, duplicates, empty entries and non-string entries. Probe: `[ "<uuid>" , '<8-char prefix>' ]` as one string resolved "2 of 2". An id with `"x` inside it reached its marker with the stray characters echoed (`c131940f-a"x6-405f-…`). |
| S8a-I3 | pass | Suite: `GET /recipes` with a repeated `ids` and with JSON-array text, and `get_briefing` with an array. Probe: `GET /briefing?recipe_ids=` resolved a readable id as plain text, JSON-array text and comma pair, and MCP `get_briefing` resolved it as an array and as JSON-array text. `GET /briefing` reads only the first of a repeated `recipe_ids` (finding 6); the row does not ask for that form there. |
| S8a-I4 | partial | Property holds. For B's unverified draft and for B's published recipe in an unreadable book, each against a random UUID: remote `get_recipes` raw responses byte-identical after replacing the id, in array, JSON-array-text, plain-string and 8-character-prefix forms; `GET /recipes?ids=<x>&ids=<A's id>` identical in status and body (596 bytes each); the Requested recipes section identical on MCP `get_briefing` and `GET /briefing`. Cap after parsing: 21 array ids give "too many ids (21; max 20" (suite); 21 entries with one duplicate parse to 20 and are served ("0 of 20 resolved"); 21 repeated `ids` on REST are a 400. Partial because the committed uniform test covers only the published half of the RP pair the row names: it compares `traceB`, not another person's draft (finding 2). |

**Item 5: every failing field at once**

| # | Verdict | Evidence |
|---|---|---|
| S8a-V1 | pass | Layer 1: "names every failing field in one error, in schema order" asserts `6 fields need fixing: `, and "a single failing field gets exactly the one message" holds the old text. Probe: a row with bad `kind`, `impact`, `disposition`, empty `story` and `top_similarity: 3` got "5 fields need fixing: kind …; impact …; disposition …; story is required …; top_similarity …", in schema order, each enumeration with its allowed values and the value received. |
| S8a-V2 | pass | The same five-field text, verbatim, on remote `log_feedback`, the stdio `log_feedback` (relayed from the live backend), `POST /feedback` (400), `GET /feedback` (400), a ride-along row on `search_recipes` and on `check_recipe` (structured `feedbackResults` and the markdown "Feedback: 0/1" line), and `feedback_*` on `GET /check` (four fields, since that row sent no `top_similarity`). A row object with no target now reaches the service, which reports six fields including the target rule. |
| S8a-V3 | partial | Property holds, more strictly than the row asks: the remote and stdio `log_feedback` serve the same 17 property names with byte-identical property schemas, `trace_id`'s description included, and the same `required`. `story` begins "Required on every row."; `trace_id` states the one-target rule and the intent-only outcome row; each enumeration is in its field's description. Partial because no committed test compares the two served schemas and there is no snapshot of the descriptions: `server.test.ts` checks that the properties exist and `story`'s prefix, and `mcp-tools-list-size.test.ts` checks the remote names (finding 2). |
| S8a-V4 | pass | Pointer only. Neither server's `verify_draft` registration appears in the diff. |

**Item 6: `outcome` rows on `intent_id` alone, and an id from `get_briefing`**

| # | Verdict | Evidence |
|---|---|---|
| S8a-O1 | pass | Suite reads the row back with all three targets null and the intent set, on `log_feedback` and `POST /feedback`. Probe: in a `POST /feedback` batch `{"feedback":[…]}`, intent-only `outcome` rows were stored and an `operational` row with only `intent_id` was refused naming every target, "… and about a briefing, briefing_id; an outcome row may instead give intent_id alone". The stdio live process recorded an intent-only row ("Feedback recorded for intent int_…"). |
| S8a-O2 | pass | B sending A's intent and B sending an unknown well-formed `int_` id: remote `log_feedback` responses byte-identical (164 bytes each, "Feedback rejected: intent_id not found or not readable with this key"); `POST /feedback` single and batch both 400 with identical bodies once the echoed id is replaced; `GET /feedback` likewise; a ride-along row on `search_recipes` identical in structured `feedbackResults` and markdown. No row stored for A's intent. Median `POST /feedback` time 3.38 ms vs 3.47 ms over 8 tries each. A malformed `int_short` gets the shape error. With a trace target, `intent_id: "garbage"` stores null and the row is accepted (capture-only, as before). |
| S8a-O3 | pass | In one batch, a duplicate intent-only row returned the first row's `feedbackId` with `dup: true`; a later `POST` and then an MCP `log_feedback` of the same row both returned that same id as a duplicate. Three sent with two distinct notes stored two rows. |
| S8a-O4 | pass | Remote: the last line is "Briefing id: <uuid> — log_feedback accepts it as briefing_id, for feedback about this briefing." (suite), and that id is a `briefing.issued` audit row. Stdio live process: the same last line. `GET /briefing`: `data.briefingId` names a `briefing.issued` row with the caller as actor and `surface: rest`, and `data.text` has no id line. `POST /keys/briefing` (JWT): 200, no line and no `briefingId`. A failed audit write is by code review only: the insert is in a try/catch that logs and leaves `briefingId` unset, and both servers print the line only when an id came back. `writeAudit`'s columns and swallow-on-failure are reproduced exactly. |
| S8a-O5 | pass | A's `log_feedback` with `briefing_id` set to B's briefing, A's own search id, A's own `recipe.checked` audit id, and a random UUID: four byte-identical MCP responses (166 bytes each); `POST /feedback` and `GET /feedback` bodies identical across the four (400) once the echoed id is replaced. A malformed id gets a shape error. `briefing_id` with `trace_id`, or with `search_id`, is refused ("give exactly one of …, not two"). A's own briefing id in upper case is accepted, and the lower-case repeat is its duplicate. |
| S8a-O6 | pass | The live constraint is the one the rubric states (`pg_get_constraintdef`). Direct inserts: no target with `check-feedback` + intent, `operational` + intent, or `outcome` without an intent, and trace + briefing or search + briefing, each refused by `check_feedback_one_target`; `outcome` + intent alone, briefing alone, and trace + `outcome` + intent each accepted. Indexes: `check_feedback_briefing_dedup_unique (api_key_id, briefing_audit_id, content_hash)` and the partial `check_feedback_intent_dedup_unique … WHERE trace_id IS NULL AND search_audit_id IS NULL AND briefing_audit_id IS NULL`; the service's `ON CONFLICT` names the same predicate, and O3 shows Postgres infers it. Migration SQL: one column added, no `UPDATE`, the CHECK dropped and re-added. The new CHECK accepts every row the old one did (exactly one of trace and search), so `ADD CONSTRAINT`'s validation cannot reject a pre-migration row. `check:data-model` passed in the gate. |

**Item 7: the exclude-own message**

| # | Verdict | Evidence |
|---|---|---|
| S8a-E1 | pass | Suite: remote markdown line 2, the structured `ownExcludedQuery`, and the notice's first line, then the `author:me` query finds results. Probe: the stdio `search_recipes` (in-process, through `/check` with the surface header) shows the same lead directly under the header. A zero-result query that would not match the caller's own recipes either gets the lead too, which is what the row says ("the caller's own recipes in scope were excluded"). |
| S8a-E2 | pass | Code review: the lead and `ownExcludedQuery` appear only when `totalResults === 0` and `searchedOwnExcluded > 0`, and the markdown lead only when `results` is empty. Probe: `author:me "<run>"` with results has no lead. Suite: the web `/check` filter has no `ownExcludedQuery` and no `author:me` in its notice. |

**Unknown parameter names**

| # | Verdict | Evidence |
|---|---|---|
| S8a-U1 | pass | Code review: one constant, `UNKNOWN_PARAM_MODE = "refuse"`; `guardUnknownParams` is called once in the `/mcp` handler after `server.connect` and once in `apps/mcp-server/src/index.ts`; no tool handler changes. Names come from `_registeredTools[tool].inputSchema.shape` on each call. A zero-parameter tool is covered: `list_my_recipe_books` with `{foo: 1}` was refused with "send it again with no parameters (it takes none)". Tests: `toolParamsFromRegistry` reading names from a registry, and the Layer 3 case where `clusters` and `max_chars` pass on `check_recipe`. |
| S8a-U2 | partial | Property holds on both servers. Remote: a refused `check_recipe` (`recipe_boook`, with a ride-along feedback row) wrote nothing. A's traces stayed at 1, audit rows by action were unchanged (`briefing.issued` 14, `check.searched` 2, `recipe.checked` 1), feedback rows stayed at 7, and no trace has the refused text. Refused `search_recipes` (`limit`), `log_feedback` (`recipe_id`) and `get_briefing` (`verbose`, which registered no intent) wrote nothing either. Stdio live process: refused, no trace with the text, `recipe.checked` delta 0. Every message lists the unknown names, the accepted names, and a near miss where one exists. Partial on the committed evidence: the remote test counts `recipe.checked` rows but not traces, and the stdio test is an in-memory `get_recipes` call with a recorded fetch, not a Layer 3 `check_recipe` (finding 2). On stdio, `recipe_boook` suggests `recipe`, a name the call already sent (finding 3). |
| S8a-U3 | pass | Remote, in-process in warn mode: the first block is "Warning: search_recipes ignored limit, which it does not take; the call ran without it. It takes: …", `structuredContent` and the remaining blocks are identical to an unguarded server's. Stdio in-process in warn mode: the warning, then "Requested recipes — 1 of 1 resolved …". |
| S8a-U4 | pass (by the verifier's comparison) | The existing suites were not run in warn mode by the builder or by this verifier: switching modes needs a source edit. Instead, servers with no guard, refuse and warn were each driven in-process. `tools/list` and `initialize` were byte-identical, and so were `get_recipes`, `search_recipes`, `get_briefing` and `log_feedback` (after masking uuids and the per-run note). `list_my_recipe_books` differed only in its "N feedback rows" count, which the `log_feedback` calls changed between runs. Stdio `get_recipes` (both forms) and `log_feedback` were identical too. Code review agrees: the outbound wrapper alters a message only when a warning was stored for its id. Refuse mode is the deployed one, and the gate covers it. |
| S8a-U5 | pass | Both responses are under question 56, with the ruling (refuse) and its source. The refuse text in the question matches the asserted text in `tool-shapes.test.ts`. |

**Budgets**

| # | Verdict | Evidence |
|---|---|---|
| S8a-Z1 | fail (not met as written; not blocking) | Re-measured: remote **17,318** bytes (+332 of 700; `get_recipes` 979, `get_briefing` 1,436, `log_feedback` 3,306), stdio **13,821** (+625, **25 over the 600 share**; `log_feedback` 3,307), shared descriptions **6,110** characters (+59 of 200). Caps unchanged (`18_200`, `14_700`, `6600`), and the before and after figures are in `spec-decision-log.md`. The overage is the stdio `search_id` that S8a-V3's parity requires. The recommendation to accept it is deposited as draft `8c4d2991` for the operator. |
| S8a-Z2 | pass | `recipe-guide-content.test.ts` is not in the diff and passes. The id line is composed in `routes/mcp.ts` and `mcp-server/src/server.ts` after `composeBriefing` returns, outside `BRIEFING.build`. |

**Probes beyond the rubric, all behaving correctly.** A JSON-RPC batch on `/mcp` with one unknown-name call and one good call returned the refusal for the first and the normal answer for the second, in either order. Unknown names on a tool that does not exist pass through to the SDK's "Tool no_such_tool not found". A `tools/call` sent as a notification (no id) with an unknown name ran nothing (202, no trace). A string JSON-RPC id is echoed on the refusal. An own `__proto__` key in the arguments is refused as an unknown name. Non-object `arguments` (an array, or null) pass the guard and get the SDK's existing -32603 validation error.

**Findings, by severity** (none blocking)

1. **Low: the stdio share is 25 bytes over (S8a-Z1).** The bytes are the stdio `search_id` parity fix; the cap holds with 879 bytes left for streams A and B. Recommendation: accept the overage as recorded, with no cap change (draft `8c4d2991`, for the operator's ruling). **Ruled 2026-10-24: accepted** (draft `8c4d2991` verified: "Yes, approved."). The operator added that this call needed no draft: a recommendation with a clear reason and a small blast radius is an ordinary recipe check.
2. **Low: three security rows lack the committed regression test the rubric names.** S8a-I4 needs a case comparing another person's draft with a random UUID in array form. S8a-U2 needs a trace-count assertion beside the audit count, and a stdio `check_recipe` refusal through the live backend. S8a-V3 needs a test that compares the remote and stdio `log_feedback` served schemas, or snapshots them. Each property held under the verifier's probes; the gap is protection against regression.
3. **Low: a near miss can name a parameter the call already sent.** The stdio `check_recipe` has no `recipe_book`, so `recipe_boook` matches `recipe` by containment and the refusal reads "did you mean recipe?" next to a `recipe` the agent did send. Suggested fix: `nearMissParam` skips candidates already present in the call's arguments.
4. **Low: an MCP ride-along `outcome` row with no target becomes an intent-only row.** `withCheckDefaults` copies the carrying call's resolved intent into the row, so a target-less `outcome` row riding `search_recipes` with `intent` was stored against that intent ("Feedback: 1/1 row(s) recorded"). It is always the caller's own intent, so this is not an access problem. But the build notes say intent-only rows cannot ride along, which is true only of `/check`. Either note it as intended, or require the row's own `intent_id` before it can stand alone.
5. **Info, pre-existing, for the combined audit: capture-only `intent_id` is not owner-checked.** On a row with another target, B's row stored A's intent id, and the answer is the same as for an unknown id (so it is no oracle). Readers that group feedback by `intent_id` (stream E's `GET /feedback/rows`, any per-intent report) should scope rows by the row's own key or user, never by intent id alone.
6. **Info: `GET /briefing` reads only the first of a repeated `recipe_ids`** (`c.req.query`), while `GET /recipes` reads every `ids`. The row does not require the repeated form for the briefing; worth one line or one change for symmetry.
7. **Cosmetic: two displaced doc comments.** In `check-response-renderer.ts` the three new functions sit between `buildOwnExcludedNote`'s JSDoc and its function, so "Returns "" when no own-exclusion applied." now heads `renderBriefingIdLine`. In `mcp-server/src/server.ts`, `recipeIdsParam` and `joinRecipeIds` sit between `ratingParam`'s JSDoc and `ratingParam`.

**Security properties.** Array and JSON-array id forms change nothing about access. Another person's draft, and a published recipe in an unreadable book, read exactly like a random id in every form and on every surface. The cap counts ids after parsing (S8a-I4). The two new feedback targets are own-user with one marker each, byte-identical across another user's id, an id of another kind, and an unknown id, on MCP, `POST` and `GET` (S8a-O2, S8a-O5). The database refuses a target-less row unless it is an `outcome` row on an intent (S8a-O6). A refused call reaches no handler on either server and writes no trace, audit row, feedback row or intent (S8a-U2). The security audit is a separate role; its findings go to the private repo.

**Soup.net checks** (`soupnet-oss`, intent `int_BvxusiyvV9FovyxW4BpqnXzo`, agent `a-drafts-8a-verify-2026-10-24`): `b467c380` (a row may pass on a stated substitute method when its named one-off evidence run needs a source edit; applied to S8a-U4), `feaee11a` (a security row is partial when its property holds live but the committed test the rubric names is missing or half-covers it; applied to S8a-I4, S8a-U2 and S8a-V3, following `36875b03` and the slice 3 precedent `a6d7ae32`), and draft `8c4d2991` (accept the stdio overage, for the operator's ruling). Each check was closed by a feedback row: the first two on the next check, the draft with `log_feedback`.

### Slice 8a fix pass (stream D, 2026-10-24)

After the verification record and the read-only audit's hand-back (private repo, `d-8e60fe6`). Merged `origin/main` (`8879d35`, docs only) first.

- **Finding 2 (the regression tests the rubric names).**
  - S8a-I4: `tool-shapes.test.ts` now also compares another person's unverified draft with a random UUID in array form.
  - S8a-U2: the remote refusal counts traces beside `recipe.checked` rows. A new `scripts/mcp-surface-parity.test.mts` refuses a stdio `check_recipe` through the live backend and counts both. It lives outside both apps because each typechecks with `rootDir: src`, so neither can import the other.
  - S8a-V3: the same file compares the remote and stdio `log_feedback` served schemas.
- **Finding 3.** `nearMissParam` never suggests a name the call already sent. One consequence for question 56's examples: the demo call sent both `recipe_ids` and `recipe_id`, so both responses now lose "(did you mean recipe_ids?)". A call sending only `recipe_id` still gets it. The texts above stay as the operator saw them when ruling.
- **Finding 4** is intended; see the correction in the build notes above.
- **Finding 5** is for stream E. Its message of the same day says its listing scopes by the row's key belonging to the caller's user, or by `actor_user_id`, never by `intent_id` alone.
- **Finding 6.** `GET /briefing` reads every repeated `recipe_ids`.
- **Finding 7.** Moved the two displaced doc comments back to their functions, and one more of my own in `routes/mcp.ts`.
- **Audit F107 (P4).** The warn-mode map now clears a request's entry on any reply with its id, error replies included, and is bounded at `MAX_PENDING_WARNINGS` (256, oldest dropped). It has tests for the error-reply path and the bound.
- **Audit, can-wait 2.** `scripts/mcp-surface-parity.test.mts` asserts that `toolParamsFromRegistry` reads a non-empty parameter list for every tool on both servers, so an SDK upgrade that moves the private registry fails with that cause named.
- **Audit, can-wait 1** (the briefing should say that unknown names are refused) went to stream C. It doesn't fit C1 (thin briefing at 20,993 of 21,000), so C recorded it as a C2 candidate (S7-B7), dependent on C's own cap question.
- **Audit F106 (P2): the migration collision with stream B, for whoever merges second.** The operator's merge order puts this branch first, so `0041_check_feedback_briefing_and_intent_targets` keeps its number. Stream B's `0041_traces_intent_link` becomes `0042`. On B's branch after rebasing or merging `main`:
  1. Delete B's `0041_traces_intent_link.sql`, `meta/0041_snapshot.json`, and B's `idx: 41` entry in `meta/_journal.json`, keeping D's.
  2. Regenerate with `cd packages/db && npx drizzle-kit generate --name traces_intent_link && cd -`. drizzle-kit numbers it `0042` and writes `0042_snapshot.json` with `prevId` set to D's `0041` snapshot id. Don't hand-edit the journal.
  3. Run `npm run generate:data-model`, then `npm run check:data-model`.
  4. Run the migrations against an empty database (a fresh `TESTCI_PGPORT=<free port> npm run test:ci` does this).
  5. Say so in the PR. Main deploys to production on merge.

### Slice 8a: the exclude-own default reversed (stream D, 2026-10-24)

The operator reversed the MCP search's exclude-own default (recipe `885143c2`, superseding `303e17cf`). Stream E relayed it with the operator's words, and scheduling was left to him. Stream D built it as a separate commit on top of the verified work, so it can be dropped on its own (recipe `df594cda`).

- **Code.** `excludeOwnDefault: false` at the two callers: the remote `search_recipes`, and `/check` for the stdio surface header. `searchWithoutLogging`'s option and `excludesOwnByDefault` stay, inert. Stream B's `intent:` lifts them in its own branch, and its test S6a-Q4 still holds. The 8a author:me lead (`ownExcludedLead`, `ownExcludedQuery`, the notice's filter argument) is removed. `trace.service.ts` is back to byte-identical with `main`, and so is its seam fingerprint.
- **Copy.** `searchRecipes` and the last clause of `searchQuery` (agreed with stream B, which keeps its `intent:` term on rebase). C1 rewrote the briefing's "Search vs check" paragraph (stream C, `a9fc1a6`). This PR also corrects `CLAUDE.md` §Recipe Checks, `docs/architecture/search-algorithms.md`, and two comments in `drafts-and-triage.feature`.
- **One consequence the ruling didn't name.** The old default kept a person's own unverified drafts out of a default search, because it kept all of their own recipes out. With the flip they appear under their draft label ("unverified draft … a hypothesis the person has not confirmed"), exactly as check results already show them. I chose that over a new rule hiding own drafts from search (recipe `7d034cb2`): search and check then agree, and slice 8b's "own open drafts set apart" (revision doc, slice 8 item 8) serves both with one display change. The tests that asserted the old behaviour now assert this (S2-B4, S4-V1, S3-G1, S3-G3), each with `-author:me` as the way to leave own recipes out.
- **Bytes:** +1 on each surface for the reworded descriptions. Remote 17,319, stdio 13,822, shared descriptions 6,111. `searchRecipes` is 419 characters (cap 420), `searchQuery` 396.
- **Gate, final branch** (`2293f26`, with `main` merged): `TESTCI_PGPORT=5644 TESTCI_BACKEND_PORT=3288 npm run test:ci` exited 0 on a fresh database, with 1,934 tests passed and 6 skipped (135 files, 2 skipped). The data-model check, the authz seam, typecheck and lint passed (0 errors). Four earlier runs of the same tree ended red with only "Worker exited unexpectedly" and every reported test passing. That is the known native worker crash (backlog item, `docs/testing-plan.md` "Reading a red gate"): the JSON reporter showed `drafts-on-behalf.test.ts`'s account-deletion block as pending, and the file passes 40 of 40 alone. Streams B and E saw the same today while several gates ran at once. The green run was the first with nothing else running.
- **After #137 (6c) merged** (`09ed2c8`, `main` merged in): the stdio server and its test conflicted only in their `@soupnet/domain` import lists. Both sides were kept, so A's `outcome` on the stdio `verify_draft` and 8a's matching stdio `log_feedback` both stand. Combined bytes, A's growth plus 8a's: remote 17,630 of 18,200, stdio 14,133 of 14,700 (567 left for B), shared descriptions 6,376 of 6,600. `TESTCI_PGPORT=5644 TESTCI_BACKEND_PORT=3288 npm run test:ci` exited 0 on the first run with 1,967 passed and 6 skipped (136 files, 2 skipped). The data-model check and the authz seam passed with the fingerprints unchanged.
- **Seam against `main`:** `scripts/check-authz-seam.mjs` differs from `main` only in the `feedback.service.ts` entry (19 to 26 lines, refreshed). `trace.service.ts` is byte-identical to `main`, so whoever merges after D refreshes only their own entries.
- **Backlog:** the "`POST /feedback` validates one error per request" bullet is struck through as done.

#### Questions for the operator (stream D), continued

57. **Ruled 2026-10-24: in 8a, with a person's own unverified drafts shown in a default search under their draft label.** The planning session verified draft `5e9fdf61` with the operator's words ("Yes to all three, confirm the drafts"), and this stream read the answer there. The question as asked: **Ship the exclude-own reversal in 8a, or split it out?** Recommendation: in 8a, as built (a separate commit, `git revert`-able). 8a's item 7 was a recovery line for exactly this default, so shipping 8a without the flip would put copy into every zero-result search explaining a default you've already undone. The flip is two booleans and some copy. A separate PR would make sense if you want the own-drafts consequence above reviewed on its own, in which case drop the flip commit and 8a ships with the author:me lead instead (the commit before it has it). **Alternative inside the flip:** keep a person's own unverified drafts out of a default search (shown only under `is:draft` or an `author:` qualifier). That needs a new condition in `authz/draft-sql.ts`'s fragments. I'd build it only if a field agent reads its own draft as support in search before slice 8b lands.

### Slice 9 rubric: read paths for reports (stream E)

Written 2026-10-24 by agent `a-drafts-9-2026-10-24` (stream E), before implementation, from the revision doc's slice 9, rulings 54 and 55, its "No read path for feedback rows or intents" finding, and the code at `32ffa5c`. Consumer: scripts and agents outside a session writing reports on the person's own fleet (REST, Bearer key), and the person on the web (the detail page's feedback rows and a new intent page). Security-relevant: yes. The slice opens two new read scopes over data that had none (intents, and feedback rows across recipes), so the uniform not-found and the scope rows below are the core of it, and the combined audit after A1, B, D and E covers it.

Settled before this rubric (not reopened here): the caller's user's rows only (ruling 54); no MCP tool (ruling 54's slice text, "Not an MCP tool, at first"); the existing trail plus this listing is how agent-made resolutions are found, no new column for that (ruling 55); deposits per intent read `traces.intent_id` once stream B's 6a lands and are 0 before (implementation plan, stream E).

**Calls this stream made, so the verifier tests these and not alternatives** (each recipe-checked as the session goes; see the build notes):

- Paths: `GET /intents`, `GET /intents/:id`, `GET /feedback/rows`. Bearer key only; `?key=` is not accepted on these paths (a read path's key does not belong in a URL that lands in logs). The bare `GET /feedback` stays the URL-built write form, byte-for-byte.
- Whose rows: an intent is the caller's user's when `intents.user_id` is that user. A feedback row is the caller's user's when its key belongs to that user today, or it is a human-origin row whose `actor_user_id` is that user. The ownership condition is one fragment in `apps/backend/src/authz/` so that a later change of attribution (open question 56) is a one-place change.
- Scope inside the user: intents are per user, not per book, so every key of the user lists all of the user's intents. Anything that names a recipe (a feedback row about a recipe, a shown id, a deposit, a related id) is listed only when the presenting key may read that recipe now: its book is in the key's effective read scope and the draft read rule (`traceReadableById`) passes. A feedback row about a read-only search names no recipe and is listed for every key of the user. Open question 57 asks whether intents should narrow by key scope too.
- Paging: `page` (1-based, default 1) and `per_page` (default 50, maximum 200); every list answers `total`, `page`, `perPage`, `totalPages`. Lists are newest first; an intent's lineage is oldest first ("in time order").
- Strict parameters: an unknown parameter name, or a value that does not parse, is a 400 that names every failing parameter at once (the 8.5 rule applied to new REST from the start; a mistyped filter must never silently widen a report).
- `since` is an ISO 8601 instant (or a date), inclusive: rows with `created_at >= since`. A sweep that stores the newest `createdAt` it saw and passes it back sees that row again rather than missing a row created in the same millisecond.

**Intents**

| # | Criterion | Evidence |
|---|---|---|
| S9-I1 | `GET /intents` lists the caller's user's intents, newest first by `created_at` (id as tie-break), paged. Each item: `id`, `story`, `agentId`, `apiKeyLabel` (null when the registering key is gone), `createdAt`, `lastUsedAt`, and `counts` of `shown`, `deposits`, `feedback`, each counted under the same visibility rules as the lineage (S9-S2). | Layer 3: two users, each with intents registered through `get_briefing` and `/check`; each lists exactly its own, in order, with counts that match the detail. |
| S9-I2 | `GET /intents/:id` returns the same summary plus `lineage`: one list, oldest first, of entries `{ type: "shown", traceId, at }`, `{ type: "deposit", traceId, at, draftState }` and `{ type: "feedback", at, feedback: <row as in S9-F2> }`, paged by `page`/`per_page`. | Layer 3: an intent with a check that showed recipes, a feedback row carrying it, and (after 6a) a deposit under it; lineage order and content asserted. |
| S9-I3 | Uniform not-found: another user's intent id, a well-formed id that never existed, and a malformed id each answer 404 with a byte-identical body (`{"ok":false,"error":"Intent not found"}`), and none of them touches `intents.last_used_at`. The listing never contains another user's intent. | Layer 3 pair test over the three ids, comparing status and body; `last_used_at` read back unchanged. |
| S9-I4 | Before 6a's column exists, `deposits` is 0 and the lineage has no deposit entries; once it exists, deposits are the traces whose `intent_id` is this intent, under S9-S2. | Layer 3 on the merged branch (rebased onto 6a); before that, the test asserts 0. |

**Feedback rows**

| # | Criterion | Evidence |
|---|---|---|
| S9-F1 | `GET /feedback/rows` lists the caller's user's feedback rows (S9 calls, "Whose rows"), newest first, paged, with the filters `intent_id`, `trace_id` (alias `recipe_id`), `search_id`, `agent_id` (exact match), `since`, `recipe_book` (slug or id, resolved among the key's readable books). Filters compose with AND. | Layer 3: rows from two keys of one user (a scoped key and a daily key) and from another user, about recipes, about a search, and a human re-filing row; each filter alone and two combined. |
| S9-F2 | Each row has the fields the per-recipe route (`GET /traces/:id/feedback`) gives, plus `traceId` and `searchId`: `id`, `traceId`, `searchId`, `agentId`, `kind`, `impact`, `disposition`, `storyFulfilled`, `story`, `note`, `topSimilarity`, `model`, `harness`, `harnessVersion`, `relatedTraceIds`, `sessionId`, `intentId`, `createdAt`, `apiKeyLabel`, `actorUserId`, `actorEmail`, `starCount`, `starredByMe`. | Layer 3 parity: one row read through both routes; the per-recipe row's keys are a subset of the listing row's, values equal. |
| S9-F3 | Foreign filters give the empty page, never an error that differs: another user's intent id, another user's search id, a recipe the key cannot read, and a book the key cannot read each answer 200 with `total: 0`, the same as an id that never existed. | Layer 3 pair test. |
| S9-F4 | `GET /feedback` (the write form) and `POST /feedback` are unchanged: their existing tests pass unedited. | `feedback.test.ts` unchanged and green. |

**Scope and the read rule**

| # | Criterion | Evidence |
|---|---|---|
| S9-S1 | Authentication: no `Authorization: Bearer` header, a bad key, and an expired key are 401 on all three paths; a JWT is not accepted. | Layer 3. |
| S9-S2 | A recipe id appears only when the presenting key may read the recipe now: a feedback row about a recipe outside the key's books is not listed (and not counted); a shown id or deposit in such a book, or a collaborator's hidden draft, is dropped from the lineage and from the counts; `relatedTraceIds` is filtered the same way ([F82]'s render rule, with the key's scope). | Layer 3: Pat's scoped key K1 (book A only) and K2 (books A and B); a row about a B recipe is in K2's listing and not K1's; a lineage entry for Sam's hidden draft id is absent. |
| S9-S3 | Headless keys read these paths exactly as ordinary keys of the same books (S5-W5's rule). | Layer 3: H and K give equal answers. |
| S9-S4 | The seam holds: the ownership condition lives in `apps/backend/src/authz/`; every new read of `claimnet.traces` composes the draft fragments and is registered in `TRACE_READS`; any `claimnet.api_keys` SQL outside the module is a display-only label join registered in `NON_AUTHORIZING_KEY_SQL`. | `npm run check:authz-seam` diff. |
| S9-S5 | The paths are rate-limited like `/recipes` (per IP and per hashed key) and write no audit rows (reads, like `/recipes`). | Code review; the limiter is the shared middleware. |

**Parameters**

| # | Criterion | Evidence |
|---|---|---|
| S9-P1 | An unknown parameter (including `key`) or an unparseable value (`per_page=0`, `per_page=201`, `page=0`, `since=yesterday`, `trace_id=abc`, `intent_id=int_short`) is 400, and the error names every failing parameter in one message. | Layer 1 table test of the parser; Layer 3 sample. |

**Web**

| # | Criterion | Evidence |
|---|---|---|
| S9-W1 | On the recipe detail page, a feedback row that carries an intent id shows it (short form, full id in the title), linked to `/app/intents/<id>`. Rows without one look as they do today. | Frontend unit test; browser verification. |
| S9-W2 | `/app/intents/<id>` shows the intent's story, agent, key label, dates, counts, and its lineage in time order, with recipe ids linked to their detail pages and feedback rows rendered as on the detail page. Its data comes from a JWT route (`GET /me/intents/:id`) over the same service, with the person's read rule (`traceReadableByPerson`) in place of the key's scope. Another person's intent, a missing one, and a malformed id give the same "Intent not found" page. | Layer 3 on the JWT route (the uniform pair); browser verification. |

**Export**

| # | Criterion | Evidence |
|---|---|---|
| S9-E1 | `GET /auth/me/export` gains `intents` (id, story, agentId, apiKeyId, createdAt, lastUsedAt) and `checkFeedback` (the caller's user's rows by S9's ownership rule, every stored column but `content_hash`). `schemaVersion` stays 1 (additive). The delivery ledger (`intent_shown`) is system-derived and stays out, by the export's own rule. | Layer 3: the export of a user with intents and feedback holds exactly their own; another user's rows absent. |
| S9-E2 | Import accepts an export carrying the two new arrays and ignores them (restoring them is not in this slice). | Layer 3: round-trip of a fresh export through `POST /import`. |

**Budget and surfaces**

| # | Criterion | Evidence |
|---|---|---|
| S9-Z1 | No MCP tool is added and no tool description changes: remote and stdio `tools/list` and the shared descriptions measure the same before and after. | The size tests' figures, recorded in the build notes. |
| S9-Z2 | The two response shapes are documented where report writers look: `docs/api/reports.md`, linked from the backend's route list in CLAUDE.md. | Review. |

### Slice 9 build notes (stream E, agent `a-drafts-9-2026-10-24`, 2026-10-24)

Branch `drafts/9-read-paths`, from the A0 commit. Intent `int_vc465vtmHo1AwpjPBGwQ3lSS`. Soup.net was unreachable for the first part of the session (an expired key in the MCP configuration); the rubric was written before the checks and the checks below were made once the key was replaced, before any code they rest on was committed.

**What was built**

- `apps/backend/src/authz/report-scope.ts`: `feedbackOwnedBy(userId)` (the row's key belongs to the user today, or the row is a human-origin row of theirs) and `traceReadableByViewer(viewer)` (a key: its books and `traceReadableById`; a person: `traceReadableByPerson`). The `claimnet.api_keys` subquery that attributes a row lives here, inside the seam.
- `apps/backend/src/services/report-params.ts`: the strict parser. 30 Layer 1 tests cover every branch (S9-P1).
- `apps/backend/src/services/intent-read.service.ts`: `listIntents`, `getIntent` (summary plus one page of a single timeline, ordered and paged in SQL), `listFeedbackRows`. Counts and lineage use the same conditions, so they agree by construction.
- Routes: `routes/intents.ts` (mounted at `/intents`), `GET /feedback/rows` added above the write form in `routes/feedback.ts`, `GET /me/intents/:id` in `routes/me.ts` for the web.
- Export: `intents` and `checkFeedback` in `GET /auth/me/export`, `schemaVersion` 1. Import already ignored unknown top-level keys; the integration test round-trips a fresh export.
- Web: the feedback card moved to `components/FeedbackCard.tsx` (shared by the detail page and the intent page; a row about a search shows no star), the intent id rendered and linked on it, `pages/IntentPage.tsx` at `/app/intents/$intentId`.
- Seam register: `traceReadableByViewer` added to the guard's fragment lists (it composes `traceReadableById` and `traceReadableByPerson`), the service registered in `TRACE_READS` as composing, its two key-label joins in `NON_AUTHORIZING_KEY_SQL`, and `routes/auth.ts` re-fingerprinted for the export's feedback query.
- `docs/api/reports.md`, and the CLAUDE.md route list.

**Verification by the builder** (the separate verifier's record goes below): `report-read-paths.test.ts`, 18 Layer 3 tests over the rubric rows, against a worktree backend on a throwaway database. The suite was then run against a mutated backend with the ownership condition and the key-scope condition each replaced by `TRUE`: 8 of the 18 failed (S9-I1, S9-I2, S9-F1, S9-F3, S9-S2, S9-E1), so the scope rows are load-bearing. The neighbouring suites (feedback, intents, import, traces-feedback, auth, auth-delete, authz) pass unchanged: 286 tests. The MCP size tests pass with no change to any tool or description (S9-Z1); no file under `apps/mcp-server`, `packages/`, or `routes/mcp.ts` changed.

**Recipe checks** (soupnet-oss, under the intent): the key-scope rule for recipe-naming rows with intents per user (`389cce42`; the corpus returned the ruling's own recipe `6680321b` and the principal-scope design `c46002d0`, both consistent); strict parameters (`3bd3b3d7`; consistent with stream D's dispatch guard `fc4d3038`); attribution through the writing key (`e2f021a3`, rated high uncertainty, which is open question 56); Bearer only on read paths (`6f80d407`; the `/keys/briefing` move `58d3741d` and its hardening recipe `f1543441` keep keys out of URLs for the same reason).

**Decided here, affecting other streams**

- Stream B: the intent page is `/app/intents/$intentId`. B's queue heading links to the queue filter (`/app/drafts?q=intent:<id>`) for now; when E rebases onto 6a, E adds the intent page link beside it in `DraftQueuePage.tsx` (agreed with stream B by message).
- Stream B's `traces.intent_id` (migration 0041 on `drafts/6a-intent-link`): deposits per intent are traces with that intent id, under the same read rule as everything else that names a recipe. A verified on-behalf recipe keeps its depositor's intent id; the depositor's report counts it only while the presenting key can read it. Built on a sub-branch against B's commit and folded in after 6a merges (S9-I4).

**Questions for the operator**

56. **Attributing a feedback row to its user.** `check_feedback` has no user column; a row is the user's through its key (`api_key_id`, no FK), the same join account deletion uses. When a key is deleted (revoked on the keys page, or an OAuth key swept 30 days after it expired), its rows stop belonging to anyone and drop out of the report, so a report of connector-driven sessions undercounts after a month. Recommendation: a follow-up PR after slice 9 adds `check_feedback.user_id`, stamped at write and backfilled from the keys that still exist, and `feedbackOwnedBy` changes to read it (one fragment). It is the smallest change that keeps reports complete, and slice 9 is built so that nothing else moves. The alternative, keeping the key join, is right if reports are meant to describe only what current keys did. Not built here because it adds a second migration beside stream B's in the same merge window and touches `feedback.service.ts`, which is stream D's file. The recommendation waited as draft `7d31011e` in soupnet-oss. **Ruled 2026-10-24: yes** (the operator's answer to the planning session, which verified the draft with it): keep the key join in slice 9 and add the stamped column as a follow-up after slice 9, now a backlog item ("Stamp the user on every feedback row").
57. **Should a scoped key list every intent of its user?** Built: yes. Intents carry no recipe book; the story is the person's own agents' text; and a report key is usually a person's own script. Everything an intent names (shown recipes, deposits, feedback about recipes) is narrowed to the key's books. Recommendation: keep it. The alternative, listing only intents registered by keys that share a book with the presenting key, becomes right when a key can act for someone other than its owner, which is the organization-accounts question and can be revisited there. The recommendation waited as draft `0272fdee`. **Ruled 2026-10-24: yes** (the operator's answer to the planning session, which verified the draft with it): as built, no change.

### Slice 9 verification record (verifier agent `a-drafts-9-verify-2026-10-24`, 2026-10-24)

Verified at `38f189e` on `drafts/9-read-paths`, against the worktree backend on port 3171 and its throwaway database (stub embeddings, rate limits disabled). The verifier did not build the slice. Evidence is of three kinds: the branch's suites (`report-read-paths.test.ts` 18 and `report-params.test.ts` 30, all pass; neighbouring suites `feedback`, `intents`, `import`, `traces-feedback`, `auth`, the `authz` directory, the MCP size and description tests, `apps/mcp-server` `server.test.ts` and `intent-link.test.ts`: 20 files, 283 pass, 1 skipped); a probe script of the verifier's own (142 assertions over three users, six keys of Pat's including a daily and a headless key, two shared books, and a membership removal; 139 pass, the 3 misses listed under "Found beyond the rubric"); and code review. The probe registers intents through `get_briefing` and through `/check`, fills `intent_shown` with real checks, and adds a direct `intent_shown` row only for the cases a check cannot produce (a collaborator's hidden draft).

| # | Verdict | Finding | Evidence |
|---|---|---|---|
| S9-I1 | PASS | Each of three users lists exactly their own intents, newest first, with the rubric's fields, and every key's counts equal its own lineage. | Probe: Pat (one intent through `get_briefing`, one through `/check`), Olive and Sam each list only their own, `total` equal to the items; the `/check` intent lists first with `apiKeyLabel` `k2-ab`; item keys exactly `id, story, agentId, apiKeyLabel, createdAt, lastUsedAt, counts`; counts equal the detail's lineage for K1, K2, K3, H and the daily key. Test "S9-I1: lists the caller's user's intents only". |
| S9-I2 | PASS | The detail returns the summary plus one oldest-first timeline of shown and feedback entries, paged, with `total` equal to the counts' sum. | Probe: lineage `at` sorted ascending for five keys; `total` = shown + feedback for each. Tests "S9-I2/S9-I4: the lineage is oldest first", "S9-I2: the lineage pages". |
| S9-I3 | PASS | Another user's intent, a never-existing id, and malformed ids all answer 404 with the byte-identical body, and reads leave `last_used_at` untouched. | Probe: nine ids (Olive's, Sam's, `int_ZZZZZZZZZZZZZZZZZZZZZZZZ`, `int_short`, Pat's own id with its case flipped, `' OR 1=1--`, a 504-character id, Pat's id plus an encoded space) each `404 {"ok":false,"error":"Intent not found"}`; Pat's and Olive's `last_used_at` identical before and after `GET /intents`, `GET /intents/:id`, `GET /feedback/rows?intent_id=` and `GET /me/intents/:id`. `intent-read.service.ts:305` and `:308`. |
| S9-I4 | PARTIAL | The before-6a half holds (deposits 0, no deposit entries); the after-6a half is reviewed but not run. | Probe: `deposits` 0 for every key and intent. Commit `8920565` on `drafts/9-read-paths-on-6a` (reviewed with `git show`): `depositsFrom` reads `t.intent_id` under `traceReadableByViewer`, counts and lineage share it, `draftStateShownTo` supplies `draftState`, the seam entry is re-fingerprinted (`n: 11`), and a new Layer 3 case asserts K2 sees 3 deposits and K1 2 with draft states `[null, null, "unverified"]`. To be re-verified when the branch rebases onto 6a. |
| S9-F1 | PASS | The listing holds the user's rows from every key of theirs (scoped, daily, headless) and the human re-filing row, newest first, and each filter alone and combined narrows it as stated. | Probe: K3 lists rows from K1, K2, K3 and the daily key and none of Sam's or Olive's; `agent_id` is exact (a prefix matches nothing); `recipe_book` by slug resolves Q for K3; `intent_id`+`recipe_book` and `search_id`+`intent_id` combine. Tests "S9-F1: …" (four cases). |
| S9-F2 | PASS | A row read through `GET /traces/:id/feedback` and through the listing has the same keys and values when the key reads the person's books, and the listing's keys are exactly the rubric's list. | Probe: the row about Sam's book-B recipe compared through K3 (books A, B, Q, the same as Pat's): no differences. Through K2 (no Q), `relatedTraceIds` drops the Q id, as S9-S2 requires (see finding 3). Test "S9-F2". |
| S9-F3 | PASS | Every foreign or unknown filter answers 200 with the same empty page, byte for byte. | Probe: 13 filters (Olive's and Sam's intents, a never intent, Olive's search, a never search, a book-B recipe through K1, Sam's hidden draft, Olive's recipe, a never recipe, book B by slug and by id through K1, Olive's book, a never book) all `{"ok":true,"data":{"items":[],"total":0,"page":1,"perPage":50,"totalPages":0}}`. |
| S9-F4 | PASS | The write forms are unchanged and their tests pass unedited. | `git diff 32ffa5c..38f189e -- apps/backend/src/routes/feedback.test.ts` is empty; `feedback.test.ts` green; the diff to `routes/feedback.ts` only adds `GET /rows` above the bare `GET`. |
| S9-S1 | PASS | Missing, malformed, expired, revoked and JWT credentials are 401 on all three paths. | Probe, each path: no header, an expired key (its `expires_at` set in the past in the throwaway database), a revoked key, Pat's JWT, `Bearer ` empty, `Basic <key>`, `X-API-Key: <key>`, and `?key=<valid key>` with no header: all 401. Test "S9-S1". |
| S9-S2 | PASS | Every recipe id a report names follows the presenting key's books and the draft rule, and leaving a book removes its ids at once. | Probe: K1 (book A) sees no B or Q id; K2 and H see B but not Q; K3 sees Q; no key and not `/me` ever shows Sam's hidden draft or Sam's row carrying Pat's intent; Pat's own draft in B shows for K2. After Sam removes Pat from Q, K3 and `/me` lose the Q shown id, the Q feedback row (count 5 to 4) and the Q id in `relatedTraceIds`. Test "S9-S2". |
| S9-S3 | PASS | A headless key's answers equal an ordinary key's of the same books on all three paths. | Probe: H and K2 byte-identical on `/intents`, `/intents/:id` and `/feedback/rows`. Test "S9-S3" (two of the three paths). |
| S9-S4 | PASS | The guard holds and does what this row claims of it; it does not cover the ownership conditions (finding 1). | `npm run check:authz-seam`: "authz seam holds … recipes are read only by the 30 registered files (9 composing the draft condition)". `feedbackOwnedBy` is in `authz/report-scope.ts`; the service's two key-label joins are in `NON_AUTHORIZING_KEY_SQL`; `TRACE_READS` registers the service as composing. Plants in a scratch copy of `38f189e`: removing `traceReadableByViewer` from the shown read, the feedback visibility, or the related-ids filter each fails the guard. |
| S9-S5 | PASS | The paths use the shared limiter at `/recipes`' settings and write no audit row. | Code review: `routes/intents.ts:32-39` (1000 per hour per IP, 600 per hour per hashed Bearer, the `/recipes` figures), applied at `intents.ts:63`, `:72` and `feedback.ts:227`; no audit call in the routes, the service or `report-scope.ts`. Probe: Pat's audit actions over the run are only those of setup (`briefing.issued`, `check.searched`, `recipe.checked`, `corpus.imported`). Limits not exercised live (disabled on this backend). |
| S9-P1 | PASS | Every named bad value, and the further cases probed, is one 400 naming each failing parameter. | Probe: `per_page=0`, `201`, `1e2`; `page=0`, `-1`, `1.5`, `100001`; `since=yesterday`, empty, and a time with no offset; `trace_id=abc`; `intent_id=int_short`; `agent_id=` empty; `PAGE=1`; `format=json`; a repeated `page`; `trace_id` and `recipe_id` together; `recipe_id` and `since` on `/intents`; `trace_id` on `/intents/:id`; `key` with a header present; and one query with seven faults naming all seven. Accepted as intended: a date, `…T09:30Z`, `+05:30`, nine fractional digits. Test "S9-P1" and `report-params.test.ts`. See finding 2 for `since=2026-02-30`. |
| S9-W1 | PASS (code) | The feedback card links a carried intent id in its short form with the full id as the title, and rows without one render as before. | Code review: `FeedbackCard.tsx:107` renders the link only when `row.intentId` is set; the card's other markup moved verbatim from `TraceDetailPage.tsx`. `intent-link.test.ts` covers the short form only. The browser half is with the browser verifier. |
| S9-W2 | PASS (route) | `GET /me/intents/:id` reads by the person's rule with the uniform 404, and the page renders story, agent, key label, dates, counts and the linked lineage. | Probe: Olive's, Sam's, an unknown, a malformed and a 304-character id each byte-identical 404; the person sees Sam's published B recipe and Pat's own draft and not Sam's hidden draft; an API key on the route is 401; `?bogus=1` is 400. Test "S9-W2". Code review of `IntentPage.tsx`. The browser half is with the browser verifier. |
| S9-E1 | PASS | Each user's export holds their own intents and rows only, with the stated columns, `schemaVersion` 1 and no delivery ledger. | Probe with Pat, Sam and Olive all present: Pat's export has both his intents and his five rows, including the Q row after he left Q, and not Sam's row that carries Pat's intent id; that row is in Sam's export; Olive's has her one intent and one row. `checkFeedback` keys are every column but `content_hash`; `intents` keys are the six named. Test "S9-E1/S9-E2". |
| S9-E2 | PASS | A fresh export imports, and the two new arrays restore nothing. | Probe: Pat's fresh export posted to `POST /import` in his own account: 200; his intent and row counts unchanged afterwards. The test imports into another account. |
| S9-Z1 | PASS | No tool or description changed. | `git diff --stat 32ffa5c..38f189e -- apps/mcp-server packages apps/backend/src/routes/mcp.ts` and the size and description tests is empty; `mcp-tools-list-size.test.ts`, `mcp-tool-descriptions.test.ts` and `apps/mcp-server` `server.test.ts` pass. The build notes say "pass" but record no figures (finding 11). |
| S9-Z2 | PASS | The shapes are documented and linked where report writers look. | `docs/api/reports.md` matches the probed responses (paging block, item keys, the 400 body with `fields`, the 404 body); the CLAUDE.md `/intents` bullet links it. |

No probe showed one user's data to another or a key reading outside its books.

**Found beyond the rubric**

1. Medium. The seam guard does not cover the ownership conditions. In a scratch copy, deleting `feedbackOwnedBy` from `feedbackVisible`, or `i.user_id = …` from `getIntent`, leaves `check:authz-seam` passing. Only the Layer 3 cases S9-F1 and S9-I3 would catch either. The intent condition is also written inline (`intent-read.service.ts:286`, `:308`, and the export in `routes/auth.ts`), not as a fragment in `authz/`. S9-S4 does not ask the guard to cover ownership, so the row passes; the operator's principle that security be "by design, not by remembering to check all the things in each code file" (recipe `27dcafed`) argues for a follow-up: an intent-ownership fragment beside `feedbackOwnedBy`, and fingerprinting of both fragments' call lines.
2. Low. `since` accepts calendar-invalid dates: `2026-02-30` is read as 2026-03-02 and `2026-04-31` as 2026-05-01 (`report-params.ts:124`, `new Date` rolls over). The window narrows silently by a day or two rather than answering 400.
3. Low (rubric wording). S9-F2's "values equal" holds only when the key reads the same books as the person. A narrower key returns fewer `relatedTraceIds`, which S9-S2 requires. The test passes because it uses a key covering both books.
4. Low (web). `useIntent` (`useIntent.ts:43`) maps every non-OK answer, an expired session (401), a 400 or a 500 included, to "Intent not found". `IntentPage` keeps its page number when the route moves to another intent.
5. Low (web). The detail page links every intent id on a row, including a collaborator's agent's, and such a link always opens "Intent not found" for the viewer. This matches S9-W1 as written, but it may read as a broken link.
6. Info. `GET /intents/` (a trailing slash, no id) gets the router's plain-text `404 Not Found`, not the JSON body. No id is involved, so no one can learn anything from the difference.
7. Info. A `recipe_book` slug that two of the key's books share across organizations resolves by `LIMIT 1` with no order (`intent-read.service.ts:183`, the same pattern as `trace.service.ts`'s book resolution). The answer stays within the key's books.
8. Info. `per_page=+5` is accepted as 5: `+` decodes to a space and values are trimmed.
9. Info, confirmed live (open question 56). Revoking K1 removes its rows from every other key's listing, from counts, and from the export.
10. Info. `docs/api/reports.md` documents deposit entries and counts, which are always 0 on this branch until it folds in 6a.
11. Info. S9-Z1's evidence column asks for the size tests' figures in the build notes; the notes record only that the tests pass.
12. Info. The Layer 3 suite registers intents only through `get_briefing`, and the probe covered `/check` registration. It sets no expired key, which the probe covered. It also compares H and K on two of the three paths, and the probe compared all three.

**Not verified, and why**

- Rate limits live: the backend runs with `DISABLE_RATE_LIMIT=true`, so S9-S5 rests on code review.
- S9-I4 after 6a: commit `8920565` is not checked out here, and the worktree stays on the stream branch while the browser verifier uses it.
- S9-W1 and S9-W2 rendering: these are left to the browser verifier.
- `tools/list` byte figures: not measured. No MCP-surface file changed since A0, and the size tests pass.

**Recipe checks** (soupnet-oss, intent `int_3nzMq7XyK4AjTqErhlyuPDYn`): row verdicts follow the rubric's named cases, with adjacent defects listed as findings (`8f55a8d7`; consistent with `d1d07fcc` and the slice 3 record); the seam row passes on its stated claims, with the ownership gap as a separate follow-up (`e0880609`; `36875b03` leans toward partial where a rubric itself claims the guard, so that call is escalated to the operator with finding 1).

### Slice 9 fix pass (stream E, 2026-10-24)

On the verification record above and the browser run (`tests/e2e/pr-slice9.spec.ts`, 10 of 10 on desktop and mobile, expectations E1 to E9 met, E6 recorded):

- **Finding 1 (the guard did not cover ownership), and the verifier's escalation on S9-S4.** Settled by fixing the gap rather than grading it (recipe `ec47448c`; the corpus's `e5b988a1` and `50042369` say the module owns the rule and the guard fingerprints it). Intent ownership is now the fragment `intentOwnedBy` in `authz/report-scope.ts`, used by the service and the export; `feedbackOwnedBy` and `intentOwnedBy` join the guard's fingerprinted fragment list, so removing either from a statement fails `check:authz-seam` until the register is updated in review. S9-S4 therefore holds for ownership as well.
- **Finding 2 (`since` accepted impossible dates).** Refused now (`2026-02-30`, `2026-04-31`, `2025-02-29`); a leap day passes. Three unit cases added.
- **Finding 4 (the intent page showed "not found" for every failure).** A 404 shows "Intent not found"; any other failure shows a load error with the status. The page number resets when the link goes to another intent.
- **Finding 5 (collaborators' intent ids linked to a page that is always "not found" for the viewer).** The per-recipe feedback route returns `isMine` (`feedbackOwnedBy` for the viewer, made strictly boolean); the card links the intent only on the viewer's own rows and shows anyone else's as plain text. `GET /feedback/rows` carries `isMine: true`, so S9-F2's parity holds.
- **Finding 10 and the S9-Z1 figures.** `docs/api/reports.md` says deposits start with slice 6a. No tool, description, or MCP file changed, so the served bytes are A0's: the size tests pass unchanged.
- **Finding 12 (test gaps).** Added: an expired key is 401 on all three paths; headless parity on `GET /intents` too; an intent registered on `/check` is listed; `isMine` for Pat and for Sam on the same row.
- **Browser run, found not listed.** The intent page's cards no longer repeat a link to the page already open. The card's pre-existing contrast failures are added to the backlog's contrast item. The intent and recipe-id links keep the house link style; changing it is the design system's call, not this slice's.
- **Left as is:** finding 3 (S9-F2's "values equal" holds when the key reads the person's books; a narrower key correctly returns fewer related ids, by S9-S2); finding 6 (`GET /intents/` with a trailing slash is the router's 404); finding 7 (`recipe_book` slug resolution by `LIMIT 1` within the key's books, the house pattern); finding 8 (`per_page=+5` decodes to `5`).

After the fix pass: 286 backend tests and the 10 browser tests pass against the worktree backend; S9-I4's deposits half stays to be re-verified on the branch rebased onto 6a.

The browser spec is kept as the regression test `tests/e2e/drafts-slice9.spec.ts` (recipes `840d65ab`, `dfb89586`; the slices 3 to 5 precedent `19f00d3`). E6 now asserts what the run recorded and the fix pass settled: a row about a search reads "about a search", offers no star, and links nowhere on the intent page. E9 now uses the shared known-issues list, which gained the feedback card's two contrast entries from the backlog item. 13 of 13 pass with slice 5's spec, which shares that list.

`npm run test:ci` (`TESTCI_PGPORT=5620`) at `c86ffb7`: passed on the third run, 1,925 tests. The first two runs passed every test that reported and failed only on the known Windows native worker crash (backlog, "Worker exited unexpectedly"); the JSON report named `auth-delete-shared-books.test.ts` as the file it hit, and that file passes alone (18 of 18).

For the rebase onto 6a and 8a: stream D's `GET /feedback` change (recipe `1bbc63f1`) edits the write handler in `routes/feedback.ts` below this slice's `/rows` handler, and its target-less outcome rows (recipe `831a11ea`) name no recipe, so the listing already treats them like search rows. On rebase, add `briefingId` to the row shape (D's `FeedbackRowResult` carries `briefingId` and `intentId`) and `briefing_audit_id` (D's migration 0041) to the export; `docs/api/reports.md` then says a row names at most one of `traceId`, `searchId` and `briefingId`, and an outcome row names none and only its intent; refresh this slice's seam fingerprints against main after the rebase (D refreshed `feedback.service.ts` to `c7490c2928a4`); and add the intent page link beside stream B's queue heading. Stream B's static guard `apps/backend/src/authz/intent-link.test.ts` pins every `intent_id` mention per file in `apps/backend/src` with a reason: on rebase, add this slice's files to its `REGISTER` (count and one-line why), for example `services/intent-read.service.ts`, "reads traces.intent_id and check_feedback.intent_id for an intent's deposits and feedback, narrowed to the key's books (slice 9)", and likewise `routes/feedback.ts`, `routes/auth.ts`, and `routes/traces.ts` wherever they mention it.

Rebased onto `main` with 6c and 8a merged (2026-10-25); the rebase applied without conflicts. The 8a half is done: the row shape and the export carry `briefingId`; the intent page names a feedback row's subject as a recipe, a search, a briefing, or "this task" for an outcome row; `docs/api/reports.md` says a row names at most one target and an outcome row names none; and a Layer 3 case lists a briefing row and an outcome row for a key of one book. The service's register entry was refreshed for the added column (`594cdcfa578c`); every other entry held. The 6a half is done too, after rebasing onto `main` with 6a merged (B's #142, migration `0042`): the deposits commit `8920565` applied as is, so `GET /intents`, `GET /intents/:id` and the web intent page count and list deposits through `traceReadableByViewer`, with the draft state the viewer may see (S9-I4's Layer 3 case: K2 sees 3 deposits, K1 2). Deposits are read only for an intent that already resolved as the viewer's own, which is the rule `traces.intent_id`'s schema comment states; the comment now names the report paths. This slice's files are in stream B's `intent_id` register (all reads), the review queue's intent group links to the intent page, and browser case E10 covers that link. The service's seam entry is `n: 11`, `873abdc58403`.

### Slice 8b rubric: unattended readers (stream F, after 6c, 6a and 8a merge)

#### Slice 8b item 3 rubric: membership an agent can act on (stream D)

Written 2026-10-25 by stream D (agent `a-drafts-8b-members-2026-10-25`, Soup.net intent `int_hyLjJWkSmzo3TmIq8VBPyCrC`), before implementation, from the revision doc's slice 8 item 3 and its field item 6, and from the code at `68b14c2` (`main` with 6c, 8a and 6a merged). Branch `drafts/8b-book-members`. Items 1 and 2 are stream B's, written under this heading separately; items 8 and 9 are superseded by slice 10's dispatch line and are not built. Consumer: agents, on every surface that renders the corpus-context block. No web page change. Security-relevant: yes, in one place: an invitation count is a fact about a book that a plain member's page does not show.

**The design**, checked as recipe `173384b3`:
- Every book is "shared-capable": any book takes invitations from its owners and admins, and nothing in the schema marks a book personal-only. So every listed book gets a Members line, a solo book included ("Members (1): you").
- "Books the caller owns" is read as owner or admin. Those are the roles that may invite, and the ones that `GET /recipe-books/:id/invitations` shows the pending list to. The count shows an agent nothing its person cannot already see on the web.
- Zero is printed. The item exists because an omitted line is ambiguous.
- The caller is listed first as "you". The production briefing shows one person's two accounts in one book with nothing saying which one is the caller.

**Baselines** at `68b14c2`:

| Measure | Value | Cap |
|---|---|---|
| Thin briefing, fixed fixture (`thinInput()`) | 18,183 characters | 21,000 |
| Thin headless briefing, same fixture | 18,536 characters | 21,500 |
| Remote `tools/list` | 17,642 bytes (corrected after verification: 17,630 was the figure before 6a merged) | 18,200 |

Stream C's PR #138 (open) brings the thin fixture to within 7 characters of its cap, so the second of the two to merge measures again and moves the cap on its own branch, with a date and a reason (plan, "the cap raise is coordination, not permission").

**Members line**

| # | Criterion | Evidence |
|---|---|---|
| S8b3-M1 | Every book in the corpus-context block has a Members line, solo books included: `    Members (n): you, <others>`. n counts every member, the caller included. | Layer 1 renderer test (solo, two members, five members); Layer 3 on `list_my_recipe_books` for a solo book. |
| S8b3-M2 | The caller is identified by user id, not by email or display name, is listed first as "you", and appears once. The others keep today's label (`Name <email>`, or the email alone) and today's order (by email). | Layer 1; Layer 3 with two accounts that share a display name in one book, each seeing itself as "you". |
| S8b3-M3 | The roster is the book's live membership at call time. A member removed since the last call is gone, and one who accepted an invitation since then appears. | Layer 3: accept an invitation between two calls. |

**Pending invites line**

| # | Criterion | Evidence |
|---|---|---|
| S8b3-P1 | A book on which the caller's live role is owner or admin carries `    Pending invites (n)` under its Members line, `(0)` included. A book on which the caller is a plain member carries no such line. | Layer 1; Layer 3 with an owner, an admin and a member of one book, the same invitations, three calls. |
| S8b3-P2 | n counts the book's live invitations only: not accepted, not declined, and `expires_at > NOW()`. A revoked invitation, an expired one and a re-sent one each count as `GET /recipe-books/:id/invitations` lists them (a re-send expires the earlier one, so the count is 1). | Layer 3: accept one, decline one, revoke one, re-send one, and let one lapse (the expiry set in the past), then compare the count with the web route's list length. |
| S8b3-P3 | Invitations to another book never count, including another book the caller owns. An invitation with no book (the admin's invite-by-email) counts nowhere. | Layer 3 with two owned books. |
| S8b3-P4 | The role is read live. An admin demoted to member loses the line on the next call, and a member promoted to admin gains it. | Layer 3. |

**Surfaces and access**

| # | Criterion | Evidence |
|---|---|---|
| S8b3-S1 | One loader and one renderer serve every surface: `get_briefing` (remote MCP), the stdio `get_briefing` (through `GET /briefing`), `GET /briefing`, `list_my_recipe_books` (remote MCP) and `POST /keys/briefing` (the web copy-briefing). For the same person and the same book scope, every book's Members and Pending invites lines are identical across them. (Amended after verification: the rest of the block differs by an earlier design, since the `Index:` line is MCP-only.) | Layer 3 comparing those lines on all five surfaces, with a book that holds a recipe. |
| S8b3-S2 | The books listed are unchanged: the key's scope as today. A key scoped to one book shows no member and no count for any other book, even one the caller owns. | Layer 3 with a scoped key. |
| S8b3-S3 | The role and invitation reads live in `apps/backend/src/authz/` (a `group_members` reference anywhere else fails the seam check). `npm run check:authz-seam` passes, and no `claimnet.traces` read is added or re-fingerprinted. | The gate; code review. |
| S8b3-S4 | Nothing is written: no audit row, no feedback row, and no change to any response other than the recipe-books block and the `groups` echo in the JSON of `GET /briefing` and `POST /keys/briefing`, which mirrors it (members on solo books, `isCaller`, `pendingInvites`; it shows nothing the text does not). | Layer 3 counting audit rows before and after a call. |

**Bytes, specs, copy**

| # | Criterion | Evidence |
|---|---|---|
| S8b3-Z1 | `tools/list` is unchanged on both servers (no schema or description edit). The thin and headless fixtures are updated to the real shape (the caller in each roster, a pending count on owned books), their growth is recorded here and in `spec-decision-log.md`, and a cap moves only if the measured figure needs it, with a dated reason. | Size tests; the figures. |
| S8b3-F1 | `briefing-surfaces.feature` gains a scenario for the solo book's line, the owner's and admin's count, and the member's missing count. | The feature file. |
| S8b3-F2 | The comments that describe the old rule (`BriefingGroup.members` "omitted for solo books", the renderer's "omit when … the user is the only member", the loader's "solo books skip the Members line") are corrected in the same commit. | Code review. |

#### Slice 8b item 3 build notes (stream D, 2026-10-25)

Written by the builder for the verifier; the verification record is the verifier's to write. Built on `68b14c2`.

**Gate:** `TESTCI_PGPORT=5644 TESTCI_BACKEND_PORT=3288 npm run test:ci` exited 0 on the first run, with 2,032 passed and 6 skipped (140 files, 2 skipped), while another stream's gate ran on 5654. Typecheck, lint (0 errors), the data-model check and the authz seam passed. Slice suites: `routes/book-membership-lines.test.ts` (Layer 3, 9 tests, one per rubric row group) and the renderer block in `domain/recipe-guide-content.test.ts` (6 tests).

**What was built.**
- `authz/memberships.ts`: `listMembersOfBooks` returns each member's `user_id`, and now composes `countsAsMembership` like `listMembers` does. The new `pendingInviteCounts(db, userId, bookIds)` counts each managed book's live invitations in one statement. It joins the caller's own membership with an owner-or-admin role (`OWNER_OR_ADMIN_ROLES`, now exported from `roles.ts`) and repeats the liveness condition of `GET /recipe-books/:id/invitations`.
- `services/briefing.ts` `resolveScope`, the one loader behind `composeBriefing` and `composeCorpusContext`, attaches every roster with the caller flagged by user id, and the pending count where there is one. Both reads run in parallel.
- `renderRecipeBooks` prints the lines; `BriefingMember.isCaller` and `BriefingGroup.pendingInvites` carry them.
- The three comments S8b3-F2 names are corrected.

**Rows to check closely.**
- S8b3-P2: the test compares the count with the web route's own list, so if that route's liveness rule changes, the row fails loudly rather than drifting.
- S8b3-P4 sets roles with SQL, because no route changes a member's role.
- S8b3-S1 compares `list_my_recipe_books`, MCP `get_briefing` and `GET /briefing`. The web copy-briefing (`POST /keys/briefing`) is by code review: it calls `composeBriefing`, which uses the same `resolveScope`.

**Bytes (S8b3-Z1):** thin fixture 18,183 → 18,233 characters, headless 18,536 → 18,586; `tools/list` unchanged. With stream C's #138 the thin fixture would be about 21,043 against the 21,000 cap, so whichever merges second raises it by the measured figure, dated.

#### Slice 8b item 3 verification record

Written 2026-10-25 by the verifier (agent `a-drafts-8b3-verify-2026-10-25`, Soup.net intent `int_qNJn2cBmdPQxdc49zr1o9grM`), who did not build the slice and changed no application code or committed test. Verified at `478d936` in the `d-tool-shapes` worktree, on isolated stacks (compose project `soupnet-ci-5674`, backend on port 3299), with the package `dist` rebuilt from the worktree.

**Verdict: accept with follow-ups.** Of the 14 rows, 12 pass and 2 are partial as written (S8b3-S1, S8b3-F1). Two of the passes (S8b3-M3, S8b3-P3) pass on behaviour that the verifier's probes proved, with a case the row names missing from the committed test. Under the operator's current ruling (recipe `21d39214`), that gap is a finding to close before merge (finding 2). The other findings are not blocking. No security property failed. The count is shown only on books where the caller's live role is owner or admin, and it equals the web's pending list in every case tried. A plain member, an outsider, and a key scoped to other books learn nothing about a book's invitations or members that they could not see before.

**How it was verified.**

- **Gate:** `TESTCI_PGPORT=5674 TESTCI_BACKEND_PORT=3299 npm run test:ci` exited 0 on the first run: 2,032 tests passed and 6 skipped (140 files passed, 2 skipped), the same figures as the build notes. Build, typecheck, lint (0 errors, the 5 existing warnings), the data-model check, the authz seam check ("authz seam holds") and the golden-set ranking eval (9 thresholds green) all passed. The Windows worker crash did not occur.
- **Probes:** a temporary suite of the verifier's own under `apps/backend/src/routes/`, deleted afterwards, run with the committed `book-membership-lines.test.ts` on a fresh stack (`node scripts/test-ci-local.mjs -- <both files>`): 17 tests passed. The cast: an owner, an admin, a plain member, an outsider, two members with the same display name whose stored emails differ only by case, and a member who is removed mid-run. Each has scoped keys (the book plus their personal book, or the personal book only).
- **Bytes:** the thin and headless fixtures were measured by `BRIEFING.build(thinInput())` from a copy of the domain test, at `478d936` and again with `68b14c2`'s `recipe-guide-content.ts` and its test. The served `tools/list` was measured with the slice 1 method (`createMcpServer` with a stub principal over the in-memory transport). This was done at `478d936`, and again after swapping in `68b14c2`'s versions of the five changed source files and rebuilding the packages. The tree was restored with `git checkout HEAD --` and rebuilt.
- **Code review** of `68b14c2..478d936`.

**Members line**

| # | Verdict | Evidence |
|---|---|---|
| S8b3-M1 | pass | Layer 1: "a solo book says so" and the three-member case. Layer 3: the owner's personal book reads `    Members (1): you`. Probe: every personal book seen (owner, member, outsider, removed member) reads `Members (1): you`. n counts the caller: `Members (6)` for a six-member book on every member's key. |
| S8b3-M2 | pass | Layer 1: "told apart by the flag, not by a matching name or email". Layer 3: two accounts sharing a display name each see themselves as `you` and the other as `Olga <run> <email>`. Probe, beyond the row: one member's stored email was set by SQL to the upper-case form of another's (the `users_email_unique` index is case-sensitive). Each account's line reads `Members (6): you, …` with `you` once, and shows the other as `Same Name <…>` in its own case. The others stay in `ORDER BY u.email` order. Code: the flag is `row.user_id === keyRow.user_id`. |
| S8b3-M3 | pass, evidence gap | Layer 3 covers acceptance: the accepted invitee moves from the count to the roster (`Members (5)`, `Pending invites (2)`). Probe, for the removal half the row names: after `DELETE /recipe-books/:id/members/:userId`, the removed member's key no longer lists the book at all, and the owner's next call reads `Members (5)` without them. The committed test has no removal case (finding 2). |

**Pending invites line**

| # | Verdict | Evidence |
|---|---|---|
| S8b3-P1 | pass | Layer 3: the owner and the admin each read `Pending invites (n)`, with n equal to the length of the web list. The member has a Members line and no pending line. Probe: the plain member gets no pending line on `list_my_recipe_books`, or on `get_briefing` with `recipe_book` set to the book. Their `GET /recipe-books/:id/invitations` is 403. Every personal book shows `Pending invites (0)`. An invitation sent by the admin counts on the owner's line too. |
| S8b3-P2 | pass | Layer 3: accepted, declined, revoked, re-sent and lapsed invitations against the web route's own list. Probe at the boundary, in one transaction (so `NOW()` is fixed): with an invitation's `expires_at` set to exactly `NOW()`, `pendingInviteCounts` and the web route's `WHERE` clause both gave 2, down from 3. At `NOW() + 1 second`, both gave 3 (rolled back afterwards). An invitation to an address that is already a member counts, and the web list holds it too (finding 6). Code: the liveness condition is the web route's, word for word. The web route's inner join on the inviter cannot drop a row the count keeps, because `invitations.inviter_id` is `NOT NULL … ON DELETE CASCADE`. |
| S8b3-P3 | pass, evidence gap | Layer 3: an invitation to the owner's personal book counts only there (`Pending invites (1)`), and not on the shared book. Probe, for the groupless case the row names: a direct insert with `group_id NULL` (the admin invite-by-email shape) and the owner as inviter left the owner's counts unchanged (shared book 2, equal to the web list; personal book 0). Code: `i.group_id = gm.group_id` never matches NULL. The committed test has no groupless case (finding 2). |
| S8b3-P4 | pass | Layer 3: the admin demoted by SQL loses the line, and the member promoted to admin gains `Pending invites (2)`, on the next call. Code: the role is read inside the counting statement on every call (`gm.role IN ('owner', 'admin')` with `membershipOf`), and nothing is cached. |

**Surfaces and access**

| # | Verdict | Evidence |
|---|---|---|
| S8b3-S1 | partial (not met as written) | The membership lines are identical on all five surfaces. Probe, with one recipe deposited in the shared book: `list_my_recipe_books`, MCP `get_briefing`, `GET /briefing`, `GET /briefing` with `X-SoupNet-Surface: mcp-stdio` (the stdio proxy's call), and `POST /keys/briefing` (JWT, the web copy-briefing) all gave the same Members and Pending invites lines. The whole recipe-books block is identical only on the three MCP-profile surfaces. On `GET /briefing` (surface `rest`) and `POST /keys/briefing` (surface `web`), the book has no `Index:` line, which is MCP-only by an earlier design (`resolveScope`: "Per-book index stats — MCP surfaces only"). The committed test passes because its books hold no recipes. It also covers neither the stdio header nor the web route (finding 1). |
| S8b3-S2 | pass | Layer 3: Olga's key scoped to the shared book shows nothing of her personal book. Probe: the outsider's key, the owner's personal-only key and the admin's personal-only key each list only their personal book. On `list_my_recipe_books`, on `get_briefing` with `recipe_book=<shared slug>`, and on `GET /briefing?recipe_book=<shared slug>`, none of them contains the shared book's slug or name, and the outsider's output never names the owner. Code: `allIds` is the Principal's read and write scope, already intersected with live memberships, and both reads are bounded by `inBooks(allIds)`. |
| S8b3-S3 | pass | Both new statements are in `apps/backend/src/authz/memberships.ts`, and both compose `countsAsMembership` and `membershipOf`. `routes/` and `services/` gain no `group_members` reference. `OWNER_OR_ADMIN_ROLES` is exported from `roles.ts`, the one list `isOwnerOrAdmin` uses. The gate's seam check holds with its registers unchanged, and there is no `claimnet.traces` read in the diff. |
| S8b3-S4 | pass | Layer 3: `list_my_recipe_books` adds no audit row. Probe: `list_my_recipe_books` added no audit row and no `check_feedback` row (8 → 8, 0 → 0). `get_briefing` added the single `briefing.issued` row it already wrote before the slice (8 → 9). The JSON `groups` echo on `GET /briefing` and `POST /keys/briefing` changed with the block, which the row does not mention (finding 4). |

**Bytes, specs, copy**

| # | Verdict | Evidence |
|---|---|---|
| S8b3-Z1 | pass | Fixtures re-measured: thin 18,183 → **18,233**, headless 18,536 → **18,586** (+50 each, as recorded here and in `spec-decision-log.md`). The block diff is exactly `Members (1): you` and `Pending invites (0)` on the personal book, plus `you, ` on project-x. Caps are unchanged (21,000 and 21,500). Served `tools/list`: remote **17,642** bytes at both `68b14c2` and `478d936`, with the JSON byte-identical (`cmp`); stdio **14,145**; no file under `apps/mcp-server` or `routes/mcp.ts` is in the diff. The rubric's baseline of 17,630 is stale (finding 5). |
| S8b3-F1 | partial (not met as written) | `briefing-surfaces.feature` has the scenario "Every book says who is in it, and a book's managers see its pending invites". It has the solo line, the owner's count, `(0)` on an owned book with none, and the plain member's missing line. It has no admin step, though the row names "the owner's and admin's count" (finding 3). |
| S8b3-F2 | pass | All three comments are corrected in `d53abb8`: `BriefingGroup.members`, the renderer's Members comment, and the loader's "solo books skip" comment. A search for "solo" and "more than one member" finds nothing else stale about the rule. Two comments still say the web briefing "stays byte-identical": the `BriefingGroup.stats` JSDoc and the loader's stats comment. Both are about the stats line only, so they still read true. |

**Findings, by severity**

1. **Low: S8b3-S1 claims more than holds.** The membership lines match on every surface, but on a book holding recipes the REST and web blocks lack the MCP-only `Index:` line. That difference predates the slice and is intended. The committed test cannot see it, because its books are empty, and it does not exercise the stdio header path or `POST /keys/briefing`. Recommendation: amend the row to "the Members and Pending invites lines are identical across them". Extend the S1 test to deposit one recipe, call `GET /briefing` with `X-SoupNet-Surface: mcp-stdio`, and call `POST /keys/briefing`, comparing the membership lines.
2. **Low, to close before merge (recipe `21d39214`): two cases the rows name have no committed test.** S8b3-P3's groupless invitation (a direct insert with `group_id NULL`; the count must not move), and S8b3-M3's removal half (remove a member between two calls; their key loses the book and the roster drops them). Both held under the verifier's probes. Recommendation: add both to `book-membership-lines.test.ts`.
3. **Low: the feature scenario omits the admin (S8b3-F1).** Recommendation: add "And an admin of the shared book sees the same Pending invites line" to the scenario.
4. **Low: the JSON `groups` echo changed shape, and nothing records it.** `GET /briefing` and `POST /keys/briefing` return `data.groups` beside the text. That echo now carries `members` on solo books, the caller inside each roster with `isCaller: true`, and `pendingInvites` on managed books. It shows the caller nothing beyond the text block for the same key, and no consumer reads it: the stdio proxy and the web copy button read `text`. But S8b3-S4 promises no change outside the recipe-books block, and the spec-decision-log entry describes only the text. Recommendation: one line in the spec log and the rubric naming the echo as the block's structured twin.
5. **Info: the `tools/list` baseline is stale.** The rubric gives 17,630 bytes at `68b14c2`, but the served payload measures 17,642 there (and at `478d936`), with stdio at 14,145. The 17,630 figure is the slice 8a combined figure after 6c merged, taken before 6a merged. Recommendation: correct the baseline row. Z1 is unaffected, since the payload is byte-identical.
6. **Info: an invitation to someone already in the book counts as pending.** The web list shows it too, because the invite route does not check membership. So the count is correct by the row's definition. For the field item 6 sweep ("has the colleague joined?"), the Members line is the authority. Nothing to change in this slice. A later web-route change could refuse to invite a current member, since its owners and admins can already see the roster.
7. **Info: the liveness condition is written twice.** It appears in `routes/groups.ts` (the web list) and in `authz/memberships.ts` (the count). The S8b3-P2 test pins the two together, so drift fails loudly. If a third reader appears, a shared `invitationIsLive` fragment would make it one edit.

**Soup.net checks** (`soupnet-oss`, intent `int_qNJn2cBmdPQxdc49zr1o9grM`, agent `a-drafts-8b3-verify-2026-10-25`; no drafts):

- `147690ff`: S1 graded pass on a probe of the added lines, with the overclaim as a finding. Corrected by its feedback row: the results `50c5b20e` ("not met as written") and `8f55a8d7` (pass only when every case the row names holds) point to partial.
- `78eefe42`: the corrected call, S1 partial as written, with a non-blocking amendment. It applies to F1 too.
- `fadd3bb6`: P3 graded partial under `feaee11a`. Corrected by feedback row `f8c07582`: the results surfaced `21d39214`, the operator-confirmed current ruling (pass on behaviour, with the gap named and closed before merge), which is the grading used above for P3 and M3.

#### Slice 8b item 3 fix pass (stream D, 2026-10-25)

After the verification record (`bf7ea02`, accept with follow-ups). No application code changed. Each finding's disposition:

1. **S8b3-S1 (partial).** Fixed. The row now claims what holds: the Members and Pending invites lines are identical on every surface. The `Index:` line is MCP-only by an earlier design. The test compares those lines on all five surfaces: `list_my_recipe_books`, MCP `get_briefing`, `GET /briefing`, `GET /briefing` with the stdio surface header, and `POST /keys/briefing`. It deposits a recipe into the shared book first, so the books are not empty.
2. **P3 and M3 cases missing from the committed test.** Fixed. Setup adds an invitation with no book, and the P3 test shows it counts nowhere. The M3 test removes a member after the acceptance and checks that the roster drops them.
3. **F1, the admin's count.** Fixed: one step in the scenario.
4. **The JSON `groups` echo.** Recorded in S8b3-S4 and in the spec-decision log as edit 3.
5. **The stale `tools/list` baseline.** Corrected to 17,642.
6. and 7. Information only; nothing to change in this slice.

**Gate:** `node scripts/test-ci-local.mjs -- apps/backend/src/routes/book-membership-lines.test.ts` (fresh stack, with build, typecheck and lint) passed 9 of 9. The full gate at `478d936` (2,032 passed) covers the unchanged application code.

**After C1 (#138) and slice 9 (#140) merged:** `main` was merged in. The conflicts were the domain test's import list and the spec-decision log's newest entries, and both sides were kept. As planned, the thin fixture then measured 21,043 against the 21,000 cap, so this slice, merging second, raised the cap to 21,050 with a dated comment at the assertion. The headless fixture is 21,443 of 21,500.

**After C2 (#146) and slice 10 (#144) merged:** `main` was merged in again. The same two files conflicted, and again both sides were kept. C2's raise to 22,800 replaced this branch's 21,050. With main at 22,795 thin and 23,195 headless, the lines measured 22,845 and 23,245, so both caps move by 50: thin 22,800 → 22,850 and headless 23,200 → 23,250, each dated at its assertion and in the spec-decision log.

#### Slice 8b items 1 and 2 rubric: the flat list and changed-since (stream B)

Written 2026-10-26 by stream B (agent `a-drafts-6a-2026-10-24`, Soup.net intent `int_Xls5LzHUWH5boPEY7MIPn2Or`), before implementation, from the revision doc's slice 8 items 1 and 2 and ruling 51, against `main` at `5b81097` (PR #147, with 6a, 8a, 9, 10 and D's 8b item 3 merged). Branch `drafts/8b-flat-list`. The design is checked as recipe `4a517f5b`. Consumers are agents (`search_recipes` on both MCP servers, and `/check?filter=` as JSON and HTML), and above all the unattended sweep: an orchestrator or steward that polls on a tick and needs every id that arrived or moved since it last looked. Security-relevant: yes. A new listing over recipes has to compose the draft visibility fragments and register with the seam check, like every other read.

Settled before this rubric and not reopened here:
- The flat list is for queries with no semantic text. It has `page`, lists newest first, and uses triage order for `is:draft` (revision doc, slice 8 item 1).
- "Changed since" is built with creation time as the fallback. Both qualifiers are built (ruling 51).
- The flat list reaches agents through the agent search surface, not the web queue endpoint (revision doc, "Considered and set aside").
- There is no new noun, and nothing reaches ranking.

**Decisions this rubric makes.** Each is reversible, and each is recorded in the build notes with its reasoning.

1. **When the flat list applies.** On the read-only search surfaces (`search_recipes` on both MCP servers, and `/check` with `filter` and no recipe), whenever the parsed query has no semantic text. Under the prose-parenthetical rule (`8481d9bc`), a parenthetical counts as semantic text. `check_recipe` always carries text, so it is unchanged.
2. **Row shape.** Rows ride in the existing `results` field, so a script that reads `results[].recipeId` keeps working. ~~`searchMode` is `"list"`.~~ `searchMode` stays `"lexical"`, as for every search with no bare text, and the response gains `listOrder` and `perPage` (amended during the build: renaming the mode would break readers of it, and "lexical" still says the matches are exact with no similarity). Each row carries:
   - `recipeId` and the book;
   - the judgment date (`createdAt`, which is `decided_at` or the deposit time when unset), the deposit time (`loggedAt`, the name `get_recipes` already uses for it), and the changed time (`changedAt`);
   - ~~the depositing agent's ratings;~~ the ratings where every result carries them, beside the viewer's own draft label (amended during the build: slice 3's security property "Ratings reach no result row but the viewer's own drafts", S3-AG2, holds; an `is:draft` sweep still gets them);
   - the state (the viewer's own draft label, as on every result, or none for a published recipe);
   - the claim.

   Structured output carries the whole claim. Markdown shows its first 160 characters, with an ellipsis when cut. No evidence and no clusters: a row is an index entry, and `get_recipes` fetches what a sweep wants to read.
3. **Order.** Newest judgment date first, which is today's corpus-mode order. With `is:draft` (or `is:expired`), the queue's triage order (`triageOrderSql`), without the queue's intent grouping. With `changed-after:`, latest change first. Every order ends in the id, so paging is total: no row repeats or vanishes between pages unless it changes.
4. **Paging.** A `page` parameter, an integer from 1, is added to `search_recipes` on both servers. `/check` already has `page`. The page size is fixed at 50, so the tool roster gets no size parameter: the operator's "Even new parameters must be very well justified, I don't want single purpose profusion" (recipe `ded7f5ed`) allows the one parameter the revision doc names and no more. Every flat response says "page p of n (N matches)" and names the next page when there is one. A page past the end returns no rows and that line, not an error, so a sweep's loop ends naturally. `SEARCH_CORPUS_LIMIT` (200) no longer caps a qualifier-only search, because the pager reaches every match. With semantic text, `page` behaves as `/check`'s `page` does today.
5. **No walk-down, and nothing marked as shown.** A flat row is an index entry, not the recipe, so it does not enter the session's or the intent's shown set. A known recipe is not stubbed or skipped either, because a sweep needs every id. The flat list therefore writes no `session_shown` or `intent_shown` rows. It still writes the `check.searched` audit row, which is its `searchId`.
6. **Two qualifiers.** Each takes a date or a full ISO datetime, and each is a selection. The names were checked as recipe `dc8e7d09`: each names the clock it reads, follows `after:`'s inclusive reading, and needs no operator syntax.
   - `created-after:` means deposited at or after the time.
   - `changed-after:` means changed at or after the time. A recipe's changed time is the latest of its deposit, `traces.updated_at` (set by a draft's resolution and by a move to another book), its newest feedback row, and its newest reaction.

   Feedback rows and reactions count whoever wrote them. A reader of the recipe already sees every row and its date on the recipe's page (`GET /traces/:id` lists all `check_feedback` rows on it), so the changed time discloses nothing new. Each qualifier takes one value, cannot be negated, and errors on a second value, by the `after:` rules. Both are built in `services/search-selection.ts`, which is outside the ranking files, and both are added to the ranking-isolation guard. With semantic text they filter the ranked path like any other selection.
7. **Copy.** `searchQuery` gains the two qualifiers. It loses "Qualifier-only: newest first.", which the `page` parameter's description replaces with the flat list's own sentence. At 413 of 420 characters it must also lose "(your intent's recipes)" after `intent:int_…`. The question 56 rule applies: trim, and keep the untrimmed text in `docs/briefing-specs/expanded/`. The shared renderer's header invariant "No 'Page X of Y' pagination text — agents can't page" is corrected for the flat list in the same commit.

Cast: Pat (the key's owner), Sam (a member of Pat's shared book).

**Baselines** at `5b81097`, measured with the slice 6a method (`createMcpServer` and the stdio server over the in-memory transport):

| Measure | Value | Cap |
|---|---|---|
| Remote `tools/list` | 17,698 bytes | 18,200 |
| Stdio `tools/list` | 14,201 bytes | 14,700 |
| Shared descriptions | 6,442 characters | 6,600 |
| `searchQuery` | 413 characters | 420 |

**The flat list**

| # | Criterion | Evidence |
|---|---|---|
| S8b-L1 | A qualifier-only search (`author:me`) returns the flat list: `listOrder` set, no clusters, no "represents N similar" lines, no related-evidence section, and one row per match with decision 2's fields, in decision 3's order. | Layer 3 on MCP structured and markdown, and on `/check` JSON and HTML. |
| S8b-L2 | Paging is total. Over 120 visible recipes, pages 1 to 3 hold 50, 50 and 20 distinct ids whose union is the full set, in order. Page 4 is empty with the end line. `totalResults` is 120 on every page. | Layer 3. |
| S8b-L3 | `is:draft` lists in the queue's triage order: the same ids in the same sequence as `GET /traces/drafts` for drafts with no intent. | Layer 3 comparing the two. |
| S8b-L4 | Visibility is unchanged. Pat's flat list never holds Sam's unresolved draft, a rejected draft, or a recipe in a book outside the key's read scope. Rows and totals use the same draft condition (RP-03). The new statement is registered in `scripts/check-authz-seam.mjs` with its reason. | Layer 3; the gate's seam check. |
| S8b-L5 | No walk-down. Two identical flat requests under one session and one intent return identical rows, and a following semantic search under that session shows none of them as stubs. | Layer 3. |
| S8b-L6 | A query with semantic text is unchanged: the S6a and slice 3 search tests pass as they stand, and the ranking-regression fixtures are green. | The gate. |

**Changed-since**

| # | Criterion | Evidence |
|---|---|---|
| S8b-C1 | `created-after:<t>` selects exactly the recipes deposited at or after t, for a date and for a full ISO datetime, on the flat path and the ranked path. | Layer 3. |
| S8b-C2 | `changed-after:<t>` selects a recipe deposited before t when, after t, it was verified, moved, given a feedback row, or given a reaction. A draft rejected after t is not listed, because a rejected draft leaves every result set (slice 2). A recipe untouched since t is not selected. The order is latest change first. | Layer 3. |
| S8b-C3 | Grammar: each qualifier takes one date. A malformed value, a second value, a group and a negation are loud errors naming the form. | Layer 1 in `search-query.test.ts`. |
| S8b-C4 | Neither qualifier reaches ranking: both terms are in the ranking-isolation guard, and a mutation check shows the guard fails when one is added to a ranking file. | The guard test; mutation recorded in the build notes. |

**Parameter, bytes, docs**

| # | Criterion | Evidence |
|---|---|---|
| S8b-P1 | `page` on `search_recipes` validates as an integer from 1. A zero, a negative, a fraction or a string is the validation error naming the field (8a's form), not a silent page 1. On `/check`, a page that does not parse falls back to page 1, as today. | Layer 3 on the remote server; Layer 1 on stdio. |
| S8b-B1 | Sizes: both `tools/list` payloads within their caps, shared descriptions within 6,600, and `searchQuery` within 420, each measured before and after in `spec-decision-log.md`. | Size tests; the figures. |
| S8b-D1 | Docs: the `recipe-search-design.md` rows for both qualifiers and the flat list, `CLAUDE.md`'s qualifier list, `drafts-and-triage-read-paths.md` if it names the session walk, and a sweep scenario in the feature file. | Review. |

Open, to settle by check during the build, not for the operator: whether 50 rows of markdown stay inside a typical tool-result budget (measure a full page's bytes first), and whether a `changed-after:` row should name what changed (resolved, moved, feedback, reaction), which a sweep would use but which costs a join per row. (Both settled in the build notes below.)

#### Slice 8b items 1 and 2 build notes (stream B, 2026-10-26)

Written by the builder for the verifier; the verification record is the verifier's to write. Built on `5b81097` (PR #147). Branch `drafts/8b-flat-list`.

**What was built.**
- **Grammar** (`packages/domain/src/search-query.ts`): `created-after:` and `changed-after:` join the qualifier allowlist and the unknown-qualifier help. Each takes one strict ISO date or datetime, cannot be negated, and refuses a second value and a group, by the `after:` rules. A parenthetical that names one keeps the strict group reading, as `(author:me)` does. The IR gains `createdAfter` and `changedAfter`.
- **Selections** (`services/search-selection.ts`): `createdAfterSelection`, `changedAfterSelection`, and `changedAtSql`, the latest of `created_at`, `updated_at`, the newest `check_feedback.created_at` and the newest `trace_reactions.updated_at`. `GREATEST` skips the NULLs, and both subqueries use their table's `trace_id` index. Like every selection, they reach the ranked path as opaque predicates.
- **The flat list** (`services/recipe-list.service.ts`, new): one count and one paged select over `inBooks` and `traceVisibleTo` with the search's structured predicates, so rows and the total share one condition. The page size is fixed at 50 and the page is clamped to 1..100,000, the queue's bound. The three orders each end in the id. `searchWithoutLogging` takes this path whenever the parsed query has no semantic text, in place of the corpus-mode pipeline call, and writes no `session_shown` or `intent_shown` rows on it. The `check.searched` row (its `searchId`) is written as before.
- **Wire** (`lib/flat-list-fields.ts`, new): one builder for the flat rows and page fields, used by the `/check` JSON builder and the remote MCP tool (the stdio server reads the `/check` JSON). `enrichResults` takes `{ evidence: false }` for these rows, so they get the book, the draft label and the on-behalf party without the evidence queries. The shared markdown renderer gains the flat branch and `flatListPageLine`, which the `/check` page reuses. The HTML page lists each row with its id and time, and names the order where the sort toggle was.
- **Contracts:** `Recipe.changedAt` (new), `loggedAt`'s definition widened to the flat list, and `listOrder` and `perPage` on the check response.
- **Copy:** `searchQuery` and the new `searchPage`, both trimmed under question 56's rule (`docs/briefing-specs/expanded/slice8b.md`). `page` is on both servers' `search_recipes` as `z.number().int().min(1)`.
- **Guards:** the ranking-isolation guard gains the since terms (S8b-C4). Mutation check: appending `// mutation: changedAfter` to `search-pipeline.ts` failed exactly that file's new case, and the file was restored. The seam registers `recipe-list.service.ts` (composes) and `search-selection.ts` (the correlated subqueries, not composing). `trace.service.ts`'s fingerprint moved only because its multi-line `@soupnet/db` import counts as a Drizzle mention whose 40-line window now reaches the two new import lines; no SQL changed.

**Decisions made in the build** (each recorded in the rubric as an amendment):
- `searchMode` stays `"lexical"`, and `listOrder` marks the flat list. Renaming the mode would break its readers.
- The deposit time is `loggedAt`, the name `get_recipes` already uses.
- Ratings stay where S3-AG2 puts them: on the viewer's own drafts.
- A rejected draft leaves every result set, so `changed-after:` cannot list it. Row S8b-C2 says so instead of "when still visible".
- **The two open items.** A full markdown page of 50 rows measures 11,964 bytes, with claims cut to 160 characters, so the page size stays 50. A row does not name what changed. A sweep that needs to know reads the recipe (`get_recipes` gives its draft state) or its feedback rows (`GET /feedback/rows?trace_id=`), and a `changedBy` field would be a new noun for a question the existing reads answer.
- `S3-A7` in `draft-queue.test.ts` pins `search_recipes`' parameter set; it now includes `page`, with the reason at the assertion.

**Rows to check closely.**
- S8b-L3 compares `is:draft` with `GET /traces/drafts` for drafts with no intent. The queue groups by intent and the agent list does not, so a fixture with intents would differ by design.
- S8b-C2's order: the moved recipe also gets the move's correction feedback row, so its changed time is the later of the two.
- S8b-P1: the SDK refuses a bad `page` before the handler runs. The test accepts either a JSON-RPC error or an `isError` result naming `page`.

**Soup.net checks** (`soupnet-oss`, intent `int_Xls5LzHUWH5boPEY7MIPn2Or`, agent `a-drafts-6a-2026-10-24`; no drafts):
- `4a517f5b`: the design, before the rubric. Nothing contradicted it. Its feedback row records the two corrections the build made (ratings, `searchMode`).
- `3fec44d3`: the build decisions. It surfaced `8dd573b4` (2026-07-17), which prefers a dated cap raise to fitting a new description into headroom. Ruling 48 (2026-10-24) supersedes it for this round: one dated raise of the shared total (6,080 → 6,600) covers slices 6 to 9, so the `page` description was trimmed to stay under it. Its feedback row records this. A second row corrects a lineage id the first row wrote wrong.

**Layer 3:** `apps/backend/src/routes/flat-list.test.ts`, 9 tests, one or more per rubric row, passed on its first run on an isolated stack (`TESTCI_PGPORT=5611 node scripts/test-ci-local.mjs -- apps/backend/src/routes/flat-list.test.ts`). Layer 1: 7 new cases in `search-query.test.ts`, 8 for the renderer's flat branch and `flatListPageLine` in `check-response-renderer.test.ts`, the order and page helpers in `recipe-list.service.test.ts`, and the stdio proxy's `page` forwarding and refusals in `apps/mcp-server/src/server.test.ts`.

**Gate:** `TESTCI_PGPORT=5611 npm run test:ci` passed on the final tree: 2,232 tests passed and 6 skipped (148 files, 2 skipped), the authz seam held, and the golden-set ranking eval's 9 thresholds were green. Of two earlier runs on earlier trees, the first failed only S3-A7 (the parameter pin, updated above). The second passed every test that reported (2,217) and then failed on the known Windows worker crash (backlog, "Worker exited unexpectedly").

#### Slice 8b items 1 and 2 verification record

Independent verifier: the round's verification coordinator (a fork of the claimNet planning session, agent `a-verify-coordinator-2026-10-26`, Soup.net intent `int_eIvjehx2hEQT5MddCrYY20CV`). Not the builder. Branch `drafts/8b-flat-list`, PR #154, checked out detached in `SoupNet-wt/verify-e`; isolated gate on `TESTCI_PGPORT=5906`. Rubric: "Slice 8b items 1 and 2 rubric" in `docs/planning/drafts-and-triage-build.md` on the branch, with its four build-time amendments. Read in full: `services/recipe-list.service.ts`, `services/search-selection.ts` (the new selections and `changedAtSql`), the `trace.service.ts` hunks, `lib/flat-list-fields.ts`, the `check.ts` and `mcp.ts` hunks, `apps/mcp-server/src/server.ts`, `check-response-renderer.ts`, `search-query.ts`, the description text, `result-enricher.ts`, and the new test names (9 Layer 3 in `flat-list.test.ts`, 7 grammar, 8 renderer, 6 list helpers, 1 stdio).

**Result:** accept; verified end to end (every row pass; isolated gate exit 0)

| Row | Grade | Evidence |
|---|---|---|
| S8b-L1 | pass | `searchWithoutLogging` takes `listRecipesFlat` whenever the parsed query has no semantic text; the response carries `listOrder`, `perPage`, `clustered: false`, rows with id, claim, book, judgment date, `loggedAt`, `changedAt` and the viewer's own draft label; no evidence (`enrichResults` with `evidence: false`, no cluster evidence). Layer 3 on MCP structured and markdown, `/check` JSON and HTML. |
| S8b-L2 | pass | Fixed page size 50; every order ends in `t.id ASC`; count and page share one `WHERE`; a page past the end returns no rows and the end line (`flatListPageLine`). Layer 3 over 120 recipes. |
| S8b-L3 | pass | `triageOrderSql("t")` for `is:draft` and `is:expired`; Layer 3 compares with `GET /traces/drafts` for drafts with no intent (the queue's intent grouping is the person's page, as the notes say). |
| S8b-L4 | pass | `listRecipesFlat` composes `inBooks` and `traceVisibleTo` with the search's structured predicates for both the count and the rows (RP-03); the audience includes expired drafts only on `is:expired`; `recipe-list.service.ts` and `search-selection.ts` are registered in the seam check with their reasons. Layer 3 with Sam's draft, a rejected draft and an out-of-scope book. |
| S8b-L5 | pass | `searchShownIds` is empty for a listing, so neither `session_shown` nor `intent_shown` is written; known recipes are rendered in full, never stubbed; the `check.searched` audit row still gives the `searchId`. Layer 3. |
| S8b-L6 | pass | The ranked path is untouched except for the `page` pass-through; the ranking-isolation guard gains the since terms; the gate's ranking fixtures decide it. |
| S8b-C1 | pass | `createdAfterSelection`: `created_at >= t`; Layer 3 for a date and a datetime on both paths. |
| S8b-C2 | pass | `changedAtSql`: `GREATEST(created_at, updated_at, max(check_feedback.created_at), max(trace_reactions.updated_at))`, NULLs skipped; `changedAfterSelection` over it; the changed order is `changedAt DESC, id`; a rejected draft is excluded by `traceVisibleTo` before any time test, as the amended row says. Layer 3 covers a verification, a move, a feedback row and a reaction. The disclosure reasoning (every feedback row and its date is already on the recipe's page for any reader) holds. |
| S8b-C3 | pass | Both qualifiers in the allowlist and the help text; one strict ISO value, no negation, no second value, no group; a parenthetical keeps the group reading. 7 Layer 1 cases. |
| S8b-C4 | pass | Both selections live in `search-selection.ts`; the ranking-isolation test gains a case per ranking file for the since terms and the changed time; the mutation check is recorded in the build notes. |
| S8b-P1 | pass | `page: z.number().int().min(1).optional()` on both servers; the stdio proxy forwards it to `/check` and refuses a bad value; `/check` clamps and floors (`clampFlatListPage`, capped at 100,000 so no OFFSET overflows). Layer 3 and Layer 1. |
| S8b-B1 | pass | Remote `tools/list` 17,904 of 18,200, stdio 14,407 of 14,700, shared descriptions 6,593 of 6,600, `searchQuery` within 420 (the "(your intent's recipes)" clause trimmed with the untrimmed text kept in `docs/briefing-specs/expanded/slice8b.md`, under the question 56 rule); no cap moved. Stream T re-measures after this merges. |
| S8b-D1 | pass | `recipe-search-design.md` rows, `CLAUDE.md`'s qualifier list, the expanded briefing text, the decision-log entry and a sweep scenario in `drafts-and-triage.feature` are in the diff. |

The four build-time amendments (`searchMode` stays `"lexical"` with `listOrder` marking the list; `loggedAt` as the deposit time; ratings only on the viewer's own drafts per S3-AG2; a rejected draft cannot be listed by `changed-after:`) are each graded as amended; each keeps an earlier security property or a reader's contract rather than loosening one.

**Observations, none blocking**

1. **Cost of the changed order**: `changedAtSql` runs two correlated subqueries per candidate row, in the `WHERE` for `changed-after:` and in the `ORDER BY` for the changed order, over the whole filtered set before `LIMIT`. Both subqueries use their table's `trace_id` index, so this is fine at today's corpus sizes; a sweep over a very large book with `changed-after:` far in the past is the case to watch. A materialised `changed_at` column is the lever if it ever matters.
2. **Two statements per page** (count, then rows). Deliberate and cheap; noted so nobody later folds them into a window function without keeping the one shared `WHERE`.
3. **`page` on a ranked search** behaves as `/check`'s `page` does today, as the rubric says; the markdown renderer still prints no page line for ranked results, which is the right asymmetry.

**Gate**

Coordinator's isolated gate at 0ce8de6 (`TESTCI_PGPORT=5906`): exit 0. Typecheck, lint, data-model and the authz seam passed; vitest **2,232 tests passed, 6 skipped, 0 failed**; the golden-set ranking eval reports all 9 thresholds green, which is S8b-L6's proof that the ranked path is unchanged. Stream B's 8b items 1 and 2 are verified end to end from this role; the branch merges before plugin stream T, which re-measures the tool-list caps after the `page` parameter lands.

### Slice 6b rubric: option sets (stream G, after 6c and 6a merge)

### Slice 10 rubric: drafts as a bus (stream A)

Written 2026-10-25 by stream A (agent `a-drafts-10-2026-10-25`, intent `int_B5rF0m1PZBmMmZCfzepGWEXV`) before implementation, from the revision doc's "A proposed slice 10" (ruled 2026-10-25, recipe `053c9b97`), the plan's "After the first PRs" row for stream A, and the code at `381bf26` (#137 merged). Consumer: agent (check and search results on remote MCP, stdio MCP and the web `/check` page; `get_recipes` and `GET /recipes`; `list_my_recipe_books` and the briefing's books block) and human (the review queue, its count, and the detail page's state line). Security-relevant: yes. The slice adds a read of the intents table to draft visibility, and a new line in results that names a draft, so every uniform-response row of slices 2 to 5 is re-run against it. The combined audit after A1, B, D and E does not cover it; slice 10's own read-only audit follows its PR, with findings in the private repo.

Settled before this rubric (not reopened): liveness is computed at read time from `intents.last_used_at`, never stored or swept, and un-expires on any use of the intent; 24 hours, fixed (open question 10-1 recommends measuring before any knob); headless keys are exempt; expiry is never deletion; expired drafts leave the queue and the default `is:draft` listing, an `is:expired` qualifier lists them, and they stay readable and resolvable by id; on-behalf drafts follow the depositor's intent; the dispatch line's wording; slice 8b items 8 and 9 are superseded by the dispatch line (plan, stream D's row).

**Dependencies, and what this branch builds first.** The intent arm of liveness needs `traces.intent_id`, which is stream B's slice 6a and not yet on `main`. B confirmed the contract on 2026-10-25: `text`, nullable, no foreign key, partial index `traces_intent_id_idx`, migration `0042`, written once in the deposit's INSERT from the intent the check resolved or registered for the depositing key's user, never updated; on-behalf deposits carry the depositor's intent; import keeps it only when the importer owns the intent. The planning session's merge order is D, B, E, C. This branch builds everything that does not need the column on `main` now, with liveness written once behind one function, and adds the intent arm, its rows (S10-L2, S10-L3) and its tests when it rebases after B merges. Every row below marked "after 6a" waits for that rebase. The intent-lineage counts (revision doc) need slice 9's `GET /intents` (#140) and are added after E merges (S10-K3).

**Calls made here** (each recipe-checked in `soupnet-oss` under this intent and recorded in the build notes):

- A draft with no intent, or whose intent row is gone, is live for a fixed 7 days from its deposit (`fd614c86`). The ruling left the choice between that and the depositing key's last activity to this rubric, and the schema does record key activity (`api_keys.last_used_at`). Keys don't track the task, though: a daily key rotates away mid-task, and a scoped key is shared by every session that holds it, so key activity would expire a daily key's drafts on rotation and keep a shared key's alive while any unrelated task runs.
- Expired drafts leave every result set the person's agents see, not only the queue and the default listing (`f1c99ec8`). The ruling's reason for expiry ("the work has moved on") applies to check and search results as much as to the queue, and a resolved draft already leaves results while staying readable by id, so expiry takes the same shape. `is:expired` brings them back.
- The dispatch line comes from its own small lookup over the live drafts the caller may read, not from the displayed exemplars (`bff6f47b`). Search excluded the caller's own recipes by default until 8a, so a line built from results would miss the main bus case: a question from another of the same person's sessions. The lookup takes the drafts nearest to the call's query vector, no less similar than the least similar result shown. It never takes an exemplar slot and never changes ranking.
- Own live drafts keep appearing in their person's results under their label, as today (slice 2, and recipe `7d034cb2` for search after 8a). Taking them out of exemplar slots, as 8b item 8 had planned, would change display selection inside a ranking file. The dispatch line adds the invitation beside the label instead.
- The headless exemption reads the depositing key's current `deposit_level`. A draft whose key row is gone (keys are hard-deleted) is judged like an ordinary key's. A stored marker would be a new column, which the ruling ruled out for liveness.

Terms and cast, as in the feature file: Pat (whose agents deposit, resolve, and search), Sam (a member of Pat's shared book), Dana (a member who deposits on Pat's behalf). K1 and K2 are ordinary keys of Pat's; H is a headless key of Pat's; DK is Dana's key. "Live" means: unverified, and either deposited by a headless key, or within its window (S10-L1 to S10-L3). "Expired" means unverified and not live. Verified, rejected and not-chosen drafts are resolved, and neither live nor expired.

**Baselines** at `381bf26`, measured with the slice 1 method before any code change (recorded in the build notes): remote `tools/list`, stdio `tools/list`, the shared-description total, and one check response and one search response over a fixed fixture with no draft nearby (bytes).

**Where it lives**

| # | Criterion | Evidence |
|---|---|---|
| S10-M1 | Liveness is one SQL expression in the authz module (`authz/draft-sql.ts`), `draftLive(alias)`, with `draftExpired(alias)` as unverified and not live. Every statement that excludes or counts expired drafts composes them, and no other backend file writes a liveness condition by hand. The window lengths are constants in `@soupnet/domain` (24 hours, 7 days), named once. | `draft-sql.test.ts`: the fragment over every combination of facts (state, deposit age, an unknown key; after 6a intent present, missing, recent, idle); two static guards (amended after verification, which found the third guard named here unbuilt): no backend file but `draft-sql.ts` imports the window constants, and no file but the module compares `draft_state`, which any liveness condition must. A regex over `interval` comparisons was judged too broad: other features compare times against intervals legitimately. |
| S10-M2 | Nothing is stored or swept: no migration, no column, no job, no write to `traces` or `intents` on any read path. A read never touches `intents.last_used_at` (only the existing joins on check, search and feedback do). | Diff review: no file under `packages/db/migrations/`; no `UPDATE` added; a Layer 3 test reads a draft by id, lists the queue and searches, then reads `last_used_at` back unchanged. |
| S10-M3 | The five ranking files are not edited, and `ranking-regression.test.ts` passes unedited. The search service computes the query vector before the pipeline and passes it in through the pipeline's existing `queryVectorStr` input, so the dispatch lookup can use it. | Diff review; the ranking-isolation test. |

**Liveness**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S10-L1 | A draft deposited with no intent is live for 7 days from `created_at` and expired after, by the database's clock in the same statement. It un-expires only by resolution (it has no intent to revive). | DT-BUS-01 (new) | Layer 3: two drafts with `created_at` set 6 and 8 days back by the test's own fixture SQL; the first is in the queue and `is:draft`, the second only in `is:expired`. |
| S10-L2 (after 6a) | A draft with an intent is live while that intent's `last_used_at` is within 24 hours, and expired when it is older, even inside 7 days. An intent id whose row is gone falls back to S10-L1. | DT-BUS-02 (new) | Layer 3 with `last_used_at` set 23 and 25 hours back, and a link to a deleted intent. |
| S10-L3 (after 6a) | Using the intent again (a check, a search or a feedback row carrying it) revives every draft deposited under it, with nothing written to the draft. | DT-BUS-03 (new) | Layer 3: an expired draft, then a search carrying its intent, then the queue lists it. |
| S10-L4 | A draft deposited by a headless key (`deposit_level` not `full`, read fail-closed the way roles.ts reads it) is live whatever its age or intent. A draft whose key row is gone is judged by S10-L1 to S10-L3. | DT-BUS-04 (new) | Layer 3 with H, an 8-day-old draft; and the same after H is deleted. |
| S10-L5 | An on-behalf draft's liveness is the depositor's: its intent, or its age when it has none. Pat's agents and Dana's see the same state. | DT-BUS-05 (new) | Layer 3: DK deposits about Pat, aged 8 days; it is expired for both. After 6a: Dana's intent recent, it is live for both. |

**Where expired drafts go**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S10-X1 | An expired draft leaves its person's review queue (`GET /traces/drafts`), the queue count (`GET /traces/drafts/count`) and the dashboard figure, and the default `is:draft` listing on every agent surface. | DT-BUS-01 | Layer 3 on the queue routes, MCP `search_recipes` and web `/check?filter=`. |
| S10-X2 | An expired draft leaves every result set its person's agents see: check and search results, their totals and clusters. It is never shown to anyone else, as before. | DT-BUS-06 (new) | Layer 3: a check whose nearest recipe is Pat's expired draft does not return it; the same draft live is returned with its label. |
| S10-X3 | `is:expired` lists the viewer's expired drafts about them (the `is:draft` population, expired), in the same order `is:draft` uses, and lifts the exclude-own default the way `is:draft` does. It combines with `impact:`, `uncertainty:`, `after:`, `before:` and semantic text. `is:draft is:expired` means the same as `is:expired`; `-is:expired` is refused as meaningless. Any other `is:` value is refused with the valid list, which now names both. | DT-BUS-07 (new) | Layer 1 in `search-query.test.ts`; Layer 3 on MCP and web. |
| S10-X4 | By id, an expired draft reads exactly as a live one did (`get_recipes`, `GET /recipes`, the detail page), with its label saying it expired and why, and it is resolvable by id through `verify_draft` and its REST twin, by reaction and from the queue's id-list link, with the slice 2 to 6c rules unchanged. A resolved draft is neither live nor expired. | DT-BUS-08 (new) | Layer 3: reject an expired draft over MCP, verify one over REST, and react Wrong to one on the web; each resolves with one audit row. |
| S10-X5 | Expiry deletes nothing: the row, its evidence and its audit rows are untouched, and the account export carries expired drafts as unverified drafts, as today. | | Layer 3: row and evidence counts before and after expiry; export test unchanged. |

**Dispatch in results**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S10-D1 | When a check or search returns at least one result and a live draft about the caller's user (in the call's book scope; amended after verification: not a draft the caller deposited about a colleague, which only its subject's agents can resolve, recipe `c21da2d1`) has a similarity to the query at least that of the least similar result shown and within 0.15 of the best match (amended after verification: the shown results are diverse, so the least similar alone let an unrelated draft count as near), the response adds one line after the exemplars and before related evidence: `Open question near this call: <id> (<story>, asked <date>). If your context settles it, resolve it; otherwise leave it.` The nearest such draft is named, and only one. | DT-BUS-09 (new) | Layer 3 on remote `check_recipe` and `search_recipes`. |
| S10-D2 | The draft this call just deposited is never named. A draft that is also one of the displayed exemplars may be named: the line is what tells the agent that the labelled exemplar is an open question it may settle, not evidence. | | Layer 3: a check with `draft: true` gets no line naming itself; a search whose top exemplar is a live draft names it. |
| S10-D3 | `<story>` is the first line of the intent's story only when the intent belongs to the caller's user; otherwise the parenthesis carries only `asked <date>`. A colleague's intent story never reaches anyone else (recipe `f2ae39b8`). Before 6a no draft has an intent, so the story never shows. | | Layer 1 on the line; Layer 3 after 6a with Dana's on-behalf draft named to Pat's agent without Dana's story. |
| S10-D4 | No line otherwise: no live readable draft nearby, a draft Sam's key cannot read, an expired draft, a resolved draft, a headless caller (which cannot resolve), and a zero-result call. The response is byte-identical to the same call with no drafts in the corpus, so the line's absence tells nothing. | DT-BUS-10 (new) | Layer 3: Sam's search near Pat's live draft is byte-identical (after ids and timestamps are normalized) to the same search with that draft deleted. |
| S10-D5 | Parity across surfaces: the same line in the remote MCP markdown, the stdio MCP markdown (relayed from REST), the web `/check` HTML and JSON, and a structured field (`openQuestion: { recipeId, story?, askedAt }`) in the structured response. | | Layer 1 renderer tests; Layer 3 on each surface. |
| S10-D6 | The lookup is bounded: at most the caller's 200 most recent live drafts in scope are compared, by the vectors the pipeline already fetches (`fetchTraceVectors`). It costs one bounded statement per call that has results and a query vector, and a vector fetch only when that statement finds a draft (amended after verification: as written the row promised no cost at all for a caller with no drafts, which no lookup can deliver without the statement that finds out). | | Code review; Layer 3: a caller with no live drafts gets no line. |

**Reading a resolved draft by id**

| # | Criterion | Scenarios | Evidence |
|---|---|---|---|
| S10-R1 | For the draft's subject (and so their agents), `get_recipes` and `GET /recipes` say how and when a resolved draft was resolved, for all three states: verified, rejected, not chosen. "How" is by the person (a reaction or the queue), by their agent (with the key's label when it has one), or by the agent that deposited it. "When" is the date. It appears as a structured field and in the label: for example `[rejected draft: rejected by your user's agent "K2" on 2026-10-25; its evidence says why]` (amended after verification: "your agent" would name the reading agent itself; the label speaks to an agent about "your user", so a key of theirs is "your user's agent", recipe `041d4bee`). A verified draft, which reads today as an ordinary recipe with no state, gains this for its subject only, so a polling agent can tell its question was answered. | DT-BUS-11 (new) | Layer 1 on the label; Layer 3 on MCP and REST per state and per resolver. |
| S10-R2 | For the depositor of an on-behalf draft, nothing changes (S4-M3 as narrowed by ruling 56): the unpublished states with no resolver and no date, and a verified one as an ordinary recipe. For anyone else, the uniform answer. | | Layer 3: Dana's `get_recipes` before and after Pat's agent resolves; Sam's equals a random id's. |
| S10-R3 | An expired draft's label says it expired and why: no activity on its task for over 24 hours (or 7 days since deposit with no intent), still answerable by id. | | Layer 1. |

**Counts**

| # | Criterion | Evidence |
|---|---|---|
| S10-K1 | The briefing's books block and `list_my_recipe_books` Drafts line counts live drafts about the user, and adds the ones that expired when there are any: "…await their review (only they and their agents see them); M expired unanswered in the last 7 days (search is:expired)", or "Drafts: none awaiting review; M expired …" when none are live. "Expired in the last 7 days" means the draft's window closed within the last 7 days. With none expired the line is today's, word for word (amended at build: keeping the wording keeps every existing fixture byte-identical). Shared figures still count published recipes only. | Layer 1 on the line; Layer 3 on `list_my_recipe_books`. |
| S10-K2 | The web queue shows the expired count under its list when it is not zero, with the `is:expired` query as a link that lists them in the queue (the queue accepts `is:expired` in place of its always-applied `is:draft`). | Layer 1 on the queue's query parsing; Layer 3 on `GET /traces/drafts?q=is:expired`; the browser run. |
| S10-K3 (after 9) | The intent lineage (`GET /intents/:id`) counts the intent's drafts that are live, expired, and resolved. | Layer 3 after E merges. |

**Copy and the web**

| # | Criterion | Evidence |
|---|---|---|
| S10-C1 | The detail page's state line for an expired draft reads "Unverified draft, expired" with a title saying its task has been quiet for over a day (or a week, with no intent), so it has left the queue, and that the person can still verify or reject it here. The reactions stay offered. A live draft's line is unchanged. | `draft-status-label.test.ts`; the browser run. |
| S10-C2 | The `is:expired` qualifier is named wherever `is:draft` is listed in agent-facing copy: the parser's refusal, and the `search_recipes` query description (stream B's line, edited after B merges and measured). | `mcp-tool-descriptions.test.ts`; size tests. |
| S10-C3 | The feature file gains DT-BUS-01 to DT-BUS-11 tagged `@slice-10` (02 and 03 `@unreleased` until 6a). The briefing line about drafts as questions on a bus lands with this slice, in the "## Drafts" section stream C's C1 and C2 add, just before "With sub-agents, work live:", with its `checking-behavior.feature` scenario, when this branch rebases after C (stream C, 2026-10-25: a line describing expiry should not ship before expiry does). Its voice keeps clear of "must", "never", "always", "do not" and "don't", which C2's voice test refuses in that section. | Diff review; C2's voice test. |

**Budgets**

| # | Criterion | Evidence |
|---|---|---|
| S10-Z1 | Remote and stdio `tools/list` and the shared-description total stay under the caps in force when this PR opens, with bytes before and after recorded here and in `spec-decision-log.md`. | Size tests; the figures. |
| S10-Z2 | A check or search with no live draft nearby is byte-identical to the baseline response. With one, the response grows by exactly the dispatch line (measured and recorded). | Layer 3 byte comparison against the baseline fixture. |

**Surfaces that must change:** `authz/draft-sql.ts` (the two fragments, composed into the viewer audience and the review set), `authz/trace-access.ts` (expiry on the detail read), `services/draft-queue.service.ts` (live only, the `is:expired` form, the count), `services/search-selection.ts` (the `is:` selections), `packages/domain/src/search-query.ts` (the qualifier), `services/book-stats.service.ts` and the Drafts line in `recipe-guide-content.ts`, `services/recipe-lookup.service.ts` and `draftLabel` in `packages/domain/src/drafts.ts` (resolution and expiry in the label), a new `services/draft-dispatch.service.ts` and the response renderers (`check-response-renderer.ts`, the web `/check` page in `routes/check.ts`), the search service (passing the query vector in), `apps/frontend/src/lib/draft-status-label.ts` and the queue page, the drafts tests, the feature file, `spec-decision-log.md`.

**Surfaces that must not change:** the five ranking files and `ranking-regression.test.ts`; `authz/draft-resolution.ts` (resolution is untouched); the `intents` table and every write to it; `packages/db/migrations/`; `traceVisibleTo(…, SHARED_AUDIENCE)` (shared surfaces never saw drafts); the tool roster and every tool's schema.

**Security properties the verifier must see proven**

- No new oracle. Liveness, expiry and the dispatch line are computed only over drafts the viewer could already read. A collaborator's response near someone else's draft, live or expired, is byte-identical to one with the draft absent (S10-D4, S10-R2).
- Nobody's intent story reaches anyone else (S10-D3). Liveness reads another person's intent timestamp only for a draft about the viewer that the other person deposited. That tells the subject, as an expired state, that the depositor's task has been quiet for a day; the ruling accepts this (on-behalf drafts follow the depositor's intent).
- Expiry never widens access, deletes, or blocks resolution (S10-X4, S10-X5).
- The headless exemption cannot be claimed by an ordinary key: it reads the depositing key's stored level, fail-closed (S10-L4).

**Briefing-copy declaration.** The dispatch line, the Drafts line, the labels, the qualifier's refusal and the `search_recipes` description are agent-facing copy under [../briefing-specs/README.md](../briefing-specs/README.md) §The regression rule. The PR appends one `spec-decision-log.md` entry with the bytes before and after, and every copy change lands with the scenario it moves.

**Questions for the operator** (numbered 10-n; 10-1 is the revision doc's window question)

None open at the time of writing. The calls above were made under the confidence rule and checked; any that a reviewer would reverse is cheap to reverse before merge.

### Slice 10 build notes (stream A, 2026-10-25)

Built on `drafts/10-bus` from `main` at `381bf26`, rebased onto `f6b85f4` (#139, 8a) without conflict. Commits: the rubric; the domain vocabulary (windows, `is:expired`, the dispatch line, labels, the Drafts line); liveness on the read paths; the dispatch line; the web; the Layer 3 suite and docs.

**Calls made, each recipe-checked in `soupnet-oss` under intent `int_B5rF0m1PZBmMmZCfzepGWEXV` and closed with feedback**

- The no-intent window is 7 days from deposit, not the depositing key's activity (`fd614c86`).
- Expired drafts leave every result set the person's agents see, not only the queue and `is:draft` (`f1c99ec8`).
- The dispatch line comes from its own lookup over the caller's live drafts, not the exemplars; no ranking file changes; a headless caller gets none; an intent's story only when it is the caller's (`bff6f47b`).

**Found while building**

- The floor comparison needs a tolerance. A draft identical to the call scores a hair under 1 in the lookup's cosine (the pipeline scores from a halfvec copy), so "no less similar than the least similar result shown" is measured to half a percent, the precision results are shown at (`SIMILARITY_TOLERANCE` in `draft-dispatch.service.ts`).
- The mint response carries no key id, so the Layer 3 test finds a key to delete by its label in `GET /keys`.
- The search grammar reads a parenthesis as an OR group, so a recipe text with a parenthetical cannot be searched by its own text. Stream B's branch fixes this for prose (`f50a1c0`). The suite's recipes avoid parentheses.
- Under stub embeddings only identical text is reliably near, so the dispatch tests check from a second key with the draft's own text (dedupe is per key). Result-set tests select by a unique quoted token, which runs without vectors.
- S10-D2 was amended before building: a draft that is also a displayed exemplar may be named, since the line is what tells the agent that the labelled exemplar is an open question.

**Waiting on other streams** (each a row marked in the rubric)

- 6a (stream B, next to merge): the intent arm of `draftWindowOpen` and `draftWindowClosesAt` in `authz/draft-sql.ts`, the `intent_idle` reason, the story in the dispatch line (owner-only), DT-BUS-02 and 03, and `is:expired` in the `search_recipes` description. B confirmed the column contract on 2026-10-25 and names this slice in its PR notes.
- 9 (stream E, #140): the lineage counts (S10-K3).
- C1 and C2 (stream C): the bus line in the briefing's "## Drafts" section with its scenario (S10-C3).

**Environment note.** The shared dev backend on 3101 was built on 2026-09-29, before 6c, so Layer 3 suites run against it test old code. This slice's Layer 3 suite ran against the worktree's own backend on 127.0.0.1:3144 over a throwaway database, `soupnet_e2e_10`.

**Gate.** `TESTCI_PGPORT=5544 npm run test:ci`: the first run failed two tests. `draft-queue.test.ts` S3-A6 asserted the subject's by-id label `[draft not chosen]`, which S10-R1 extends with who and when; the assertion now names the new form. `auth-delete-shared-books.test.ts` "succession skips accounts that cannot act" failed once and passed three times out of three alone; it touches nothing this slice changed and is in the backlog as a flake. The second run passed: 2,005 tests, 6 skipped, exit 0. The slice's own suite, `drafts-bus.test.ts`, has 12 tests over S10-L1, L4, L5, X1 to X5, D1, D2, D4, D5, R1 to R3, K1 and M2.

### Slice 10 verification record

Written 2026-10-25 by the verifier (agent `a-drafts-verify-10-2026-10-25`, Soup.net intent `int_PEBOdcUaDV5YyRRUeu6KZYDl`), who did not build the slice and changed no application code, test or rubric. Verified at `589e0ba` in the `a-resolution` worktree, against the branch's backend on `127.0.0.1:3144` over the throwaway database `soupnet_e2e_10` (stub embeddings, rate limiting off). Rows are graded pass, fail, or not built yet; a row whose behaviour was proven but whose rubric-named evidence is missing passes with the gap stated, and the gap is listed below as a finding to close (recipe `21d39214`).

**Verdict: 25 pass, 2 fail, 3 not built yet (deferred, per rubric).** Neither failure is a security property. Every security property the rubric lists held under probe: a collaborator's search near Pat's live draft was byte-identical to the same search after the draft was deleted, on MCP markdown, MCP structured and web JSON; nobody but the subject saw a resolver or date; no key can claim the headless exemption; expiry deleted nothing and blocked no resolution path.

**How it was verified.**

- **Unit and Layer 1:** `draft-sql.test.ts`, `deposit-level.test.ts`, `trace-access.test.ts`, `drafts.test.ts`, `search-query.test.ts`, `check-response-renderer.test.ts`, `recipe-guide-content.test.ts`, frontend `draft-queue.test.ts` and `draft-status-label.test.ts`, `ranking-isolation.test.ts`, `mcp-tool-descriptions.test.ts`, `mcp-tools-list-size.test.ts` and the `apps/mcp-server` suite: all passed. `npm run check:authz-seam` passed.
- **Layer 3 against 3144** (with the gate's test env: stub embeddings, empty `GEMINI_API_KEY`, `DISABLE_RATE_LIMIT`): `drafts-bus.test.ts` 12 of 12 and `ranking-regression.test.ts` passed. `draft-queue.test.ts` passed except S3-A3 (401 for 404) and S3-L6 (the queue link's host is `127.0.0.1:5294`, the test expects `localhost:5273`), both from this backend's `JWT_SECRET` and `FRONTEND_URL` differing from the test process's `.env`; the builder's gate passed them.
- **Probes:** two suites of the verifier's own, kept outside the repo (scratchpad `verify-10/bus.probe.ts` and `bus2.probe.ts`), seeding Pat, Sam and Dana the way `drafts-bus.test.ts` does, plus Pat keys K1, K2, an unlabelled key, a personal-book-only key and a headless key. The only database write was moving `created_at` back.
- **Diff review** of `f6b85f4..589e0ba`: the five ranking files, `ranking-regression.test.ts`, `authz/draft-resolution.ts`, `packages/db/` (migrations included), `packages/contracts/` and `apps/mcp-server/` are untouched; `routes/mcp.ts` changes in one hunk, `buildMcpJsonResponse`, so no tool or parameter description changed; no `INSERT`, `UPDATE` or `DELETE` is added outside tests.

**Where it lives**

| # | Verdict | Evidence |
|---|---|---|
| S10-M1 | pass (gap: the static guard) | `draftLive` and `draftExpired` live in `authz/draft-sql.ts` and every expiring statement composes them; a grep finds no hand-written window on `traces` outside the module, and the windows are named once in `packages/domain/src/drafts.ts`. Gap: the guard the row names was not built. `draft-sql.test.ts` only checks that no other file imports the window constants, so a hand-written `created_at > NOW() - interval '7 days'` on `traces` would pass, and the seam's `DRAFT_FRAGMENT` list was not extended to the new names. The facts table also leaves out the headless key, which only Layer 3 S10-L4 covers. |
| S10-M2 | pass | No file under `packages/db/migrations/`, and no write added. S10-M2 Layer 3 test: `intents.last_used_at` and the draft row are unchanged after a queue listing, `is:expired`, `get_recipes` and the detail read. |
| S10-M3 | pass | The ranking files are unedited; `ranking-isolation` and `ranking-regression` pass. `searchWithoutLogging` now embeds with the same `embedQuery(…, "SEMANTIC_SIMILARITY")` call the pipeline makes, and passes the vector in through `queryVectorStr`. |

**Liveness**

| # | Verdict | Evidence |
|---|---|---|
| S10-L1 | pass | Layer 3 "S10-L1 / S10-X1 …": drafts aged 6 and 8 days split between the queue and `is:expired`. `draftWindowOpen` compares against the database's `NOW()` in the calling statement. Layer 1 DB test: ages 0, 6.9, 7.1 and 30 days in every state. |
| S10-L2 | not built yet (deferred, per rubric: after 6a) | `draftExpiryReason` returns only `'age'`; DT-BUS-02 is tagged `@unreleased`; the build notes list it as waiting. The `intent_idle` label text is present but cannot be reached. |
| S10-L3 | not built yet (deferred, per rubric: after 6a) | No intent arm exists; DT-BUS-03 is tagged `@unreleased`. |
| S10-L4 | pass | Layer 3 "S10-L4 / DT-BUS-04": a 30-day-old headless draft stays in the queue, then moves to `is:expired` once its key is deleted. The fragment reads `lk.deposit_level IS DISTINCT FROM 'full'` (the column is `NOT NULL DEFAULT 'full'`). `traces.api_key_id` is written only by the deposit `INSERT`, from the authenticated key, and `deposit_level` is never updated (S5-S2 test), so an ordinary key cannot claim the exemption. |
| S10-L5 | pass | Layer 3 "S10-L5 / DT-BUS-05": Dana's on-behalf draft aged 8 days leaves Pat's queue, is listed by `is:expired`, and reads `draftExpiry: "age"` on both parties' detail reads. The intent half of the row is after 6a. |

**Where expired drafts go**

| # | Verdict | Evidence |
|---|---|---|
| S10-X1 | pass | Layer 3: the queue, `/traces/drafts/count` (which the dashboard reads) and MCP `is:draft` drop the expired draft. Probe: web `/check?filter=is:draft <tag>` leaves it out and `is:expired <tag>` returns it. |
| S10-X2 | pass | Layer 3 (search) and a probe on a check: K2's check with the same text returned Pat's live draft (total 5), and after the draft aged 8 days it returned neither the draft nor a count for it (total 4, although one more recipe now existed). Sam, Dana and a personal-book-only key never saw it, live or expired (probes P1 and P2). |
| S10-X3 | pass | `search-query.test.ts` "parseSearchQuery — is:expired". Probe on MCP: `impact:high` and `uncertainty:low` match, `impact:low` does not, `after:2020-01-01` matches, `before:2020-01-01` does not, `is:draft is:expired` equals `is:expired`, and semantic text with `is:expired` returns only the expired twin, on the queue and on agent search. The refusals for `-is:expired`, `is:bogus` and `is:expired -is:draft` reach MCP and web JSON with the valid list naming both. |
| S10-X4 | pass | Layer 3 "S10-X4 / S10-X5 / S10-R3 / DT-BUS-08": MCP reject, REST verify and a web Wrong reaction each resolve an expired draft with one audit row. Probe: `GET /traces/drafts?ids=<expired>` lists it with `expired: true` and `canResolve: true`, and `POST /traces/:id/not-chosen` on it returns 200. A resolved draft is in neither set. |
| S10-X5 | pass | Layer 3: evidence, audit and row counts are unchanged by ageing. Probe: `GET /auth/me/export` carries the expired draft with `draft_state` `unverified`. |

**Dispatch in results**

| # | Verdict | Evidence |
|---|---|---|
| S10-D1 | pass | Layer 3 "S10-D1 / S10-D5 / DT-BUS-09" on remote `search_recipes`, `check_recipe` and the web page. The wording is the rubric's, character for character (`openQuestionLine`). Probe: on a check the line sits after exemplar #1 and before related evidence. |
| S10-D2 | pass | Layer 3 "S10-D2": a `draft: true` check does not name itself (`excludeTraceId`). Probe P4: K1's `author:me` search, whose top result was its own live draft, named that draft. |
| S10-D3 | pass | Layer 1 "without a story … the parenthesis carries only the date" and the excerpt test. `findOpenQuestion` never sets `story`, so before 6a no story can reach anyone. The Layer 3 half is after 6a. |
| S10-D4 | pass (gap: the named byte test) | Probe P1: Sam's search near Pat's live draft, in MCP markdown, MCP structured, web JSON and `is:expired`, was byte-identical after normalising ids and timestamps to the same search after Pat deleted the draft. Median by-id read time was 4 ms for the draft id and for a random id. No line for a headless caller's check or search, a zero-result call, a resolved draft (probe Z2), an expired draft (Layer 3), or a draft outside the key's scope (P2). Gap: the Layer 3 suite asserts only that no line appears, not the byte identity the row names. |
| S10-D5 | pass | Layer 3 on MCP markdown, structured and web HTML. Probe: web JSON carries `data.openQuestion`, and `renderCheckResponseMarkdown`, the stdio server's renderer, prints the line from that JSON. |
| S10-D6 | fail | Capped at 200 drafts, newest first, and compared through `fetchTraceVectors`: as the row says. But a caller with no live drafts still pays the candidate `SELECT` on every call that has results and a query vector; only the vector fetch is skipped. The row says none, and the zero-draft test it names does not exist (defect 1). |

**Reading a resolved draft by id**

| # | Verdict | Evidence |
|---|---|---|
| S10-R1 | pass | Layer 3 "S10-R1 / DT-BUS-11" on MCP and REST, plus probes: a queue not-chosen reads "by your user"; an unlabelled key reads "by one of their agents"; a resolution whose key was later deleted reads "by one of their agents" (no label leaks, and it is not misattributed to the person); a verified on-behalf draft gives Pat `draftState: "verified"` and `draftResolution`. The wording differs from the row's example ("by their agent" for "by your agent"): see Found, item 1. |
| S10-R2 | pass | Layer 3 "S10-R2". Probe P6: after Pat's K2 verified Dana's on-behalf draft, Dana's `GET /recipes` and detail read carry no `draftState`, `draftResolution` or resolver fields, and Sam's carry no state either. |
| S10-R3 | pass | `drafts.test.ts` "an expired draft says it expired, why, and that it can still be resolved by id". Layer 3 `get_recipes` shows `Draft: [expired draft: it was deposited with no intent over 7 days ago…`. |

**Counts**

| # | Verdict | Evidence |
|---|---|---|
| S10-K1 | pass | `recipe-guide-content.test.ts` "S10-K1"; Layer 3: the 9-day draft counts, and a 30-day draft (window closed 23 days ago) does not. Probe: `get_briefing` shows "Drafts: 3 unverified drafts about your user await their review (only they and their agents see them); 3 expired unanswered in the last 7 days (search is:expired)". Sam's books block has no Drafts line. |
| S10-K2 | pass (gap: browser run, Layer 1 queue parsing) | Layer 3: `GET /traces/drafts?q=is:expired` lists only the expired drafts, `expiredTotal` is set, and `queueExpiredText` has Layer 1 tests. Gaps: there is no Layer 1 test of `parseQueueQuery` or `forceDraft` with `is:expired`, and no browser run of `/app/drafts`, since no frontend runs against this backend and the build notes record none. |
| S10-K3 | not built yet (deferred, per rubric: after 9) | No lineage change in the diff; the build notes list it as waiting on stream E. |

**Copy and the web**

| # | Verdict | Evidence |
|---|---|---|
| S10-C1 | pass (gap: browser run) | `draft-status-label.test.ts`: "Unverified draft, expired", the week and day reasons, the depositor's variant, the reactions still offered, and a live draft unchanged. `GET /traces/:id` carries `draftExpiry` to `TraceDetailPage`, which reads it through `draftStatusLabel`. No browser run. |
| S10-C2 | fail | The parser's refusal and its valid list name `is:expired` (Layer 1, probe). The `search_recipes` description is deferred to after B, as the row says. But the web `/check` page's search help (`routes/check.ts:1066`), agent-facing copy that lists `is:draft`, does not name `is:expired` (defect 2). |
| S10-C3 | pass | DT-BUS-01 to 11 are tagged `@slice-10`, with 02 and 03 `@unreleased`. The briefing's bus line waits for C1 and C2, as the row says, and nothing in the diff adds it early. |

**Budgets**

| # | Verdict | Evidence |
|---|---|---|
| S10-Z1 | pass (gap: figures not recorded) | No tool or parameter description is in the diff, and the size tests pass. The verifier's probe measured remote `tools/list` `result` at 17,630 bytes across 8 tools. Gap: the row asks for before and after bytes "here and in `spec-decision-log.md`", and neither records a figure. The rubric's "Baselines" paragraph also promised baselines in the build notes, and none are there. |
| S10-Z2 | pass | Probe Z2, in a fresh book with only Dana's published neighbours and Pat's draft, searching with `-author:me` so the draft is not among the results: the markdown was 1,462 bytes with the line and 1,314 after the draft was resolved, a difference of exactly the 148-byte line with its two newlines. With the line removed the two were byte-identical, and the structured responses differed only in `openQuestion`. The comparison is with-line against without-line on this branch; the pre-slice baseline was never recorded (S10-Z1 gap). |

**Defects**

1. **S10-D6: the dispatch lookup costs a statement when the caller has no live drafts.** Scenario: any check or search by a caller with no live drafts, at least one result and a query vector. What happens: `findOpenQuestion` runs `SELECT t.id … FROM claimnet.traces t WHERE inBooks … AND traceVisibleTo … AND draftLive … LIMIT 200` and returns only after it comes back empty. The row says no cost in that case, with a zero-draft test to show it. Responsible, my reading: `apps/backend/src/services/draft-dispatch.service.ts` `findOpenQuestion`, whose early returns cover a headless caller, no vector, no books and no shown results, but not a caller with no drafts. Either the bound is met (for example by folding the candidate check into a statement the call already makes) or the rubric is amended to "one statement, plus one vector fetch when there are candidates". It is not an oracle: the statement reads only the caller's own drafts.
2. **S10-C2: the web check page's search help does not name `is:expired`.** Scenario: an agent opens `/check` with a key and expands "Search syntax & tips". What happens: the list says "`is:draft` lists your own drafts awaiting review" and stops there, while the row asks for `is:expired` wherever `is:draft` is listed in agent-facing copy. Responsible, my reading: `apps/backend/src/routes/check.ts`, `renderPage`, the `search-help` list item.

**Evidence gaps to close** (rows that pass on behaviour): the S10-M1 static guard against a hand-written window, plus the headless key in its facts table; S10-D4's byte-identity test (the verifier's probe shows the property); the S10-Z1 byte figures and the rubric's baselines; the browser run for S10-C1 and S10-K2; a Layer 1 test of the queue's `is:expired` parsing (S10-K2); and S10-X2's named check case, which the suite proves on search only (the verifier's probe covers the check).

**Found, not in the rubric**

1. **The resolver wording in by-id labels (a question for the operator).** The row's example reads `rejected by your agent "K2"`; the build ships `rejected by their agent "K2"` next to `verified by your user`, so one label set mixes "your user" with a "their" that has no antecedent in the label. The build notes record no deviation, and the Layer 3 suite asserts the shipped words. Deposited as draft `041d4bee` for the operator's ruling.
2. **The dispatch floor can name an unrelated draft.** The floor is the least similar result shown, and clustered exemplars can sit far from the query: in probe P5 the third exemplar was at -1%, so any live draft in scope qualified, and the line named a headless draft on another topic. Stub embeddings exaggerate this, but MMR-diverse exemplars can be distant under real embeddings too. A minimum similarity for the line, or the nearest result's similarity, would keep "near this call" true.
3. **Headless drafts never expire, so they stay dispatch candidates for good.** A headless key's check deposits a forced draft (probe P4), and with item 2 that draft can be named in every later check or search by the person's ordinary agents in its books. This follows the ruling (headless drafts are exempt); it is worth watching once slice 9 measures dispatch.
4. **The depositor is invited to resolve what it cannot.** Dana's agent searching near her on-behalf draft about Pat gets the dispatch line, "If your context settles it, resolve it" (probe P4), but `verify_draft` refuses the depositor. The rubric's D1 includes depositors ("subject or depositor"); the ruling's on-behalf bullet says "the subject's agents see the dispatch line". The agent-facing expired label likewise tells the depositor "it can still be verified or rejected by id", while the web title for the same case says only the subject can.
5. **The expiry reason in queue and grammar copy describes the deferred arm.** The queue's line and item text ("the task that asked it went quiet") and the parser refusal ("is:expired the ones whose task went quiet") give the intent reason, but before 6a every expiry is the 7-day no-intent window. The detail page title gets this right ("deposited over a week ago with no task attached").
6. **The published schema's `filter` description** (`packages/contracts/src/recipe.ts`, `/schemas/check-response.json`) lists `is:draft` without `is:expired`. It is a field description, not a tool parameter, so it falls outside the row's "every tool or parameter description is untouched".
7. **Environment note for later verifiers.** `ranking-regression.test.ts` and the other Layer 3 suites read `BACKEND_URL` and `EMBEDDINGS_PROVIDER` from `.env` (3101, gemini) unless they are overridden. The verifier's first run of `ranking-regression.test.ts` passed only the database variables, so it seeded users in `soupnet_e2e_10` and then sent login requests to the shared dev backend on 3101, which failed, because those users don't exist there. Pass the gate's full test env (`BACKEND_URL`, `EMBEDDINGS_PROVIDER=stub`, `GEMINI_API_KEY=`, `DISABLE_RATE_LIMIT=true`) when running suites against a worktree backend.

**Recipe checks made** (book `soupnet-oss`, intent `int_PEBOdcUaDV5YyRRUeu6KZYDl`): a search for how to grade a row whose named evidence is missing (it surfaced `21d39214`, which this record follows); `0a51069c`, grading S10-D6 as a fail because its cost bound is behaviour rather than evidence (proceeded); and draft `041d4bee`, the resolver wording, left for the operator. Each was closed with feedback.

### Slice 10 after verification (stream A, 2026-10-26)

The verifier's record is above. Each finding, and what was done:

- **S10-D6, fail.** The row promised no cost for a caller with no drafts; the lookup's one statement is what finds that out. The row is amended to the cost the code has, the statement now uses the review set (`draftLiveAwaitingReviewBy`), and a Layer 3 test pins that such a caller gets no line.
- **S10-C2, fail.** The web `/check` page's search help now names `is:expired` beside `is:draft`, and so does the `filter` field's description in `packages/contracts/src/recipe.ts` (Found 6).
- **S10-M1, gap.** The row named a third static guard that was not built; the row now records the two that are, and why a regex over interval comparisons was not added.
- **S10-D4, gap.** The verifier's byte-identity probe is now a test in the suite: Sam's search near Pat's live draft (MCP markdown, structured, and web JSON) equals the same search after the draft is deleted.
- **S10-K2, gap.** A Layer 1 test of the queue's parsing of `is:expired` (`draft-queue-query.test.ts`).
- **S10-Z1, gap.** No tool or parameter description changed; the verifier measured remote `tools/list` at 17,630 bytes at `589e0ba`, which is `main`'s figure since the schema is untouched.
- **S10-C1, S10-K2, no browser run.** The browser run follows.
- **Found 1, resolver wording.** Adopted the verifier's proposal, "by your user's agent "K2"" and "by one of your user's agents", in the voice the rest of the label uses ("your user"). Draft `041d4bee` is closed with that.
- **Found 2, the floor.** A draft must also be within 0.15 of the best match, the ranking's own band (recipe `c21da2d1`); `pickOpenQuestion` is pure and unit-tested, including the verifier's -1% case.
- **Found 3, headless drafts as standing candidates.** By the ruling: a headless key's drafts are exempt from expiry because the person's queue is their listener, and naming them to the person's agents nearby is the bus working. Unchanged.
- **Found 4, the depositor.** The line now names only drafts about the caller's user, and an expired draft's label for its depositor says only its subject can still verify or reject it.
- **Found 5, "task went quiet" copy.** The queue's count line, its item note, its search hint and the parser's refusal now say "expired unanswered"; the detail page and the agent labels already give the reason per draft.
- **Found 7, the test environment.** Recorded in the build notes' environment note; the gate supplies the full environment.

Layer 3 after the fixes: `drafts-bus.test.ts` 15 passed against the worktree backend.


Gate after the fixes, at `7cba461`: the first run stopped at the seam check (the dispatch service's fingerprint, refreshed in `7cba461`); the next had every test pass but hit the tracked vitest worker crash ("Worker exited unexpectedly", backlog); the rerun passed, 2,015 tests, 6 skipped, exit 0.

### Slice 10 browser verification (2026-10-26)

Run by the browser-verify skill at `7cba461` on the worktree stack (backend 127.0.0.1:3144 over `soupnet_e2e_10`, Vite 127.0.0.1:5294). Expectations, results and the harness handback are in the private repo's `docs/working/browser-verification/2026-10-26-drafts-10/`. 14 passed (13 desktop, 1 mobile): E1 to E12 met, E13 open as framed.

- E13 (the web check page's open-question line): shown after the results, naming a draft that was also the only result. That is the S10-D2 amendment working. The "asked" date is the UTC day, as every agent-facing date is ("Logged", the labels). Both stand.
- Fixed from "Found, not listed": the queue's search hint lacked a space before `is:expired`; the expired listing kept the heading "Drafts awaiting your review" and now reads "Drafts that expired unanswered"; the dashboard and book list rows showed an expired draft as "[Unverified draft]", since `GET /traces` rows carried no expiry. They now carry `draftExpiry` through a new module fragment, `draftExpiryShownTo` (only where the viewer sees the draft's state), and read "[Unverified draft, expired]"; Layer 3 pins Dana's row and Sam's absence.
- Left as is: the expiry explanation is a tooltip on the status line, as every draft status line's is; Pat sees the same expiry as the depositor on an on-behalf draft (S10-L5); a `/check` filter with parentheses errors (pre-existing, stream B's prose-parenthesis fix).
- The spec is kept as `tests/e2e/drafts-slice10.spec.ts` (the standing answer: recipes `840d65ab`, `dfb89586`), with the database it ages drafts in taken from `E2E_PGDATABASE` or the `.env`, not hard-coded. 14 passed again after the fixes, and `drafts-bus.test.ts` 15 passed.

### Slice 10 after the rebase onto 6a (stream A, 2026-10-26)

Slice 6a merged (#142) while this branch waited, so the branch is rebased onto `c21f421` and the deferred rows are built. The rebase's conflicts were each two additions side by side: the parser's qualifier help and its `is:` and `intent:` branches; the queue's result type, its empty-scope return and its row type (B's `notice` and intent grouping beside the expired total); the exclude-own lift (`is:expired` beside `intent:`); the web `/check` help (`is:expired` beside B's `intent:` line); the queue page's hint and item, now rendered by B's `renderItem` with the expired note in it; the feature file and the decision log (B's rule and entry beside this slice's). Seam fingerprints were refreshed for the files both slices touched.

- **S10-L2, S10-L3 (built).** `draftWindowOpen` and `draftWindowClosesAt` read the depositing intent's `last_used_at` through one subquery, `intentLastUsed`, joined on the id alone: a draft whose intent row exists is live while that intent was used within 24 hours, and one with no intent, or whose intent row is gone, keeps the week. `draftExpiryReason` now says `intent_idle` or `age`. Layer 3: an intent idle 25 hours expires a day-old draft, 23 hours keeps it, a deleted intent falls back to the week, a search carrying the intent revives the draft with nothing written to it, and an on-behalf draft follows its depositor's intent (DT-BUS-02 and 03 lose `@unreleased`).
- **S10-D3 (built).** The dispatch lookup joins the intent's story only when the intent is the caller's user's own (`oi.user_id = viewer`, the queue's join). Layer 3: Pat's agent sees its own intent's story on the line, and a line naming Dana's on-behalf draft carries only the date.
- **S10-C2 (built).** `is:expired` in the `search_recipes` query description, 413 of 420 characters; remote `tools/list` 17,642 → 17,649 bytes, stdio 14,145 → 14,152, shared descriptions 6,386 → 6,393 (decision log).
- **Registers.** `authz/intent-link.test.ts` registers the two new readers of `intent_id`, `authz/draft-sql.ts` (the last-use timestamp, never the story) and `services/draft-dispatch.service.ts` (the owner-only story). The `traces.intent_id` schema comment names them.
- **Still waiting:** S10-K3 (the lineage counts) on slice 9 (#140), and the briefing's bus line on stream C's C1 and C2.

Layer 3 after the rebase: `drafts-bus.test.ts` 19 passed against the worktree backend (`soupnet_e2e_10`, migrated to 6a's `0042` at startup).


Gate at `a52c79d`: one run failed one test, `draft-queue.test.ts` S3-A1, whose audit query took the newest row by `occurred_at` and got the deposit's `recipe.checked` instead of the not-chosen row; it passed three times out of three alone. Both rows take the database's `NOW()` and the deposit's is awaited first, so a backward clock step in the database VM is the explanation that fits (recipe `2f40fb9f`). The query now selects the resolution's own row by action. The rerun passed: 2,070 tests, 6 skipped, exit 0. The browser specs `drafts-slice10` and `drafts-slice6c` passed on the rebased stack (25 on both projects).

### Slice 10 after slice 9 merged (stream A, 2026-10-26)

`main` (with slice 9, #140, and C1, #138) is merged into the branch rather than rebased, since the branch is on origin (the planning session's direction: a rebase would need a force-push). The merge's conflicts were each two additions side by side: the intent-link register (this slice's `authz/draft-sql.ts` beside slice 9's second `routes/auth.ts` mention), the `traces.intent_id` schema comment (each slice's readers, now listed together), the decision log (this entry above C1's), and a refreshed seam fingerprint.

- **S10-K3 (built).** `GET /intents` and `GET /intents/:id` count an intent's draft deposits under `counts.drafts`: `live`, `expired` and `resolved`, each as the viewer sees the draft's state (`draftStateShownTo` composed with `draftLive` and `draftExpired`), so the depositor of an on-behalf draft never learns from a count that its subject verified it. Slice 9's three exact assertions on `counts` gain the field. Layer 3: one live and one rejected draft under an intent count `{ live: 1, expired: 0, resolved: 1 }`, and with the intent idle 25 hours, `{ live: 0, expired: 1, resolved: 1 }`. `drafts-bus.test.ts`: 20 passed.
- **Still waiting:** the briefing's bus line on C2 (#146), settled at 114 characters against C2's Drafts section ("A draft is a question on a bus: it stays live while your intent is in use, and expires once your task goes quiet.").

### Slice 10 after C2 merged (stream A, 2026-10-26)

`main` with C2 (#146) is merged in (a merge commit; only the decision log conflicted, this entry kept above C2's). The bus line is in C2's "## Drafts" section, just before "With sub-agents, work live:": "A draft is a question on a bus: it stays live while your intent is in use, and expires once your task goes quiet." Thin briefing 22,681 → 22,795 of 22,800, headless 23,081 → 23,195 of 23,200; no cap moved. Its scenario is in `checking-behavior.feature`. S10-C3 is built, and every slice 10 row is now built.

### Slice 10 record on `main` (stream A, 2026-10-26)

The closing audit of slices 6 to 10 asked for this record to say what became of the rows the verification table above lists as deferred (S10-L2, S10-L3, S10-K3). Those three rows were built after that table was written (the two headings above), so the table's "not built yet" entries are superseded. An agent that did not build them re-read the code and tests at `main` `5b81097`, where CI passed:

- **S10-L2: pass.** `intentLastUsed` and `draftWindowOpen` in `authz/draft-sql.ts` keep a draft live while its intent was used within 24 hours and fall back to the week when the intent row is gone (`traces.intent_id` has no foreign key, so the deleted-intent case is a real dangling id). Carried by "S10-L2 / DT-BUS-02" in `drafts-bus.test.ts`.
- **S10-L3: partial, then corrected.** Check, search and briefing revive an intent's drafts. A standalone feedback row does not: the only writer of `intents.last_used_at` is `resolveIntent`, and feedback is join-only by design (`log_feedback` never registers or touches an intent). The row's "or a feedback row carrying it" was wrong, and so was S10-M2's "check, search and feedback". Both are corrected here to **a check, a search or a briefing carrying the intent**, rather than giving feedback a new write. A new Layer 3 test pins the corrected row: two drafts under one intent, a feedback row alone revives neither, and a check carrying the intent revives both ("S10-L3: a check carrying the intent revives every draft under it; a feedback row alone does not").
- **S10-K3: pass.** `GET /intents/:id` counts live, expired and resolved drafts as the viewer sees their state. Carried by "S10-K3" in `drafts-bus.test.ts`, whose comment no longer says a draft is aged past the week, since the expired bucket is reached through an idle intent.

Coverage the re-read found thin and left as it is: no unit case in `draft-sql.test.ts` on the intent arm (the Layer 3 rows carry it), and nothing ages a deleted-intent draft past the week to show it then expires.
