# Backlog

The shared backlog for Soup.net. Tracks pending work across multiple AI agent sessions per the workflow described in `CLAUDE.md`.

**Tags:**
- `[IMPL]` — implementation work, well-defined
- `[DESIGN]` — needs design thinking before implementation
- `[DECISION NEEDED]` — needs an explicit operator decision

When you complete an item, move it to `backlog-completed.md` with a date stamp. Strike-through (`~~text~~`) sub-items as you finish them.

---

## Infrastructure

### `[IMPL]` LiteLLM router for per-user LLM quota tracking (deferred by design)

Operator decision (2026-07-06, with the premium-LLM-features brief in `docs/planning/premium-llm-features.md`): the first server-side LLM features ship WITHOUT quota/rate tracking because the user base is the operator plus manually-assigned trusted users. When premium widens, deploy a LiteLLM router/proxy in front of the provider key for per-user quota, spend tracking, and model routing — rather than hand-rolling quota in the app. Until then, implementing agents must NOT build ad-hoc quota logic into LLM features.

### `[IMPL]` Local / self-hosted embedding providers (keyless on-ramp)

Full build brief in `docs/planning/local-embedding-provider.md` (operator-approved 2026-07-08). Adds two `EMBEDDINGS_PROVIDER` values behind the existing seam so the three keyless personas (headless CI, self-hosters, tire-kickers) get working vector search without a Gemini key: `local` (in-process `@huggingface/transformers`, default `bge-small-en-v1.5`, for CI + tire-kickers) and `openai-compatible` (HTTP `/v1/embeddings` to llama.cpp / LM Studio / Ollama / TEI, for self-hosters wanting a SOTA model). Key design: zero-pad 384-dim vectors into the existing `halfvec(3072)` column (provably lossless for cosine) so Phase 1 needs no schema migration; the real work is decoupling the hardcoded `model_id` into `getEmbeddingModelId()` + a fail-safe `model_id` search filter. Runtime moves to `node:24-slim` for native `onnxruntime-node`. ~~Includes writing a new ADR (coordinate the number — 0022 is reserved for the OAuth connector flow).~~

Status (2026-07-08): ~~ADR written — [`docs/adr/0023-local-embedding-providers.md`](adr/0023-local-embedding-providers.md) (0022 left reserved for OAuth; used 0023). Records the two providers, the zero-pad-into-`halfvec(3072)` isometry + buffer-cache exit criterion, `model_id` decoupling, and the one-provider-per-deployment assumption; extends ADR-0005, supersedes nothing.~~ ~~Human-facing docs updated — `CLAUDE.md` embeddings bullet + README "Local / offline embeddings" section (llama.cpp / LM Studio / Ollama / TEI on-ramp, pointing to the ADR + planning doc).~~ Code slice landed in the working tree (other sessions, under review, not yet committed): provider seam branches + `local-client.ts` / `openai-client.ts`, `fitTo3072` (`dims.ts`) + tests, `getEmbeddingModelId()` + fail-safe `model_id` search filter, `node:24-slim` Dockerfile switch, and `.env.example` / `docker-compose.yml` wiring. Before moving this item to `backlog-completed.md`: run the full gate (`npm run test:ci`), verify the acceptance sketch end-to-end (planning doc §Acceptance), and confirm the CI-mirror sync (`.github/workflows/ci.yml` ↔ `scripts/test-ci-local.mjs`).

### ~~`[DECISION NEEDED]` Trim the hosted (gemini) Docker image after local-embeddings~~ (resolved 2026-07-08)

~~The local-embeddings implementation ships one provider-agnostic image, so the hosted gemini image grew ~150–320 MB for code it never runs.~~ **Resolved:** the Dockerfile now gates the optional-dep install and model bake behind `ARG EMBEDDINGS_LOCAL` (default `false`). The hosted deploy (`docker build`, no build-args) builds **lean** — `npm ci --omit=optional`, no bake — and gemini works with the package absent (dynamic import gated on provider + tsup `--external`). Self-hosters get the local-capable variant automatically via `docker compose` (which sets `EMBEDDINGS_LOCAL=true`). The slim base (vs Alpine) is retained — its ~50 MB is negligible next to the ML deps it enables, and it avoids musl/native-addon churn. The `local` semantic-similarity smoke test that was also scoped here is now built as the `local-embeddings-smoke` CI job (`local-client.smoke.test.ts`, real bge-small, not a deploy gate).

