# Benchmark results

**Purpose of this doc**: the controlled-benchmark complement to the README's observational *Field data*. It reports what happens when Soup.net is dropped into a *published, third-party* agent-memory benchmark as a swappable backend, against proper control arms — with the methodology stated in enough detail to reimplement, and the limitations stated plainly.

**On trusting a vendor's own benchmark.** These numbers are produced by the people who build Soup.net, on a benchmark we chose. That is the standard credibility problem for every agent-memory result (Mem0, Zep, MemOS and others all publish self-run numbers, and independent audits have found some of them inflated). We can't remove that conflict, only constrain it: the benchmark and its judge are third-party code we did not write; the answering-model arm reproduces a *published* number as a calibration check; per-task results are recorded so any row can be re-derived; **negative and null results are reported alongside the positives** (they are half of what follows); and the model, prompts, and task split are specified below. Judge the methodology, not the headline.

---

## PERMA

[PERMA](https://arxiv.org/abs/2603.23231) (arXiv 2603.23231) is a personalized-memory benchmark: 10 synthetic personas whose preferences emerge and evolve across ~9,600 timestamped dialogue sessions, with 705 multiple-choice questions scored on whether the assistant's answer honors that persona's accumulated preferences. Questions are typed by how much memory they require: **Type 1** ("zero-memory" — the harness forces an empty context, a floor shared by all systems), **Type 2** (single prior event), **Type 3** (integrate across many events). PERMA ships a pluggable memory-backend harness already used to compare Mem0, MemOS, Memobase, Supermemory, LightMem and others; we added Soup.net as one more backend plus two controls. We ran the **clean single-domain, non-interactive** split.

### The three arms

| Arm | What it does | Context/task |
|---|---|---|
| **No memory** | PERMA's forced-empty Type-1 condition — the floor | 0 |
| **Naive full-context** | Paste the persona's entire prior transcript into the prompt | ~25.6k tokens |
| **Soup.net** | Ingest each session as evidence-backed recipes; retrieve per question (see Methodology) | ~1.1k tokens |

Naive full-context is the hard baseline: [CL-Bench](https://arxiv.org/abs/2606.05661) (arXiv 2606.05661) showed most dedicated memory systems fail to beat simply pasting the history.

### Results (MCQ accuracy)

| | Type 1 (no memory) | Type 2 (single-event) | Type 3 (cross-event) | Context tokens/task |
|---|---|---|---|---|
| No memory (floor) | 0.411 | — | — | 0 |
| Naive full-context | 0.411 | 0.837 | 0.827 | 25,635 |
| **Soup.net** | 0.411 | **0.823** | **0.766** | **1,104** |

Three claims, kept separate because they are not equally strong:

1. **Against no memory, decisive** — +41 points (Type 2), +36 (Type 3). The corpus does real work.
2. **Parity with naive full-context on single-event tasks, at ~4% of the context** — 0.823 vs 0.837 (n=141; the 1.4-point gap is inside the run-to-run noise floor measured below). Full context is also *unavailable* in Soup.net's actual setting — memory that must survive across sessions, agents and vendors — so matching its accuracy at 1.1k vs 25.6k tokens is the operative result.
3. **A real deficit on cross-event integration** — 0.766 vs 0.827 (Type 3, n=423). Questions whose answer must synthesize many events favor having everything in context over top-k retrieval. This is a genuine limitation, not noise; the work to address it is described below and has not yet succeeded.

**Calibration against the published table.** The naive-context arm is our reproduction of a number PERMA publishes for this answering model (Gemini 2.5 Flash standalone): we get 0.829 on the comparable Type-2/3 slice against a published 0.87 — within tolerance, so the harness is wired correctly. (The all-types aggregate is not comparable to the paper's, because the released code forces Type-1 context empty in every arm; we report per-type throughout for this reason.)

**Cross-system context** (⚠ *directional only* — our answering model differs from the one in PERMA's published memory-system table, so this is not apples-to-apples): Soup.net's 0.706 all-types average sits above the published Mem0 (0.686), Supermemory (0.655) and LightMem (0.657), and below MemOS (0.811). Treat as a sanity check that we are in the right range, not as a ranking.

---

## Methodology (enough to reimplement)

- **Benchmark**: PERMA at its public commit, `clean` single-domain `overall` split, 705 tasks × 10 personas, non-interactive MCQ. Dataset is public (arXiv 2603.23231; the authors host it on Hugging Face). The harness is the authors' own; Soup.net is a backend plugged into it.
- **Ingestion (the "scribe")**: Soup.net stores judgment calls, not messages, so each dialogue session is distilled by an LLM into 0–N recipes in the canonical form *"As a [role] working on [goal], I prefer [X] so that [reason]"* with a **verbatim supporting quote validated as a substring of the session** (failed quotes are dropped, never fabricated — 0.58% drop rate over 39,528 recipes). Each recipe's judgment date is backfilled to the session date. This distillation is extra work the message-store baselines don't do; its token cost is reported, not hidden.
- **Retrieval**: for each question, an LLM forms a preference *hypothesis* (not the question verbatim) and issues one `check_recipe` semantic search scoped to that persona's book; the returned recipes become the answering context. Retrieval is read-only against a frozen corpus (see self-pollution, below).
- **Models**: answering agent, hypothesis-former, scribe, and both PERMA judges all pinned to **Gemini 2.5 Flash**, routed through a local proxy so the pin is uniform and every call is logged. Gemini 2.5 Flash was chosen specifically because PERMA publishes a standalone row for it (enabling the calibration check above). Judge and answering models are the *same* — a limitation noted below.
- **Judging**: PERMA's own MCQ grader and memory-score rubric, unmodified. Before scaling, every judge verdict on a 5-task-per-arm smoke was hand-checked against the transcript (5/5 agreed); the scribe's quote fidelity was audited on a sample; only then did the full run proceed.
- **Scale/cost**: one full run ≈ 40k `check_recipe` calls + judge/answer calls; corpus ingest ≈ $35 of LLM calls; a full arm ≈ 705 tasks. Self-hosting Soup.net needs only Postgres + pgvector and a Gemini embedding key (see the repo README).

---

## The finding that mattered more than the scores: self-pollution

An initial round of tuning ablations (wider retrieval, multi-hypothesis retrieval, result reordering) all produced large, confusing degradations. The cause was singular and is a **product finding, not a tuning detail**: `check_recipe`'s search has an append side-effect (the searching agent's hypothesis becomes a trace), so an agent that reads *and* writes the same corpus will, over repeated runs, retrieve its own recent task-shaped queries in place of durable recipes. We measured it directly — after five runs, about a third of retrieval slots were occupied by prior runs' own hypotheses, and accuracy fell monotonically 0.706 → 0.538 regardless of the tuning knob. This is the same failure the README's *Field data* section flags qualitatively ("batched checks retrieve the agent's own fresh traces"), here quantified.

Remediation, and what it demonstrated:

- **Isolate appends.** Hypothesis writes go to a scratch book; reads scope only to the frozen corpus. This restored the baseline.
- **Free reproduction.** The corpus was rebuilt into fresh books in 18 minutes at **zero embedding cost**, because the embedding cache is content-addressed across books and users — identical recipe text is never re-embedded. This is the mechanism that would let a third party reproduce the corpus cheaply.
- **Replication.** Re-running the baseline config on the independently-rebuilt corpus reproduced the original within noise (0.696 vs 0.706, all slices inside a measured ±0.05–0.08 run-to-run noise floor). The noise floor itself was measured from Type-1 rows, which receive byte-identical inputs across runs yet still varied by ~0.08 — which is why **no single-run slice delta in this doc is claimed as significant** without repeat runs.

On that clean footing, two attempts to *close* the Type-3 gap both failed honestly: divergent multi-hypothesis retrieval showed no effect beyond noise, and a server-side "synthesize the corpus into a profile" feature *degraded* Type-3 (0.697 vs 0.775) because the compressed profile displaced the specific evidence the model needed. That feature ships gated and opt-in; its prompt/injection design is being iterated against this benchmark before any performance claim is attached to it.

Product changes this campaign put into design: a read-only retrieval mode for MCP checks, same-agent-trace downranking, and feedback-driven ranking (reinforcement/decay). One bug found: `decided_at` is missing from the data-export format.

---

## Agentic benchmarks (in progress — no scored deltas yet)

PERMA tests *recognition* (pick the right answer given retrieved memory). Two harder benchmarks test an agent *doing work*. Both have passed ground-truth gates (arms wired, judges hand-audited); **neither has a settled delta** — reported here for transparency as the work develops.

- **π-Bench** (proactive personal-assistant agents, 20-session episodes; arXiv 2605.14678): the audited, *mechanistic* result is the interesting one — with Soup.net registered as an agent-callable tool and the standard briefing, the assistant **chose to consult its judgment memory unprompted**, wrote correctly-formed recipes, and showed no awareness it was under test. That is the product's core claim (an agent checking at the judgment moment) observed in an independent harness. Whether it raises the benchmark's Proactivity *score* is the next phase.
- **SWE-Lancer** (real freelance software tasks against one production codebase; arXiv 2502.12115): tests whether repo-specific judgment accumulated across tasks improves an agent's hiring-manager decisions. At a 20-task pilot: no-memory 0.45, naive-carryover 0.45, Soup.net 0.55 — the 2-task lead is **inside the noise floor at n=20, so no accuracy claim**. The *settled* result is again efficiency: Soup.net matched-or-beat the naive-carryover arm at ~100× less injected context (~440 vs ~47k tokens; the carryover arm overflowed its context budget and began dropping older transcripts with no accuracy gain). A larger run with repeats is the gate for any accuracy statement.

---

## Limitations (what a careful reviewer should hold against this)

- **Single runs, thin error bars.** Most cells here are one run. The measured noise floor is ±0.05–0.08 per slice, so the Type-2 "parity" and any sub-noise delta are *consistent with* — not proof of — the claim. Repeat runs (N≥3) are queued and not yet done.
- **One weak-ish model, one family.** Everything is Gemini 2.5 Flash, chosen for its published calibration row. Results may not transfer to frontier models or other families. Not yet tested.
- **Judge = answering model.** The MCQ judge and the answering agent are the same model. PERMA's MCQ grading is close to mechanical letter-matching (low risk), but the memory-score rubric is not, and we have not cross-checked it with an independent grader.
- **Synthetic, recognition, one split.** PERMA personas are synthetic; the task is multiple-choice recognition, not open production; we ran only the clean single-domain split (noise and multi-domain variants exist and were not run). The agentic benchmarks address the "real work" gap but have no deltas yet.
- **We built the integration.** The scribe/retrieval adapter is ours; a different integration could score differently. We report the scribe's added token cost so it isn't a hidden advantage, but the design is a choice a reviewer should scrutinize.
- **Self-run, as discussed up top.** The mitigations are real (third-party benchmark + judge, published-number calibration, per-task records, negatives reported) but they are mitigations, not independence. An outside replication would be worth more than anything here.

---

## Reproducing this

Everything needed to *reimplement* is public: PERMA (benchmark + dataset, arXiv 2603.23231), Soup.net itself (MIT — Postgres + pgvector + a Gemini embedding key; see the repo README), and the Methodology section above (scribe format, retrieval shape, model pins, split). The corpus-import path promised here now exists: `POST /import` accepts an `/auth/me/export` JSON file (up to 64 MiB by default; ~20 MB / 40k traces imports in seconds) and re-embeds asynchronously through the content-addressed vector cache, so loading a corpus whose text this instance has embedded before costs zero provider calls — exactly the cheap-reproduction path described above. The eval harness and the frozen recipe corpus that produced these exact numbers are not yet publicly hosted; until they are, reproduction means re-running the ingest against a local instance (~$35 of LLM calls) or importing a shared export once one is published. If you reproduce — or contradict — these results from an independent setup, that data is more valuable than ours; we'd want to hear about it.
