# Recipe Check Behavior Extraction Prompt

Copy-paste this into a previous Claude Code session that used Soup.net recipe checks. The session will review its own history and extract examples useful for building QA test rubrics.

---

## Prompt to paste:

```
I need you to review our conversation history and extract examples of Soup.net recipe check behavior — both good and bad. This is for building a QA rubric that tests whether fresh AI agents understand the Soup.net recipe check system correctly. Make sure you understand the purpose and functionality of soupnet thoroughly to inform your tasks by such methods as re-reading the current up to date soupnet mcp description now with the get_briefing call, confirming assumptions with recipe checks, asking questions, etc.

For each recipe check you made (or should have made but didn't), extract:

1. **The trigger** — What happened right before? (User stated a preference, you faced a judgment call, you started a task, you completed work, etc.)
2. **What you checked** — The actual recipe text and evidence you used
3. **The timing** — Did you check before acting, after, or as a side effect? Was it blocking or async?
4. **What came back** — Did the corpus return useful context? Did it change your approach?
5. **Quality assessment** — Looking back:
   - Was the recipe genuine (your actual understanding) or fabricated to match something?
   - Was the evidence concrete (user quotes, artifacts) or vague (generic claims)?
   - Was the perspective correct (user's role) or wrong (agent's perspective)?
   - Was the context specific enough (project/tool names) or too generic?

Also extract these specific patterns if they occurred:

**Missed checks** — Moments where a recipe check would have been valuable but you didn't make one. What was the decision point? Why didn't you check?

**The unique value moment** — Any time the corpus returned something from a different session, a different agent, or a different project that you couldn't have known about. What was it? How did it change what you did?

**The assumption spectrum** — Cases where you had thin evidence for an assumption:
- Did you proceed anyway (low impact)?
- Did you recipe check as a side effect while proceeding?
- Did you recipe check as a blocking step before proceeding?
- Did you ask the user instead?
What informed that decision?

**Evidence quality range** — Show me your best and worst evidence entries. What made them good or bad?

Format each example as a short case study:
---
### Example N: [short title]
**Trigger:** ...
**Recipe:** ...
**Evidence:** ...
**Timing:** [async side-effect | blocking check | missed]
**Result:** [what came back, if anything]
**Assessment:** [what went well or poorly]
**Unique value demonstrated:** [if applicable — what did the corpus provide that you alone couldn't?]
---

After extracting all examples, summarize:
- What patterns do you see in when you checked vs didn't?
- What would you do differently with hindsight?
- What did the corpus provide that your own context window couldn't?
- Were there moments where a recipe check from a previous session or different agent influenced your work in a way that wouldn't have happened otherwise? That's the unique value — cross-session context that no single agent can hold.

Save your output to `docs/qa/recipe-check-examples-{today's date}.md` in the repo.
```

---

## Why this prompt works

The session being asked has full context of the conversation — it knows what it was thinking, what evidence it had, and what the user said. A fresh agent reviewing the JSONL transcript would miss the reasoning behind decisions. The session itself is the best judge of its own recipe check behavior.

## What to do with the output

Save each session's extraction to `docs/qa/recipe-check-examples-{session-date}.md`. These real examples become ground truth for the QA rubric in `scripts/qa-agent-understanding.ts`.

## Which sessions to run this on

Any Claude Code session that had the Soup.net MCP tools configured. Sessions where Soup.net was used by an *external* project (i.e., used as intended, not by the product's own developers) are especially valuable — they show recipe-check behavior in real downstream consumer contexts.

## What to look for in the output

The most valuable extractions will be:
- **Missed checks** — these show where the rubric needs to test for checking frequency
- **Unique value moments** — these demonstrate what Soup.net provides that an agent alone can't
- **The assumption spectrum** — these show the nuanced decision space for when/how to check
