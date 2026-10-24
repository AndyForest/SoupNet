# Drafts and triage, slices 6 to 9: parallel implementation plan

Status: plan for the operator and the implementation sessions, 2026-10-24. Companion to [drafts-and-triage-slices-6-7-revision.md](drafts-and-triage-slices-6-7-revision.md) (ratified the same day; the rulings on open questions 45 to 55 are recorded there) and to the build log [drafts-and-triage-build.md](drafts-and-triage-build.md), whose process applies to every workstream: rubric first, implement, verify by a separate agent, record. Written so that several implementation sessions can run at once in separate worktrees without touching the same lines.

## The shape

Seven workstreams. A is the scaffold everyone branches after; B to E run in parallel from the moment A's scaffold is on `main`; F and G follow once B and C have merged. Each workstream is one session in its own worktree, one or two PRs, and owns the files named for it. A file named under two workstreams is listed under "Shared files" with the rule for it.

| Stream | Slice | What ships | Depends on | Size |
|---|---|---|---|---|
| A | scaffold, then 6c | PR A0: dated cap raises, build-log headings per slice, backlog rows. PR A1: `outcome` on `verify_draft` and its REST twin; `verify_draft` evidence parsed like `check_recipe`; the `verify_draft` tool description | nothing | A0 small; A1 medium |
| B | 6a | `traces.intent_id` written at deposit; `intent:` qualifier; queue grouped by intent; export and import; one grammar term in the `search_recipes` description | A0 (caps) | medium |
| C | 7 | PR C1: briefing body (7a, 7c, 7d) with the `.feature` scenarios and the decision-log entries, plus one slimming lever from recipe `aae000d2` (top evidence only per exemplar, or evidence by lookup) so the thin briefing's net growth stays small. PR C2, after A1 and B merge: the tool copy and web copy in 7b | A0 (caps); C2 also A1 and B | medium, then small |
| D | 8.4 to 8.7 | `get_recipes` accepts an id array; validation errors name every failing field and the enumerations sit in the parameter descriptions; `outcome` feedback rows join on `intent_id` alone; `get_briefing` returns an id a feedback row can carry; the exclude-own message offers the `author:me` form; unknown parameter names refused | A0 (caps) | medium |
| E | 9 | `GET /intents`, `GET /intents/:id`, `GET /feedback/rows` (Bearer key, caller's user only, paged); the intent id rendered on the web detail page; an intent page; export of intents and feedback | nothing hard; counts of deposits per intent read `traces.intent_id` once B lands and are 0 before | medium |
| F | 8.1 to 8.3, 8.8, 8.9 | flat paged list for qualifier-only searches; changed-since; Members and pending-invites lines; own open drafts set apart in check results; related-item promotion (ranking-guard gated) | A1, B, D merged | large |
| G | 6b, 6d | `resolve_siblings` on the verify operation; the queue's set view; DT-OPT-04 reworded; the option-set scenarios | A1, B merged | medium |

Operator rulings on the plan, 2026-10-24: stream C ships one of the briefing slimming levers in C1 so the net growth stays small; verifiers run concurrently with the operator's own look, not after it; every stream works ahead of the operator, proceeding on reversible calls while a high impact × high uncertainty question waits, so that more is ready when the operator returns; streams commit as they go on their branches, and the operator does every push; a proposal that awaits the operator's ruling is deposited as a draft, never a verified recipe, and the operator's yes verifies it.

After each PR: a verification agent that is not the implementer runs the slice's rubric (the build log's convention), started as soon as the branch is committed, in parallel with the operator's review. After A1, B, D and E merge: one read-only security audit over the four together, since each touches authorization or a read scope (the verify outcomes, the intent oracle, the feedback read scope, the array id parser). The audit lives in the private repo as before.

## PR A0, the scaffold (do first, merge within the hour)

One PR, one session, no feature code. It exists so that no two streams edit the same line.

