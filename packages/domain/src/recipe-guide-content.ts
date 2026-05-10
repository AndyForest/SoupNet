/**
 * Shared recipe guide content — single source of truth for both
 * the MCP get_recipe_guide tool and the web /docs/recipe-check-guide page.
 *
 * Plain text format (MCP) and HTML format (web) are separate renderings
 * of the same underlying content defined here.
 *
 * This is the CONCISE client-facing guide. For verbose annotated scenarios
 * with full conversations and analysis, see docs/design-thinking.md
 * "Recipe Check Scenarios" section (served at /docs/recipe-scenarios).
 */

// ── Sections ────────────────────────────────────────────────────────────────

export const HOW_THIS_WORKS = {
  title: "How this works",
  text: `A recipe check compares your recipe against the corpus and returns similar recipes. As a side effect, your recipe is logged — this is how the corpus grows and future checks get smarter. Check freely and often.

This is stigmergy — indirect coordination through environmental traces, like ants following and reinforcing pheromone trails. The more you check, the more useful the system becomes for everyone. The only anti-pattern is checking a recipe you don't genuinely believe, since that degrades future checks.`,
};

export const FOR_AI_AGENTS = {
  title: "For AI agents — read this first",
  text: `You are capturing the HUMAN USER's taste and judgment, not your own. Recipes are written from the user's perspective in a transferable role: "As a [role] working on [goal], I [prefer/chose] so that [reason]."

Three voice mistakes break this. The role should be the user's, not yours; transferable, not personal; and not duplicating context the recipe-book description already provides:
- Agent voice — "As an AI agent, I recommend...". You're narrating your own reasoning instead of the user's preference. Replace with the user's role.
- User-name voice — "As Andy reviewing two AI design briefings...". The role collapses into one person; another product owner facing the same call gets no hit. Use a transferable role like "As a product owner evaluating AI agent outputs".
- Recipe-book-implied product voice — "As a Soup.net developer cleaning up iPhone Safari mobile issues...", written to the soup-net-development recipe book. The recipe book's description already says this is Soup.net development; restating it bloats the role and degrades clustering. Use the underlying technical role like "As a front-end React developer cleaning up iPhone Safari mobile issues" — it transfers to anyone working on the same kind of problem in any project.

Every recipe needs context. The [role] and [goal] together scope the judgment — without them, taste drifts into context-free assertions that persist where they're not useful. "I prefer Hono" is ambiguous. "As a backend developer building an edge-deployed API, I chose Hono over Express so that deployment stays portable" is actionable.

Two modes of checking, both valid:
- Surfacing assumptions: You observe indirect evidence (config files, patterns, past choices) and form a hypothesis about the user's preference. Check it — the system returns evidence that may confirm, refine, or contradict. Agents constantly cross gaps in knowledge; checking assumptions makes those gaps visible and improvable.
- Logging stated preferences: The user tells you something directly about their taste or judgment. Check it to record and find related context. The accuracy bar is higher here — you have their actual words, so use them.

If you don't know the user's role or goal, ask — or use a general framing like "As a developer working on [project]". If you genuinely have no grounded hypothesis at all about the user's taste here — not even a thin one — that's a signal to ask the user, not to fabricate a recipe to log. Recipes work because they're genuinely believed.

A practical test: read the recipe with the user's actual name swapped in for "I". If the sentence becomes false, the voice is wrong.

For deeper context with annotated conversation examples, see the Recipe Check Scenarios.`,
};

export const WHEN_TO_CHECK = {
  title: "When to check recipes — non comprehensive examples",
  triggers: [
    {
      label: "Before starting a task",
      detail: 'broad discovery check: "As a [role] about to work on [topic], I want my AI agent to surface relevant context and suggest approaches before I make decisions." This expresses how you want the agent to behave, not just what you\'re about to do.',
    },
    {
      label: "When facing a judgment call",
      detail: "targeted check on the specific decision: technology choice, design pattern, architectural trade-off. Check before deciding.",
    },
    {
      label: "After completing meaningful work",
      detail: "log what you learned: what was chosen, why, with evidence from the work itself. This is how the corpus grows.",
    },
  ],
  framing: `Recipe checks are valuable when (uncertainty × impact) and/or (surprise × utility) is meaningful — how unsure you are about the user's preference and how much rides on getting it right; whether another agent would be surprised by this call and how useful it would be for them to find it logged. Thin assumptions are welcome — that's a primary use case. The bar to skip a check is "no grounded hypothesis at all" or "no consequence either way", not "I'm not 100% sure".

Skip the check (and consider asking the user instead) when you genuinely have no grounded hypothesis about the user's taste — not even a thin one. Skip silently when the decision is trivial autonomous implementation (variable names, comment phrasing, intermediate paths) that doesn't clear (uncertainty × impact). Recipe-check the calls that do clear it; let the rest be quiet.`,
};

