# Audit-log retention: anonymise the check log on account deletion, sweep account events after 12 months

A follow-up to the OpenAI plugin directory round, by stream T (session `d-tool-shapes`, agent `a-plugin-t-2026-10-26`, Soup.net intent `int_jzE34Le6G65SUL9QAsXHJlsf`). Branch `fix/audit-log-retention`. It must merge before the operator's portal submission, because the privacy policy's §8 describes it. The ruling is recipe `1d1531da` (the operator: "Yes, approved"). It keeps the September design in recipe `569fc2cc`: no foreign keys from audit rows to actors, and erasure by anonymisation.

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
| R-C1 | One module lists the check-log actions (`recipe.checked`, `check.searched`, `briefing.issued`) and the account-event actions (every other action written today). Every action the backend writes is in exactly one list. | A test that scans the backend source for every audit write (`writeAudit`, `insert(auditLog)`, `INSERT INTO claimnet.audit_log`) and fails on an action in neither list or in both. |
| R-C2 | The privacy policy's §8 "Audit log entries" line becomes stream L's two lines (the check log; account events), in the same commit as the code that makes them true. | The diff. |

### Anonymise on account deletion

| # | Criterion | Evidence |
|---|---|---|
| R-A1 | Inside the account-deletion cascade's final transaction (before the `users` row goes), every check-log row the person made is changed as follows: <br>- `actor_user_id` and `api_key_id` become null; <br>- `target_id` becomes null where `target_type` is `api_key` (the briefing row's target is the key); <br>- `metadata` loses `apiKeyId` (the key) and `filter` (the query text). <br>Everything else stays: the action, the target recipe or search, the time, and the rest of `metadata` (surface, ranking version, result ids and counts, ratings, draft flag, session and intent ids, OAuth client). | Layer 3: a person checks, searches and gets a briefing, then deletes the account. Read the rows back by id. |
| R-A2 | In other people's check-log rows, a `subjectUserId` that names the deleted person becomes null. The key stays, so the record that a deposit about someone happened survives without naming them. | Layer 3: a colleague deposits about the person on their behalf; the person deletes their account. |
| R-A3 | Account-event rows are not changed by account deletion. They keep their actor and age out with the sweep. | Layer 3: the `user.self_delete` row and a book-change row are byte-identical before and after. |
| R-A4 | Nobody else's rows change, apart from R-A2's one field. | Layer 3: another person's check-log and account-event rows are byte-identical before and after. |
| R-A5 | Counts survive. The number of `recipe.checked`, `check.searched` and `briefing.issued` rows is the same before and after, in total and when grouped by month and by intent id. Those groupings are what a report and an intent lineage read. | Layer 3 counts before and after. |

### Sweep account events after 12 months

| # | Criterion | Evidence |
|---|---|---|
| R-S1 | A pg-boss job, `audit.retention-sweep`, scheduled daily, deletes account-event rows whose `occurred_at` is older than one constant, `AUDIT_ACCOUNT_EVENT_RETENTION_MONTHS = 12`. It deletes only actions in the account-event list: never a check-log row, and never an action in neither list (fail closed). | Layer 3 on the service: seeded rows 13 months old and 11 months old, of each kind and of an unlisted action. Only the old account events go. |
| R-S2 | Each run deletes in bounded batches, is idempotent (a second run deletes nothing new), and logs its count. It's registered beside the ephemeral reaper and described in the queue descriptions the admin queues page shows. | The test; code review. |
| R-S3 | The schema's "never updated or deleted" comment and the deletion service's "outlives the actor" comment are corrected to say what now happens. | Code review. |

### Security workflow (a destructive job)

| # | Criterion | Evidence |
|---|---|---|
| R-X1 | A separate audit agent reviews the branch before merge (the round's audit coordinator), and every destructive path has a test that it touches only what it should (R-A3, R-A4, R-S1). | The audit record; the tests. |
| R-X2 | No schema change and no migration: anonymisation is an update, and the sweep uses the existing `occurred_at` index. | The diff. |
| R-X3 | The gate passes (`npm run test:ci`, distinct ports, frontend build included). | The gate. |
