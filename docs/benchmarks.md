# Benchmark results

**What this is**: the controlled-benchmark complement to the README's observational *Field data*. We drop Soup.net into *published, third-party* agent-memory benchmarks as a swappable backend, run it against proper control arms, and report what happens — headline conclusions here, full reviewer-grade methodology on each benchmark's own page.

**On trusting a vendor's own benchmark.** These numbers are produced by the people who build Soup.net, on benchmarks we chose. That is the standard credibility problem for every agent-memory result (Mem0, Zep, MemOS and others all publish self-run numbers, and independent audits have found some inflated). We can't remove the conflict, only constrain it: the benchmarks and their graders are third-party code we did not write (SWE-Lancer's grader is deterministic — no LLM judge at all); one arm reproduces a *published* number as a calibration check; per-task results are recorded so any row can be re-derived; the model, prompts, and task splits are specified on each detail page; and **negative and null results are reported alongside the positives — they are half of what follows.** Judge the methodology, not the headline.

## What we found, across three benchmarks

Three conclusions hold across the suite:

1. **Against no memory, memory wins decisively.** On [PERMA](benchmarks/perma.md)'s preference-recall questions, Soup.net beats the no-memory floor by **+41 points** on single-event questions and **+36** on cross-event questions (0.411 → 0.823 / 0.766). The corpus does real work; this is the largest and clearest effect in the suite.

2. **Against *strong* memory baselines, the result is accuracy parity at a fraction of the context.** This is the replicated headline. Matching a strong baseline while injecting far less context showed up independently on all three benchmarks:
   - **PERMA** — parity with pasting the full transcript (0.823 vs 0.837 on single-event) at **~4% of the context** (1.1k vs 25.6k tokens).
   - **[SWE-Lancer](benchmarks/swelancer.md)** — parity with raw-transcript carryover on real hiring decisions (all arms ~0.51) at **~1/129th the injected context** (~398 vs ~51,400 tokens/task) and ~5.7× lower cost.
   - **[π-Bench](benchmarks/pibench.md)** — parity with a built-in per-session scribe while the agent consulted its memory only **23 times total across 5 episodes** — checking at moments *it* chose, versus the baseline re-injecting its whole memory file every session.

   Since durable cross-session, cross-agent, cross-vendor memory is the actual setting Soup.net targets — and "paste the entire history" isn't available there — matching that baseline's accuracy at a fraction of its context is the operative result.

3. **We report the nulls and the negatives, because they're the credibility.** The SWE-Lancer accuracy hypothesis (does accumulated repo-judgment beat no-memory?) came back **NULL** at n=100 — a directional pilot lead did not replicate; the arms are statistically indistinguishable on accuracy, and we do not claim otherwise. On PERMA, a real **cross-event deficit** remains against full-context (0.766 vs 0.827), and a server-side "synthesize the corpus into a profile" feature **degraded** that slice (0.697 vs 0.775) rather than fixing it. On π-Bench, the clean memory-channel comparison (π-2) is a **null** at parity. Each of these is stated plainly on its detail page.

The through-line: memory is decisive against nothing, and against a strong baseline its edge is **efficiency, not raw accuracy** — parity at a small fraction of the tokens. Where we hoped for an accuracy lift beyond that and didn't find one, we say so.

## Summary table

| Benchmark | What it tests | vs no-memory | vs strong baseline | Honest null / negative | Detail |
|---|---|---|---|---|---|
| **PERMA** | preference recall (MCQ) | **+36–41 pts** | parity at **~4%** context (1.1k vs 25.6k tok) | Type-3 cross-event deficit (0.766 vs 0.827); synthesis feature negative | [perma.md](benchmarks/perma.md) |
| **SWE-Lancer** | real hiring-decision accuracy | parity (null) | parity at **~1/129th** context (398 vs 51.4k tok), 5.7× cheaper | **accuracy hypothesis NULL** at n=100 | [swelancer.md](benchmarks/swelancer.md) |
| **π-Bench** *(preliminary)* | proactive-assistant proactivity | +0.167 PROC (confounded) | parity at **23 total** consultations vs per-session re-injection | π-2 clean comparison null; COMP flat (no search key) | [pibench.md](benchmarks/pibench.md) |

Numbers are single-run unless a detail page says otherwise; measured run-to-run noise is ±0.05–0.08 per slice, so sub-noise deltas are reported as parity, never as wins. Everything under **vs no-memory** and **vs strong baseline** is defined, sourced, and qualified on the linked pages.

## The behavioral result behind the scores

One finding isn't a score at all. On π-Bench, with Soup.net registered as an ordinary agent-callable tool and no orchestration forcing its use, the assistant **chose to consult its judgment memory unprompted**, wrote well-formed recipes, and showed no awareness it was under test. That "agent checks at the judgment moment" behavior — the product's core claim — was observed in an independent harness. Details on the [π-Bench page](benchmarks/pibench.md).

## A finding that changed the product: self-pollution

The PERMA campaign surfaced a product issue worth its own note: `check_recipe`'s search has an append side-effect, so an agent that both reads and writes the same corpus will, over repeated runs, start retrieving its own recent task-shaped queries instead of durable recipes — accuracy fell 0.706 → 0.538 over five runs before we caught it. The fix (isolate hypothesis writes to a scratch book, read only a frozen corpus) restored the baseline and drove real product changes: a read-only retrieval mode, same-agent-trace downranking, and feedback-driven ranking. The full measurement is on the [PERMA page](benchmarks/perma.md#the-finding-that-mattered-more-than-the-scores-self-pollution).

## Reproducing this

Each detail page carries the methodology needed to reimplement its benchmark: model pins, task splits, the scribe/retrieval design, and how every number traces back to per-task records. The benchmarks and datasets are all public (PERMA arXiv 2603.23231; SWE-Lancer arXiv 2502.12115; π-Bench arXiv 2605.14678), and Soup.net itself is MIT (Postgres + pgvector + a Gemini embedding key — see the repo README). The frozen recipe corpora that produced these exact numbers aren't publicly hosted yet; a corpus-import path is on the roadmap so a reader could load the exact corpus and reproduce cheaply via Soup.net's content-addressed embedding cache. Until then, reproduction means re-running the ingest against a local instance. If you reproduce — or contradict — any of this from an independent setup, that data is worth more than ours; we'd want to hear about it.