export const TASTE_VS_JUDGMENT = {
  title: "Taste vs. judgment — both need context and evidence",
  taste: `Taste is more personal and subjective: "As a developer setting up my daily coding environment, I prefer high-contrast themes so that syntax highlighting is immediately readable." Even pure taste has a context — the role, the goal, the situation. Evidence for taste is either the user's direct expression of the preference, or your observation of artifacts that reveal it (their config files, past choices, consistent patterns). The user or their work IS the source.`,
  judgment: `Judgment is contextual and reasoned: "As a backend developer building an edge-deployed API, I chose Hono over Express so that deployment stays portable across runtimes." Evidence for judgment ideally includes benchmarks, documentation, or prior experience that informed the decision.`,
  summary: "Both matter. Both need context and evidence — taste evidence points more at the user and their artifacts, judgment evidence can point more at external sources as well. Context (role + goal) is always required — it prevents taste from drifting into context-free assertions that persist where they're not useful.",
};

export const RECIPE_FORMAT = {
  title: "Recipe format",
  preferred: "As a [role] working on [goal], I [prefer/chose/decided] so that [reason]",
  key: "Every recipe captures four things: who (the human's role), what they're working on (the goal/context), what they chose or prefer (the judgment), and why (the reasoning). Context is required — taste without context becomes stale guidance that persists where it's not useful.",
};

export const EVIDENCE_FORMAT = {
  title: "Supporting evidence format",
  template: `Recipe and evidence go in one field, separated by a blank line. First paragraph is the recipe, everything after is evidence.

Each evidence entry has three parts:
  Your interpretation of how this supports the recipe.
  > "Direct quote from source -- exact words, not a summary"
  -- Source citation (URL, document, chat timestamp)

Separate multiple entries with blank lines.

Note: The system surfaces related evidence from other recipes automatically via cosine-similarity search over gemini-embedding-2-preview vectors. The math finds topical neighbors; it makes no stance assertion. You only provide supporting evidence; the LLM consumer interprets whether returned related evidence supports, contradicts, or adds context.`,
};

// ── Recipe examples ─────────────────────────────────────────────────────────

export interface RecipeExample {
  label: string;
  recipe: string;
  evidenceFor: string;
  quote?: string;
  source?: string;
  explanation?: string;
}

