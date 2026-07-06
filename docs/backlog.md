# Backlog

The shared backlog for Soup.net. Tracks pending work across multiple AI agent sessions per the workflow described in `CLAUDE.md`.

**Tags:**
- `[IMPL]` — implementation work, well-defined
- `[DESIGN]` — needs design thinking before implementation
- `[DECISION NEEDED]` — needs an explicit operator decision

When you complete an item, move it to `backlog-completed.md` with a date stamp. Strike-through (`~~text~~`) sub-items as you finish them.

---

## Infrastructure

### `[IMPL]` Parameterize the CI-mirror postgres port for parallel sessions

`scripts/test-ci-local.mjs` + `docker-compose.ci.yml` hardcode host port 5534, so two sessions on one machine cannot run `npm run test:ci` concurrently — observed 2026-07-06 when the premium-llm worktree's gate failed at container startup (`Bind for 0.0.0.0:5534 failed`) while the main checkout's suite held the port. A `TESTCI_PGPORT` env (default 5534) threaded through the compose port mapping and the script's connection env would let parallel worktree sessions gate independently. Leave `.github/workflows/ci.yml` untouched — the collision is a local-parallelism problem only.

### `[IMPL]` LiteLLM router for per-user LLM quota tracking (deferred by design)

Operator decision (2026-07-06, with the premium-LLM-features brief in `docs/planning/premium-llm-features.md`): the first server-side LLM features ship WITHOUT quota/rate tracking because the user base is the operator plus manually-assigned trusted users. When premium widens, deploy a LiteLLM router/proxy in front of the provider key for per-user quota, spend tracking, and model routing — rather than hand-rolling quota in the app. Until then, implementing agents must NOT build ad-hoc quota logic into LLM features.

---

## Data portability

### `[IMPL]` Corpus import — the inverse of `/auth/me/export`

Operator request (2026-07-06, benchmark session): the export function already produces a complete single-JSON corpus (traces, evidence, references, groups; schemaVersion-stamped), and the PERMA benchmark run archived a 40,822-trace corpus that way (`SoupNet-evals/evals/perma-ab/baselines/run-full1/corpus-export.json.gz`, 20 MB gz) — but there is no way to load an export into an instance. An import endpoint/CLI would let (a) anyone reproduce the published benchmark results (`docs/benchmarks.md`) without re-spending ~$35 of scribe LLM calls, (b) users migrate between hosted and self-hosted, (c) operators treat the export as a restore format. Design points: idempotency (re-import must not duplicate — trace ids are UUIDs, upsert on id); ownership remap (imported rows belong to the importing user; group slugs may collide → suffix or map); **embeddings** — the export carries no vectors, so import must enqueue re-embedding (~$1/40k recipes via Gemini); consider an optional `vector_cache` sidecar in export/import to make reproduction zero-API-cost; `schemaVersion` gate with explicit migration path; and the prompt-injection posture of imported content (imported traces are third-party text entering briefings — same review consideration as shared books). Benchmark reproduction is the first concrete consumer.

---

## Evidence ingestion

### `[DESIGN]` Support multiple references per one interpretation in `parseEvidenceMarkdown`

`parseEvidenceMarkdown` (`apps/backend/src/services/evidence-parser.ts`) and its `EvidenceEntry` shape carry a single `quote`/`source` per entry, and `insertEvidenceEntries` creates exactly one reference per entry — even though the DB model (`evidence_references` N:N) already supports many references per evidence. The 2026-05-31 folding fix (orphaned citation block folds back into the preceding interpretation) handles the dominant case — one interpretation, one quote — but when an author writes one interpretation followed by *two* `> quote` / `-- source` blocks, only the first folds in; the second stays a standalone "(no interpretation)" entry rather than attaching as a second reference to the same interpretation. To fully support it, `EvidenceEntry` would need a `references[]` array and the insert path would create N reference rows + N `evidence_references` links per entry. Deferred as a smaller graceful-degradation case; the conservative fold preserves the reference (no data loss) rather than dropping or clobbering it.

### `[IMPL]` Repair historical fragmented-evidence traces

Traces checked before the 2026-05-31 folding fix that hit the blank-line-fragmentation bug are stored as separate interpretation-only and `(no interpretation)` citation rows (e.g. trace `a2c8fb64-d0bd-4d65-9248-4a4a8c727650`). The parser fix is forward-only — it doesn't touch already-stored rows. A one-off data migration could re-fold these: find evidence rows with content `(no interpretation)` that are linked to a reference and adjacent (same trace, same `created_at`) to an interpretation-only evidence row with no reference, then merge. Low priority — cosmetic on the trace-detail page, no functional impact. Scope first: query how many traces are actually affected before writing the migration.

---

## Agent briefing

