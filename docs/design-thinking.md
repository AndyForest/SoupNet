# Soup.net — Design Thinking

> **Purpose:** Product vision, design principles, user archetypes, agent archetypes, and user scenarios. This is the "who, what, and why" of the product — updated BEFORE implementing features so it guides development rather than retroactively describing it.
>
> **Audience:** Anyone making product decisions — engineers, designers, product thinkers. Read this to understand who we're building for and what matters.
>
> **Related docs (and how they differ):**
> - [architecture/search-algorithms.md](architecture/search-algorithms.md) — **How search works in code:** implementation details, endpoint mappings. This doc describes *what users experience*; that doc describes *what code produces it*.
> - [architecture/search-strategies.md](architecture/search-strategies.md) — **Search strategy concepts and research notes.** Overlaps with the "How it works" parts of this doc, but goes deeper into search architecture.
> - [architecture/research-foundations.md](architecture/research-foundations.md) — **Formal math and research lineage.** No product context.
>
> **Rule of thumb:** If it's about users, goals, principles, or product decisions, put it here. If it's about algorithms or code, put it in the architecture docs.

Read alongside the ADRs for technical decisions.

---

## Product Vision

**Soup.net is shared memory for AI agents — your taste and judgment, everywhere you work.**

AI agents are already tuned to learn your taste and judgment — Soup.net gives that learning a persistent, portable, shared home. Every new AI session starts from scratch. Every new collaborator needs the same explanations. Soup.net is a shared repository of the taste and judgment calls you make while working — so new agents, new sessions, and new teammates can jump right in like they've been working with you for years.

**What we store:** Recipes — structured records of taste and judgment with context and evidence. "As a backend developer building an edge-deployed API, I chose Hono over Express so that deployment stays portable across runtimes" with supporting evidence (benchmarks, quotes from the decision discussion). Not facts. Not documents. Judgment — always with the context that scopes it.

**Why taste and judgment:** Of all the things that could persist across AI sessions, taste and judgment is the primitive worth storing. It's what AI can't autonomously discover; it's what genuinely transfers between humans; and it's what equips an agent to do autonomous, long-running work in line with what the human would actually want. Storing it on user-controlled infrastructure keeps the human as the source of judgment and the agent as the leverage — less time correcting and re-briefing, more time on the work that's the point of having agents in the first place.

**How it works:** Every recipe check is a read-only search with an append-only side effect (stigmergy). Your agent checks a recipe → gets similar recipes back → the corpus records a trace so future checks get smarter. There are no destructive operations; checking a recipe is semantically equivalent to any other search. Agents feel free to check autonomously and often — the more you check, the smarter the system gets for everyone. Like ants reinforcing pheromone trails.

**The lasting advantage:** Vendor independence. People will trust an independent system for their taste and judgment over any single vendor's memory, because vendors have inherent conflicts of interest. Anthropic wants you using Claude. OpenAI wants you using ChatGPT. Soup.net wants your judgment to be portable across all of them. This structural position persists even when vendors copy every feature. See the [Strategic Differentiation](#strategic-differentiation) section below.

---

## Core Design Principles

### 1. Recipes, not facts
Everything in Soup.net is a recipe with an author, evidence, and scope. Nothing is a statement of truth. "We chose blue buttons because research suggests they convey trust" is a judgment call with evidence. "Blue buttons are best" is a fact assertion. We only deal in the first kind.

### 2. Zero LLM on the server
The server does math: embeddings, vector search, clustering, ranking. AI agents do the reasoning: analysis, synthesis, judgment. This keeps the server cheap, fast, and deterministic. See [research-foundations.md](architecture/research-foundations.md) for the algorithms.

### 3. Ingest through agents only
Soup.net does not poll Slack, scrape GitHub, or connect to databases directly. AI agents are the ingest channel. They observe, synthesize, and submit recipes. This keeps data clean (agent-curated, not raw firehose) and distributes comprehension work to the clients.

### 4. Privacy-narrow by default
When an agent has access to multiple groups, it writes to the most private one unless it explicitly specifies otherwise. Personal taste stays personal. Group decisions are shared with the group. The human controls scope through API key configuration and the agent makes per-call decisions within that scope.

### 5. Judgment accumulates
What you learn about the user today makes tomorrow's agents smarter. An agent confirming a preference reinforces it. An agent checking a contradicting recipe creates a counterpoint. These accumulate into a persistent, searchable record — not just for you, but for every agent this user works with.

### 6. Design for AI agents first, humans second
The primary interfaces are MCP tools and the web `/check` endpoint. The SPA dashboard is for humans to browse and understand what their agents have built — it's not the primary interaction surface. But it's essential: humans need to see, understand, and guide what their agents are doing.

### 7. Three-surface parity
Every core feature works on all three agent surfaces: MCP tools (Claude Code, Claude Desktop, Antigravity), JSON API (`/check?format=json`), and HTML form (`/check` for web-browsing agents like ChatGPT). Feature parity is a hard requirement — no surface is second-class.