export const RECIPE_EXAMPLES: RecipeExample[] = [
  {
    label: "Surfacing an assumption (developer)",
    recipe: "As a developer working on the Acme API, I prefer strict TypeScript configuration so that type errors are caught at compile time rather than runtime.",
    evidenceFor: "User's tsconfig.json has strict mode enabled with noUncheckedIndexedAccess, suggesting a preference for maximum type safety.",
    quote: '"strict": true, "noUncheckedIndexedAccess": true',
    source: "User's tsconfig.json",
    explanation: "Toulmin in action: the claim is scoped to a project, the warrant connects config evidence to the preference, the data is a verbatim config snippet. Future agents on Acme API will find this — stigmergy.",
  },
  {
    label: "Logging a stated preference (non-technical creator)",
    recipe: "As a parent organizing the Spring Fundraiser, I prefer bold, high-contrast poster layouts so that they're readable on the school bulletin board from a distance.",
    evidenceFor: "User chose Option B (bold layout) over two subtler alternatives after comparing all three.",
    quote: "The bold one — parents walk past the board quickly, it needs to grab attention",
    source: "User conversation, 2026-03-28",
    explanation: "Stated preference logged with the user's own words as data. The quote is verbatim — truthfulness means the string between quote marks is exactly what was said.",
  },
  {
    label: "Judgment call with project context (developer)",
    recipe: "As a backend developer building the Soup.net recipe check system, I chose Hono over Express for the API so that edge deployment stays possible.",
    evidenceFor: "Hono runs on Web Standard APIs (Request/Response) which work on edge runtimes like Cloudflare Workers and Deno Deploy. Express requires Node.js-specific APIs.",
    quote: "Hono handles our edge deploy case way better, let's go with it",
    source: "User decision during framework selection, 2026-03-01",
    explanation: "A judgment call with external reasoning. Other agents working on Soup.net will find this when making related technology choices — stigmergy across a project.",
  },
  {
    label: "Broad discovery before a task",
    recipe: "As a designer about to start creating the brand identity for the Riverside Bakery website, I want my AI agent to make several divergent suggested design options to me to help discover my relevant design preferences and make decisions such as color palette.",
    evidenceFor: "Starting a new design project — no stated preferences yet, so surfacing assumptions is the right approach.",
    quote: "Give me some options for the general design",
    source: "New project kickoff Claude Code conversation, 2026-03-26",
    explanation: "A broad, exploratory recipe. Its warrant is that the user asked for this kind of collaboration — truthful, grounded, and productively vague. The results will sharpen what comes next.",
  },
  {
    label: "Recipe-book collaboration (non-technical)",
    recipe: "As a volunteer coordinator for the Spring Fundraiser, I chose Google Docs for our shared planning so that everyone can edit from any device, including mobile.",
    evidenceFor: "Team consensus reached via Slack discussion. All four members agreed.",
    quote: "fine for the plan, but I'll share design drafts as Figma links",
    source: "Priya on Slack, 2026-03-28",
    explanation: "A team decision logged to a shared recipe book. Other members' agents find this without anyone sharing notes — stigmergy across a team.",
  },
  {
    label: "Thin prompt, divergent branch (seed + selection, slot-annotated)",
    recipe: "As a co-creator of an indie strategy game working on a faction-allegiance reveal, I chose to signal the friendly creatures' allegiance through protective formation — the squad tightly flanking the protagonist and facing outward at the rival camp — so that side-taking reads at a glance without tipping into a cute or anthropomorphized register.",
    evidenceFor: "The user named allegiance-legibility as the central visual problem in the current prompt. The seed quote lands directly on [choice] (what to depict) and propagates to [reason] with uncertainty — is the 'why' aesthetic readability, fidelity to the game's combat tone, or both? The user also imposed a negative constraint in the same message — \"Not a cute parody\" — which is strong evidence because it rules framings OUT of the divergent set, not just in. To disambiguate among three plausible ways to signal allegiance visually, divergent framings were presented and this one was selected.",
    quote: "The twist is simply that the creatures closest to her are clearly her allies",
    source: "User prompt, current session — plus user selection among divergent options",
    explanation: "Thin-prompt case. The agent mined the current message for seed evidence — the user's exact words about the central twist and tonal constraint. The selection-layer sentence becomes true when the user clicks. Co-authorship: the agent proposed framings, the human chose, the choice became the strongest evidence.",
  },
];

export const RELATED_EVIDENCE_IS_NEUTRAL = {
  title: "Supporting evidence and related evidence",
  text: "You provide supporting evidence when checking a recipe. The system also surfaces related evidence from other recipes via cosine-similarity search over gemini-embedding-2-preview vectors — this may support, contradict, or add context. The system makes no stance assertion (the negation problem means embeddings encode topic, not stance); you decide what related evidence means. When evidence from different recipes conflicts, surface the inconsistency to the user.",
};

export const RESPONSE_SIZE_CONTROL = {
  title: "Response size control",
  text: `Results are clustered to 3 exemplars by default. Use max_chars or clusters to adjust:
- max_chars=2000: tight budget, auto-clusters to ~3-5 exemplars
- max_chars=5000: detailed, auto-clusters to ~8-12 exemplars
- clusters=5: explicit control over how many exemplars to return
max_chars overrides clusters when both are specified.
Each exemplar shows how many similar recipes it represents (clusterSize).`,
};

export const GROUPS_GUIDE = {
  title: "Recipe books — choosing where recipes go",
  text: `Recipe books are how recipes reach the right audience. Before each check, ask: "Who benefits from knowing this?" Your answer determines the recipe book.

Call list_my_recipe_books to see your recipe books with descriptions and access levels. Use the recipe_book parameter (slug or ID) to write to a specific book. Default: your key's most private recipe book.

How to decide:
- Personal taste (coding style, tool preferences, workflow habits) → personal recipe book. Only your agents benefit.
- Project-specific decisions (architecture choices, library selection, security policy for this codebase) → the project's shared recipe book. Collaborators' agents find these when working on the same project.
- Cross-cutting judgment (general engineering principles, design philosophy) → consider which recipe book's context it enriches most.

The default is deliberately private — you won't accidentally share something. But defaulting to personal for everything undermines collaboration. Project decisions checked to a personal recipe book are invisible to collaborators, even when those collaborators (and their agents) would benefit most.

When in doubt, read the recipe-book descriptions via list_my_recipe_books. If a recipe book's description matches the context of your recipe, that's probably where it belongs.

Search scope: use read_recipe_books (comma-separated slugs) to restrict which recipe books you search. Default: all readable recipe books — cross-book context is generally valuable.`,
};

