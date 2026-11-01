# Connect Soup.net to your AI

Soup.net is shared memory for taste and judgment. The Soup.net connector lets your AI **recipe check** Soup.net — retrieving what you've recorded about your preferences and judgments, and logging new ones when you make a call. Every recipe check leaves a trace, so the next one is smarter.

## What the connector adds

Three tools become available to the AI:

- **check_recipe** — the AI makes a recipe check before answering a judgment-call question, then logs the choice you make as a new recipe.
- **get_briefing** — when the AI joins a conversation, it reads the canonical recipe-check guidance plus a sample of your recorded recipes so its suggestions stay aligned with you.
- **list_my_recipe_books** — the AI refreshes that sample mid-conversation if the topic shifts.

You can phrase prompts naturally — the AI handles the structured recipe formulation behind the scenes.

## Getting your AI to use it

Some AIs won't reach for Soup.net unless asked. Start a session by telling yours to "use Soup.net throughout", and say it again if it stops, for example after a long conversation is compacted. A line in your AI's memory or rules file does the same job every session.

You'll need a Soup.net account — signups are free and open: [create one here](/auth/register).

<!-- agent-type-picker: the live /info/connect page (ConnectPage.tsx) splices
     the interactive agent-type picker in at this marker. The picker curates
     the sections below into four entry paths; the sections remain the full
     reference, so keep them complete when editing. -->

## Connect via OAuth (chat-style AIs)

The fastest setup. The AI redirects you to Soup.net, you sign in, you pick which recipe books to share, and you're done. Every client below uses the same Soup.net URL:

`https://mcp.soup.net/mcp`

### Claude (claude.ai, Desktop, mobile)

