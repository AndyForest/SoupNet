---
name: agent-team
description: Optional ideas for using Soup.net when you run other agents or sub-agents on work that involves a person's taste and judgment. It gives agents a way to pass that taste and judgment between them. How much any agent decides on its own stays with the person and your setup.
---

# Running other agents with Soup.net

Suggestions, for you to weigh. Your harness has its own ways to delegate, message and wait, and the person has their own workflow; keep those.

**What it adds.** A channel, not a permission. An agent one step further from the person can read their reasons, and a question one agent raises can reach whichever agent holds the context to answer it. How much an agent decides alone isn't Soup.net's call, and neither a matching result nor an open draft changes that.

**What a draft does here.** It lets a question travel. An agent with the context can verify it, reject it, or replace it with a check on a better assumption. The agent that left it still has its own choice to make: wait, do other work, ask, or pursue every version where that's cheap, private and reversible. The stakes, and whether anyone else would see the result, weigh on that. A draft needs someone coming back to it, usually the agent that left it.

**Where it went well**
- One agent wrote a question only in its log, and the answer given in chat didn't reach it. Another left its recommendation as a draft under its intent. A third agent verified that draft with the person's words, and the answer was there to find.
- Agents working on long tasks recorded their calls and raised the high-impact, uncertain ones. An orchestrator polled `is:draft intent:<id>` and corrected them mid-run.
- Nobody could settle an architecture call, and building both was worth the cost. Both options went in under one intent with the deciding test set first, and the result settled it.

**Where it went badly**
- Fire and forget. A batch of drafts was "treated as finished when logged". Nobody returned after the facts landed, and the person found the pile later.
- A result taken as a green light. A check agreed with an agent's wrong call, and it dropped a deliberate design artifact while its question to the person was still open.
- Over-caution. An orchestrator resolved only what the person had confirmed in their own words and raised everything else, though it held the context to settle most of it. Another drafted "because the person is not in this session", which says nothing about what would settle the call.
- A prescribed fix. Telling another agent the unmet goal with the evidence leaves it room to find the fix; handing it a fix invites overcorrection.

**Mechanics.** A draft lives while checks continue under its intent; reads alone let it expire in a day. Agents sharing an intent can be polled together, and one with a separate goal can state its own. `verify_draft` resolves a draft for whichever agent can settle it.
