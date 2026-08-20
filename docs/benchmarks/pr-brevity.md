# PR-brevity probe: what does a 90% shorter PR description cost the reviewer?

**What this is — and is not.** An in-house, self-designed probe, run 2026-08-20 by the Soup.net maintainers on Soup.net's own repository and live corpus. Unlike the suite's other pages ([PERMA](perma.md), [SWE-Lancer](swelancer.md), [π-Bench](pibench.md)), this is *not* a third-party benchmark: we wrote the questions, the short descriptions, and the gate key ourselves. It is held to the same reporting rules — every arm reported, nulls stated plainly, every number re-derivable from the materials on this page — but weigh it accordingly. Single run, n=2 PRs / 8 questions / 3 arms.

## The question

Coding agents write thorough but verbose PR descriptions; teams find them hard to read, and trimming them by prompt discipline alone is unreliable. The verbosity is a *where-does-the-reasoning-live* problem: the long body tries to carry every judgment call to every reader, charging its full reading cost up front whether or not that reader has questions. The alternative: a description short enough to actually read, with the reasoning recovered on demand — from the repository, or from a decision log the agents wrote as a side effect of working (Soup.net's recipe corpus). So the design measures **cost, not accuracy**: correctness is a gate every arm must clear (a reviewer's question must get answered, full stop), and the measured outcomes are the tokens, tool calls, and wall clock a fresh agent spends getting there — the agent's digging standing in as a proxy for the cognitive load a human reviewer would bear.

## Design

