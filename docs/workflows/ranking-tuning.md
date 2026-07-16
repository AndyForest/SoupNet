# Ranking tuning workflow

How a `check_recipe` ranking change — a new default, a tuned weight, a new lever — gets measured, ruled on, and shipped. This is the §3c workflow from [docs/planning/check-recipe-ranking-system.md](../planning/check-recipe-ranking-system.md): **offline sweep on golden sets → report → human ruling → versioned algorithm event**. Defaults never change silently.

## The two harness layers

| Layer | What it proves | Where | Runs |
|---|---|---|---|
| A — mechanism regression | The §2 rulings as exact asserts (no truncation, percentages untouched, exemplar contract), the echo-exposure waterfall mechanics, guardrail no-ops, exemption flags | `apps/backend/src/services/ranking-regression.test.ts` (hand-crafted unit vectors, exact cosines) | inside `npm run test:ci` — every gate |
| B — golden-set semantic eval | Graded retrieval quality, echo exposure, diversity, and utility × surprise on realistic corpora with a real embedding model | `apps/backend/src/eval/ranking-eval.ts` over `eval/golden/*` (fixture format: [eval/golden/README.md](../../eval/golden/README.md)) | `npm run eval:ranking`, CI `ranking-eval` job (deploy gate), inside `test:ci` (skip: `SKIP_RANKING_EVAL=1`) |

Regeneration commands, one per metric family (all Layer B metrics come from the same deterministic run — one command regenerates every number in a report):

```bash
npm run eval:ranking                                    # full run: throwaway postgres, all metrics, thresholds gate
npm run eval:ranking -- --dataset eval/golden/<name>    # a specific golden dataset
RANKEVAL_KEEP=1 npm run eval:ranking                    # keep the stack up — warm vector_cache for iteration
npx tsx apps/backend/src/eval/ranking-eval.ts --dataset eval/golden/<name>   # against an existing DB (PG* env)
npx vitest run apps/backend/src/services/ranking-regression.test.ts          # Layer A only (needs BACKEND_URL, see test:ci)
```

## Tuning a parameter (the loop)

1. **Branch.** Ranking work follows the standard branch + draft-PR flow.
2. **Baseline.** `npm run eval:ranking` on the unchanged branch — the report in `eval/reports/<dataset>/` is your "before". (Measure the baseline immediately before the sweep, not from a stale report — environment shifts invalidate old baselines.)
3. **Sweep.** Change the candidate value(s) in code — either a temporary edit to `DEFAULT_RANKING` or a variant added to the runner's `VARIANTS` — and rerun per value. `RANKEVAL_KEEP=1` keeps the postgres stack (and its content-hash-keyed `vector_cache`) warm, so repeat runs re-embed nothing.
4. **Report.** Collect the before/after tables (the runner emits JSON + markdown per run). Pair every relevance number with its diversity and guardrail numbers — the objective is utility × surprise, and a sweep that only reports NDCG is Goodharting.
5. **Human ruling.** Hand the report to the operator. Agents never flip a shipped ranking default on their own judgment — the house rule is that a live ranking change arrives measured (recipe `5cfee9bb`).
6. **Ship as a versioned algorithm event.** In ONE commit:
   - the default change in `packages/domain/src/ranking-config.ts`,
   - a bumped `RANKING_ALGORITHM_VERSION` (dated — mint only for behavior-changing default flips, not additive levers that default to the old behavior),
   - a `docs/architecture/ranking-changelog.md` entry (old → new values, the sweep report it rests on, the ruling that shipped it),
   - recalibrated `thresholds.json` bounds for the affected golden datasets — the new behavior is the new baseline, and each changed bound's `rationale` cites the new calibration run.
7. **Gate.** `npm run test:ci` (Layers A + B together). CI's `ranking-eval` job re-proves it on push; a threshold breach is a red build, not a judgment call.

## Adding or refreshing a golden dataset

Fixture format and the out-of-band delivery path for real corpora: [eval/golden/README.md](../../eval/golden/README.md). Lifecycle rules from the research memos (small frequent additions over big refreshes; every production ranking regression becomes a new golden question/pair; version judgments with the corpus; protect historical baselines so a metric change can't masquerade as a ranking win): when metric CODE changes meaning, recalibrate thresholds in the same commit and say so in the rationale strings.

## Threshold philosophy

- **Hard invariants are exact.** The unaffected-question tau guardrails sit at `min: 1` — demotion touching an unaffected query is a bug, not a regression to tolerate.
- **Semantic metrics carry margins.** The eval runs a real ONNX model (`local:bge-small-en-v1.5`); each platform is deterministic, but low-order float differences across platforms can flip near-tie ranks, so calibrated bounds keep ~0.05 headroom below/above the measured value (ruling recipe `e65eadfe`).
- **Every bound carries a rationale** naming what it protects and which run calibrated it — `thresholds.json` entries without one fail the run.
