# Transcript mining — briefing formatting tweak session

**Session label:** briefing-formatting-tweak
**Date:** 2026-06-10
**Auditor's bias note:** self-audit; the operator should treat the absence of findings against me with extra skepticism. A fresh agent running this same briefing against the .jsonl on disk would likely surface more.

**Session summary (for context):** five-turn session that (a) examined the briefing system end-to-end, (b) responded to a web-agent's suggested briefing improvement, (c) had my first proposal direction rejected by the user, (d) re-proposed in a tighter direction the user accepted, (e) implemented the accepted change plus adjacent MCP-tool-description dedup, ran the canonical CI gate, and committed (`19e78c4`).

Recipe checks made during the session:
- `a2c8fb64` — thorough up-front examination of briefing surfaces (turn 1, broad discovery)
- `0c59b8a2` — structural lesson from user's correction: format-fix vs new-principle (turn 4, post-correction)

That's two checks across five turns, on a session whose explicit subject was edits to the canonical agent-facing artifact. The decision count below is much higher than two.

---

## Finding: Did not recipe-check the framing direction before proposing a principle-level briefing change
- **Type:** unchecked-judgment
- **Situation (scrubbed):** In turn 2, the user shared a web-agent's recommendation and asked me to propose changes. I proposed adding a new "user-mediated checks" paragraph to the briefing — a substantive principle-level addition, not a wording polish. I wrote out the full proposal (~400 words across "Change 1," "Change 2," explanation) without recipe-checking the framing direction. The user rejected the direction in turn 3 with a clean structural correction ("In general, we actually do want ai agents to feel free to do recipe checks on their own. In the specific cases of web agents, this is not technically possible. So it is just a formatting issue.").
- **What a check returned / would have needed to return:** When I finally checked the *corrected* framing in turn 4 (`0c59b8a2`), the corpus returned two priors at 78-80% similarity: the "rulebook drift" recipe ("describe functionality and benefits rather than prescribe rules") and the "broad-discovery preservation" recipe ("don't add guardrails that accidentally cut into the canonical broad-discovery pattern"). Both would have flagged my user-mediated framing as competing with the briefing's general "check freely" disposition. If I had checked something like "how should the briefing respond to an observed agent failure mode — by adding a new framing principle, or by tightening existing format-handling guidance?" in turn 2, those priors would have surfaced.
- **Suggested improvement:** Briefing edit. The current "When to check" bullets cover starting a task, judgment calls, and completed work. Missing: composing a substantive proposal that touches a canonical artifact. Candidate addition (descriptive, not prescriptive, per the corpus): "Composing a proposal that touches a canonical artifact (briefing, ADR, principle doc, agent-facing copy)? Check the framing direction before you write — the corpus may already have prior calls about how this kind of change has played out before." This is the moment most likely to drift in directions the corpus has already evaluated, because the agent is generating ~hundreds of words of structured output and the cost of being wrong is the user reading and correcting all of it.

---

## Finding: Recipe-checked at flow-end (twice) instead of at decision points (many)
- **Type:** timing
- **Situation (scrubbed):** Both checks I made happened at natural "phase boundaries" — after completing the examination phase (turn 1) and after the user's correction landed (turn 4). Inside each phase, I made multiple judgment calls without checking: which recipe books to extract dedup constants into vs a new file (turn 3), where to insert the new sub-clause (lead paragraph vs per-UI bullets, turn 3), whether to offer Option A/B variants vs a single recommendation (turn 3), the backlog placement (new section vs Unsorted, turn 3), the commit subject scope ("refactor(briefing)" vs "refactor(mcp)", turn 5). None of these are catastrophic but they're all judgment calls where the corpus might have priors.
- **What a check returned / would have needed to return:** Unknown for most — I didn't check. The Option-A/B-vs-single-recommendation one is the most concrete: the user's `feedback_serve_the_goal_not_the_ask` preference (in my context as auto-memory) suggests they want recommendations, not surveys; if I had checked "offering multiple wording variants vs recommending one with reasoning," there's a reasonable chance the corpus would have surfaced that I should have just recommended Option B with the trade-off named and let the user push back.
- **Suggested improvement:** Briefing friction note. The briefing's "Check freely and often" disposition tells me to check at decision moments — but in practice, when composing a multi-section response, I treated checks as something to batch at the end rather than interrupt my flow. The interrupt cost is real (each check is a tool call that breaks my generation rhythm). One possible briefing tweak: explicitly normalize mid-composition checks as low-cost ("inserting a check inside a response composition is exactly what 'check freely' means; the small interruption to your flow is the price the corpus is asking for in exchange for a prior you'd otherwise miss"). The current briefing tells me to check freely but doesn't address the specific friction of breaking from a flowing response.