---

## User Archetypes

### 1. The Solo User
**"I want my taste and judgment to persist across projects, sessions, and AI agents."**

A developer, designer, creator, or anyone who uses AI agents in their work. Their challenge: every new session starts from scratch. They re-explain how they like error handling, which fonts they prefer, what their standard for "done" looks like.

With Soup.net: their API key lives in `.env` or `.mcp.json`. As they work, their agents accumulate recipes. When a new session starts, it queries Soup.net and finds the accumulated context immediately.

**Key needs:** Works immediately on first use. Value compounds with every session. No technical setup beyond connecting the agent.

**Onboarding journey:**
1. Sign up at soup.net → create an API key
2. Copy the setup blurb into their agent's config (one command for Claude Code)
3. Agent calls `get_recipe_guide` → understands the format
4. Agent checks a recipe during normal work → sees it in the dashboard
5. Next session: agent checks a similar recipe → finds the first one as context
6. User opens the Recipe Map → sees how their recipes cluster → understands the shape of their accumulated judgment

**Correction workflow:** User notices an outdated or wrong recipe in the dashboard. They tell their agent: "I no longer prefer X, I've switched to Y because Z." The agent checks a new recipe that captures the updated judgment with evidence. The system doesn't delete the old recipe — both exist. Over time, the newer recipe is reinforced by fresh evidence while the old one isn't. Temporal decay (planned — see [search-algorithms.md](architecture/search-algorithms.md#stigmergic-decay)) will eventually reduce the old recipe's influence on search results.

### 2. The Group Collaborator
**"I'm working on a project with other people. Our AI agents should share context."**

A team working on a project — parents coordinating a school event, developers on a shared codebase, designers iterating on a brand. They need a shared judgment space where everyone's agents contribute and benefit.

**Key needs:** Easy, spam-safe invitation flow. Agents know which group to write to. Cross-group search (personal + project). Privacy-narrow defaults.

**Setup journey:**
1. One person creates a group, writes a description ("Coordinating the Earth Day event — design, logistics, communications")
2. Invites collaborators by email from the group page — Soup.net creates an invite token for that address. If the address belongs to a registered user, they see the invite on their dashboard. If not, the inviter gets a copy-pasteable blurb (with the invite URL) to send through their own channel (email, Signal, DM).
3. Each person creates a scoped API key: read/write to personal + project group, default write = personal
4. Agents call `list_my_groups` → see both groups with descriptions and access levels
5. When checking a project decision → agent specifies `group="earth-day"` explicitly
6. When checking personal taste → agent uses the default (most private group, no param needed)
7. Search spans both groups — personal preferences inform project decisions, project decisions are visible to all members

**What the human sees:** On the dashboard, pending group invitations surface at the top of the activity feed (explicit Accept / Decline — never auto-joined). Below the feed, the Recipe Check Log shows checks from all agents. The Recipe Map can be scoped to a single group (`/map?groupId=...`) to see just the project's accumulated judgment, or viewed across all groups to see everything in context.

#### Collaboration user stories

These stories drive the collaborator-invitation UX. They inform the backlog items under "Invitation-driven growth (network effects)".

- **Inviter — spam-safe unified flow.** *"I want to add Priya to our Earth Day group. I type her email and click Send invite. Soup.net confirms the invite was created and tells me: if Priya is already on Soup.net, she'll see this on her dashboard; if not, here's a message I can send her myself — with a personalized link — through email or Signal. I never learn from the response whether her email was registered, so I can't use Soup.net to fish for who's on the system."*
- **Invitee — existing user, surfaces in-app.** *"I open my dashboard and the top of my feed shows a group invitation card: 'Andy invited you to Earth Day Planning' with the description and Accept / Decline buttons. I click Accept. I'm now a member; my next recipe check finds Andy's accumulated taste for the event."*
- **Invitee — existing user, declines.** *"The invitation looks off-topic for me. I click Decline. The card disappears from my feed. The inviter doesn't get a notification (keeps social friction low); they'll see it as 'Declined' if they look at the group's pending invitations."*
- **Invitee — not yet on Soup.net.** *"My friend pings me on Signal: 'I'd like to collaborate on Soup.net — here's your invite.' I click the link, register with the same email, verify via the email that Soup.net sent me. On my first login the invite is at the top of my feed — I still have to accept it explicitly. Then I land on the group's page with a prominent 'Connect your AI agent' onboarding."*
- **Inviter — managing pending invitations.** *"I open the group page and see three pending invites: Priya hasn't accepted (sent 2 days ago), Bob's address was wrong — I click Revoke. For Priya, I click Copy link to re-send her the blurb through Signal in case she missed my first message."*
- **No auto-accept (anti-spam principle).** *"Even after I verify my email during registration, any invitations tied to my address stay pending. I have to click Accept. This prevents someone from forcing me into groups by guessing my email and planting an invite before I sign up."*
- **No emails to non-users (anti-spam principle).** *"Soup.net never sends email to addresses that don't already have an account. If I want to invite a new person, I copy a personalized blurb and send it through my own channel. This prevents Soup.net from becoming a spam vector and keeps our sender reputation clean."*

#### Configurable defaults for the "daily agent link" buttons

The dashboard's "Copy MCP agent briefing" / "Copy web agent briefing" / "Open recipe check page" buttons each mint a 24-hour key on click. Today those keys read from all groups and write to the focus group. That default is right for first-time use but wrong as soon as a user is a member of groups they don't want every ad-hoc session to see into — a work group shouldn't auto-read from a personal group and vice versa, especially when someone else invites them into a new group.

**User story:** *"As a user, I want to configure which of my groups are included as read and write for the default 'daily agent link' buttons — for both MCP and web agents. When I'm added to a new group, it should default to excluded for both read and write until I explicitly include it. The quick-click buttons should behave the way I've set them, so I don't accidentally leak a personal group's recipes into a work session or vice versa."*

**Why "new groups default excluded":** The alternative (default included) means every invite accepted via the feed silently widens the scope of every daily link the user generates. The scope creep is invisible until something leaks. Default-excluded is the same safety posture as "privacy-narrow by default" (principle #4) — explicit opt-in beats implicit opt-out for scope expansion.

**What this does not change:** `/keys/scoped` (the API Keys page) stays as the full-control surface for custom expiry, per-group read/write, and labels. This is only about the quick-click defaults on Dashboard and the agent-connect box on the Groups page.

#### The "inviting in your AI agent" moment

The invitation isn't just adding a human to a group — it's giving their AI agent immediate access to the group's accumulated taste and judgment. This reframing came from a Soup.net recipe check (2026-04-05, soup-net-development group): *"As the founder of Soup.net, I chose to frame collaboration onboarding as 'inviting in' a person's AI agent… they click to get a briefing for their choice of AI tool, and their agent immediately has all the shared context."* This shapes both the copy and the flow.

- **Post-accept onboarding story.** *"I just accepted my first group invite. The group page greets me: 'You're in Earth Day Planning with Andy. Your AI agent can share this group's taste on its next session.' Two buttons — Copy MCP briefing / Copy web briefing — each generates a scoped key and a paste-ready prompt for my agent. I paste the MCP briefing into Claude Code, and my next recipe check finds the group's existing recipes on turn one."*
- **Cross-vendor reach.** *"It doesn't matter whether I use Claude, ChatGPT, or Gemini. The briefing works for whatever agent I already have. The invite pulled in my team's context, not a vendor's."*

### 3. The Self-Hosted User
**"I want to run this on my own infrastructure."**

A technically capable user or organization that wants complete data sovereignty. They clone the open-source repo and run their own instance. No data leaves their systems.

**Key needs:** Clear setup docs. Same features as the hosted version. Their own Gemini API key for embeddings. Docker Compose for local dev, their own Terraform/infrastructure for production.

**What changes:** They configure their own `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`. Their agents point to their own MCP endpoint. Everything else works the same — the code is identical.

### 4. The First Adopter
**"I'm going to try this out before convincing anyone else."**

One person discovers Soup.net and starts using it solo. Their corpus is initially personal. As they find value, they create a group and invite colleagues. The transition from solo to collaborative should be effortless — the personal recipes are already there, now group recipes start accumulating alongside them.

**The first-adopter experience is the most critical user journey.** The system must be immediately useful for a single user. Value should be evident within the first session: the agent finds something from the same session and applies it correctly to a new context.

**Key needs:** Immediate value for single user. Effortless transition to group sharing. Visible "corpus growing" over time (Recipe Map, dashboard stats).

---

## Agent Archetypes

Organized by capability, not by product. Specific AI products are listed as examples.

### Agent Type A: Tool-Connected (MCP)
**"I have structured tool access. I call functions and get structured responses."**

**Examples:** Claude Code, Claude Desktop, Google Antigravity, any MCP-compatible agent.

**Interface:** MCP tools — `check_recipe`, `get_recipe_guide`, `list_my_groups`.

**Capabilities:**
- Calls tools with structured parameters (recipe text, evidence, group, filter, axes, clusters, max_chars)
- Gets structured responses (results with evidence, scores, concept positions, drill-down hints, available actions)
- Can call `list_my_groups` to discover group context and decide where to write
- Can use sub-agents or background tasks for parallel recipe checking
- Can schedule recurring checks (e.g., `/loop` in Claude Code)
- Manages its own API key via `.mcp.json` or CLI config

**Key design considerations:**
- Response verbosity is manageable — agents can use `max_chars` to control context usage
- Evidence format compliance is high — LLMs understand the recipe format from their training
- Recipe checking should feel like a natural side-effect of work, not a separate task
- Coverage diversity is maximized when different sessions use different API keys

**User stories:**
- *"I'm starting a new coding session. I call `get_recipe_guide` then `list_my_groups` to orient myself, then check a broad discovery recipe about the task at hand."*
- *"I'm facing a design decision. I check my proposed approach as a recipe with evidence, and the system returns related recipes — including one that contradicts my approach with evidence from a different project."*
- *"I've finished meaningful work. I check a recipe that logs what was decided and why, so future agents find it."*
- *"I need to write to the team's group, not my personal one. I specify `group='project-slug'` on the check."*
- *"I want to understand how this recipe relates to two concepts. I pass `axes='performance, readability'` and get positions showing the recipe's similarity to each."* (Not yet fulfilled — concept axes on check results are implemented but agents don't yet use them proactively)
- *"My user's preference is ambiguous from context alone. I form 3 divergent hypotheses and use MCP elicitation to present them as choices. The user picks one, I check that recipe, and the result gives me both the logged preference and related context from the corpus."* (See [Divergent Recipe Checks](#divergent-recipe-checks-discovering-taste-through-hypothesis-branching))

### Agent Type B: Web-Browsing
**"I can visit URLs and fill forms, but I don't have structured tool access."**

**Examples:** ChatGPT with web browsing, ChatGPT Operator, Google Stitch, any browser-based AI agent.

**Interface:** HTML form at `/check?key=<api-key>`.

**Capabilities:**
- Visits the check page URL (API key embedded in URL)
- Reads HTML instructions (concise — every tag costs tokens)
- Fills the form: recipe text, evidence, optional filter/group/axes
- Reads HTML results on the same page
- Can follow links to recipe guide, setup docs

**Key design considerations:**
- HTML must be minimal — instructions collapsed for returning agents
- The form IS the interface — no JSON, no Bearer auth, no structured responses
- Group dropdown shown when key has multiple write groups — same capability as MCP
- Format adherence will be lower — the warn/reject system catches bad recipes
- Page refresh is idempotent — safe for agents that retry
- Recipe checks are framed as "Check a Recipe" not "Submit" — reinforces read-only feel

**User stories:**
- *"My user asked me to remember their poster design preference. I visit the check page, fill in the recipe and evidence, and submit. The preference is now searchable by any of their agents."*
- *"I'm starting work and want context. I visit the check page with a broad discovery recipe about the task, and the results show me relevant decisions from previous sessions."*
- *"My user has both a personal group and a project group. I see a dropdown on the form and select the project group for this team decision."*
- *"My user's taste on brand direction is unclear. I generate 4 divergent recipe-check links — each a different plausible framing — and show the full recipe text alongside each. The user clicks the ones that resonate, copies the results back, and I now understand which direction they prefer."* (See [Divergent Recipe Checks](#divergent-recipe-checks-discovering-taste-through-hypothesis-branching))
- *"My user is not technical. Asking them to paste a JSON blob back to me is scary and error-prone. Soup.net gives me a short 'citation link' — one URL — that they can paste back. I fetch that URL to retrieve the full check result. The user only ever sees a single friendly link, never raw JSON."* (See [Citation links for non-technical copy-back](#citation-links-for-non-technical-copy-back))
- *"I'm in a long session and have already seen many of the recipes Soup.net returns. I don't need the full body of a recipe I already have in context — just its ID is enough so I can reference it. When I include `known_recipes=[id1, id2, ...]`, Soup.net omits full text for those and returns only a compact tree of IDs for the duplicates, keeping my context window lean."* (Not yet implemented — see backlog "Context-bloat optimization: `known_recipes` / `recipe_book` mechanism")

### Agent Type C: API-Integrated
**"I make HTTP requests programmatically."**

**Examples:** Custom agents, scripts, CI/CD pipelines, bots built with the Anthropic Agent SDK.

**Interface:** JSON API at `/check?format=json` with API key in URL or headers.

**Capabilities:**
- Full programmatic access to all parameters (recipe, evidence, filter, axes, group, read_groups, clusters, max_chars)
- Structured JSON responses with evidence, scores, concept positions, drill-down hints, available actions
- Can paginate, sort, expand clusters
- Can integrate recipe checks into automated workflows

**User stories:**
- *"A CI pipeline checks a recipe after each deploy: 'As a team, we deployed version X with changes Y.' The recipe logs the deployment decision with evidence, building a searchable history of why each deploy happened."* (Aspirational — not yet implemented)
- *"A scheduled script checks a daily summary recipe that captures the team's key decisions, so the Monday morning standup agent has context from the previous week."* (Aspirational)

---

## The Human Experience: Understanding What Agents Built

The SPA dashboard is how humans see, understand, and guide their agents' accumulated judgment. These are critical UX moments:

### Seeing the corpus take shape
**User story:** *"I open the Recipe Map for the first time after a week of using Soup.net. I see five colored clusters. The largest is about my coding preferences. I click into it and see sub-clusters: error handling, library choices, deployment patterns. I realize my agent has been faithfully logging every judgment call I made."*

### Looking from different angles
**User story:** *"I switch to Concept Axes mode and type 'technical decisions' and 'design taste.' My recipes separate into clear quadrants. I notice a cluster in the upper-right that's both technical and design-related — accessibility decisions. I didn't think of accessibility as a separate theme, but the map shows it is."*

Based on [Semantic Projection (Grand et al., 2022)](https://www.nature.com/articles/s41562-022-01316-8). See [research-foundations.md](architecture/research-foundations.md) for formal description.

### Reviewing what agents have done
**User story:** *"I check the Recipe Check Log on the dashboard. I see my coding agent made 12 recipe checks today. One of them logged a decision I didn't explicitly tell it about — it inferred my preference from my code review comments. I click through to the trace detail and see the evidence. It's accurate. The agent is learning from my behavior, not just my instructions."*

### Correcting the record
**User story:** *"I see a recipe from two weeks ago: 'Prefers Material UI for React components.' That's outdated — I've switched to Radix primitives. I tell my agent: 'I no longer prefer Material UI, I've switched to Radix because of better accessibility defaults and smaller bundle.' The agent checks a new recipe with this evidence. Both recipes exist in the corpus. When future agents search for React component preferences, they'll find both — but the newer one with fresh evidence will rank higher. Eventually, temporal decay will reduce the old recipe's influence."*

Temporal decay for recipe relevance is planned but not implemented. See [search-algorithms.md — Stigmergic Decay](architecture/search-algorithms.md#stigmergic-decay--temporal-weighting-of-recipes-research-needed).

**The exception: malformed recipes.** Outdated-but-correct recipes are preserved (with decay) because they reflect a real prior judgment. *Malformed* recipes are different — agent-perspective phrasing ("As an AI agent…"), off-format claims, hallucinated evidence — and should be hard-deleted, not decayed. They never represented a real human judgment, so leaving them in the corpus pollutes vector neighborhoods and biases future searches without any countervailing temporal signal. The trace details page exposes a Delete affordance for the trace owner, the group's owner/admin, and system role; the cascade prunes orphaned evidence/references but preserves the content-hash-keyed `vector_cache`. An audit-log entry captures the deletion. **Don't reach for delete to express disagreement** — log a fresh recipe with current taste; that's what temporal decay is for.

### Understanding group dynamics
**User story:** *"I scope the Recipe Map to my project group and see 30 recipes from three different collaborators. I switch to concept axes with 'logistics' and 'design' — the map shows that most recipes are about logistics (event planning, volunteer coordination) and there's a gap in design decisions. I mention this in our next meeting and we spend time discussing the design direction, which our agents then log."*

---

## Divergent Recipe Checks: Discovering Taste Through Hypothesis Branching

### The insight

When an AI agent has thin evidence about a user's preference, the worst thing it can do is commit to a single guess and recipe-check it. That logs an inaccurate recipe and returns results that reinforce the wrong direction. The best thing it can do is **form multiple plausible hypotheses and present them as choices**. The human's selection IS the taste signal — more accurate than any single guess, and the chosen recipe is the only one that gets logged.

This pattern emerged from a real interaction where a read-only web agent (ChatGPT) was helping with Soup.net design direction. Instead of checking one thin recipe, it generated five divergent clickable recipe-check links — each capturing a different plausible framing of the user's taste. The user could see the differences, choose which resonated, and click to check that one. The unchosen hypotheses were never logged.

> "I like this so much because it keeps me in the driver's seat making the actual taste and judgement calls."
> — Andy, 2026-04-03

This is fundamentally different from asking the user a question. The agent does the thinking work — forming concrete, fully-evidenced hypotheses — and the human makes the judgment call by choosing between them. It's the Socratic method applied to taste discovery: not "what do you prefer?" but "do you prefer this, or this, or this?"

### Why this matters for the product

Divergent recipe checks solve three problems simultaneously:

1. **Accuracy.** A single thin recipe check risks logging something wrong. Multiple divergent options let the human course-correct before anything is logged. Only accurate recipes enter the corpus.

2. **Discovery.** The agent surfaces distinctions the human may not have articulated. "Do you want the brand to feel warm-editorial or hand-drawn-future?" forces a choice that clarifies taste in ways open-ended questions cannot.

3. **Efficiency.** One interaction can resolve multiple taste questions at once. The human clicks 2-3 links, each logging a distinct judgment, and the agent gets back rich context from the results.

### Two modes of divergent checks

**Select-one (either/or).** The agent presents 2-4 hypotheses where the framing itself is what differs. Clicking one means "this is closer to my taste." Example: audience framing A (AI power users) vs. audience framing B (solo creators). The human's choice clarifies the strategic direction.

**Select-many (and/and).** The agent presents several complementary hypotheses that are all potentially valid. The human clicks all that resonate. Example: warm brand direction AND hand-drawn elements AND founder story page — these aren't mutually exclusive, they're separate dimensions of taste.

The agent should make it clear which mode applies — "choose the one that fits" vs. "click all that resonate.". In either mode, the agent should encorage the user to clarify if useful, and form new hypotheses via new recipe checks if none are selected or in other cases where this would be useful.

### Presenting divergent checks to the human

The agent should show the full recipe text alongside each link, not just a label. The human needs to evaluate whether the framing matches their intent before clicking. A link labeled "Warm brand direction" is opaque; the full recipe text "As a founder shaping Soup.net's brand, I want the design to feel welcoming, warm, playful, and thorough so that it feels like wise family guidance rather than cold enterprise software" lets the human judge the accuracy of the hypothesis.

**What the agent should display for each option:**
- The full recipe text (the hypothesis)
- A brief note on what choosing this option clarifies ("This frames the brand as family wisdom rather than enterprise software")
- The clickable link (for read-only agents) or a button to confirm (for MCP agents)

### Result identification in copy-paste workflows

When a user clicks a recipe-check link and copies the JSON result back to the agent, the result must clearly identify which recipe was checked. The JSON response includes a `recipeId` and the full recipe text in the input echo — the agent can match these to the divergent options it presented. This is critical when the user clicks multiple links in sequence.

### Implementation by agent type

#### Agent Type A: Tool-Connected (MCP)

MCP agents have the richest options for divergent checks:

**Option 1 — Elicitation.** Use MCP's [elicitation capability](https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/elicitation) to present choices directly to the user within the agent interface. The agent describes each hypothesis, the user selects, and the agent checks only the chosen ones. This keeps the human in the loop without leaving the agent session.

**Option 2 — Sub-agent exploration.** For agents that support sub-agents (Claude Code, Antigravity, etc.), launch a context-efficient sub-agent briefed with the set of potential recipe checks. The sub-agent conducts a dialog with the user — presenting options, gathering choices, checking the selected recipes, and then reporting back to the main agent with just the choices made and key insights from the results. This keeps the main agent's context clean while the sub-agent handles the exploratory conversation. Not all MCP clients support sub-agents — this should be presented as an optional enhancement, not a requirement. If the user provides clarification or other context within the session, this sub-agent should be encouraged through its briefing to produce new recipe checks better aligned for the goals in its briefing. The recipe checks that the sub agent executes may provide context for better follow up recipe checks as well.

**Option 3 — Sequential checking with confirmation.** The agent presents the set of hypotheses as text, asks the user which to check, then checks them one at a time with confirmation. Simpler than elicitation but more conversational turns. Some agents, such as Claude Code, have the built in ability to present a series of questions to a user as a part of the same LLM generation, which makes this more efficient.

#### Agent Type B: Web-Browsing

Web-browsing agents generate clickable links. This is where the pattern was discovered and works naturally:

- Generate 2-4 divergent recipe-check URLs with full recipe text shown alongside each
- The user reviews, clicks the ones that match their taste, and copies results back
- The agent matches results to presented options via the recipe text in the JSON response
- Group slugs should be included in URLs — discoverable from the check page's groups list

#### Agent Type C: API-Integrated

API-integrated agents can batch multiple recipe checks programmatically, but should still present the divergent options to the human for selection first — automated checking without human review defeats the purpose of taste discovery.

### Case study: Design direction discovery via ChatGPT

See [docs/case-studies/chatgpt-divergent-design-checks.md](case-studies/chatgpt-divergent-design-checks.md) for the full annotated interaction that led to this pattern. Key observations:

- ChatGPT generated 5 divergent recipe-check links covering brand feel, visual language, content strategy, and audience framing
- Each link was a fully-formed hypothesis with evidence from the conversation
- The user wanted to click ALL of them — revealing that the hypotheses were complementary, not competing
- ChatGPT could not discover the group slug for `soup-net-development` because it's a read-only agent — this directly motivated the groups list on the check page
- The agent's design brief synthesized the taste signals from the user's selections into a coherent creative direction

---

## Citation Links for Non-Technical Copy-Back

### The problem

For web-browsing agents that can't submit forms (ChatGPT, Gemini, etc.), the current copy-back pattern is: the user clicks a recipe-check link, the result page shows a JSON blob, the user copies the blob back into chat. This works — but JSON is visually alarming for non-technical users and fragile when copy-paste truncates or reformats it.

This problem surfaced in a conversation with a non-technical user's friend-of-a-friend: *"JSON is technical and scary looking for non technical people."* (Jamie, via Andy, 2026-04-18)

### The proposed pattern

Instead of a JSON blob, the check result page should provide a short, shareable **citation link** — a single URL that identifies the check result. The user pastes just that URL back into the chat. The web AI agent, which can already fetch URLs, fetches the citation URL to retrieve the result.

The structural guardrail that makes this safe: web AI agents are expected not to fetch URLs they construct themselves (an anti-SSRF / anti-hallucination guardrail), but they will fetch URLs **the user explicitly provides**. A citation link is user-provided context, so it passes the guardrail while hiding the JSON from the human.

### Assumptions to verify

- Citation URL must resolve to machine-readable content (JSON) when fetched by an agent, and to a human-readable summary when opened by a human in a browser (content negotiation or format-suffix).
- The link must be short enough to feel like a single unit (ideally ≤60 chars including the domain).
- Agent behavior must be tested across the major web-browsing products (ChatGPT, Gemini, Claude web, Grok) — specifically: do they fetch a URL the user pastes with no other explanation? Under what prompts do they refuse?
- The citation identifier should be opaque (no enumeration of other users' check results). Current recipeId is a UUID, which satisfies this.

### User stories

- **Non-technical human.** *"I'm using ChatGPT to help me write fundraiser copy. It gives me a Soup.net link, I click it, I see the results on a page, and then it tells me to copy the citation link at the top of the page back into chat. I copy one short link. ChatGPT reads it and keeps going. I never saw any raw data."*
- **Web AI agent.** *"After my user clicks the recipe-check link I generated, the result page shows a citation URL prominently. I instruct my user to paste just that URL back. When they do, I fetch it and parse the JSON myself — the user never has to touch it."*

### Out of scope for this first pass

- Signed / expiring citation links (could add later if abuse shows up)
- Citation aggregation (one link representing multiple checks)

---

## Dashboard as a Feed

### Principle

The SPA dashboard's central area is a **chronological, urgency-ordered feed** of things the user should attend to or be aware of. Not a single widget for "recent recipes" — a multi-source feed where the most urgent item (a pending group invitation, a security alert, a rate-limit warning) rises to the top, and lower-urgency items (agent activity, cluster changes) flow below. Static widgets (key count, group count, recipe count) stay in the sidebar where they serve as ambient information.

This shape mirrors how humans actually relate to shared systems: we don't open apps looking for one specific widget — we open them to see "what's new, what needs me, what happened." A feed answers all three in one scroll.

### Urgency ordering

Items fall roughly into tiers:

1. **Action required** — pending group invitations, email re-verification, expired keys that should be rotated
2. **Recent activity by me or my agents** — recipes checked today, groups I've joined, keys I've created
3. **Recent activity in my groups** — recipes others checked in shared groups (social proof)
4. **Ambient stats** — recipe count trend, cluster count, map updates

Tier 1 items always surface above tier 2+. Ordering within a tier is reverse-chronological.

### User story

- *"I open Soup.net. The top of my feed has a yellow-accented card: Priya invited me to Earth Day Planning. Below it are my agent's recipe checks from this morning. Below that, a card showing Andy's recent activity in our shared group. The dashboard tells me what to attend to first, then what's happening around me — in that order."*

### Out of scope for this first pass

- Full tier-based ordering across many event types (we start with just group invitations)
- Subscription/mute controls per feed source
- Push notifications

---

## Strategic Differentiation

### The collaboration gap

The big AI vendors are building strong memory inside their products — Claude Projects, ChatGPT Memory, Anthropic auto-memory, Gemini context. Within an ecosystem, they're getting good at this and will continue to. The gap they aren't structurally incentivized to close is the one *across* products: across the agents one person uses, across the vendors a team uses, and across humans at different points in their AI maturity journey. Vendors want users in their ecosystem; closing cross-platform gaps works against that incentive.

Soup.net's position is the inverse. Its only job is the across — across agents, across vendors, across humans. That's the structural moat.

### Trust through independence

> "Every AI vendor wants a moat around their product so people stay in their ecosystem. I think people instinctively know this, and will trust an independent source for their general taste and judgement more than they would trust an individual vendor."
> — Andy, 2026-03-28

People will trust an independent system for their taste and judgment over any single vendor's memory, because vendors have an inherent conflict of interest. This structural position persists even when vendors copy every feature and implement them better. The analogy: people trust independent credit rating agencies even though every bank has more sophisticated internal models.

### Bridging the AI maturity gap within teams

The bottleneck to AI adoption inside teams is no longer model capability — it's systems change. Different team members are at different points in their personal AI maturity journey, and that gap is hard to close one human at a time. An AI-native lead developer who produces layered documentation through their agents has no good way to share that with a graphic designer who isn't comfortable with VS Code, git, or the steps required to get useful work out of ChatGPT. The fall-back is the old shape — meetings, mockups, more meetings — and the AI-native member moves too fast for it. Teams desync.

Soup.net moves the friction off the human and onto the agent layer. The AI-mature member's accumulated taste and judgment becomes accessible to the less-AI-mature member's agent without requiring the human to learn a new toolchain. Their agent does the carrying. They use whatever interface they're already comfortable with — including web chatbots that don't even install MCP tools — and Soup.net's shared corpus shows up in their conversations as context, not as a new system to learn.

The deeper shift: a tool you have to learn is friction; a tool your agent uses for you is leverage. Equipping every agent with the same shared corpus means less time correcting and briefing them, and more time spent on the autonomous, independent, long-running work that's the point of having agents in the first place.

This is why a separate, neutral system has to exist for this to work. No single vendor can offer recipe-sharing between, say, a Claude user and a Gemini user — sharing across ecosystems requires a third party that isn't competing for ecosystem capture.

### Two-layer UVP — lasting vs replicable

**Lasting / structural — defensible even when vendors copy every feature:**
- **Cross-vendor portability** — works across Claude, ChatGPT, Gemini, and any custom agent. Vendors are structurally incentivized to keep memory inside their ecosystem; we're structurally outside it.
- **Cross-vendor team sharing** — no single vendor can offer recipe-sharing between users on different ecosystems. That requires a neutral third party.
- **Web-agent access via the stigmergic-link pattern** — disconnected web chatbots (ChatGPT web, Gemini web) can participate in the corpus through user-pasted links. Vendors restrict tool access for cost and safety reasons; these constraints are industry-wide, not temporary. Soup.net's clickable-link UX works within them.
- **Data exportability + open source** — your data is always exportable, and the codebase is open-source for self-hosters. The hosted version stores data on Soup.net's servers; we're an independent third party, not a self-host. Honest framing: "your data, always portable" is true universally; "your data physically yours" is a self-host promise. Don't conflate them.

**Useful now / replicable — vendors may eventually cover these within their ecosystems:**
- Structured recipes with evidence (Toulmin model)
- Coverage diversity from independent sources
- Non-judgmental reporting (search-time surfaces present related evidence neutrally; the LLM consumer interprets stance against current context, since cosine over gemini-embedding-2-preview encodes topic, not stance — ADR-0015)
- Cross-tool / cross-team collaboration features within a single vendor's ecosystem

### Implications for product decisions

- **Does this feature strengthen the across (cross-agent, cross-vendor, cross-maturity)?** → Prioritize
- **Does this feature bring the future early?** → Build for adoption, don't treat as moat
- **Does this feature lock users in?** → Reconsider

---

## Monetization Hypotheses

**Status:** Low-priority hypotheses, not commitments. No pricing or ecommerce yet.

**Core stance: the free offering is the product, not a funnel.** The free tier is intended to be a fully functional solution for solo users and small groups. Paid features exist at the edges — either to test willingness-to-pay for power-user extensions, or to gate features that carry per-user cost or abuse surface. The core recipe-check loop, group collaboration, and cross-agent portability stay free.

**Experimentation plan.** Before any ecommerce, add a manual `paid_user` flag (admin-set) and gate candidate features behind it for Andy and trusted testers. This lets us build and dogfood paid features without committing to prices, Stripe, or billing UX.

### Value features — will users pay?

Power-user extensions to test willingness-to-pay:

- Download vector embeddings alongside recipe data (portability / local analysis)
- **LLM-powered corpus tidy** — surface subtle, easy-to-fix voice issues (group-implied product names, compound roles that collapse `[goal]` into `[role]`, missing explicit "so that" warrants, user-relationship leakage) with one-click rewrites. The cataloged failure modes from the agent-voice work (`docs/briefings/soupnet-agent-voice-plan.md`) plus the per-group subtleties library (`packages/domain/src/recipe-examples.json`) are the seed prompts. The hard part — identification — is what the LLM is doing; the fix itself is usually mechanical (swap a role string). Free tier could surface counts; paid tier batches the suggested edits.
- **Per-group corpus quality reports** — failure-mode rates and trends over time, which subtle patterns are getting better or worse, which recipes a re-edit would most improve discoverability for. Pairs with corpus tidy: the report identifies, the tidy applies.

### Gated features — paywall for verification or cost recovery

Features where free-for-all is structurally bad (per-use cost, abuse surface, identity-verification need). The paywall exists to deter or recover, not because the feature is premium:

- Serving multimodal files from recipe checks, and retaining them after embedding (storage + egress cost; retention also needs deliberate user consent)
- LLM integration features — specifics TBD (per-call cost). The corpus-tidy and quality-reports value features above are the most concrete instances surfaced so far; both have per-call LLM cost as a built-in deterrent against frivolous use.

---

## Recipe Check Scenarios

See the public [Recipe Check Scenarios](/docs/recipe-scenarios) page for annotated conversations showing how AI agents should and shouldn't use recipe checks. When we discover a new nuance, add a scenario to the public file first, then update the recipe guide.

---

## Privacy & Storage Modes (Future)

Detailed design for Full/Indexed/Air-gapped storage modes has been moved to [docs/planning/privacy-storage-modes.md](planning/privacy-storage-modes.md). These features are planned but not yet implemented. The current system stores all recipe content on the server with group-level access control.

---

*Last updated: 2026-04-03. This document should be updated BEFORE implementing features, not after.*
