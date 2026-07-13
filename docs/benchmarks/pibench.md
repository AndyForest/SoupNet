# π-Bench — proactive personal-assistant agents (preliminary)

← back to the [benchmark overview](../benchmarks.md)

> **Status: preliminary (n = 5 personas, single run per arm).** The mechanistic finding below is solid; the scored deltas are early and are reported with their confounds and noise floor stated plainly. Read this as "what we've seen so far," not a settled result.

[π-Bench](https://arxiv.org/abs/2605.14678) (arXiv 2605.14678) tests **proactive personal-assistant agents** over long, multi-session episodes (20 sessions per persona). Unlike PERMA's multiple-choice recognition, here an agent actually *does work* across sessions and is scored on two axes: **PROC** (proactivity — does it act on what it should remember about the user?) and **COMP** (completion). We ran 5 personas × 4 arms, where the persona set (n=5) is the replication unit for the noise-floor call. All arms use Gemini 2.5 Flash.

## The mechanistic finding (the solid part)

With Soup.net registered as an ordinary agent-callable MCP tool and the standard briefing — *no* orchestration forcing it to check — the assistant **chose to consult its judgment memory unprompted at self-selected moments**, wrote correctly-formed recipes, and showed no awareness it was under test. That is the product's core claim (an agent checking at the judgment moment, not on a fixed schedule) observed inside an independent third-party harness. This behavioral result does not depend on the scores below.

## The four arms

| Arm | Mechanism | PROC | COMP | Soup.net consultations |
|---|---|---|---|---|
| **A** | no memory + per-task workspace wipe (floor) | **0.417 ± 0.080** | 0.559 ± 0.267 | — |
| **B1** | stock NanoBot LLM-scribe (its `MEMORY.md` re-injected every session) | **0.619 ± 0.079** | 0.554 ± 0.223 | — |
| **B2** | verbatim raw-transcript carryover | **0.581 ± 0.089** | 0.500 ± 0.237 | — |
| **C** | agent-initiated Soup.net (MCP tool the agent may call) | **0.584 ± 0.091** | 0.545 ± 0.211 | 23 total across 5 episodes |

## Two verdicts, on the PROC axis

**PROC is the informative axis this run; COMP is flat (see caveats).**

- **π-1 — memory vs the no-memory floor (C vs A): clears the noise floor, but confounded.** Δ = **+0.167** (0.584 vs 0.417), which exceeds 2·pooled SE (0.109) and the slice floor, and every persona points the same way (pharmacist most starkly, 0.276 → 0.646). **The confound:** arm A wipes the agent's workspace between tasks while B1/B2/C persist it, so C−A conflates the *memory channel* with plain *file carryover*. The tell is concrete — arm C's pharmacist scored PROC 0.646 with **zero** Soup.net checks; its lift over A came from workspace persistence, not recipe memory. So π-1 reads as *"any cross-session persistence beats a wiped cold-start,"* not *"Soup.net memory specifically."*

- **π-2 — agent-initiated memory vs a competent built-in scribe (C vs B1): within noise.** Δ = **−0.035** (0.584 vs 0.619), inside 2·pooled SE (0.108). This is the **clean memory-channel comparison** — both arms carry the workspace, differing only in the memory mechanism. The result of note is the **cost asymmetry**: arm C reached parity while consulting the corpus only **23 times total across all 5 episodes** (0 for the pharmacist) — i.e. it injected judgment context only at the moments it *chose* to check — versus B1 re-injecting its entire `MEMORY.md` into every single session. Parity while consulting far less, far more selectively, is the finding, not a loss.

This is the same shape as the [SWE-Lancer](swelancer.md) result — accuracy parity with a strong baseline at a fraction of the injected context — arrived at independently.

## Caveats (read the deltas through these)

1. **π-1 is confounded by workspace file carryover** (above). π-2 (C vs B1) is the clean comparison.
2. **No web-search key → COMP is uninformative.** The `web_search` tool errored equally across all arms, so COMP collapsed to ~0.50–0.56 with large spread (±0.21–0.27) and all COMP deltas sit within noise. No COMP claim can be made from this run; a keyed re-run is needed.
3. **N = 1 per persona.** The 5 personas are the replication unit; a per-persona N≥3 repeat would tighten the π-2 null and is the natural next step.

## Next steps

- **Sharpen the π-2 null** with per-persona N≥3 repeats and a real web-search key (to make COMP informative).
- **Un-confound π-1** with a no-wipe arm A′ (persist the workspace but withhold memory), isolating memory from file carryover.
- **Ablation**: an orchestrator-hooked arm C (memory injected on every turn rather than agent-initiated) would isolate the value of *the agent choosing when to check* from the value of the memory content itself.