### `[IMPL]` Client-side scribe — session-distillation skill + briefing section

From the premium-LLM brief (`docs/planning/premium-llm-features.md` §Feature 2, operator-approved 2026-07-06): the scribe (distilling a session into evidence-backed recipes) stays **client-side** — the client's LLM already has the session in context (no transcript upload, no privacy expansion, no server cost), matching the stigmergy story. Deliverables: (a) a published Claude Code skill / SessionEnd hook that runs the scribe prompt with the client's own model and submits via `check_recipe`; (b) an equivalent instructions section in the agent briefing for Codex/other MCP clients — briefing copy, so it waits for the regression-spec gate like other briefing edits; adherence measurable with the behavioral-specs harness. Benchmark validation: 39,528 recipes at 0.58% verbatim-quote failure (trace `2093a9e0`). The server-side variant ("transcript import" — user uploads a conversation export, server scribes it into a chosen book) is design-stage only, a companion to the corpus-import item under Data portability.

### `[IMPL]` Briefing regression testing — behavioral specs (design done; build phases 1–2)

Design doc (rough-notes fidelity until promoted): [docs/rough-notes/2026-06-10/briefing-regression-testing.md](rough-notes/2026-06-10/briefing-regression-testing.md) (2026-06-10; expanded same day per operator feedback). Gherkin-style behavioral specs (Given persona / When trigger / Then observable assertions), LLM-judge scoring, and a declared-intent regression rule: briefing-touching PRs state which scenarios they mean to move and show all others holding — the guard against the over-correction pattern. Builds on `recipe-examples.json` failure modes, `scripts/qa-agent-understanding.ts`, and the agent archetypes as personas. The 2026-06-10 expansion added: **scenario-corpus expansion** (coverage matrix over human/agent archetypes × domains × both-sides-of-success; mining the operator's real recipe books PII-scrubbed with an operator interview loop — operator approved); **Track 2 wired to the existing multi-strategy embedding pipeline** (`packages/domain/src/embedding-strategies.ts` — per-strategy matched-pair scoring of both authoring hypotheses and the `exp_*` preamble variants, with graduation into the search path as a deliverable); **Track 3 whole-transcript analysis** (fixed best-practice rubric spine + LLM-generated per-transcript extension; client-side only for privacy); and a paste-ready [transcript-mining briefing](rough-notes/2026-06-10/transcript-mining-briefing.md) for live Claude Code sessions. Phases 1 (encode `.feature` files) and 2 (scenario corpus) are pure writing and immediately useful.

### `[DESIGN]` Agent-first knowledge base + agent-suggested improvements (idea stage)

Operator direction (2026-06-10), captured in [docs/rough-notes/2026-06-10/agent-first-knowledge-base.md](rough-notes/2026-06-10/agent-first-knowledge-base.md): Track-2 retrieval findings distill into a knowledge base of authoring nuances; KB entries are agent-first (Gherkin + recipe format); the briefing injects the few entries semantically nearest the user's recipe books (existing similarity subsystems — zero server LLM); and end users' AI agents suggest KB entries / system improvements via **synthetic demonstrations** so human developers never look at end-user data. Security note from the rough pass: published KB entries are instructions inside other users' briefings — community suggestions are a prompt-injection vector by construction and need a human review gate plus the security workflow before any design lands.

### `[IMPL]` Reasoning-window emphasis pass on briefing + tool descriptions — AFTER regression phase 1

design-thinking.md §The Reasoning-Trace Gap (2026-06-10): reasoning models discard hidden deliberation after each turn, so the judgment-call moment is the only checking moment inside the reasoning window — checks deferred to session end lose the warrant. Audit briefing copy + `check_recipe` tool descriptions for anything that makes mid-work checking feel heavyweight, and weight the "facing a judgment call" moment accordingly. Deliberately sequenced after the regression harness exists, so this edit is the first one made under the declared-intent rule rather than another over-correction.

### `[IMPL]` Retrieval API follow-ups (WT-3 shipped 2026-07-05: `get_recipes` + `GET /recipes`, briefing `purpose`/`recipe_ids`, `/traces/:id` SPA redirect)

The WT-3 tree of [docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md](rough-notes/2026-07-05/next-improvements-worktree-plan.md) landed the by-id lookup (batch ≤20, key read-scope ACL, uniform `not_found_or_unreadable` markers) across REST + both MCP surfaces, plus briefing tailoring params. Remaining follow-ups:

- **Slimming levers stay sequenced behind WT-5 phase-1 specs** (per the plan): top-N evidence per exemplar with a `get_recipes` pointer, briefing `max_chars`, and the `exemplarCount: 0` fresh-book bug.
- **Contracts/OpenAPI entry for `GET /recipes`** — validates inline like the other post-pivot routes; fold into the existing contracts-consolidation item.
- **Briefing copy pointer** — the briefing text doesn't yet mention `get_recipes`/`purpose` outside the tool descriptions and the sections that render when the params are used; a one-line mention in "How to check" is a briefing-content edit, so it waits for the regression-spec gate like other briefing copy.
- **Rate-limit note for the fresh audit** (plan §7): `/recipes` uses an in-memory 600/h per-credential cap + 1000/h per-IP (documented in `apps/backend/src/routes/recipes.ts` header); MCP `get_recipes` rides the F43 per-bearer backstop. The pending audit should confirm this is sufficient for an IDOR-class read surface.

### `[IMPL]` Flag drift between briefing voice rules and `bootstrap-your-corpus.md`

`apps/backend/public/docs/bootstrap-your-corpus.md` restates voice/format guidance in compressed form ("recipes are written in MY voice with a transferable role, not yours and not my name, and not duplicating context the group description already provides"). When the canonical `ROLE_PATTERNS` in `packages/domain/src/recipe-guide-content.ts` changes, this restatement can drift silently. Either (a) refactor bootstrap to import the canonical guidance, (b) shorten it to a one-line pointer at the canonical text, or (c) add a comment on `ROLE_PATTERNS` reminding maintainers to grep bootstrap-your-corpus.md after edits.

---

## Legal and compliance

### `[IMPL]` Change-notification mechanism

The privacy policy and ToS both promise "we will notify you by reasonable means before the change takes effect" for material changes. No actual notification feature is built yet. Pick a mechanism (in-app banner on next sign-in, dashboard message, email blast via SES, or some combination) and implement it before relying on the promise.

Implementation sketch (in-app banner option):
- New table `system_announcements` (id, body, starts_at, ends_at, dismiss_token).
- Settings record per user tracking dismissed announcement IDs.
- AppShell mounts an `<AnnouncementBanner />` if there are active announcements not dismissed by the current user.
- Admin route to publish a new announcement.

### `[DECISION NEEDED]` Counsel review pre-public-scaling

Items to put in front of a Canadian lawyer before signups grow materially. None of these are surfaced in the live policy text any more — the policy reads as confident public content — but they remain on the operator's checklist:

- PIPEDA compliance pass.
- GDPR / UK GDPR exposure assessment given worldwide user reach (including Article 27 representative question).
- CCPA / CPRA applicability assessment.
- Bespoke AWS and Google Cloud DPAs (currently relying on each provider's standard customer agreements).
- ToS Section 10 (limitation of liability) under Ontario law.
- ToS Section 11 (indemnification) enforceability and scope.
- ToS Section 13 (governing law) and consumer-protection carve-outs (Quebec, EU consumer rights).
- Whether listing a postal mail address is jurisdictionally required.
- Whether to operate Soup.net under Andy personally vs Dimentians Ltd vs Steamlabs (income/liability tradeoffs). The current policy says "operated by Andy Forest, based in Canada" — deliberately silent on legal form so this choice stays open.

### `[IMPL]` Verify privacy policy claims match implementation

The privacy policy describes a few behaviors qualitatively that should still match reality. Confirm or update implementation. Partial findings from the 2026-06-11 production-readiness pass (post-SES-approval):

- Section 2.3 / 8: uploaded files cached for a "limited period" then deleted. **MISMATCH confirmed** — `packages/db/src/schema/uploads.ts` documents "Retention: no TTL column today"; bytes are content-addressed on disk via `file-store.ts` with no sweep. Files are deleted on account deletion only. Either build the retention sweep the schema comment sketches (expired api_key_id + content_hash unreferenced by any references row), or soften the policy wording.
- Section 2.5 / 8: audit-log entries (incl. IP + user agent) "retained for a limited period, then deleted." **MISMATCH confirmed** — no `DELETE FROM claimnet.audit_log` exists anywhere; the table is append-only with no retention job. Same choice: build the sweep or fix the wording. Note F29 per-key rate limiting counts on audit_log, so a sweep must keep ≥24h.
- Section 9: content security policy + rate limiting **verified in-repo** (headers in `apps/backend/src/index.ts`, `middleware/rate-limit.ts`). Encryption at rest + private-subnet database: infra-side, verify on the production stack (operator).
- Section 6: AWS regions in the United States. Verify the live deployment matches (operator).

---

## Launch readiness

### `[DESIGN]` Concierge chatbot + setup wizard for the new-user journey

Operator idea (2026-06-10): the dashboard is crowded for a new user, and Soup.net's whole thesis is zero-effort — so the new-user journey should feel like a chatbot, not a console. A very light in-browser concierge (candidate tech: Chrome 148's Prompt API / built-in Gemini Nano — free, no server LLM cost, consistent with the cheap-math architecture) that does everything essential conversationally. It could open with a **"here's your briefing for all your agents" button before the user says anything** — the "you're already done" moment — then offer optional help: add context about what you're working on, set up recipe books, invite people. A non-LLM setup wizard is the fallback shape if the Prompt API's availability/quality disappoints (it's Chrome-only and new). Relates to "Onboarding polish for first session" below — this may be the form that polish takes.

### `[DESIGN]` Side-nav regrouping (rule of 7) + landing reachability

The signed-in nav has 8 top-level items (9 with Admin). Operator direction (2026-06-10): apply the rule of 7 — group the explainer pages (How it works, Connect to AI — plus the landing page itself and the footer's Privacy/Terms) into a single "About"/"Learn" group so the whole tree is in the nav, including footer-only pages. Admin stays an 8th top-level for the few who see it. Related finding: typing soup.net and landing on the login page is **not a routing bug** — `/` always renders the landing page (routeTree.ts, index route has no guard); it's browser-history autocomplete plus the 401-expired-JWT redirect. But it surfaced a real gap: signed-in users have no obvious nav path to the landing page except the logo. The regrouping fixes that by making the landing page a nav item inside the new group.

### `[IMPL]` Landing composition Option A — decided 2026-06-10; ship as art arrives

Decision (operator, 2026-06-10): **Option A** from [docs/rough-notes/2026-06-10/landing-page-content-options.md](rough-notes/2026-06-10/landing-page-content-options.md), plus: the challenge section's static check-log mock is **rejected** (too technical for humans as the first thing) — an illustration replaces it. Implementation sequence:

1. **When Brief 1 v2 art arrives** ([image-brief-1-v2](rough-notes/2026-06-10/image-brief-1-v2-judgment-hub.md), "the judgment hub" — v1's "unattended hours" art was delivered as `illustration-agent-alone.png` but not used: no human in frame, and the away-while-it-works premise dates as agents compress wall-clock time; kept as palette reference): replace `CheckLogMock` in the challenge section with the new illustration + caption "Three threads of work — and one place your judgment lives: you."
2. ~~Move Pillar 2's image to `illustration-shared-book.png` (the resolved-puzzle composition); Step "+" goes text-only until Brief 3 art arrives. Fix Pillar 2's alt text either way.~~ Done 2026-06-10 — Pillar 2 now carries shared-book with corrected alt + positive caption; Step "+" is text-only.
3. **When Brief 2 art arrives** ([image-brief-2](rough-notes/2026-06-10/image-brief-2-one-constellation-every-device.md), "one constellation, every device" — written 2026-06-10, deliberate resolution-pair of the judgment-hub image): swap it into Pillar 1 with caption "One recipe book — every agent you use draws from it, whatever tool it lives in."; retire the robot image (`illustration-blank-slate.png` leaves the page).
4. **When Brief 3 art arrives** (Step "+", AI-maturity variant — brief not yet written): restore the "+" panel illustration.
5. ~~Same pass: CTA/copy touch-ups — compounding agency line (recipe `90f87ce6`).~~ Done 2026-06-10 — CTA heading is now "Your judgment is what makes your agents good. Use it — productivity and agency rise together."; challenge copy carries the scarce-resource unifier (`893660af`) and compression-durable METR framing (`ed6f17f3`). "This happened to you?" hooks remain optional/unused.

Sub-item 1 also done 2026-06-10: `illustration-judgement-hub.png` shipped into the challenge section with the planned caption; the `CheckLogMock` component was removed.

Visual grammar rules now in the corpus for all future art: bowl = solution-only motif (`d9f8142e`), warm recognition not fear (`a08dfaa8`), glowing figure is the canonical agent rendering (`2e7ee32c`).

### `[DESIGN]` Onboarding polish for first session

Carried over from the controlled-invite-first sequencing decision (2026-04-09). Polish the first 30 seconds of a new user's experience: invitation email body, post-verify dashboard state, recipe-check first-success.

### `[DESIGN]` Clean up the HowItWorks page after landing-page expansion

The landing page now carries a substantial "How a recipe check works" walkthrough section (three steps, expandable Q&A, three solution illustrations) that overlaps with several sections of `/info/how-it-works`. Likely-stale or duplicated areas on the HowItWorks page:

- "How agents connect" (three-row MCP / Web chatbots / Custom split) — partially echoed by the walkthrough's Step 1 expanders.
- "A self-organizing knowledge graph" + recipe-format depth — adjacent to the walkthrough's "What's actually in the briefing?" and "How does the agent phrase a recipe check?" answers.
- The page's intro framing — written before the landing page absorbed any walkthrough content; the landing page's new section may have stolen the deep-version's narrative lead.

Goals for the cleanup pass: cut what's duplicated, sharpen what HowItWorks uniquely covers (Recipe Map / concept-axis projection / "How we keep it free at scale" / "Built to trust" / algorithms-and-research-lineage), and make the page feel like the *deeper* version of what the landing page now teaches — not a competing teach. Also verify nothing on HowItWorks contradicts the landing-page framing (cross-vendor moat, Archetype 5, vendor-memory distinction, "taste and judgment" always paired, no "team"-as-framing where the broader collaborator unit is meant).

---

## Directory submission (Anthropic connectors directory)

Foundation shipped 2026-05-14 (`a46636c`–`9c231ca`): OAuth 2.1 schema + metadata + DCR + authorize/grant + token/refresh + consent screen + MCP tool annotations + Origin-header validation + self-serve deletion. The non-code prep below is what remains before submitting.

### `[IMPL]` Manual end-to-end test against real claude.ai

Add Soup.net at `https://mcp.soup.net/mcp` via claude.ai's **Settings → Connectors → Add custom connector** against the deployed stack. Walk the full flow: OAuth redirect to `/oauth/authorize`, sign in, recipe-book scope picker, authorize, bounce back to claude.ai. Then exercise each of the three tools in a conversation. Expected to "just work" given the integration-test coverage, but real claude.ai may surface UX quirks (text wrapping in the consent screen, claude.ai's annotation display, refresh-on-stale-token behavior) that the test suite can't catch.

### `[IMPL]` Connector branding assets

- ~~Square logo on transparent background~~ — `apps/frontend/src/assets/soupnet-logo-square.png` (1322×1322, transparent). The wordmark is small relative to the canvas at directory-listing sizes (~64–128px). Consider a tighter icon-only mark for small displays before submission.
- Favicon already exists (`apps/frontend/src/assets/favicon-192x192.png`); verify it renders cleanly in browser tab + bookmark previews.
- For an MCP App listing with carousel screenshots (3–5 PNGs, ≥1000px wide, app response only with prompt text): `npm run screenshot` already captures `/info/connect` and the user-dashboard routes. Run against a populated dev stack, crop to the carousel template, choose the 3–5 that best tell the connector story.

### `[IMPL]` Submit to the connectors directory

Fill out the form at `claude.com/docs/connectors/building/submission` once branding is finalized:
- Privacy policy URL: `https://www.soup.net/info/privacy` ✓
- Public documentation URL: `https://www.soup.net/info/connect` ✓ (multi-client; Claude listed first for directory review. `/info/claude-connector` 308-redirects here.)
- Test account with sample data: provision a `directory-review@soup.net` account with 3-5 example recipes spread across one personal book.
- Logo, favicon, screenshots (see above).
- Tool annotations (already shipped — `f9a35d5`).

Common rejection reasons to double-check before submitting: missing tool annotations (30% of rejections), OAuth callback URL allowlist missing `claude.com` variant, incomplete privacy policy, server still in beta.

---

## OAuth follow-ups

### `[IMPL]` Rate-limit `/oauth/token` and `/oauth/authorize/grant`

`POST /oauth/register` is rate-limited (30/hour per IP via `registerRateLimit`). `/oauth/token` and `/oauth/authorize/grant` are not. The downstream guards already require a valid `client_secret` or JWT respectively, so the practical exposure is small, but consistent rate limits across the OAuth surface make the surface easier to reason about and harden in case any of the upstream guards weaken.

### `[DESIGN]` Consent-screen design-system polish

`OAuthAuthorizePage.tsx` currently uses inline styles (matching the LegalPage pattern). It's functional but doesn't feel like the rest of the app — borrowed from the agent-facing pages rather than the dashboard's visual language. Replace inline styles with the design-system tokens used by `ApiKeysPage` (the table layout there is the closest sibling).

### `[IMPL]` Ownership transfer for shared organizations

`DELETE /auth/me` 409s if the user owns a non-personal organization with other members (`owned_shared_orgs_exist`). There's currently no in-app way to transfer ownership — the user has to email admin for help. Add a transfer-ownership UI on the recipe-book page so owners can hand off to another admin/member before deleting. Until this ships, the deletion guard's error message points to admin-assisted transfer.

### `[DESIGN]` Write ADR-0022 for the OAuth 2.1 connector flow

`apps/backend/src/routes/oauth.ts:9` references "ADR-pending" — the implementation is complete (DCR → consent → auth code → token/refresh) but the design rationale isn't recorded. Capture: the access token *is* an `api_keys` row (`key_type='oauth'`, 1h TTL, 30d refresh) rather than a separate token store; the coarse `read`/`write` scope string vs. the structured per-book `read_group_ids`/`write_group_ids`/`default_write_group_id` columns (per-book granularity deliberately kept out of the OAuth `scope` param); PKCE-S256 mandatory; exact redirect-URI match (F44); refresh rotation with TOCTOU defense (F38) — since 2026-07-06 the consumption marker is a dedicated `consumed_at` column (migration 0028) with an atomic `UPDATE ... WHERE consumed_at IS NULL` compare-and-swap, and rotation deliberately revokes the old access token by truncating its `expires_at` to the epoch sentinel (policy: a stolen access token dies with its bundle; mechanism keeps mixed-version deploys race-free — see `refreshOAuthTokenBundle`'s header comment and recipe efeaab7a).


## How to use this file

1. Before starting work: scan for items in your area. Look for context, dependencies, conflicting in-flight work.
2. After completing work: cut the item from this file; paste into `backlog-completed.md` with date stamp; strike sub-items if a multi-part item is partially done.
3. New work discovered: add to the relevant section here with the right tag. If you don't know the section, add it under "Unsorted" at the bottom.

This file is the way concurrent AI sessions coordinate without explicit messaging.

---

## Decision archaeology follow-ups

### `[IMPL]` Surface `decided_at` beyond the trace detail page

`decided_at` shipped 2026-06-10 (column, `/check` + MCP param, coalesced judgment date in search results, trace-detail "Decided … · logged …" display). Remaining surfaces that still show only `created_at` and may want the judgment date: the traces list pages (`/app/traces`, recipe-book traces), the Recipe Map tooltips, and briefing exemplars. Low urgency — agents already see the coalesced date in check results, which is the surface that matters for alignment.

### `[DESIGN]` Temporal decay should decay from the judgment date

When stigmergic decay lands (search-algorithms.md §Stigmergic Decay), weight recipes by `COALESCE(decided_at, created_at)`, not raw `created_at`, so backfilled decisions (decision archaeology, design-thinking.md) decay as old judgments rather than fresh ones. Noted here so the decay implementation doesn't have to rediscover it.

---

## Recipe-check latency (2026-07-01 measurement)

Source: [docs/rough-notes/2026-07-01/recipe-check-latency-findings.md](rough-notes/2026-07-01/recipe-check-latency-findings.md). Both waves landed 2026-07-01 (see backlog-completed): embed-call reduction (0.53s new / 0.11s duplicate locally), production-strategy search filter + no candidate LIMIT (recall un-capped), RETRIEVAL_DOCUMENT twins and `exp_trace_minimal` dropped + cleaned up (migration 0025), and Server-Timing/structured-log instrumentation. Remaining:

### `[IMPL]` Recipe Map follow-ups (core fix landed 2026-07-02)

The layout cache + read-time 768-dim MRL truncation shipped (see backlog-completed): local compute 2.08s → 0.84s, cached repeats 10ms, payload −34%. Remaining smaller levers if prod numbers still warrant them after deploy:
- Precompute layouts async (worker) into a coordinates table if the first uncached load still matters on the 0.25 vCPU task.
- Infra lever (flagged to the infra agent): the ECS task's 0.25 vCPU is the map's and check-burst's shared bottleneck — a bump is cheap and independent of the DB class.

*(The former "reintroduce ANN at ~10×" item here is superseded: the ANN path shipped 2026-07-02 as the ANN-first `hybridSearch` reshape — see backlog-completed.)*

---

## Eval + transcript-mining findings (2026-06-10)

Source detail: `docs/rough-notes/2026-06-10/scenario-mining-batch-1.md` (7 scenario candidates + 22-question operator interview batch, awaiting answers), the two `transcript-mining-report-*.md` files (self-audits from live sessions), and the SoupNet-evals ground-truth run record.

### `[IMPL]` Missing case-study file referenced by design-thinking.md

`docs/case-studies/chatgpt-divergent-design-checks.md` is linked from design-thinking.md §Divergent Recipe Checks but doesn't exist. Recover from the original transcript if it survives (it's the divergent-checks origin story — prime scenario source material), or fix the link.

### `[IMPL]` `/briefing` returns `exemplarCount: 0` for a book with one fresh trace

Observed seconds after a successful check with sync embedding enabled. Exemplar selection may require k>1 traces or an async pipeline step. Investigate; a briefing that omits a book's only recipe undercuts the copy-paste priming flow for new/small books.

### `[IMPL]` Decision archaeology pass on our own design docs

The check-log-mock rejection (landing session) was predicted verbatim by documentation prose (the "JSON is technical and scary" quote) that no check could retrieve because it was never a recipe. Run archaeology over design-thinking.md + backlog-completed with `decided_at`, so the project's own design lessons become retrievable.

---

## Next-improvements batch (2026-07-05 work-tree plan)

**Shipped 2026-07-05** — all five trees implemented, merged, and verified; see backlog-completed.md and [docs/rough-notes/2026-07-05/qualitative-eval-findings.md](rough-notes/2026-07-05/qualitative-eval-findings.md). Fast-follow round shipped 2026-07-05 (FF-1 check-surface hardening, FF-2 journey polish, FF-3 briefing copy under declared-intent — see backlog-completed.md). Remaining follow-ups:

### `[IMPL]` Verify-email auto-sign-in

`POST /auth/verify` returns `{ id, email, waitlisted }` only — no session/token — so the frontend can't auto-sign-in a user straight from the verify link today (FF-2 checked this and skipped rather than fabricate a session client-side). Needs a backend decision: either have `/auth/verify` mint and return a JWT on success (mirroring the register→login split's security reasoning — worth checking whether auto-login-on-verify reopens anything F30-adjacent), or keep verify session-less and instead speed up the post-verify "Sign In" click (e.g. pre-fill the email on the login form via a query param).