---

## Data portability

### `[IMPL]` Export omits `references.original_filename` and `region_meta`

Found 2026-07-12 while implementing import: the columns were added to `references` after `/auth/me/export` was written, so exports silently drop them and a round-trip loses file-attachment metadata (the audit trail viewers use to verify a recipe against their source copy). Add both to the export (additive — `schemaVersion` stays 1); import already passes unknown keys through its additive-tolerance gate.

### `[IMPL]` Bulk-import embedding drain rate + import status visibility

The worker sweep backfills ~200 traces/strategy/minute, so a 40k-trace import takes hours to full searchability. The import response reports `tracesPendingBackfill` and the admin workers page shows queue depth, but there is no per-import progress surface. Consider a bulk lane (batched import-side stubs for `full_document`) and/or a `GET /import/status`-style pending-vectors-per-book count. Follow-on from the 2026-07-12 corpus-import ship.

### `[DESIGN]` Keys minted before an import don't see the new book

API keys freeze their read scope at mint time, so a key created before an import cannot search the imported book — confusing exactly when a user imports then immediately asks their agent about it. Surface a "mint a fresh key" hint in the import response and/or dashboard. Found during 2026-07-12 import acceptance testing.

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
- Update (2026-07-12): the deletion-completeness reasoning is now real — `deleteUserCascade` (`apps/backend/src/services/user-delete.service.ts`) removes evidence/references/embedding rows on account deletion, and the false "embedding_sources are content-hashed" comment in auth.ts is corrected. Still open from Section 2.3: uploaded **bytes on disk** are not swept on deletion — only DB rows delete (content-addressed files in file-store.ts have no reverse index today).

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

## Data integrity and deletion

### `[DESIGN]` Foreign-key constraints — which, why, and which not

The schema deliberately left FKs loose during development (operator, 2026-07-09: *"I left it loose during development to make it easier to make changes without accidentally cascade-deleting on a rollback or something"*). Note the stated in-code reason for `traces`' missing FKs — "to break the circular dependency" (`traces.ts:25-26`) — is a **TypeScript import-cycle problem, not a database one**; the constraint can be added in raw migration SQL regardless.

**Migration hazard, read first:** migrations run at backend startup (`apps/backend/src/db.ts`), and a Drizzle-default `ADD CONSTRAINT ... FOREIGN KEY` validates existing rows immediately. **Orphans exist from pre-fix account deletions** (the leak itself was fixed 2026-07-12 on `fix/account-deletion-cascade`; `scripts/repair-orphaned-user-data.mjs` finds and removes historical orphans — the operator must run it against prod, dry-run first, before any FK constraint lands), so until that repair run completes, a naive constraint addition crash-loops the backend on boot. Safe shape: (1) add `NOT VALID` by hand-editing the generated migration — Drizzle won't emit it; (2) repair orphans out-of-band; (3) `VALIDATE CONSTRAINT` in a later migration, which takes only `SHARE UPDATE EXCLUSIVE` and can't wedge the app.

**Recommended:**
- `api_keys.user_id` → `users.id` **CASCADE**. Keys are meaningless without their user.
- `uploads.api_key_id` → `api_keys.id` **CASCADE**. `uploads.ts:11-14` already *states* this invariant ("when the key is revoked, every upload becomes unreachable — by design"); today it's aspirational. Chains under the above.
- `traces.user_id` → `users.id` and `traces.group_id` → `groups.id`, both **RESTRICT**. These would have caught the orphaning — but must *block* a raw delete rather than cascade, forcing the app through `deleteTraceCascade` so the embedding chain is cleaned.

