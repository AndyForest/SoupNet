# Brief (draft, for the SoupNet implementation agent) — `max_chars` is a silent no-op on the MCP check surface

**Author**: the evals side (PERMA retrieval-budget sweep, 2026-07-26). **Status**: draft held in the
evals repo pending Andy's go — per the briefs practice this belongs in `SoupNet/docs/planning/` and is
executed by the SoupNet agent, not by an eval-side agent. **Benchmark-free wording** below; the
measurement appendix is the evals side's contribution.

## 1. The defect, in contract terms

Two agent-facing descriptions on the `check_recipe` MCP tool state that the character budget governs
the number of results:

- `clusters`: *"Result cluster count (default 3) … **Overridden by max_chars.**"*
- `max_chars`: *"Target response size in characters — **auto-clusters to fit**. 2000 for tight
  context, 5000 for detail."*

Neither is true on that surface. `max_chars` has **no observable effect on any MCP check response**,
in any combination:

| condition | response bytes | exemplars returned |
|---|---|---|
| `max_chars` 4,000 / 8,000 / 16,000 / 32,000 with `clusters=8` | 12,071 (identical) | 8 (identical) |
| `max_chars` 1,000 → 32,000 with `clusters` omitted | 5,233 (identical) | 3 (identical) |
| neither parameter | 5,233 | 3 |
| `clusters` 4 / 8 / 16 / 30 at fixed `max_chars` | 6,711 / 12,071 / 23,084 / 42,678 | 4 / 8 / 16 / 30 |

An agent doing exactly what the schema tells it — sizing its context budget with `max_chars` and
leaving `clusters` alone — receives three exemplars whether it asked for 2,000 characters or 32,000.

## 2. Mechanism (already localized; no investigation needed)

`routes/mcp.ts` substitutes a default cluster count on every call:

```ts
const MCP_DEFAULT_CLUSTERS = 3;
…
clusters: clusters ?? MCP_DEFAULT_CLUSTERS,
```

`clustering.service.ts::resolveK` consults the explicit count first and only falls through to the
character-budget estimator when it is null:

```ts
if (params.k != null)                                    k = params.k;
else if (params.maxChars != null && params.resultTexts)  k = estimateK(n, params.maxChars, params.resultTexts);
else                                                     k = Math.min(n, 3);
```

The default in the first file makes the second branch unreachable from MCP. The web/JSON route does
not have this problem: `routes/check.ts` applies `JSON_DEFAULT_CLUSTERS` only when
`!(params.clusters || params.maxChars)`, so `max_chars` alone reaches the estimator there. So the two
surfaces disagree with each other as well as with the docs. (Verified in the compiled bundle of a
running container, not only in source.)

## 3. What to decide (the product call, not ours)

Three coherent resolutions; they differ in what agents can express, so it is a design call:

1. **Make the docs true** — on MCP, apply the default cluster count only when `max_chars` is also
   absent (mirror the web route). `max_chars` then works as documented; explicit `clusters` still
   wins when both are passed, which contradicts *"Overridden by max_chars"* — so fix that sentence
   too, or…
2. **Make the code match the sentence** — when both are supplied, let `max_chars` cap the resolved
   `k`. Gives agents a hard context-budget guarantee, which is the property the parameter's name
   promises and the only one that is safe to rely on when evidence lengths vary.
3. **Retire the parameter from the MCP surface** — document `clusters` as the single budget lever and
   drop `max_chars` (or accept-and-ignore it with a deprecation note). Simplest, and consistent with
   the standing preference for fewer, simpler query-time levers rather than accreting ones.

The evals side has no stake in which; we do have a stake in the *contract being checkable*.

## 4. What the evals side asks for regardless of the choice

A **regression test that fails when a documented budget parameter stops moving the response** —
the class of defect here is "parameter silently ignored," which no current test catches because each
stage is individually correct. Concretely, a golden-corpus case that asserts, per surface (MCP and
web):

- monotonic non-decreasing delivered exemplar count as the budget parameter increases across a fixed
  ladder, and
- byte-difference between the smallest and largest budget on the same query.

This is cheap (embedding-cache-warm, no LLM), and it generalizes: the same shape guards `clusters`,
`session_id` stubbing, and any future budget knob. It fits the existing ranking regression harness
rather than needing new machinery.

## 5. Measurement appendix (evals side)

Method, raw numbers, `audit_log` confirmation and root-cause trace:
`SoupNet-evals/evals/perma-ab/baselines/budget-sweep-2026-07-26/preflight-maxchars-inert.md`.
Probe scripts (read-only against a throwaway eval corpus, ~14 MCP calls, no LLM inference):
`.../budget-sweep-2026-07-26/probe/`.

**Ownership litmus applied** (per the 2026-07-17 addendum: ask which side owns the problem before
proposing a product change). The eval-side workaround is trivial — our adapter already passes
`clusters` explicitly, so our harness was never actually starved. What is *not* eval-side fixable is
that the published tool schema tells every agent something false about a parameter it will reach for
when its context is tight. That is a product contract defect, and it is the only part of this we are
asking anyone to change.
