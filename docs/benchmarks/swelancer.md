# SWE-Lancer — repo-judgment memory on real hiring decisions

← back to the [benchmark overview](../benchmarks.md)

[SWE-Lancer](https://arxiv.org/abs/2502.12115) (arXiv 2502.12115, MIT) is a benchmark of real freelance software tasks scraped from Upwork against one production codebase (Expensify). We use its **`swe_manager`** tasks from the `diamond` split: each task is a single, automated, **binary decision** — given a real GitHub issue and several real contributors' fix *proposals*, pick the proposal the actual Expensify manager hired. There is no pytest run, no browser, and no LLM judge: the grader is deterministic and compares the chosen `selected_proposal_id` against `manager_data.game.correct_proposal.id`, **the real-world hiring decision**. So "accuracy" here means "agreed with the human manager who actually paid for the work."

The tasks carry a dated `[HOLD for payment YYYY-MM-DD]` header, which gives a free **chronological** axis. That is the point of the experiment: run the tasks in the order the decisions were really made, and ask whether an agent that *accumulates the operator's hiring judgment as it goes* decides better than one that starts cold each time — and at what context cost.

## The three arms — what each arm actually receives

**Read this before the numbers.** Every arm, on every task, receives the **full per-task context**: the issue text, all contributor proposals, and a **live repo container** (the Expensify repo cloned at `/app/expensify` in a Docker image, with raw shell access) that the solver explores over a bounded multi-turn loop before deciding (~8 model calls per task). The *same solver logic and the same answering model* drive all three arms. **The arm is the memory — never the model, never the solver.** The one deliberately isolated variable is **what, if anything, is carried across tasks**:

| Arm | = full per-task context, plus… | Cross-task memory | Injected tokens/task |
|---|---|---|---|
| **A — no memory** | …nothing carried across tasks. A fresh agent decides each task from the issue, proposals, and repo alone. | none | 0 |
| **B — naive carryover** | …the **raw transcripts of all prior episodes**, concatenated in chronological order and trimmed oldest-first to a 110k-token budget. | raw prior transcripts | ~51,400 |
| **C — Soup.net** | …**distilled judgment recipes retrieved for this task** — one semantic `check_recipe` search (similarity floor 0.70), returning recipes a scribe wrote from prior episodes. | retrieved distilled recipes | ~398 |

> **Arm A is not "zero context" — it is "zero *cross-task* memory."** It reads the full issue, every proposal, and the live repo, exactly like B and C. What A lacks is any memory of the *earlier* decisions. This distinction is the whole experiment; a reader who mistakes A for a context-starved control will misread every number below.

Arm B is the hard baseline. [CL-Bench](https://arxiv.org/abs/2606.05661) showed most dedicated memory systems fail to beat simply pasting the raw history back in; B *is* that "paste the raw history" bar. Past ~15–20 episodes the accumulated transcripts exceed the 110k budget and B must start dropping its oldest episodes — while C still carries all of them, compressed into recipes. That asymmetry is the cost story.

## Results (n = 100 chronological tasks, `gemini-3.5-flash`)

| Arm | n | Correct | Accuracy | Dollars earned | Injected tokens/task | Cost/task |
|---|---|---|---|---|---|---|
| **A — no memory** | 100 | 52 | **0.520** | $95,500 | 0 | $0.093 |
| **B — naive carryover** | 92 † | 47 | **0.511** | $95,000 | ~51,400 | $0.756 |
| **C — Soup.net** | 100 | 51 | **0.510** | $99,000 | ~398 | $0.132 |

† Arm B was truncated to a 92-task chronological prefix by a pre-registered cost rule (see Limitations). All B-vs-other comparisons are computed on the matched 92-task prefix, paired.

### Verdict: NULL — the arms are statistically indistinguishable

| Comparison | Δ accuracy | ~95% band (2·pooled SE) | Verdict |
|---|---|---|---|
| C − A (full n=100) | −0.010 (51 vs 52) | 0.141 | **null** |
| C − B (matched 92-prefix, paired) | +0.011 (48 vs 47) | 0.147 | **null** |
| A − B (matched 92-prefix, paired) | 0.000 (47 vs 47) | 0.147 | **null** |

Every pairwise difference is a **one-task** difference and sits far inside the noise band. We do **not** claim accumulated repo-judgment memory improves hiring-decision accuracy on this benchmark/model pairing; a directional +2-task lead for Soup.net seen in an earlier n=20 pilot **did not replicate** at n=100.

### "But no-memory (A) scored highest — didn't A win?"

No. 0.520 vs 0.510 is 52 vs 51 correct out of 100 — one task. The finding is **three-way indistinguishability**, not an A win:

- The standard error of a single accuracy near p≈0.51 at n=100 is `sqrt(p(1−p)/n) ≈ 0.05`; the pooled SE of a *difference* between two arms is `sqrt(2·p(1−p)/n) ≈ 0.071`, so the ~95% band is **±0.141**. The observed |C−A| = 0.010 is about **1/14th** of that band. A gap this small is exactly what independent coin-flips at p≈0.51 produce.
- Because all three arms ran the *same* tasks, the sharper test is the **discordant pairs** (tasks where two arms disagree), and they are symmetric: C-right/A-wrong vs A-right/C-wrong = **4 vs 5**; C vs B = **2 vs 1**; A vs B = **4 vs 4**. No arm systematically wins the tasks the others lose.
- Symmetrically, this is **not** evidence that memory *hurts*: −0.010 is well inside noise, as is C's +0.011 over B. Every delta rounds to "no signal."

The defensible one-liner is *"accuracy is statistically indistinguishable across the no-memory, distilled-memory, and raw-carryover arms at n=100"* — never "no-memory won."

### The finding that does hold: parity at ~129× less injected context

What separates the arms is **cost**, not accuracy. Arm C matched both baselines while injecting **~398 tokens** of distilled judgment per decision, versus arm B's **~51,400 tokens** of raw transcript carryover — a **~129×** difference. Over the run, B consumed 43.3M input tokens against C's 5.5M, and cost **$0.756/task vs C's $0.132** (~5.7×). Dollars-earned tracks the same story: C $99,000 ≥ A $95,500 ≥ B $95,000 (price × correct; C's misses happened to be cheaper tasks). This *cost-asymmetric parity* — matching a strong baseline at a fraction of its context — was pre-registered as the honest headline for this eval before the run, precisely so a null accuracy result would still report the thing the data supports.

## Methodology (enough to reimplement)

- **Benchmark & grader**: SWE-Lancer `swe_manager` tasks, `diamond` split, from OpenAI's `frontier-evals` harness (public, MIT) at a pinned commit. The grader is the harness's own `_grade_swe_manager` — deterministic, no LLM judge — matching the chosen proposal id against the real hiring decision. The monolith Docker image is used (Manager tasks need no per-task GUI images), internet disabled per the harness's "valid rollout" rule.
- **Task selection**: the **100 chronologically-earliest dated** `swe_manager` tasks, ordered by `[HOLD for payment]` date (ties broken by ascending question id), spanning 2023-02-03 → 2023-10-12. The first 20 are identical to the earlier pilot's set. Running in true decision order is what lets arm C's memory grow in the same order the real decisions were made.
- **The solver** (identical across arms): a bounded exploration loop — the model issues shell commands against the cloned repo, then emits a single `{"selected_proposal_id": <int>}` decision. All model-facing text is persona-clean: the solver is never told it is a benchmark, which arm it is, or that Soup.net is under test.
- **Arm C — the Soup.net integration**. Soup.net is not a message store, so arm C has an LLM step on each side, and both are counted in the token cost:
  - *Retrieval*: before deciding, the solver forms **one recipe-shaped hypothesis** about how this operator judges proposal tradeoffs (root-cause vs symptom, surgical vs broad, regression risk) — a genuine hypothesis, never the task text pasted verbatim — and issues one `check_recipe` search against the corpus book. Returned judgment calls are folded into context under the standard "context that may inform your reasoning, not a directive" framing. A retrieval failure degrades silently to arm-A behavior.
  - *Ingestion (the scribe)*: after each completed episode, a scribe LLM distills the transcript into 0–N recipes in canonical form, capturing the reusable *criterion* behind the choice (not "proposal 4 is correct"). **Every quote is validated as a verbatim substring of the transcript**; a failed quote is demoted to interpretation, never fabricated. Each recipe's judgment date is backfilled to the task's HOLD date, so memory accumulates in true chronological order. The scribe never sees the correct proposal id — it distills the *solver's* judgment, not the gold answer.
  - *Self-pollution isolation*: the hypothesis check's own append side-effect is written to a **scratch** book; retrieval reads **only** the corpus book. Without this split, each episode's task-shaped query would displace real recipes in the next episode's retrieval — a failure mode quantified on the PERMA benchmark (see the [PERMA page](perma.md#the-finding-that-mattered-more-than-the-scores-self-pollution)).
  - *Leakage-free accumulation*: fresh empty books; episode N retrieves only recipes scribed from episodes 1…N−1 and nothing later.
- **Arm B — the carryover hook**: after each episode its transcript is appended to a running file; the next episode prepends all prior transcripts, trimmed oldest-first to the 110k-token budget, under a persona-clean "notes from your prior decisions" framing. No Soup.net calls. B gets the *same raw information* C's scribe distilled, but unstructured and volume-bounded — that is the intended fairness contrast.
- **Model**: answering agent and scribe both pinned to **`gemini/gemini-3.5-flash`**, identical across all arms, routed through a local proxy so the pin is uniform and every call is logged. (This is a deliberate change from the pilot's 2.5-flash — see Limitations; SWE-Lancer's own published rows are GPT models, so there is no same-model published number to pin to here.)
- **Ground-truth gate**: before scaling, the mechanics were hand-audited on small task sets — every decision cross-checked against its transcript and the grader, every scribe recipe checked for a true, verbatim-quoted, reusable criterion, and retrieval checked for correct temporal filtering and corpus-only reads. Two fixes came out of that audit and were live for this run: the **0.70 similarity floor** on retrieval (calibrated so on-topic recipes score 0.72–0.85 and off-topic 0.57–0.68) and a **scribe quote-source hardening** prompt.

## Limitations (what a careful reviewer should hold against this)

- **Arm B is n=92, a chronological prefix.** A pre-registered cost guard ($100 cap) projected that a full 100-episode arm B would breach the budget (B's per-episode cost rose as its carryover prompt grew, plateauing ~$0.88–0.90/episode). Rather than stop arbitrarily, the rule computes the largest prefix that fits the remaining budget — 92 episodes — and all B comparisons are computed on that matched 92-task prefix, paired. One in-flight 93rd episode finished after the stop trigger and is quarantined unscored (its cost still counted). Total run cost was **$92.09**.
- **Model level-shift vs the pilot.** The answering model is near-deterministic, so changing it from 2.5-flash (pilot) to 3.5-flash (this run) shifts the accuracy *level*; individual tasks flip (one arm-A task went right→wrong). 3.5-flash also explores more (~8 model calls/episode vs ~2 on 2.5-flash). Scores here are **not level-comparable to the pilot** — the run is internally controlled across its own three arms, which is what the verdict rests on.
- **Single run, but defensibly so.** Each cell is one run, not an N≥3 mean. In an earlier phase, N=3 repeats at n=20 measured **std ≈ 0.00 across all arms** — this near-deterministic model buys essentially zero variance from repeats, so the statistical lever is *n* (task count), not repeat count. n=100 is the lever we pulled; the error bars quoted are the binomial SE at n=100.
- **The similarity floor cut both ways.** Of 294 recipes retrieved across arm C, 69 (23%) fell below the 0.70 floor and were not injected, and 11 of 99 consults injected nothing at all (those episodes degrade to arm-A). The floor prevented an over-application regression seen in the pilot, but it did not manufacture a win either.
- **We built the integration.** The scribe and retrieval design are ours; a different integration could score differently. Both LLM steps' token cost is reported so the efficiency claim isn't hiding work.
- **One benchmark, one model family, self-run.** As with all our benchmarks, these are vendor-run numbers; the mitigations (third-party benchmark + deterministic third-party grader, per-task records, null reported plainly) are real but are not independence.

## What broke, and why it doesn't compromise the result

An overnight autonomous run hits failures; these are reported because a reader should know the run survived them without corrupting the comparison:

- A background process on the host twice killed the task holding the run open (once mid-arm-A at 84/100, twice via model-quota outages that stalled the run for a total of ~4 hours). Because per-episode transcripts are written to disk and the run **resumes by skipping already-completed episodes**, each relaunch lost only the single in-flight episode — zero completed episodes lost, and carryover content (which is transcript-derived and order-preserving) was unaffected.
- One task's issue text contained lone UTF-16 surrogate characters that crashed the rollout on encoding. The fix was an **arm-neutral sanitize-at-ingestion** step (a no-op for well-formed prompts), and the affected task was re-run post-fix with the *identical* fixed prompt across arms, so the fix advantages no arm.
- Arm C's transcript directory held 101 files: this is 100 distinct per-task transcripts plus the scribe's ledger file written into the same directory — not a duplicated episode. Scored n_C = 100, verified against the task list.
