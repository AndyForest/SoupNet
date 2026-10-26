# Audit-log retention: anonymise the check log on account deletion

A follow-up to the OpenAI plugin directory round, by stream T (session `d-tool-shapes`, agent `a-plugin-t-2026-10-26`, Soup.net intent `int_jzE34Le6G65SUL9QAsXHJlsf`). Branch `fix/audit-log-retention`. The ruling is recipe `1d1531da` (the operator: "Yes, approved").

**Rescoped 2026-10-26, before any code:** the operator wants the privacy policy stated by criteria, not by numbers. So this PR builds the one behaviour the policy states: on account deletion, check-log rows are anonymised rather than deleted. It also builds the classification list. Out of scope: the 12-month sweep of account events, which goes to `docs/backlog.md` as a deferred item, and the §8 text, which stream L writes on #151. It keeps the September design in recipe `569fc2cc`: no foreign keys from audit rows to actors, and erasure by anonymisation.

## Rubric

Written 2026-10-26, before implementation, from the ruling, the September design, the backlog's audit-log item, and the code at `cf6e13e`.

**What the code does today:**
- Audit rows are never updated or deleted, and account deletion leaves them as they are (`user-delete.service.ts`: "audit_log — append-only trail outlives the actor").
- Nothing has a foreign key into `audit_log`.
- The rows that read a person's own activity are their check log (`GET /traces/checks`, by `actor_user_id`), the per-key rate limit (by `api_key_id`), and `log_feedback`'s ownership check on search and briefing ids (by actor).
- Intents, keys, feedback and the person's recipes are deleted with the account.
- The free text in check-log rows is a search's query (`check.searched` `metadata.filter`). A check row carries no recipe text; the trace holds it, and the trace is deleted.

### Which actions are which

| # | Criterion | Evidence |
|---|---|---|
| R-C2 | *(Added 2026-10-26 from audit finding F118.)* `writeAudit` takes the union of the two lists as its action type, so an unlisted action does not compile. Every action in the table is listed. | Typecheck; Layer 3 `SELECT DISTINCT action` against the lists, which also covers names built at run time that the source scan cannot read. |
| R-C1 | One module lists the check-log actions (`recipe.checked`, `check.searched`, `briefing.issued`) and the account-event actions (every other action written today). Every action the backend writes is in exactly one list, and the lists name no action the backend no longer writes. | A test that scans the backend source for every audit write (`writeAudit` and `insert(auditLog)` actions, literals inside `INSERT INTO claimnet.audit_log` statements, and `*_ACTIONS` maps) and fails on an action in neither list, in both, or in a list but not written. |

### Anonymise on account deletion

| # | Criterion | Evidence |
|---|---|---|
| R-A1 | Inside the account-deletion cascade's final transaction (before the `users` row goes), every check-log row the person made is changed as follows: <br>- `actor_user_id` and `api_key_id` become null; <br>- `target_id` becomes null where `target_type` is `api_key` (the briefing row's target is the key); <br>- `metadata` loses `apiKeyId` (the key) and `filter` (the query text). <br>Everything else stays: the action, the target recipe or search, the time, and the rest of `metadata` (surface, ranking version, result ids and counts, ratings, draft flag, session and intent ids, OAuth client). | Layer 3: a person checks, searches and gets a briefing, then deletes the account. Read the rows back by id. |
| R-A2 | In other people's check-log rows, a `subjectUserId` that names the deleted person becomes null. The key stays, so the record that a deposit about someone happened survives without naming them. | Layer 3: a colleague deposits about the person on their behalf; the person deletes their account. |
| R-A3 | Account-event rows are not changed by account deletion, apart from R-A6. They keep their actor and age out with the sweep. | Layer 3: the `user.self_delete` row and a book-change row are byte-identical before and after. |
| R-A4 | Nobody else's rows change, apart from R-A2's and R-A6's fields. | Layer 3: another person's check-log and account-event rows are byte-identical before and after, including the colleague's deletion of a recipe of their own, which keeps its text. |
| R-A5 | Counts survive. The number of `recipe.checked`, `check.searched` and `briefing.issued` rows is the same before and after, in total and when grouped by month and by intent id. Those groupings are what a report and an intent lineage read. | Layer 3 counts before and after. |
| R-A6 | *(Added 2026-10-26 from audit finding F116.)* `trace.deleted` and `trace.moved` rows (`RECIPE_TEXT_ACTIONS`) that the person wrote, or whose `metadata.traceUserId` is the person, lose `metadata.claimText`. Everything else in them stays, actor included. | Layer 3: the person deletes a recipe of theirs and a colleague moves another, then the person deletes their account. |

