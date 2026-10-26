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
| R-C1 | One module lists the check-log actions (`recipe.checked`, `check.searched`, `briefing.issued`) and the account-event actions (every other action written today). Every action the backend writes is in exactly one list, and the lists name no action the backend no longer writes. | A test that scans the backend source for every audit write (`writeAudit` and `insert(auditLog)` actions, literals inside `INSERT INTO claimnet.audit_log` statements, and `*_ACTIONS` maps) and fails on an action in neither list, in both, or in a list but not written. |

### Anonymise on account deletion

| # | Criterion | Evidence |
|---|---|---|
| R-A1 | Inside the account-deletion cascade's final transaction (before the `users` row goes), every check-log row the person made is changed as follows: <br>- `actor_user_id` and `api_key_id` become null; <br>- `target_id` becomes null where `target_type` is `api_key` (the briefing row's target is the key); <br>- `metadata` loses `apiKeyId` (the key) and `filter` (the query text). <br>Everything else stays: the action, the target recipe or search, the time, and the rest of `metadata` (surface, ranking version, result ids and counts, ratings, draft flag, session and intent ids, OAuth client). | Layer 3: a person checks, searches and gets a briefing, then deletes the account. Read the rows back by id. |
| R-A2 | In other people's check-log rows, a `subjectUserId` that names the deleted person becomes null. The key stays, so the record that a deposit about someone happened survives without naming them. | Layer 3: a colleague deposits about the person on their behalf; the person deletes their account. |
| R-A3 | Account-event rows are not changed by account deletion. They keep their actor and age out with the sweep. | Layer 3: the `user.self_delete` row and a book-change row are byte-identical before and after. |
| R-A4 | Nobody else's rows change, apart from R-A2's one field. | Layer 3: another person's check-log and account-event rows are byte-identical before and after. |
| R-A5 | Counts survive. The number of `recipe.checked`, `check.searched` and `briefing.issued` rows is the same before and after, in total and when grouped by month and by intent id. Those groupings are what a report and an intent lineage read. | Layer 3 counts before and after. |

### Deferred

The 12-month sweep of account events (the ruling's second half) is a backlog item. It cites `1d1531da` and builds on R-C1's account-event list.

### Security workflow (a destructive job)

| # | Criterion | Evidence |
|---|---|---|
| R-X1 | A separate audit agent reviews the branch before merge (the round's audit coordinator), and the anonymisation has tests that it touches only what it should (R-A3, R-A4). | The audit record; the tests. |
| R-X2 | No schema change and no migration: anonymisation is an update. | The diff. |
| R-X3 | The schema's "never updated or deleted" comment and the deletion service's "outlives the actor" comment are corrected to say what now happens. | Code review. |
| R-X4 | The gate passes (`npm run test:ci`, distinct ports, frontend build included). | The gate. |
