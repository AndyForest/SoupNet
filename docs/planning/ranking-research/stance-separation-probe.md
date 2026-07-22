# Stance separation probe — can the embedding tell a changed mind from a restatement? (2026-07-21)

The measured answer behind the authoring guidance in the recipe guide's §Authoring for retrieval ("a bare stance flip is a near-duplicate; the justification text is what separates a reversal"). Method and numbers here so the guide's claims have a citable source; raw scripts and per-case data live in the gitignored `eval/golden/slot-lab/` (see the `[DESIGN]` slot-lab entry in [the backlog](../../backlog.md) for the full experiment record).

## Question

Recipes are retrieved and displayed by cosine similarity over `gemini-embedding-2-preview` vectors (search, k-means on the map/briefing, MMR display selection). The negation literature (NevIR; ADR-0015's "embeddings encode topic, not stance") predicts a recipe and its stance-opposite embed nearly identically. When a human changes their mind and logs the new decision, does the new recipe separate from its predecessor — and what makes it separate?

## Method

All measurements on the operator's real corpus export (1,815 recipes, 2026-07-20) under `gemini-embedding-2-preview`, cosine over full-precision vectors, in an isolated throwaway database.

1. **Synthetic probe:** 24 diverse real recipes, each paired with three authored variants — a *paraphrase* (same stance, reworded — control), a *minimal negation* (stance flipped, wording otherwise untouched), and a *nuanced reversal* (same role/goal, opposite decision, new reason — the realistic changed-mind shape). Variants are test artifacts, never logged to any corpus.
2. **Labeled real pairs:** reversal arcs the operator named from memory, located in the corpus and measured directly.
3. **Doc example trio:** the invented example used in the guide, measured so its numbers are real.

Channel similarities use per-slot embeddings (role / goal / decision / reason, anchor-split from the enforced recipe grammar and embedded separately) from the same experiment.

## Results

**Synthetic probe** — full-text cosine to the original, mean over 24 cases:

| variant | full-text sim | below-control (paired) |
|---|---|---|
| paraphrase (control) | 0.960 | — |
| minimal negation | 0.903 | 24/24 full-text, but decision-channel only 19/24 and weak |
| nuanced reversal | 0.858 | 24/24 full-text, 23/24 decision channel |

**Labeled real pairs** (operator-named reversals; ids resolvable by corpus members):

| pair | full | role | decision |
|---|---|---|---|
| display-mechanism ruling, k-means → MMR, 3.5 months apart (`e1cad095` → `cf02cb6e`) | 0.700 | 0.780 | 0.674 |
| feature adoption → same-day removal, private project book (`56a3cadd` → `47fedadd`) | 0.726 | 0.900 | 0.671 |
| second recipe of the same arc (`4a80cac2` → `47fedadd`) | 0.736 | 0.900 | 0.717 |
| direction reversal two days apart, private project book (`03a546aa` → `d42c236f`) | 0.854 | 1.000 | 0.874 |

**Doc example trio** (texts in the recipe guide; measured verbatim):

| pair | full-text sim |
|---|---|
| original vs plain rephrase | 0.879 |
| original vs bare stance flip ("I no longer prefer…") | 0.859 |
| original vs justified reversal (new decision + new reason) | 0.807 |

## Findings

1. **A bare stance flip is geometrically a restatement.** The bare flip (0.859) sits inside the rephrase's neighborhood (0.879) — the embedding cannot tell a contradiction from a rewording, confirming ADR-0015's negation problem at recipe scale. Display mechanisms then treat the pair as duplicates: at the shipped MMR λ0.6, a candidate at ~0.86 similarity to an already-selected predecessor takes a ~0.34 marginal penalty and loses its display slot.
2. **The justification text is what separates a reversal.** Adding a new decision + new reason drops the synthetic pairs to 0.858 mean and the doc example to 0.807; the operator's real justification-rich reversals land at 0.700–0.736 — ordinary corpus neighbors, fully separated. The separation rides the new reasoning, not stance comprehension (finding 1 shows the model has none).
3. **Slot channels carry the reversal fingerprint.** Real reversals show role-channel similarity ≥ 0.78–1.00 with decision-channel 0.67–0.87 — context-high, decision-low — usable by any future detection lever without asking the embedding to understand negation.
4. **Consequence shipped (operator ruling 2026-07-21): authoring guidance, not machinery.** The recipe guide / briefing now tells authors that the new reasoning is what makes a changed mind findable as its own judgment. Reversal-aware *presentation* (dates + annotated near-twin stubs) remains a backlogged `[DESIGN]` follow-up for the terse-flip worst case, which guidance mitigates but cannot eliminate.