export const CONNECTION_TIERS = {
  title: "How to connect",
  text: `There are three ways to connect, depending on your agent's capabilities:

1. MCP tools (Claude Code, Claude Desktop, Antigravity): Full automation via check_recipe, get_recipe_guide, and list_my_recipe_books tools. One-command setup.

2. Web browsing with URL construction: If your agent can construct and fetch URLs, build recipe check URLs directly: /check?key=YOUR_KEY&recipe=URL_ENCODED_RECIPE&evidence=URL_ENCODED_EVIDENCE&recipe_book=RECIPE_BOOK_SLUG. The page accepts human-readable parameter names (recipe, evidence, recipe_book) via GET; the legacy parameter \`group\` is still accepted for backwards compatibility. Results appear on the same page. Recipe-book slugs are shown on the check page when you visit with your key.

3. User-assisted checking: Many web-based AI assistants (such as ChatGPT and Google Gemini web chat) have read-only web access by design — a responsible AI guardrail that we respect and support. These agents can read the recipe guide and check page, but cannot submit forms on external sites. For these systems:

Generate clickable recipe-check links for the user. When confidence is low or multiple framings are plausible, generate 2-4 divergent links so the user can choose the framing that best matches their intent — this turns a thin assumption into a productive branching choice. The user reviews, clicks, and copies results back to you.

Link formatting varies by agent UI: some chat UIs render complex URLs as clickable Markdown links (ChatGPT, Claude), while others intercept them into search redirects (Google Gemini). Agents don't know their UI's capabilities but do know their system identity — use your identity as a hint. If your UI reliably handles complex URLs, use Markdown links. If it intercepts them (or if you're uncertain), output the raw URL in a plain code block so the user can copy it. See the web-agent briefing for details.

To discover recipe-book slugs without MCP: visit the check page with the API key (/check?key=YOUR_KEY) — the page lists available recipe books with their slugs, names, and access levels. Include recipe_book=SLUG in your links to target the right book.

For all tiers: use human-readable parameter names in URLs (recipe, evidence, recipe_book) or the combined format (recipe text, blank line, then evidence). The system accepts both.`,
};

// ── Bootstrap blurb for human users to give AI agents ──────────────────────

export const BOOTSTRAP_BLURB = {
  title: "Quick-start instructions (copy-paste to your AI agent)",
  text: `You already work to understand my taste and judgment — Soup.net makes that understanding persistent and shared across my other agents and sessions. Recipe checks are read-only searches with an append-only logging side effect. Every check makes the corpus smarter for all my agents. There are no destructive operations, so check freely and often.

Recipes are from MY perspective (the human), not yours: "As a [my role] working on [my goal], I [prefer/chose] so that [reason]." Context scopes the judgment. Evidence supports the claim — my direct words, my artifacts, or external sources. Every claim and quoted reference needs to be true at the moment you submit.

For the full format with examples: call get_recipe_guide (MCP) or visit /docs/recipe-check-guide (web).`,
};

// ── Shared workflow content ──────────────────────────────────────────────────
// These are the building blocks for both the rendered guide AND the copy-paste
// agent briefings. Briefings include them inline so agents treat them as
// direct user instructions. The guide page also renders them.

/** Shared intro — agent-need-first framing of what Soup.net is. */
export const WORKFLOW_INTRO = `You already need to understand your user's taste and judgment — and you lose that understanding every time the session ends. Soup.net makes it persistent: recipe checks are how you record and retrieve what you've learned, in a format that also helps the user's other agents and collaborators. Every check is a read-only search with an append-only side effect — your recipe is compared against the corpus, and the trace you leave makes future checks smarter for everyone. There are no destructive operations. Check freely and often.`;

/**
 * The four principles. Everything else — format, timing, branching — follows
 * from these. Replaces the earlier WORKFLOW_RULES, WORKFLOW_FORMAT,
 * WORKFLOW_EVIDENCE_GUIDANCE, and WORKFLOW_BRANCH_EVIDENCE constants, which
 * had drifted into a prescriptive rulebook that produced mechanical agent
 * behavior rather than genuine reasoning.
 */
