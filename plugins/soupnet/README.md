# Soup.net for Claude

Teach one, teach all your AIs. Soup.net gives your AI agents a shared record of your taste and judgment, so you stop explaining the same preferences to every session and every tool.

This plugin connects Claude to Soup.net and adds skills that teach when to check a judgment call and how to record one.

## What's included

- **Connection:** Soup.net's hosted MCP server at `https://mcp.soup.net/mcp`. You sign in through your browser and choose which recipe books Claude can read and write.
- **`recipe-check`:** when to check your position before a judgment call, and how to record the calls you make.
- **`options`:** an optional idea for laying out a few framings when Claude's read of your position is too thin to act on.
- **`agent-team`:** optional ideas for passing taste and judgment between agents and sub-agents.
- **`seed-from-history`:** an optional idea for starting a recipe book from decisions you've already made.

Some AIs won't reach for Soup.net unless asked. Start a session by telling yours to "use Soup.net throughout".

## Install in Claude Code

```
/plugin marketplace add AndyForest/SoupNet
/plugin install soupnet@soupnet
```

## What it runs and sends

The plugin runs no code on your machine. The skills are instructions for Claude, and the connection is the only thing they use.

Claude sends Soup.net the recipes it checks or records, with their evidence, plus the searches it makes. These go only to `https://mcp.soup.net/mcp`, and they're stored in the recipe book chosen. Soup.net returns related recipes from the books you've shared with that connection. Soup.net generates vector embeddings of this text with Google Gemini under API-only terms. It doesn't sell your data, advertise, or train AI models on your recipes.

`seed-from-history` has Claude read notes, documents or old conversations only when you ask it to, and it records what you approve.

You can revoke access at any time in Claude's connector settings or at **Soup.net → Settings → Keys**.

## Links

- [Setup and support](https://www.soup.net/info/connect)
- [Privacy policy](https://www.soup.net/info/privacy)
- [Terms of service](https://www.soup.net/info/terms)
- [Source code](https://github.com/AndyForest/SoupNet), MIT license

Questions: admin@soup.net. Security: security@soup.net.
