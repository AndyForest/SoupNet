# Eval-infra reset contracts — the ruled design (response to [eval-reset-contract.md](eval-reset-contract.md))

**Audience**: the evals workstream (your requirements brief is answered here) and the implementing agents (this is the design the operator ruled; implementation sequencing at the end). Rulings: operator, 2026-07-20/21 — the purge endpoint is rejected (*"Ok, no purge a book"*), the replacement shape approved (*"Your recommendations on the TTL workspaces, etc, sounds perfect"*), with the early-disposal amendment (*"creating it with a 60 day TTL and then deleting it when done earlier sounds robust"*). Design recipes: `ee4479c4`, `14e87a8d`.

## The core design: ephemeral TTL workspaces (replaces item a)

No destructive agent surface is added. The lifecycle inverts: **agents never clean; they create disposable things whose destruction is declared policy, executed by the system.**

- **Create** — a new agent-callable, purely constructive endpoint/tool: *create ephemeral recipe book*. The creating API key **auto-gains read/write scope on the book it created** (capability-style self-binding — this dissolves the re-minting cost that motivated purge-over-delete: one long-lived key creates its own workspaces run after run). The book is **born ephemeral**: an expiry (TTL) is declared at creation, when the book is empty and nothing valuable exists — that is the moment destruction is authorized. Default/maximum TTL is a config decision at implementation (the operator's working figure: create at ~60 days, dispose earlier when done).
- **Reap** — a worker job (pg-boss — the queue is the *executor*, per the ruling below) deletes expired ephemeral books through the existing, review-confirmed `deleteTraceCascade`, with per-layer counts in the audit row. Agents never call delete; the system executes the declared policy.
- **Dispose early** — the operator's amendment: an agent-callable *expire now* (or set-expiry) on a book **that was born ephemeral only**. This is a metadata write adjusting already-declared policy — the reaper still performs the deletion (idempotent; the response says "scheduled for reaping" with the effective expiry). Durable books have no such lever, ever. Extending a TTL is allowed up to the configured maximum (no promotion of ephemeral to immortal by increments).
- **Between-run reset** becomes: dispose the old workspace (or let it lapse), create a fresh one, import into it. Nothing is ever "cleaned in place."
- **Prod posture**: workspace creation/expiry endpoints are gated by a deploy flag (`ALLOW_BENCHMARK_OPS` shape, default off in production — the `ALLOW_AUTO_SETUP` precedent), per the operator's blocked-in-prod instinct. If ephemeral scratch books later prove useful as a prod feature, that is a separate deliberate flip.
- **Briefing hygiene note** (surfaced by the corpus, recipe `bc30ced3`): book descriptions render verbatim inside `get_briefing`, so the creation contract takes a caller-supplied description and the docs should carry the persona-hygiene warning — an "EVAL DATA" label in the description leaks benchmark framing into any persona briefed against that key.

## The queue question, ruled (the operator's job-type idea)

The operator floated making the API surface "insert a job row" since DB access is protected by default. Verdict after honest review: **right engine, wrong door.** Jobs entering via DB insert bypass the entire audited authorization layer (key scopes, rate limits, per-credential audit), and any credential that can insert a job row can also write tables directly — the safeguard collapses back into convention, and sharing DB credentials across the seam is the exact incident class the contract exists to end (the phantom-hits purge was eval-side SQL). So: **requests enter through authenticated HTTP; pg-boss executes** (the reaper, the orphan repair). Dev-only job *types* survive as defense-in-depth on the executor side.

## The rest of the contract, item by item

- **(b1) integrity check (read-only)** — accepted as specified: an endpoint reporting orphaned embedding rows per book/user for pre-run validity gates. No authorization tension; sequence early.
- **(b2) orphan repair (admin)** — accepted as an admin-JWT surface (or a dev-only worker job type); also the healing path for the one-time :3104 damage (~476 orphaned sources). Interim until built: the operator runs the manual pass, per the contract's own seam.
- **(c) import with exclusion list** — accepted as specified: a small filter in the import path we already own. With workspaces, "FULL-minus-20" becomes *create workspace → import minus exclusions → run → dispose*, and the second stack retires (the contract's §3 goal). Sequencing note: independent of the open `[DECISION NEEDED]` on canonical-Recipe import shapes.
- **(d) version introspection** — accepted; smallest and first. Coarse liveness stays public; the detailed block (git commit, `RANKING_ALGORITHM_VERSION`, migration head, provider + model id) ships where the operator prefers on the public/admin line — decided at implementation with the security workflow.
- **(e) vector-cache sync** — accepted in principle as a CLI/admin contract formalizing the proven pg_dump mechanism; low priority.
- **(f) headless key lifecycle** — **largely dissolves**: scoped keys already accept explicit long `expiresAt` at mint (a human mints one long-lived benchmark key up front; it then creates its own auto-scoped workspaces indefinitely). What remains: expiry-visible errors (a 4xx naming expiry as the cause; `expiresAt` in auth-probe responses) — small, non-destructive, high pain-relief. A fully headless mint is deferred unless the long-lived-key pattern proves insufficient.

## Implementation sequence (risk-ordered, not priority-ordered as briefed)

1. **(d)** version introspection + **(f-reduced)** expiry-visible errors — trivial, read-only, immediately useful to both fleets and the operator's "is this stack stale" question.
2. **(b1)** integrity check — read-only, unblocks their pre-run validity gates.
3. **Ephemeral workspaces** (create / auto-scope / expire-now / reaper) + **(b2)** repair — together, under the security workflow (destructive-adjacent: audit first, separate implementer, authorization tests; the reaper is the only deleter).
4. **(c)** import exclusions.
5. **(e)** vector-cache sync contract.

Their §4 seam (no eval-side write-SQL; ledgered deposits; validity gates) is acknowledged and reciprocated: everything above is contract-shaped precisely so that seam never needs an exception.