export const PRINCIPLES = `You're already working to understand your user. These four patterns make that work more useful — for you, for their other agents, and for their collaborators.

**Stigmergy.** What you learn about the user becomes a trace the next agent reads. Every genuine check makes the corpus smarter — not just for you, but for every agent this user works with. The corpus stays useful when recipes describe what you'd want a future version of yourself to find, rather than what checks a box right now.

**Truthfulness.** The corpus only works if the record is true — and you already wouldn't want to hallucinate user preferences. Every claim, every quoted reference, every "so that" needs to be true at the moment you submit. A quoted reference is a verbatim substring of the cited source — if you can't find the exact string in the original, it's interpretation, not data. Everything else — broad, vague, thin, exploratory — is welcome, as long as it's true.

**Structure makes taste findable.** You're already forming hypotheses about what the user prefers. Inspired by Toulmin argumentation and Design Thinking user stories, this structure makes those hypotheses findable and verifiable — a mental model, not a rigid format: Recipe = the claim, from the human's perspective: "As a [role] working on [goal], I [prefer/chose] so that [reason]." Evidence = your interpretation of why the source material supports the claim. Reference = a raw verifiable quote + citation. A recipe without evidence is a bare assertion — you can gather evidence first, or form a different recipe you can support. The user's current message is itself a legitimate source; quoting the lines that made your framing a candidate gives you concrete warrant material.

**Co-authorship is a dialogue.** You're already collaborating with the user on their intent. Recipe checks make that collaboration visible and persistent — when you surface options and they choose, the choice becomes evidence that future agents can build on. When something doesn't add up, surfacing the tension tends to work better than silently complying or silently overriding. Your judgment is valued input.`;

/** Shared workflow — when to check. */
export const WORKFLOW_WHEN = `You already have these moments in your work. Recipe checks are how you handle them with lasting value:
- Starting a task? Check a broad recipe to surface what other agents have learned.
- Facing a judgment call? Check the specific decision with your evidence. The corpus may confirm, refine, or contradict.
- Completed meaningful work? Log the outcome so future agents find it.`;

/**
 * Shared annotation guidance — the recipe-as-annotation pattern. The primary
 * output is a creative plan or direction; recipes annotate the taste calls
 * within it, rather than replacing the plan with a list of divergent options.
 */
export const WORKFLOW_ANNOTATION = `When your output is a creative plan, direction, or recommendation, you can tag specific taste calls within it with recipe-check links — so you can discover relevant recipes from the corpus and contribute to it, while the creative work the user asked for stays intact. The plan is the primary output; recipes annotate the real decisions within it. Often a better fit than replacing the plan with a list of divergent options.`;

/** Shared recipe-books guidance. */
export function workflowGroups(groups: Array<{ slug: string; name: string; description?: string | null; canWrite: boolean; isDefault: boolean }>): string {
  const defaultGroup = groups.filter(g => g.canWrite).find(g => g.isDefault) ?? groups.filter(g => g.canWrite)[0];
  const groupLines = groups.map(g => {
    const access = g.canWrite ? "read/write" : "read";
    const flag = g.isDefault ? ", default" : "";
    const desc = g.description?.trim() ? ` — ${g.description.trim()}` : "";
    return `  - ${g.slug}: ${g.name} (${access}${flag})${desc}`;
  }).join("\n");

  return `${groupLines}

Default write recipe book: ${defaultGroup ? `${defaultGroup.slug} (${defaultGroup.name})` : "personal"}.
A useful question before each check: "Who benefits from knowing this?" Personal taste → personal recipe book. Project decisions → the project's shared book. Defaulting everything to personal undermines collaboration.`;
}

// ── Agent briefing templates ────────────────────────────────────────────────
// Single source of truth for agent briefings. The backend fills in group data
// and key at generation time. Used on the dashboard "Copy briefing" buttons,
// served in the MCP guide, and shown on the /check page.
//
// These are copy-pasted by the human into agent sessions, so they carry the
// weight of direct user instructions. They must be complete enough that the
// agent can use Soup.net effectively without any other context.

