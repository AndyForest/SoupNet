# New User Onboarding

> **Purpose:** Captures the design problem of getting a new Soup.net user from "I just signed up" to "I see the value in my first session, and my agents accumulate context from then on." This is the most critical user journey — see [design-thinking.md §The First Adopter](../design-thinking.md).
>
> **Audience:** Anyone working on the registration → first-check → second-check → "I'm sold" flow.
>
> **Status:** Andy's design notes + open questions, with expansion and recommendations from a Claude session (2026-04-09). Not yet a prioritized implementation plan. Ideas accumulate here, get triaged into [backlog.md §Launch Readiness](../backlog.md), and graduate into ADRs or scenario docs as they harden.
>
> **Reading conventions used in this doc:**
> - **Andy's original notes** are preserved verbatim where possible, in their own subsections marked "Andy's notes"
> - **Claude expansion** sections elaborate on those notes with research-grounded reasoning
> - **Recommendation** callouts are Claude's opinions with explicit reasoning — these are judgment calls that need Andy's signoff before becoming work
> - **Open question** callouts are things Claude can't or shouldn't decide alone
>
> **Related docs:**
> - [planning/scenario-first-users.md](../planning/scenario-first-users.md) — concrete persona-driven scenario (Priya designer + Marcus coder)
> - [backlog.md §Launch Readiness (first 100 users)](../backlog.md) — chunked implementation list
> - [design-thinking.md](../design-thinking.md) — user archetypes and product vision
> - [planning/Chatbot provider MCP capabilities deep-research-report.md](../planning/Chatbot%20provider%20MCP%20capabilities%20deep-research-report.md) — what each AI client supports (essential context for agent-specific onboarding)
> - [research/briefing-agent-memory-systems.md](../research/briefing-agent-memory-systems.md) — pending research on how other systems handle cold start
> - [research/briefing-surprise-utility-landscape.md](../research/briefing-surprise-utility-landscape.md) — pending research on surprise-vs-relevance algorithms

---

## The core problem

A first-time user with an empty corpus faces a chicken-and-egg:
- The whole point is "future agents find your accumulated taste" — but on day 1 there's no accumulation
- Their first recipe check returns nothing similar — but the recipe was *logged*
- The second check might find the first one — but only if they make the same shape of decision again
- Value compounds, but the first 1–3 sessions need to feel useful enough to keep going

**Failure mode:** user signs up, makes a few checks, sees "no similar recipes found", concludes "this doesn't work yet" and never comes back. The flywheel never spins up.

**What success looks like:**
1. First check logs something + the page communicates "this is the first deposit, future checks will find this"
2. Second check (same session, different topic) returns the first one as related context — even imperfectly
3. By session 3, the user has had at least one "huh, I forgot I told you that" moment

---

## 1. The web AI agent angle

### Andy's notes

> Think through the web ai agent more, that's brand new to everyone, nobody is doing that at all.
>
> Build on what I know:
> - Previously, I built a system for the LLM to make a dialog tree of questions for a user. It feels like we could get the web agent to do this! So instead of giving individual recipe checks, it could build a tree, all in a single URL. Then over at soupnet, we decode the tree and follow it, presenting the user with the UI. Have to check for URL limits, and also the capability of different free-tier web agents to build this.

### Claude expansion

The web-AI angle is the most underexplored space and probably the highest-leverage one. ChatGPT, Google's AI Studio chat, Stitch, the chat layer in Antigravity — these all have hundreds of millions of users and they can read URLs and submit forms. They cannot run MCP servers. **Soup.net is one of very few "agent memory" systems that has a usable web form, which means it works for that population by accident.**

