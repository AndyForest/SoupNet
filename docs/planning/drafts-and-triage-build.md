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

**Surfaces that must NOT change:** ranking math (`mmr.ts`, `ranking-config.ts`, the scoring in `hybridSearch`), with `ranking-regression.test.ts` passing unchanged; the idempotency key; `session_shown` and `intent_shown` semantics (rendering only); reaction vocabulary and `fetchBookStats` reaction counts; `api_keys` schema (headless is slice 5).

**Security properties the verifier must see proven**

- Every read path in the inventory is covered: a test per row group, or a registered static reason.
- Exclusion is enforced in one place (S2-M1) and guarded statically (S2-M2).
- No existence oracle: uniform responses as above, including prefix ambiguity, feedback acceptance, move, and delete.
- Ratings and draft state are never read by ranking (the static test from slice 1 extended to the draft and verification columns).
- The audit role's findings are recorded in the private repo, and this log records only that the audit happened and whether blocking findings were closed.

**Briefing-copy declaration.** Slice 2 adds the `draft` parameter description and the verify tool description (tool copy, so declared under the regression rule) with a new `@unreleased` briefing-spec scenario: a briefed agent drafts only when it cannot ask and the call clears the impact and uncertainty bar, and says why it couldn't ask in the first evidence interpretation. The full when-to-draft guidance in the briefing body stays in slice 7.

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
