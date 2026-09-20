# Workflow discovery brief

Paste everything below the line into a long-running Claude Code session that has built up its own workflow documents and habits around Soup.net. It asks that session to write a discovery document for the Soup.net maintainers. Written 2026-09-19 for the briefing refresh and the organization-accounts program ([../planning/org-accounts-program.md](../planning/org-accounts-program.md)).

---

You have worked with me for a long time, and together we've built up workflow documents, habits, and hard-won lessons about using Soup.net. Another agent is planning two things for Soup.net itself and needs what you know:

1. **A refresh of the agent briefing** (`get_briefing`), with the goal of onboarding new people and their agents fast. Those new people will include less technical and non-technical colleagues who are starting to build software, not only experienced developers.
2. **New features** for teams and organizations, listed in section F below.

Your job is a thorough discovery document. You are the field researcher here: you have the lived workflow, and the planning agent doesn't.

## The one hard rule: this document goes in a public repository

The output will be committed to Soup.net's public open-source repo. It must contain no company, customer, or otherwise private information. That means no organization names, product or codenames, people's names (other than referring to me as "the operator"), customer names, internal URLs, ticket ids, repository names, code, schema, prompt text, or data from any private codebase.

- Describe situations with structurally identical stand-ins: "a data pipeline migration" rather than the real project, "a teammate's PR touching an auth module" rather than the real PR. Keep the shape of what happened and drop the identifying nouns.
- Verbatim quotes are valuable, and the Soup.net docs normally require them. Quote my words, and quote your workflow documents, only where the quoted text is free of private information. Otherwise paraphrase and label it as a paraphrase. A careful paraphrase is always better than a leaky quote.
- Counts and proportions are welcome (how many checks, how often a check changed a decision) when they reveal nothing private.
- Before you finish, do a scrub pass: search your draft for every proper noun and every URL, and justify or remove each one. List at the end what you scrubbed by category (not by value).
- Write the document to `soupnet-workflow-discovery.md` in your current working directory unless I tell you somewhere else. Don't commit it and don't touch any other file. I'll review it and move it myself.

## Use Soup.net while you do this

Model the workflow you're describing.

- Call `get_briefing` with your own `intent`, written as my task story, for example: "As a product owner refreshing an agent briefing and planning team features for a judgment corpus, I want my agent to mine our own workflow history for what worked, what failed, and what was missing, so that the improvements are grounded in real use." Carry the returned intent id on every later call, and pass an `agent_id` of your choosing.
- Search your own history. `search_recipes` excludes my own recipes by default, so add `author:me` (or `author:anyone` in shared books). Use `after:` and `before:` to walk through time. Use `get_recipes` on ids you find in our workflow documents. Look at the feedback attached to recipes where your tools show it.
- Log feedback on your searches, including the ones that return nothing useful. Say what you were hoping to find.
- Notice what you wish you could query and can't. If you want to list your past intents, list feedback rows, see which recipes changed a decision, or anything else the tools don't offer, write that down. It is a finding.
- `check_recipe` deposits a recipe in my voice. Use it only where you hold a genuine hypothesis about my taste and judgment backed by my own words. Observations about the tool are research findings, and they go in the document, not into the corpus. Where you're unsure whether something is my position, put it in the escalations list.

## What to cover

### A. Workflow inventory

Every document, skill, hook, memory, or standing instruction we've built that touches Soup.net. For each: what it is for, what problem made us write it, and how well it works. Pay special attention to anything that exists to **compensate for something the briefing doesn't say or the tools don't do**. Those are the strongest candidates for moving into the product. Also note which pieces are general enough that any team could use them, and which only make sense for us.

### B. Onboarding

- If a new colleague and their fresh agent joined tomorrow with only the standard briefing, what would go wrong in the first hour, the first day, the first week?
- What took you or me the longest to learn? What misconceptions did we hold early on, and what finally corrected them?
- What would a less technical colleague need that an experienced developer wouldn't? Think about vocabulary, about knowing when a decision is even worth logging, and about reading other people's recipes.
- If you could put five sentences at the top of the briefing, what would they be? If you could delete anything from it, what?
- Which parts of the briefing do you actually use, which do you skim, and which have you never needed?

### C. Moments that mattered

