# Benchmark results

**Purpose of this doc**: the controlled-benchmark complement to the README's observational field data — what happens when Soup.net is dropped into a published agent-memory benchmark as a swappable backend, with proper control arms. Headline numbers and honest caveats live here; the full methodology, runbooks, per-row results, and audit records live in the eval repo ([SoupNet-evals](https://github.com/AndyForest/SoupNet-evals), `evals/perma-ab/`), which is the source of truth. Nearby docs: the README's *Field data* section covers real-usage observation; this doc covers controlled comparison.

## PERMA, run full1 (2026-07-06)

[PERMA](https://arxiv.org/abs/2603.23231) benchmarks personalized memory agents: 10 synthetic personas whose preferences emerge and evolve across ~9,600 dialogue sessions, with 705 multiple-choice tasks scored on whether the assistant's answer honors the persona's accumulated preferences. It ships a pluggable memory-backend harness already used to compare Mem0, MemOS, Memobase, Supermemory and others — Soup.net was added as one more backend, with two control arms.

**Setup in one paragraph.** Ingestion ran Soup.net's designed usage pattern, not a message pipe: an LLM scribe distilled each session into evidence-backed recipes (verbatim-quote validation; 39,528 recipes from 9,643 sessions at a 0.58% quote-failure rate, `decided_at` backfilled to session dates). Retrieval formed a preference hypothesis per task and recipe-checked it. All models (answering agent, judges, scribe) pinned to Gemini 2.5 Flash — chosen because PERMA publishes a standalone row for it, making the naive-context arm a reproduction of a published number (reproduced: 0.829 on the comparable slice vs published 0.87, within tolerance). Every judge verdict in the pilot was hand-audited before scaling.

**Results** (MCQ accuracy; clean single-domain, non-interactive):

| | Type 1 (no memory) | Type 2 (single-event) | Type 3 (cross-event) | Context tokens/task |
|---|---|---|---|---|
| No memory (harness floor) | 0.411 | — | — | 0 |
| Naive full-context | 0.411 | 0.837 | 0.827 | 25,635 |
| **Soup.net** | 0.411 | **0.823** | **0.766** | **1,104** |

Three claims, deliberately kept separate:

1. **Against no memory, the recipe corpus is decisive**: +41 points on single-event tasks, +36 on cross-event.
2. **Against naive full-context** (pasting the entire ~26k-token history — the bar [CL-Bench](https://arxiv.org/abs/2606.05661) showed most memory systems fail): **parity on single-event tasks at 23× less context** (0.823 vs 0.837, within noise at n=141). Full context also isn't available in Soup.net's actual arena — cross-session, cross-agent, cross-vendor — so matching its accuracy at 4% of the tokens is the operative result.
3. **A real deficit on cross-event integration** (0.766 vs 0.827, n=423): tasks whose answers integrate many events favor having everything in context over top-k retrieval. The retrieval synthesis premium feature (`docs/planning/premium-llm-features.md`) is the designed response; its **first controlled test was negative** (type-3 0.697 vs 0.775 baseline on the frozen corpus — the synthesized profile as currently prompted/injected displaces rather than sharpens the specific evidence). The feature works mechanically; the synthesis prompt and injection format are now iterating against this benchmark before any performance claim is made for it.

**The ablation campaign that followed found something better than a tuning win.** A first round of ablations (wider retrieval, multi-hypothesis retrieval, result reordering) produced large degradations that all turned out to share one cause: **corpus self-pollution** — each run's hypothesis checks append task-shaped traces that later runs then retrieve in place of real recipes (verified directly: a third of retrieval slots occupied by prior runs' hypotheses after five runs; accuracy fell 0.706 → 0.538 monotonically with cumulative runs, regardless of configuration). This is the field evaluation's "batched checks retrieve the agent's own fresh traces" failure mode, quantified at benchmark scale. Remediation validated the architecture twice over: the corpus was rebuilt into fresh books from the export archive in 18 minutes at **zero embedding cost** (the vector cache is content-addressed across books and users), and re-running on the frozen corpus with hypothesis appends isolated to scratch books **replicated the original results** (0.696 vs 0.706, all slices within the measured ±0.05–0.08 run-to-run noise floor). On that clean footing, divergent multi-hypothesis retrieval showed no effect beyond noise. Product consequences now in design: a read-only retrieval mode for MCP checks, same-agent-trace downranking, and feedback-driven reinforcement/decay — plus one export-completeness bug found (`decided_at` missing from `/auth/me/export`).

For scale (⚠ different answering model than the published table; directional only): Soup.net's 0.706 overall lands above Mem0 (0.686), Supermemory (0.655), and Lightmem (0.657) on their benchmark, below MemOS (0.811).

**The run doubled as a load test of the 2026-07 MCP surfaces.** 40,233 `check_recipe` calls at 10-way concurrency: p50 248 ms, p95 363 ms — matching the README's claimed 0.15–0.36 s warm-check range — with zero tool errors across `check_recipe`, `get_recipes` (p50 9 ms), and `log_feedback` (705 structured feedback rows ingested).

**Honest scope**: one benchmark, synthetic personas, MCQ recognition rather than agentic production, one model family, one run (no significance test yet on the type-2 delta). Known follow-ups and raw artifacts: `SoupNet-evals/evals/perma-ab/` (runbook, findings log, `baselines/run-full1/`). Agentic benchmarks (π-Bench, SWE-Lancer) are scouted next.

**Reproduce it**: the full 40,822-trace recipe corpus is archived as a scrubbed `/auth/me/export` snapshot — [`corpus-export.json.gz`, 20 MB](https://github.com/AndyForest/SoupNet-evals/blob/main/evals/perma-ab/baselines/run-full1/corpus-export.json.gz) — alongside the runbook that rebuilds it from scratch. Loading an export into a fresh instance needs the corpus-import feature (see `docs/backlog.md`, Data portability); until that lands, reproduction means re-running the runbook's ingest stage (~$35 of LLM calls).