1. **Dated cap raises**, one commit, with the reason in the assertion's comment as slice 2 did (recipes `6ae9a299`, `8dd573b4`). Measured today: remote `tools/list` 16,986 of 17,000; stdio 13,670 cap; shared descriptions 6,051 of 6,080; thin briefing 18,183 of 18,200; headless thin 18,600 cap. Proposed: remote `tools/list` 18,200; stdio to the same proportion; shared descriptions 6,600; thin briefing 22,500; headless thin 23,000. These are sized to the estimate for everything in A to E (one parameter and one enumeration set on `verify_draft`, enumerations on `log_feedback`, one grammar term, 3,000 to 4,000 briefing characters). Each later PR records its bytes before and after in `spec-decision-log.md`; when F and G have merged, one follow-up re-tightens every cap to the measured figure plus the usual slack. No stream other than A touches the cap constants.
2. **Build-log headings**, empty, in [drafts-and-triage-build.md](drafts-and-triage-build.md): "Slice 6c: agent-side resolution", "Slice 6a: the intent link", "Slice 7: briefing copy", "Slice 8a: tool shapes", "Slice 9: read paths for reports", "Slice 8b: unattended readers", "Slice 6b: option sets". Each stream writes its rubric and its build notes under its own heading, so concurrent edits merge as separate hunks. The slices list at the top of the build log is updated once, here, with the new order and the ratification date.
3. **Backlog rows** for the two items the revision sends to the backlog (the drill-down hint wording; the two similarity figures) and for the post-F cap re-tightening.
4. The revision doc's status line already says ratified; A0 commits it and this plan.

## Workstream file ownership

Paths are the ones the streams will touch most; a stream may touch others it alone needs. The rule is the "Shared files" table below.

- **A (6c):** `apps/backend/src/services/draft-verify.service.ts`, `packages/domain/src/drafts.ts` (evidence validation), `apps/backend/src/routes/recipes.ts` (the verify route only), the `verify_draft` tool schema in `apps/backend/src/routes/mcp.ts`, `MCP_TOOL_DESCRIPTIONS.verifyDraft` and `MCP_PARAM_DESCRIPTIONS` entries for the verify tool in `packages/domain/src/recipe-guide-content.ts`, `apps/backend/src/authz/draft-resolution.ts` if the outcome mapping lives there, the drafts tests (`drafts.test.ts`, `drafts-headless.test.ts`, `drafts-on-behalf.test.ts`), the e2e drafts suites where the detail page's state label changes, `docs/product-specs/drafts-and-triage.feature` resolution scenarios.
- **B (6a):** a Drizzle migration and `packages/db/src/schema/traces.ts` (`intent_id`), the deposit path in `apps/backend/src/routes/check.ts` (one write), `packages/domain/src/search-query.ts` (`intent` qualifier), the filter builder that turns qualifiers into opaque SQL fragments (ruling 23), `apps/backend/src/services/draft-queue.service.ts` and `apps/frontend/src/pages/DraftQueuePage.tsx` (grouping), export and import (`apps/backend/src/routes/import.ts` and the export service), `ranking-isolation.test.ts` (add `intent` to the forbidden terms), the `search_recipes` description's qualifier list in `recipe-guide-content.ts`.
- **C (7):** the briefing sections in `recipe-guide-content.ts` (`WORKFLOW_WHEN`, Authoring for retrieval, results interpretation, Search vs check, the headless profile, the divergent-checks section), `docs/briefing-specs/checking-behavior.feature`, `docs/product-specs/drafts-and-triage.feature` (the `@unreleased` copy scenarios), `docs/briefing-specs/spec-decision-log.md`, the briefing size tests' recorded figures. C2 adds the `draft` parameter description, the deposit notice, `HEADLESS_KEY_SECTION`, and the web copy on `DraftQueuePage.tsx` and `DashboardPage.tsx`.
- **D (8a):** `parseRecipeIds` in `apps/backend/src/routes/recipes.ts` and its MCP twin, `apps/backend/src/services/feedback.service.ts` (validate all fields, `outcome` on `intent_id`), the `log_feedback` and `get_recipes` schemas in `mcp.ts` with the enumerations in the parameter descriptions, `apps/backend/src/routes/briefing.ts` and `get_briefing` (return an id; accept it on feedback), the search response composer's exclude-own message, an unknown-parameter check at the MCP dispatch.
- **E (9):** new `apps/backend/src/routes/intents.ts` and `services/intent-read.service.ts`, a listing handler in `apps/backend/src/routes/feedback.ts` at `/feedback/rows` (the bare `GET /feedback` stays the URL-building write form), `apps/backend/src/index.ts` (one mount), `apps/frontend/src/pages/TraceDetailPage.tsx` (render `intentId` on each feedback row, linked), a new `IntentPage.tsx` and route, export of `intents` and `check_feedback`, `docs/api` or the schemas route for the two response shapes.
- **F (8b):** the search path in `check.ts` and the response composer (flat list mode when the query has no semantic text; changed-since), `list_my_recipe_books` (Members and pending invites), the check composer (own open drafts line), and, only if the ranking guard allows, exemplar selection.
- **G (6b, 6d):** the verify service (`resolve_siblings`), the queue's set rendering, DT-OPT-01 to 04 scenarios, the build log's ruling 17 note.

