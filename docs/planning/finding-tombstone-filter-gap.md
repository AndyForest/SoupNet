# Finding: `filter=` search path misses the tombstone subtraction (2026-07-21)

**From**: the evals workstream, first field use of the ephemeral-workspace contract (`e839eaf`). One-paragraph finding + suggested regression shape; fix is yours.

**Finding**: `trace.service.ts::searchWithoutLogging` (the read-only `filter=` keyword path) resolves read scope without the tombstone subtraction that `submitAndSearch` applies — its "resolve read scope exactly as submitAndSearch does" comment is stale as of `e839eaf`. Consequence: an expired-but-unreaped ephemeral book remains visible through that one surface until the reaper fires (≤5 min at the current `*/5` cron), contradicting the ruled contract ("the moment a book's expiry passes … excluded from search scope, briefings, and counts"). Every other surface honors the tombstone — verified live during the workspace smoke (by-id lookup refused, deposit refused, integrity reports `expiredNotYetReaped`, briefing excludes). Production is unaffected today (`ALLOW_BENCHMARK_OPS` off), so this is contract-consistency, not an incident.

**Suggested fix shape** (observed, not prescribed): mirror the one-line scope filter (`readGroupIds` minus tombstoned) into `searchWithoutLogging`.

**Suggested regression**: extend the workspace suite with a tombstone-visibility sweep across *every* retrieval door — submitAndSearch, `filter=`, by-id, briefing, counts, relatedEvidence — asserting exclusion at expiry time on each. The lesson generalizing from this and the evidence-door catch of 2026-07-17 (feedback `c3a7349b`): enumerate every retrieval door whenever scope semantics change; single-door verification keeps missing exactly one.
