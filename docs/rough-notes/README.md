# Rough notes live in the private repo — not here

This directory is intentionally empty in the open-source repo. **Rough notes go in the private deployment repo's `docs/rough-notes/`, not here.**

## Why

Rough notes are working material — proposals, idea dumps, content explorations, half-designs. They are allowed to be wrong, redundant, and contradictory (that's the point). Two properties make them a poor fit for a public repo:

- **Wrong-by-design content in a public repo misleads.** A half-adopted proposal reads, months later, like a description of the system, and public readers (and their agents) have no signal that it was never true. Containment only works if the reader knows the contract; outside contributors won't.
- **Rough notes routinely touch private material** — hosted deployment, infra, business strategy, unreleased plans, operator context — the same public/private split we apply everywhere else in this repo.

So rough notes rot in private, and only their **rolled-up** conclusions graduate into this repo's durable docs (`docs/adr/`, `docs/design-thinking.md`, `docs/backlog.md`, `docs/architecture/`, code + tests). Graduation happens by rollup, not by polishing a note until it looks authoritative — see the private repo's `docs/rough-notes/README.md` for the full fidelity ladder.

## For AI agents

When asked to capture brainstorming, content options, or explorations, write them to the **private** repo under `docs/rough-notes/YYYY-MM-DD/` — never into this repo's durable docs, and not here. This directory is gitignored (except this README) so stray notes written here won't be committed by accident.
