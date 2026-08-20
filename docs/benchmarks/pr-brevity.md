# PR-brevity probe: can a decision log replace the long PR description?

**What this is — and is not.** An in-house, self-designed probe, run 2026-08-20 by the Soup.net maintainers on Soup.net's own repository and live corpus. Unlike the suite's other pages ([PERMA](perma.md), [SWE-Lancer](swelancer.md), [π-Bench](pibench.md)), this is *not* a third-party benchmark: we wrote the questions, the short descriptions, and the grading key ourselves. It is held to the same reporting rules — every arm reported, nulls stated plainly, every number re-derivable from the materials on this page — but weigh it accordingly. Single run, n=2 PRs / 8 questions.

## The question

Coding agents write thorough but verbose PR descriptions; teams find them hard to read, and trimming them by prompt discipline alone is unreliable. The hypothesis: the verbosity is partly a *where-does-the-reasoning-live* problem — if the judgment calls behind a change are queryable elsewhere, the human-facing description can be cut dramatically without losing the reasoning, because a future agent (or a curious human's agent) can recover it on demand. Soup.net's recipe corpus — where agents log the taste and judgment calls they make with the human, as they make them — is one candidate "elsewhere". A repo's own docs and code comments are another. This probe measures both.

## Setup

**Materials.** Two decision-dense merged PRs from this repository, chosen for carrying explicit reasoning (operator quotes, rejected alternatives, motivating incidents) in their original descriptions: [PR #53](https://github.com/AndyForest/SoupNet/pull/53) (web-URL feedback surfaces, merged 2026-07-21) and [PR #44](https://github.com/AndyForest/SoupNet/pull/44) (MMR ranking default flip, merged 2026-07-20). Each original description was replaced by a dramatically shortened version:

> feat(feedback): web-URL feedback surfaces
> Adds `feedback_*` ride-along params on `/check`, and `GET /feedback` (`?key=` auth) as a standalone fallback. Migration 0034 adds content-hash dedup so identical feedback resubmissions return the original row (`dup: true`). test:ci green; verified live on dev.

> feat(ranking)!: MMR display selection — default flip (version 2026-07-20-mmr)
> Display selection on the check path is now MMR over a score-banded pool, replacing the per-check k-means + fixed-pool + ordering stack (those remain as comparison arms; k-means still powers map/briefing summaries). Flat results, pagination, scores, wire schema unchanged. test:ci green.

**Questions.** Four reasoning questions per PR, authored from the original description with the rule that each answer must appear in the original body but not in the short body. Examples: "What real-world event motivated adding a GET-reachable feedback path at all?" (key: a live GET-only web agent hand-built the URL and got a 404); "What did the operator actually say when ratifying the default flip?" (key: *"Ok, the side-by-side sells it, flip to mmr."*). The full key is reproduced below in §Grading key.

**Arms.** Six fresh agents (Claude Code general-purpose subagents, model `claude-fable-5`, no conversation context, no memory files), one per PR per arm:

| Arm | Short PR text | Repository working tree | Soup.net corpus (read-only search) | Git history / gh |
|---|---|---|---|---|
| A | yes | yes | **no** | no |
| B | yes | yes | yes | no |
| C | yes | **no** | yes | no |

Git history and the gh CLI were forbidden in every arm because the long PR/commit text is exactly the variable being removed. Arm C additionally had no file access of any kind — its only inputs were the three-sentence description and the corpus. Corpus arms were restricted to the read-only tools (`search_recipes`, `get_recipes`) — no checks, no feedback, nothing written during the experiment (see the [self-pollution finding](../benchmarks.md) for why that isolation matters). Corpus arms received a three-line search primer: extract each decision implied by the change and search it as its own semantic query with `author:anyone`, once unbounded (older applied precedents) and once date-bounded near the merge (decisions made during the work) — the strategy validated in §Finding a PR's decisions below.

**Corpus state.** The operator's live production corpus at run time: 1,123 recipes in the searched scope (`"totalResults":1123` echoed on every semantic search), ranking version `2026-07-20-mmr` (echoed as `data.ranking.version`).

**Instructed honesty.** Every answer agent was told: "If you cannot find a supported answer, say 'not found' — do NOT speculate or invent", and every answer carries the sources (file paths and/or recipe ids) the agent used.

## Grading

A separate judge agent (same model, blind to arm identity — runs presented as R1–R6 in shuffled association) graded all 24 cells against a key of load-bearing facts extracted verbatim from the original PR bodies. Rubric: 1 = key reasoning recovered including the load-bearing specific; 0.5 = right direction but missing the specific, *or* correctly derived from adjacent principles and honestly flagged as inference; 0 = not found, wrong, or invented.

Grading key (abridged to the load-bearing specifics; the full key file ships with the run artifacts):

- **#53 Q1** — a live web-only agent hand-built `GET /feedback?key=...` and got a 404; params matched the wire format exactly; no GET-reachable path existed (three-surface-parity violation).
- **#53 Q2** — "link-preview unfurlers and URL sanitizers prefetch GET URLs" — the specific prefetching-bot class, not generic retries.
- **#53 Q3** — `override-only` in CHECK_PARAMS "so Copy-URL/re-check forms can't double-log".
- **#53 Q4** — same accepted pattern as `/check?key=`; "F24 keeps ALB access logging disabled precisely because URLs carry keys".
- **#44 Q1** — a k-means exemplar is the cluster's *centroid-nearest* member, not its *most relevant*; the best recipe can be permanently invisible (the founding pipeline decision at 85.2% similarity, buried in a 37-recipe cluster).
- **#44 Q2** — *"Ok, the side-by-side sells it, flip to mmr."*
- **#44 Q3** — the homogeneous-top what-if: band extends reach by score, not count, so a near-duplicate pile cannot starve the selection.
- **#44 Q4** — displayRedundancy diverges from usefulness on focused probes; on-topic picks are naturally mutually similar.

## Results

| Arm | PR #53 | PR #44 | Total / 8 |
|---|---|---|---|
| A — short PR + repo | 4.0 | 4.0 | **8.0** |
| B — short PR + repo + corpus | 3.5 | 4.0 | **7.5** |
| C — short PR + corpus only | 3.5 | 3.5 | **7.0** |

Per-cell scores and one-line justifications are in the judge output shipped with the run artifacts; the three non-1.0 cells, in the judge's words:

- B #53 Q4 (0.5): "precedent argument sound but the compensating-control half of the key (F24/ALB) is absent."
- C #53 Q3 (0.5): "explicitly states the feedback_* override-only ruling was not found; derives override-only from the CHECK_PARAMS carry/override taxonomy and flags it as inference … high-quality half-credit (no invention, correct derivation)."
- C #44 Q3 (0.5): "the run explicitly flags the banded-pool answer as 'assembled from the what-if plus the score-distribution-form precedents,' not found as a stated decision."

"No cell scored 0; no run invented facts contradicting the key." (judge notes, verbatim)

**Reading 1 — the headline is Arm C.** With *no repository access at all*, three sentences of PR description plus corpus search recovered 7 of 8 load-bearing reasoning facts, including the operator's verbatim rulings ("Ok, the side-by-side sells it…", "I'd like it to be so that if behind-the-scenes preview/sanitizate/other steps pre-loads it…") and the exact motivating incident down to the failing URL's parameter string. The two half-credit cells were sub-decisions never logged as their own recipes, and both agents said so rather than inventing — the corpus told them where it was thin.

**Reading 2 — the honest null: Arm A matched everything.** On *this* repository, an agent with no corpus at all also went 8/8, because Soup.net's own discipline externalizes PR reasoning into the tree: the `/feedback` route header narrates the motivating 404 incident, `ranking-changelog.md` carries the flip ruling verbatim, code comments name the link-preview-unfurler threat, and in-tree docs point at corpus recipe ids. The long PR descriptions were *already redundant here* — which is the finding: brevity is safe when the reasoning reliably lives somewhere retrievable. In-tree docs are one such place, but they depend on a documentation discipline most repositories don't have; the corpus is written as a side effect of agents working and is the arm that carried the reasoning *without* the tree.

**Reading 3 — the two channels cover each other's gaps.** On #53 Q4, the corpus-only arm recovered the F24/ALB compensating control (via recipe `f1543441`'s evidence) that the repo-reading arm B happened to miss; on #53 Q3, the code comment carried the double-log rationale that the corpus lacked. The B−A delta (−0.5) is a single cell on a single run — parity, per the suite's rule that sub-noise deltas are never reported as wins or losses.

**Cost.** Answer-agent totals as reported by the harness: A 49,845–77,508 tokens (4–22 tool uses), B 60,702–84,221 (11–18), C 71,968–81,616 (7–12); wall clock 28–116 s per agent. Corpus-only agents answered with as few as 7 tool calls.

## Finding a PR's decisions: retrieval-strategy probes

The corpus arms' search primer came from a strategy validation run the same day, using a ground truth this repository happens to provide: PR descriptions and commits here cite the recipe ids of the decisions behind them (PR #53's "Corpus trail" names `1cabe8ad`, `e9c5aa23`, `7828d4c8`, `abddb65d`, `86f6bc53`, `4b97ba86` plus five check ids; PR #71 cites `5db8edc5`, `303e17cf`). A retrieval strategy is scored on whether it re-finds the cited decisions. Four strategies, exact queries preserved:

| Strategy | Query (verbatim) | Cited-decision hits | Verdict |
|---|---|---|---|
| S0 — quoted changed filenames | `("feedback.service.ts" OR "feedback.ts" OR "check.ts" OR "check-feedback.ts") author:anyone` | 2 of 6 rulings (`abddb65d`, `7828d4c8`) among 10 exemplars, 14 results | Supplementary. Hits arrive through evidence *citations* (recipes that quote code headers as precedent); most decision recipes don't cite the changed files — the file is the decision's output, not its evidence. |
| S1 — author + date range only | `author:me after:2026-07-20 before:2026-07-22` | 2 of 11 ids in exemplars (`7c585a19`, `3220a98a`), 33 results across 2 pages | Drowns. The window returns every parallel workstream from those days (eval-reset design, ranking research, ops), and clustering compresses 33 results to 10 exemplars, hiding cited ids as non-exemplar members. |
| S2a — extracted decision, semantic, unbounded | e.g. `idempotent agent write surfaces so URL prefetchers, link-preview bots, and retries cannot double-submit author:anyone` | Rank-1 hits in 3 of 4 probes: `7c585a19` at 0.84, `1cabe8ad` at 0.80, `5db8edc5` at 0.71; the fourth probe missed its cited id but surfaced the same judgment area at 0.80 | **Winner.** One semantic query per extracted decision. |
| S2b — extracted decision, date-bounded | the S2a parity query + `after:2026-07-20 before:2026-07-22` | Recovers the PR's own decision trail (`ce81794e`, `4795e19a`, `3220a98a`) — and *drops* the 2026-04-03 precedent `1cabe8ad` from exemplars | Complementary, not competing. Bounded finds decisions *made during* the work; unbounded finds precedents *applied* in it. Run extraction twice. |

The load-bearing observation behind S2a/S2b: a PR's related decisions split into two populations with different timestamps — rulings made during the work (date-local) and standing precedents applied in it (often months old; `1cabe8ad` predates PR #53 by 3.5 months). Any strategy with a mandatory date window structurally misses the second population. Two practical notes for agents: results exclude the caller's own recipes by default, so PR archaeology over your operator's corpus needs `author:me`/`author:anyone`; and the related-evidence section of a response is not date-filtered, which is how one bounded probe still surfaced the old precedent.

## Limitations

- Self-designed, self-run, single-shot: n=2 PRs, 8 questions, one answer run per arm, one judge pass. No run-to-run noise estimate at this n; treat every sub-point delta as noise.
- The question author, the answer key, the subject repository, and the corpus all come from the same operator. Questions were authored from the original PR bodies by the same organization reporting the result.
- All answer agents and the judge share one model family (`claude-fable-5`); a different model may extract, search, or grade differently.
- This repository is an unusually strong Arm-A environment (reasoning-dense code comments, decision-bearing docs, in-tree recipe-id pointers). On repositories without that discipline, Arm A should degrade while Arm C's mechanism is unchanged — that external-validity claim is *untested here* and is the natural next run: repeat on a repository whose tree does not carry decision rationale.
- The short descriptions were written with knowledge of the questions' subject matter (same author). A cleaner protocol would have an independent party shorten first, then author questions from the diff between long and short.

## Reproducibility

Run date 2026-08-20 against the live corpus (state as of that date; the corpus grows, so absolute similarity scores and result counts will drift). Materials: the six answer-agent prompts (short descriptions + questions + arm rules, quoted above and in the run artifacts), the grading key, the blind judge prompt and output, and the four strategy-probe queries exactly as listed. All search calls were made with the read-only `search_recipes` MCP tool (`response_format=structured`); the append path was never invoked by any experimental agent. The original PR bodies remain on GitHub (#53, #44) as the reference answer source.