The dialog-tree-in-URL idea has real precedent in your previous work and slots cleanly into what we already built:
- **Divergent recipe checks** are already a documented Soup.net pattern ([design-thinking.md §Divergent Recipe Checks](../design-thinking.md#divergent-recipe-checks-discovering-taste-through-hypothesis-branching)) — the agent generates 2–4 framings for the user to choose between
- A "tree-in-URL" extends this to multi-step conversations the user clicks through, with each click logging exactly the chosen branch
- soup.net decodes the tree, presents the next question, and only logs what the user actually picks

**URL length is a real constraint.** Practical safe limit across browsers is ~2000 characters; some web-AI clients truncate further. A 4-deep tree with ~5 nodes per level and reasonable text encodes to maybe 1200–1800 chars. Probably workable if we're careful with encoding (short slugs, not full text).

> **Recommendation (Claude):** This is worth a focused design spike — maybe a half-day prototype that encodes a 3-question tree as a soup.net URL, decodes it server-side, and walks the user through the tree on the check page. The output of that spike is a yes/no on whether the URL-length budget is workable, and if so, what the encoding format should be. **Reasoning:** the upside is significant (it brings web-AI users into the divergent-check pattern that you already love for keeping yourself in the driver's seat) and the prototype cost is low. If it works, it becomes the centerpiece of the web-AI onboarding story.

> **Open question (Claude):** Should the URL encode a *tree* (the agent commits to all branches up front) or a *root question with a callback URL* (the agent gets the user's first answer, then generates the next question)? Trees are simpler but less adaptive. Callbacks are more dynamic but require multiple agent invocations, which works in Claude but breaks for ChatGPT-style "do everything in one turn" agents.

---

## 2. Agent-aware recipe guide

### Andy's notes

> Could we have the system onboard people?
>
> Ask some questions about how they want to use it?
> - Delays first start, so no
>
> Maybe the recipe guide detects the agent somehow? Different instructions for each? Or follow up guides they can request? THat's better, have the minimal bootstrap in the guide, and links for specifics. Low friction to have AI agents check and recheck. We could have a timestamp last modified for each followup, so they know if they have it before they click.

### Claude expansion

Your instinct here is exactly right and I think it's higher leverage than the web-AI tree work because **every agent connection starts with `get_recipe_guide`**. If we can shape that one moment well, we shape every downstream check across every user.

The pattern you described — "minimal bootstrap + linked followups + last-modified timestamps so the agent knows when to refetch" — is essentially HTTP caching applied to agent instructions. It maps cleanly:

- **Bootstrap guide**: short, agent-agnostic, always-current. Returned by `get_recipe_guide` with minimal token cost.
- **Followup guides**: each is a separate URL or tool result, with `last_modified` metadata. Agents check the timestamp; if they have it cached, they skip the fetch.
- **Agent detection**: where possible (user-agent header, MCP client info field, agent-supplied metadata), the bootstrap can suggest followups specific to that agent's capabilities.

This also makes the documentation evolvable — we can ship new followups without invalidating every cached agent.

> **Recommendation (Claude):** This is the highest-leverage onboarding work and should land in the next implementation chunk after the launch-readiness items in the backlog. **Reasoning:** it improves every agent interaction, not just first-time onboarding. It also makes everything else in this doc easier — the dialog-tree URL pattern, the meta-recipes about Soup.net usage, the public showcase corpus — because we have a place to teach agents about each pattern when they're ready for it.

> **Open question (Andy):** What's the right granularity for followup guides? Some candidates:
> - Per agent capability profile (web-only, MCP-with-elicitation, MCP-with-subagents)
> - Per use case (first-time setup, divergent checks, group collaboration, file uploads)
> - Per "skill level" (beginner / intermediate / advanced)
>
> My intuition is "per use case" because that's how a developer thinks about needing help, but I don't have enough data yet.

---

## 3. Encourage taste/judgment calls about Soup.net usage itself

### Andy's notes

> Encourage taste & judgement calls in the system about how the user wants to use the system.
> - We could have some standard searches built into the system that surface soupnet related taste and judgement calls. Then on the dashboard, we could show the status of searches for these - how many recipes, how many clusters, how many divergent users, uses, etc, mentioned in them. Then we have a checkbox for automatically surfacing these in the recipe guide. Could even use the filters to match against the particular agent somehow for the different ways they know it works with them (and we know it works)
>
> Feels like there are many ways that the system could be useful. So if the user's ai agents can help them discover that, and record it in the soupnet system, it will evolve for them.

### Claude expansion

This is the meta-stigmergy idea: **the corpus's most valuable content might be recipes about Soup.net itself.** Stack Overflow's most-read questions are about Stack Overflow. The same effect probably applies here.

Every user who logs "as a developer using Claude Code, I check recipes [pattern] because…" creates training data for every future user's first session. The dashboard panels you described — distinct topics, divergent uses, agent-specific patterns — are essentially the "what works for people like me?" view that motivates new users to try it themselves.

**There's a virtuous loop here that makes onboarding self-improving:**
1. New user signs up → empty corpus
2. Dashboard surfaces "common Soup.net usage patterns" sourced from existing meta-recipes
3. User's agent checks one of those patterns → logs their own variation
4. The new variation becomes part of the meta-corpus
5. The next new user sees richer patterns

> **Recommendation (Claude):** Combine this with #2 (agent-aware guide). The agent-aware guide is the *delivery mechanism*; the meta-recipes are the *content*. Ship them together. **Reasoning:** without the meta-recipes, the agent-aware guide is just static documentation. Without the guide, the meta-recipes have no path to new agents. Together they form a complete loop.

> **Open question (Andy):** Privacy. The user's *own* meta-recipes are clearly fine to surface to their own agents. But are there ethical issues with surfacing other users' meta-recipes by default? This is exactly the question the public showcase corpus (#4 below) is also trying to answer.

---

## 4. Discovery-first first-session UX (Claude addition, not in original notes)

### Claude proposal

This isn't in your original notes but feels like a missing piece. Right now the first-session UX is "make your first check" — which is the riskiest possible action because it's the one that returns "nothing similar found" most often.

**Alternative**: lead with discovery, not contribution. Show the new user a curated set of recipe checks they can run *against an existing public corpus* with a temporary read-only key. They see real value from existing recipes before they're asked to log their own.

This requires:
- A "public showcase corpus" — recipes explicitly marked for new-user discovery, contributed by power users (probably starting with you)
- A temporary key issued at signup that has read access to the showcase corpus
- A landing page after signup that shows a few starter recipe checks

> **Recommendation (Claude):** **Build a small public showcase corpus before launch** (maybe 30–50 well-formed meta-recipes about Soup.net usage and design decisions, contributed by you and any early collaborators). It's the lowest-effort way to make the first session non-empty. **Reasoning:** every other approach in this doc requires either user behavior change or new feature work. A public corpus is just data, and it solves the cold-start problem by sidestepping it.

> **Open question (Andy):** Privacy model. Some options:
> - **Opt-in flag on individual recipes** — users mark specific recipes as public-showcase-eligible
> - **Dedicated public group** — recipes go in a "public" group on creation, public visibility is implicit
> - **Curation queue** — power users propose recipes for the showcase, you (as system admin) approve them
>
> My gut says "dedicated public group with curation queue at first, individual opt-in flag once we trust the model" but you'll have stronger opinions.

---

## 5. Build a way for users to share patterns back

### Andy's notes

> Build a way for users to easily share patterns back to us?

### Claude expansion

This is the open-source community play in miniature. Power users discover things — clever divergent check templates, useful filter patterns, working concept-axis combinations — and most of that knowledge stays in their session and never reaches the project. A "share this pattern" button would change that.

The submission flow could be very lightweight:
- User clicks "share this back" on a result, conversation, or successful pattern
- Frontend opens a small form: title, description, why-it-works, optional tag
- Submission goes to a queue (`patterns_submitted` table or similar)
- System admin (you) reviews and either incorporates into the recipe guide, scenario library, or adds to the showcase corpus

Users get attribution if they want it, the project gets community-sourced documentation, the new-user experience compounds.

> **Recommendation (Claude):** Defer this until after the agent-aware guide ships. It's a "nice to have" — valuable but not critical for the first 100 users because there won't be many patterns to share yet.

---

## 6. Data export

### Andy's notes

> Let's put the data export in the first launch, but without the vectors since we paid for those. Paid features ideas, such as export vectors, too.

### Claude expansion

This is a clear decision and already in [backlog.md §Data egress](../backlog.md). Not much to add — your reasoning is right (we paid for the embeddings, vectors as a paid-feature hint is reasonable, regenerating from text is cheap). Just want to flag:

> **Recommendation (Claude):** When the export is implemented, also include the recipe **format** (the schema, not just the data) so that any future "import to Soup.net" or "import to <other system>" path is clear. The export format becomes the de facto interchange format. **Reasoning:** if Soup.net ever wants to position as the *portable* taste/judgment layer (vendor-independence is a stated lasting advantage), the export format IS the portability. Document it carefully.

---

## Decisions worth making explicit

### Should onboarding ask questions about how the user wants to use it?

**Andy's answer:** No — that delays first start.

**Claude addition:** Right answer. Alternative: ask the *agent* what its user is doing, after the agent's first session. This has higher signal anyway because the agent has just observed the user, and it's lower friction (the agent answers, not the user).

### What's in the first launch's data export?

**Andy's answer:** Include data export, exclude vectors. Paid feature for vectors later.

### How does the user know when the corpus is "warm enough"?

**Open.** Claude's guess: dashboard "corpus warmth" indicator showing distinct topics, distinct clusters, age range. When it crosses some threshold, surface a "your future agents should start finding cross-cutting context now" message — the first explicit win moment.

---

## Open research: surprise × utility in retrieval

This affects onboarding directly: a new user's first check needs to surface something *unexpected but relevant* from the existing corpus, not just close matches. The clustering approach already brute-forces some breadth, but we can do much better.

**Two deep research briefings have been drafted to inform this work** — see [docs/research/](../research/):

1. [briefing-surprise-utility-landscape.md](../research/briefing-surprise-utility-landscape.md) — academic and applied research on serendipity, novelty, diversity in IR + recommender systems
2. [briefing-agent-memory-systems.md](../research/briefing-agent-memory-systems.md) — comparison of how mem0, Letta, Zep, A-MEM, Cognee, etc. handle the echo problem and shared memory

Once these come back, the findings should land here and in [search-strategies.md](../architecture/search-strategies.md).

---

## TODO (triage into backlog as items mature)

- **[RESEARCH]** Kick off the surprise-utility landscape briefing (see `docs/research/briefing-surprise-utility-landscape.md`)
- **[RESEARCH]** Kick off the agent memory systems comparison briefing (see `docs/research/briefing-agent-memory-systems.md`)
- **[DESIGN]** Web agent question-tree-in-URL pattern: prototype a single URL that encodes a 3-question tree, decoded server-side. Verify max URL length across major web AI clients.
- **[DESIGN]** Agent-aware recipe guide: schema for capability profiles, detection mechanism, followup-guide URL structure with last-modified caching.
- **[DESIGN]** Standard built-in searches surfacing meta-recipes about Soup.net usage. Dashboard panel for status/health of these searches.
- **[DESIGN]** Public showcase corpus: which recipes opt in, what UI surfaces them, privacy model. (Probably the highest-leverage cold-start fix.)
- **[DESIGN]** Dashboard "corpus warmth" indicator + win moment messaging.
- **[IMPL]** Data export endpoint (without vectors) — already in [backlog.md](../backlog.md) §Data egress.
- **[IMPL]** "Share this pattern" one-click contribution flow. (Defer until after agent-aware guide ships.)
