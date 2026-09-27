# Drafts and triage: read-path inventory

Every code path that returns, counts, clusters, or embeds recipes (traces), with what each one must do once drafts exist. This is the checklist the slice 2 verifier walks: each row names the place a draft could leak and the disposition the slice must realize. Design: [drafts-and-triage.md](drafts-and-triage.md). Build log and rubrics: [drafts-and-triage-build.md](drafts-and-triage-build.md).

Source: the authorization-seam stack on branch `feat/authz-seam-keys` at commit `9c7a15a` (read 2026-09-27, mid-rebase; line numbers are approximate, so each row also names the function). Re-walk the rows against whatever that stack looks like when slice 2 starts; the function names are the stable part.

The rule being enforced (drafts-and-triage.md, "The model"): until verified, a draft is visible only to the person it is about and their agents, and to the person whose agent deposited it. It appears on no normal surface (search results, check results, briefing, map, counts), except that a person's own agents see their own drafts, labelled as drafts.

## Legend

Trace filtering today:

- **module (trace)**: the trace-level read rule is applied inside `apps/backend/src/authz/` (`readableTraceFor`, `canReadTrace`, `canReadTraceOfFeedback`, `roleInBookOfTrace`, all in `trace-access.ts`, using `mayReadTrace` in `roles.ts`).
- **module scope, local SQL**: the set of readable books comes from the module (`Principal.readGroupIds` from `authenticateKey` in `key-auth.ts`, or `bookIdsFor` / `roleIn` in `book-access.ts`), but the trace filter itself (`group_id IN (...)`) is written in the calling file.
- **own-user, local SQL**: the route filters `user_id = <caller>` itself.
- **none**: no viewer filter (system-wide, admin-only, or by-id helpers fed from an already-filtered list).

Draft disposition:

- `exclude`: drafts are never returned or counted, except to permitted viewers; to everyone else they are uniformly absent (same shape as a recipe that does not exist).
- `label-own`: permitted viewers' own agents see drafts, labelled as drafts.
- `human-own`: the permitted person sees their drafts on this human surface (review queue, trace detail, own lists), labelled.
- `irrelevant`: no trace content, id, or count leaves through this path.
- `decide`: an open question, listed in the build log's "Open design questions".

A row can carry two dispositions (for example `exclude` + `label-own`): excluded for everyone else, labelled for the permitted viewer's own agents.

Scenario ids (`DT-*`) refer to [../product-specs/drafts-and-triage.feature](../product-specs/drafts-and-triage.feature). The slice 2 rubric in the build log maps each row group to the scenarios and tests that realize it; every `decide` row has an entry in the build log's "Open design questions".

## Headline

- **45 read paths** in the tables below. 11 are `irrelevant` (listed so the verifier can tick them off), 4 are pure `decide`, and the other 30 need the draft condition.
- **5 already apply a trace-level rule in the authz module**: the human single-trace routes RP-19 to RP-23 (`GET /traces/:id`, its feedback, reactions, stars, move and delete).
- **22 take their book scope from the module but filter traces in their own SQL**: every API-key and MCP surface (their scope is `Principal.readGroupIds`), the map, the book-scoped list, the dashboard briefing, and the three pipeline functions that do the filtering (RP-39 to RP-41).
- **4 filter by own user in their own SQL**: the dashboard list, count, check log, and export. One more (RP-04, the idempotency hit) is scoped to the depositing key by its unique index.
- **9 have no viewer filter**: admin totals and job payloads, the known-set ledgers, by-id helpers, the embedding worker, the map layout cache, and offline evals.
- **4 are writes that read traces**: import, move and delete services, account deletion, and the workspace reaper.
- **No path today can express "visible to this viewer" below the book level.** Book membership is the only rule. Drafts introduce the first per-viewer rule on a trace, so every `module scope, local SQL` row needs the new condition, and the per-viewer rule has no home yet in `authz/`.
- `npm run check:authz-seam` guards `group_members` and `api_keys`. Nothing guards `claimnet.traces` or `embedding_sources`; 20 non-test backend files read `claimnet.traces` directly.