**Recommended with care:**
- `traces.api_key_id` → `api_keys.id` **SET NULL** (column already nullable). Keys rotate daily and are deleted while traces live forever, so this FK fires constantly and permanently loses the which-key-wrote-this provenance. If that provenance matters, skip the FK and keep the soft pointer.
- Embedding-chain internal FKs: upgrade the existing `NO ACTION` FKs to **CASCADE** so `deleteEmbeddingChainForSource` can delete only `embedding_sources`. Validate it doesn't deadlock against an in-flight vectoring batch.
- `check_feedback.api_key_id` / `trace_evidence.api_key_id` / `trace_references.api_key_id` → **SET NULL**, which requires dropping their `NOT NULL`. Provenance columns, not ownership. Reasonable to skip.

**NOT recommended (recorded so they aren't re-proposed):**
- **`groups` → `traces` CASCADE.** In a shared book `traces.user_id` spans multiple users; a cascade would delete collaborators' recipes when one owner deletes the book, *and* bypass `deleteTraceCascade`, orphaning everyone's embeddings — the bug above, multiplied. Keep books RESTRICT; require an application-level teardown. (There is no "delete recipe book" route today; `groups.ts:488` only removes members.)
- **`embedding_sources.source_id` FK.** The column is polymorphic (`source_type ∈ trace|evidence|reference`). A single FK is impossible. Three nullable columns + CHECK gives real integrity but forces every query on the hottest read path (`vector-search.service.ts`) to branch across three columns; table-per-type multiplies the pipeline. Leave it FK-free and service-enforced; fix the leak in code instead.
- **`audit_log.*` FKs.** Append-only forensics whose rows deliberately outlive the actor. CASCADE erases the trail; RESTRICT blocks account deletion. Both defeat the table. It's also F29's rate-limit hot path — an FK check on every insert taxes it. The right-to-erasure tension is real and resolves as a retention/anonymization policy (null `actor_user_id`, redact `metadata.filter`), not an FK. Feeds the audit-log retention item under Legal and compliance.
- **`vector_cache` FKs.** No parent to reference; the cross-user cache sharing is the table's entire purpose. Correct as-is.

**Non-FK constraints worth encoding:** the text-enum columns (`check_feedback.kind`/`impact`/`disposition`/`story_fulfilled`, `users.role`, `api_keys.key_type`, `group_members.role`, `embedding_*.status`) are all "text + service-level validation" by explicit choice, with the invariant named only in comments. `CHECK (col IN (...))` is cheap and encodes them. Also: `traces.claim_text_hash` is nullable "for pre-existing data" but the idempotency unique constraint depends on it — NULL hashes silently opt out of dedup. Backfill, then tighten to `NOT NULL`.

**Also flagged:** `check.searched` audit rows store the user's raw search `filter` text in `metadata` (`trace.service.ts:700-704`), retained indefinitely. Free text the user typed. Include in the audit-log retention pass.

---

## Corpus curation and sharing

### `[DECISION NEEDED]` Read-only recipe-book sharing (corpus bootstrapping)

Operator idea, undecided (2026-07-09). Share a recipe book read-only with other users so their agents draw on your accumulated context while writing their own recipes into their own books. Motivating case, in the operator's words: *"I've made a lot of great recipes about sub-agent delegation decisions. I could share those with others to bootstrap their own corpus, and their agents can have my read-only context as they make their own decisions as recipe checks in their own recipe books."* Not approved — captured so in-flight work doesn't foreclose it.

**What the move-recipe work does now to keep this cheap later:**
- The destination-write check is an explicit role allowlist behind `canWriteToBook(role)`, never "a `group_members` row exists." A `viewer` role added later fails closed instead of silently gaining write rights.
- `trace-move.service.ts` is shaped so a future `copyTraceToBook` (fork) drops in beside it.

**What still needs deciding before it can ship:**
- **A `viewer` role on `group_members`** (item below). The asymmetry that makes this overdue: `api_keys` already splits read from write (`read_group_ids` / `write_group_ids`), and `group_members` even carries `daily_read` / `daily_write` flags (`groups.ts:72-73`) — but `group_members.role` is only `owner|admin|member`, all read+write. The split exists at the key layer and the daily-default layer, never at the membership layer.
- **Read-authorization needs its own predicate**, distinct from write. `/traces/:id`, `/traces`, and the map all authorize by joining `group_members` with no role test.
- **Feedback-row visibility.** Human-origin `check_feedback` rows (the re-filing notes) render on the trace detail page. A read-only subscriber would read the owner's correction notes — the same leak the declassification rule (`2738f7a9`) closes for evidence. Add a `visibility` column *before* rows accumulate; retrofitting after is expensive.
- **Prompt injection.** A shared book puts a stranger's recipe text into your agent's briefing. Same posture question as the corpus-import item (Data portability) and the agent-first KB item (Agent briefing) — solve once, in one place, not three times.
- **Account deletion.** `DELETE /auth/me` 409s on owned shared organizations with other members. Read-only subscribers widen what "shared" means; the guard must count subscribers, not just members. (Also: fix the PII leak above first — sharing multiplies its blast radius.)

### `[DESIGN]` Fork / copy a recipe into another recipe book

The actual bootstrap primitive behind read-only sharing: a reader who finds a useful recipe wants to build on it, not just read it. `copyTraceToBook` = the move transaction plus a new trace id, a `user_id` remap to the copier, `api_key_id = NULL`, copied (not relinked) evidence, and a re-embed enqueue. Two existing choices make it nearly free: `vector_cache` is content-hash-keyed and PII-free, so a forked recipe re-embeds at zero API cost, and `traces_api_key_group_claim_unique` already permits the same claim text in two books. Shares the ownership-remap problem with the corpus-import item — decide remap once for both. Not scheduled; no consumer until read-only sharing lands.

### `[DECISION NEEDED]` A `viewer` (read-only) role on `group_members`

`groups.ts:8-12` documents exactly three roles — `owner`, `admin`, `member` — and states `member` "can read/write traces within the group." Read-only sharing needs a fourth that reads but cannot write (or a `can_write boolean`, which composes better with the existing `daily_read`/`daily_write` machinery). Blocking dependency for read-only book sharing; harmless to defer until that's decided. Whoever adds it must audit every `group_members` join for role-blind authorization — there are several.

### `[IMPL]` Corpus-version key for the Recipe Map cache (hardening, not a live bug)

The map's layout cache derives a corpus-version key from `count(*)` and `max(created_at)` **aggregated across the union of the requested books** (`apps/backend/src/routes/traces.ts`). Aggregating over the union destroys per-book information: a trace moving *between* two books inside the union leaves both statistics unchanged.

**This was initially reported (2026-07-09) as a live staleness bug introduced by the move feature. It is not — corrected the same day.** The cacheable path is corpus mode, which selects through `fetchCorpusTraces` on `traces.group_id` (`search-pipeline.ts:219`), and `CorpusTrace` is `{id, claimText, createdAt}` — no book identity reaches a rendered node. The union therefore renders identically before and after an internal move, so the stale key serves a correct layout. A single-book map invalidates regardless, because that book's own count changes. The claim was made before checking whether the cached layout depended on what the fingerprint couldn't see.

~~The move-recipe work ships the per-book fingerprint (`GROUP BY group_id`, combined in stable order, plus `max(updated_at)`) as cheap insurance~~ — done 2026-07-09. It becomes load-bearing the moment the map colors or groups nodes by book, or a trace's claim text becomes editable in place. Both are plausible; neither exists today.

Still open: the structural piece. `traces.updated_at` is `defaultNow()` with no `ON UPDATE` trigger, so its freshness remains code discipline (the move sets it explicitly). A `moddatetime` trigger, or a `groups.corpus_version bigint` bumped by trigger, would make it a database guarantee.

The structural version, deferred here: **the database maintains no mutation timestamp and no version counter.** `traces.updated_at` is `defaultNow()` with no `ON UPDATE` trigger, so its freshness is code discipline — the third instance of that failure mode in this backlog (see also the email-canonicalization item and the account-deletion list above). Options: a `moddatetime` trigger making `updated_at` a database guarantee; or a `groups.corpus_version bigint` bumped by an `AFTER INSERT/UPDATE/DELETE` trigger on `traces`, giving an O(1) monotonic version instead of a statistical proxy — at the cost of row contention on `groups` under concurrent checks into one book (small at current volume; measure before adopting).

### `[IMPL]` Guarantee `embedding_sources.group_id` agrees with its trace's `group_id`

`embedding_sources.group_id` (`packages/db/src/schema/vectors.ts:100`) is an unenforced cache of the owning trace's `group_id`, and it — not `traces.group_id` — is what scopes every vector search (`vector-search.service.ts:153` for traces, `:374` for evidence). Nothing ties the two together: no FK, no trigger, no test. This is the landmine the move-recipe feature had to route around, and it will cause the next bug in this area. Either drop the column and join through `traces` (costs a join in the hot search predicate — presumably why it was denormalized), or keep it and add a CI drift query asserting the two agree for every trace and evidence source. Recommendation: keep, add the drift check, and document the column as a cache rather than a fact.

### `[DESIGN]` JWT-aware rendering on dual-use surfaces (consumer detection framework)

Operator direction, undecided (2026-07-09), arising from the move-recipe surface question. Surfaces should be classified by **consumer**, not protocol (recipe `668014c7`): the React SPA is human-only, `POST /mcp` is agent-only, and `/check` is **dual-use** — a web-only agent constructs a URL and hands it to the human to click, so both land on the same page. Andy: *"agents do not have access to the JWT token, but humans looking in the browser do. So we could consider checking if the JWT is also present and valid, and if so, then web UI for the human. That's the first time we'd do this, so we'd want a good framework for that for future ideas too."*

If built, `/check` (and other agent-page surfaces) would branch on credentials: API key only → the token-lean agent rendering that exists today; API key **plus** a valid JWT → a richer human UI, which could carry human-only affordances such as the move-recipe control. This closes a gap Andy named on 2026-03-31 and that is still open: *"The /check endpoint serves both humans and agents today but optimizes for neither. Humans need rich evidence visualization; agents need minimal tokens."* (recipe `0fe5774e`).

The framework already has a sibling worth reusing rather than reinventing: recipe `f1543441` established the structural invariant that raw API keys never appear outside human-only JWT auth, with the browser substituting the key it holds and **CI enforcing the property**. The same "JWT presence is the human boundary, machine-checked" shape applies here. Also related: the `/docs` `?key=` prefill audit item under Unsorted — same class of surface, same question.

Not blocking the move feature. Andy: *"The human can always move the recipe through their normal web ui on www.soup.net after all."* Defer unless a second dual-use consumer shows up, which is when the framework pays for itself rather than being speculative.

### Not recommended: an "undo move" affordance

Recorded so it isn't re-proposed. The `trace.moved` audit row already reconstructs the prior state, and a second move *is* the undo. An undo surface adds a mutation path and a fresh authorization question for no capability the user lacks.

---

## Unsorted

### `[IMPL]` **Operator: run `scripts/repair-orphaned-user-data.mjs` against prod**

The 2026-07-12 account-deletion fix stops the leak going forward; historical orphans from pre-fix deletions remain in prod. Run the script dry-run (default), review counts, then `--apply`. It iterates to a fixed point and has a 1-hour age guard. **The FK-constraints item is blocked on this run** — orphans fail a validating `ADD CONSTRAINT` at boot. Note: `check_feedback` rows whose `api_key_id` was orphaned by pre-fix deletions are permanently unattributable and the script cannot find them; PR #28's `actor_user_id` is the forward fix for human rows.

### `[IMPL]` Extend short-id prefixes beyond feedback `trace_id` (demand-gated)

The 2026-07-12 ship resolves short ids on `log_feedback` / `feedback` param / `POST /feedback` `trace_id` only. `related_trace_ids` stays full-UUID deliberately (capture-only lineage; resolving turns capture into validation). If agents hit the same friction on `known_recipes` / `recipe_ids` / `get_recipes`, extend with the same within-read-scope resolution. Only if demand appears.

### `[IMPL]` Extract a `useRecipeBooks()` hook

Four frontend pages (`GroupsPage`, `DashboardPage`, `ApiKeysPage`, `RecipeMapPage`) each fetch `authFetch("/recipe-books")` inline with locally-declared response types. ~~The move-recipe work adds the hook (`apps/frontend/src/hooks/useRecipeBooks.ts`) and uses it in the move modal~~ — done 2026-07-09. Migrating the existing four is the remaining mechanical pass. Related to the `packages/api-client` wiring item — if that pipeline is revived, this hook is one of the hand-written shapes it would replace.

### `[IMPL]` Audit the /docs pages' ?key= prefill under the no-raw-keys-outside-JWT invariant

The 2026-07-06 placeholder-mode change established the invariant (CI-enforced for briefing surfaces): raw API keys never appear in responses not gated by human-only JWT auth, and no longer transit request URLs on the briefing path. The /docs pages (`/docs/mcp-setup?key=`, `/docs/recipe-check-guide?key=`) and the `/check?key=` page itself are the same class — a raw key in a URL echoed into rendered HTML. The web key-in-URL flow is load-bearing by design (web-only agents), so this is an audit-and-decide, not a mechanical port: which echoes are essential to that flow, which can go placeholder, and whether the key-in-URL design itself gets revisited. Note: briefings now link to `/docs/mcp-setup?key=YOUR_API_KEY`, so post-substitution artifacts exercise the prefill path with a real key.

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

Note (2026-07-06, dep-remediation): `orval` was bumped `^7.0.0`→`^8.19.0` and the unused `@orval/msw@^6.20.0` dependency was removed (it carried a critical code-injection advisory with no v6 fix and was only referenced by a commented-out config block). The orval 8 major cleared the whole codegen advisory subtree (`@ibm-cloud/openapi-ruleset`, `@stoplight/spectral-*`, `lodash`, `js-yaml`). Whoever revives this pipeline should regenerate against orval 8's config API and re-add an MSW mock package matching the installed orval major if MSW handlers are wanted (see `orval.config.ts` comment).

### `[IMPL]` Deferred npm-audit findings after 2026-07-06 remediation

The 2026-07-06 dependency sweep took `npm audit` from 32 (12 critical / 9 high / 10 moderate / 1 low) to 8 (1 high / 7 moderate). What remains is deliberate, each with a documented upgrade path (per recipe `836786c6`):

- **nodemailer high — `raw`-option file-read/SSRF (GHSA-p6gq-j5cr-w38f).** Fix is a runtime semver-major (8→9.0.3). The three reachable CRLF/header-injection advisories were fixed by the non-major 8.0.11 bump; this residual advisory requires the message-level `raw` option, which `email.service.ts` never uses (templated `from/to/subject/text/html` only). Upgrade path: bump to nodemailer 9.x in its own change that exercises the email path (verification/reset/waitlist sends) against the v9 API.
- **drizzle-kit / esbuild / @esbuild-kit/* (4 moderate).** Dev-only (migration codegen). `npm audit`'s suggested "fix" is a nonsensical drizzle-kit 0.31→0.18 major downgrade that would break migrations; the esbuild advisory (GHSA-67mh-4wv8-2f99) only affects esbuild's dev server, which drizzle-kit doesn't expose. Accepted; re-check when drizzle-kit ships a patched esbuild.
- **storybook cluster — @storybook/addon-essentials, addon-actions, uuid<11.1.1 (3 moderate).** Dev-only (component dev tool, not shipped). Only fix is a @storybook/addon-essentials 8→7 major downgrade. Accepted; revisit on a deliberate Storybook major upgrade.
