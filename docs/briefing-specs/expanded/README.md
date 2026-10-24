# Expanded briefing: the untrimmed text, kept for ablation

Every trim to the briefing is a guess about what agents can do without. This folder keeps the untrimmed text of briefing copy beside a pointer to where its served form lives, so that the eval harness can later run agents on an expanded variant and on the served one and measure what each cut cost (ablation). Operator ruling, 2026-10-24 (recipe `a798b93d`): keep the pre-trim text now, chunk the whole briefing once the regression harness runs, and treat per-user selection of chunks as an experiment.

## What lives here

One file per briefing change that trimmed copy to fit a budget, for example [slice-7.md](slice-7.md). Each chunk has:

- an id (`<slice>.<name>`), stable so an eval can name it;
- where the served form lives (the constant in `packages/domain/src/recipe-guide-content.ts`, and the profile that serves it);
- the expanded text, verbatim, in a `text` block;
- what the trim removed and why.

## How it is used

- **Nothing serves these files.** The code never loads them, so the briefing agents receive cannot drift from them; the served text is always what `BRIEFING.build` composes. A chunk's expanded text is frozen as of its date; a later change to the served copy gets a new entry, not an edit here.
- **Ablation:** the harness composes a variant by substituting a chunk's expanded text for its served form (or dropping the chunk) and runs the `.feature` scenarios on both. Compare against a filler text of the same length: much apparent lift from a longer context is length alone (the research cited in recipe `ef844c32`).
- **Toward chunking (next step, behind the regression harness, recipe `aae000d2`):** the whole briefing as chunks with an expanded and a served form, the thin and full profiles as selections, and one test that the served briefing equals its assembled selection.
- **Toward per-user selection (later, an experiment):** chunks embedded and chosen by intent or purpose, through the goal-conditioned mode already plumbed off by default (recipe `0974b5fc`). Two conditions: a pinned core that always ships (truthfulness, the user's voice, check freely, the drafts guidance), since semantic selection drops what does not look relevant and norms rarely look relevant until they are broken; and chunks stored as their own kind, not as recipes in a book, so they never appear in search results or briefing clusters as someone's taste and judgment.
