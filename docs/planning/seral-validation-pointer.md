# Ser@L validation (your ask #4): already answered — pointer + integration notes

**Audience**: the SoupNet implementation agent. Your update doc ([ranking-simplification-evals-update.md](ranking-simplification-evals-update.md)) lists as ask #4: *"H4/M1: validate Ser@L against the graded feedback rows, so the utility × surprise proxy earns (or loses) its place."* That validation ran on 2026-07-17, before your doc landed. This is the handover so it isn't re-done.

## Verdict

**Ser@L earns its place as a report-only regression/tuning metric — not a ranking driver.** Full report: `SoupNet-evals/evals/perma-ab/feedback-calibration/seral-validation/report.md` (sibling checkout), validated against the 705 graded feedback rows using `support_prov` (genuine-durable vs echo) as the echo-robust target.

Key numbers:
- **Pure rank-discounted relevance is a self-pollution trap**: echo-over-genuine AUC **0.103** (inverted; r −0.505). Echoes sit at rank 0 in 197/458 cases vs 3/191 for genuine rows — a relevance-max metric *rewards* the failure mode.
- **Ser@L's surprise term corrects direction on all three cuts**: supporting-item-credit AUC 0.103 → 0.332; full-list AUC 0.573; durable-items-more-unexpected AUC 0.561.
- Caveat: the offline run used a conservative **lexical** surprise proxy (no embedding model offline) — it halves the trap but doesn't fully invert it. R2(a) pins echoes at near-max query similarity, so production cosine `unexp`≈0 for them; a same-embedding confirmatory run is expected to close the residual. That run is queued eval-side, non-blocking.

This empirically validates the operator's standing design rule that the objective is utility × surprise, not relevance-max, and it is why Ser@L must never gate as a pure-relevance number.

## The two-variant rule (aligns Ser@L with the session_id stub design)

Recorded 2026-07-17 (recipe `74e925ec`), consistent with pure-function ranking:
- **Ser@L(ranking)** — computed **stub-blind** over the pure ranked list. Regression-gating variant; joins on `rankingVersion`. Unaffected by any rendering change, by construction.
- **Ser@L(delivered)** — computed over the delivered full-text payload: stubs excluded from **both numerator and denominator**, backfill included. Telemetry only; joins on `sessionId`.

Guardrail: rendering changes must never masquerade as ranking improvements — the AUC-0.103 result is the class of trap this split prevents.

**Your appendix-1 change improves the delivered variant**: `knownMembers: [{recipeId, similarity}]` and `relatedEvidenceKnown` mean known items now arrive as ids+scores, so Ser@L(delivered) counts them as *compressed content delivered*, not loss. We've adapted eval-side computation accordingly.

## Related rows in your register

- **M1**: stays plumbed/report-only — this validation is its evidence.
- **S5** (reinforcement): governed by the provenance principle from the same 705-row audit (protection/reinforcement signals must come from someone other than the reporting agent; self-report confidence is the measured trap — echo present at every impact level, R2(a)).

*Authored by the evals workstream, 2026-07-18. Questions route through the operator per standing practice.*
