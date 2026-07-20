# Backlog — completed

Items moved here from `backlog.md` when finished. Date-stamped so we can see what landed when. Strike-through (`~~text~~`) for sub-items completed within a still-open parent item.

---

## 2026-07-19/20 — the ranking-lever program: P6 pool → P7 ordering → P8 MMR (PRs #42–#44)

Three measured default flips in the sweep → report → ruling cadence, ending in the simplification that subsumed the first two on the check path: display selection is now **MMR λ0.6 over a score-banded reach** (`RANKING_ALGORITHM_VERSION 2026-07-20-mmr`), replacing per-check k-means, the fixed pool size, and the ordering permutation with one standard mechanism. Evidence: [p6](planning/ranking-research/p6-pool-sweep-report.md) / [p7](planning/ranking-research/p7-ordering-sweep-report.md) / [p8](planning/ranking-research/p8-mmr-sweep-report.md) sweep reports (real-scale graded golden set built from the evals side's 39,524-trace delivery + the operator's real 1,815-trace production corpus with real-recipe probes); rulings and old→new values in [ranking-changelog.md](architecture/ranking-changelog.md). Three backlog design items closed by the arc, moved verbatim below: the session-identity design (shipped as session/stub rendering 2026-07-17, recorded here with the arc that retired its demotion premise), the P6 pool decoupling (measured, flipped to fixed:100, then subsumed by the band reach), and the adaptive-depth hierarchical sketch (superseded by the ruled MMR direction — its revisit condition "only if the P8 MMR sweep fails to beat k-means on the real corpus" resolved: MMR won and shipped).

### Moved items (verbatim):

### `[DESIGN]` Adaptive-depth hierarchical clustering for the check display (P3 extension — operator sketch 2026-07-19) — SUPERSEDED by the shipped MMR default (2026-07-20)

**Superseded-pending-measurement (operator correction, 2026-07-20):** challenging pipeline accretion, the operator redirected this toward the industry-standard *flat* mechanism instead of the hierarchical form — MMR display selection over a score-banded pool (register hypothesis P8, the `displaySelection` prototype now plumbed in ranking-engine.md stage 4 / [ranking-changelog.md](architecture/ranking-changelog.md) 2026-07-20). The reasoning below (why the hierarchical form was preferred over the flat one) is kept as the record of the tradeoff the correction reversed: MMR's answer to "loses the product surfaces clustering provides" is that it still returns the same `ClusterResult[]` shape (clusterSize counts, knownMembers stub lists, index-parallel exemplars), and the score-banded pool answers the "homogeneous top" objection the flat form otherwise has. Revisit this hierarchical sketch only if the P8 MMR sweep fails to beat k-means on the real corpus. *(Resolution 2026-07-20: it didn't fail — MMR ruled and shipped, `2026-07-20-mmr`.)*

Operator sketch, post-P6-sweep: *"Cluster to say 5 clusters. Check the count inside the cluster. If it's large / diverse, then cluster it into 5 as well. Show exemplars from the top 2 clusters. Unless one of those is also large / diverse, and then cluster that one as well … Basically, sub-sample on a similarity/relevance curve so we get more samples near the high point of the curve, but spread out a bit so we don't oversample near-duplicates."* This is scatter/gather with **automatic quality-gated depth** instead of caller-driven drill-down — an extension of register hypothesis P3 (clusters-within-clusters, the `depth` param sketch in search-algorithms.md §Response Summarization), with P4's silhouette as the "large/diverse enough to split" test. The flat alternative (MMR-style greedy relevance-minus-redundancy selection, DPPs) achieves diversity without structure but loses the product surfaces clustering provides (clusterSize counts, drill-down handles, knownMembers stub lists, aspect structure) — the reason to prefer the hierarchical form here. Prerequisite: a defensible cluster ORDERING (the contrarian-miss diagnosis flagged member-count-desc as rewarding echo-mass; candidates: max-similarity or evidence-mass) — "top 2 clusters" is undefined until ordering is trustworthy. Measurable with the existing harness: aspectCoverage@budget + tokenEfficiency on `eval/golden/hygiene-realscale`. Sequenced after the fixed:100 flip; ordering lever first.

### `[DESIGN]` (superseded original) Session identity for ranking — replace same-api-key authorship with explicit session state

Operator direction (2026-07-16, recipe `4d25aec9`): the echo-demotion authorship signal is too coarse — *"we don't actually know if it's the same agent, since all the sub-agents share the same API key"* — and simply omitting/substituting an agent's own recipes is a ruled-out dead end: *"that's exactly how sub-agents cross communicate, by seeing the recent relevant recipes from their peer sub-agents."* Direction: explicit session state, two candidate shapes — **server-side** (briefing and/or check returns a `sessionId`; check accepts it optionally; invalid/absent → a fresh one comes back, self-healing, expirable) or **client-side** (caller declares known recipe ids per call — note `known_recipes` already ships this shape as a rendering-only lever, and the explicit-parameter dedup design predates it, recipe `8e93a948`). Whichever lands becomes a first-class `CandidateSignals` field and a scoring-stage input, shipped through the harness like any lever. **Full plan awaiting operator ruling (2026-07-17): [docs/planning/session-novelty-and-pool-diversity.md](planning/session-novelty-and-pool-diversity.md)** — session plumbing, known-set rendering with budget backfill (the stub + next-in-line idea, unified with `known_recipes`), suppression identity tiers (session / agent_id lineage / key baseline / no-demotion), sibling-visibility guardrail metric, fixture v2. The 2026-07-17 fidelity run showed why this is urgent: at production shape, key-based demotion clears ALL same-key-recent recipes from the display — functionally the ruled-out omission, applied to sibling sub-agents (recipe `81f40bbd`). *(Resolution: shipped 2026-07-17 as session/stub rendering — migrations 0031/0032 — with suppression itself retired; the arc completed through PRs #40–#44.)*

### `[DESIGN]` Cluster pool decoupled from pagination (hypothesis P6 — the possible deeper echo chamber)

Operator insight (2026-07-16, recipe `bb952d78`): the check path clusters only the top-`per_page` (default 20) candidates by similarity, so as a corpus grows the clustering pool gets more homogeneous — *"the point of clustering is diversity, and that the default 20 limits this. So this might be our actual 'echo chamber' issue."* The 20 is an inherited pagination default with no recorded rationale, and every other surface already decouples: map `perPage: 10000` ("clustering IS the pagination", `routes/traces.ts:176`), briefing exemplars 10000, eval runner 100. Performance doesn't force it — the map clusters the whole corpus at MRL-truncated 768 dims (`MAP_VECTOR_DIMS`). Design: a pool-size `RankingConfig` lever at the candidate-window stage (pool for clustering ≠ page for flat mode), shipped through the harness with diversity metrics (aspect coverage) alongside relevance guardrails. The brief §3d already named "a pool-composition lever" to evaluate alongside cluster ordering. See ranking-engine.md hypothesis P6. **Status 2026-07-17:** research memo landed (candidate-pool-sizing.md: fixed ~100 is the practice convergence; ≤133 stays on the ANN fast plan; count-relative "top X%" rejected — score-gap adaptive is the admissible relative form) and the `clusterPool` lever is implemented default-`page` (commit 1824585). Remaining: superseded as the target by [session-novelty-and-pool-diversity.md](planning/session-novelty-and-pool-diversity.md) Plan B (operator correction 2026-07-17, recipe `81f40bbd` feedback on `7f34d797`): fixed sizes are clamp bounds and comparison arms only; the design is a score-distribution pool boundary (largest-gap / within-δ, clamped [20,133]) plus redundancy handling (relevance-weighted k-means / near-dup collapse). Sweep runs against fixture v2 or the real golden export. **Measurement caveat (2026-07-17 run):** on the 45-trace synthetic fixture `fixed:100` degenerates to a whole-corpus pool — it re-admitted demoted echoes to the summary (topClusterEchoShare 0.202 vs 0.0 for demotion alone) and lowered aspect coverage (0.639 vs 0.689), the pool-sizing memo's oversize warning in miniature — so P6's diversity prediction needs the real golden export or a 300+-trace synthetic fixture before the sweep means anything. Same run's fidelity fix (production-shaped `perPage:20` display call) revealed baseline display pollution was understated by the old idealized `perPage:100` runner: firstExemplarEchoRate 1.000, topClusterEchoShare 0.742 (vs 0.543 idealized); demotion alone clears the production display to 0.0. *(Resolution: measured at real scale and flipped to fixed:100 on 2026-07-19 — [p6-pool-sweep-report.md](planning/ranking-research/p6-pool-sweep-report.md) — then subsumed by the band:0.15 reach under the 2026-07-20-mmr flip; the score-distribution form shipped as the `band` mode, and the "redundancy handling" half shipped as MMR itself.)*