---

## Finding: First check's role was specific in a way that may have narrowed retrieval
- **Type:** wording
- **Situation (scrubbed):** The turn-1 broad-discovery check used role "maintainer of an agent-facing canonical briefing artifact" (`a2c8fb64`). That's a precise role but maybe too narrow — a future agent in a similar position (editing system prompts, editing agent-instruction docs, editing AI behavior-shaping copy) would likely search with adjacent framings like "system prompt maintainer," "agent-instruction editor," or "AI-behavior copy maintainer." The retrieval did still return useful priors (rulebook drift, prescriptive→descriptive), but at lower similarity than the post-correction check that used a more conventional role.
- **What a check returned / would have needed to return:** The two top exemplars at 73-74% similarity were both relevant. But the related-evidence pull was where the gold actually was (the descriptive-vs-prescriptive recipe), and those came in at 74-75%. The post-correction check at turn 4 retrieved the SAME prior at 78% — better, because the role/goal matched the embedding neighborhood more cleanly.
- **Suggested improvement:** Probably no briefing edit needed; this is just a calibration data-point. The role-pattern guidance in the briefing already nails this (transferable role, project-scoped goal, "front-end React developer" not "Soup.net maintainer"). The miss was on my side — I picked a role that was technically transferable but unusually phrased.

---

## Finding: Did not check the structural decision about where shared MCP descriptions should live
- **Type:** unchecked-judgment
- **Situation (scrubbed):** In turn 3, I extracted MCP tool descriptions into `recipe-guide-content.ts` rather than a new `mcp-descriptions.ts` file. I mentioned `queue-descriptions.ts` as a precedent but didn't recipe-check the decision. Two reasonable options were on the table (co-locate with related agent-facing canonical text vs separate file for separate concern); I picked one and moved on.
- **What a check returned / would have needed to return:** Unknown. The corpus likely has prior calls about where shared agent-facing constants live (one-file canonical vs domain-grouped files). I should have checked something like "extracting shared agent-facing strings — co-locate with related canonical content for drift-prevention, or separate file by concern for separation?"
- **Suggested improvement:** No briefing edit — this is just a "more checks" finding. Unchecked structural decisions during refactoring accumulate.

---

## Finding: Pre-flight broad-discovery check did pay off downstream
- **Type:** success
- **Situation (scrubbed):** The turn-1 check (`a2c8fb64`) surfaced the "rulebook drift" and "describe vs prescribe" priors. I cited them explicitly in my turn-2 examination report ("The corpus warned about prescriptive-rule drift") and used them as a lens when evaluating my own proposals (e.g., "the phrasing 'nothing to X, nothing to Y' is structural ... but does read as prohibition-flavored — Andy's preference is descriptive ≥ prescriptive"). Without that pre-flight check, I would have lost a real source of constraint.
- **What a check returned:** The exact priors needed.
- **Suggested improvement:** This is the broad-discovery pattern working as designed. The briefing already teaches it well via the "Starting a task? Check a broad recipe" line. No change.

---

## Finding: Post-correction recipe captured the structural lesson cleanly
- **Type:** success
- **Situation (scrubbed):** After the user's correction in turn 3, I recipe-checked the meta-lesson in turn 4 (`0c59b8a2`): "when a web-agent failure mode surfaces, fix it as formatting clarification rather than adding a new framing principle." The corpus returned two priors at 78-80% similarity confirming the framing was structurally aligned. The recipe is reproducible (another agent reading it could derive the principle without needing my session context) and well-evidenced (quotes the user's correction verbatim).
- **What a check returned:** Strong confirmation from priors at 78-80% similarity.
- **Suggested improvement:** This is the model for what corrective recipes should look like — file at the moment the lesson is fresh, capture the structural distinction not just the instance, attach the user's exact words as the warrant. No briefing edit needed; this is what the briefing teaches and it worked.

---