### Shared files

| File | Streams | Rule |
|---|---|---|
| `packages/domain/src/recipe-guide-content.ts` | A, B, C, D | Each stream edits only the constants named for it above; nobody reflows or reorders the file; rebase on `main` before opening the PR; the size tests must pass against the A0 caps. C2 is the only stream that edits the `draft` parameter and the deposit notice. |
| `apps/backend/src/routes/mcp.ts` (tool schemas) | A, B, D | Same rule: only the named tool's schema; D's unknown-parameter check is a new function called from dispatch, not an edit inside another tool's handler. |
| `apps/backend/src/routes/recipes.ts` | A, D | A edits the verify route; D edits `parseRecipeIds` and the GET route. Different functions. |
| `apps/backend/src/routes/feedback.ts` | D, E | D edits validation in the service, not the route; E adds the `/feedback/rows` handler as new code above the existing GET. |
| `docs/planning/drafts-and-triage-build.md` | all | Write only under your own heading (A0 creates them). |
| `docs/briefing-specs/spec-decision-log.md` | A, B, C, D | Append-only; one entry per PR; rebase before opening. |
| size-cap tests | A0 only | Everyone else only records figures. |
| `packages/db/migrations/` (the next migration number) | B, D; later F, G | Added 2026-10-24 after streams B and D both minted `0041` (audit finding F106): one stream holds the next number at a time. Standing ruling from 2026-07-13 (recipe `84e8deed`, and CLAUDE.md §Parallel sessions in worktrees): freeze migrations for the batch while an unmerged branch claims the next number. For this batch: D merges first with `0041`; B renumbers to `0042` after rebasing. F and G ask the operator for their number before generating, and whichever needs no schema change says so. Migrations apply at backend startup, so a broken chain on `main` is an outage, not a failed deploy (recipe `c26fa597`). |

## Sequence and merge order