## 2026-07-12 — user-data batch (corpus import, deletion cascade, gate parallelism, short-ids)

Four concurrent worktree trees, orchestrated; all gates green (`test:ci` per branch, serial). Branches pending operator push + draft PRs: `chore/testci-port-param` (f0bc843), `fix/account-deletion-cascade` (2ccf123), `feat/feedback-short-ids` (eee9496), `feat/corpus-import` (b2abc51+ba6c54d). Declared merge order: that order, PR #28 independent; the only overlap is `trace-delete.service.ts` (trivial).

**Corpus import** — `POST /import` (own route module, JWT + verified email, human-only). Upsert-on-trace-id idempotency, `api_key_id = NULL`, timestamps incl. `decided_at` preserved exactly, existing-wins with per-row conflict report (`overwrite=true` replaces owned content only), lazy book creation, 64 MiB cap with incremental body guard, 20k traces in 6.5 s. Zero provider calls on the write path — trace embeddings via the worker sweep (now provider-aware: previously hard-gated on `GEMINI_API_KEY`, stranding keyless deployments), evidence via pending stubs with byte-identical text reconstruction for cache hits. Audit row `corpus.imported`.

**Account-deletion cascade** — `deleteUserCascade` (`user-delete.service.ts`) routes `DELETE /auth/me` and the waitlist purge through `deleteTraceCascade` per trace + one final identity-teardown transaction, users row last (crash means a retryable account, no invisible partial state). Now covered: evidence, references, all four embedding tables, `reference_source_cache`, cross-user `check_feedback` by key (deleted before `api_keys`). Preserved by design: `vector_cache`, `audit_log`. False `auth.ts` comment corrected. Waitlist purge never actually had the gap (unverified accounts hold no keys) but was unified anyway. Bonus fix: `reference_source_cache`'s NO ACTION FK would have blocked reference deletion once that table gains a writer. Repair script for historical orphans ships with it (see Unsorted for the operator run).

**CI-gate parallelism** — `TESTCI_PGPORT` (default 5534) drives compose interpolation, project name `soupnet-ci-<port>`, and backend port 3098+offset (`TESTCI_BACKEND_PORT` override); container names keep the `*-postgres-ci-1` detection suffix. Self-tested: full gate green on 5544 with a concurrent default-port stack up alongside. `.github/workflows/ci.yml` untouched (local-parallelism only). The item was listed twice (Infrastructure + Unsorted); both moved here.

**Feedback short-id prefixes** — 8+ char hex prefixes resolve on `log_feedback` / `feedback` param / `POST /feedback`, within the caller's read scope (uniform `not_found_or_unreadable` marker byte-identical for out-of-scope vs nonexistent — no existence oracle), ambiguity rejected naming the readable candidates, pkey range scan not `id::text LIKE`. Success echoes the resolved full UUID. `related_trace_ids` stays full-UUID (capture-only). Bonus fix: uppercase full UUIDs were falsely rejected.

### Moved items (verbatim):

### `[IMPL]` Parameterize the CI-mirror postgres port for parallel sessions

`scripts/test-ci-local.mjs` + `docker-compose.ci.yml` hardcode host port 5534, so two sessions on one machine cannot run `npm run test:ci` concurrently — observed 2026-07-06 when the premium-llm worktree's gate failed at container startup (`Bind for 0.0.0.0:5534 failed`) while the main checkout's suite held the port. A `TESTCI_PGPORT` env (default 5534) threaded through the compose port mapping and the script's connection env would let parallel worktree sessions gate independently. Leave `.github/workflows/ci.yml` untouched — the collision is a local-parallelism problem only.


### `[IMPL]` Parameterize the local CI-gate port/project so parallel sessions can gate concurrently

