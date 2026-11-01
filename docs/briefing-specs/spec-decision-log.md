# Spec-decision log — briefing-copy changes

Every PR that touches briefing copy (`packages/domain/src/recipe-guide-content.ts`, the briefing composer, MCP tool descriptions) appends an entry here **before** merging: the date, each edit, the scenarios it intends to move, and the rationale for why every other scenario holds. See [README.md](README.md) §The regression rule. Newest entry first.

(Renamed from declared-intent-log.md on 2026-08-23: "intent" now names the runtime intent-registration mechanism — cold-start v2 Phase C — so the discipline's log takes an unambiguous name. The discipline itself is unchanged.)

## 2026-10-31 — OpenAI plugin round: reads no longer revive drafts (recipe ac453630)

The operator ruled that only a further recipe revives a draft, so a search or briefing carrying an intent id no longer marks the intent used. The briefing's bus sentence said a draft "stays live while your intent is in use", which an agent polling by search would read as keeping its draft alive.

### Edits and the scenarios they move

1. **The briefing's "## Drafts" section:** "A draft is a question on a bus: it stays live while your intent is in use, and expires once your task goes quiet." becomes "A draft is a question on a bus: it lives while you check under your intent; reads alone let it expire in a day." It is three characters shorter, so the thin and headless ceilings hold, and it avoids the words the section's voice test refuses. Dropped: "goes quiet" as the wording here; the expired-draft label still says "its task has been quiet". "poll `is:draft intent:<id>`" stays, because polling remains how an orchestrator reads its sub-agents' drafts.
2. **The plugin's skill** describes a search's writes without "marked as used". It ships in the package.
3. **An empty `is:draft` search** (not briefing copy, listed because it answers the poll this section teaches) reads "No open drafts match among the N recipes in scope. Expired drafts aren't listed here; is:expired finds them." in place of the thin-corpus line, in markdown and in the JSON notice.

Scenario moved: "A draft lives while its task does…" in `checking-behavior.feature`, whose guard quotes this sentence. DT-BUS-03 in `docs/product-specs/drafts-and-triage.feature` now has a read leave the draft expired and a check revive it. All others hold: nothing else in the briefing mentions how long a draft lives.

## 2026-10-31 — OpenAI plugin round: `search_recipes` no longer takes `feedback` (recipe 9dbcfb77)

The directory's tool scan said: "This tool is marked readOnlyHint: true, but its behavior appears to have a user-visible side effect." The tool wrote a feedback row when that parameter was passed, and the annotation rule (recipe `3b166817`) excuses the call's audit row and its intent, not feedback rows. This supersedes the `search_recipes` half of slice 1's item 3 below.

### Edits and the scenarios they move

1. **Remote `search_recipes` loses the `feedback` parameter.** Dropped from its served schema: the pointer description "Feedback rows about PRIOR checks or searches, riding along with this call; each row takes log_feedback's fields. A rejected row never blocks this call." `check_recipe` keeps that description word for word. The stdio tool never declared the parameter. Nothing is lost: `log_feedback` takes `search_id`, and the teaching in the briefing, the tool descriptions and the plugin's skill already named `check_recipe` and `log_feedback`, so no briefing copy changes.
2. **The refusal steers.** A call that still sends it answers: "Error: search_recipes does not take feedback (send those rows with log_feedback; a row about a search takes search_id). Nothing was run; send it again with the names it takes: …". Both servers, through the shared guard.

Scenario moved: "The read-only search tool takes no feedback rows" (new) and "Ride-along feedback keeps every field while its schema shrinks to a pointer" (now `check_recipe` only), both in `docs/product-specs/drafts-and-triage.feature`. All others hold: an agent taught by the briefing never sent this parameter on search unless it read the schema, and the refusal gives it the retry.

## 2026-10-26 — OpenAI plugin round, stream L: no selection diagnostics in the exemplars, and no /uploads example over OAuth

Plan: [../planning/openai-plugin-directory.md](../planning/openai-plugin-directory.md) item 6 (output minimisation). Build file: [../planning/openai-plugin-build/listing.md](../planning/openai-plugin-build/listing.md), row L13. Both findings came from stream T's audit of every tool's real output against OpenAI's rule ("Do not include diagnostic, telemetry, or internal identifiers … unless they are strictly required", developers.openai.com/plugins/plugin-guidelines.md), sent to stream L because the text is in L's part of `recipe-guide-content.ts`.

### Edits and the scenarios they move

1. **The exemplars section no longer prints "Selection parameters"** (`buildExemplarsSection`, every surface). The block listed the cluster count, map mode, concept axes, filter keywords, the purpose and the embedding strategy: ranking diagnostics no reader acts on. The purpose line went with it; the agent supplied the purpose itself. The function keeps its context parameter (`_context`) so the composer's call doesn't change.
   → Moves: `briefing-surfaces.feature` "MCP agent opts back into corpus exemplars" gains "And the exemplars carry no selection diagnostics".
2. **An OAuth connection's briefing leaves out the `/uploads` paragraph** (`BRIEFING.build`, both profiles, `oauthConnection` only). It told the agent to POST files "using your same Bearer token" with a `curl … Authorization: Bearer YOUR_API_KEY` example, which an OAuth client can't follow: it holds no key, and its access token is refreshed by the client. Key-holding sessions keep the paragraph unchanged. The OAuth key, setup and web sections were already credential-free (2026-07-06).
   → Moves: `briefing-surfaces.feature` new "An agent connected through OAuth gets no instructions that need a key it doesn't hold".

### Scenarios watched, with rationale for holding

- **Every scenario on an API-key briefing:** unchanged. Edit 2 changes only the OAuth composition, and edit 1 only the exemplars, which the capped fixtures don't carry.
- **`checking-behavior.feature` file-evidence scenarios:** an OAuth agent still has `file_url` (a public URL) and `file_base64` (small files) from the tool's own parameter descriptions; only the upload route, which needs a key, is gone from its briefing.

### Measured

Built with the test file's inputs (`BRIEFING.build`, no exemplars) and one exemplar for the section.

| Measure | Before | After | Cap |
|---|---|---|---|
| Thin briefing (API key) | 22,628 characters | 22,628 | 22,800 (unchanged) |
| Thin briefing (OAuth) | 22,592 | 21,813, −779 | 22,800 |
| Full briefing (API key) | 28,814 | 28,814 | none |
| Full briefing (OAuth) | 24,747 | 23,968, −779 | none |
| Exemplars section, one exemplar | 775 | 591, −184 per briefing with exemplars | none |
| `tools/list` and shared descriptions | | unchanged (T's blocks, untouched) | |

## 2026-10-26 — OpenAI plugin directory, stream T: tool descriptions in the reviewed shape, server instructions, annotations by one rule, and a profile tool

Plan: [../planning/openai-plugin-directory.md](../planning/openai-plugin-directory.md) items 3 to 7 and 13. Rubric: [../planning/openai-plugin-build/tool-contract.md](../planning/openai-plugin-build/tool-contract.md). Justifications, claim by claim: [../connectors/openai-plugin.md](../connectors/openai-plugin.md). The annotation rule is recipe `3b166817`.

### Edits

1. **Every tool description** (`MCP_TOOL_DESCRIPTIONS`, served on both servers) now says what the tool does, when to use it, and when not to, naming the tool to use instead, as plain statements. Wording that claimed more than the server does was corrected:
   - `check_recipe` says the same recipe text, book **and key** return the same id (the dedup is per key);
   - `update_recipe_book_description` says the response shows the earlier text once (an audit row keeps it, so "not kept" would have been untrue);
   - `check_recipe`'s file attachment says a `file_url` is fetched from the public internet.
2. **Dropped:** `log_feedback`'s "Null results earn a row.", to fit its not-for clause under the 420-character limit. The briefing keeps the teaching ("results that didn't help are worth a row too"). `check_recipe`'s "Check freely … so future checks get smarter (stigmergy)" gave way to the use and not-for clauses. The briefing's opening and When to check carry that teaching.
3. **`update_recipe_book_description`'s description** moved into the shared block, and **`get_profile`** (new) has its own.
4. **`synthesize`:** the description no longer begins "Premium opt-in", and the refusal reads "Synthesis is off for this account; the results below are not synthesised." (it said "a premium feature").
5. **Server instructions (new)**, 871 characters, the same on both servers, with the cross-tool moves in the first 512.
6. **Output:** the structured `ranking` block and the stored feedback row's id left the MCP responses; REST keeps both.

### Scenarios watched, with rationale for holding

- **Search vs check** (`checking-behavior.feature`) and **feedback-loop** scenarios: each tool still sends the reader to the same sibling, now in a not-for clause. The search, check and feedback mechanics are unchanged.
- **Every briefing scenario:** no briefing text changed on this branch. Stream L's two briefing edits from this round's audit are logged under L's entry.

### Measured

| Measure | Before (`main` at `cf6e13e`, with slice 8b's `page`) | After | Cap |
|---|---|---|---|
| Remote `tools/list` | 17,904 bytes | 18,930 | 18,200 → 18,950 |
| Stdio `tools/list` | 14,407 bytes | 14,738 | 14,700 → 14,750 |
| Shared descriptions | 6,593 characters | 7,434 | 6,600 → 7,450 |

The growth is the same as when this was first measured, before slice 8b merged (+1,026, +331, +841). Stream O's `securitySchemes` move the remote cap again after this, by their own bytes.

## 2026-10-26 — Drafts-and-triage slice 8b items 1 and 2 (stream B): the flat list, and created-after: / changed-after:

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §Slice 8 items 1 and 2; ruling 51. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 8b items 1 and 2 rubric. Design checked as recipe `4a517f5b`; qualifier names as recipe `dc8e7d09`.

### Edits

1. **`MCP_PARAM_DESCRIPTIONS.searchQuery`** (the `query` parameter of `search_recipes`, remote and stdio): gains `created-after:/changed-after: (deposit, any change)`. It loses "Qualifier-only: newest first.", which edit 2 replaces, and "(your intent's recipes)" after `intent:int_…`, trimmed under the question 56 rule (untrimmed text in [expanded/slice8b.md](expanded/slice8b.md)). 413 → 412 characters.
2. **`MCP_PARAM_DESCRIPTIONS.searchPage` (new):** the `page` parameter of `search_recipes` on both servers, saying what a search with no bare text returns: a flat list, 50 per page, and its three orders. 152 characters, trimmed from 189 to fit the shared total (untrimmed text in the same file).
3. **The response of a search with no bare text** (shared markdown renderer, `/check` JSON and HTML, structured MCP): the flat list. One row per match with its id, a time and its book, then the page line ("Page p of n, 50 per page. Next: page=p+1." or "This is the last page."), and a page past the end that says so. The renderer's header invariant "No 'Page X of Y' pagination text" now applies to ranked results only. JSON gains `listOrder` and `perPage`, and flat rows carry `loggedAt` and `changedAt` (both described in `/schemas/recipe.json` and `check-response.json`).

### Scenarios intended to move

- `drafts-and-triage.feature`: the new rule "An unattended sweep reads every id that arrived or moved since it last looked" (DT-SWP-01, DT-SWP-02).

### Scenarios watched, with rationale for holding

- **Every search with bare text:** unchanged. The flat path is taken only when the parsed query has no semantic text, and the ranked path's code is not edited (the ranking-regression eval and the S6a and slice 3 search tests pass as they stand).
- **The `intent:` scenarios (DT-OPT-01):** the qualifier's meaning is unchanged. Its listing is now the flat list, which lists every recipe under the intent instead of exemplars.
- **`is:draft` and `is:expired`:** the same sets, now listed in the review queue's triage order.

### Measured

Slice 6a's method: `createMcpServer` and the stdio server over the in-memory transport. Before is `main` at `5b81097` (PR #147).

| Measure | Before | After | Cap |
|---|---|---|---|
| Remote `tools/list` | 17,698 bytes | 17,904 | 18,200 |
| Stdio `tools/list` | 14,201 bytes | 14,407 | 14,700 |
| Shared descriptions | 6,442 characters | 6,593 | 6,600 |
| `searchQuery` | 413 characters | 412 | 420 |

No cap moves.

## 2026-10-25 — Drafts-and-triage slice 8b item 3 (stream D): a Members line on every book, and pending invites for the books you manage

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §Slice 8 item 3. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 8b item 3 rubric. Design checked as recipe `173384b3`.

### Edits

1. **`renderRecipeBooks`** (served wherever the corpus-context block is: `get_briefing` remote and stdio, `GET /briefing`, `list_my_recipe_books`, the web copy-briefing): the Members line is printed on every book with a roster, a solo book included ("Members (1): you"), where it used to be omitted unless a book had two or more members. The caller is listed first as "you", identified by user id. The others keep their labels and order.
2. **"Pending invites (n)" (new):** a line under the Members line on books where the caller is an owner or admin, `(0)` included, counting the invitations the web's pending list shows. A plain member's book has no such line.
3. **The `groups` echo** in the JSON of `GET /briefing` and `POST /keys/briefing` mirrors the text: solo books now carry `members`, the caller's entry carries `isCaller: true`, and managed books carry `pendingInvites`. No client reads the echo today; it shows nothing the text does not.

### Scenarios intended to move

- `briefing-surfaces.feature`: the new scenario "Every book says who is in it, and a book's managers see its pending invites".

### Scenarios watched, with rationale for holding

- **"Web copy-paste briefing keeps the full artifact"** and **"Mid-session corpus refresh returns the index, not a sample"**: the sections they name are unchanged. The recipe-books block gains one or two sub-lines per book, the same on every surface.
- **Every scenario that names collaborators** (cross-pollination copy): the names still appear, now with the caller marked, which is what lets an agent tell the person's own account from a colleague's.

### Measured

| Measure | Before | After | Cap |
|---|---|---|---|
| Thin briefing, fixed fixture | 22,795 characters | 22,845 | 22,800 → 22,850 |
| Thin headless briefing, same fixture | 23,195 characters | 23,245 | 23,200 → 23,250 |
| Remote and stdio `tools/list` | unchanged | unchanged | |

The fixture was updated to the shape the loader now produces: the caller in each roster, and a pending count on the book it owns. Before is `main` with C1 (#138), C2 (#146) and slice 10 (#144) merged; this slice merges after them. Earlier measures of the same lines: 18,183 → 18,233 before C1, and 20,993 → 21,043 after it (when this branch had moved the thin cap 21,000 → 21,050, a move C2's raise replaced). Both caps move by the measured growth, with a dated comment at each assertion, rather than trimming copy (plan: "the cap raise is coordination, not permission").

## 2026-10-25 — Drafts-and-triage slice 10: drafts as a bus (the dispatch line, expired drafts, and how a resolved draft was resolved)

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §A proposed slice 10 (ruled 2026-10-25, recipe `053c9b97`). Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 10 rubric.

### Edits

1. **The dispatch line, new, in check and search responses** (`openQuestionLine`, rendered after the exemplars on both MCP servers and the web check page): "Open question near this call: <id> (<story>, asked <date>). If your context settles it, resolve it; otherwise leave it." The wording is the ruling's. The story appears only when the draft's intent is the caller's own, so before slice 6a it never does.
2. **The books block's Drafts line** (`renderBookStatsLine`): it now counts live drafts only, with its wording unchanged. When drafts expired in the last 7 days it adds "; M expired unanswered in the last 7 days (search is:expired)", or reads "Drafts: none awaiting review; M expired unanswered in the last 7 days (search is:expired)".
3. **Draft labels on agent surfaces** (`draftLabel`): an expired draft reads "[expired draft: its task has been quiet for over 24 hours, so it has left the review queue and results; it can still be verified or rejected by id]" (or "it was deposited with no intent over 7 days ago"); for the depositor of a draft about a colleague it ends "only they can still verify or reject it". For the draft's subject, a resolved draft's label says how and when: "[rejected draft: rejected by your user's agent "K2" on 2026-10-25; its evidence says why]", "[draft not chosen: marked not chosen by the agent that deposited it on …]", "[verified draft: verified by your user on …]". A verified draft had no label before; it now has one for its subject only.
4. **The search grammar's refusals** (`parseSearchQuery`): the qualifier list names `is:expired`; an unknown `is:` value names both values ("is:expired the ones that expired unanswered"); `-is:expired` and `is:expired -is:draft` are refused with a sentence each.
5. **`is:expired` in reference copy:** the web `/check` page's search help and the `filter` field's description in the published recipe schema (`packages/contracts/src/recipe.ts`) name it beside `is:draft`. Neither is a tool or parameter description.
6. **`search_recipes` query description** (`MCP_PARAM_DESCRIPTIONS.searchQuery`, both MCP servers), after the rebase onto slice 6a: "is:draft (your open drafts)" becomes "is:draft (open drafts), is:expired" (406 → 413 characters of the 420 per-description limit). Dropping "your" pays for most of it; `is:expired` names what it lists.
7. **The briefing's "## Drafts" section** (C2's text, after C2 merged): one sentence before "With sub-agents, work live:", "A draft is a question on a bus: it stays live while your intent is in use, and expires once your task goes quiet." Stream C handed it to this slice (2026-10-25), since it describes behaviour this slice ships. It keeps clear of the words C2's voice test refuses in that section. Thin briefing 22,681 → 22,795 characters (cap 22,800, C2's); headless 23,081 → 23,195 (cap 23,200). No cap moved; 5 characters remain on each, which stream D's Members lines (8b item 3) will need a dated raise for.

### Scenarios intended to move

- **Product spec** ([../product-specs/drafts-and-triage.feature](../product-specs/drafts-and-triage.feature)): DT-BUS-01 to DT-BUS-11 (`@slice-10`), added in this PR. DT-BUS-02 and 03 are `@unreleased` until slice 6a's intent link.
- **Briefing spec** ([checking-behavior.feature](checking-behavior.feature)): new scenario "A draft lives while its task does, and an open question named near a call is answered when the agent's context settles it", for edit 7 and the dispatch line.

### Scenarios watched, with rationale for holding

- **DT-VIS-09 and the books-block tests:** the Drafts line keeps its exact wording when no draft has expired, so every existing fixture is byte-identical.
- **Every other tool and parameter description:** unchanged. `searchQuery` (edit 6) is the only one this slice touches.
- **C1 and C2's briefing scenarios:** the Drafts section grows by one sentence and nothing else in the briefing changes; C2's voice test over that section and the thin and headless size tests pass.
- **Check and search responses with no live draft nearby:** byte-identical, since the line is added only when a draft qualifies.

### Measured

Before is `main` at `c21f421` (slices 6c, 8a and 6a merged; the figures slice 6a recorded as its after), after is this branch. Measured with the slice 1 method (initialize then tools/list over the SDK's in-memory transport, the reply's `result` as minified UTF-8 JSON).

| Measure | Before | After | Cap |
|---|---|---|---|
| Remote `tools/list` | 17,642 bytes | 17,649 | 18,200 |
| Stdio `tools/list` | 14,145 bytes | 14,152 | 14,700 |
| Shared descriptions | 6,386 characters | 6,393 | 6,600 |
| `searchQuery` | 406 characters | 413 | 420 per description |

## 2026-10-25 — Drafts-and-triage slice 7, PR C2: what Soup.net is, evidence standards, the over-caution example, unknown parameter names, on-behalf drafts, and the 7b tool, notice and web copy

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §7f (ruled 2026-10-25, on `main` at `e77f657`) and build log question 57 (ruled 2026-10-24). Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 7 rubric, "C2: the briefing body". Agent `c-briefing-75-c2-2026-10-25`, intent `int_gxl5ZMTtpO9RG0cvgsKXw5lJ`; placement checked as recipe `80b2fbb5` (`soupnet-oss`).

C2 has two parts. Edits 1 to 7 change only `BRIEFING.build`. Edits 8 to 12 are the 7b tool, notice, and web copy (S7-B1 to S7-B5). They were written after the rebase onto `main` with A1 (#137) and D (#139) merged; none of them names B's `intent:` term, so they don't wait for B. Stacked on C1, so C2 inherits C1's merge order (after B and E, then C1); S7-B7 depends on #139, which is merged.

### Edits and the scenarios they move

1. **The opening, reframed (7f, S7-B8), both profiles.** A new first paragraph: "Soup.net is the log of calls people and their agents made, with the reasons and the evidence. Read it as context for your next call: when nothing new is on the table, a past call usually stands; when something is, decide, and log your call beside the old one with its own reason. It's also how sessions reach each other: a draft asks a question another agent or a person can answer, an intent groups a task's checks, and feedback says what happened afterwards. It's not a source of truth and not a rulebook." 7f's text in the briefing's second person; "the person" became "a person". The existing opening paragraph follows unchanged, so persistence, the append-only side effect, check freely, no dry run, and search for lookups all stay.
   → Moves: `briefing-surfaces.feature` new "A briefed agent reads the corpus as context for its next call, not as rules".
2. **Evidence standards, in Recipe format (7f, S7-B9), both profiles.** After the structure sentence: what evidence rests on, so a reader who wasn't there can check it (a person's words, quoted, with where; a recipe that quotes them, by id; a document they approved; their code or artifacts; your inference, named as inference); an inference you'd act on is a check; a draft is a hypothesis you wouldn't act on without the answer; "The seam is your confidence to act, not the kind of evidence and not whether a person has spoken". 7f's paragraph verbatim apart from voice and "a person"; its closing display-consequence sentence and the parenthetical about the rejected stronger form are design notes, not briefing copy, and stay in the revision doc. Placed in Recipe format beside the existing evidence sentence, rather than in Drafts, because its subject is evidence for every recipe and only its last two sentences are about drafts (recipe `80b2fbb5`).
   → Moves: `evidence-integrity.feature` new "An inference the agent would act on is checked, and named as inferred" and "A draft carries what its claim rests on, not a bare question".
3. **The over-caution example, in Drafts (S7-B6, carried from C1).** "An orchestrator once refused to verify drafts its own context settled, because the tool copy spoke of a person confirming. The goal is that a person's agent resolves what it can stand behind, and a person sees only what no agent could." The text kept in `expanded/slice-7.md` chunk `slice7.over-caution-example`, verbatim.
   → Moves: `checking-behavior.feature` new "An orchestrator resolves the drafts its own context settles".
4. **On-behalf drafts, in Drafts (S7-B10; the C1 delta verifier's note 5).** "In a shared book the call may be a colleague's; a draft on their behalf is resolved by their agents." The shared-book sentence from chunk `slice7.drafts`, without its closing "not by you". It corrects "you included", which was untrue for a draft deposited on a colleague's behalf; the server already refused that case (`only_subject_reviews`).
   → Watched: `checking-behavior.feature` "A briefed agent records a colleague's judgment as a draft on their behalf…" holds: it hands over the colleague's review link and does not call the draft verified, which this sentence now says in the body too.
5. **Unknown parameter names, in How to check (S7-B7, stream D's audit).** "An MCP tool refuses a parameter name it doesn't take, and the refusal names the ones it does." Describes 8a's refusal (#139), so an unattended reader does not take its first refusal for an outage. It says "MCP tool" because 8a's guard wraps the two MCP transports only; the web `/check` page doesn't refuse an unknown name, and the full profile serves this sentence too (changed on review, 2026-10-25, +5 characters).
   → Moves: `checking-behavior.feature` new "A refused parameter name is corrected, not read as an outage".
6. **Why it's a draft, in Drafts (S7-B11; the operator's 7f addition, his local revision commit `3960743`).** "otherwise draft it, say in the first evidence entry what would settle it" becomes "…say in the first evidence entry why it's a draft rather than a check and what would settle it". The record wants to know how much access to the person's attention the depositing agent had; that reasoning and the key's capability level already carry it, so no marker. It pairs with edit 2's "your inference …, named as inference". `HEADLESS_KEY_SECTION` is unchanged (398 of 400 characters; it points at Drafts).
   → Moves: `checking-behavior.feature` "An agent drafts only a call it cannot stand behind…": its first-entry Then now reads "says why it is a draft rather than a check, and what would settle it". Its "does not give a person's absence as the reason" Then holds: the reason asked for is the agent's confidence to act, per edit 2's seam.
7. **Caps (S7-Z3).** Thin 21,000 → 22,800 and thin headless 21,500 → 23,200, dated in the assertions. Question 57's ruled figures (21,400 and 21,900) were sized to edits 3 and 5 alone; 7f, ruled the day after, came under "the dated thin-cap raise already ruled", and this commit sizes both into it. Headless section (400), `tools/list`, and shared-description caps are unchanged.

8. **The `draft` parameter (7b, S7-B1), both MCP servers.** "True: a draft, for a high-impact, uncertain call the person can't be asked about now; say why in the first evidence entry. Private to them and their agents until verified." becomes "True: a draft, for a high-impact, uncertain call you can't settle yet from the context you hold; say in the first evidence entry why it's a draft and what would settle it. Private to them and their agents until verified." 7b's clause, plus edit 6's first-entry ask so the parameter and the body agree. 171 → 220 characters.
   → Watched: `checking-behavior.feature` "An agent drafts only a call it cannot stand behind…" (C1's rewrite) holds and is now matched by the schema.
9. **The self-draft deposit notice (7b, S7-B2), `verifyHow` in `drafts.ts`.** "To publish it, ask the person and call verify_draft with their answer quoted and cited (or they confirm it in their review queue: <url>)." becomes "Resolve it with verify_draft when you or another agent acting for the person can settle it, or hand them their review queue: <url>." The variant without a link ends "…or they confirm it with still true on the recipe's page." It says "the person" because a self draft is about exactly one person, the caller's (recipe `5d3ddfc7`'s "a person" is for copy that names whose answer settles a call in a shared book). "Quoted and cited" leaves the notice: `verify_draft`'s description and refusal carry the evidence rule. The on-behalf and headless notices are unchanged; they never named `verify_draft`. With the fixture URL, 200 → 194 characters; without a link, 145 → 148. The S3-Z3 and S5-Z4 bounds hold.
   → Watched: `checking-behavior.feature` "An agent that deposited drafts hands its person the queue link rather than listing ids" holds: the link is still the notice's last clause.
10. **The queue intro and the dashboard card (7b, S7-B3).** "…because they could not ask you" (and "…them") becomes ": calls they couldn't yet settle from the context they held" in both intro variants and the dashboard card, whose line moves into `draft-queue.ts` as `DRAFTS_CARD_TEXT` so a unit test covers it. Every other sentence is kept. The card says "Hypotheses agents parked…", not "your agents": browser verification found the card said "your agents" when Pat's only draft came from Dana's agent on his behalf, while the queue's intro for the same draft correctly said "Agents". The card has only a count, so it can't switch the way the intro does. That mismatch predates C2, because the card was a fixed string before too.
    → Moves: `drafts-and-triage.feature` DT-QUE-05, "The queue shows why the agent couldn't ask", becomes "The queue shows why each draft is a draft and what would settle it"; its Given now reads "says why it is a draft rather than a check and what would settle it".
11. **The `/check` page's draft box (S7-B4, found in browser verification).** "Deposit as a draft — the person could not be asked; only they and their agents see it until they verify it" becomes "Deposit as a draft — a high-impact, uncertain call you can't settle yet from the context you hold; only they and their agents see it until it's verified", which matches edit 8. The headless key's forced box is unchanged.
12. **No surface says drafting is for when the person can't be asked (S7-B4).** C1's S7-A5 test now also covers every MCP tool and parameter description (with "once they confirm it", the old `verify_draft` wording that A1 replaced), every deposit-notice variant (self, repeat, with a link, headless, on-behalf), both web strings, and the `/check` form.

Nothing was trimmed to fit, so `expanded/` gains no entry.

### Scenarios watched, with rationale for holding

- **`checking-behavior.feature` "Checks happen autonomously, without permission-seeking"**: the evidence paragraph moves the check/draft seam toward checking ("a claim with none of their words isn't thereby a draft"), and the opening adds no cost to checking.
- **`checking-behavior.feature` "An agent drafts only a call it cannot stand behind…"**: the evidence paragraph's seam (confidence to act) is the same as the Drafts section's ("a hypothesis you can't yet stand behind from the context you hold"), and its order of moves is unchanged.
- **`checking-behavior.feature` "A returned recipe is weighed as a call made in its own context…"**: the opening states the same point at the top; Reading results is unchanged.
- **`evidence-integrity.feature` existing scenarios**: verbatim quotes, specific citations, and "no supportable evidence means no check" all hold; the new paragraph lists kinds of evidence and changes no quoting rule.
- **`briefing-surfaces.feature` profile scenarios**: every addition is in the shared body; the thin profile still drops exactly the sections it dropped.
- Suite re-run: the agent-run harness is not yet wired; the `.feature` files remain the manual checklist.

### Measured

Fixture from `recipe-guide-content.test.ts`.

| Measure | Before (C1, `35b0d03`) | After | Cap |
|---|---|---|---|
| Thin briefing fixture | 20,993 characters (21,106 bytes) | 22,681 (22,794 bytes), +1,688 | 21,000 → 22,800 |
| Thin headless fixture | 21,393 | 23,081 | 21,500 → 23,200 |
| Headless section | 398 | 398 | 400 (unchanged) |
| Full briefing fixture | 27,271 | 28,959, +1,688 | none |
| Remote `tools/list` (bytes) | 17,642 (`main` at `68b14c2`, with 6a) | 17,691, +49 | 18,200 (unchanged) |
| Stdio `tools/list` (bytes) | 14,145 | 14,194, +49 | 14,700 (unchanged) |
| Shared descriptions (characters) | 6,386 | 6,435, +49 | 6,600 (unchanged) |
| Self-draft notice, new draft, fixture URL | the `verifyHow` clause 200 | 194, −6 | S3-Z3, S5-Z4 bounds |

## 2026-10-24 — Drafts-and-triage slice 7, PR C1: the Drafts section, the planned slice 7 copy, eight field additions, and the exemplar slimming lever

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §7a to §7e (ratified 2026-10-24; rulings 48 and 52). Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 7 rubric. Agent `a-drafts-7-2026-10-24`; the wording and budget calls are recipe-checked in `soupnet-oss` under intent `int_YtrwcjA9yqBoBZYQCHlPVFnc`.

Written against stream A's `outcome` on `verify_draft` (6c) and stream B's `intent:` qualifier (6a); this PR merges after both. No tool or parameter description, deposit notice, or web copy changes here: the `draft` parameter, the deposit notice, and the queue and dashboard copy are PR C2, and `verify_draft`'s description is stream A's.

### Edits and the scenarios they move

1. **Drafts section (new, shared body, both profiles; 7a, with the operator's addition of 2026-10-24, revision commit `a7f4d20`).** A draft is "a hypothesis you can't yet stand behind from the context you hold"; the order of moves (act on it: check it as an ordinary recipe and own it; a person's call and they're reachable: ask plainly with your recommendation and its reasoning, and if you keep working meanwhile, draft that recommendation under your intent so their answer reaches you wherever it's given; otherwise draft, say in the first evidence entry what would settle it, rate it, and return when that lands); "A draft is yours to resolve": whichever of a person's agents holds the settling context, the depositor included once the work or a reply settles it, resolves it with `verify_draft` (verified, rejected, or not chosen) under the same confidence rule as any check, quoting their words wherever they gave them; "A draft waits for a person's click only while nothing any agent holds settles it"; with sub-agents, work live (poll `is:draft intent:<id>`, correct mid-run, resolve what you can before finishing). "A person", not "the person", since in a shared book the call may be a colleague's (recipe `7b89581e`).
   → Moves: `checking-behavior.feature` "An agent drafts only when it cannot ask…" rewritten as "An agent drafts only a call it cannot stand behind, and a person's call it keeps working on becomes a draft it owns", out of `@unreleased`; new "An agent resolves a draft once a reply or the work settles it"; `advanced-workflows.feature` new "An orchestrator watches its run's drafts live…"; `checking-behavior.feature` "hands its person the queue link" and "records a colleague's judgment as a draft on their behalf" out of `@unreleased` (slice 7 was what they waited on).
2. **Building both, in Divergent recipe checks (7a, 7b's divergent sentence).** "The exception is building both: when every option will genuinely be pursued, check each as an ordinary recipe; when you can't stand behind any yet, draft each under one intent, with the rubric for choosing stated first. Then check the chosen path with the outcome as evidence and leave feedback on the rest." "Wait for the choice, then check only the chosen one" stays for the ordinary case.
   → Moves: `divergent-checks.feature` new "Options that will all be pursued are each checked as ordinary recipes".
3. **Truthfulness (7c):** "…true at the moment you submit, and checkable by someone who wasn't there."
   → Moves: `evidence-integrity.feature` new "Evidence is checkable by someone who wasn't there".
4. **Ratings in How to check (7c):** "`impact` and `uncertainty` (triage ratings, low | medium | high; leave out one you have no view on)".
   → Moves: `checking-behavior.feature` "A rated check uses the rating vocabulary…" out of `@unreleased`.
5. **Headless section (7c; moved into C1 from C2's list because it depends on neither 6c nor 6a and would contradict the new Drafts section in between; recipe `ee7d5eac`).** "In each draft, say why your user couldn't be asked and what would settle it." becomes "Drafting well is the work (see Drafts): say in each what would settle it, rate it, and draft open options under one intent." 351 → 398 characters (cap 400). A headless briefing is still the ordinary one with exactly this section inserted.
   → Moves: `briefing-surfaces.feature` headless scenario rewritten ("its evidence says what would settle it") and out of `@unreleased`. `drafts-and-triage.feature` DT-HDL-05 already describes this profile; unchanged.
6. **Reading results (new, shared body; 7d items 1 and 6).** "A returned recipe is a call someone made in their context, not a rule: weigh it against yours and say how it applies. A familiar judgment in a new context is worth logging, with that context as evidence. A neighbor that is your own open draft is your assumption coming back; weigh it as that." A new short section because the only results-interpretation text today is in "When the user copies JSON results back", which the thin profile drops (recipe `4357942f`).
   → Moves: `checking-behavior.feature` new "A returned recipe is weighed as a call made in its own context…", "A familiar judgment in a new context is logged…", "The agent's own open draft is not read as support".
7. **When to check, three moments (7d items 2 and 5),** in the example-and-goal form (recipe `72f788bf`): extending something that already has a default; writing for a particular reader in a particular place; an instruction pulling against your judgment (checked "with the instruction quoted", a verifier follow-up).
   → Moves: `checking-behavior.feature` three new scenarios, one per moment.
8. **Two axes, in Authoring for retrieval (7d item 3):** count and specificity are separate; the claim at the most general level that's still true, as a choice rather than a "must", the specifics in the evidence.
   → Moves: `recipe-voice.feature` new "The claim is stated generally and the specifics move to the evidence".
9. **Recipient role, a fourth role pattern (7d item 4):** "Three patterns" becomes "Four patterns"; the recipient role for what the person receives, with the stays-true-when-they-author-it test.
   → Moves: `recipe-voice.feature` new "A judgment about what the person receives uses the recipient role".
10. **A probe is a search, in Search vs check (7d item 7).**
   → Moves: `checking-behavior.feature` new "A probe of the corpus is made as a search".
11. **Thin results, in the check response (7d item 8):** "No similar recipes found." gains "When results in your context are thin, think harder and check more of your calls, rather than stretching a distant match." (`check-response-renderer.ts`; not briefing text, placed where the revision put it).
   → Moves: `checking-behavior.feature` new "Thin results lead to more checks, not a stretched match".
12. **Thin profile only: two duplicates of the MCP tool schema dropped (recipe `63abcc48`).** "If you auto-compact your context … omitting `session_id` …" (the `session_id` parameter says "Compacted your context? Omit it next check for full text again.") and "Evidence entries follow this shape: …" (the `supporting_evidence` parameter gives the same shape; Recipe format shows it with examples). Both stay in the full profile, whose paste readers have no tool schema. With every addition tightened, the thin fixture was 123 characters over its ceiling without this.
13. **Slimming lever (recipe `aae000d2`), `buildExemplarsSection`:** each exemplar shows its top evidence entry and "(N more evidence entries: get_recipes or GET /recipes?ids=<id>)" when it has more. Selection, ordering, claim, and metadata unchanged. The thin briefing renders no exemplars at its default, so this shrinks the full and paste briefing and any briefing with exemplars opted in, not the thin fixture (build log question 56).
14. **Closing the loop — feedback: one clause for stream D's intent-only outcome row (recipe `60bb0fa0`).** "A whole-session outcome row with no single recipe can carry your intent_id alone." Stream D (8a) made the target valid (recipe `831a11ea`), and the headless section's closing outcome row had no target the briefing named. The briefing-id line D adds is composed outside `BRIEFING.build` and describes itself where it is printed, so the briefing body does not repeat it.
   → Moves: `feedback-loop.feature` "A session's outcome with no single recipe joins its intent alone" (added on stream D's branch, which merges before this PR).
15. **Search vs check: the exclude-own default reversed (recipe `885143c2`, superseding `303e17cf`; this check `8b66f622`).** The operator reversed the MCP search's default today; stream D flips the tool and its description in 8a and asked this PR to carry the briefing. "the tool to reach for when the judgment you need was made by OTHER people" becomes "…is already logged"; "Its results exclude your own recipes by default; `author:me` / `author:anyone` override" becomes "It includes your own recipes: `author:<email>` narrows to one person, `-author:me` leaves yours out"; "search when the answer lives in a collaborator's logged judgment" becomes "…is already in someone's logged judgment". Paid for by two trims of this PR's own copy ("when nothing matches"; "the chosen path, the outcome as evidence"). Depends on stream D's flip, which merges first.
   → No scenario asserted the old default; the search-vs-check scenarios ("check_recipe is never used as a keyword search", "A probe of the corpus is made as a search") hold, since search stays the lookup path and check the append path.

### Scenarios watched, with rationale for holding

- **`checking-behavior.feature` "Checks happen autonomously, without permission-seeking"**, the highest-risk interaction for a Drafts section: the first move it names is "check it as an ordinary recipe and own it", asking is only for the person's own call while they are reachable, and nothing added frames checking as costly. Recipe `0c59b8a2` (no special-casing that contests check-freely) was weighed; the new sections apply to every profile.
- **`divergent-checks.feature` "MCP agent waits for the choice before checking"** and the two others: the wait-for-the-choice sentence is unchanged and still governs the ordinary case; the building-both clause names its own condition (every option genuinely pursued, or none stood behind).
- **`checking-behavior.feature` "Trivial implementation details are not checked"**: the three new moments are examples of calls that clear the bar, not new duties; the `(uncertainty × impact)` framing is untouched.
- **`recipe-voice.feature` existing scenarios**: the first three role patterns are unchanged; the fourth adds a case.
- **`known-recipes-dedup.feature`, `intent-registration.feature`**: the `session_id` and intent paragraphs that remain are unchanged; the dropped compaction paragraph's guidance is still in the `session_id` parameter for MCP agents and in the full profile for everyone else.
- **`briefing-surfaces.feature` profile scenarios**: the thin profile still drops exactly the setup, link-formatting, and pasted-JSON sections, plus the two duplicates above; the full profile keeps everything it had.
- **`feedback-loop.feature`, `web-only-agents.feature`, `recipe-book-routing.feature`, `frontmatter-recipe-lookup.feature`, `subagent-purpose-briefing.feature`, `comprehension-quiz.feature`**: no copy they rely on changed. Briefing exemplars now show one evidence entry with a pointer; no scenario asserts on exemplar evidence.
- Suite re-run: the agent-run harness is not yet wired (README §regression rule "once wired"); the `.feature` files remain the manual checklist.

### Measured

Fixture from `recipe-guide-content.test.ts`; the five-exemplar section is built by `buildExemplarsSection` with one to three evidence entries each.

| Measure | Before | After | Cap |
|---|---|---|---|
| Thin briefing fixture | 18,183 characters (18,297 bytes) | 20,993 (21,106 bytes), +2,810 | 21,000 (unchanged) |
| Thin headless fixture | 18,536 | 21,393 | 21,500 (unchanged) |
| Headless section | 351 | 398 | 400 (unchanged) |
| Full briefing fixture | 24,119 | 27,271, +3,152 | none |
| Five-exemplar section | 4,990 | 3,732, −1,258 | none |
| Full briefing with that section | 29,059 | 30,953, +1,894 | none |
| Remote `tools/list` / stdio / shared descriptions | 16,986 bytes / 13,196 / 6,051 characters | unchanged | 18,200 / 14,700 / 6,600 |

## 2026-10-24 — Drafts-and-triage slice 6a: one grammar term in `search_recipes`, and the intent qualifier's not-recognized note

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §6a, §6f. Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 6a rubric (S6a-Z1).

### Edits

1. **`MCP_PARAM_DESCRIPTIONS.searchQuery`** (served on remote and stdio `search_recipes`): adds `intent:int_… (your intent's recipes)`. To stay inside the 420-character per-description limit (`mcp-tool-descriptions.test.ts`, not one of A0's raised caps) the text drops "and" before "citations", "for PR review" after "quote filenames" (the briefing's Search vs check paragraph keeps the PR-review example), and "ISO" before "judgment date" (the date error message spells out the format), and says "open drafts" for "unresolved drafts". The last clause is slice 8a's "-author:me leaves out your own." (recipe `885143c2`), kept as 8a wrote it: an earlier form of this entry also shortened the exclude-own clause, which 8a's flip of that default replaced. 396 → 406 characters, measured on the rebase onto `f6b85f4` (2026-10-25).
2. **Not-recognized note (new):** a search whose `intent:` id names none of the caller's intents answers "No matches among the N recipes in scope: the intent: id was not recognized (unknown or not yours, deliberately indistinguishable), so it matched nothing." on the JSON notice, the markdown report, and (without the scope count) the HTML page; the review queue says the same after "No drafts listed:". It replaces the thin-corpus pointer for that case only, since the corpus is not thin. One constant, `INTENT_QUALIFIER_NOT_RECOGNIZED`, with `searchZeroResultLine` shared by the JSON and markdown builders.
3. **Grammar error (new):** "intent: takes an intent id (int_ and 24 letters or digits) — got "…". A task story goes in the intent parameter, not the query.", plus the one-id and no-negation errors; the unknown-qualifier help lists `intent:`.
4. **`/check` search help (HTML):** one line naming `intent:int_…`.

### Scenarios intended to move

- `drafts-and-triage.feature` **DT-OPT-01**, reworded to what ships (found by `is:draft intent:<id>`, listed together under the story, and not an oracle for another person's id) and moved out of the `@unreleased` option-set rule into a released rule of its own.

### Scenarios watched, with rationale for holding

- **Search scenarios that name the grammar** (`checking-behavior.feature` search-vs-check, `known-recipes-dedup.feature`): every existing qualifier keeps its meaning and its wording in the error help; the description's trims remove words that are restated where an agent meets them (the date error, the briefing's PR-review example).
- **Zero-result thinness scenarios** (`feedback-loop.feature` null results): the line is byte-identical for every query without `intent:` (one builder now produces it for both JSON and markdown).
- **Every briefing scenario:** no briefing text changed.

### Measured

| Measure | Before | After | Cap |
|---|---|---|---|
| Remote `tools/list` | 17,630 bytes | 17,642 | 18,200 |
| Stdio `tools/list` | 14,133 bytes | 14,145 | 14,700 |
| Shared descriptions | 6,376 characters | 6,386 | 6,600 |
| `searchQuery` | 396 characters | 406 | 420 per description |

Before is main at `f6b85f4` (slices 6c and 8a merged), after is this branch rebased onto it. The first measure, at `32ffa5c` before either merged, was 16,986 → 16,990 remote, 13,196 → 13,200 stdio, 6,051 → 6,053 shared, and 415 → 417 for `searchQuery`.

## 2026-10-24 — Drafts-and-triage slice 6c (PR A1): `outcome` on verify_draft, its 7b description, and the per-outcome replies and refusals

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) §6c and §7b (ratified 2026-10-24; rulings 46 and 55). Rubric: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 6c rubric.

### Edits

1. **`verify_draft` description, both MCP servers** (`MCP_TOOL_DESCRIPTIONS.verifyDraft`): "Publish your user's draft recipe once they confirm it, with new evidence quoting their answer and a citation. Evidence that adds nothing new is refused." becomes the revision doc's 7b text, "Publish, reject, or mark not chosen a draft about your user once you or they can stand behind the answer: new evidence quoting their words, or the context that settles it. Evidence that adds nothing new is refused." (152 → 214 characters). The old text read as a rule that the person must be asked (field item 2), which ruling 46 and recipe `200ed4fe` say it is not.
2. **New `outcome` parameter, both MCP servers** (`MCP_PARAM_DESCRIPTIONS.draftOutcome`, a plain string, not a schema enum): "verified (default) | rejected | not_chosen. Reject when it does not hold or a verified recipe covers it (cite its id); not_chosen when a viable option lost." (156 characters). The tool's annotation title becomes "Resolve a draft".
3. **`supporting_evidence` on `verify_draft`** (`verificationEvidence`): "Your interpretation, then > the person's answer verbatim, then -- where they said it." becomes "Your interpretation, then > a person's answer or a covering recipe's words, verbatim, then -- where they were said (or recipe <id>)." (85 → 132 characters). "A person", not "the person", throughout the new copy: in a shared book the call may be a colleague's (Andy, 2026-10-24; recipe `5d3ddfc7`).
4. **Replies:** a rejection answers "Draft <id> is rejected: it stays private, leaves the review queue, and no longer appears in results; your evidence is attached (n entries)."; not chosen the same with "is marked not chosen". The verified reply is unchanged. The stdio server now words its reply with the same domain function as the remote tool (`describeResolution`).
5. **Refusals:** the evidence refusal opens per outcome ("Verifying", "Rejecting", "Marking a draft not chosen … needs new evidence"). The rejection form says the quote may be "a person's answer, or the words of the verified recipe that covers the same call" cited as "-- recipe <id>", and every refusal for missing evidence now ends by saying how the text was read ("The text was read as 2 entries: entry 1 has a quote but no citation; entry 2 has a citation but no quote."). The verification form now says "a person's answer, or the words that settle it", where it said "the person's answer". An unknown outcome answers "outcome "<value>" is not one of verified | rejected | not_chosen (verified when omitted); nothing was stored.", followed by "Also: " and the evidence refusal when the evidence is also short. "is not a draft, so there is nothing to verify" becomes "… nothing to resolve", and the write-access refusal says "resolving it needs write access … Resolve it with a key that can write <book>, or hand the review link to the person it is about".
6. **Label of a rejected draft on agent surfaces** (`draftLabel`): "[rejected draft: the person said this is wrong]" becomes "[rejected draft: its evidence says why]", since an agent may now reject on the settling context.

### Scenarios intended to move

- **Product spec** ([../product-specs/drafts-and-triage.feature](../product-specs/drafts-and-triage.feature)): DT-VER-10 to DT-VER-14 (`@slice-6c`), added in this PR, and the Rule title, which no longer says verification needs "the person's own words".
- **Briefing spec:** the agent-behaviour scenario "a briefed agent closes a draft settled elsewhere with `verify_draft` outcome rejected, citing the covering recipe" belongs in `checking-behavior.feature`, which stream C owns. It lands with C1, whose briefing body is what teaches resolving drafts and which merges after this PR. Until then the tool description is the only copy that says it.

### Scenarios watched, with rationale for holding

- **`briefing-surfaces.feature` "it does not call verify_draft"** (headless): unchanged. A headless key is refused for every outcome before any lookup, with the slice 5 text.
- **Every briefing scenario:** no briefing text changed. Only the `verify_draft` tool and its parameters changed, and the briefing fixtures are byte-identical.

### Measured

| Measure | Before | After | Cap (A0) |
|---|---|---|---|
| Remote `tools/list` | 16,986 bytes | 17,297 | 18,200 |
| Stdio `tools/list` | 13,196 bytes | 13,507 | 14,700 |
| Shared descriptions | 6,051 characters | 6,316 | 6,600 |
| `verify_draft` as served (remote) | 774 bytes | 1,085 | |

## 2026-10-24 — Drafts-and-triage slices 6 to 9, scaffold (PR A0): four size caps raised ahead of parallel streams; no copy changed

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) (ratified 2026-10-24) and [../planning/drafts-and-triage-slices-6-9-implementation-plan.md](../planning/drafts-and-triage-slices-6-9-implementation-plan.md) §PR A0. Build log: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slices 6 to 9.

### Edits

None to any briefing text, tool description, parameter description, notice, or label. This PR moves the four ceilings once, dated, so that the five streams that follow (6c, 6a, 7, 8a, 9), each of which adds a measured amount to one or more of them, never edit the same assertion line in parallel. Each stream's own entry below this one records its bytes before and after; a follow-up after slices 8b and 6b re-tightens every cap to the measured figure plus the usual slack (backlog row "Drafts and triage, slices 6 to 9: follow-ups").

What the raise is sized for: the `outcome` enumeration on `verify_draft` (6c); the `intent:` term in `search_recipes` (6a); the enumerations `log_feedback` and `get_recipes` spell out in their parameter descriptions (8a); and in the thin briefing the when-to-draft section, the corrected tool copy, and eight field additions, landing with one slimming lever (recipe `aae000d2`) in the same PR (7).

### Scenarios intended to move

None.

### Scenarios watched, with rationale for holding

All: nothing an agent reads changed; both fixtures and the served rosters are byte-identical before and after this PR.

### Measured

| Measure | Before | After | Cap before | Cap after |
|---|---|---|---|---|
| Remote `tools/list` | 16,986 bytes | 16,986 | 17,000 | 18,200 |
| Stdio `tools/list` | 13,196 bytes | 13,196 | 13,670 | 14,700 |
| Shared descriptions | 6,051 characters | 6,051 | 6,080 | 6,600 |
| Thin briefing fixture | 18,183 characters; headless 18,536 | unchanged | 18,200; headless 18,600 | 21,000; headless 21,500 |

## 2026-10-24 — Drafts-and-triage slice 8a (stream D): tool shapes the field logged

Plan: [../planning/drafts-and-triage-slices-6-7-revision.md](../planning/drafts-and-triage-slices-6-7-revision.md) slice 8 items 4 to 7, and [../planning/drafts-and-triage-slices-6-9-implementation-plan.md](../planning/drafts-and-triage-slices-6-9-implementation-plan.md) stream D. Rubric and build notes: [../planning/drafts-and-triage-build.md](../planning/drafts-and-triage-build.md) §Slice 8a.

### Edits

1. **`MCP_PARAM_DESCRIPTIONS.recipeIds`** names the array form: "Recipe ids, up to 20: an array, or one comma- or whitespace-separated string; …". `get_recipes` and `get_briefing` serve `recipe_ids` as a string or an array of strings on both servers.
2. **`MCP_TOOL_DESCRIPTIONS.logFeedback`** names every target: "Target: the check's recipe id (or its short id), a search or briefing id, or, for an outcome row, the intent alone." To stay under the 420-character cap it drops "(full UUID or 8+ char short id)", a detail `trace_id`'s own description still carries, and "worth a row too" becomes "earn a row".
3. **`log_feedback` parameter descriptions**, identical on both servers: `story` begins "Required on every row."; `trace_id` states the one-target rule; `search_id` drops its "Give exactly one of…" sentence, which `trace_id` now carries; `intent_id` says an outcome row may name it alone; and a new `briefing_id` parameter. The stdio tool gains `search_id`, which it never had, and its `trace_id` is no longer required.
4. **The briefing id line**: "Briefing id: <uuid> — log_feedback accepts it as briefing_id, for feedback about this briefing." It's the last line of `get_briefing` on both servers, composed outside `BRIEFING.build`. `GET /briefing` returns the id as `data.briefingId`.
5. **Search includes the caller's own recipes (the operator's ruling of 2026-10-24, recipe `885143c2`, superseding `303e17cf`).** This replaces item 7's planned "author:me" recovery line, which was built, then removed in the same PR because the default it recovered from is gone.
   - `MCP_TOOL_DESCRIPTIONS.searchRecipes`: "For judgment made by OTHER people (a teammate's PR, a shared book); results exclude your own recipes by default." becomes "…, your own recipes included. For judgment already logged: yours, or a teammate's in a shared book (a PR area, a book you just joined)."
   - `MCP_PARAM_DESCRIPTIONS.searchQuery`: "author: or is:draft lifts the exclude-own default." becomes "-author:me leaves out your own." Stream B owns the rest of that string and keeps its `intent:` term on rebase.
   - Stream C's C1 rewrites the briefing's "Search vs check" paragraph to match.
6. **Validation and refusal text**: a feedback row's rejection lists every failing field ("N fields need fixing: …"; one field reads as before). New markers: `briefing_id not found or not readable with this key` and `intent_id not found or not readable with this key`. The unknown-parameter refusal reads "Error: <tool> does not take <name> (did you mean <name>?). Nothing was run; send it again with the names it takes: …" (mode `refuse`, ruled by the operator 2026-10-24). The warning form is built but not served.

Bytes, measured with the slice 1 method: remote `tools/list` 16,986 → 17,319 (cap 18,200); stdio 13,196 → 13,822 (cap 14,700; 26 bytes over the 600 share the 8a rubric set itself, which is the stdio `search_id` this PR adds); shared descriptions 6,051 → 6,111 characters (cap 6,600). The search wording in item 5 accounts for 1 byte of each. Thin and full briefing fixtures unchanged.

### Scenarios intended to move

- `feedback-loop.feature`: three new scenarios, "A session's outcome with no single recipe joins its intent alone", "Feedback about the briefing itself carries the briefing id", and "A rejected feedback row is fixed in one retry" (added in this PR). Stream C's C1 declares the first one moved by its briefing clause, too.
- `intent-registration.feature` "Feedback closes the declared loop" gains the intent-only outcome row (edited in this PR).

### Scenarios watched, with rationale for holding

- **`feedback-loop.feature` scenarios that already existed**: the field vocabulary, the carriers (ride-along, `log_feedback`, `POST /feedback`, `GET /feedback`) and the recipe-id join are unchanged. The tool description's shorter join sentence still names the recipe id first.
- **`known-recipes-dedup.feature`, `frontmatter-recipe-lookup.feature`**: `get_recipes` resolves the same ids the same way; only the accepted input forms widened.
- **`checking-behavior.feature` "Probing the system does not log junk recipes"**: search stays the read-only lookup. Including the caller's own recipes only widens what it can find.
- **`docs/product-specs/drafts-and-triage.feature`** (product spec, not briefing): two comments that cited "search excludes the caller's own recipes by default" now cite the reversal. A person's own drafts appear in a default search under their draft label, as they already do in check results, and slice 8b's "own open drafts set apart" serves both.
- **Every other scenario**: no briefing body text changed (stream C owns it). The unknown-parameter refusal fires only on names a tool does not declare, so every documented call is byte-identical.

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