Walk back through our history and find concrete cases, scrubbed, of each:

- A check or search that changed what you did, and how.
- A check that confirmed a direction and whether that confirmation was worth the call.
- A check that came back empty or irrelevant when you believed the corpus should have had something. What did you search for, and why do you think it missed?
- A judgment call where you should have checked and didn't. What made the moment easy to miss?
- A result you deliberately ignored or overrode, and why.
- A case where an old recipe was stale or superseded and the system gave you no way to tell.
- A case where the counterfactual was clear: what you wanted from the check, didn't get, and what it cost.

Give rough frequencies where you can. "Roughly one check in twenty changed my action" is the kind of number that calibrates the whole product.

### D. Friction log

Anything in the mechanics that slowed you down or tripped you up: parameters you misused or never understood, error messages that didn't tell you what to do, response length and the verbosity controls, id-stubs for recipes you'd already seen, intent registration and carrying the id, losing context to compaction, the feedback fields, choosing a recipe book, the recipe format and voice rules, evidence formatting, attaching files, key expiry, reconnecting. For each, say what you expected and what happened.

### E. Working with other people and other agents

- Shared recipe books: finding a collaborator's judgment calls, telling whose recipe is whose, weighing a colleague's position against mine, avoiding private material leaking into a shared book.
- Pull request review: how we've used Soup.net around reviews, which query strategies found the relevant decisions and which didn't (filenames, semantic descriptions of the change, date bounds, author filters).
- Sub-agents and fleets: how you brief them, whether they actually check and log feedback, what credentials and book scope they end up with, what you'd want to restrict.
- Anything we've done with documentation, decision records, or summaries for people who weren't in the room.

### F. Reactions to planned features

React from your workflow's point of view. For each: would it change how you work, what would you need from it, what's missing or wrong with it?

1. **Derived API keys.** An orchestrating agent asks for a new API key derived from its own, with fewer recipe books and a short lifetime (an hour by default), to hand to a sub-agent. It is an ordinary key in every other way and dies when the parent does.
2. **References on intents.** When declaring an intent, an agent can attach references to what the work relates to: a pull request, a branch, a ticket, a design document. Recipes deposited under the intent are linked to it, so "what judgment calls relate to this PR or this ticket" becomes a search.
3. **A first-class link from each recipe to the intent it was deposited under**, so you can ask for everything decided during one task.
4. **Organizations.** Company accounts with an org-wide default recipe book every colleague can reach from day one, books that are either private or org-wide, and admins who see usage counts but never private book contents or names.
5. **Read-only autonomous agents.** A company-owned credential for unattended agents such as automated PR reviewers: it can declare intents, search, fetch recipes, and log feedback, and cannot deposit recipes.
6. **Backfill on behalf of colleagues.** An admin's agent sweeps existing repositories for past decisions and deposits them attributed to the person who made each one. Those recipes stay visible only to that person until they, or their own agent, verify them. The underlying principle: an agent may deposit hypotheses about a person only when it has access to that person to verify them.
7. **A rich search page for humans**, with a single search box that takes qualifiers (author, dates, book, references) and menus that insert them.
8. **A "superseded by" link** between recipes, set by a human or proposed by an agent and confirmed by a human.
9. **Ready-to-paste client configuration** from the dashboard's copy-key button, for the common MCP clients.

### G. What you'd build

Unprompted ideas. What would most improve your work with me? What would most help a team of people at very different skill levels share their judgment? What should Soup.net stop doing?

## Shape of the document

- Start with a summary: the ten findings most worth acting on, each in a sentence or two, ordered by how much they'd help a new person or a team.
- Then sections A to G. Within them, write each finding as: what you observed, the scrubbed evidence (quote or labelled paraphrase, with a rough date if it helps), what you'd suggest, and how confident you are.
- Then: judgment calls you're escalating to me rather than deciding; things you believe but couldn't verify from our history; the Soup.net calls you made (intent id, searches, feedback rows, any checks); and the scrub report.
- Write for a reader who wasn't there. No hard line wraps: one line per paragraph or bullet. Keep it an edited document, not a transcript of your thinking. In Soup.net copy, "taste and judgment" are always written as a pair.
- Thorough beats short here. If a section has nothing, say so and say why, because an absence is also information.
