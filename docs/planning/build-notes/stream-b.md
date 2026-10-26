# Stream B build notes

Stream B's own append file (plan, "Next round": per-stream append files so that shared-doc conflicts stop deciding merge order). Newest section last.

## Paging depth: F105 and F110 (stream B, 2026-10-26)

Written 2026-10-26 by stream B (agent `a-drafts-6a-2026-10-24`, Soup.net intent `int_WX9QvZQhLZ176dYBUfZjq5J0`), before implementation, on `main` at `cf6e13e` (after #154). Branch `fix/listing-depth-cap`. The assignment came from the planning session: one mechanism for both findings, chosen after a recipe check. The findings' texts are private (claimNet `docs/security/`), so they are cited here by number only. Consumers: agents (`search_recipes`, `/check?filter=`) and the report read paths (`GET /intents`, `GET /intents/:id`, `GET /feedback/rows`, and the web intent page through `GET /me/intents/:id`). Security-relevant: yes (resource use, P4).

**The decision**, checked as recipe `ce61eb6d`: a depth cap, not keyset paging.
- **The cap.** No listing serves a row past the first 10,000. A request whose page would start past that point is refused with an error that names the parameter and how to narrow. Below the cap, behaviour is unchanged: a page past the end of a short list is still an empty page with its end line.
- **One constant, in one module** (`apps/backend/src/lib/listing-depth.ts`). The report parser and the flat list both read it, so the two paths cannot drift apart (recipe `01bfbe35`).
- **Why a cap and not keyset paging:**
  - A cursor would be a new parameter on `search_recipes`, and the shared descriptions have 7 characters left (recipe `ded7f5ed`).
  - The flat list's triage order sorts on a computed expression, which a cursor would have to carry.
  - Precedent caps depth: Elasticsearch's `index.max_result_window` defaults to 10,000, and GitHub's search API returns at most the first 1,000 results.
  - A sweep that outgrows 10,000 rows narrows by time with `changed-after:`, `created-after:` or `since`, which is what those qualifiers are for.
- **Totals stay exact.** `totalResults`, `total` and `totalPages` still count every match ("nothing is silently capped"). The page line says when the last reachable page is reached.

**Rows**

| # | Criterion | Evidence |
|---|---|---|
| D-1 | Reports: `page` × `per_page` beyond 10,000 rows (`(page - 1) × per_page ≥ 10,000`) is the strict parser's 400. It names `page`, gives the reachable bound for the `per_page` in effect, and says to narrow with `since` or a filter. `page=50&per_page=200` (rows 9,801–10,000) is served; `page=51&per_page=200` and `page=201` with the default 50 are refused. The probe's case `page=100000&per_page=200` answers 400. | Layer 1 in `report-params.test.ts` (the boundary on both sides, both `per_page` extremes, the error combined with another field's); Layer 3 on each of the four paths. |
| D-2 | The flat list: `page` > 200 (50 a page) is refused on `search_recipes` (both servers) and on `/check` with the same sentence, naming `page`, the 10,000-row reach, and `changed-after:`, `created-after:` and `read_recipe_books`. Pages 1 to 200 are served as before. An unusable `/check` page (`nonsense`) is still page 1. The ranked results of search and check have the same reach at their page size (page 501 at 20 refused), and a check with a deep page is refused before anything is stored. | Layer 1 on the page clamp/guard; Layer 3 on MCP and `/check` JSON, ranked and flat, and a check counting the book's recipes before and after. |
| D-3 | The page line tells the truth at the cap. When page 200 is served and more matches exist, the line says it is the last page the list reaches and how to narrow, instead of naming page 201. `totalResults` and `totalPages` stay exact. | Layer 1 renderer cases. |
| D-4 | The boundary is the same number on every path: both read one constant, and a test pins the reports' and the flat list's refusal at the same row. | Layer 1. |
| D-5 | Nothing else moves: the gate, the slice 8b and slice 9 suites as they stand (apart from the probe-shaped deep-page cases, which change from 200 to the refusal), and the tool descriptions unchanged (no byte change to `tools/list`). | The gate; size tests. |
| D-6 | Docs: `docs/api/reports.md` states the reach; `recipe-search-design.md` and the contracts' `listOrder` description state it for the flat list. | Review. |

### Build notes (stream B, 2026-10-26)

**What was built.**
- `packages/domain/src/listing-depth.ts` (new, exported from the domain package):
  - `LISTING_DEPTH_MAX` (10,000);
  - `lastReachablePage(perPage)`, the last page whose first row is within the reach;
  - `pageBeyondReach`;
  - the search surfaces' refusal sentence;
  - the flat list's narrowing sentence.
- **Reports** (`services/report-params.ts`): the strict parser adds the depth check after the per-field checks. So an unparseable `page` is named once, for its own reason, and a page past the reach is named with the last reachable page for the `per_page` in effect. "Narrow with since or another filter" is added only where the path takes filters (`GET /feedback/rows`). `REPORT_PAGE_MAX` stays as the parse bound.
- **Search** (`searchWithoutLogging`): after the query parses and before any statement runs, the requested page is checked at the page size it will be served at. That is 50 for the flat list, which is read through `clampFlatListPage` (it now only normalizes, since the depth check replaced its 100,000 clamp), and `perPage` for ranked results. Both paths are covered because ranked paging asks the vector search for `(offset + limit) × margin` candidates, the same cost shape as F110.
- **Check** (`submitAndSearch`): the same check, first thing, so a deep page stores nothing and says so.
- **Renderer** (`flatListPageLine`): on the last reachable page with more matches beyond it, the line says so and how to narrow, instead of "Next: page=201".
- **Docs:** `docs/api/reports.md` (parameters), `recipe-search-design.md` (the flat-list note), and the contracts' `listOrder` description. Served `tools/list` bytes are unchanged, since the `page` description already says "From 1".
- **Seam:** `trace.service.ts`'s fingerprint moved again only because its multi-line `@soupnet/db` import window reaches the edited import lines; no SQL changed.

**Out of scope, recorded in the backlog:** the signed-in and admin listings (the review queue's `DRAFT_QUEUE_MAX_PAGE` of 100,000 pages of 20, `/traces`, and the admin lists) page by OFFSET too. They are behind a person's sign-in or the admin role and neither finding names them. The same constant applies if they are ever capped.

**Tests.**
- Layer 1: `packages/domain/src/listing-depth.test.ts` (new), the depth block in `report-params.test.ts` (both sides of the boundary at both `per_page` extremes, the probe shape, the narrowing clause only where filters exist, and the combination with another failing field), the page-line cases in `check-response-renderer.test.ts`, and the updated clamp case in `recipe-list.service.test.ts`.
- Layer 3: `report-read-paths.test.ts` D-1 (all four report paths, the web intent page included) and `flat-list.test.ts` D-2 (MCP and `/check`, flat and ranked, and a check with a deep page that stores nothing). `node scripts/test-ci-local.mjs -- flat-list.test.ts report-read-paths.test.ts` passed: 33 tests.

**Gate:** `TESTCI_PGPORT=5611 npm run test:ci` (frontend build included since #159) passed: 2,244 tests passed and 6 skipped, the authz seam held, and the ranking eval's 9 thresholds were green. The first run passed every test that reported (2,236) and then hit the known Windows worker exit.