### Chokepoints

Most agent reads funnel through a small number of functions. Putting the draft condition in these covers most rows at once:

| Chokepoint | File (function) | Rows it serves | Filters on today |
|---|---|---|---|
| Semantic trace search | `services/vector-search.service.ts:237` (`hybridSearch`: shared `searchPredicates` used by the count, the ANN query, and the exhaustive fallback) | RP-01, RP-02, RP-13, RP-14, RP-10 (query mode), RP-24 (query mode) | `es.group_id IN (...)` on `embedding_sources`. It joins `traces` only when a keyword or structured filter is present. |
| Related evidence | `services/vector-search.service.ts:520` (`evidenceSearch`) | RP-01, RP-02, RP-13, RP-14 | `es.group_id` of the evidence source; already joins `claimnet.traces t` |
| Corpus mode | `services/search-pipeline.ts:277` (`fetchCorpusTraces`, plus its honest-total count) | RP-02 (qualifier-only), RP-10 (no filter), RP-24 (default map) | `t.group_id IN (...)` |
| By-id lookup | `services/recipe-lookup.service.ts:118` (`lookupRecipes`: prefix scan and main select) | RP-06, RP-08, RP-16 | `t.group_id IN (...)` |
| Feedback target ACL | `services/feedback.service.ts:430` (`ingestFeedback`: prefix scan and readable-set select) | RP-11, RP-18 | `t.group_id IN (...)` |
| Book index stats | `services/book-stats.service.ts:57` (`fetchBookStats`) | RP-09, RP-15, RP-17 | `t.group_id IN (...)` |
| Human single-trace | `authz/trace-access.ts` (`fetchAccess` via `mayReadTrace`) | RP-19 to RP-23 | author, or member of the trace's book |

`runSearchPipeline` (`services/search-pipeline.ts:340`) is the one entry point above `hybridSearch`, `evidenceSearch`, and `fetchCorpusTraces`, but it receives only `groupIds`, not a viewer. The draft condition needs the viewer's user id to reach these three functions.

## API-key agent surfaces (REST)