### Deferred

The 12-month sweep of account events (the ruling's second half) is a backlog item. It cites `1d1531da` and builds on R-C1's account-event list.

### Security workflow (a destructive job)

| # | Criterion | Evidence |
|---|---|---|
| R-X1 | A separate audit agent reviews the branch before merge (the round's audit coordinator), and the anonymisation has tests that it touches only what it should (R-A3, R-A4). | The audit record; the tests. |
| R-X2 | No schema change and no migration: anonymisation is an update. | The diff. |
| R-X3 | The schema's "never updated or deleted" comment and the deletion service's "outlives the actor" comment are corrected to say what now happens. | Code review. |
| R-X4 | The gate passes (`npm run test:ci`, distinct ports, frontend build included). | The gate. |

## Build notes (2026-10-26)

Written by the builder for the verifier and the audit coordinator.

**What was built:**
- `services/audit-actions.ts` holds the two lists: 3 check-log actions and 18 account events.
- `services/audit-actions.test.ts` scans the backend source and fails on an unclassified, double-classified or stale action.
- `anonymiseCheckLogOf` in `services/audit-log.service.ts` is called in `deleteUserCascade`'s final transaction, before the `users` row goes.
- The schema and cascade comments are corrected.
- `docs/backlog.md` carries the deferred 12-month sweep, with a note on the audit-log FK item and on the search-filter item.

**Tests:** `routes/audit-anonymise.test.ts` (Layer 3, R-A1 to R-A5). A person checks under an intent, searches with free text and gets a briefing, and changes a book description. A colleague makes their own check and a deposit about the person on their behalf. The person deletes their account, and every row is compared with its snapshot.

**After the audit (F116 to F119, 2026-10-26):**
- **F116:** `anonymiseCheckLogOf` became `anonymiseAuditLogOf` and also removes `claimText` from the person's recipe-text account events (R-A6). The test adds the person deleting a recipe of theirs, a colleague moving another, and a colleague deleting one of their own, which keeps its text.
- **F118:** `writeAudit` and the draft-resolution map take `AuditAction`. The `insert(auditLog)` and raw-SQL writes keep literal names, which the source scan reads. R-C2 checks the table.
- **F119:** the cascade runs the anonymisation once more after the final transaction commits, for a check row an in-flight request wrote meanwhile. A failure there is logged, since the account is already gone.
- **The audit's note on locks:** the anonymisation now runs in the final transaction right after the keys are deleted, before `lockBooksForDeparture`, so its scan of `audit_log` holds no book lock.
- **F117** (agent and session labels, and the join back to the person through kept account events) is on the backlog with the 12-month sweep.

**One earlier rubric row changed:** drafts-and-triage S4-A4 asserted that the depositor's `recipe.checked` row keeps their actor after their account is deleted. The ruling anonymises that row, so the test now asserts a null actor with the subject kept. S4-S4 (the depositor recoverable from `audit_log` alone) still holds through `recipe.draft_verified`'s `previousAuthorId`, an account event that deletion leaves as it is. The S4-A4 row in `drafts-and-triage-build.md` carries the amendment.

**Gate:**
- **Full runs:** three runs of `TESTCI_PGPORT=5644 TESTCI_BACKEND_PORT=3288 npm run test:ci` each failed exactly one test, a different one each time, and each passes alone on a fresh stack:
  - `authz.test.ts` "listMembers … in join order";
  - S9-I4 in `report-read-paths.test.ts`;
  - S8b-C2 in `flat-list.test.ts`.
- **Why they're environmental:** all three order rows by time, none deletes an account or reads the audit log, and the repository already records that Docker Desktop's VM clock steps back 20 to 30 ms every 30 seconds.
- **The first run's other failure** was the S4-A4 change above, now fixed.
- **Passing everywhere:** this change's suites, the two existing account-deletion suites and the on-behalf suite. GitHub CI judges the full run.