Found 2026-07-06: two Claude sessions running `npm run test:ci` simultaneously collide — the harness hardcodes host port 5534 and a fixed compose project, so the second run fails with "Bind for 0.0.0.0:5534: port is already allocated" (observed against the premium-llm session's gate). Fix in `scripts/test-ci-local.mjs` + `docker-compose.ci.yml`: derive the host port and compose project name from an env override (e.g. `CI_PG_PORT`, default 5534) or a session-unique suffix, and pass the resolved port through to the backend's `PGPORT`. Local-only change — GitHub CI runs in isolated runners, so the ci.yml mirror rule isn't implicated as long as env parity for the app under test is preserved. Until fixed: sessions serialize gates by watching for `*-postgres-ci-1` containers.




### `[IMPL]` Corpus import — the inverse of `/auth/me/export`

Operator request (2026-07-06, benchmark session): the export function already produces a complete single-JSON corpus (traces, evidence, references, groups; schemaVersion-stamped), and the PERMA benchmark run archived a 40,822-trace corpus that way (`SoupNet-evals/evals/perma-ab/baselines/run-full1/corpus-export.json.gz`, 20 MB gz) — but there is no way to load an export into an instance. An import endpoint/CLI would let (a) anyone reproduce the published benchmark results (`docs/benchmarks.md`) without re-spending ~$35 of scribe LLM calls, (b) users migrate between hosted and self-hosted, (c) operators treat the export as a restore format. Design points: idempotency (re-import must not duplicate — trace ids are UUIDs, upsert on id); ownership remap (imported rows belong to the importing user; group slugs may collide → suffix or map); **embeddings** — the export carries no vectors, so import must enqueue re-embedding (~$1/40k recipes via Gemini); consider an optional `vector_cache` sidecar in export/import to make reproduction zero-API-cost; `schemaVersion` gate with explicit migration path; and the prompt-injection posture of imported content (imported traces are third-party text entering briefings — same review consideration as shared books). Benchmark reproduction is the first concrete consumer.

Update (2026-07-06): `traces.decided_at` (the human's original judgment date, for decision archaeology) was missing from the export — traces carried `claimText`/`createdAt` but not the judgment date, breaking faithful replay from an export alone. Now included as `decidedAt` (nullable; `schemaVersion` stays 1 since the field is additive). Import design must map it: on upsert, restore `decided_at` as-stored (null = contemporaneous), and keep it distinct from `created_at` (the insertion time), so a re-imported corpus preserves the original decision dates rather than stamping import time.


### `[IMPL]` **Account deletion leaks user PII** — `DELETE /auth/me` skips `deleteTraceCascade`

Found 2026-07-09 while scoping FK constraints. **`DELETE /auth/me` (`apps/backend/src/routes/auth.ts:544-702`) hand-rolls a deletion list that removes `traces`, link rows, `api_keys`, `uploads`, `oauth_authorization_codes`, owned orgs/groups/memberships, and the `users` row — but never deletes the `evidence`, `references`, or embedding rows those traces spawned.** Those tables hold the user's words in cleartext:

- `evidence.content` — the user's interpretations, verbatim.
- `references.quote` / `.source` / `.file_url` / `.original_filename`.
- `embedding_sources.source_text` (`vectors.ts:104`) — **full recipe + evidence text in plaintext**, plus `group_id`.
- `embedding_chunks.chunk_text` — plaintext.
- `reference_source_cache` — fetched page bodies.
- `check_feedback.story` / `.note` — the user's words, on *other* users' traces (its FK cascades on `trace_id`, not on the author).

**The comment at `auth.ts:534-540` is factually wrong** and should be corrected in the same change: it lumps `embedding_sources` in with `vector_cache` as "content-hashed and unlinked from identity." That is true of `vector_cache` (`content_hash` + `model_id` + `task_type` + `vector` only — genuinely PII-free, correctly FK-free, keep it). It is false of `embedding_sources`. The privacy policy's §2.4 reasoning leans on that comment.

**The correct cascade already exists and is not called.** `deleteTraceCascade` (`apps/backend/src/services/trace-delete.service.ts:30`) removes link rows, prunes orphaned evidence/references, and walks the full embedding chain via `deleteEmbeddingChainForSource` (`:101`), preserving only `vector_cache`. It is used by `DELETE /traces/:id` and nowhere else. **Fix: route account deletion through it** (loop the user's trace ids), rather than adding FKs first. Fold in a `deleteUserCascade` service so account deletion, the waitlist purge (`waitlist.service.ts:127`), and any future admin-delete share one audited teardown instead of three hand-rolled DELETE lists that will drift again.

Note this is not a hypothetical drift: `check-feedback.ts:108-111` and `:142-144` added FK cascades on `trace_reactions.user_id` and `check_feedback_stars.user_id` *specifically because* "auth.ts's explicit deletion list doesn't touch this table." Someone predicted the drift and defended locally. Nobody generalized it.

Every already-deleted account has left orphans behind — factor a data-repair pass into the fix. Tag: touches the privacy-policy verification item under Legal and compliance.

**Priority and disclosure (operator, 2026-07-09).** Sequenced behind the in-flight move-recipe work rather than fixed immediately: the gap requires database access to exploit, is a data-retention defect rather than a live attack vector, and the user base is currently the operator plus manually-invited users. This repo is public, so this item is stated plainly rather than hidden — but the trigger is explicit: **if any user requests account deletion, this jumps the queue and is fixed before their deletion is executed**, because running the current path would silently fail to honour the request. The operator checks the users table regularly for pending deletion requests. Until then, do not layer FK constraints on top of the broken path (see the FK item below — orphans from prior deletions will fail a validating `ADD CONSTRAINT` at boot).


### `[IMPL]` `log_feedback` / `feedback` param should accept short trace-id prefixes

Surfaced 2026-07-08 during the local-embeddings implementation (a multi-agent run that logged feedback as it worked). Planning docs and briefings routinely cite recipes by their 8-char short id (e.g. `18912fbd`), but `log_feedback` (and `check_recipe`'s `feedback` param) require the full trace UUID and reject a short id. Three independent agents hit this and had to either resolve the full UUID via `get_recipes` first or log an equivalent row against a different resolvable trace — friction that loses feedback signal (one agent gave up on a warranted row rather than fabricate a UUID). Accept an unambiguous short-id prefix (resolve server-side; 409/400 on ambiguous or unknown), matching how the corpus surfaces ids to agents in the first place. Low effort, removes a recurring papercut in the exact close-the-loop flow the feedback feature exists to encourage.


---


## 2026-07-09 — re-file a misfiled recipe

### `[IMPL]` Move a recipe to a different recipe book — implemented, on `feat/move-recipe-between-books` pending review

`PATCH /traces/:id` plus a Move control on the trace detail page. Human-only: no MCP tool, no API-key path. Agent-facing surfaces stay append-only and idempotent so an uncertain agent asks the human rather than proceeding on a thin assumption it means to correct later, and often won't (recipes `aaad8fdf`, `4b97ba86`).

Shipped:
- `packages/domain/src/trace-move.ts` — `canWriteToBook()` / `authorizeTraceMove()`, pure, 22 unit tests. The destination gate is an explicit role allowlist, not a membership-row existence check, so a future `viewer` role fails closed.
- `apps/backend/src/services/trace-move.service.ts` — one transaction updating `traces.group_id` **and** `embedding_sources.group_id` for the trace's own source rows and every evidence row beneath it. Search scopes by the latter (`vector-search.service.ts:153`, `:374`); updating only the trace row leaves the recipe searchable in the old book and invisible in the new one, silently.
- Duplicate handling: `group_id` is part of `traces_api_key_group_claim_unique`, so moving onto an identical recipe from the same agent is a 409. Drizzle wraps driver errors, so the `23505` sits on `err.cause`.
- Migration 0030 — `check_feedback.api_key_id` nullable, `actor_user_id` added, `CHECK ((api_key_id IS NULL) <> (actor_user_id IS NULL))`. The move writes a first-class human-origin feedback row, not just an audit event (recipe `465df879`). Boot-safe: no `NOT VALID` needed, since the new FK column is all-NULL and existing rows satisfy the CHECK.
- Declassification (recipe `2738f7a9`): the correction note names only the **destination** book, and the human may de-select evidence entries, which are redacted — hard-deleted with any reference they were the last link to — rather than hidden.
- `trace.moved` audit event; `canMove` on the trace payload; `useRecipeBooks()` + `MoveTraceModal`; human-origin feedback rows render distinctly instead of as unlabelled agents.

Integration tests (`apps/backend/src/routes/trace-move.test.ts`, 12) assert against **query-mode** `/traces/map`, which routes through the `embedding_sources` predicate — corpus mode reads `traces.group_id` and would agree with a broken move. Verified by sabotage: removing the `embedding_sources` update fails that one test and no other.

---

## Launch readiness

### 2026-06-11 — SES configuration-set header (bounce/complaint pipeline, app side)

The private infra repo's Terraform created the SES configuration set with SNS bounce/complaint event destinations and injects `SES_CONFIGURATION_SET` into the ECS task definition. App side (this repo): `sendLoggedMail` now stamps `X-SES-CONFIGURATION-SET` on every outgoing mail via the exported `sesHeaders()` helper — env read at send time, unset locally (Mailpit and non-SES SMTP ignore the header). Unit test in `email.service.test.ts`. Same pass fixed env drift discovered while in there: `.env.example` and `docker-compose.yml` set `SMTP_FROM`, which nothing reads — renamed to `EMAIL_FROM`, the var `email.service.ts` actually consumes (the production task definition already used the correct name; only the local-dev files had drifted). Post-deploy verification that closes the loop: send to `bounce@simulator.amazonses.com` and confirm the SNS bounce notification arrives (see the private repo's observability briefing).

### 2026-06-11 — Waitlist v2: the waitlist is a user-record state

Same-day redesign of the v1 waitlist below, after the operator walked the v1 flow and found it stranded people (no password, no ToS, no path from "notified" to "account"). The `waitlist` table lasted hours; v2 (migration `0024_waitlist_v2_user_records`) drops it:

- **Registering at a full cap creates a real account** with `users.waitlisted_at` set (mirrors the `suspended_at` pattern — flag, not role): password + ToS captured up front, email verifiable while waiting, sign-in blocked with a "you're on the waitlist" message and no JWT (which blocks every other surface for free). F30 restated: the register response branches only on attacker-knowable state (public cap status, caller-supplied token validity), never on email existence.
- **Promotion**: raising the signup cap auto-promotes the top of the queue (verified accounts only, invitation-holders first, then oldest) under the signup-cap advisory lock, emailing each "you're in" (`waitlist_approved` kind); plus a per-row admin **Approve** that works regardless of cap or verification. No promote-on-login race — accounts wait until promoted.
- **Invitations unchanged**: token rows only, no user record until the invitee registers (so no premature ToS/password); their priority is queue position. Verification email gets waitlist-variant copy.
- **`users.signup_reason`**: the "what would you use Soup.net for?" question moved onto the regular register form for every signup, surfaced in admin Users + Signups views.
- **Hygiene**: unverified waitlisted accounts purge after 30 days (opportunistic, on the cap-full register branch; disclosed in privacy policy §8).
- Tests: HTTP suite for cap-open paths; DB-fixture suite (`waitlist.service.test.ts`) for the cap-state-dependent state machine — closing the global cap in HTTP tests would flake every parallel suite.

### 2026-06-11 — (v1, superseded same day) Waitlist, signup-queue semantics, email log, admin Signups page

Triggered by AWS production SES approval (site effectively live, prod cap at 5). Landed in two same-day passes — the first shipped invite-bypasses-cap, which the operator then corrected to top-of-waitlist semantics; what's described here is the final state:

- **Waitlist was fake.** The login page's waitlist form showed "You're on the list!" while persisting nothing (`TODO: Wire up to POST /waitlist`). New `claimnet.waitlist` table, public rate-limited `POST /auth/waitlist` (anti-enumeration: identical response for new/duplicate/registered emails, mirrors F30 register design), form wired. A second, unreachable copy of the waitlist screen in LoginPage (dead `showWaitlist` state) was removed.
- **Invite semantics (operator decision):** a member invitation puts the invitee at the **top of the waitlist**, it does not bypass it. The invitation reserves a slot against the cap; the invitee registers only while their reservation fits within the cap (`mayRegister` excludes their own pending invitation from the count — the previous code counted it, silently rejecting invitees at the boundary; reservations also stop counting once the email belongs to a registered user). Admin invitations (`bypass_cap`) skip the cap entirely. New public `GET /auth/invite-status` lets the register page show "you're at the top of the waitlist" instead of a silently-failing form when the cap is full.
- **Admin invite is email-only:** `POST /admin/invite` no longer requires a recipe book (`invitations.group_id` now nullable; groupless invites stamped accepted at registration) and no longer auto-emails — it returns the invite URL for manual sharing, consistent with the ADR-0016 spam-safe design the auto-send had quietly crossed.
- **Email log (light CRM):** every outgoing email goes through `sendLoggedMail` → `claimnet.email_log` (metadata only, never bodies — they carry tokens; 60-day opportunistic purge). engineering-principles.md §14. Privacy policy §8 discloses it; §2.3/2.5/8 retention wording softened to match reality (uploads kept until account deletion; audit log retained for security/operational purposes).
- **Admin `/admin/signups` page** (no generic "Settings" page — each control lives with its surface; embeddings kill-switch moved to the Embeddings page): cap editor, merged signup queue (waitlist + pending member/admin invitations, type badges, invited-first ordering), per-row "spot opened" Notify action (consent-based — waitlist signups asked for it), admin invite-by-email with copyable link.
- **Admin `/admin/emails` page**: the email log as a proper list view — always-visible "what sends email" explainer, filter by recipient/kind/status, date sort, pagination. Same pass extracted the shared admin list-view primitives (`useAdminGate`, `AdminPagination`) so Users/Signups/Emails compose the same FilterBar + Table + Pagination pieces instead of copy-pasting them.

Migrations `0022_waitlist`, `0023_waitlist_crm_invite_semantics`. Tests: `waitlist.test.ts` (Layer 3 — full waitlist→notify→invite→register arc), `system-settings.service.test.ts` (Layer 1 — which branches consult the cap).

---

## Recipe checks

### 2026-07-05 — Markdown response option for web `/check` page (absorbed into WT-4 response formats)

The 2026-05-27 demo finding (JSON copy-back alienates even technical users) resolved as part of the WT-4 check-loop tree: a shared markdown renderer now lives in `@soupnet/domain` (`renderCheckResponseMarkdown`) and serves three surfaces — the HTTP MCP `check_recipe` default response (`response_format: "markdown" | "structured"`, markdown default, one format per response per operator review 2026-07-05), the stdio MCP mirror, and the web `/check` HTML result page, which renders the result as a fenced ` ```markdown ` block with a "Copy results for AI agent" button (the JSON copy button stays as "Copy as JSON"; `format=json` endpoint behavior unchanged). Every exemplar line carries its full recipe UUID + similarity inline so the check → feedback join works in the default format. Same pass removed agent-facing pagination text ("Page X of Y") and the `actions.nextPage` hint that advertised a `page` param the tool doesn't accept — replaced with a narrowing hint (read_recipe_books / axes / clusters). Also fixed en passant: the old HTTP MCP formatter read `evidenceFor` while the builder emits `evidence`, so HTTP MCP text responses had silently omitted all evidence.

### 2026-07-02 — Recipe Map: layout cache + read-time 768-dim MRL truncation

`/traces/map` took 59s on prod (0.25 vCPU task doing k-means over 1,316 × 3,072-dim vectors + parsing ~80MB of vector text). Two-part fix, verified on the imported real corpus:

- **In-memory layout cache** (`map-layout-cache.ts`, 16-entry LRU) keyed by (groups, k/maxChars/expand/strategy, corpus version = trace count + newest created_at) — new traces invalidate implicitly by changing the key. Default map loads only; query/axes/traceIds variants skip it. `meta.cached` exposed for tests/debugging.
- **Read-time MRL truncation**: `fetchTraceVectors` gained a `dims` param using pgvector `subvector()` — the map + briefing-exemplar surfaces run whole-corpus k-means at 768 dims (`MAP_VECTOR_DIMS`). **Stored vectors are untouched** (operator's explicit guard): halfvec(3072) rows and the float32 vector_cache remain the source of truth; search runs in SQL on full vectors; concept-axis cosine stays valid because the similarity loop truncates both sides to the trace vector's length.

Measured (local, real 1,316-trace corpus): compute 2.08s → 0.84s, cached repeats 10ms, payload 428KB → 282KB. `get_briefing` exemplars get the same truncation win. Tests: `map-layout-cache.test.ts` (Layer 1) + a `/traces/map` integration test (cached flag lifecycle + 768-dim response vectors + implicit invalidation on new trace).

### 2026-07-02 — ANN-first hybridSearch (the index earns its keep)

Operator challenged the just-committed HNSW index drop ("shouldn't we optimize the query so it IS used?") and was right: the "planner never picks HNSW" conclusion was an artifact of only testing `LIMIT 1000`+. Reverted the drop (`bd2ea7c`) and reshaped the search instead:

- **`hybridSearch` = exact COUNT + ANN top-k + exact fallback.** totalResults from a ~5ms `COUNT(DISTINCT)` (no distance work; keeps the no-silent-cap decision). Results from an HNSW-streamed top-k (`hnsw.iterative_scan = relaxed_order`, `ef_search = max(200, k)`, `k = clamp((offset+perPage)×3, 60, 400)`) — the planner picks the index unforced at these limits through the full join shape. Exhaustive no-LIMIT fallback on page under-fill, deep pagination (k>400), or ANN-transaction error (pgvector <0.8) — guaranteed no recall regression. `evidenceSearch` got the same iterative-scan posture.
- **Validated on real vectors**: imported the operator's prod export (1,316 traces, 3,050 evidence) into a fresh local stack, embedded with real Gemini (12,262 vectors, 0 failures), leave-one-out ×30: recall@20 mean 99.0% / min 85%, top-3 exemplar agreement 28/30, ANN p50 51ms vs exact 69ms warm — and cold behavior is the real win (top-k touches ~k vectors' pages instead of the whole ~200MB TOAST set, removing the after-idle cliff structurally).
- Cost acknowledged: the index stays (~95MB working set; 125s rebuild inside any future VACUUM FULL, measured by infra).

### 2026-07-01 — Recipe-check latency wave 2: search recall + task-type cleanup + instrumentation

Same-day follow-up to the embed-call reduction below, driven by three operator decisions:

- **Production-strategy search filter** (operator picked "filter" from the presented options): `hybridSearch` searches only `PRODUCTION_SEARCH_STRATEGY_IDS` (`full_document`, `full_recipe_context`; new export in `@soupnet/domain`). Measured: candidate pool went from 141 → 754 distinct traces at the same latency. `fetchTraceVectors` now prefers production strategies for clustering vectors too (previously alphabetical order silently picked `exp_full_headed`).
- **No candidate LIMIT** (operator: "increase or drop if feasible" → dropped): the planner top-N seq-scans exactly regardless — HNSW investigation showed pgvector 0.8.2 declines the index even with `enable_seqscan=off`, so the LIMIT only truncated output and silently capped recall. Every in-scope trace is now ranked. `SET hnsw.ef_search` removed (was a no-op). ANN revisit note stays in backlog (~10× corpus).
- **RETRIEVAL_DOCUMENT generation dropped entirely** (operator): the model ignores task_type, so the twins doubled `embedding_vectors` + `vector_cache` for byte-identical data. `TASK_TYPES` is SEMANTIC-only in `enqueue.ts` + `strategy-check.ts`; re-add path documented in the KNOWN BUG note. Migration `0025` deletes existing RETRIEVAL rows (~half of embedding_vectors) and all `exp_trace_minimal` pipeline rows.
- **`exp_trace_minimal` removed from the registry** (operator): byte-identical to `full_document`, which is now the labeled trace-only baseline in the map's strategy dropdown.
- **Per-stage instrumentation**: new `StageTimer` (`lib/stage-timer.ts`); `/check` responses carry a `Server-Timing` header (`embed/write/query_embed/search/vectors/cluster/evidence/total`) and every check logs one `[check-timing] {...}` JSON line for log-based dashboards (pairs with the private-repo observability briefing).

Verified live: `Server-Timing: embed;dur=260.0, write;dur=19.0, search;dur=47.5, vectors;dur=38.0, cluster;dur=0.9, evidence;dur=69.0, total;dur=436.9` on a 0.44s new check. Tests updated (`sync-embed-path.test.ts` asserts SEMANTIC-only rows; queryvector embed-once contract unchanged).

### 2026-07-01 — Recipe-check embed-call reduction (measurement items 1+2)

From the same-day latency measurement ([rough-notes/2026-07-01/recipe-check-latency-findings.md](rough-notes/2026-07-01/recipe-check-latency-findings.md)); landed together as one write-path change:

- **Query embeds reuse the trace vector.** `runSearchPipeline` resolves the query embedding once and shares it between `hybridSearch` and `evidenceSearch` (both gained an optional `queryVectorStr`); the check path passes the trace vector it just cached — the query text IS the trace text — so the search half makes zero embedding calls. Duplicate re-checks are all `vector_cache` hits: zero Gemini calls end-to-end.
- **Sync write path pays ~one embed round-trip instead of six sequential.** The `full_document` + `full_recipe_context` `SEMANTIC_SIMILARITY` vectors resolve in parallel BEFORE the transaction (`getOrCreateCachedVector` + `computeChunkHash` now exported from `enqueue.ts`; `enqueueEmbedding` accepts `precomputedVectors`); `RETRIEVAL_DOCUMENT` rows insert as `pending` for the worker (the documented task_type bug makes them byte-identical anyway; multimodal chunks still sync-generate both per ADR-0019).
- **Experimental strategies off the check path** (operator decision 2026-07-01): the 6 `exp_*` variants are no longer enqueued inline (~30 inserts saved per check); the strategy sweep's discovery loop backfills them within ~1 minute.

Measured effect (local stack, real Gemini): new check 2–3s → **0.53s**; duplicate re-check → **0.11s**. Tests: `sync-embed-path.test.ts` (SEMANTIC complete + RETRIEVAL pending + no inline exp rows + idempotent duplicates), `vector-search.queryvector.test.ts` (embed-once contract, provider mocked). Docs updated: search-strategies.md §Sync vs Async, search-algorithms.md §Task types + §Experimental, overview.md pipeline drill-down. Remaining siblings (HNSW seq-scan fix, strategy-filter decision, Server-Timing instrumentation) stay in backlog.md §Recipe-check latency.

### 2026-06-10 — `decided_at`: backfill historical decisions with their original judgment date

New optional parameter on recipe checks for decision archaeology (design-thinking.md §Decision Archaeology — driven by the discovery-agents-on-an-unfamiliar-codebase use case): when an agent finds a past decision in git history, ADRs, or other dated artifacts, it checks the recipe with `decided_at` set to the artifact's timestamp so the judgment carries its original date instead of the logging date.

- Schema: nullable `traces.decided_at timestamptz` (migration `0021_add_traces_decided_at`). `created_at` stays the insertion time — temporal honesty: the record never claims to have been logged earlier than it was.
- Validation in `submitAndSearch` (service layer): ISO 8601 date or datetime; future dates rejected, so backdating can only make a recipe *older* — no freshness gaming.
- Agent-facing judgment date: search results coalesce `COALESCE(decided_at, created_at)` (hybrid search + corpus fetch), so `sort=recent`, result dates in JSON/HTML/MCP responses, and clustering exemplar dates all read as the judgment date. The check log (audit_log `occurred_at`) is untouched — it logs when checks happened.
- Param plumbed through all three surfaces: `CHECK_PARAMS` row (`decided_at`, alias `decided`, round-trips through Copy/re-check links), remote MCP `check_recipe`, stdio MCP proxy. Shared description in `MCP_PARAM_DESCRIPTIONS.decidedAt`; web-tier mention in `CONNECTION_TIERS`.
- Dashboard: trace detail shows "Decided ⟨date⟩ · logged ⟨date⟩" when backdated.
- Tests: stores/coalesces, null default, rejects unparseable, rejects future (trace.service.test.ts); param round-trip + alias (check-params.test.ts auto-covers via the CHECK_PARAMS table).

Follow-ups tracked in backlog.md §Decision archaeology follow-ups (more surfaces for the date; temporal decay should use the judgment date).

## Landing page

### 2026-06-10 — "The challenge" section: METR time-horizon framing + check-log visual

New section between the hero and Pillar 1 mirroring the in-person pitch (benchmark → log → explain the system): agents finish longer and longer unattended stretches (METR time-horizon measurements, linked in a Q&A expander), unattended hours are full of judgment calls, and the gap is keeping that work aligned with the user's taste and judgment. Visual is a static check-log excerpt (`CheckLogMock`) styled like the real CheckLogPage cards — one coherent afternoon of one agent's checks. Second Q&A expander differentiates from fact-storage memory (vendor memory, fact-extraction frameworks, knowledge-graph memory, markdown memory files): facts ossify; recipes carry role/goal/reasoning/quote/citation/date so future agents re-evaluate instead of obeying. Final CTA heading reworded ("The work is only getting longer…") to avoid duplicating the new section's heading; the Q&A `details` rendering was extracted from `Step` into a shared `QnaDetails` component.

---

## Landing page

### 2026-05-27 — Solution illustrations for the recipe-check walkthrough (three steps)

The landing page's "How Soup.net recipe checks solve this" section had a structural gap: the two pillar illustrations above depicted the situation Soup.net addresses, the carousel below showed concrete demonstration, but the walkthrough explaining the mechanism had no visual presence. Three small watercolor illustrations now sit beside the three steps, completing a consistent solve→demonstrate visual arc.

- `illustration-briefing-handoff.png` — person handing the briefing to an agent figure
- `illustration-checks-in-motion.png` — agent working alongside the person, recipe checks rising as small marks toward a glowing vessel
- `illustration-context-returning.png` — marks settling back around the agent, one or two glowing brighter

Layout follows pillar pattern: `flex: "1 1 220px"` with `maxWidth: 280`, `--color-outline-variant` hairline border, and `--radius-lg` rounding — same visual family as the existing two pillar illustrations, smaller scale. Connected as a vertical sequence beside the step text via tight `--space-md` gap between Steps. Responsive: shrinks below basis and wraps below step content on narrow viewports.

Pillar 1 and 2 alt texts updated in the same pass — previously solution-leaning ("aware of their working preferences," "handing accumulated context"), now describe the situations the artwork actually depicts so the new walkthrough illustrations can carry the solution imagery cleanly.

The `Step` component (`apps/frontend/src/pages/LandingPage.tsx`) gained optional `illustration` and `illustrationAlt` props during the structural work earlier the same day; wiring was a three-call drop-in. Detailed image-gen briefings used to produce the artwork are recoverable from git history (commits leading up to this move).

---

## Connector + OAuth

### 2026-07-06 — OAuth refresh: 1h expiry bug + dedicated `consumed_at` consumption marker (F38 follow-up)

Both items done together as the backlog directed (`[IMPL]` "OAuth refresh blocked after access token expires (1h) — column overload" + `[DESIGN]` "Separate OAuth refresh consumption marker from `expires_at`"). This bug was the prime suspect for claude.ai connectors silently losing tool discovery an hour after connect: `refreshOAuthTokenBundle` gated rotation on `expires_at > NOW()`, but `expires_at` is the *access token's* 1h expiry, so any refresh after the access token's natural life returned `invalid_grant` despite a valid 30-day refresh window.

- **Migration `0028_oauth_refresh_consumed_at`**: adds nullable `api_keys.consumed_at` (timestamptz) + a security-critical backfill stamping `consumed_at = to_timestamp(0)` on oauth rows whose `expires_at = to_timestamp(0)` — those are the OLD consumed markers, and without the backfill their still-in-window refresh tokens would become refreshable again under the new gate (token-family resurrection).
- **New refresh gate**: atomic `UPDATE ... SET consumed_at = NOW(), expires_at = to_timestamp(0) WHERE ... consumed_at IS NULL AND expires_at > to_timestamp(0) AND refresh_token_expires_at > NOW() RETURNING` — the CAS predicate is a pure NULL check (preserves the 2026-06-29 property: no cross-transaction start-timestamp comparison). The `expires_at > to_timestamp(0)` term is a mixed-version deploy guard (rolling ECS task replacement: rows consumed by pre-0028 code after the backfill ran stay dead).
- **Rotation policy (deliberate, recipe efeaab7a)**: the old ACCESS token dies when its bundle is rotated — the same UPDATE truncates `expires_at` to the epoch sentinel, so every liveness reader (validateKey, briefing scope, per-key rate limiter, key lists, admin stats) inherits the revocation through the existing `expires_at > NOW()` invariant. `validateKey` additionally gained an explicit `consumed_at IS NULL` guard (defense-in-depth, redundant today).
- **Tests** (oauth-flow.test.ts, 15 → 20): refresh-after-access-expiry regression (verified to fail against pre-fix code), rotation stamps consumed_at + epoch and revokes old access, 10-round concurrent double-refresh (higher-iteration F38 variant, exactly-one-wins each round, loser gets invalid_grant), plain daily/scoped keys unaffected + consumed row rejected, legacy epoch-stamped row cannot be resurrected before OR after the 0028 backfill statement (run verbatim in-test).

Eight commits in one session that take the connector flow from "Bearer-only, no claude.ai web support" to "ready for directory submission once non-code prep lands". Bullets in commit order:

- `2954463` Briefing edits. Added an explicit fifth principle ("Authoring for retrieval") that names the embed + ANN-search + clustering mechanism agents are writing into — once an agent sees the mechanism, the rest of the authoring guidance is derivable. Reworded the proper-noun rule from "strip" to "replace" (substitution preserves cluster-useful signal: "Soup.net maintainer" → "MCP server maintainer", not just "maintainer"). Setup section gained a claude.ai web row pointing at the web-only fallback for now.
- `7c90158` Public `/info/claude-connector` docs page rendering `docs/connectors/claude.md`. Same `?raw`-import pattern as PrivacyPage/TermsPage. Three example prompts mapped to the canonical `checking_modes` from `recipe-examples.json` (broad_discovery, judgment_with_reasoning, logging_stated_preference). Privacy policy §7 dropped the "self-serve deletion is on the build-out checklist" promise so the live text matched reality at the time.
- `7a3e57c` Root `npm run db:generate` script delegating to the workspace's existing chained script (drizzle-kit + data-model docs regen). Eliminates the cwd-trap that broke a previous gate run (cd into `packages/db` for migration, then `npm run test:ci` from there → "Missing script: test:ci"). Incidentally caught `docs/architecture/data-model-generated.md` was last regenerated against migration 0007 — bumped to 0019 (13 migrations of drift).
- `a46636c` OAuth 2.1 DB schema. New tables `oauth_clients` and `oauth_authorization_codes`; three new columns on `api_keys` (refresh_token_hash, refresh_token_expires_at, oauth_client_id). Access tokens reuse the existing `api_keys` row with `key_type='oauth'` — OAuth is an issuance flow, not a parallel auth population. Refresh tokens live on the same row so rotation is a single INSERT + UPDATE.
- `d9c15e1` Metadata endpoints (`/.well-known/oauth-authorization-server` per RFC 8414, `/.well-known/oauth-protected-resource` per RFC 9728) + Dynamic Client Registration at `POST /oauth/register` per RFC 7591. Redirect URI validation: https only with http://localhost permitted for dev. Test infra: `test-ci-local.mjs` now sets `BACKEND_URL` on the spawned backend so absolute-URL renders (briefing, metadata, etc.) match the test BASE.
- `c5dc4d2` The middle of the flow: `POST /oauth/authorize/grant` (JWT-authed, mints the code given client+redirect+PKCE+chosen-scope) and `POST /oauth/token` (client-authed via client_secret_post or client_secret_basic, handles both authorization_code with PKCE verify and refresh_token with rotation). Server-rendered consent screen via the SPA at `/oauth/authorize` — fetches client info + recipe books, renders a read/write/default-write picker, POSTs to grant, navigates to the returned redirect_url. Authorization endpoint moved to `FRONTEND_URL` in the AS metadata since the consent UX is a SPA page. 14 new end-to-end flow tests including happy path with refresh rotation invalidating both old access AND refresh tokens, every rejection path that matters (wrong code_verifier, code reuse, redirect_uri mismatch at /token, wrong client_secret, unregistered redirect_uri at grant, unsupported response_type, unsupported code_challenge_method, scope default-write outside write set, unauthenticated grant, unsupported grant_type), and `client_secret_basic` auth.
- `f9a35d5` Tool annotations on all six MCP tool registrations (4 in remote MCP, 2 in stdio MCP) — `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`/`title`. Required for directory submission (missing annotations is the #1 rejection reason per Anthropic's checklist). Origin-header validation middleware on `/mcp/*` per the MCP transport spec — allowlists claude.ai, claude.com, FRONTEND_URL, BACKEND_URL, and localhost variants; absent Origin (server-to-server calls) passes through. Self-hosters can extend with `MCP_ALLOWED_ORIGINS`.
- `9c231ca` Self-serve account deletion (`DELETE /auth/me`). Password confirmation required. Transactional cascade in dependency order. Owned-shared-orgs guard: if the user owns a non-personal org with other members, 409s asking for ownership transfer first. Privacy policy §7 flipped from manual-only to self-serve, with the email channel retained as fallback. Settings → Account gains the matching UI.

Net: 239 → 277 tests (+38 across OAuth flow, Origin validation, deletion paths). All eight commits passed the canonical `npm run test:ci` gate. Open follow-ups (rate limits on remaining OAuth endpoints, consent-screen styling, ownership-transfer UI, directory submission's non-code prep) live in the new top-level sections of `backlog.md`.

---

## Agent surfaces

### 2026-05-12 — Unified agent briefing (one source, one button, includes cluster samples)

Consolidated ~10 overlapping agent-facing surfaces into a single artifact. The `GET /keys/briefing?type=mcp|web` split is gone; one endpoint returns one markdown briefing that covers both MCP-capable and web-only agents inline. The `## Context from <books>` cluster-exemplars section that previously only appeared on the Recipe Map page is now part of every briefing — Dashboard, API Keys, Recipe Book, and Map pages all hand back the same artifact (the map adds refinement params).

Frontend: dual "Copy MCP briefing" / "Copy web briefing" buttons collapsed to one "Copy agent briefing" button on all four surfaces. The Recipe Map page's client-side exemplar-injection (~80 lines) is gone — the backend composer now does it.

MCP tool rename: `get_recipe_guide` → `get_briefing`. Returns the same unified briefing the HTTP endpoint does, so MCP agents calling `get_briefing` are primed with the user's recipe books and a clustered corpus sample, not just static guide text. Stdio MCP server reduced to a thin proxy that calls the new Bearer-token-auth `GET /briefing` backend endpoint.

User preferences: new JSONB `users.preferences` column (migration `0019_user_preferences`), Zod-validated in `@soupnet/domain/user-preferences`, exposed via `GET/PATCH /me/preferences`. First two prefs are `briefing.clusterCount` (default 5; used by the briefing pipeline) and `briefing.subClusterCount` (default 1; stub for the planned sub-cluster drill-down).

Settings IA: `/app/settings` is now a layout with a left-nav and two child routes — `/app/settings/account` (extracted from the old monolithic page, minus Agent Setup / Privacy Defaults / System Admin which moved or were removed) and `/app/settings/briefings` (cluster-count preference).

Documentation: new "Priming an External LLM via Copy-Paste Briefing" pattern in `docs/design-thinking.md` and Scenario F (Factorio mod art via ChatGPT) in `apps/backend/public/docs/recipe-scenarios.md`, cross-linked.

#### 2026-05-13 — Briefing v2 (content review + list_my_recipe_books alignment)

Follow-up round after first-paste review of the unified briefing. Targeted what the receiving LLM actually needs to know vs what was over-explained or missing.

- **Section reorder**: concept frame (Principles, When to check, Recipe format) → identity (user, recipe books, corpus exemplars) → mechanics (API key, setup, how to check) → output patterns (annotation, divergent, links, JSON copy-back). The previous "two connection styles" framing at the top was removed — section headers carry it without putting a decision in the receiving model's hands.
- **Recipe format section added**: 2 annotated examples (surfacing-an-assumption + stated-preference) + the three voice-failure modes (agent voice / user-name voice / recipe-book-implied voice). New `VOICE_FAILURES` export in `recipe-guide-content.ts`; small inline format examples curated from the larger `RECIPE_EXAMPLES` set.
- **Exemplar metadata enrichment**: each exemplar now has a YAML-frontmatter header (`### Exemplar N of M`, `Recipe ID`, `Recipe book`, `Author`, `Logged`, `Cluster size`) instead of the ambiguous `(1 similar · logged YYYY-MM-DD)` single-line. Exemplar start/end is now unambiguous; the recipe ID lets the receiving agent link/reference/reinforce specific traces. Backend `briefing-exemplars.ts` was extended to join `users` + `groups` for author + book lookup.
- **Members list on shared recipe books**: each shared book in the briefing now lists other members (`displayName <email>`) so the receiving LLM can name collaborators in synthesis. Solo books omit the line entirely.
- **User identity**: new `## Your user` section gives the LLM the human's display name + email so it can address them by name. Previously the briefing was anonymous.
- **Cross-pollination framing**: new `CROSS_POLLINATION` export — explicit guidance that recipes from other members of shared books surface alongside the user's own, and should be weighed as collaborator context with author attribution.
- **`list_my_recipe_books` MCP tool aligned with the briefing**: now returns the same `## Your user` + `## Your recipe books` + `## Context from your corpus` block (no boilerplate). Single composer (`services/briefing.ts` → `composeCorpusContext`); both surfaces stay in lockstep automatically. Tool description updated to frame it as a mid-session "briefing refresh" — agents call it when conversation drifts into a new area of the user's work, or periodically during long sessions on shared books to pick up new recipes from collaborators.
- **MCP config compaction**: setup section reduced from ~80 lines (four full configs) to ~15 lines (one complete Claude Code config + a 3-bullet diff list for VS Code, Antigravity, and Claude Desktop). LLMs reason about the diff fine.
- **Evidence-formatting fixes**: stripped the internal `(no interpretation)` placeholder that some recipe-checker LLMs literally emit when they have a quote but no synthesized commentary. Quote-less references now render as a bare `-- source` line (faithful to data; reflects an LLM author who collapsed description into source).
- **Bug fix**: `SearchResultItem.createdAt` is typed `Date` but the raw `db.execute(sql\`…\`)` path in `fetchCorpusTraces` returns it as a string from postgres-js — the rest of the codebase already treats it as a string. The briefing composer was calling `.toISOString()` on it and 500ing; now uses a defensive `formatLoggedDate(unknown)` normalizer.
- **Bug fix in `useClipboard.copyToClipboardAsync`**: the `getText` callback was being invoked twice when the inner promise rejected — the ClipboardItem path failed, fell through to the textarea fallback, and called `getText` again. For copy-briefing handlers that mint a fresh daily key, this minted two keys per click. Memoized so any rejection re-throws to the caller instead of triggering a retry. Pre-existing bug, exposed by the 500.
- **Bug fix in evidence quote-parsing**: `parseEvidenceMarkdown` was storing references with surrounding `"..."` marks intact (e.g. `quote: '"the text"'`), so any renderer that wrapped with `"..."` produced doubled `""the text""`. Visible in every briefing and in the stdio MCP `check_recipe` text output. Parser now strips a pair of outer matching `"` at parse time (canonical inner-text storage); briefing renderer also strips defensively to handle already-stored legacy data without needing a DB migration. Tests updated.

---

## Vocabulary and rename

### 2026-05-10 — Group → Recipe Book user-surface rename + schema-rename deferral

User/agent-facing rename landed in commit `bd59f23`: frontend UI, REST routes (`/recipe-books/*` with `/groups/*` 308-redirecting), MCP tool names (`list_my_recipe_books`, `update_recipe_book_description`), JSON wire-format fields (`*RecipeBookIds`), email/blurb copy, recipe guide, agent briefings, recipe-book descriptions on Soup.net, Layer 1 regression test. Residual long-form-doc sweep (engineering-principles.md, architecture/overview.md, data-model.md, data-flow.md, api.md banner, workflows/new-user-onboarding.md, design-thinking.md remainders) landed in the follow-on commit on the same day. Schema-level rename of `claimnet.groups` / `group_members` is deferred — fully tracked in `docs/adr/0016-groups.md` §"Update 2026-05-10" with explicit trigger conditions. Both prior backlog items (the residual sweep and the schema-rename decision) are now closed there.

---

## 2026-07-06 — connector-readiness arc (directory prep)

### 2026-07-06 — OAuth briefings render zero credentials

The briefing's "Your API key" section and every ?key= URL now branch on key_type='oauth': OAuth-connected agents get a truthful connection note (1h auto-refreshing token, nothing to copy or protect) and keyless pointers instead of pasteable-key setup sections; non-OAuth briefings verified byte-identical. Closes "Reconcile the briefing's API-key-in-URL assumptions for OAuth-connected agents". Same arc, same day: tool/param descriptions trimmed to affordances (tools/list 18KB → 11.6KB, budget-guarded); WWW-Authenticate challenge on the /mcp 401; GET/DELETE → 405 in stateless mode + [mcp-req] observability; OAuth refresh consumed_at fix (migration 0028); shared consent-screen picker; connector display-name warning (domain-like names silently block tools on claude.ai — operator-discovered root cause of the conversation-time tool-discovery failure).

## 2026-07-05 next-improvements batch

### 2026-07-05 — Fast-follow round (FF-1/FF-2/FF-3), same-day defect fixes from the batch's qualitative evals

- **FF-1 check-surface hardening:** explicit 401 invalid-key state on /check (HTML remediation page + JSON `remediation` field; expired and unknown keys byte-identical for anti-enumeration) and shared `invalidKeyMessage()` remediation across all MCP tool auth errors + /briefing (closes "Expired/invalid API key error should carry remediation" and the eval "Key-death UX" item); accurate per-request 400 diff in modern vocabulary ("recipe (alias: trace)"); POST /check honors format=json; `%97` root cause fixed (Hono's decode fallback stored raw percent-text for cp1252 bytes — new lenient single-pass wire-form decoder, exact-byte tests across GET/POST/MCP; also fixed a Hono body-cache poisoning bug en route); relatedEvidence entries carry recipeId + get_recipes hint across all response shapes; check-result dates render as explicit-UTC ISO minute precision (was bare future-looking UTC date); **filter/f implemented on /check** — resolves the `[DECISION NEEDED]` item by implementing the documented contract: filter with no recipe = read-only semantic search, no trace, lightweight `check.searched` audit row outside the F29 COUNT path, 600/h in-memory per-credential cap; filter alongside a recipe narrows candidates. All live-probed post-merge (401s, no-log invariant, POST json, em-dash bytes).
- **FF-2 journey polish:** register-intent routes land on the Register form; check-log groups repeated opens (×N badge, display-only); dashboard double-key-mint root-caused (two parallel CTAs) and fixed; optional `label` on POST /keys/daily now stamped by dashboard/connect mints; env-aware MCP URL on /info/connect (self-hosters no longer pointed at the cloud); distinct nav aria-labels; Recipe Map tiny-corpus copy. Copy-toast and prod-devtools items verified already correct; verify-email auto-sign-in reported as needs-backend.
- **FF-3 briefing copy (inaugural declared-intent edits, +764 bytes):** web/REST feedback path (POST /feedback) documented for web-only agents; null-result-is-seeding line; dry-run honesty sentence pointing at the new filter escape hatch; URL-encoding example; decided_at worked example; link examples derive from the instance base URL. Declared intent recorded in docs/briefing-specs/declared-intent-log.md (new, the running log) with matching .feature scenarios added in the same commit. (Closes the eval "Feedback copy parity for web agents" item.)


### 2026-07-05 — Five parallel work trees shipped (plan: docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md)

All five trees implemented, merged, and verified (test:ci green; Layer 4b live MCP verification; qualitative evals in docs/rough-notes/2026-07-05/qualitative-eval-findings.md):

- **WT-1** — rule-of-7 sidebar regrouping (Learn group incl. landing page reachability), mobile bottom bar reduced to 5 items + More sheet, bottom-bar min-width overflow root-cause fix, distinct Admin icon. (Absorbed the "Side-nav regrouping (rule of 7) + landing reachability" [DESIGN] item.)
- **WT-2** — dashboard zero-checks onboarding with 4-card agent-type picker (permanent home spliced atop /info/connect), briefing-scope truth-in-labeling (dashboard now renders the actual daily_read book list instead of the false "reads all recipe books" claim).
- **WT-3** — `get_recipes` MCP tool + `GET /recipes` REST (key-scope ACL, uniform not_found_or_unreadable markers, IDOR-tested), `recipe_ids` + `purpose` params on all three briefing surfaces, `/traces/:id` SPA redirect fixing the briefing's trace-link template.
- **WT-4** — `response_format` flag on check_recipe (markdown default with inline UUIDs+similarities, structuredContent on request), shared markdown renderer + web /check fenced copy-back (absorbed the "Markdown response option for web /check" [DESIGN] item), agent-facing pagination removed (incl. the actions.nextPage contradiction), server-side feedback ingestion (migration 0027: check_feedback + trace_reactions + check_feedback_stars, user-FK cascades), chained `feedback` param + `log_feedback` tool + POST /feedback, trace-detail feedback lineage + still_true/stale/wrong reactions + stars, `known_recipes` rendering-only stubs, UVP Layer-1 server stamps (resultSimilarities, surface, oauthClientId, briefing.issued funnel event).
- **WT-5** — four `@unreleased` briefing-spec .feature files for the new capabilities (the eight core spec files already existed from 2026-06-10 — regression phase 1 was already done), api.md historical banner.

Survey-discovered bugs from the plan's batch section, all fixed in the batch: dashboard daily-key scope copy; MCP pagination-without-param contradiction; briefing trace-link template (via SPA redirect); known_recipes dangling reference (shipped as the feature); api.md historical flag.

### 2026-07-05 — FF-2: new-user journey polish fast-follow (frontend + small backend label passthrough)

From the 2026-07-05 qualitative-eval findings (New defects #5-8 + papercuts). Frontend-only except one backend param (`label` on `POST /keys/daily` — the schema/column already existed for scoped keys):

- **Register-default entry points**: `LoginPage` now defaults to the Register tab when mounted at `/auth/register` (checks `location.pathname` on init) instead of always opening on Sign In — the "Create Free Account" CTAs already linked to `/auth/register`; the form just didn't honor it.
- **Check-log grouping**: new pure `lib/group-checks.ts` (`groupChecksByTrace`, tested) collapses repeated opens/refreshes/JSON-fetches of the same check URL into one row with an "×N" badge on `CheckLogPage`. Server-side logging (and F29 rate limiting) untouched — display-only fix.
- **Key labeling**: (a) root-caused the "one copy action mints two keys" report — `DashboardPage`'s zero-checks state rendered *two* independent "mint a daily key + copy briefing" actions at once (the onboarding `AgentTypePicker` card and the "For Your Agents" sidebar section); the sidebar section now collapses to a pointer while onboarding is active, since both did the identical thing. (b) `POST /keys/daily` gained an optional `label` param (`api-key.service.ts` `generateDailyKey` — previously hardcoded `NULL`); `CopyBriefingButton` and the dashboard's "Open recipe check page" action now stamp meaningful labels ("Dashboard briefing — <date>", "Connect page briefing — <date>", "Dashboard check page — <date>"). (c) `ApiKeyBadge` no longer glues "(unlabeled)" to the key-hash prefix — unlabeled keys now show "No label set" with the hash kept as a de-emphasized secondary detail.
- **Env-aware Connect-to-AI URL**: new `lib/localize-connect-docs.ts` (tested) substitutes the hardcoded `https://mcp.soup.net` host in `docs/connectors/index.md` with the deployment's own `API_BASE` at render time — a no-op on the hosted deployment (API_BASE already equals that host in production), correct for self-hosters and local dev. `AgentTypePicker`'s own hardcoded MCP URL fixed the same way.
- **Papercuts**: `AppShell`'s mobile bottom nav relabeled from the sidebar's duplicate `aria-label="Main navigation"` to `"Mobile navigation"`. Recipe Map's tiny-corpus copy clarified via new `lib/map-scope-label.ts` (tested) — "0 clusters" reads as "not enough yet to cluster" instead of looking broken, and "Copy agent briefing (0)" uses total recipe count (and stays enabled) once there's at least one recipe, since the briefing fetch never actually depended on client-side clustering. Verified as already-fine, no change needed: copy-success feedback (every copy action already flips its button to "Copied!"); TanStack/React-Query devtools (already gated behind `import.meta.env.DEV`, so absent from `vite build` production output).
- **Explicitly skipped, reported not fixed**: verify-email auto-sign-in (`POST /auth/verify` returns no session/token — needs a backend change out of this batch's scope); zero-result check reassurance copy (backend `/check` copy, owned by the parallel FF-1 tree).

Recipe checks (soupnet-oss): `f19fd64c` (check-log grouping display-vs-log split), `cf8973f7` (default key-label wording), `289b3347` (Recipe Map tiny-corpus copy) — all confirmed against corpus precedent, no contradictions, proceeded.

## Legal and compliance

### 2026-05-12 — Public-ready trim pass on legal pages

Big-picture review of the 2026-05-09 publish. Removed self-imposed framing that doesn't serve a public-facing policy:

- Removed the "trusted-tier" banner and "Pending counsel review" sections from both `privacy-policy.md` and `terms-of-service.md`. Counsel-review checklist moved to `backlog.md` only — not surfaced in public-facing text.
- Dropped "sole proprietor" disclosure. Operator field is now just "Andy Forest, based in Canada" — leaves Dimentians Ltd or Steamlabs as later options without amending public text.
- Consolidated all public-facing emails to `admin@soup.net` (subject-line routing for abuse / deletion / privacy requests). Kept `security@soup.net` per security.txt convention.
- Softened specific numeric commitments ("30 days deletion response", "72-hour breach notification to users", "5-day security ack", "14-day terms-change notice", "CAD $100 liability floor", "30-day backup retention", etc.) to qualitative language ("without undue delay", "as required by applicable law", "by reasonable means").
- Replaced "in-app banner for 14 days" change-notification promise with "by reasonable means" — see `backlog.md` for the actual mechanism build-out.
- Age minimum unified to 18+ across the board (was 13+/16-EU). Removes COPPA exposure and parental-consent complexity.
- Dropped jurisdiction-specific disclaimers (CCPA scope statement, GDPR Article 27 representative discussion, Quebec Law 25 mention). Rights are extended universally without commenting on which laws apply.
- Replaced "group / group memberships" with "recipe book / recipe book memberships" — vocabulary alignment with the Group → Recipe Book rename.
- LICENSE trademark notice updated: `hello@` → `admin@`.

### 2026-05-09 — Privacy policy + terms of service live pages (initial publish)

Replaced the placeholder `/info/privacy` and `/info/terms` pages with content rendered from `docs/legal/privacy-policy.md` and `docs/legal/terms-of-service.md` (single source of truth via `react-markdown` + Vite `?raw` imports). Cookie/localStorage notice added (one-time dismissable bottom banner). Marketing footer links to legal pages added on `LandingPage` and `HowItWorksPage`. LICENSE addendum added covering Soup.net name, logo, and visual design as reserved trademarks excluded from the MIT grant. Initial publish used a trusted-tier framing that was rolled back in the 2026-05-12 trim pass above.