1. A0 (scaffold) opened and merged first. Everything below branches from `main` after it.
2. A1, B, C1, D, E in parallel. Suggested merge order when they are ready: A1, D, B, E, C1 (C1 last because the briefing bytes are the tightest and it should measure against everything else's descriptions).
3. C2 (tool and web copy) after A1 and B.
4. Verification agents per PR as each opens; the combined security audit after A1, B, D, E merge.
5. F and G after step 3. Their rubrics can be written earlier, under their headings, by whichever session is free.
6. Cap re-tightening after F and G.

## Rubric first, per stream

Each session's first commit is its rubric under its build-log heading, from the revision doc's 6f sketch and the slice's own section, in the build log's pass/fail form. The operator reads rubrics as they land; a stream may start implementing as soon as its rubric is committed, since the rubric is what the verifier will run. Rows every rubric carries: the authorization layer the change touches and the uniform-404 pairs it must keep; the audit rows it writes; three-surface parity where the change has a web or REST face; byte counts; the `.feature` scenario each copy change moves.

## How each stream proceeds without the operator

The operator's direction, 2026-10-24: implementation agents recipe-check their assumptions so they can proceed autonomously; a high impact × high uncertainty call that is feasible to build both ways is built both ways; the questions that genuinely need the operator go to one place the operator reads.

- **Check as you go, concurrently.** Each stream registers its own intent (`get_briefing` with its task story) and an `agent_id` of the form `a-drafts-<stream>-2026-10-24`, checks each design assumption in `soupnet-oss` in the same batch as the work that rests on it, and closes each check with a feedback row. Thin results mean think harder and check more, not stretch a near miss (recipe `b7e90f25`). Divergent options are presented only when the call is the operator's; otherwise the stream picks and logs why.
- **Build both when the call is high impact × high uncertainty and both options are feasible.** The stream checks each option as an ordinary recipe under its intent (recipe `7942b8c0`; this is the pursue-every-option shape the plan itself ships in 6b), builds each on a sub-branch (`<stream-branch>/option-a`, `/option-b`), runs the rubric rows that distinguish them, and then either chooses on its own with the comparison as evidence (a final check with the outcome, feedback rows on the two option recipes) or, when the comparison does not settle it, presents both to the operator with the measurements. Keep the losing branch until the PR merges.
- **Questions for the operator go under the stream's build-log heading**, in a "Questions for the operator" list, each numbered with the slice as prefix (6c-1, 6a-1, 7-1, 8a-1, 9-1; two streams both used "56" on the first day), each with the recommendation, its reasoning, and when the alternative would be right (never a bare question). The stream's final message repeats only the ones still open. Nothing goes on a to-do list elsewhere, and no Soup.net id is put in front of the operator as the question.
- **A question that is also a draft has a way back** (operator direction, 2026-10-24, given as guidance, not a rule). On the first day one stream wrote its operator question only in the build log and the operator answered it in a chat the stream never saw; another stream deposited its recommendation as a draft, the planning session verified that draft with the operator's words, and the answer was in the corpus for the stream to find. A draft under the stream's intent, with the question and both options in its evidence and its id named beside the build-log question, is the return path that works wherever the answer is given. The same case shows who closes it: the stream that holds the settling context, once the reply or its own work settles the call, verifying or rejecting its own draft under the confidence rule any check already uses (recipe `200ed4fe`). Agents have tended to leave such drafts for a person's click when their own context settled them (field item 2); the click is for what no agent can settle. Copy says "a person", not "the person", since in a shared book the call may be a colleague's and their agents resolve drafts about them.
- **Where a stream's call changes another stream's surface** (a parameter name, a column name, a response shape), it writes the decision under its heading before building on it and names it in its PR; the other stream reads the build log before its own rubric.

Calls this plan expects to be settled this way, so the operator need not pre-rule them: the raise sizes in A0 (measured, dated); `GET /feedback/rows` versus another path; the shape of the flat list's page parameter; whether an unknown parameter is refused or echoed as a warning (the field's sessions send wrong names today, and refusing would turn silent wrong results into loud errors, which is the operator's standing preference for fail-safe surfaces, but a warning line is the add-not-remove form; a stream can build both behind one constant and show the operator the two responses); the intent page's layout; creation-time versus changed-since (ruling 51 says both, so build both qualifiers).

## Branches and worktrees, prepared 2026-10-24

Created from `origin/main` at `e497ef9` by the planning session, no commits on them:

| Stream | Branch | Worktree |
|---|---|---|
| A | `drafts/a0-scaffold`, then `drafts/6c-resolution` | `C:\github\SoupNet\SoupNet-wt\a-resolution` (on `drafts/a0-scaffold`; the two planning docs are copied in, untracked, for A0 to commit) |
| B | `drafts/6a-intent-link` | `C:\github\SoupNet\SoupNet-wt\b-intent-link` |
| C | `drafts/7-briefing` | `C:\github\SoupNet\SoupNet-wt\c-briefing` |
| D | `drafts/8a-tool-shapes` | `C:\github\SoupNet\SoupNet-wt\d-tool-shapes` |
| E | `drafts/9-read-paths` | `C:\github\SoupNet\SoupNet-wt\e-read-paths` |

B to E were reset onto the A0 commit (`ccc7968` on `drafts/a0-scaffold`) once it existed, so they carry the caps and the build-log headings from the start; each rebases onto `main` once A0 merges there. Worktrees share the repo's object store; each needs its own `npm ci` (npm workspaces, not pnpm), then `npm run build --workspace=packages/contracts --workspace=packages/domain --workspace=packages/db` before vitest can resolve the workspace packages, and its own copy of the untracked `.env` (copied in where one existed). Option sub-branches are made by the streams themselves. The main checkout at `C:\github\SoupNet` stays on `main`, two merges behind `origin/main` until the operator fast-forwards it; nothing in the plan runs there.

## Launch prompts

One per session. Each assumes a fresh worktree on `main` after A0, the `soupnet` MCP tools, and the SoupNet repo's own CLAUDE.md.

- **A:** "You own slice 6c of drafts and triage. Read docs/planning/drafts-and-triage-slices-6-7-revision.md (6c, 6e, 6f and the rulings on 46 and 55) and docs/planning/drafts-and-triage-slices-6-9-implementation-plan.md (stream A, shared files). First open PR A0 exactly as the plan describes, then branch for A1: `outcome` on `verify_draft` and `POST /recipes/:id/verify`, evidence parsed like `check_recipe`, the tool description from 7b. Rubric under your heading first."
- **B:** "You own slice 6a: the recipe-to-intent link and the `intent:` qualifier. Read the revision doc (6a, 6f) and the implementation plan (stream B, shared files). The qualifier is a selection outside the ranking files; add `intent` to the ranking-isolation guard. Rubric first."
- **C:** "You own slice 7, the briefing copy. Read the revision doc (7a to 7e, rulings 48 and 52) and the implementation plan (stream C). PR C1 is the briefing body with its scenarios and decision-log entries; C2 is the tool and web copy after streams A and B merge. Every copy edit lands with the scenario it moves. Rubric first."
- **D:** "You own slice 8a, the tool-shape fixes 8.4 to 8.7 in the revision doc. Read it and the implementation plan (stream D, shared files). Rubric first; one PR."
- **E:** "You own slice 9, read paths for intents and feedback rows. Read the revision doc (slice 9, rulings 54 and 55) and the implementation plan (stream E). REST under the API key, caller's user only, paged; the web renders the intent id it already receives; no MCP tool. Rubric first."
- **Verifier (per PR):** "Verify PR <n> against the rubric under its heading in docs/planning/drafts-and-triage-build.md. You did not implement it. Record pass/fail per row with evidence under the same heading."
- **Auditor (after A1, B, D, E):** the security workflow in docs/workflows/security.md; findings to the private repo.

## What the operator does

- Fast-forward the local checkout first (`git pull --ff-only` in the SoupNet repo); it is two merges behind `origin/main`.
- Launch A, then B to E together once A0 is merged (or let them branch from A0's branch and rebase).
- Push and merge as PRs come in; the merge order above.
- The Playlab-side changes the steward proposed (the charter line, draft ownership, orchestrator ratification) run in parallel on that side and nothing here depends on them. The briefing text in C1 and the charter line should say the same thing; the revision doc's 7a is the wording both sides now share.

## What this plan does not do

- No change to ranking. F's related-item promotion is gated on the ranking guard and goes to ranking research if it touches a guarded file.
- No MCP tool for intents or feedback (ruling 54, REST first).
- No organization-account work; the shared-book owner's question ("is my colleague's agent checking at all") is set aside there.
- No cleanup of the 62 open drafts by anyone but their owning sessions; once A1 ships they close them with `outcome: rejected` citing the superseding recipe, or the person clicks.