| # | Path | file:line (function) | Returns / counts | Who can call | Trace filtering today | Draft disposition |
|---|---|---|---|---|---|---|
| RP-01 | `GET`/`POST /check` with a recipe (deposit) | `routes/check.ts:1130` (`handleCheck`) → `services/trace.service.ts:429` (`submitAndSearch`) → `runSearchPipeline` | similar recipes (full text, evidence, references, book, dates), cluster sizes ("represents N similar"), related evidence with parent recipe ids, `totalResults` | API key (Bearer or `?key=`), read scope `Principal.readGroupIds`, narrowed by `read_recipe_books` | module scope, local SQL (via `hybridSearch`, `evidenceSearch`) | `exclude` + `label-own` |
| RP-02 | `GET /check?filter=` (search only) | `routes/check.ts:1369` → `services/trace.service.ts:977` (`searchWithoutLogging`) → `runSearchPipeline` (semantic or corpus mode) | same shape as RP-01, no deposit; excludes the caller's own recipes by default (`resolveStructuredFilters`, ~line 880) | API key, same scope | module scope, local SQL | `exclude` + `label-own` (only under `author:me` / `author:anyone`, since own recipes are excluded by default) |
| RP-03 | Search-only zero-result scope counts | `services/trace.service.ts` ~1083 to 1105 (inside `searchWithoutLogging`: `searchedCorpusSize`, `searchedOwnExcluded`) | "no matches among the N recipes in scope" and the own-excluded count | API key | module scope, local SQL | `exclude` (a collaborator's drafts must not change N) |
| RP-04 | Deposit idempotency hit | `services/trace.service.ts` ~572 (`INSERT ... ON CONFLICT (api_key_id, group_id, claim_text_hash) DO NOTHING`) and ~646 (existing-row lookup) | the existing trace's id as `checked.recipeId`; new evidence on the duplicate is silently dropped | the same API key only (key id is part of the unique key) | key-scoped by construction | `decide` (see "Leak channels") |
| RP-05 | Known-set and intent ledgers | `services/trace.service.ts` ~675 and ~1033 (`session_id` deposits ∪ `session_shown`), `services/intent.service.ts:146` (`fetchIntentShownIds`) | ids used only to render already-returned results as id stubs | API key presenting a session token or intent id | none (ids are only matched against a filtered result set) | `irrelevant` while stubbing stays rendering-only |
| RP-06 | `GET /recipes?ids=` | `routes/recipes.ts:50` → `services/recipe-lookup.service.ts:118` (`lookupRecipes`) | full recipe, author email, book, evidence; `not_found_or_unreadable` marker; `ambiguous_prefix` with two candidate ids | API key, `Principal.readGroupIds` | module scope, local SQL (prefix scan ~150, main select ~186) | `exclude` + `label-own`; the prefix scan must apply the same condition or `ambiguous_prefix` names a hidden draft |
| RP-07 | `GET /briefing` | `routes/briefing.ts:24` → `services/briefing.ts:125` (`composeBriefing`) | composes RP-08, RP-09, RP-10 | API key | module scope (via `resolveScope`, ~253) | inherits RP-08 to RP-10 |
| RP-08 | Briefing "Requested recipes" (`recipe_ids`) | `services/briefing.ts:178` → `lookupRecipes` | as RP-06 | API key | module scope, local SQL | `exclude` + `label-own` |
| RP-09 | Briefing per-book Index lines | `services/briefing.ts:307` → `services/book-stats.service.ts:57` (`fetchBookStats`) | per book: recipe count, author count, newest judgment date, last logged date, feedback count and fulfilled, reaction counts (`still_true`, `stale`, `wrong`) | API key (MCP surface briefings and `list_my_recipe_books`) | module scope, local SQL | `exclude` (counts and dates); `decide` whether a person's own drafts appear as a separate "N drafts awaiting review" figure |
| RP-10 | Briefing exemplars | `services/briefing.ts:383` → `services/briefing-exemplars.ts:62` (`fetchBriefingExemplars`) → `runSearchPipeline` (corpus mode, or query mode with `filter`); `enrichExemplarRows` ~218 loads author, evidence, references by id | clustered exemplar recipes with member counts | API key; also JWT via RP-26 | module scope, local SQL | `exclude`; `decide` whether own drafts may be exemplars (recommend no: exemplars sample the confirmed corpus) |
| RP-11 | `POST /feedback`, `GET /feedback` | `routes/feedback.ts:151` and `:218` → `services/feedback.service.ts:430` (`ingestFeedback`) | per row `ok` or `TRACE_NOT_READABLE`; the resolved full UUID for a short-id prefix; `ambiguous` candidates | API key | module scope, local SQL (prefix scan ~497, readable-set select ~533) | `exclude` (a collaborator's row about a draft id gets the uniform marker); permitted viewers may attach feedback |
| RP-12 | `GET /health/integrity` | `routes/integrity.ts:243` (`readIntegrity`, ~124) | orphaned embedding sources, chunks, vectors per readable book, with up to 10 orphan source ids | API key | module scope, local SQL | `irrelevant` (reports only sources whose trace no longer exists; a live draft is never an orphan) |

## MCP tools (remote HTTP, `routes/mcp.ts`)

| # | Tool | file:line (function) | Returns / counts | Who can call | Trace filtering today | Draft disposition |
|---|---|---|---|---|---|---|
| RP-13 | `check_recipe` | `routes/mcp.ts:393`; `submitAndSearch` ~564, `enrichResults` ~591, `maybeSynthesize` ~600, ride-along `ingestFeedback` ~631 | as RP-01, plus the optional premium synthesis (an LLM summary of the returned results) | API key (Bearer), incl. OAuth keys | module scope, local SQL | `exclude` + `label-own` (synthesis inherits whatever results it is given; own drafts must stay labelled in its input) |
| RP-14 | `search_recipes` | `routes/mcp.ts:677`; `searchWithoutLogging` ~708 | as RP-02, RP-03 | API key | module scope, local SQL | `exclude` + `label-own` |
| RP-15 | `get_briefing` | `routes/mcp.ts:804` → `composeBriefing` | as RP-07 to RP-10 | API key | module scope | inherits |
| RP-16 | `get_recipes` | `routes/mcp.ts:862` → `lookupRecipes` ~887 | as RP-06 | API key | module scope, local SQL | `exclude` + `label-own` |
| RP-17 | `list_my_recipe_books` | `routes/mcp.ts:909` → `services/briefing.ts:209` (`composeCorpusContext`) → `fetchBookStats` | as RP-09 | API key | module scope, local SQL | as RP-09 |
| RP-18 | `log_feedback` | `routes/mcp.ts:1076` → `ingestFeedback` ~1126 | as RP-11 | API key | module scope, local SQL | as RP-11 |

`update_recipe_book_description` (`routes/mcp.ts:960`) reads no traces.

Added by slice 2:

| # | Tool / path | file (function) | Returns / counts | Who can call | Trace filtering | Draft disposition |
|---|---|---|---|---|---|---|
| RP-46 | `verify_draft` (MCP, remote and stdio) and `POST /recipes/:id/verify` | `services/draft-verify.service.ts` (`verifyDraft`) via `lookupRecipes`, then `authz/draft-resolution.ts` (`resolveDraft`) | on success the recipe id, `draftState: verified`, evidence count; otherwise the uniform `not_found_or_unreadable` (404 on REST), `ambiguous_prefix`, "not a draft", "already resolved", or an evidence refusal | API key; the key must be allowed to verify (`keyMayVerifyDrafts`, every key today, not headless keys from slice 5), and the draft's book must be in its effective write scope ([F78]) | module: readable by id through `traceReadableById`; `hasWriteAuthority`; the resolving UPDATE requires the key's user to be the draft's subject and the book to be writable | `exclude` for everyone else (uniform absence, DT-VER-07); a one-way write for the person's own agents |

**Stdio server** (`apps/mcp-server/src/index.ts`): a thin proxy with no database access. `check_recipe` → `POST /check` (or `GET /check?...&format=json`), `search_recipes` → `GET /check?filter=`, `get_briefing` → `GET /briefing`, `get_recipes` → `GET /recipes?ids=`, `log_feedback` → `POST /feedback`. It inherits RP-01, RP-02, RP-07, RP-06, and RP-11 exactly; no separate row.

## JWT human surfaces (`routes/traces.ts` unless noted)

| # | Path | file:line (function) | Returns / counts | Who can call | Trace filtering today | Draft disposition |
|---|---|---|---|---|---|---|
| RP-19 | `GET /traces/:id` | `routes/traces.ts:571` → `readableTraceFor` | full recipe, evidence, references, author email, key label, `canDelete` / `canMove` | JWT, verified email | module (trace) | `human-own`; everyone else gets the same 404 as a missing id |
| RP-20 | `GET /traces/:id/feedback` | `routes/traces.ts:403` → `canReadTrace` | feedback rows (incl. `relatedTraceIds`, intent id, agent id), reaction counts, the viewer's own reaction | JWT | module (trace) | `human-own` |
| RP-21 | `PUT`/`DELETE /traces/:id/reaction` | `routes/traces.ts:484`, `:516` → `canReadTrace` | 200 vs 404 (existence to anyone who may read) | JWT | module (trace) | `human-own`; this is the human verification path in the design |
| RP-22 | `PUT /traces/feedback/:feedbackId/star` | `routes/traces.ts:535` → `canReadTraceOfFeedback` | 200 vs 404 | JWT | module (trace) | `human-own` |
| RP-23 | `PATCH /traces/:id` (move), `DELETE /traces/:id` | `routes/traces.ts:670`, `:780` → `roleInBookOfTrace` + local role rule (`authorizeTraceMove`, `isOwnerOrAdmin`) | 404 when the id does not exist, 403 when it exists and the caller may not act; a book owner or admin may delete or move another member's recipe | JWT | module (trace facts), rule applied locally | `decide`: today a non-member gets 403 for a draft that exists (existence oracle given the id), and a book admin can delete or move a collaborator's draft they cannot see |
| RP-24 | `GET /traces/map` | `routes/traces.ts:49`; `bookIdsFor`, then `runSearchPipeline` (corpus mode by default, query mode with `query`) | clusters with exemplar text, member ids and 80-char previews, member counts, unclustered traces with vectors, concept-axis positions, `totalTraces` | JWT | module scope (`bookIdsFor`), local SQL | `exclude` for every viewer, the person included: the map is a normal surface, and the design's only exception is for the person's agents (DT-VIS-08). Keeping drafts out of the pool for everyone also keeps the layout cache (RP-44) viewer-independent |
| RP-25 | `GET /traces?groupId=` | `routes/traces.ts:300`; `roleIn` gate, then local SQL `WHERE t.group_id = ...` | every recipe in the book (any author) with author email, counts, `canDelete` | JWT, member of the book | module scope (`roleIn`), local SQL | `exclude` others' drafts; `human-own` for the viewer's own |
| RP-26 | `POST /keys/briefing` | `routes/keys.ts:222` → `authenticateKey(..., { ownerUserId })` → `composeBriefing` | the dashboard copy-briefing (as RP-07 to RP-10) | JWT, for the user's own key | module scope | inherits RP-08 to RP-10 |
| RP-27 | `GET /traces` (no `groupId`) | `routes/traces.ts` ~345 (`WHERE t.user_id = <caller>`) | the caller's own recipes across books | JWT | own-user, local SQL | `human-own` (labelled) |
| RP-28 | `GET /traces/count` | `routes/traces.ts:278` | count of the caller's own recipes | JWT | own-user, local SQL | `decide` (count own drafts or not; recommend count, since only the owner sees it) |
| RP-29 | `GET /traces/checks` | `routes/traces.ts:244` (audit log `actor_user_id = <caller>`, `LEFT JOIN claimnet.traces` for claim text) | the caller's check log with their deposited recipes' text and each check's `metadata` (incl. `resultTraceIds` and similarities as shown at the time) | JWT | own-user (audit actor), local SQL | `human-own` |
| RP-30 | `GET /auth/me/export` | `routes/auth.ts:390` (traces ~440, links ~448 to ~498, all `user_id = <caller>`) | the caller's own recipes, evidence, references, link rows | JWT, verified email | own-user, local SQL | `human-own`; `decide` for drafts deposited about the caller by someone else (whose export holds them depends on which user id the trace row carries) |

Frontend mapping, for the verifier's browser pass: the dashboard (`DashboardPage`) uses RP-27 and RP-28; `GroupTracesPage` uses RP-25; `RecipeMapPage` uses RP-24 and RP-26; `TraceDetailPage` uses RP-19 to RP-23; `CheckLogPage` uses RP-29; `SettingsAccountPage` uses RP-30. `CheckRecipePage` (the in-app check page) mints the user's daily key through `POST /keys/daily` and then calls `/check` with it to deposit, so it is RP-01; it never sends `filter`, so it has no search mode (RP-02 is reached only by agents and the daily agent link). No SPA page runs the search grammar yet; where the review queue lists from is build log open question 21.

Added by slice 3 (the review queue; rubric in the build log §Slice 3 rubric):

| # | Path | file (function) | Returns / counts | Who can call | Trace filtering | Draft disposition |
|---|---|---|---|---|---|---|
| RP-47 | `GET /traces/drafts` (queue listing, `q`, `page`) | `routes/traces.ts` → `services/draft-queue.service.ts` (`listDraftQueue`); semantic text through `runSearchPipeline` | the person's unresolved drafts: text, book, ratings, deposit time, key label, first evidence interpretation, state, whether the actions are available; an honest total and page count; a grammar error is a 400 with the parser's text | JWT, verified email | module: book scope from `booksFor` (live memberships), rows from `draftAwaitingReviewBy` with `traceVisibleTo`; qualifier-only order is `triageOrderSql` (`services/search-selection.ts`); item details through `traceReadableById` | `human-own`: only drafts about the viewer, never anyone else's, never published or resolved ones, never a book the viewer has left |
| RP-48 | `GET /traces/drafts?ids=` (the id-list link) | `services/draft-queue.service.ts` (`listLinkedRecipes`) → `authz/trace-access.ts` (`resolveReadableTraceRefs`) | the named recipes the viewer may read, in the given order, at most 20, each with its state; one count of ids not shown, and whether the link was cut at 20 | JWT, verified email | module: `mayReadTrace` on facts fetched per reference (full id, or a short-id prefix as a primary-key range); unreadable, missing, malformed, and ambiguous references all fold into the one count | `human-own` for the viewer's own drafts in any state (including a book they have left, shown with the actions unavailable); published recipes they may read; everything else uniformly absent |
| RP-49 | `GET /traces/drafts/count` | `services/draft-queue.service.ts` (`countDraftsAwaitingReview`) | the dashboard's "N drafts await your review"; the same statement as RP-47's total | JWT, verified email | module, as RP-47 | `human-own` (a count of the viewer's own) |
| RP-50 | `POST /traces/:id/not-chosen` | `routes/traces.ts` → `authz/draft-resolution.ts` (`resolveDraft`, resolution `not_chosen`) | 200 with the new state; 409 "not a draft" or "already resolved"; 403 "needs write access to this recipe book" for the draft's own person without write authority; otherwise the same 404 as a random id | JWT, verified email | module: `canReadTrace`, `roleInBookOfTrace`, `hasWriteAuthority`; the UPDATE rechecks subject, state, and write authority | a one-way write by the draft's subject alone; uniformly absent for everyone else (S3-A3) |

Changed by slice 3, no new path: RP-02 and RP-14 (and the stdio `search_recipes`) take `is:draft`, `-is:draft`, `impact:`, and `uncertainty:` as predicates built in `services/search-selection.ts` and ANDed into `hybridSearch` and `fetchCorpusTraces` as opaque selections (the draft one composes `draftAwaitingReviewBy`); `is:draft` lifts the exclude-own default. RP-01, RP-02, RP-13, and RP-14 result rows that carry `draftState` (only ever the viewer's own) also carry `impact` and `uncertainty`. RP-21 (the reaction route) now answers the draft's own person without write authority with the honest 403 of RP-50 instead of the missing-id 404; everyone else's answer is unchanged. RP-46 (`verify_draft`, `POST /recipes/:id/verify`) answers "not a draft" (409) for a published recipe the key can read and "needs write access to this recipe book" (403) for the key's own draft outside its write scope; what the key cannot read keeps the uniform answer.

Frontend mapping: `DraftQueuePage` (`/app/drafts`) uses RP-47 and RP-48 and acts through RP-21 and RP-50; `DashboardPage` adds RP-49.

## Admin (system role only, `routes/admin.ts`)

| # | Path | file:line | Returns / counts | Trace filtering today | Draft disposition |
|---|---|---|---|---|---|
| RP-31 | `GET /admin/users` | `routes/admin.ts:194` (~258) | per-user recipe count | none | `irrelevant` (operator totals); `decide` only if drafts on behalf of others should be attributed to the subject |
| RP-32 | `GET /admin/stats` | `routes/admin.ts:281` | total recipes, last 24 h, last 7 days | none | `irrelevant` |
| RP-33 | `GET /admin/workers/embeddings` | `routes/admin.ts:527` (~552) | total trace count vs embedded per strategy | none | `irrelevant` |
| RP-34 | `GET /admin/queues/jobs`, `/queues/jobs/:id` | `routes/admin.ts:440`, `:497` | pg-boss job rows including `data`, which for embedding jobs carries `chunkText` (the recipe text) | none | `irrelevant` to the product rule (same operator exposure as any private book's text today); note it in the security review |

`POST /admin/integrity/repair` (`routes/admin.ts:841`) deletes orphans only: `irrelevant`.

## Writes that read traces

| # | Path | file:line | What it reads | Draft disposition |
|---|---|---|---|---|
| RP-35 | `POST /import` | `services/import.service.ts` ~234, ~268 | existing rows by id to classify skip / conflict / remap; foreign ids are remapped to a deterministic per-importer id rather than reported | `decide`: the export format has no draft state today, so a draft exported and re-imported would come back as an ordinary recipe |
| RP-36 | Trace move and delete services | `services/trace-move.service.ts` ~130, `services/trace-delete.service.ts` ~67 | the row under lock | covered by RP-23 |
| RP-37 | Account deletion | `services/user-delete.service.ts` ~255, `authz/book-succession.ts:112` | the user's traces for the cascade | `irrelevant` (deletion) |
| RP-38 | Ephemeral workspace reaper | `services/ephemeral-workspace.service.ts` ~281 | traces in an expiring book | `irrelevant` (deletion) |

## Internal pipeline

| # | Function | file:line | What it does | Trace filtering today | Draft disposition |
|---|---|---|---|---|---|
| RP-39 | `hybridSearch` | `services/vector-search.service.ts:237` (count ~310, ANN ~350, exhaustive fallback, trace load ~449) | the semantic trace search behind RP-01, RP-02, RP-10, RP-24 | `es.group_id IN (...)` on the denormalized `embedding_sources.group_id`; joins `traces` only for keyword / structured filters | `exclude` + `label-own`: the one condition goes in `searchPredicates` so the count, ANN, and fallback agree |
| RP-40 | `evidenceSearch` | `services/vector-search.service.ts:520` | related evidence, returns parent trace id and text | `es.group_id` (evidence source); already joins `claimnet.traces t` | `exclude` + `label-own` |
| RP-41 | `fetchCorpusTraces` | `services/search-pipeline.ts:277` | corpus mode rows and honest total | `t.group_id IN (...)` | `exclude` + `label-own` |
| RP-42 | `fetchTraceVectors`, `enrichResults`, `clusterEvidenceInResults`, `enrichExemplarRows` | `services/search-pipeline.ts:176`; `services/result-enricher.ts:85`, `:215`; `services/briefing-exemplars.ts:218` | load vectors, evidence, references, book, author for ids handed in | none (by id) | `irrelevant` provided every caller passes ids from a filtered list; a verifier checks each caller, not these functions |
| RP-43 | Embedding pipeline | `services/trace.service.ts` ~600 (`enqueueEmbedding` for trace and full-recipe context), `embedding-worker/jobs/strategy-sweep.ts` ~90, `strategy-check.ts:40` | embeds every trace and its evidence, drafts included | none | `irrelevant` for exposure: embedding a draft is required so verification needs no re-embed; exclusion happens at query time (RP-39 to RP-41) |
| RP-44 | Map layout cache | `services/map-layout-cache.ts:22` (`mapLayoutCacheKey`), `routes/traces.ts` ~100 to ~145 | process-wide LRU of computed map layouts, keyed by book ids, k, max chars, expand, strategy, and a per-book corpus version | none: the key carries no viewer | `exclude`: if visibility ever depended on the viewer here, a layout computed for a person who sees their own drafts would be served to a collaborator with the same book set. With drafts out of the map for everyone (RP-24) the key stays viewer-independent; the verifier checks the pool is filtered before clustering, not after |
| RP-45 | Offline eval scripts | `apps/backend/src/eval/*.ts` | ranking evaluation over whole corpora | none | `irrelevant` (not served; run by an operator against an eval stack) |

## Leak channels beyond row results

Rows are the obvious channel. These are the others a verifier should try.

- **Counts.** `hybridSearch` reports an exact `totalResults` ("477 similar recipes found"); corpus mode reports an honest total; RP-03 reports scope size; RP-09 reports recipe count, author count, and newest-judgment and last-logged dates per book; the map reports `totalTraces`. Each must be computed with the same condition as the rows, or a collaborator can watch a number move when a draft lands. In `hybridSearch` the count, the ANN query, and the fallback share one `searchPredicates` fragment, so one edit covers all three; `fetchCorpusTraces` builds one `conditions` list for rows and count.
- **Cluster sizes.** "Represents N similar recipes" and map `memberCount` come from the clustered pool. They are safe exactly when the pool is filtered before clustering.
- **Related evidence.** `evidenceSearch` returns evidence text and its parent recipe id from other recipes. It filters on the evidence's own `embedding_sources.group_id`, not on the parent trace, so it needs its own copy of the condition (it already joins `traces`, so the condition is cheap there).
- **Book index dates.** `newestJudgment` and `lastLogged` in RP-09 change when any trace lands in the book. A collaborator seeing "newest judgment today" with no visible new recipe learns a draft exists.
- **Idempotency hit.** The unique key is `(api_key_id, group_id, claim_text_hash)`, so only the depositing key can hit it; a collaborator cannot probe a draft through it. The consequence is for the depositor: re-checking the same text through the same key returns the existing row. A draft re-checked as a non-draft stays a draft (and the new evidence is dropped); a non-draft re-checked as a draft stays a non-draft. Daily keys rotate, so the same text through tomorrow's daily key makes a second row.
- **Short-id prefixes.** `lookupRecipes` and `ingestFeedback` resolve 8-character prefixes with `LIMIT 2` and report `ambiguous_prefix` with both candidate ids. If the prefix scan omits the draft condition while the main select applies it, a collaborator learns a hidden draft's full UUID from the ambiguity candidates.
- **Feedback acceptance.** `ingestFeedback` answers `ok` for a readable trace and `TRACE_NOT_READABLE` otherwise. With drafts, "readable" must mean visible to this viewer, or feedback becomes an existence oracle for a draft whose id leaked (for example through a shared session log).
- **Uniform 404 on human routes.** RP-19 to RP-22 return one 404 for missing and unreadable, by construction in `trace-access.ts`. RP-23 (move, delete) deliberately returns 403 for "exists, not yours", which reveals a draft's existence to anyone holding its id, and a book owner or admin passes the delete gate for a collaborator's draft they cannot read.
- **Known-set and intent ledgers.** `session_shown`, `intent_shown`, and the session's own deposits only turn already-returned results into id stubs. They never add rows to a response, so they are not a channel as long as that stays true. A labelled own draft that was shown will stub like any other recipe.
- **Embedding pipeline.** Drafts are embedded like everything else (RP-43). That is correct, but it means every vector query (`hybridSearch`, `evidenceSearch`, and any future neighbour query) must carry the draft condition. `hybridSearch` filters on `embedding_sources.group_id`, a denormalized copy of the trace's book that `trace-move.service.ts` has to keep in step by hand (its header calls this "the load-bearing detail"). A draft flag copied onto `embedding_sources` would inherit that failure mode; a join or `EXISTS` against `traces` would not, at some cost to the ANN plan.
- **Map layout cache and centroids.** Cluster centroids, exemplar choice, and 2D positions all shift when a draft is in the pool, even if the draft itself were stripped from the response afterwards. Drafts must be out of the pool before clustering. Because the map excludes drafts for every viewer (RP-24), the cache key needs no viewer component (RP-44).
- **Feedback lineage.** `GET /traces/:id/feedback` returns other agents' `relatedTraceIds`. An agent could cite a draft's id there. Ids alone reveal nothing readable while every by-id surface applies the condition, so this is a note, not a separate row.
- **Export and import.** Export (RP-30) is by `user_id`, so it follows whatever "whose draft" means on the row. Import (RP-35) has no draft field, so a round trip would publish a draft.
- **Admin job payloads.** `GET /admin/queues/jobs/:id` returns embedding job data including chunk text. System role only, same exposure as private books today.