**Materials.** Two decision-dense merged PRs from this repository: [PR #53](https://github.com/AndyForest/SoupNet/pull/53) (web-URL feedback surfaces, 520 words) and [PR #44](https://github.com/AndyForest/SoupNet/pull/44) (MMR ranking default flip, 479 words). Each got a dramatically shortened replacement description — 40 words (#53, a 92% cut) and 50 words (#44, a 90% cut):

> feat(feedback): web-URL feedback surfaces
> Adds `feedback_*` ride-along params on `/check`, and `GET /feedback` (`?key=` auth) as a standalone fallback. Migration 0034 adds content-hash dedup so identical feedback resubmissions return the original row (`dup: true`). test:ci green; verified live on dev.

> feat(ranking)!: MMR display selection — default flip (version 2026-07-20-mmr)
> Display selection on the check path is now MMR over a score-banded pool, replacing the per-check k-means + fixed-pool + ordering stack (those remain as comparison arms; k-means still powers map/briefing summaries). Flat results, pagination, scores, wire schema unchanged. test:ci green.

**Questions.** Four per PR, phrased as what a human reviewer would actually ask: "What actual incident motivated this?", "What threat makes the dedup necessary?", "Will this double-log on form re-submit?", "Key in the URL — accepted pattern or new exposure?", "Was the flip ratified, and on what evidence?", "Why ship despite the worse redundancy metric?". Each answer exists in the original PR body; the gate key's load-bearing facts were extracted from those bodies.

**Arms.** Six fresh agents (Claude Code general-purpose subagents, model `claude-fable-5`, no conversation context, no memory), one per PR per arm, identical prompts except the PR text and tool access:

| Arm | PR description given | Repository working tree | Soup.net corpus (read-only search) |
|---|---|---|---|
| 1 | original (long) | yes | no |
| 2 | short | yes | no |
| 3 | short | yes | yes |

All arms have repo access (a reviewer's assistant has the repo). Git history and the gh CLI were forbidden everywhere — the long PR/commit text is the variable being removed. Corpus arms were restricted to `search_recipes`/`get_recipes` (nothing written during runs; see the [self-pollution finding](../benchmarks.md)) and received a three-line primer from the retrieval-strategy probes below. Every agent was told to answer "not found" rather than speculate.

**Leakage control.** This page's own v1 (published earlier the same day, containing a grading key) sits in the working tree. A first six-run pass had no rule about it; two runs encountered it mid-search and disclosed that, so the whole pass was discarded as leakage-exposed and all six runs were redone with an explicit exclusion rule ("do not open docs/benchmarks/pr-brevity.md or docs/benchmarks.md"). In the clean pass, three agents reported grep context lines incidentally brushing the file without opening it; their answers cite independent primary sources throughout.

**Gate.** A separate judge agent (same model, blind to arm identity, runs shuffled) graded all 24 cells PASS / MARGINAL / FAIL against per-question load-bearing requirements (e.g. #53 Q2 requires naming the prefetching link-preview-unfurler/URL-sanitizer class, not generic retries; #44 Q2 requires the ruling *"Ok, the side-by-side sells it, flip to mmr"* plus the side-by-side as decisive evidence).

## Gate result: 24/24 PASS

Every arm passed every question — no MARGINAL, no FAIL, and per the judge's notes, "no cells relied on flagged derivation from adjacent principles — every run asserted its load-bearing specifics directly." In the judge's words: "correctness does not differentiate the arms, so the cost measurements can be compared directly." (This ceiling is partly a property of this repository — see Reading 3.)

## Cost results

Per-agent totals as reported by the Claude Code Agent harness (`subagent_tokens` / `tool_uses` / `duration_ms`):

| Arm | PR #53 | PR #44 |
|---|---|---|
| 1 — original long PR | 65,883 tok · 11 calls · 70 s | 49,713 tok · 5 calls · 50 s |
| 2 — short PR | 74,156 tok · 13 calls · 93 s | 50,728 tok · 5 calls · 47 s |
| 3 — short PR + corpus | 98,338 tok · 20 calls · 133 s | 61,075 tok · 9 calls · 68 s |

**Reading 1 — the headline: deleting 90% of the PR barely moved the recovery cost.** Arm 2 vs arm 1: +2.0% tokens and identical tool calls on #44 (50,728 vs 49,713; 5 = 5), +12.6% tokens and +2 calls on #53 (74,156 vs 65,883). The reason is visible in the transcripts: a fresh agent handed the full 520-word body *still* verified its claims against primary sources (arm 1 on #53 made 11 tool calls) — so the long body's detail purchases little even for the agent, while charging every human reader its full length up front. The long description is mostly reader tax.

**Reading 2 — the cost model this implies.** A long description is an up-front broadcast: every reader pays ~500 words whether or not they have questions. A short description plus retrievable reasoning is pay-per-question: 40–50 words up front, and the recovery cost lands only on the reader who actually asks — and, when the asker is an agent, at the token prices above rather than human reading time. The break-even favors short descriptions as reviewer count grows and question rate stays below one-per-reader, which matches how PRs are actually read.

**Reading 3 — what the corpus arm buys here, honestly.** Arm 3 cost the most (+32.6% tokens vs arm 2 on #53, +20.4% on #44): given both channels, agents searched the corpus *in addition to* reading a tree that — in this repository — already carries the reasoning (route headers narrate the motivating incident; the ranking changelog records the ruling verbatim; this is the v1 pilot's ceiling finding, below). What the spend bought is provenance the tree cannot give: the operator's decisions in the operator's own words with dates and lineage — arm 3's answers quote *"I'd like it to be so that if behind-the-scenes preview/sanitizate/other steps pre-loads it or something"* (the idempotency ruling, recipe `7c585a19`) and cite the F24/ALB tradeoff recipe (`58971a9b`) where arm 2 reconstructs the same conclusions from code comments. On a repository whose tree does *not* carry decision rationale — most repositories — arm 2 has nothing to reconstruct from, and the corpus becomes the only recovery channel; that external-validity claim is untested here and is the natural next run. The existing evidence pointing that way is the v1 pilot's corpus-only arm: 7 of 8 reasoning facts recovered with *zero* repository access.

## Pilot (v1, same day): accuracy ceiling and the corpus-only arm

The first version of this probe measured accuracy instead of cost: archaeology-style questions whose answers lived only in the original PR bodies, graded 0/0.5/1 by a blind judge. Result: short-PR + repo scored 8.0/8, short-PR + repo + corpus 7.5/8, and **short-PR + corpus with no repository access at all scored 7.0/8** — including the operator's verbatim rulings, with honest "not found" on the two sub-decisions never logged as recipes ("no cell scored 0; no run invented facts contradicting the key"). The 8.0/8 no-corpus ceiling is what reframed the probe: on this repository, accuracy cannot differentiate the channels because the tree itself carries the reasoning, so accuracy became v2's gate and cost became the measurement. The pilot's cost figures are not comparable to v2's (no meta-document exclusion rule; two runs disclosed encountering the v1 page) and are superseded by the clean-protocol table above.

## Finding a PR's decisions: retrieval-strategy probes

The corpus arms' search primer came from a strategy validation run against a ground truth this repository happens to provide: PR descriptions and commits here cite the recipe ids of the decisions behind them (PR #53's "Corpus trail" names `1cabe8ad`, `e9c5aa23`, `7828d4c8`, `abddb65d`, `86f6bc53`, `4b97ba86` plus five check ids; PR #71 cites `5db8edc5`, `303e17cf`). A retrieval strategy is scored on whether it re-finds the cited decisions. Four strategies, exact queries preserved:

| Strategy | Query (verbatim) | Cited-decision hits | Verdict |
|---|---|---|---|
| S0 — quoted changed filenames | `("feedback.service.ts" OR "feedback.ts" OR "check.ts" OR "check-feedback.ts") author:anyone` | 2 of 6 rulings (`abddb65d`, `7828d4c8`) among 10 exemplars, 14 results | Supplementary. Hits arrive through evidence *citations* (recipes that quote code headers as precedent); most decision recipes don't cite the changed files — the file is the decision's output, not its evidence. |
| S1 — author + date range only | `author:me after:2026-07-20 before:2026-07-22` | 2 of 11 ids in exemplars (`7c585a19`, `3220a98a`), 33 results across 2 pages | Drowns. The window returns every parallel workstream from those days, and clustering compresses 33 results to 10 exemplars, hiding cited ids as non-exemplar members. |
| S2a — extracted decision, semantic, unbounded | e.g. `idempotent agent write surfaces so URL prefetchers, link-preview bots, and retries cannot double-submit author:anyone` | Rank-1 hits in 3 of 4 probes: `7c585a19` at 0.84, `1cabe8ad` at 0.80, `5db8edc5` at 0.71; the fourth probe missed its cited id but surfaced the same judgment area at 0.80 | **Winner.** One semantic query per extracted decision. |
| S2b — extracted decision, date-bounded | the S2a parity query + `after:2026-07-20 before:2026-07-22` | Recovers the PR's own decision trail (`ce81794e`, `4795e19a`, `3220a98a`) — and *drops* the 2026-04-03 precedent `1cabe8ad` from exemplars | Complementary, not competing. Bounded finds decisions *made during* the work; unbounded finds precedents *applied* in it. Run extraction twice. |

The load-bearing observation behind S2a/S2b: a PR's related decisions split into two populations with different timestamps — rulings made during the work (date-local) and standing precedents applied in it (often months old; `1cabe8ad` predates PR #53 by 3.5 months). Any strategy with a mandatory date window structurally misses the second population. Two practical notes for agents: results exclude the caller's own recipes by default, so PR archaeology over your operator's corpus needs `author:me`/`author:anyone`; and the related-evidence section of a response is not date-filtered, which is how one bounded probe still surfaced the old precedent.

## Limitations

- Self-designed, self-run, single-shot: n=2 PRs, 8 questions, one clean run per arm, one judge pass. No run-to-run variance estimate; wall-clock durations also absorb API-load noise, so tokens and tool calls are the sturdier cost proxies. Treat small deltas accordingly.
- The question author, the short-description author, the gate key, the subject repository, and the corpus all come from the same operator; the answer agents and judge share one model family (`claude-fable-5`).
- Cost is measured on an *agent* recovering the reasoning; human reading cost of a 520-word body vs a 40-word body is asserted from the word counts, not measured on humans.
- This repository is an unusually strong arm-2 environment (reasoning-dense code comments, decision-bearing docs, in-tree recipe-id pointers) — the 24/24 gate and arm 2's low cost both lean on that. On repositories without that discipline, arm 2 should degrade toward FAIL or expensive digging while arm 3's mechanism is unchanged; that claim is untested here and is the natural next run.
- The in-tree meta-document exclusion (leakage control above) is a protocol artifact of benchmarking a repo against itself; real deployments have no such file.

## Reproducibility

Run date 2026-08-20 against the live corpus (1,123 recipes in the searched scope at run time, ranking version `2026-07-20-mmr`, both echoed in every search response; the corpus grows, so absolute scores and counts will drift). Materials: the six answer-agent prompts (arm rules + PR texts + questions, quoted above), the gate key with per-question PASS requirements, the blind judge prompt and full verdict table, and the four strategy-probe queries exactly as listed. All experimental corpus access was read-only (`search_recipes`/`get_recipes`, `response_format=structured`); the append path was never invoked by any experimental agent. The original PR bodies remain on GitHub (#53, #44) as the source of the gate key.