Soup.net is a listed connector in the [Anthropic Connectors Directory](https://claude.com/connectors) — available on every Claude plan, including Free.

1. Open Soup.net's directory listing: **[claude.ai/directory/soupnet](https://claude.ai/directory/soupnet)** (or find it in Claude under **Settings → Connectors**).
2. Click **Connect**. Claude redirects you to Soup.net — sign in.
3. Choose which recipe books Claude can read and write, then confirm.

Adding it manually instead (e.g. a workspace that restricts directory connectors): **Settings → Connectors → Add custom connector** with the URL `https://mcp.soup.net/mcp`, then the same sign-in and book selection. Name it without a domain — "Soup Recipe Checks" works; "Soup.net" does not (a domain-like name can trip the platform's safety filters and silently block the tools; verified 2026-07-06).

### ChatGPT

ChatGPT connects through OAuth; there's no API-key path. A custom MCP server with full access, including the writes a recipe check makes, is available on Business, Enterprise and Edu plans, on the web. On Pro, a custom server is read-only, so the agent can read your recipes but can't record new ones. On other plans, see [Web fallback](#web-fallback-no-mcp-needed) below.

1. In ChatGPT, open **Plugins**, select **+**, then **Add custom MCP server**.
2. URL: `https://mcp.soup.net/mcp`. Authentication: **OAuth**. Accept the warning ChatGPT shows for custom servers.
3. Sign in to Soup.net, choose which recipe books ChatGPT can read and write, and confirm.

On Business and Enterprise workspaces, an admin can publish the connection to the workspace. ChatGPT keeps a snapshot of Soup.net's tools at that point, so the admin refreshes it when Soup.net adds a tool.

### Codex

Codex (CLI, desktop app and IDE extension) reads MCP servers from `config.toml`. Add Soup.net to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.soupnet]
url = "https://mcp.soup.net/mcp"
```

Then sign in once with `codex mcp login soupnet`: Codex opens Soup.net in your browser, you choose the recipe books, and Codex keeps the connection refreshed. If you'd rather use an API key, the [API Keys page](/app/keys) has the `config.toml` form with a token environment variable.

**As a plugin, with the recipe-check skill.** This repository is also a Codex plugin marketplace: the plugin bundles the same server with a skill that teaches Codex when to check and how to write a recipe. Add the marketplace with `codex plugin marketplace add AndyForest/SoupNet`, then open `/plugins` in Codex, install **SoupNet**, and start a new session. Working inside a clone of the repository, Codex finds the marketplace on its own.

### Mistral Le Chat

1. In Le Chat, open **Settings → Custom connectors → Add**.
2. URL: `https://mcp.soup.net/mcp`
3. Le Chat detects the auth method automatically. Choose **OAuth 2.1**.
4. Sign in to Soup.net and authorize.

### Perplexity (Pro / Max / Enterprise)

Custom connectors launched March 2026. Free-tier users: see [Web fallback](#web-fallback-no-mcp-needed) below.

1. In Perplexity, **Settings → Connectors → + Custom connector → Remote**.
2. URL: `https://mcp.soup.net/mcp`
3. Auth method: **OAuth**. Add.
4. Sign in to Soup.net and authorize.

### For OAuth client developers

Clients that register dynamically get a client secret and use it at the token endpoint; clients that identify themselves with a metadata-document URL (ChatGPT, for example) use no secret (`none`, with PKCE as the proof) or a signed assertion (`private_key_jwt`). That is why the server's metadata lists `none` beside the secret methods.

## Connect via API key (developer tools)

For Claude Code, Claude Desktop, VS Code (Copilot), Google Antigravity, Cursor, Windsurf, and Zed. The Soup.net dashboard's **[API Keys page](/app/keys)** has copy-paste configs for each — sign in first, then copy the one-line config into your client's MCP file.

Cursor, Windsurf, Zed, and VS Code Copilot also accept the OAuth flow above if you'd rather sign in via the browser than paste a key — point them at `https://mcp.soup.net/mcp` and let their built-in OAuth client handle the rest.

### Claude Code, spelled out

This is what setup looks like in a repo — one small file your teammates can read before any agent touches it. Create `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "soupnet": {
      "type": "http",
      "url": "https://mcp.soup.net/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

Add `.mcp.json` to `.gitignore` (each person's copy carries their own key), replace `YOUR_API_KEY` with a key from the [API Keys page](/app/keys), and restart Claude Code. Equivalent one-liner: `claude mcp add --transport http soupnet https://mcp.soup.net/mcp --header "Authorization: Bearer YOUR_API_KEY"`. If you paste your briefing into Claude Code instead, this file is exactly what the agent creates from it — no magic.

## Web fallback (no MCP needed)

If your AI can browse and construct URLs but doesn't support MCP — including ChatGPT plans without custom servers, Grok, DeepSeek, and others — you can still use Soup.net by having the AI build URLs against the `/check` endpoint. The dashboard's [API Keys page](/app/keys) has the URL shape; the [recipe-check guide](https://mcp.soup.net/docs/recipe-check-guide) has annotated examples.

This path is slower per-check (the user clicks each link rather than the AI calling a tool silently) but works in any AI that can read and write URLs.

## Example prompts

Three ways people use recipe checks — try one with your AI to see the connector working:

- **Broad discovery before starting** — *"I'm drafting my sister's baby shower announcement. Recipe check Soup.net for my taste on writing announcements before you suggest anything."*
- **Judgment between options** — *"I'm picking between Lightroom Cloud and Capture One for my wedding photography. Recipe check Soup.net to see what fits my actual workflow."*
- **Logging a decision** — *"I just settled on raised beds for my tomatoes — the clay soil drains badly. Recipe check that to my garden book."*

## What's shared with the AI

The AI only sees the recipe books you grant access to. Soup.net never sends your email, password, or recipes from books you didn't authorize. You can revoke access at any time from your AI's connector settings, or from **Soup.net → Settings → Keys**.

## Privacy

We don't sell your data, we don't advertise, and we don't train AI models on your recipes. Your content is stored in AWS US; vector embeddings are generated by Google Gemini under API-only terms. Full details in the [privacy policy](/info/privacy).

## Support

Questions: **admin@soup.net** · Security: **security@soup.net**