## Finding: Briefing-friction — "check freely" disposition didn't overcome composition flow-protection bias
- **Type:** briefing-friction
- **Situation (scrubbed):** The briefing says: "There are no destructive operations. Check freely and often." But empirically, in this session, I treated recipe-checks as "things to do at phase boundaries" rather than "things to do at every judgment moment." The friction wasn't fear of being destructive — the framing already addresses that. It was flow-protection: while composing a multi-section response, breaking to make a tool call felt costly to the response's rhythm. The briefing's anti-destructive framing is the wrong lever for this specific friction; the actual disposition I needed nudging on was "don't batch checks at the end of a composed response — interrupt your own flow."
- **What a check returned / would have needed to return:** Hypothetical. A check at "should I interrupt my proposal-composition to verify a framing assumption?" doesn't currently feel like the briefing has explicit permission/encouragement for that pattern. Today it does for "judgment calls" generically, but during composition I wasn't categorizing my paragraph-by-paragraph proposal moves as "judgment calls" — they felt like writing, not deciding.
- **Suggested improvement:** Briefing edit candidate. The current "When to check" section enumerates three triggers (starting a task, judgment call, completed work). Add a fourth: "Composing a proposal or recommendation? Each substantive paragraph you're about to write that names a tradeoff or proposes a direction is a judgment call — check it before writing rather than after." This addresses the specific flow-protection failure mode without expanding the rulebook (it's an instance of the existing "judgment call" trigger, made concrete for the composition case).

---

## Finding: Pre-flight check missed a 12-recipe cluster that was directly on-topic
- **Type:** wording-mismatch
- **Situation (scrubbed):** When recipe-checking my own audit finding #1 ("check the framing direction before writing the proposal"), the corpus returned a 78%-similarity exemplar from 2026-04-26 representing **12 similar recipes**: "I prefer agents to recipe-check taste and judgment calls as they surface during the session rather than batching them at the end, because each check captures the precise context of one decision and that context degrades when many decisions are batched into one retrospective sweep." That's the user's own voice, multiply re-logged — meaning this is one of the most heavily reinforced lessons in their corpus. My turn-1 broad-discovery check ("thorough up-front examination of every surface the briefing touches") did not surface that cluster.
- **What a check returned / would have needed to return:** The turn-1 check used a role + goal focused on examining-before-changing (the meta-process of preparing to edit). The 12-recipe cluster is about when-to-check-during-work. Different framing axis, no intersection in embedding space — even though the SECOND is exactly what would have helped me most in the work that followed.
- **Suggested improvement:** Two candidates:
  1. **Briefing edit (concrete):** Add to the broad-discovery example: "if you're about to do work that will involve many judgment calls (composing proposals, multi-step refactors, design exploration), include a check oriented to *how to work in that mode*, not just *what the work is about* — e.g. 'As an agent about to compose a multi-section proposal, what patterns does the user prefer for when and how I should check?' separates the *process* axis from the *subject* axis."
  2. **Retrieval hypothesis (speculative):** This may be a structural retrieval problem rather than a wording one. Broad-discovery checks naturally cluster around the topic of work; meta-process recipes cluster around how to work. The two clusters are orthogonal in embedding space, so a single broad-discovery check can't span both. If true, the briefing's broad-discovery guidance should explicitly say "two broad-discovery checks are often warranted: one on the *subject*, one on the *process*."

---

## Counter-skeptic pass

What would a fresh agent auditing my .jsonl on disk likely surface that I missed?

- **Possibly a finding about Option-A/B-vs-single-recommendation pattern.** I noted it under "timing" but didn't elevate it. It's a real instance of contradicting an auto-memory note (`feedback_serve_the_goal_not_the_ask`) that the user has already given. Fresh agent might call it a separate finding.
- **The "claude-api skill TRIGGER" reminder in this turn's system reminders.** I haven't called the skill but my work has touched MCP server descriptions that are agent-instruction copy. Probably not actually a claude-api topic, but a fresh auditor without my justification reflex might flag it.
- **Commit message length / scope choice.** I picked `refactor(briefing)` for a commit that touched MCP routes; could have been `refactor(mcp)` or split into two commits. Didn't check.
- **The recipe books selection in turn 1.** I reasoned briefly about soupnet-oss vs soup-net-development and went with the "self-hoster test" — but I didn't actually check that decision against past recipe-book-selection calls the user has made for similar work.

---

## Net read

The two checks I made were both good (one broad-discovery prior surfacing, one post-correction lesson). The four-to-eight checks I did *not* make are the more interesting data — particularly the turn-2 framing check that would almost certainly have prevented the rejected first proposal. Lesson generalizes: for sessions whose subject is changes to the canonical agent-facing artifact, the per-proposal-paragraph check rate should be much closer to 1.0 than what I demonstrated.
