# Ranking algorithm changelog

Every change to the shipped ranking defaults (`DEFAULT_RANKING` / `RANKING_ALGORITHM_VERSION` in `packages/domain/src/ranking-config.ts`) gets an entry here, in the same commit that changes the default. Defaults never change silently (docs/planning/check-recipe-ranking-system.md §3c). Format per entry: what changed (old → new values), the sweep report / golden-set measurement it rests on, and the human ruling that shipped it.

The version is surfaced as `data.ranking.version` in `/check` JSON and MCP structured responses, and as `rankingVersion` in `recipe.checked` audit metadata — consumers and experiments report which ranking they ran against.

Additive levers that default to the previous behavior do **not** mint a new version; only a behavior-changing default flip does.

---

## 2026-07-17 — echo demotion retired; session-aware rendering + pool boundary land (no version mint)

No shipped behavior changed — every removed lever was default-OFF and never flipped, and every added lever ships in its legacy position — so the version stays `2026-07-16`. Recorded here because the *lever inventory* changed shape (operator rulings, recipes `9067ca1b` / `ebdc6ad7`; plan: [session-novelty-and-pool-diversity.md](../planning/session-novelty-and-pool-diversity.md)):

- **Removed**: echo demotion (score reorder, weights, windows), the curation-exemption flags + corroboration counts, the `demotion-adjusted-mass` cluster ordering, the `echo_suppress` request param (dropped cold — it was A/B-only), and the `echoSuppression` system setting. Rationale: ranking is a pure function of the check's explicit inputs (a demoted recipe is indistinguishable from a deleted one), and the pollution it targeted is reclassified as benchmark hygiene.
- **Added (rendering layer, not ranking)**: `session_id` (opaque client-held token, self-healing, stamped on deposits — migration 0031) and known-set id-stub rendering with budget backfill; the recipe-gist on stubs is removed everywhere (ossification risk — a truncated claim can be read as the claim). Extended same day (operator ruling, recipe `31d184df`; migration 0032): the known-set includes **display history** (`session_shown` — every full text rendered is recorded as shown), the display window **walks the ranking until it holds its full budget of unseen recipes** (knowns interleave as stubs at true rank; offsets count novel items), evidence-discovery entries with known parents stub too, and `check_feedback.session_id` captures the reporting session. Ranking untouched throughout; sessionless requests are byte-stable.
- **Added (lever, ships off)**: `clusterPool` mode `"score-gap"` — relevance-bounded pool boundary (largest gap in [minSize, size]); `"fixed"` remains as a sweep comparison arm; default stays `"page"`.

Initial versioned config. Behavior is byte-identical to the pre-refactor pipeline; this entry records what the levers ship as, so later flips have an explicit "old" side.

- `echo.enabled: false` — echo demotion OFF pending the golden clean/polluted pair measurement (ruling recipe `5cfee9bb`, docs/planning/echo-suppression.md §Default). Weights when enabled: `weight 0.5, sessionWindowMinutes 90, dayWindowHours 24, dayWeightFactor 0.5`.
- `exemption: { decidedAt: true, humanReaction: false, crossAgentFeedback: false }` — v1 curation exemption only. The two corroboration signals are plumbed (lazy per-candidate counts) but OFF until measured.
- `clusterOrdering: "member-count"` — legacy ordering. The `"demotion-adjusted-mass"` lever (§3d) is implemented and harness-measurable; the flip awaits the golden polluted-set ruling.