### `[IMPL]` Zero-result check reassurance copy

Backend `/check` response copy for a new/thin recipe book returning zero results — owned by the parallel FF-1 tree (backend `/check` + `/mcp` surface), not this batch.

## Unsorted

### `[IMPL]` Audit the /docs pages' ?key= prefill under the no-raw-keys-outside-JWT invariant

The 2026-07-06 placeholder-mode change established the invariant (CI-enforced for briefing surfaces): raw API keys never appear in responses not gated by human-only JWT auth, and no longer transit request URLs on the briefing path. The /docs pages (`/docs/mcp-setup?key=`, `/docs/recipe-check-guide?key=`) and the `/check?key=` page itself are the same class — a raw key in a URL echoed into rendered HTML. The web key-in-URL flow is load-bearing by design (web-only agents), so this is an audit-and-decide, not a mechanical port: which echoes are essential to that flow, which can go placeholder, and whether the key-in-URL design itself gets revisited. Note: briefings now link to `/docs/mcp-setup?key=YOUR_API_KEY`, so post-substitution artifacts exercise the prefill path with a real key.

### `[IMPL]` Parameterize the local CI-gate port/project so parallel sessions can gate concurrently

Found 2026-07-06: two Claude sessions running `npm run test:ci` simultaneously collide — the harness hardcodes host port 5534 and a fixed compose project, so the second run fails with "Bind for 0.0.0.0:5534: port is already allocated" (observed against the premium-llm session's gate). Fix in `scripts/test-ci-local.mjs` + `docker-compose.ci.yml`: derive the host port and compose project name from an env override (e.g. `CI_PG_PORT`, default 5534) or a session-unique suffix, and pass the resolved port through to the backend's `PGPORT`. Local-only change — GitHub CI runs in isolated runners, so the ci.yml mirror rule isn't implicated as long as env parity for the app under test is preserved. Until fixed: sessions serialize gates by watching for `*-postgres-ci-1` containers.



### `[IMPL]` Fresh security audit (last general audit 2026-04-09; surface has grown)

~~Security audit documents missing from the repo~~ — resolved 2026-06-11: the audits live in the **private deployment repo's** `docs/security/` (confirmed by the observability survey). CLAUDE.md and `docs/workflows/security.md` now say so. Remaining work: the last general audit was 2026-04-09 and the route surface has grown substantially since (OAuth 2.1, /uploads, remote MCP, waitlist, email log, invite-status) — now that production is live behind real SES, run a fresh audit-agent scan. The operator runs this after the 2026-06-11 batch is committed, before push.

~~Audit prep~~ — done 2026-06-11: the private repo's `docs/security/` now has a `README.md` (location policy, two-repo audit scope, audit history — moved out of the public workflow doc) and `audit-prep-2026-06-11.md` (the readiness brief the audit agent starts from: baseline, fix-verification queue, new-surface focus areas, known leads, pre-audit checklist incl. a gitleaks history scan before push). `docs/workflows/security.md` updated for the two-repo scope. Remaining: run the audit itself (read-only audit agent, both repos).

### `[IMPL]` Admin side-nav missing on most admin pages

Found 2026-06-11 while investigating "the settings page isn't in the admin nav": `AdminLayout` (the side nav with Overview / Users / Signups / Emails / Queues / Embeddings) is only rendered by AdminUsersPage, AdminSignupsPage, and AdminEmailsPage. The Overview, Queues, and Embeddings pages use their own ad-hoc layouts with no side nav — so part of the admin console is only reachable from the Overview landing page's links. Wrap the remaining three pages in `AdminLayout` (Queues has its own inspector pane — AdminLayout already supports an `inspector` prop), and adopt the shared list-view primitives while in there: `useAdminGate` (access gate, replaces each page's hand-rolled meQuery + denied JSX) and `AdminPagination`, alongside the existing `AdminFilterBar`/`AdminTable`/`AdminMetricCard` pieces. The design intent (per the admin-pages recipe + engineering-principles §12): admin pages stay thin compositions of these primitives — shared design language without a mega list-view component, since each page's middle section differs (metric cards, inspector panes, explainers). Related: `GET /admin/invitations` no longer has a frontend consumer (the merged `/admin/waitlist` signup queue supersedes it); keep or fold into the queue view when touching this area.

