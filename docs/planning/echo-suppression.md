# Echo-suppression retrieval ranking

> **SUPERSEDED AND RETIRED (2026-07-17, never enabled in production).** The demotion mechanism this document designed was removed by operator ruling: ranking must be a pure function of the check's explicit inputs (a demoted recipe is indistinguishable from a deleted one), the same-api-key authorship signal conflates a fleet's sibling sub-agents with echoes, and the "self-pollution" it targeted is reclassified as benchmark run hygiene, not a product problem. Successor design: [session-novelty-and-pool-diversity.md](session-novelty-and-pool-diversity.md) (session-aware id-stub rendering with budget backfill). Retirement record: [ranking-changelog.md 2026-07-17](../architecture/ranking-changelog.md). This document is preserved as the design history of the retired mechanism.

Status: ~~implemented, feature-flagged **default-OFF** (2026-07-14)~~ retired 2026-07-17. Owner: retrieval/ranking.

## Problem

`check_recipe` is search-with-an-append-side-effect: the recipe an agent submits to
search is also logged as a trace. That is the stigmergy the product is built on — but it
has a measured failure mode when one agent reads and writes the same book over many
sessions. The agent starts retrieving **its own recent task-shaped hypotheses** instead of
the user's durable taste. Retrieval accuracy degraded run over run until it was caught, and
the effect is documented publicly:

> "`check_recipe`'s search has an append side-effect, so an agent that both reads and
> writes the same corpus will, over repeated runs, start retrieving its own recent
> task-shaped queries instead of durable recipes — accuracy fell 0.706 → 0.538 over five
> runs before we caught it. The fix ... drove real product changes: a read-only retrieval
> mode, same-agent-trace downranking, and feedback-driven ranking."
> — `docs/benchmarks.md`, "A finding that changed the product: self-pollution"

This brief implements the **same-agent-trace downranking** half of that fix. The workaround
used during measurement (write hypotheses to a scratch book, read a frozen corpus) proves
the mechanism but is not something we can ask every user to do — the product fix is
server-side ranking.

## Design constraints (rulings this honors)

1. **The fix is RANKING, not a read-only surface.** A read-only check mode is deliberately
   out of scope here: Soup.net is positioned as a pile of previous decisions, not a
   source-of-truth to consult. An agent that lacks enough context to form a recipe should
   ask the human or read the codebase — not search Soup.net read-only. We preserve that
   friction and fix the pollution by re-ranking.
2. **No relevance cutoff / floor, ever.** Full clustered results with similarity
   percentages are always returned. Downranking may **reorder / demote** within results; it
   **never truncates** and never hides a result. Even an orthogonal recipe informs general
   taste — the consuming agent makes the relevance call, not the server.
3. **Server does math, agents do reasoning.** This is server-side ranking work. No new
   agent-facing reasoning surface.
4. **Build on signals the server can already distinguish echo by:** authorship (same API
   key), recency (same-session / same-day), and curated-vs-hypothesis status. The server can
   tell an agent's own recent append from a durable curated recipe without reading content.

## What it does

When enabled, `check_recipe`'s ranking demotes a candidate recipe when **all** of:

- it was authored by the **same API key** making the current check (`traces.api_key_id`), and
- it was **appended recently** (within a tunable window of "now", measured on
  `traces.created_at` — the append time, which is the echo signal), and
- it is **not curated** — a curated/deliberate decision is exempt (see below).

Demotion is a **multiplicative penalty on the ranking score only**. The displayed similarity
percentage is the raw cosine similarity and is **never mutated** — a demoted recipe still
shows its true `85% similar` and still appears in results; it just sorts lower. There is no
truncation and no floor.

### Recency bands

Two bands, so a same-session echo is demoted harder than a same-day one:

- **Same session** (default ≤ 90 min): full `weight`.
- **Same day** (default ≤ 24 h, beyond the session window): `weight × dayWeightFactor`.
- **Older than the day window:** no demotion. An agent's own append from last week has aged
  into the corpus; if it still ranks, it is behaving like durable taste.

### Curated / reinforced exemption

A candidate is treated as **curated and exempt from demotion** when `traces.decided_at` is
set — i.e. it is a deliberately-dated decision (decision archaeology / backfilled judgment),
not a contemporaneous task-shaped hypothesis-append. Genuine curation survives untouched
even if it shares an author and is recent.

`decided_at` is the on-trace, zero-join curation signal shipped in v1. Two stronger
corroboration signals already exist in the schema and are the natural next demotion-exempt
inputs (deferred, see below): human `trace_reactions` (`still_true`) and cross-agent
`check_feedback` (a different key found the recipe useful). Both are "independent of the
reporting agent," which is exactly the axis that separates real signal from echo.

## The A/B toggle (product config affordance)

Echo suppression is feature-flagged so its effect can be measured before it changes
production ranking, and so an experiment can run both arms against the **same book**.

