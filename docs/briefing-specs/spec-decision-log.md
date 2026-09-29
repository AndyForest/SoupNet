# Spec-decision log — briefing-copy changes

Every PR that touches briefing copy (`packages/domain/src/recipe-guide-content.ts`, the briefing composer, MCP tool descriptions) appends an entry here **before** merging: the date, each edit, the scenarios it intends to move, and the rationale for why every other scenario holds. See [README.md](README.md) §The regression rule. Newest entry first.

(Renamed from declared-intent-log.md on 2026-08-23: "intent" now names the runtime intent-registration mechanism — cold-start v2 Phase C — so the discipline's log takes an unambiguous name. The discipline itself is unchanged.)

## 2026-09-28 — Drafts-and-triage slice 5: the headless briefing section, the headless deposit notice, and the verify refusal

Design: [../planning/drafts-and-triage.md](../planning/drafts-and-triage.md) §Headless keys. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 5 rubric, open questions 41 to 44 with the orchestrator's rulings of 2026-09-28 (42 overridden: a headless key updates book descriptions like any key, so there is no description refusal).

### Edits

1. **Headless briefing section (new, only for a headless key):** "## This key is headless / Every recipe you check through this key is stored as a draft that only your user and their agents see until your user confirms it, and this key cannot verify drafts. In each draft, say why your user couldn't be asked and what would settle it. End the session with one `outcome` feedback row listing the draft ids you left open." 351 characters, inserted after the key section on every surface profile (`HEADLESS_KEY_SECTION`, selected in `composeBriefing` by `keyForcesDrafts`). An ordinary key's briefing is byte for byte unchanged.
2. **Headless deposit notice (new):** "Deposited as a draft because this API key is headless, a setting chosen when the key was made[ (your draft flag was overridden)]. Until the person confirms it, only you and your own agents can see it; it appears on no shared surface. This key cannot verify drafts; hand the person their review link: <link>". It never mentions `verify_draft`. 338 characters (371 with the override clause) against 344 for a self draft's new-draft notice, with a 73-character URL. The override clause appears only for an explicit false (recipe 9172f109). When `on_behalf_of` also applies, slice 4's on-behalf notice is used unchanged, since it names who can review the draft.
3. **Headless repeat notice (new):** "An identical earlier check from this key logged this recipe as a draft, and it is still a draft: checking it again does not verify it, and this headless key cannot; hand the person their review link: <link>". The rejected and not-chosen repeat wordings are unchanged.
4. **Verify refusal (new):** `verify_draft` and `POST /recipes/:id/verify` through a headless key answer "This API key is headless, a setting chosen when the key was made, so it cannot verify drafts; nothing was stored. The person can confirm <id> in their review queue: <link> Or an agent on one of their ordinary keys can verify it with their answer quoted and cited." 289 characters plus the link, the same for every id apart from the echo. It replaces the placeholder "This API key cannot verify drafts." that no key could reach before this slice.

No tool or parameter description changed.

### Scenarios intended to move

- **New `@unreleased` scenario** in `briefing-surfaces.feature`: "A briefed agent on a headless key drafts with what would settle each draft, and closes with the open ids" (added in this PR). It stays `@unreleased` until slice 7 teaches drafting in the briefing body and the harness can run it.

### Scenarios watched, with rationale for holding

- **Every `briefing-surfaces.feature` scenario:** the profile now also depends on the key, but for every ordinary key the thin and full briefings are byte-identical to before (domain test: the headless text equals the ordinary text with exactly the one section inserted; Layer 3: `get_briefing`, `GET /briefing`, and `POST /keys/briefing` for a headless and an ordinary key of the same scope).
- **`checking-behavior.feature` drafting scenarios (slices 2 to 4):** the self-draft and on-behalf notices are unchanged for ordinary keys; the headless notice differs only in its reason and in handing over the link instead of suggesting `verify_draft`.

### Measured

| Measure | Before | After | Cap |
|---|---|---|---|
| Remote `tools/list` | 16,986 bytes | 16,986 (identical for a headless key) | 17,000 |
| Stdio `tools/list` | 13,196 bytes | 13,196 | 13,670 |
| Shared descriptions | 6,051 characters | 6,051 | 6,080 |
| Thin briefing fixture | 18,183 characters | 18,183; headless 18,536 | 18,200; headless 18,600 |
| Full briefing fixture | 24,119 characters | 24,119; headless 24,472 | none |
| Headless section | | 351 characters | 400 |

## 2026-09-27 — Drafts-and-triage slice 4: on_behalf_of, the on-behalf notices and labels, and the depositor's refusals

Design: [../planning/drafts-and-triage.md](../planning/drafts-and-triage.md) §The model. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 4 rubric, open questions 28 to 40 as amended (recipes b89db1f0, 23657e4e).

### Edits

1. **New `on_behalf_of` parameter on `check_recipe` (both MCP servers):** "Email of the person this recipe is about, if not you: a draft only they can verify." (83 characters). The forcing rule and who may be named live in the deposit notice and the refusal, not in the description. The `draft` description is unchanged. Shared-description total 5,968 → 6,051; its cap moves 6,000 → 6,080 with a dated comment (build log open question 38: raise by at most the new line's length rather than trim unrelated copy).
2. **On-behalf deposit notice (new):** "Deposited as a draft about <email>, because it is on their behalf[ (your draft flag was overridden)]. Until they verify it, only they and you, with your agents, can see it; only they can confirm or reject it. Hand them their review link: <link>". It never mentions `verify_draft`. 285 characters (318 with the override clause) against 344 for today's new-draft notice, with a 73-character URL and a 16-character email.
3. **On-behalf repeat notices (new):** an identical repeat reports "…logged this recipe as a draft about <email>, and it is still a draft: checking it again does not verify it; only they can." with the link, or the rejected / not-chosen wording naming the subject.
4. **Labels (markdown):** an on-behalf draft's label names the other party after the state: "[unverified draft, deposited by <email>: …]" to the subject's agents and "[unverified draft about <email>: …]" to the depositor's (at most the email plus 15 bytes). A self draft's label and a published row are byte for byte unchanged. JSON and structured rows carry `draftDepositedBy` or `draftAbout` only on such rows; the published schema describes both.
5. **The naming refusal (new error copy):** "on_behalf_of must be the email of a person who can write to the recipe book "<slug>"; nothing was stored. Name a member with write access to that book, or check without on_behalf_of to record the recipe as your own." One answer for every refused value; it echoes no email.
6. **The depositor's refusal (new):** `verify_draft`, `POST /recipes/:id/verify`, the resolving reactions, and not chosen answer "Only <email> can review this draft: it is about them. Hand them their review link: <link>".

`/briefing` output is unchanged: the Drafts line already counts drafts about the person, which now includes other people's deposits, with its current wording (rubric S4-Z5).

### Scenarios intended to move

- **New `@unreleased` scenario** in `checking-behavior.feature`: "A briefed agent records a colleague's judgment as a draft on their behalf and hands over their review link" (added in this PR). It stays `@unreleased` until the briefing body teaches drafting (slice 7) and the harness can run it.

### Scenarios watched, with rationale for holding

- **`checking-behavior.feature` "An agent drafts only when it cannot ask, and says why in the first evidence entry"** (slice 2): the `draft` description is unchanged, and a check without `on_behalf_of` behaves exactly as before, so the when-to-draft behaviour it pins has nothing new to react to. The new parameter's line says whom a recipe is about, not when to draft.
- **`checking-behavior.feature` "An agent that deposited drafts hands its person the queue link rather than listing ids"** (slice 3): the self-draft notice is unchanged; the on-behalf notice carries the same kind of link, addressed to the subject.
- **`recipe-voice.feature`:** the recipe is still written in the voice of the person whose judgment it records; `on_behalf_of` only names that person when it is not the key's user.

### Served `tools/list` bytes

| Server | Before (slice 3) | After (slice 4) | Cap |
|---|---|---|---|
| Remote | 16,853 | 16,986 | 17,000 |
| Stdio | 13,063 | 13,196 | 13,670 |

## 2026-09-27 — Drafts-and-triage slice 3: the review queue's qualifiers, the queue link in the deposit notice, and ratings on own-draft labels

Design: [../planning/drafts-and-triage.md](../planning/drafts-and-triage.md) §Verifying a draft ("Links"). Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 3 rubric, rulings 21 to 27.

### Edits

1. **`search_recipes` `query` description (both MCP servers):** names `is:draft (your unresolved drafts)` and `impact:/uncertainty: (low|medium|high)`, and says "author: or is:draft lifts the exclude-own default". To stay inside the unchanged budgets, "searches semantically as one phrase (no boolean operators)" became "is one semantic phrase", "across recipe, evidence, and reference citations — quote filenames for PR review" became "of recipe, evidence, and citations (quote filenames for PR review)", the example group lost its `.ts` suffixes, "(ISO date, judgment date)" became "(ISO judgment date)", and "Qualifier-only queries return newest first" became "Qualifier-only: newest first". Dropped: "no boolean operators" (the unknown-qualifier and group errors still teach the shape). 412 → 415 characters (cap 420); shared total 5,965 → 5,968 (cap 6,000, not raised).
2. **Unknown-qualifier error text:** now lists every qualifier and value ("valid qualifiers are author:, after:, before:, is:draft, impact: and uncertainty: (low, medium, or high)"), so the description can stay terse. New errors for `is:` and the rating qualifiers name their vocabulary.
3. **Draft deposit notice:** "(or they confirm it with still true on the recipe's page)" becomes "(or they confirm it in their review queue: <FRONTEND_URL>/app/drafts?ids=<id>)", on a new draft and on an identical repeat of an unresolved one. 284 → 344 characters for a new draft and 280 → 340 for a repeat, with a 73-character URL (the rubric's cap is the URL plus 20).
4. **Own-draft result labels (markdown):** when the agent rated a draft, its label gains "; impact X, uncertainty Y" (at most 38 bytes; 0 for an unrated draft and for any published row). JSON and structured rows that carry `draftState` also carry `impact` and `uncertainty` (null when unrated); the published schema says so.
5. **`/check` HTML search tips:** one new line for `is:draft`, `impact:`, and `uncertainty:`.
6. **`verify_draft` refusals (not description copy):** "is not a draft" for a published recipe the key can read, and a refusal naming the book and the ways forward ("needs write access to this recipe book … or ask the person to confirm it in their review queue: <link>") for the key's own draft in a book it cannot write. The tool description is unchanged.

`/briefing` output is unchanged (no queue pointer on the Drafts line; rubric S3-Z5).

### Scenarios intended to move

- **New `@unreleased` scenario** in `checking-behavior.feature`: "An agent that deposited drafts hands its person the queue link rather than listing ids" (added in this PR). It stays `@unreleased` until the briefing body teaches drafting (slice 7) and the harness can run it.

### Scenarios watched, with rationale for holding

- **`checking-behavior.feature` "Probing the system does not log junk recipes"** and the search-vs-check scenarios: the search description still carries the grammar's shape (semantic phrase, quoted terms, groups, negation, author/date qualifiers) and the PR-review hint; only "no boolean operators" left, and the grammar's error for a bare OR or a mixed group still says so at the moment it matters.
- **`checking-behavior.feature` "An agent drafts only when it cannot ask …"** (slice 2): the notice now gives a link instead of "the recipe's page"; the when-to-draft guidance is untouched.
- **`feedback-loop.feature`, `known-recipes-dedup.feature`, `intent-registration.feature`:** no copy they rely on changed.

### Served `tools/list` bytes

| Server | Before (slice 2) | After (slice 3) | Cap |
|---|---|---|---|
| Remote | 16,854 | 16,853 | 17,000 |
| Stdio | 13,064 | 13,063 | 13,670 |

## 2026-09-27 — Drafts-and-triage slice 2: the draft parameter, verify_draft, and the briefing's Drafts line

Design: [../planning/drafts-and-triage.md](../planning/drafts-and-triage.md) §The model and §Verifying a draft. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 2 rubric (this entry is its briefing-copy declaration). Rulings: open questions 5 to 15 as accepted; the separate tool is recipe `6ae9a299`.

### Edits

1. **New `check_recipe` param, both MCP servers:** `draft` ("True: a draft, for a high-impact, uncertain call the person can't be asked about now; say why in the first evidence entry. Private to them and their agents until verified."). Served as a boolean; a value of the wrong type reaches the server's lenient parser, which takes anything unrecognized as a draft (the private side) with a notice, instead of the SDK failing the check.
2. **New tool `verify_draft`, both MCP servers** (REST twin `POST /recipes/:id/verify`): description "Publish your user's draft recipe once they confirm it, with new evidence quoting their answer and a citation. Evidence that adds nothing new is refused." Params `recipe_id` ("The draft's id (full UUID or 8+ char short id).") and `supporting_evidence` ("Your interpretation, then > the person's answer verbatim, then -- where they said it.").
3. **Check responses:** a draft deposit gets a `draftNotice` line under "Recipe checked as #…" saying only the person and their agents can see it and how it is verified; a person's own drafts in results carry an `[unverified draft: …]` label (also `[rejected draft …]`, `[draft not chosen]` by id). Not briefing copy, listed for completeness.
4. **Briefing corpus section:** under a book's Index line, the person's own agents get `Drafts: N unverified drafts about your user await their review (only they and their agents see them)` when there are any. Every Index figure now counts published recipes only, so a collaborator's line never moves when a draft lands. Absent when there are no drafts, so every existing briefing is byte-identical.
5. **Budgets:** shared-description cap 5,550 → 6,000 (total 5,510 → 5,965), a dated raise for a genuinely new affordance (recipe `8dd573b4`).

### Served `tools/list` bytes

| Server | Before (slice 1) | After (slice 2) | Cap |
|---|---|---|---|
| Remote (`POST /mcp`) | 15,864 | 16,854 | 16,000 → 17,000 (dated raise in `mcp-tools-list-size.test.ts`) |
| Stdio (`apps/mcp-server`) | 12,074 | 13,064 | 13,670 (unchanged) |

### Scenarios intended to move

- **`checking-behavior.feature`** — new `@unreleased` scenario "An agent drafts only when it cannot ask, and says why in the first evidence entry" (added in this PR). It stays `@unreleased` until slice 7 teaches when to draft in the briefing body.

### Scenarios watched, with rationale for holding

- **`checking-behavior.feature` "A rated check uses the rating vocabulary…"** — the ratings descriptions are unchanged; `draft` is a separate parameter and its description names the same impact-and-uncertainty bar in the ratings' own words.
- **`divergent-checks.feature` (all; the "present options and wait" pattern)** — the `draft` description sends an agent that can ask to ask first ("the person can't be asked about now"), so presenting options stays the answer when the person is reachable.
- **`feedback-loop.feature`** — `verify_draft` is not a feedback surface; `log_feedback` and the ride-along `feedback` param are unchanged.
- **`briefing-surfaces.feature`** — the Drafts line renders only for a person with drafts, on the MCP profile where Index lines render; the thin/full section structure is unchanged.
- **All others** — principles, voice, format, routing, and setup copy untouched.

## 2026-09-27 — Drafts-and-triage slice 1: triage ratings on check_recipe, paid for by a tool-roster trim

Design: [../planning/drafts-and-triage.md](../planning/drafts-and-triage.md) §Triage ratings and §Parameters and tool-description size. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 1 rubric (this entry is its briefing-copy declaration). Rulings: open questions 1 to 4 accepted as recommended (recipes `cee8fb2d`, `4cfd166e`).

### Edits

1. **Two new `check_recipe` params, both MCP servers:** `impact` ("Your triage rating of how much rides on this call: low | medium | high. Omit it if you have no view. Not a feedback row's impact.") and `uncertainty` ("Your triage rating of how unsure you are of the person's position: low | medium | high. Omit it if you have no view."). Plain strings, not enums, so an unrecognized value reaches the server and becomes a notice instead of an SDK validation error (recipe `4cfd166e`, check `10e3d7e1`).
2. **`intent`, `agent_id`, `known_recipes` cut to one line each** (all tools that carry them). What moved and where:
   - `intent`: always-new registration, lost-id recovery after compaction, and "rendering only, never ranking" moved to a new `intent` paragraph in the briefing's "How to check" section. "Sub-agents with their own goals send their own text" and the carry-the-id protocol stay where every agent already sees them: the intent echo line on every response that resolves an intent.
   - `known_recipes`: kept "stub", "rendering", "ranking" (the drift guard's load-bearing concepts). Dropped "Client-declared sibling of session_id" (the briefing's "How to check" line already says "client-declared ids you still hold — same id-stub rendering") and "logging and clustering are unchanged"; the briefing line gains "never ranking".
   - `agent_id`: dropped "stamped on audit records" and "Capture only"; kept the example and the joinable-lineage purpose, which the briefing line also states.
3. **`feedback` on `check_recipe` and `search_recipes` is a pointer**, no longer an inline copy of the row schema: "Feedback rows about PRIOR checks or searches, riding along with this call; each row takes log_feedback's fields. A rejected row never blocks this call." The item schema is an open record, so every row field still reaches the handler (a bare object would let the SDK strip them). Dropped from this description: the "trace_id … full UUID or 8+ char short id" detail, which lives in `log_feedback`'s own `trace_id` description. The briefing's "How to check" line now says each row takes the same fields as `log_feedback`.
4. **`clusters` and `max_chars`** stay declared and honored; each description is now "Deprecated: use verbosity (still honored)." Dropped: "Exact exemplar count (harness/sweep use)" and "Approximate size target in characters".
5. **Check report (not briefing copy, listed for completeness):** when an agent rates, or a rating needs explaining, the markdown report gains one line under "Recipe checked as #…": "Your ratings: impact high, uncertainty not rated (triage only, never ranking)." plus any notice. Agents that never rate see no change.
6. **Budgets:** the shared-description cap moves down 5,950 → 5,550 (total 5,884 → 5,510), and `intent`, `agent_id`, `known_recipes` get a 120-character per-param cap. The thin briefing's size ceiling rises 18,000 → 18,200 chars (fixture ~17,685 → 18,111) for the `intent` paragraph: text loaded once per session instead of three times in every turn's tool list.

### Served `tools/list` bytes (minified UTF-8 `result`, in-memory transport; pinned by `mcp-tools-list-size.test.ts` and `apps/mcp-server/src/server.test.ts`)

| Server | Before | After | Cap |
|---|---|---|---|
| Remote (`POST /mcp`) | 18,090 | 15,864 | 16,000 |
| Stdio (`apps/mcp-server`) | 13,670 | 12,074 | 13,670 |

### Scenarios intended to move

- **`checking-behavior.feature`** — new `@unreleased` scenario "A rated check uses the rating vocabulary and leaves out a rating it has no view on" (added in this PR): a briefed agent that rates uses `low | medium | high` and omits a rating it has no view on rather than defaulting to medium. It stays `@unreleased` until slice 7 teaches rating in the briefing body.

### Scenarios watched, with rationale for holding

- **`feedback-loop.feature` "Mid-flow feedback rides on the next check_recipe call"** — the row fields are now learned from `log_feedback`'s schema rather than an inline copy. Holds because `log_feedback` is in the same tool list the agent already reads, the pointer names it, the briefing's "Closing the loop" section still lists the row vocabulary verbatim, and every field is still accepted and stored (DT-TOOL-03, `triage-ratings.test.ts`). Risk to watch: an agent that never opens `log_feedback`'s schema sends rows without `kind`/`disposition`; those rows get per-row markers, and the check itself is unaffected.
- **`intent-registration.feature` (all scenarios)** — the `intent` description is one line. Holds because each scenario's trigger is carried elsewhere: declaring at briefing time and carrying the id (the echo line on every response, unchanged), compaction recovery and always-new registration (the new briefing paragraph), sub-agent isolation (the echo line), feedback join (`intent_id` on `log_feedback`, unchanged), and the unknown-id notice (unchanged).
- **`known-recipes-dedup.feature` "Known ids render as compact stubs instead of full bodies"** — the `known_recipes` description still says ids you hold render as id stubs, rendering only; the stub rendering itself is unchanged.
- **All others** — principles, voice, format, routing, divergence, and setup copy untouched; `session_id` copy untouched (open question 2).
- Suite re-run: the agent-run harness is not yet wired; per README the .feature files remain the manual checklist.

### Addendum (2026-09-27, after verification): slice 1 follow-ups

Rulings: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 1: rulings on the verification follow-ups.

1. **Briefing "How to check", `intent` paragraph.** Restores the meaning the one-line `intent` description dropped ("stubs reset"): the paragraph now says recipes already delivered to an intent render as id-stubs, and that a re-sent story "starts with no stubs, and recipes render in full again". The awkward "say to context compaction" becomes "for example to context compaction". Thin fixture grows by about 60 characters, inside the 18,200 ceiling; pinned by `recipe-guide-content.test.ts`.
2. **Not copy, listed for completeness:** a rating of the wrong JSON type (`impact: 3`) and a non-object feedback row no longer fail the whole MCP call on either server; the rating is stored as not rated with the notice, and the row gets a per-row error. The served schemas are byte-identical (remote `tools/list` still 15,864 bytes). The notice takes a plural verb when both ratings are unrecognized.
3. **DT-RAT-02 edited, not the code:** the markdown report stays silent when the agent sent no rating; JSON and structured responses carry `null`.

Scenarios intended to move: none. Watched: `intent-registration.feature` (all), which the restored sentence strengthens rather than changes; `known-recipes-dedup.feature` "Known ids render as compact stubs" (stub rendering unchanged).

## 2026-08-23 — Cold-start v2 Phase C: declared intents (param + echo line + tool descriptions)

Operator-approved plan (always-new registration ruling, recipe `363e3e0c`; session-supersession direction, `5c55327d`; rendering-only ledger per `9067ca1b`/`4d25aec9`).

### Edits

1. **New shared param description `MCP_PARAM_DESCRIPTIONS.intent`** on get_briefing / check_recipe / search_recipes (HTTP + stdio), plus a short join-only `intent_id` description on log_feedback and the feedback row schema. Tool-description budget dated raise 5,500 → 5,950 (the session_id/search_recipes class of raise).
2. **Briefing gains one conditional echo line** (`intentNotice`, rendered under the header beside the purpose acknowledgment) — registration ack + carry-the-id protocol, or the untracked-state notice. Absent when no intent param is sent, so intent-less briefings are byte-identical on both profiles.
3. No other briefing copy changed. The session_id copy is deliberately untouched — deprecation-steering copy is backlogged behind the intent mechanism proving out, not bundled here.

### Scenarios intended to move

- **`intent-registration.feature`** (added in this PR) — all six scenarios.

### Scenarios watched, with rationale for holding

- **`known-recipes-dedup.feature` / session scenarios** — session semantics, copy, and params untouched; intent is an additive second key into the same rendering mechanism, and the ranking-purity invariants (identical inputs → identical ranking; sibling visibility) are re-asserted by ranking-regression.test.ts unchanged.
- **`feedback-loop.feature`** — carrier guidance unchanged; intent_id is a capture/join field like session_id (precedent: the 2026-07-17 entry).
- **`briefing-surfaces.feature`** — the echo line renders on both profiles only when the param is sent; the thin/full section structure is untouched.
- **All others** — principles, voice, format, routing, divergence, setup copy untouched.
- Suite re-run: harness not yet wired; the .feature files remain the manual checklist.

## 2026-08-23 — Cold-start v2 Phase B: surface-profiled briefing — thin MCP index, full web artifact

The largest structural briefing change since unification, operator-approved 2026-08-23 (plan + rulings in soupnet-oss recipes `ef844c32` thin-MCP-default, `401998c5` index-not-summary; field grounding: retrieval-at-initialization measurably loses to retrieve-when-needed, arXiv 2604.20572 / 2607.08716).

### Edits

1. **`BRIEFING.build` gains a `surface` profile** (`"mcp" | "full"`, default full). The **full profile is byte-identical to the pre-profile briefing** except edit 4 below — the web/paste artifact keeps setup, link formatting, exemplars, and pasted-JSON guidance because its receiver is unknown. The **mcp profile** drops `## Setup — MCP-capable agents`, `## Setup — web-only agents`, `## Formatting recipe-check links`, `## When the user copies JSON results back`, and the divergent-checks section's web-only paragraph (its cross-reference target is gone); the key section shrinks to a one-line placeholder note with an `/info/connect` pointer. Surviving headings are never retitled.
2. **Per-book Index lines** (`renderBookStatsLine`): deterministic SQL aggregates — recipe count, newest judgment date (COALESCE cascade), last logged, author count, feedback/reaction rollups — render under each book's bullet on MCP surfaces. Stats-less groups render byte-identically to before, so `list_my_recipe_books` and the web briefing are unchanged unless stats are supplied.
3. **MCP exemplar default is ZERO** — the clustered sample no longer front-loads; explicit `verbosity` (low/medium/high → 3/5/10) or raw `k` opts back in. Web/REST surfaces keep the preference-driven default (5).
4. **"Refreshing this context" wording** (shared corpus-context block): "identity + recipe-books + exemplars block" → "corpus-context block", and the static-sections aside drops "setup" — the old enumeration was false on the mcp profile. This is the one full-profile byte change; scenario-neutral (no scenario asserts the enumeration).
5. **Tool descriptions**: `getBriefing` and `listMyRecipeBooks` say "per-book index" instead of "clustered sample"; `briefingVerbosity` documents the new default ("Omit for the default thin briefing — per-book index, no exemplar sample"). Net length within the existing 5,500 budget (no raise).

### Scenarios intended to move

- **`briefing-surfaces.feature`** (added in this PR) — all six scenarios: the thin-MCP shape, verbosity opt-in, retrieval-not-bigger-briefing, index short-id resolution, full web artifact, index-not-sample corpus refresh.
- **`subagent-purpose-briefing.feature`** — sub-agent briefings via MCP `purpose` now arrive thin by default; the purpose param still biases exemplars only when exemplars are opted in. Watch on the next harness run; the scenario's observable (purpose-scoped briefing) still holds, its payload is smaller.

### Scenarios watched, with rationale for holding

- **`web-only-agents.feature` (all)** — that population receives the paste artifact = full profile; byte-identical except edit 4, which no scenario asserts. The per-surface snapshot tests in recipe-guide-content.test.ts are the mechanical guard.
- **`recipe-voice` / `evidence-integrity` / `comprehension-quiz`** — the format canon, examples, ROLE_PATTERNS, and principles are shared verbatim across profiles; no fed copy changed for these concerns. Risk noted: thin-briefed agents no longer see exemplar recipes as implicit voice models; the format section's two annotated examples remain, and the token-matched control eval (verification plan) is the tripwire before any "v2 is better" claim.
- **`checking-behavior.feature`** — when-to-check and check-freely copy untouched; the thin profile arguably strengthens the task-keyed retrieval behavior these scenarios want.
- **`divergent-checks.feature`** — MCP guidance intact; the dropped web-only paragraph only ever applied to the population that still receives it (full profile).
- **`feedback-loop.feature` / `known-recipes-dedup.feature` / `frontmatter-recipe-lookup.feature`** — how-to-check, closing-the-loop, and requested-recipes copy shared verbatim across profiles.
- Suite re-run: harness not yet wired (README §regression rule "once wired"); the .feature files remain the manual checklist.

## 2026-07-21 — Feedback over URLs: feedback_* ride-along check params + GET /feedback

Triggered by a live failure (2026-07-21): a URL-constructing web agent, primed with the briefing, hand-built `GET /feedback?key=...&trace_id=...&kind=check-feedback&...` — faithful field names, the only request shape its capability class can produce — and 404'd, because the loop-closing copy documented POST+Bearer only and no GET surface existed. This PR ships flat `feedback_*` ride-along params on `/check` (override-only in CHECK_PARAMS — never carried into Copy-URL/re-check forms, so a re-check cannot double-log the row) and `GET /feedback` (`?key=` or Bearer) as the standalone backup, then teaches both in copy. Corpus rulings applied: e9c5aa23 (flat single-row beats nested for agent surfaces), 7828d4c8 (the roundTrip axis decides persistence), abddb65d (ride-along rows inherit check-level agent_id/session_id), 86f6bc53 (offer-shaped copy — "you can X so that Y").

### Edits

1. **Briefing §Closing the loop** gains one sentence after the POST /feedback sentence: URL-building agents can ride the same fields on the next check URL prefixed `feedback_`, or `GET /feedback` with the unprefixed fields standalone when no follow-up check is coming ("same auth as your check URLs"). Offer-shaped; deliberately credential-form-agnostic — the section is shared verbatim with the OAuth briefing branch, whose guard test forbids any `?key=` substring, so the concrete `/feedback?key=YOUR_KEY` example lives in CONNECTION_TIERS (guide surface, never OAuth-composed) instead.
2. **CONNECTION_TIERS tier 2** gains two sentences: the `feedback_*` ride-along URL pattern + standalone `GET /feedback`, framed by value (feedback shows the human which recipes earned their keep; a "nothing similar found" result is worth a row too).

### Scenarios intended to move

- **`feedback-loop.feature` — "URL-constructing agent rides feedback on the next check URL"** (added in this PR): the ride-along copy is the fed text that produces that behavior.
- **`feedback-loop.feature` — "GET-only agent with no follow-up check uses GET /feedback"** (added in this PR): the standalone-backup sentence is its fed text.

### Scenarios watched, with rationale for holding

- **`feedback-loop.feature` (existing scenarios)** — MCP carrier guidance (chained vs `log_feedback`) and the POST /feedback scenario are unchanged; the new copy adds surfaces for a capability class that previously had none, without altering carrier selection for tool- or POST-capable agents.
- **`checking-behavior.feature` check-freely framing** — both additions are offer-shaped ("you can close the loop", "stands alone"); no new imperatives, no warnings.
- **`web-only-agents.feature`** — link-formatting guidance untouched; feedback URLs are the same key-carrying URL class those scenarios already govern.
- **All other scenarios** — principles, voice, format, routing, divergence, and setup copy untouched.
- Suite re-run: harness not yet wired (README §regression rule "once wired"); the .feature files remain the manual checklist.

## 2026-07-17 — Session-refresh hint + feedback session_id capture

Operator-directed (recipe 31d184df: the session models the agent's context-fill state; Andy derived the compaction affordance himself in the design review). Declared intent: the refresh hint is the only briefing-content change in this batch — nothing else moves.

### Edits

1. **"## How to check"** gains one line after the further-optional-params paragraph: if you auto-compact your context or otherwise no longer hold the recipes you've been shown, refresh your session by omitting `session_id` on your next check — a fresh session means full recipe text again.
2. **`MCP_PARAM_DESCRIPTIONS.sessionId`** gains the same idea in a few words ("Compacted your context? Omit it on your next check — a fresh session gets full text again."). Shared-copy budget raised 4,300 → 4,400 with a dated comment in `mcp-tool-descriptions.test.ts` (prior total 4,279 left no headroom).
3. **`log_feedback` / feedback-row schemas** (HTTP MCP + stdio mirror, inline descriptions, not shared copy): optional `session_id` param — "the session token from your check responses — joins your feedback to that session's check lineage. Capture only."
4. **Same-batch copy sweep (operator-directed, "sweep other mcp surfaces to check if sessionId is concise and clearly documented"):** `MCP_PARAM_DESCRIPTIONS.sessionId` rewritten to carry the current mechanism — known = deposited OR shown, results walk down the same ranking to unseen ones, ranking never changes — replacing the stale "already deposited" framing; `MCP_PARAM_DESCRIPTIONS.knownRecipes` corrected from "one-line stubs" to "id-only stubs" and named the client-declared sibling of `session_id`; the "## How to check" optional-params enumeration now lists `session_id` first (previously absent — briefing readers never learned the param existed). Budget: within the 4,400 cap.
5. **stdio proxy parity** (schema, not copy): `check_recipe` gains `session_id` using the same shared description; forwards to `/check`; ride-along feedback rows inherit it like `agent_id`. Closes the backlog parity item.
6. **`known-recipes-dedup.feature`** stub-shape wording corrected to id-only (spec truth-up to the 2026-07-17 ossification ruling — describes shipped behavior, moves no scenario intent).

### Scenarios intended to move

- **`known-recipes-dedup.feature` — "Agent that compacted its context refreshes the session"** (added in this change, `@unreleased` with the rest of the file): the hint is the fed copy that produces that behavior.

### Scenarios watched, with rationale for holding

- **`known-recipes-dedup.feature` (existing scenarios)** — the hint adds a refresh affordance; the stub-rendering and rendering-only invariants those scenarios assert are untouched by this copy.
- **`feedback-loop.feature`** — feedback copy in "## Closing the loop" is unchanged; `session_id` on feedback rows is a schema affordance (capture only), not a workflow change, so no feedback scenario's behavior moves.
- **All other scenarios** — principles, format, voice, setup, divergence, and link-formatting copy untouched.
- Suite re-run: harness not yet wired (README §regression rule "once wired"); .feature files remain the manual checklist.

## 2026-07-06 — Placeholder mode: no raw key in any briefing response

Operator-approved generalization of the same day's OAuth branch. Principle: every MCP/API consumer of the briefing had to supply the key to get the briefing, so echoing it back is redundant; the only consumer that needs an inline key is the human copy-briefing flow, and the browser does that substitution itself. Raw keys never appear in responses — not even on the JWT path.

### Edits

1. **`BRIEFING.build` takes no key input at all** (`apiKey` and `checkUrl` removed from `BriefingBuildInput`). Non-OAuth compositions render the exported `BRIEFING_KEY_PLACEHOLDER` literal (`YOUR_API_KEY`) in the key section and every key-bearing URL/config (check URL, guide URL, mcp-setup link, Codex env/inline configs, Claude Code one-liner/JSON, link-format example). The OAuth mode from the previous entry is unchanged (placeholders would mislead there — nothing pasteable exists).
2. **"## Your API key" copy** rewritten as a dual-state explanation, true both pre-substitution (Bearer agents — GET /briefing, MCP get_briefing, and the stdio proxy's Claude Desktop consumers, who hold their key in client config) and post-substitution (the human-pasted artifact, where the dashboard spliced the real key in). Copy rule, enforced by a domain test: the placeholder literal never appears in prose — only in key positions — because the frontend's `replaceAll` would splice a raw key mid-sentence.
3. **`GET /keys/briefing?key=` → `POST /keys/briefing` with the key in the JSON body** — minted keys stop transiting request URLs (F24 keeps ALB access logs disabled precisely because URLs carried keys). All four dashboard call sites (CopyBriefingButton, ApiKeysPage, RecipeMapPage, GroupsPage AgentConnectBox) now POST and substitute the raw key they already hold client-side via the shared `substituteBriefingKey` helper (`apps/frontend/src/lib/briefing-key.ts`; its literal must match the domain's).

### Guards (CI-enforced under test:ci)

- Domain: placeholder mode renders the literal in every key position, nothing raw-key-shaped (`cn_[sd]_` pattern), prose free of the literal (`recipe-guide-content.test.ts`).
- Bearer paths: GET /briefing and MCP get_briefing responses contain neither the authenticated key nor any `cn_[sd]_`-shaped substring, and do contain the placeholder (`oauth-flow.test.ts`).
- JWT path: POST /keys/briefing output carries the placeholder and never the raw key (`keys.test.ts`).
- Frontend: `substituteBriefingKey` composes an artifact carrying the key at every placeholder position (`briefing-key.test.ts`).

### Scenarios intended to move

None — no scenario asserts the briefing artifact's key is server-inlined; they assert what the *received* artifact affords.

### Scenarios watched, with rationale for holding

- **`web-only-agents.feature` (all scenarios)** — that population receives the HUMAN-pasted artifact, which after the dashboard's copy-time substitution still carries a real key in the identical positions (key section value line, `?key=` URLs, Bearer configs). The frontend unit test proves the composed artifact is position-for-position what the server used to inline, so the pasted-briefing UX is unchanged.
- **Bearer MCP agents (comprehension/checking scenarios)** — they never needed the echoed key (they call tools directly); the key section now says exactly that. The stdio-proxy population (Claude Desktop) holds its key in client config per the connection it was set up with.
- **All other scenarios** — principles, format, when/how-to-check, feedback, divergence, corpus-context copy untouched in both modes.
- Suite re-run: harness not yet wired (README §regression rule "once wired"); .feature files remain the manual checklist.

## 2026-07-06 — OAuth connections: credential-free briefing branch

Backlog item "Reconcile the briefing's API-key-in-URL assumptions for OAuth-connected agents". Live failure (2026-07-06, claude.ai connector): the briefing rendered the raw 1-hour OAuth access token in "## Your API key" and embedded it as `?key=` in every setup URL; the connected agent warned the user about a "leaked key" that wasn't one.

### Edits

When the briefing is composed for an OAuth access token (`api_keys.key_type = 'oauth'`, threaded from `resolveScope` through `BRIEFING.build`'s new `oauthConnection` input), the four credential-bearing sections swap to short truthful notes; every other section is shared verbatim between the two branches:

1. **"## Your API key" → "## Your connection"** — connected via OAuth, 1-hour token (verified: `ACCESS_TOKEN_TTL_SECONDS` in oauth.service.ts) the client refreshes automatically, nothing to copy, paste, protect, or rotate.
2. **"## Setup — MCP-capable agents"** — one already-connected line (the tools are live in this session) plus the `/info/connect` pointer for connecting other clients (canonical-doc rule, recipe 12b00466).
3. **"## Setup — web-only agents"** — keyless note: the key-in-URL flow doesn't apply to this connection; the human can mint a pasteable key and copy a key-carrying briefing at the frontend.
4. **"## Formatting recipe-check links"** — heading kept (the divergent-checks section cross-references it) with a not-applicable note and dashboard pointer instead of the key-embedded markdown-link example.

Defense in depth: for OAuth keys the composer also passes a keyless `checkUrl` and an empty `apiKey`, so the token physically cannot render even if a future template edit misses the branch. Non-OAuth briefings are **byte-identical** to before (verified against the HEAD render, 20,417 bytes with fixed inputs; pinned by `packages/domain/src/recipe-guide-content.test.ts` plus two integration tests in `oauth-flow.test.ts`).

### Scenarios intended to move

None — no existing scenario's persona is an OAuth-connected agent.

### Scenarios watched, with rationale for holding

- **`web-only-agents.feature` (all scenarios)** — the web-setup section and key-embedded URL examples disappear for OAuth connections only. Every persona in that file is a web-browsing agent primed with a pasted key-carrying briefing; an OAuth connection is by definition an MCP tool-calling session, so the pasteable-key population those scenarios describe always receives the unchanged legacy sections.
- **`divergent-checks.feature`** — untouched copy; the "see the link-formatting guidance below" cross-reference still resolves in both branches because the section heading is kept in OAuth mode.
- **`comprehension-quiz.feature`, `recipe-voice`, `evidence-integrity`, `checking-behavior`, `recipe-book-routing`, `advanced-workflows`, `feedback-loop`** and the `@unreleased` files — principles, format, when-to-check, how-to-check, feedback, annotation, and corpus-context copy are shared verbatim between the branches (single template with four swapped section variables), so no fed copy changed for any non-OAuth reader.
- Suite re-run: the agent-run harness is not yet wired (README §regression rule "once wired"); per README, the .feature files double as the manual checklist until then.

## 2026-07-05 — FF-3: feedback parity, dry-run honesty, encoding/decided_at examples, hostname derivation

Six copy edits from the 2026-07-05 qualitative-eval findings (§Briefing copy gaps surfaced by cold readers) and the backlog item "Feedback copy parity for web agents". First entry under the declared-intent rule.

### Edits and scenarios intended to move

1. **Web/REST feedback path** (briefing §Closing the loop): documents `POST /feedback` (Bearer key, single row with `trace_id` or `{"feedback": [rows]}`) alongside `log_feedback`/`feedback`.
   → Moves: `feedback-loop.feature` — new scenario "Web/REST agent closes the loop via POST /feedback" (added in this PR).
2. **Null/ignored/contradicted results line** (briefing §Closing the loop): "results that didn't help are worth a row too" — answers a cold reader's verbatim question.
   → Moves: `feedback-loop.feature` — new scenario "Ignored, contradicted, or empty results still earn a feedback row" (added in this PR).
3. **Dry-run honesty** (briefing intro): every submission logs a real trace; probe on the docs pages; `filter` (alias `f`) is the no-logging keyword lookup.
   → Moves: `checking-behavior.feature` — new scenario "Probing the system does not log junk recipes", tagged `@unreleased` until FF-1 lands the `/check` filter implementation.
4. **Percent-encoding example** (briefing §Setup — web-only agents): concrete `%20`/`%22` example.
   → Moves: `web-only-agents.feature` — new scenario "Recipe-check URLs percent-encode parameter values" (added in this PR).
5. **`decided_at` worked example** (CONNECTION_TIERS tier 2 + `MCP_PARAM_DESCRIPTIONS.decidedAt`): artifact date → `decided_at` value.
   → Moves: `advanced-workflows.feature` — "Backfilled decision carries its original judgment date" (existing scenario; edit strengthens it, no text change to the scenario).
6. **Instance-derived link example** (briefing §Formatting recipe-check links): the markdown-link example now derives from `checkUrl` instead of the hardcoded hosted domain.
   → Moves: `web-only-agents.feature` — new scenario "Emitted links use the briefing's own base URL" (added in this PR).

Also in this PR: dropped the stale feature-level `@unreleased` tag on `feedback-loop.feature` (WT-4's feedback ingestion shipped and was Layer-4b-verified 2026-07-05; the tag's own rule says drop it in the implementing PR, which omitted it) and updated its README table row.

### Scenarios asserted to hold (rationale)

- **`checking-behavior.feature` "Checks happen autonomously, without permission-seeking" and HOW_THIS_WORKS' check-freely framing** — the highest-risk interaction. The dry-run sentence is phrased as a redirect to sanctioned alternatives (docs pages, `filter`), not a warning against checking; "check freely and often" is unchanged and precedes it. Verified against corpus recipe 5ebea12c-2740-4498-aa95-c1bb562c6dce lineage (append-only framing exists to remove check hesitation).
- **All other `feedback-loop.feature` scenarios** — the blurb's mid-flow-vs-standalone guidance and field vocabulary are unchanged; the REST sentence adds a surface without altering carrier guidance.
- **`web-only-agents.feature` link-format scenarios (Gemini plaintext / markdown / uncertain-fallback)** — the format-selection guidance is untouched; only the example URL's host changed, and every briefing already embedded the instance's own `checkUrl` elsewhere.
- **`recipe-voice`, `evidence-integrity`, `recipe-book-routing`, `divergent-checks`, `comprehension-quiz`, `frontmatter-recipe-lookup`, `known-recipes-dedup`, `subagent-purpose-briefing`** — no edited copy feeds these: voice/evidence/routing/divergence sections, exemplar rendering, and the WT-3/WT-4 tool descriptions (other than `decidedAt`) are byte-identical.
- Suite re-run: the agent-run harness is not yet wired (README §regression rule "once wired"); per README, the .feature files double as the manual checklist until then.

Briefing size: 18,560 → 19,324 bytes (+764, +4.1%) with fixed reference inputs.

## 2026-07-06 — Tool/param descriptions trimmed to affordances (18KB → 11.6KB tools/list)

**Edits:** every MCP tool and param description reduced to affordance size (what it does, when to reach for it, hard constraints); teaching content (voice-mistake examples, ROI mechanics, feedback-field tutorials, worked decided_at example) removed from schema — it already lives in the briefing, which remains the canonical teaching surface. Operator-specific example vocabulary removed from static schema copy. The briefing's "How to check" section gains a one-paragraph pointer at the optional power params (known_recipes, decided_at, response_format, agent_id, feedback) and absorbs the region depth line. Budget guard added (mcp-tool-descriptions.test.ts: ≤420 chars per shared description, ≤4,000 total).

**Scenarios intended to move:** none — this is a redundancy reduction, not a behavior change; all teaching remains reachable via get_briefing, which every comprehension scenario already routes through.

**Scenarios watched, with rationale for holding:** voice/format scenarios (voice-and-format.feature and kin) — the one behavioral risk is agents that skip get_briefing now get a one-line voice rule in the recipe param instead of the example set; mitigated by keeping the rule itself plus an explicit "get_briefing teaches the voice rules" pointer in both the check_recipe trailer and the recipe param. If the naive-agent evals show voice quality regressing for briefing-skipping agents, the reversal is scoped: restore examples to the recipe param only.

## 2026-07-18 — Canonical Recipe schema pointer + derivation stitches (recipes 7945fd8a, 43ce7ec0)

**Edits:** (1) one pointer line added to the guide/briefing "How to check" section: full field meanings live at `GET /schemas/recipe.json` (+ `/schemas/check-response.json`) — canonical, generated from the same zod source the server validates against; (2) no param-description text changed, but four short forms (`recipe`, `known_recipes`, `session_id`, `decided_at`) are now formally stitched to their canonical `*_DEFINITION` constants in `@soupnet/contracts` via `CANONICAL_PARAM_SOURCES` + per-description source comments, with a drift-guard test (mcp-tool-descriptions.test.ts) asserting each short form keeps its source's load-bearing concepts.

**Scenarios intended to move:** `known-recipes-dedup.feature` — new scenario "Agent needing full field meanings fetches the published schema" (added in this PR).

**Scenarios watched, with rationale for holding:** all others — no existing briefing copy was reworded; the pointer is additive (one line), the stitches are comments + a constants map, and the tool-description budget totals are unchanged (budget tests still green). Suite re-run: harness not yet wired; per README the .feature files remain the manual checklist.
