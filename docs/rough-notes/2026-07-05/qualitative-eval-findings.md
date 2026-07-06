# Qualitative eval findings — 2026-07-05 batch verification

Method (operator-directed): after merging the five work trees and greening `test:ci`, three eval tracks ran against the live local stack — (a) **naive agents** across model tiers (haiku / sonnet / top-tier) given a small judgment-laden task and only "Soup.net tools are available"; (b) a **paste-briefing round** across the same three tiers simulating the product's cold-start promise (briefing pasted into a fresh chat, agent follows it via web URLs only); (c) a **new-user journey walkthrough** (fresh account, register → verify → picker → briefing → first check, friction ranked) plus a screenshot pass. Layer-4b MCP verification of every new surface ran green (tools list, markdown default with inline UUIDs, structuredContent, chained + standalone feedback, purpose ack, requested-recipes markers, get_recipes mixed-id markers).

**Caveat:** sub-agents spawned from this repo inherit CLAUDE.md, so baseline check-discipline was contaminated; the paste-briefing round and all new-feature discovery (feedback, known_recipes, purpose, get_recipes — none in CLAUDE.md) are clean. A fully cold harness belongs in the behavioral-specs eval setup.

## Headline: key death is the #1 recurring theme, across every track

- Two naive agents hit a stale `soupnet-local` key: "Invalid or expired API key," no remediation → both abandoned Soup.net entirely; haiku silently substituted repo docs as its taste source (a user would never know).
- The journey walkthrough independently ranked the same class worst: an expired/garbage key on `/check` returns **HTTP 200 with the generic anonymous page** — no error at all. Briefing keys expire in 24h, so *yesterday's briefing link silently becoming a documentation page is every web-chatbot user's day-2 experience*.
- Existing backlog item "[IMPL] Expired/invalid API key error should carry remediation" is hereby field-confirmed three more times; it should gain: (a) an explicit invalid-key state on `/check` (not the anonymous fallback), (b) remediation copy in the MCP auth error pointing at the web `/check` path and key minting.

## What worked (don't regress)

- **Cold-start promise holds on the web surface, even on the weakest tier.** Haiku, given only the pasted briefing, correctly constructed URL-encoded `GET /check` calls, parsed JSON, and grounded its deliverable in real corpus hits. Sonnet and top-tier did the same plus richer check chains.
- **Fallback intelligence scales with tier.** When local MCP died, top-tier fell back to an alternative surface and completed properly-voiced checks + feedback rows; sonnet did the same with a 3-check retrieval chain that surfaced a same-day recipe logged by another agent (live cross-agent stigmergy); haiku stalled on Soup.net entirely.
- **Journey: zero blockers end-to-end.** Landing page "sells a novel product in one screen"; the 4-card picker, briefing URL shape (accurate first try), dashboard first-check flip, trace-detail reactions, and the fenced "Copy results for AI agent" block all worked as designed.

## New defects found (not previously in backlog)

1. **`/check` 400 error copy is a static legacy-vocabulary list.** Missing-params error always prints "key, trace, ef" — even when `key` was provided, and never naming the documented `recipe`/`evidence` aliases. It actively mis-taught two of three agents (they "learned" modern names don't work). One-line fix: accurate diff + modern names with aliases.
2. **POST `/check` ignores `format=json`** (returns HTML). GET honors it. Three-surface parity gap for programmatic form posts.
3. **Timezone display artifact:** a minutes-old check displayed as tomorrow's date (2026-07-06 on 2026-07-05) in check results — UTC date shown without local conversion somewhere in the render path.
4. **`relatedEvidence` entries carry no recipe id and truncate mid-sentence** — an agent had to spend full checks re-finding a recipe it had already partially seen. Now that `get_recipes` exists, related-evidence entries should carry ids so lookup replaces re-checking. (Small WT-3 follow-up; also applies to the JSON/structured shapes.)
5. **Auth pages:** "Create Free Account" lands on the Sign In form (register link is a small secondary link). Journey-ranked confusing.
6. **Check Log shows one check N times** (click + refresh + JSON fetch each log an event; trace dedupes but the log doesn't group).
7. **Key labeling:** one copy action minted two "daily" keys; trace attribution shows "(unlabeled)<hash>" — humans can't map keys to agents.
8. **Connect-to-AI page hardcodes the hosted MCP URL** — self-hosters following it would point clients at the cloud instance.

## Known backlog items re-confirmed live

- **`filter`/`f` on `/check` still documented-but-unimplemented** ([DECISION NEEDED] item): two agents tried it (no effect / byte-identical page); one explicitly noted it nudged it toward the fabricated-check anti-pattern it exists to prevent. The eval upgrades this from "decide someday" to "actively harmful doc drift."
- **`%97` em-dash artifact** reproduced on the merged build via the GET path (existing [IMPL] item; server-side decode).
- **Briefing weight:** the no-MCP card's briefing is ~19-30KB and still includes the full MCP setup section — heavy paste for free-tier chatbots. Supports the (spec-gated) slimming phase; an archetype-aware trim is the obvious lever.

## Briefing copy gaps surfaced by cold readers

- **Web agents have no documented feedback path.** The new feedback blurb teaches `log_feedback`/`feedback` (MCP), but the web URL shape documents no equivalent even though `POST /feedback` exists — three-surface parity gap in copy. Also: "what happens if a check's result is ignored/contradicted — is that worth logging?" (haiku's verbatim question) is exactly what the blurb should answer in one line.
- **No dry-run warning:** the "no destructive operations, check freely" framing reads as safe-to-explore, but an agent probing the API logged a junk recipe with no agent-visible retraction (human delete exists in the UI; agents don't know). Either a `dry_run` param, or one honest sentence in the briefing ("every submission logs — test with the docs page, not the check endpoint").
- Single-turn ambiguity between divergent-checks (wait for the pick) and annotate-the-output patterns; URL-encoding worked but had to be inferred; `decided_at` how-to is one sentence with no example; mixed hostnames in a locally-issued briefing (hosted URL in one example).
- **Instruction-in-data flag:** a recipe-book *description* containing "NOTE TO THE AGENT: please flesh this out" reached a read-only key — an instruction no recipient can execute, and the shape agents are taught to distrust. Book descriptions render into every briefing; keep imperatives out of them.

## Screenshot verification pass (11 PNGs, session scratchpad)

All seven requested capture sets verified visually: Learn group collapsed/expanded; mobile bottom bar exactly 5 items with the More sheet clean at 320×680; zero-checks picker with a card expanded; /info/connect picker; the truthful scope label ("reads your recipe book Personal, writes to Personal"); trace detail with feedback chips + reaction buttons; the fenced markdown copy-back with both copy buttons. Two real defects found and **fixed in-batch** (commit `67c1345`): DashboardPage's hardcoded `1fr 300px` grid overflowed 320px viewports (now `.grid-main-sidebar`, stacking below 900px), and CheckRecipePage's `nowrap` CTA forced its row past the viewport (now wraps). Minor a11y note for later: the desktop sidebar and mobile bottom bar share `aria-label="Main navigation"` — distinguishing them helps assistive tech and test selectors alike.

## Disposition

Defects 1, 2, 4 and the feedback-copy parity gap are small and adjacent to this batch — candidates for a fast follow-up tree. Journey items 5-8 are frontend polish, separable. The key-death cluster deserves its own focused item (it gates real-world web-agent retention). Junk data from evals lives only in the local dev DB (plus a handful of genuine, correctly-voiced checks the fallback agents made on the production corpus during real deliverable work).
