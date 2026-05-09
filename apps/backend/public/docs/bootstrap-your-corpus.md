# Bootstrap Your Corpus

Soup.net gets smarter the more you use it — but your first recipe check returns nothing because the corpus is empty. This guide helps you jump-start it by extracting the taste and judgment you've already demonstrated in previous AI agent sessions.

## How it works

You paste a prompt into an existing AI agent session. The agent reviews your conversation history, identifies decisions where you expressed taste or judgment, and recipe-checks each one into Soup.net. As it goes, you'll see each recipe check and its results — including any matches from your other sessions.

**The gold is in cross-pollination.** Pick sessions from different projects or use cases. When your design session's recipe checks surface context from your coding session, that's the system working — connections that no single AI agent could make on its own.

## Before you start

1. **Get your API key** from the Soup.net dashboard. You'll need a daily key or scoped key.
2. **Set up MCP tools** if your AI agent supports them (see [MCP Setup](/docs/mcp-setup)). Otherwise, the prompt below includes web endpoint instructions.
3. **Pick 3-5 diverse sessions** — different projects, different types of work. A design session, a coding session, a planning session. Variety is what makes cross-pollination work.
4. **Run sessions concurrently** if possible. When multiple bootstrap sessions run at the same time, they discover each other's recipe checks in real time. This is the fastest way to see cross-pollination in action — and it makes the evaluation report (see below) much more informative.

### Group projects

If any of your sessions involve collaborative or group work, set up a group in Soup.net first and use a group-scoped API key for those sessions. That way, if you see value, you can invite collaborators to the group later and they'll benefit from the context you've already built.

## The prompt

Copy-paste this into each session. If your AI tool supports session forking (e.g., Claude Code), fork first so you don't disrupt your current work.

```
I'd like to bootstrap my Soup.net corpus by recipe-checking the taste and judgment decisions from our conversation.

**First, learn the system:**
- **If you have MCP tools:** Call `get_recipe_guide` for the recipe format, voice rules, when-to-check guidance, and evidence structure.
- **If you don't have MCP tools:** Read the guide at {SOUP_NET_URL}/docs/recipe-check-guide?key={YOUR_API_KEY}.

**Then:**

1. Review our conversation history for moments where I expressed taste or judgment:
   - Preferences I stated ("I prefer X", "let's use Y", "I don't like Z")
   - Decisions I made with reasoning ("I chose X because Y")
   - Assumptions you made about my preferences based on my artifacts or behavior
   - Design, architectural, or tool choices we discussed

2. For each one, recipe-check it. Follow the format and voice rules from the guide — recipes are written in MY voice with a transferable role, not yours and not my name, and not duplicating context the group description already provides. Quote my actual words or cite the specific artifact you observed for each evidence entry. Use `max_chars=2000` to keep responses concise.

3. Show me each recipe check as you go — I want to see what you're capturing and what the corpus returns. If the corpus returns something from a different session, highlight it — that's the cross-pollination working.

4. After checking each recipe, briefly note what came back:
   - "No similar recipes yet" — expected for early checks, the corpus is building
   - "Found N similar recipes" — summarize the most interesting match
   - "Found context from a different session" — this is the unique value, call it out

Apply the guide's "when to check" framing — focus on decisions worth surfacing for future agents, not every small autonomous call. Take your time and be thorough; this is seeding the corpus that will inform all my future AI agent sessions across every tool I use.
```

If viewing this page with your API key in the URL (e.g., from your dashboard's daily link), the prompts above are pre-filled and ready to copy-paste. Otherwise, replace `{SOUP_NET_URL}` and `{YOUR_API_KEY}` with your actual values.

## Optional: evaluation report

After the bootstrap finishes, paste this follow-up prompt to get an honest assessment of the system's value. This works best after you've bootstrapped at least 2-3 sessions (especially concurrently), so the agent has cross-pollination results to reflect on.

```
Now that you've bootstrapped my Soup.net corpus from this session, I'd like an honest evaluation report:

1. **Cross-pollination moments:** Did the corpus return anything from a different session during our bootstrap? What was it? Was it useful or surprising?

2. **Where Soup.net could have helped during our original work:** Look back at our conversation before the bootstrap — were there moments where context from other sessions would have informed a better decision, saved time, or surfaced something we missed? Be specific about the moment and what context would have helped.

3. **Honest comparison with your built-in capabilities:** What does Soup.net provide that your own memory, context window, and built-in tools can't? Where does it fall short? Be candid — this helps us improve the system.
```

## What to expect

**Running one at a time:** The first session is mostly "no similar recipes yet." The second starts finding matches from the first. By the third, cross-pollination is visible.

**Running concurrently (recommended):** All sessions discover each other's recipes as they go. Cross-pollination starts almost immediately. The evaluation reports will be richer because each agent can point to specific moments where another session's context appeared.

## Tips

- **Don't rush it.** A thorough pass through one important session is worth more than a quick skim of ten.
- **Diverse sessions matter more than many sessions.** Three sessions from different projects beat ten sessions from the same project.
- **Watch for surprises.** When the corpus returns something you didn't expect, that's the system working. Note what surprised you — that's useful feedback for us.
- **Group projects first.** If you plan to collaborate, bootstrapping the group corpus early means your collaborators benefit from day one.
