# Premium LLM features — implementation briefing

**Purpose of this doc**: operator-approved build brief (2026-07-06) for Soup.net's first server-side LLM feature, for the implementing agent. Decision provenance: recipe trace [`70669fa0`](https://www.soup.net/traces/70669fa0-1328-41ea-a2ed-a190e7f5a274); benchmark motivation in `docs/benchmarks.md`. Nearby docs: `docs/backlog.md` (Data portability, and the LiteLLM-router item this brief adds); `SoupNet-evals/evals/perma-ab/` (the evidence base).

## The architecture departure, stated plainly

The README promises "No LLM runs on the server." This feature deliberately departs from that — scoped, opt-in, and reversible: server-side LLM calls happen **only** for users with the `premium` type **and** the specific feature flag enabled. The default experience remains LLM-free on the server. Update the README's phrasing when this ships (e.g. "No LLM runs on the server for the core check path; optional premium features use one").

## Gating model (build first)

1. **`premium` user type** — a user-level attribute; assigned manually by the admin in the existing web admin (no self-serve, no billing). Default: not premium.
2. **Per-feature opt-in flags** — on the user's preferences (natural home: the existing `user-preferences` schema in `packages/domain/src/user-preferences.ts`), surfaced on the user's settings page but only when the user is premium. A premium user with the flag off gets stock behavior. Recipe `74e9f4db` (flag-as-de-risk-mechanism) is the pattern precedent.
3. Enforcement server-side on every LLM-touching path: `premium && flag` or the request behaves exactly as today.

## Feature 1: retrieval synthesis (`synthesize`)

**What**: when a premium+flagged user's agent calls `check_recipe` with a new optional param `synthesize: true`, the server makes one LLM call that distills the returned exemplars + related evidence into a short "current preference profile" paragraph (their most decision-relevant judgments, newest-wins where recipes conflict, with recipe ids cited inline). Markdown responses gain a `## Synthesis` section above the exemplars; structured responses gain a `synthesis` string field. Non-premium callers passing the param get the normal response (silently no-op, plus a one-line hint that synthesis is a premium feature — do not error).

**Why**: controlled benchmarking (`docs/benchmarks.md`) found the cross-event integration gap is structural — retrieval breadth ablation was *negative* (more exemplars dilute); the failing tasks need the corpus *synthesized*, not enumerated. Traces: [`dd734ee0`](https://www.soup.net/traces/dd734ee0-01cd-4b5c-894a-abf7c34c3a65) (three-claims result), [`84141bb3`](https://www.soup.net/traces/84141bb3-edb7-4701-a2ad-3a1cfac8d8c2) (ablation + noise floor).

**Model/provider**: Gemini-class in prod — the operator's `GEMINI_API_KEY` already powering embeddings; same key, new env `SYNTHESIS_MODEL` (default `gemini-3.5-flash`). Keep the call behind a small provider seam (one function) so models swap by env. **Explicit non-goals now**: no per-user quota tracking, no rate budget, no billing — the user base is the operator and trusted individuals (that's *why* premium is manual). A LiteLLM-router deployment for per-user quota is a separate backlog item (added under Infrastructure in `docs/backlog.md`), so do not hand-roll quota here.

**Testability requirement**: the synthesis path must be exercisable via the API param alone (no UI dependency) — SoupNet-evals will A/B it on the PERMA benchmark (hypothesis H2) as soon as it ships, using the same eval account pattern as `evals/perma-ab/runbook.md`. Deterministic stub for tests (like the embeddings stub) so CI stays LLM-free.

**Prompt starting point**: the eval adapter's synthesis need is documented in `SoupNet-evals/evals/perma-ab/` — a profile that resolves conflicts newest-first (`decided_at`), keeps verbatim-quote fidelity (quote only what's in evidence), and stays under ~150 words. Truthfulness rules from the agent briefing apply to the synthesis text: it interprets, it must not invent.

## Feature 2 considered: server-side scribe — recommendation: NOT server-side (mostly)

The "scribe" (distilling a session into evidence-backed recipes) proved itself in the benchmark (39,528 recipes at 0.58% verbatim-quote failure; trace [`2093a9e0`](https://www.soup.net/traces/2093a9e0-dbd5-43ec-a245-ff7dee0dcfdf)). But for agent sessions it belongs **client-side**, and integrating it into off-the-shelf agents is feasible *today* without server LLM:

- **Claude Code**: a skill or SessionEnd hook that runs the scribe prompt with the client's own model and submits via `check_recipe` — the briefing already teaches the format; this just adds the end-of-session sweep. Deliverable as a published skill + a briefing section.
- **Codex / other MCP clients**: equivalent instructions in the briefing ("at session end, distill judgment calls you observed into recipes"); no client extension required, adherence varies by agent quality — measurable with the behavioral-specs harness.
- The reason client-side wins: the client's LLM already has the session in context (no transcript upload, no privacy expansion, no server cost), and it matches the product's stigmergy story — the agent that lived the session writes the trace.

**The one server-side scribe worth considering later** (not this build): premium "transcript import" — user uploads a conversation export, server scribes it into a chosen book. That's a natural companion to the corpus-import backlog item. Design-stage only.

## Phase-2 candidates (do NOT build now; recorded so the ideas don't drift)

- **Feedback-driven reinforcement/decay of retrieval ranking** — already designed and *gated behind offline evals* per trace [`eb291228`](https://www.soup.net/traces/eb291228-c857-45e7-bbb2-e788751d6791); the benchmark corpus + 705 fresh feedback rows are the eval data. Do not wire live ranking until that eval passes.
- **Feedback "gist" enrichment** — extend `log_feedback` with an optional re-phrasing of the recipe *as it proved useful* ("gist"), stored alongside the trace so future retrieval can match the use-shaped phrasing, not just the authoring-shaped one. Operator-suggested (2026-07-06); needs design for how gists affect embeddings without violating append-only truthfulness.

## Acceptance sketch

Premium off → all behavior byte-identical to today (including `synthesize` param no-op). Premium+flag on → `check_recipe {synthesize:true}` returns a synthesis section citing only returned recipe ids, ≤150 words, newest-wins on conflicts; one Gemini call per such check; CI green with the stub provider; admin can toggle premium per user in the web admin; README architecture line updated.
