# Ranking algorithm changelog

Every change to the shipped ranking defaults (`DEFAULT_RANKING` / `RANKING_ALGORITHM_VERSION` in `packages/domain/src/ranking-config.ts`) gets an entry here, in the same commit that changes the default. Defaults never change silently (docs/planning/check-recipe-ranking-system.md §3c). Format per entry: what changed (old → new values), the sweep report / golden-set measurement it rests on, and the human ruling that shipped it.

The version is surfaced as `data.ranking.version` in `/check` JSON and MCP structured responses, and as `rankingVersion` in `recipe.checked` audit metadata — consumers and experiments report which ranking they ran against.

Additive levers that default to the previous behavior do **not** mint a new version; only a behavior-changing default flip does.

---

## 2026-07-16 — baseline

Initial versioned config. Behavior is byte-identical to the pre-refactor pipeline; this entry records what the levers ship as, so later flips have an explicit "old" side.

- `echo.enabled: false` — echo demotion OFF pending the golden clean/polluted pair measurement (ruling recipe `5cfee9bb`, docs/planning/echo-suppression.md §Default). Weights when enabled: `weight 0.5, sessionWindowMinutes 90, dayWindowHours 24, dayWeightFactor 0.5`.
- `exemption: { decidedAt: true, humanReaction: false, crossAgentFeedback: false }` — v1 curation exemption only. The two corroboration signals are plumbed (lazy per-candidate counts) but OFF until measured.
- `clusterOrdering: "member-count"` — legacy ordering. The `"demotion-adjusted-mass"` lever (§3d) is implemented and harness-measurable; the flip awaits the golden polluted-set ruling.