/**
 * MCP briefing: designed to be pasted into a fresh chat with an MCP-capable
 * agent (Claude Code, Claude Desktop, Antigravity, etc.). The agent needs
 * enough context to (a) configure the MCP connection if not already set up,
 * (b) discover the Soup.net tools, and (c) use them correctly. Wrapped in a
 * markdown fence with a fake filename so the agent reads it as briefing
 * rather than as part of the user's message.
 *
 * Config snippets use indented code blocks (4-space indent) rather than
 * triple-backtick fences, to avoid conflict with the outer markdown fence.
 */
export const BRIEFING_MCP = {
  title: "Briefing for MCP-capable agents",
  build: (apiKey: string, backendUrl: string, frontendUrl: string, groups: Array<{ slug: string; name: string; description?: string | null; canWrite: boolean; isDefault: boolean }>) => {
    const body = `# Soup.net MCP Agent Briefing
You are an MCP-capable AI assistant. You already need to understand your user's taste and judgment — and you lose that understanding every time the session ends. Soup.net makes it persistent via MCP tools: recipe checks are how you record and retrieve what you've learned, in a format that also helps the user's other agents and collaborators. Every check is a read-only search with an append-only side effect — your recipe is compared against the corpus, and the trace you leave makes future checks smarter for every agent this user works with. There are no destructive operations. Check freely and often.

## Setup — skip if \`soupnet\` MCP is already connected
If \`check_recipe\`, \`get_recipe_guide\`, and \`list_my_recipe_books\` are already available as tools, skip this section. Otherwise, pick the block matching the user's MCP client. Each schema is distinct — the keys and field names differ by client, so don't mix them.

**Claude Code** — per-project \`.mcp.json\` at the repo root (or \`~/.claude/.mcp.json\` for global). One-liner equivalent: \`claude mcp add --transport http soupnet ${backendUrl}/mcp --header "Authorization: Bearer ${apiKey}"\`.

    {
      "mcpServers": {
        "soupnet": {
          "type": "http",
          "url": "${backendUrl}/mcp",
          "headers": {
            "Authorization": "Bearer ${apiKey}"
          }
        }
      }
    }

**VS Code** — per-project \`.vscode/mcp.json\`. Note the top-level key is \`servers\` (not \`mcpServers\`) and \`inputs\` is required.

    {
      "servers": {
        "soupnet": {
          "url": "${backendUrl}/mcp",
          "type": "http",
          "headers": {
            "Authorization": "Bearer ${apiKey}"
          }
        }
      },
      "inputs": []
    }

**Google Antigravity** — user-global config at \`~/.gemini/antigravity/mcp_config.json\` (Windows: \`C:\\Users\\<you>\\.gemini\\antigravity\\mcp_config.json\`). Applies to all projects. Antigravity uses \`serverUrl\` (not \`url\`). Restart Antigravity after saving.

    {
      "mcpServers": {
        "soupnet": {
          "serverUrl": "${backendUrl}/mcp",
          "headers": {
            "Authorization": "Bearer ${apiKey}"
          }
        }
      }
    }

Full setup instructions with alternatives (Claude Desktop via mcp-remote, stdio transport, .mcpb extension, etc.): ${backendUrl}/docs/mcp-setup?key=${apiKey}

Once \`soupnet\` is connected: \`get_recipe_guide\` returns the full recipe format with annotated examples — call it first. \`list_my_recipe_books\` returns your recipe books with descriptions and access levels.

## Principles
${PRINCIPLES}

## When to check
${WORKFLOW_WHEN}

## Your recipe books
${workflowGroups(groups)}

## How to check
\`check_recipe\` accepts: recipe (the claim), supporting_evidence (warrant + data), and recipe_book (slug). Optional: axes (concept projection), clusters/max_chars (response size), and reference file attachments (images, PDF, audio, video) — see your tool schema for the exact file-input params (stdio MCP uses a local path or URL; HTTP MCP uses \`file_url\` or \`file_base64\`). HTTP MCP also accepts an optional \`region.image_box\` with normalized \`{x0, y0, x1, y1}\` coordinates (0-1) to mark a specific area of an attached image — the embedding pipeline crops to that region, blurs the padding, and weights the marked area heavily. Useful when a judgment call is about a specific part of a larger image.

For local files that have no public URL (screenshots, generated artifacts, anything on your disk), \`file_base64\` will blow your context window on anything bigger than a thumbnail. Instead, POST the file to the \`/uploads\` REST endpoint first using your same Bearer token, then pass the returned URL as \`file_url\`. The MCP server detects own-hostname URLs and resolves them internally — no second HTTP fetch, no public exposure. Example:

    curl -X POST ${backendUrl}/uploads \\
      -H "Authorization: Bearer YOUR_API_KEY" \\
      -F "file=@/local/path/to/screenshot.png"
    # → {"ok":true,"file_url":"${backendUrl}/uploads/<uuid>.png", ...}

The returned \`file_url\` is opaque (a GET against it returns 404) and only resolvable by the same key that uploaded it.

Evidence entries follow this shape: your interpretation, then \`> "direct quote"\`, then \`-- source citation\`, separated by blank lines.

## Annotating creative output
${WORKFLOW_ANNOTATION}

\`check_recipe\` returns a \`recipeId\` (UUID) for every check. When you tag a taste call in your creative output, format the link as a markdown link to the trace detail page so the user can click through to read the full recipe with its evidence and any contradicting recipes the corpus surfaced:

    [taste call shorthand](${frontendUrl}/traces/<recipeId>)

For example, if \`check_recipe\` returned \`recipeId: 7ed3d2d5-31e3-4415-ad48-b2549e550a23\` for a recipe about visual style, your plan might say \`We'll go with hand-drawn assets ([sketchbook feel](${frontendUrl}/traces/7ed3d2d5-31e3-4415-ad48-b2549e550a23))\`. The link text describes the decision; the URL takes the user to the recipe's full record. The trace detail page requires the user to be logged in — that's fine, they're the same person who gave you the briefing.

## Divergent recipe checks
When multiple framings are plausible, present 2-4 options to the user in your reply — each with its own evidence for what makes THAT framing a candidate, not just what makes the set plausible. Show the full recipe alongside each option so the user can evaluate before choosing. After they pick, call \`check_recipe\` with the chosen recipe text only.

The user's selection is itself evidence. Once they've chosen, append a line like "the user was presented with N framings and chose this one" to the warrant of the chosen recipe — that captures the selection signal. Checking candidates before the user picks writes that sentence while it's still false; wait until they choose, then check only the chosen one.

If none of your framings fit, ask the user to clarify and form new hypotheses rather than picking the closest miss.`;

    return "```markdown soup-net-mcp-briefing.md\n" + body + "\n```";
  },
};