- **Global default** — `system_settings.echoSuppression` (JSON), read per check. Ships
  `{ enabled: false, weight: 0.5, sessionWindowMinutes: 90, dayWindowHours: 24,
  dayWeightFactor: 0.5 }`. Off by default: production ranking is byte-stable until the
  experiment confirms the setting. An operator flips the global default (or tunes the
  weights/windows) with a single `setSetting(db, "echoSuppression", …)`.

- **Per-request override** — `echo_suppress=on|off` on the `/check` agent surface (the
  documented primary agent interface; also reachable as `format=json`). `on`/`off` override
  the global `enabled` for that one request; absent → the global default applies. This is
  the clean A/B lever: point one arm at `…&echo_suppress=on`, the other at
  `…&echo_suppress=off`, same key, same book, and compare. It carries forward through the
  page's re-check form and Copy-URL round-trips like the other intent-preserving params.

This is a **product config affordance**, not a harness hack: it is how an operator rolls the
change out gradually (global default) and how any experiment isolates the ranking arm
(per-request), the same staged-rollout pattern used for the CSP report-only flip and the
premium-feature opt-in flags.

Deliberately **not** exposed as an MCP `check_recipe` tool argument: the `tools/list` payload
is under active scrutiny (connector tool-discovery), so the tool schema stays byte-stable.
An MCP-only harness runs the A/B via the global default flip between arms, or via the
`/check` HTTP surface, or (future) a per-key setting. Per-key config was considered and
deferred — daily keys rotate, so a per-key flag would not survive a multi-day experiment,
and it needs a schema change the per-request + global levers make unnecessary today.

## Default: OFF, pending the experiment

The evidence for the *demotion mechanism* is strong (self-pollution measured multiple ways),
which is why we build and ship it. The choice to default the global flag **off** — rather
than on — follows the house rule that retrieval-ranking changes "arrive measured" rather than
wired into live ranking untested, and keeps production ranking byte-stable until the A/B
confirms the win. Recommendation: **flip the global default to ON once the A/B shows
recovery within noise of the clean baseline.** Because the demotion is non-destructive
(reorder only, no truncation, percentages intact), the cost of running one experiment cycle
with it off is low, and the cost of an unmeasured live ranking regression is not.

(Decision recipe-checked: soup.net trace `5cfee9bb`, corroborated by `3103731a`
byte-identical-until-armed, `eb291228` ranking-changes-arrive-measured, `70669fa0`
opt-in-rather-than-default-on.)

## Implementation

- `packages/domain/src/ranking.ts` — pure ranking math: `EchoSuppressionConfig`,
  `DEFAULT_ECHO_SUPPRESSION`, `echoDemotionPenalty`, `echoRankingScore`,
  `rankWithEchoSuppression`. No I/O. Disabled config is an identity transform (byte-stable).
- `apps/backend/src/services/system-settings.service.ts` — `echoSuppression` setting +
  `resolveEchoSuppression(db, override)` combining the global default with the per-request
  override.
- `apps/backend/src/services/vector-search.service.ts` — `hybridSearch` applies the reorder
  over the deduped candidate set **before pagination**, so a demoted recipe can move onto a
  later page (never off the result set). Metadata fetch is scoped to
  `api_key_id = <current key>` among the candidates, so only the agent's own traces cost a
  lookup; everything else gets penalty 0 with no per-row work. Skipped entirely when disabled.
- `apps/backend/src/services/search-pipeline.ts`, `trace.service.ts` — thread the resolved
  config + current key + `now` from the check path into the search.
- `apps/backend/src/routes/check.ts` — `echo_suppress` query param (in the `CHECK_PARAMS`
  source-of-truth table, so it round-trips like the others).

### Correctness guarantees

- **No truncation.** The candidate set is only reordered; `totalResults` and every result
  are unchanged. Percentages shown are raw cosine similarity.
- **Off = byte-stable.** When disabled (default), no metadata query runs and the candidate
  order is returned untouched — identical to pre-change behavior.
- **Reorder, then paginate.** Demotion is applied to the full deduped candidate list before
  the page slice, so a demoted same-agent recipe drops below cross-agent recipes of similar
  similarity rather than merely shuffling within a page.

## Deferred

- MCP `check_recipe` tool-arg exposure (kept out to hold `tools/list` byte-stable).
- Per-key config surface (rotation makes it a poor fit; revisit if a stable-key need appears).
- Curation-exemption via human `trace_reactions` (`still_true`) and cross-agent
  `check_feedback` corroboration — the strongest "independent of the reporting agent"
  signals; `decided_at` ships as the v1 curation signal.
- Admin UI for editing the setting (flip via `setSetting` for now; the value is already
  included in `getAllSettings`).
- Applying demotion to the read-only `filter` search path (`searchWithoutLogging`) — left
  byte-stable; the measured echo lives on the logging check path.
