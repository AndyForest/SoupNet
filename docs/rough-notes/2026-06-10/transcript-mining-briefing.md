# Transcript-Mining Briefing — paste into a live Claude Code session

> **Status:** Rough note (2026-06-10) — a paste-ready briefing the operator hands to other Claude Code sessions. Part of the source-material plan in [briefing-regression-testing.md](briefing-regression-testing.md) (§Source material, Track 3). The reports it produces feed scenario expansion, briefing edits, and retrieval hypotheses.
>
> **How to use:** copy everything below the rule into another Claude Code session — ideally one that has just finished (or is deep into) real work, with the Soup.net MCP connected. The session audits its own transcript and reports back. Reports land back in this repo under `docs/rough-notes/<date>/transcript-mining-report-*.md` (the operator carries them over if the session is in another project).

---

## Briefing: audit your own session's recipe-check effectiveness

You are working with a user whose taste and judgment is persisted in Soup.net via `check_recipe`. We are improving the system's agent-facing briefing, its teaching scenarios, and its retrieval quality — using evidence from real sessions instead of constructed examples. Your transcript is that evidence. Audit it honestly; misses are more valuable than successes here.

**Scope:** your current conversation from the start, plus (optional, if asked) earlier session transcripts on disk under `~/.claude/projects/<this-project>/*.jsonl`.

### What to look for

Walk your transcript and collect every **judgment call** — a moment where you chose between plausible alternatives on behalf of the user's taste or judgment (library/approach choices, wording/design decisions, scope calls, tradeoffs you weighed silently). For each one:

1. **Checked or not?** Did you recipe-check it? If not, why not — didn't occur to you, felt heavyweight, mid-reasoning and didn't want to break flow, didn't seem check-worthy? The *reason* is the finding: it tells us what in the briefing or tool description failed to trigger (or wrongly discouraged) the check.
2. **The counterfactual gap.** At that moment, what would you have *wanted* a recipe check to return? If you did check: did it return that? If the useful thing didn't come back, classify it: **corpus gap** (nobody ever logged it), **retrieval miss** (it exists — you saw it elsewhere — but didn't surface), or **wording mismatch** (your check's phrasing and the logged recipe's phrasing didn't meet in embedding space).
3. **Quality of the checks you made.** Timing — at the judgment moment, or batched later after your reasoning was gone? Wording — would a future agent in a similar position actually retrieve and benefit from it (transferable role, separate goal, explicit "so that")? Right recipe book? Reproducible — could another agent re-derive the judgment from the logged recipe alone? Calibrated — does the claim's confidence match the evidence you attached?
4. **Briefing friction.** Anything in the Soup.net briefing or tool descriptions that confused you, made checking feel risky/heavyweight, or that you ignored. Quote the specific line if you can.
5. **Successes.** Checks whose results concretely changed what you did next. Name the recipe and what changed.

### Report format

Write `docs/rough-notes/<today>/transcript-mining-report-<short-session-label>.md` (or hand the markdown back in chat if you can't write to the SoupNet repo). One entry per finding:

```markdown
## Finding: <one-line summary>
- **Type:** corpus-gap | retrieval-miss | wording-mismatch | unchecked-judgment | timing | voice | briefing-friction | success
- **Situation (scrubbed):** what was happening, 2-4 sentences
- **What a check returned / would have needed to return:**
- **Suggested improvement:** candidate scenario | briefing edit | retrieval hypothesis | KB entry — with a draft if you have one
```

**PII scrubbing — substitution, not deletion.** Replace real names with functional roles, project proper nouns with functional equivalents, private quotes/URLs with synthetic but structurally identical stand-ins. Keep the real *shape* of the interaction; nothing in the report should trace back to private content. Findings from private projects are welcome in scrubbed form.

### Recipe-check what you genuinely conclude

If this audit surfaces genuine, generalizable taste/judgment findings about how the user works with agents or how Soup.net should behave, recipe-check them (the `soupnet-oss` book for Soup.net-system findings; the project's own book for project findings). Only check what you actually hold with evidence from your transcript — an audit that fabricates recipes to look productive degrades the corpus this whole exercise is trying to improve. If you have no Soup.net tools in this session, skip the checks and just write the report.

### Calibration notes

- A session with zero findings is suspicious — every long session contains unchecked judgment calls. Look at the decisions you announced without explaining.
- A "the system worked great" report with no counterfactual gaps usually means the audit stayed at the summary level. Go decision by decision.
- Distinguish "I didn't need a check" (fine — say why) from "a check didn't occur to me" (a finding).
- You are auditing your own work, which biases toward self-justification (the corpus already separates audit from implementation roles for exactly this reason — recipe, 2026-04-01). Counter it: for every judgment call, ask "what would a skeptical second agent say I missed?" before writing "no finding." If the operator wants a stronger audit, a fresh session can run this same briefing against your transcript file on disk instead.