### `[IMPL]` Audit-log event coverage beyond recipe.checked (F9 follow-up)

`claimnet.audit_log` only records `recipe.checked` plus a few point additions (`check.searched`, `group.description_updated`, and — since 2026-07-06 — `user.premium_set` from the admin premium toggle, a partial advance on the admin-actions gap). The F9 finding (2026-04-09 audit) calls for auth events (login success/fail, register, verify), API-key lifecycle (create/revoke), and admin actions (settings changes, invites, waitlist notify). Now that the email log covers the outbound-email surface (2026-06-11), audit_log is the remaining gap for security sweeps. Design note: keep writes through `writeAudit`, one event type per action, and mind that F29 per-key rate limiting queries this table — schema changes must keep that path fast.

### `[IMPL]` Waitlist: notify when a spot opens

The waitlist form promises "we'll email you when a spot opens up." Today that promise is fulfilled manually: the admin Settings page's per-row Invite button sends a cap-bypass invitation email via SES. Fine at cap≈5–50; if the waitlist grows past what manual triage handles, add batch-invite (top N oldest) and/or an automatic "spot opened" notification when the cap rises.

### `[IMPL]` Structural guarantee for email canonicalization (follow-up to the 2026-07-02 invite-case bugfix)

Emails are now canonicalized to lowercase at every write/lookup boundary (`apps/backend/src/lib/normalize-email.ts`) and migration 0026 lowercased pre-existing rows — that fixed invitations being invisible to users who registered with non-lowercase emails. The remaining gap is that the guarantee is code-discipline, not schema: a future code path that inserts a non-canonical email would reintroduce the class of bug. Options when touching this area: a unique index on `lower(email)` (blocks case-duplicates even from non-normalized paths) or a `CHECK (email = lower(email))` constraint (stronger — rejects any non-canonical write). Either needs the migration-0026 collision-guard caveat handled first: 0026 deliberately skips rows that differ only by case from an existing account, so verify no stragglers exist before adding a constraint (`SELECT email FROM claimnet.users WHERE email <> lower(email)`).

