# Recipe Check Scenarios

Annotated conversations showing how AI agents should (and shouldn't) use recipe checks. These scenarios are the verbose reference material that gets distilled into the concise [Recipe Check Guide](/docs/recipe-check-guide) served to agent clients. When we discover a new nuance, we add a scenario here first, then update the guide to capture the principle.

**The core mechanic:** "Checking" a recipe does two things simultaneously — it **compares** your recipe against the existing corpus (search) and it **checks your recipe into** the corpus (log). Every check is both a read and a write. This dual nature is the single most important thing for agents to understand, because it means every recipe you check becomes part of the permanent record.

---

## Scenario A: Check as search vs. genuine hypothesis

**What happened:**

A user and their AI agent (Claude Code) were working together. The user mentioned:

> "I notice that my Soupnet recipes have a very general preference to use dark mode that keeps coming up when recipes are checked. I actually said that for testing purposes and I don't really feel that strongly about it. I have VS Code set to Dark Mode, but many other apps set to light mode. Based more on my mood, how I use the app, and also it feels better on my eyes if some things I look at are dark, and some light."

The user then asked the agent why it hadn't checked the recipe on Soupnet. The agent called `check_recipe` with:

```
recipe: "As a user, I prefer dark mode for my applications"
supporting_evidence: "General preference for dark UI themes\n> dark mode\n-- user preference"
```

**What went wrong:**

The agent wanted to *find* the dark mode recipes the user was talking about. So it wrote a recipe that would *match* them — treating `check_recipe` as a search query. But the user had just said the opposite: they prefer a contextual mix of dark and light. The agent:

1. **Ignored the user's actual stated preference.** The user explicitly described a nuanced, contextual approach. The agent flattened it to "prefers dark mode."
2. **Used check as pure search.** The agent's intent was to locate existing recipes, not to express a belief. But because every check is also a write, it logged a false signal — reinforcing the very test data the user was complaining about.
3. **Made the data quality problem worse.** The corpus now has one more "prefers dark mode" trace, making it even more likely to surface in future checks.

**The principle:** A recipe check is not a search query. It is a hypothesis you are checking into the system. If you don't believe the recipe, don't check it. If you need broad discovery, frame a recipe about how you want the agent to behave — do not fabricate taste claims.

**What the agent should have done:**

```
recipe: "As a developer, I prefer mixing dark and light themes across apps based on context, mood, and eye comfort rather than using one theme everywhere."
supporting_evidence: "User explicitly described a mixed, contextual approach — not a blanket dark mode preference.\n> \"I have VS Code set to Dark Mode, but many other apps set to light mode. Based more on my mood, how I use the app\"\n-- User conversation, 2026-03-28"
```

This checks in the user's *actual* preference while also surfacing any related recipes about theme preferences. The search and the log are both useful.

---

## Scenario B: Assumptions are valuable — surface them

**What happened:**

An agent is configuring a new dev tool for a user. Looking at the user's environment, it sees VS Code is set to a dark theme and the terminal is dark. The user hasn't said anything about theme preferences.

**Two possible approaches:**

**Approach 1 — Silent assumption (bad):** The agent configures the new tool with dark mode without checking. The assumption stays hidden. If it's wrong, there's no record and no opportunity for correction. Future agents make the same assumption independently, with no shared evidence to build on.

**Approach 2 — Surfaced assumption (good):** The agent checks a recipe:

```
recipe: "As a developer, I prefer dark themes in dev tools so that the display is consistent across my environment."
supporting_evidence: "User's VS Code and terminal are both configured with dark themes, suggesting a pattern.\n> \"workbench.colorTheme: One Dark Pro\"\n-- User's .vscode/settings.json"
```

The system returns results. Maybe it finds confirming recipes from other sessions. Maybe it finds the user's actual stated preference from Scenario A — that they prefer a *mix* of dark and light. Either way, the agent now has more information than it started with, and the assumption is recorded with its evidence for future agents to evaluate.

**The principle:** AI agents constantly cross gaps in their knowledge about their user's taste and judgment. Checking assumptions as recipes is how those gaps become visible and improvable. The system may return evidence that confirms, refines, or contradicts the assumption. The agent is the source of the assumption; the system helps improve it.

**The key distinction from Scenario A:** In Scenario A, the agent had the user's explicit statement and ignored it. Here, the agent has only indirect evidence (config files) and is forming a genuine hypothesis. Both are valid uses of `check_recipe` — the difference is evidence quality and honesty about what you actually believe.

---

## Scenario C: Stated preference — accuracy bar is higher

**What happened:**

During a coding session, a user tells their agent:

> "I chose Hono over Express for this project. It handles our edge case way better."

The agent wants to log this decision. It calls `check_recipe` with:

```
recipe: "As an AI agent, I recommend Hono over Express for better performance."
supporting_evidence: "Hono is faster than Express based on documentation."
```

**What went wrong:**

1. **Wrong persona.** "As an AI agent" — the agent's recommendation is not a recipe. The user made the decision; the recipe should be from the user's perspective.
2. **Paraphrased evidence.** "Based on documentation" — the agent fabricated vague evidence instead of quoting what the user actually said.
3. **Missed the user's reasoning.** The user said "handles our edge case way better" — that's the real evidence, and it's a judgment about their specific context, not a generic performance claim.

**What the agent should have done:**

```
recipe: "As a backend developer, I chose Hono over Express for new APIs so that edge deployment stays possible."
supporting_evidence: "User confirmed the decision based on project-specific evaluation.\n> \"I chose Hono over Express for this project. It handles our edge case way better.\"\n-- User conversation, 2026-03-28"
```

**The principle:** When the user states a preference or decision directly, the accuracy bar is higher than when you're surfacing an assumption. You have their actual words — use them. The recipe captures their perspective and role; the evidence quotes them directly. Don't reinterpret, summarize, or editorialize.

---

## Scenario D: Discovery — genuine intent, not a question

**What happened:**

An agent is about to start refactoring an auth module. It wants to check if there are any relevant recipes from prior sessions. It calls `check_recipe` with:

```
recipe: "What security patterns should we use for the auth rewrite?"
supporting_evidence: "Need to pick a pattern."
```

**What went wrong:**

This is a question, not a hypothesis. There's nothing to check in — no claim, no judgment, no taste. The system logs a trace that says "we need to pick a pattern," which is noise. Future agents searching for auth security recipes will find this empty trace mixed in with real ones.

**What the agent should have done:**

```
recipe: "As a developer about to refactor the auth module, I want to discover relevant security recipes and architectural preferences."
supporting_evidence: "Starting a new task — checking for prior context before making decisions.\n> \"No existing preferences found in project memory\"\n-- Memory check, 2026-03-26"
```

**The principle:** Even discovery checks are genuine hypotheses. "I want to discover relevant context" is a true statement about the agent's intent — it's honest and useful as a logged trace. It signals to future agents that someone was working on this area. A question like "what should we use?" contributes nothing.

---

## Summary of principles

These scenarios illustrate a small set of core principles that the [Recipe Check Guide](/docs/recipe-check-guide) distills for agent clients:

1. **Every check is a write.** This is the fundamental mechanic. If you internalize nothing else, internalize this. You are not searching — you are contributing. A false or careless recipe degrades the corpus for everyone.

2. **Two modes, both valid.** Surfacing assumptions (indirect evidence, genuine hypothesis) and logging stated preferences (user's explicit words). The difference is evidence quality, not validity. Assumptions are valuable — they make knowledge gaps visible.

3. **The recipe must be something you actually believe.** Whether it's an assumption or a stated preference, it must be your genuine best understanding at the time. Using check as a keyword search by writing a recipe you don't believe is the cardinal misuse.

4. **Evidence must be concrete and honest.** Point at what you actually observed: config files, user quotes, benchmarks, artifacts. Don't fabricate, paraphrase from memory, or restate the recipe as evidence.

5. **Use the human's perspective.** Recipes are "As a [their role] working on [their goal], I [prefer/chose]..." — not "As an AI agent, I recommend..." Pick a role that transfers across users and projects, not the human's name and not the project name when the group description already implies it.

---

## Scenario E: Group tool decision — personal discovery, human discussion, side-effect logging

This scenario exercises multiple archetypes together: Non-Technical Creator (#5), Group Collaborator (#7), First Adopter (#4), and all three agent types. It shows the full lifecycle of a group judgment call — from individual discovery through human decision-making to implementation with side-effect recipe checks.

**Context:**

Four parents are organizing a school fundraiser. They've created a Soupnet group called "Spring Fundraiser." Each parent has their own AI agent:

- **Dana** (first adopter, Claude Code) — set up the group, has been using Soupnet for months. Personal daily key + group-scoped key.
- **Marcus** (non-technical, ChatGPT web) — coordinates via his phone. Uses group key only.
- **Priya** (designer, Claude Desktop) — contributing poster designs. Personal daily key + group-scoped key.
- **Sam** (new to AI agents, Claude Code) — just joined, helping with logistics. Group-scoped key only.

The question: **What tool should they use to collaborate on the fundraiser plan?**

### Phase 1: Agents discover context (personal + group checks)

Dana's agent starts a session. It has two keys — personal and group-scoped. It checks broadly with each:

**Personal check** (using Dana's personal key, `max_chars: 2000`):

```
recipe: "As an event organizer, I prefer Google Docs for collaborative planning because real-time editing with non-technical collaborators is frictionless."
supporting_evidence: "Dana has used Google Docs for three prior group projects. Her agent has logged positive experiences.\n> \"Google Docs was the easiest way to get everyone on the same page — literally\"\n-- Dana, school website project, 2026-01"
```

This surfaces Dana's personal history — prior recipes about Google Docs, Notion, and Airtable from other projects. The results are `user_only` — only Dana's agent sees them.

**Group check** (using the group-scoped key, `max_chars: 2000`):

```
recipe: "As a fundraiser organizer, I want to discover what collaboration tools and preferences our group members have logged."
supporting_evidence: "Starting a new group project — checking for prior context from any group member.\n> \"No prior group recipes found\"\n-- Group memory check, 2026-03-28"
```

The group is new, so nothing comes back yet. But the check itself is logged to the group — future checks by other members' agents will find it.

Meanwhile, Priya's agent does a similar pair of checks. Her personal check surfaces a prior recipe: "As a designer, I prefer Figma for visual collaboration but need a separate tool for text-heavy planning." Marcus's agent (ChatGPT web) visits the check page with the group key and submits: "As a volunteer coordinator, I want a tool I can easily use from my phone."

### Phase 2: Agents arm their humans (before the Slack discussion)

Each agent now has context — both personal history and group signals. They summarize for their humans:

Dana's agent tells her: "Based on your history, you've had good results with Google Docs for group planning. Priya's agent logged that she needs something beyond Figma for text planning. Marcus wants mobile-friendly. No one has mentioned a preference for Notion or Airtable yet."

Priya's agent tells her: "You've preferred Figma for design but found it lacking for text collaboration. The group has signals from Dana (Google Docs positive) and Marcus (mobile-first)."

**The humans discuss on Slack** — a channel not connected to Soupnet. Dana suggests Google Docs, Marcus agrees ("I can use it on my phone"), Priya says "fine for the plan, but I'll share design drafts as Figma links." Sam has no strong opinion and goes along.

This is deliberate: **the decision happens between humans, not in the system.** Soupnet armed them with context; it didn't make the choice.

### Phase 3: Implementation with side-effect recipe checks

Dana tells her agent: "We decided on Google Docs for the fundraiser plan. Set it up."

The agent creates the document, shares it with the group, and — as a **side effect** of the implementation — fires off recipe checks in the background. In Claude Code, the agent can use a sub-agent or background task to make these checks asynchronously, so the main thread keeps working on the document setup without waiting for responses. The checks don't block the task; they're fire-and-mostly-forget traces left while working.

**Side-effect check 1** — logging the group decision (group-scoped key, `max_chars: 500`, background):

```
recipe: "As fundraiser organizers, we chose Google Docs for the shared plan so that everyone can edit from any device, including mobile."
supporting_evidence: "Group consensus reached via Slack discussion. All four members agreed.\n> \"fine for the plan, but I'll share design drafts as Figma links\"\n-- Priya on Slack, 2026-03-28"
```

The agent doesn't need a detailed response — `max_chars: 500` keeps it to a quick pulse. Running in the background means the main agent keeps setting up the Google Doc while this completes. The primary value is the **log**, not the search result. The trace is now in the group corpus: future agents working on this fundraiser (or the next one) will find it.

**Side-effect check 2** — logging the tool split (group-scoped key, `max_chars: 500`, background):

```
recipe: "As a design collaborator in a non-technical group, I prefer keeping design assets in Figma and linking them from the shared planning doc rather than trying to do everything in one tool."
supporting_evidence: "Priya proposed this split and the group accepted it.\n> \"fine for the plan, but I'll share design drafts as Figma links\"\n-- Priya on Slack, 2026-03-28"
```

Again, lightweight and background. When the response comes back, the agent glances at it — and this time **something unexpected surfaces**: a recipe from a completely different group that Priya belongs to, logged months ago:

> "As a designer sharing work with non-designers, I always include alt-text descriptions with Figma links so that people using screen readers or text-only agents can understand the design intent."

Priya's agent had logged this as `user_only` in another project, but the semantic similarity is high enough that it surfaces here. Dana's agent sees it (because it came back in the group check results), adjusts its approach, and adds an "Accessibility notes" section to the Google Docs template.

**Nobody mentioned accessibility in the Slack discussion.** The system surfaced it because the corpus knew something the group didn't collectively remember. This is stigmergy working — indirect coordination through traces left by past work.

### Phase 4: Later, another member's agent benefits

Two weeks later, Sam's agent starts a session to update the fundraiser logistics. It checks broadly with the group key (`max_chars: 1000`):

```
recipe: "As a logistics volunteer for the school fundraiser, I want to discover what tools and preferences our group has established."
supporting_evidence: "Starting work on an existing group project — checking for prior context.\n> \"Joined the Spring Fundraiser group\"\n-- Group membership, 2026-03-28"
```

The response surfaces: the Google Docs decision, the Figma-for-design split, the accessibility note, and Marcus's mobile-first preference. Sam's agent now has full context without Sam having to ask anyone. It opens the Google Docs link and gets to work.

### Phase 5: Reinforcing a trace with new evidence

A week into the project, Priya's agent is uploading poster drafts to the shared Google Doc. During the work, it notices that the Google Docs mobile editor handled Priya's image embeds well — Marcus had commented from his phone with no issues.

Priya's agent already knows about the group's Google Docs recipe from Phase 3. It doesn't create a new recipe — it re-checks the **exact same recipe text** with new evidence (group-scoped key, `max_chars: 500`):

```
recipe: "As fundraiser organizers, we chose Google Docs for the shared plan so that everyone can edit from any device, including mobile."
supporting_evidence: "Mobile editing confirmed working well in practice — Marcus commented on image-heavy poster drafts from his phone without issues.\n> \"looks great! love the colors 👍\"\n-- Marcus, comment in Google Docs from mobile, 2026-04-05"
```

The system now has two traces with the same recipe claim but different evidence: the original decision rationale (Phase 3) and real-world validation (now). This is how coverage strengthens — independent evidence from different sessions and different API keys converging on the same judgment. Future agents searching for tool recommendations will see not just "they chose Google Docs" but "they chose it *and it worked* for mobile collaboration with images."

If instead Marcus had reported problems — "I can't see the poster images on my phone, it just shows placeholders" — the agent would log a **new recipe** capturing the contrary judgment, not re-check the original with flipped evidence. Agents submit supporting evidence only; the system discovers contradictions via semantic similarity across recipes.

```
recipe: "As a fundraiser organizer, I chose Google Docs for shared planning but hit mobile rendering issues with image-heavy content — the team should link to external image hosts rather than embed."
supporting_evidence: "Mobile rendering failed for image-heavy content — Marcus could not see poster images on phone.\n> \"I can't see the images, just shows blank boxes\"\n-- Marcus, Slack message, 2026-04-05"
```

Two recipes now exist with semantically related claims — one positive, one naming a specific failure mode. When future agents check recipes about Google Docs for image collaboration, the system surfaces both via `relatedEvidence`. The agent reading the results sees: "this group chose Google Docs, it worked for text, but another session logged mobile rendering issues with images." That's a richer signal than either piece alone, and it emerged from two honest recipes rather than a system that asks agents to submit "evidence against."

### Principles illustrated

6. **Recipe checks as side effects, not research.** The implementation checks used `max_chars: 500` and ran in the background — just enough to catch surprises, not enough to derail focus. The agent logged traces while working, like leaving breadcrumbs. The log is the primary value; the search result is a bonus. Agents that support background tasks (Claude Code sub-agents, `/btw` commands) should use them for side-effect checks so the main task isn't blocked.

7. **Personal and group keys serve different purposes.** Personal keys surface individual history (`user_only`). Group keys surface and contribute to shared context. The agent uses whichever key fits the intent — the system handles visibility.

8. **Humans decide; agents arm and record.** Soupnet didn't choose Google Docs. It gave each human context from their own and their group's history, they decided on Slack, and the agents logged the outcome. The system is in service of human judgment, not a replacement for it.

9. **Stigmergy surfaces what individuals forget.** The accessibility note came from a different project, a different group, a different time. No one in the Slack discussion thought to mention it. The system's value is in these indirect connections — traces from past work influencing present decisions without anyone orchestrating it.

10. **Reinforce traces with new evidence, don't create duplicates.** When you encounter new evidence for a recipe you already know about, re-check the *exact same recipe text* with the new evidence (for or against). The system sees independent traces converging on the same claim — that's the strongest signal. Coverage grows from diverse evidence across sessions, not from restating the same claim in different words.
