---
name: agent-team
description: Optional ideas for using Soup.net when you run other agents or sub-agents on work that involves a person's taste and judgment. Worth weighing when delegating long or judgment-heavy work. Your harness's own delegation and messaging stay as they are; this describes what a shared log can add alongside them.
---

# Running other agents with Soup.net

Suggestions, for you to weigh. Your harness has its own ways to delegate, message and wait, and the person has their own workflow; keep those. How questions and rulings travel between agents and people isn't Soup.net's to decide. What it adds is a log every agent can read, which outlasts any one of them.

**Why it can help.** An agent you start is one step further from the person than you are. Logged calls give it their reasons directly, and what it decides stays findable after it ends.

**What has worked.**
- **Passing the context on:** the recipe book in scope and any recipe ids that matter. An agent can read those with `get_recipes` or `search_recipes`, and check its own calls as it goes.
- **Deciding as they go:** agents that record their calls and keep moving run longer. A call that's both high impact and uncertain can go in as a draft without stopping the work.
- **Correcting live:** an intent groups the work. Agents sharing one let you poll `is:draft intent:<id>` and correct during the run, instead of reviewing everything at the end. An agent pursuing a separate goal can state its own intent, so its stubs and results stay its own.
- **Keeping drafts open:** a draft lives while checks continue under its intent. Reads alone let it expire in a day.
- **Resolving what you can:** whichever agent holds the settling context can resolve a draft with `verify_draft`, so the person sees only what no agent could settle.
- **Asking what happened:** a report of which checks an agent made, which calls it proceeded on and which it left open shows you what to look at.
- **Sharing findings as goals:** telling another agent what goal went unmet, with the evidence, leaves it room to work out the fix. A prescribed fix tends to get applied whether or not it fits.