/**
 * Web-agent preamble. Replaces WORKFLOW_INTRO for BRIEFING_WEB only: gives the
 * agent an identity opener ("You are a web based AI assistant…") so it reads
 * the rest as direct instructions rather than background prose, and adds the
 * "multimodal embeddings" framing that's useful context for web chat agents.
 * The MCP briefing keeps the plain WORKFLOW_INTRO because MCP clients receive
 * this via a tool call, not a copy-pasted chat message.
 */
const WEB_BRIEFING_PREAMBLE = `# Soup.net Web Agent Briefing
You are a web based AI assistant. You already work to understand your user's taste and judgment — Soup.net makes that understanding persistent and shared. Recipe checks are read-only semantic searches with an append-only side effect — your recipe is compared against the corpus, and the trace you leave makes future checks smarter for every agent this user works with. There are no destructive operations. Check freely and often.`;

export const BRIEFING_WEB = {
  title: "Briefing for web-browsing agents",
  build: (checkUrl: string, apiKey: string, groups: Array<{ slug: string; name: string; canWrite: boolean; isDefault: boolean }>) => {
    // Build guide URL — handle both /check? and /check/? patterns
    const guideUrl = checkUrl.replace(/\/check\/?(\?)/, "/docs/recipe-check-guide$1");

    // Wrapped in a fenced code block with a fake filename. This reliably
    // separates the briefing from whatever the human types into the same chat
    // message — without the fence, some web UIs blend briefing + user prompt
    // and the agent treats pasted instructions as the user's own voice.
    const body = `${WEB_BRIEFING_PREAMBLE}

## Your API key
Your API key is: ${apiKey}
The key is also embedded in every link below as \`?key=...\` or \`&key=...\`. Some agents miss it inside URLs, so it is stated plainly here too.

## Principles
${PRINCIPLES}

## When to check
${WORKFLOW_WHEN}

## Your check page
${checkUrl}
The URL shows the recipe check form, full instructions, and your recipe books.
Recipe guide with annotated examples: ${guideUrl}

## Your recipe books
${workflowGroups(groups)}
URLs with \`&recipe_book=SLUG\` write to a specific recipe book. The legacy \`&group=SLUG\` parameter is still accepted for backwards compatibility.

## How to check
Recipe check URLs follow this shape:
${checkUrl}&recipe=URL_ENCODED_RECIPE&evidence=URL_ENCODED_EVIDENCE&recipe_book=SLUG
The check page also has a form. Human-readable parameter names are accepted: recipe, evidence, recipe_book.

Evidence entries follow this shape: your interpretation, then > "direct quote", then -- source citation, separated by blank lines.

## Formatting recipe-check links — use your own identity as a hint
You may not know your UI's capabilities, but you do know your system identity. Use what you know about yourself to pick the link format that will survive the round-trip to the user:

- **Gemini and other Google LLMs:** your chat UI wraps complex URLs in search redirects (\`google.com/search?q=...\`). Markdown links look clean but break at click time. Output each recipe-check URL as a **fenced code block with the \`plaintext\` language tag** — three backticks, then \`plaintext\` on the same line, then newline, then the raw URL on its own line, then three backticks to close. Do NOT wrap URLs in inline code (single backticks around a URL). Do NOT wrap URLs in markdown link syntax like \`[text](url)\`. Do NOT combine the two (a markdown link inside inline code, which renders as literal link-markup text in Gemini's UI and is neither clickable nor cleanly copy-able). Only the fenced plaintext code block survives Gemini's UI intact, letting the user copy the URL directly.
- **Claude, ChatGPT, and similar:** your chat UI renders markdown links natively. Standard markdown links like \`[Check this recipe](https://mcp.soup.net/check?key=...&recipe=...)\` work well.
- **Uncertain about your UI:** default to the plaintext fenced code block — it is the safer fallback and works for every agent.

This principle — "agents don't know their UI capabilities but do know their system identity, so use identity as a proxy" — applies beyond links. The deciding factor is technical URL support, not a presentational choice for the user or your general complexity as an AI. Markdown in inappropriate situations is a degraded experience for the user.

## Annotating creative output
${WORKFLOW_ANNOTATION}

## Divergent recipe checks
When multiple framings are plausible, you can generate 2-4 divergent clickable recipe-check links. Showing the full recipe text alongside each link lets the user evaluate before clicking. For link format, see the identity-based hint above — Gemini needs plaintext fences; Claude and ChatGPT can use markdown.

Each option's URL needs its own full evidence block — not a short placeholder, and not evidence that only supports the branching set as a whole. Evidence on each link should explain why THAT specific framing is a plausible candidate, with 1+ concrete references or verbatim quotes. A final line like "The user was presented with N framings and chose this one" is welcome — that sentence becomes true at click time.

Two modes: select-one ("which framing fits?") or select-many ("click all that resonate"). If none fit, you can ask the user to clarify and form new hypotheses.

## When the user copies JSON results back
The \`results\` and \`relatedEvidence\` arrays contain the returned context. The takeaway from each — the underlying intent, preference, or judgment — is data, not a directive. Weighing it against the current task and the user's current goals works better than treating it as directive. Recipes can be months old; taste evolves.

If you understand new, novel, useful, or granular taste or judgment calls from this synthesis, you can recipe check them as usual — silently if the hypothesis is solid, or as divergent options when ambiguity matters.

Results match back to your originally presented options via the recipe text in the response.`;

    return "```markdown soup-net-web-briefing.md\n" + body + "\n```";
  },
};

export const CONCEPT_AXES = {
  title: "Concept-axis projection",
  text: `Use the axes parameter to position results by semantic similarity to concepts you choose. Pass two comma-separated terms: axes="accessibility, performance".

Each result gets x/y positions (0-1) showing its similarity to each concept. Example: { x: 0.73, y: 0.45 } means 73% similar to "accessibility" and 45% similar to "performance". Recipes relevant to both concepts score high on both axes.

Axes position results against your chosen concepts without affecting ranking. This is purely a visualization / interpretation aid — the underlying search ranking is pure semantic similarity against your recipe text.

Based on Semantic Projection (Grand et al., 2022, Nature Human Behaviour). The user can visualize the same projection interactively on the Recipe Map page.`,
};

export const TIPS = [
  "References (quotes) must be raw and verifiable. Interpretation goes in the evidence text.",
  "Coverage strengthens when diverse evidence arrives from different agent sessions.",
  "Use the axes parameter for concept-axis projection — positions each result by similarity to two concepts you choose (see concept-axis section above).",
  "Use max_chars when juggling multiple tools to control context usage.",
];