### `[IMPL]` Delete or revive `packages/client-sdk`

Discovered 2026-05-27 while drafting the workspace package map in `docs/architecture/overview.md`. `packages/client-sdk` is listed as a dependency by `apps/frontend` and `apps/mcp-server` but no source file outside its own internals imports `@soupnet/client-sdk`. The surface area still references pre-pivot endpoints (`/api/claims`, `/api/requests`, `/api/validations`) that the current Hono backend doesn't serve.

Two options:
- Delete the package and remove the two dead dependency declarations. Cleanest; matches "ruthless edits to docs that have drifted from reality" applied to code.
- Rewrite the SDK against the current `/check` / `/traces` / `/uploads` surface and actually consume it from one of the apps. Only worth it if there's a planned third consumer (e.g. a future CLI tool) that benefits from a typed REST wrapper distinct from the React Query hooks.

Recommendation: delete, on the principle that infrastructure without a consumer is a maintenance tax with no return.

### `[IMPL]` Wire `packages/api-client` into the frontend (or note it's deferred)

Discovered 2026-05-27 alongside the `client-sdk` finding. The Orval pipeline produces typed React Query hooks from the committed `openapi.json`, but no file in `apps/frontend/src/` imports `@soupnet/api-client`. The SPA fetches via hand-written hooks (`src/hooks/useTraces.ts` etc.) wrapping `authFetch`, with response types declared inline per hook.

The blocker is the contracts-consolidation work — until `/check`, `/traces`, `/uploads`, `/auth` are in `packages/contracts`, the generated client only describes the pre-pivot legacy surface, which isn't what the SPA calls. So sequencing is:

1. Consolidate new routes into `packages/contracts` (already noted in `docs/backlog.md` and in `type-safety.md` §"Where the chain is intentionally loose" #3).
2. Regenerate `openapi.json` + the Orval hooks.
3. Migrate `apps/frontend/src/hooks/*.ts` to import the generated hooks, deleting hand-written shapes (`interface Trace`, etc.).

Until step 3 ships, the headline claim in `docs/architecture/type-safety.md` ("type errors at one end of the stack surface at the other") is only true up to the package boundary on the frontend side. The doc is now honest about this; closing the gap is the work.
