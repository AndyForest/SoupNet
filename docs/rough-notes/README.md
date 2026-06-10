# Rough notes — working files that are meant to rot

Everything under this directory is **working material**: proposals, idea dumps, content explorations, half-designs. Nothing here is a fact, a commitment, or a current plan — including notes written yesterday. Do not cite a rough note as the source of truth for anything; if its contents were adopted, the truth lives wherever they were rolled up to.

## Why this directory exists

Documents rot. A proposal that was half-adopted reads, six months later, like a description of the system — and agents (and humans) take it at face value. The fix is containment: a directory whose contract is "this is allowed to be wrong," so the rest of `docs/` can keep the contract "this is maintained."

## Structure

- One subdirectory per working day: `docs/rough-notes/YYYY-MM-DD/`. The date marks when the note was **first created** — it is not a freshness claim.
- Editing notes in place is fine, including on later days; the note stays in its creation-date directory. Use git history (`git log --follow <file>`) when you need to know when something was edited. If an idea has evolved into something genuinely new, a fresh note in a new day's directory (linking back) usually reads better than a heavy rewrite — your call.

## Fidelity ladder

Plans have fidelities. A note graduates by being rolled up, not by being polished in place:

1. **`docs/rough-notes/YYYY-MM-DD/`** — idea dumps, content options, explorations. Allowed to be wrong, redundant, contradictory. Default landing place for anything new.
2. **`docs/planning/`** — validated proposals ready (or nearly ready) to implement: the design questions are answered, what remains is build. Promotion to here is a deliberate act, usually after operator review.
3. **Adopted** — the contents live in their durable home: `docs/adr/` for decisions, `docs/design-thinking.md` for product vision/personas/scenarios, `docs/backlog.md` for work items, `docs/architecture/` for how the code works, code + tests for behavior.

When you roll a note up, leave the note in place (it's the transactional history) — the creation-date directory and this README are what stop it from masquerading as current truth. Graduation happens by rollup, not by polishing a note until it looks authoritative.

The repo-wide directory map lives in the root [`README.md`](../../README.md); this file explains only this subdirectory.

## For AI agents

Read rough notes for context on what was being considered and why. Verify anything load-bearing against the durable docs or the code before acting on it. When asked to capture brainstorming, new ideas, or content options, write them here under today's date — not into the durable docs.
