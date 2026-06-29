import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";
import {
  HOW_THIS_WORKS,
  FOR_AI_AGENTS,
  WHEN_TO_CHECK,
  TASTE_VS_JUDGMENT,
  RECIPE_EXAMPLES,
  RELATED_EVIDENCE_IS_NEUTRAL,
  RESPONSE_SIZE_CONTROL,
  CONCEPT_AXES,
  GROUPS_GUIDE,
  CONNECTION_TIERS,
  TIPS,
  BOOTSTRAP_BLURB,
  PRINCIPLES,
} from "@soupnet/domain";

const docs = new Hono();

/** Escape text for safe HTML embedding. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

/** Build a query string suffix to persist the API key across page links. */
function keyQs(key: string | undefined): string {
  return key ? `?key=${encodeURIComponent(key)}` : "";
}

/**
 * GET /docs/recipe-check-guide — detailed instructions for AI agents.
 * Linked from the check page. Provides full context on the recipe format,
 * evidence structure, and system concepts for agents that need it.
 */
docs.get("/recipe-check-guide", (c) => {
  const key = c.req.query("key");
  const kq = keyQs(key);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; Recipe Check Guide</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header><h1>Soup.net &mdash; Recipe Check Guide</h1></header>
  <div class="container">

  <p><a href="/check${kq}">&larr; Back to recipe check</a></p>

  <h2>${esc(HOW_THIS_WORKS.title)}</h2>
  ${HOW_THIS_WORKS.text.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")}

  <h2>${esc(FOR_AI_AGENTS.title)}</h2>
  ${FOR_AI_AGENTS.text.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")
    .replace("Recipe Check Scenarios", `<a href="/docs/recipe-scenarios${kq}">Recipe Check Scenarios</a>`)}

  <h2>${esc(WHEN_TO_CHECK.title)}</h2>
  <p>Three common triggers:</p>
  <ol>
    ${WHEN_TO_CHECK.triggers.map((t) => `<li><strong>${esc(t.label)}</strong> &mdash; ${esc(t.detail)}</li>`).join("\n    ")}
  </ol>
  ${WHEN_TO_CHECK.framing.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")}

  <h2>${esc(TASTE_VS_JUDGMENT.title)}</h2>
  <p>${esc(TASTE_VS_JUDGMENT.taste)}</p>
  <p>${esc(TASTE_VS_JUDGMENT.judgment)}</p>
  <p>${esc(TASTE_VS_JUDGMENT.summary)}</p>

  <h2>Examples</h2>
  <p>These show exactly what you&rsquo;d type in the recipe and evidence fields on the <a href="/check${kq}">check page</a>.</p>
  ${RECIPE_EXAMPLES.map((r) => {
    // Build the evidence text exactly as it would appear in the form textarea
    const evidenceLines = [r.evidenceFor];
    if (r.quote) evidenceLines.push(`> "${r.quote}"`);
    if (r.source) evidenceLines.push(`-- ${r.source}`);
    const evidenceText = evidenceLines.join("\n");
    return `<div class="trace-example">
    <p><strong>${esc(r.label)}</strong></p>
    <label>Recipe</label>
    <textarea readonly rows="2">${esc(r.recipe)}</textarea>
    <label>Supporting evidence</label>
    <textarea readonly rows="${evidenceLines.length + 1}">${esc(evidenceText)}</textarea>
    ${r.explanation ? `<p><em>${esc(r.explanation)}</em></p>` : ""}
  </div>`;
  }).join("\n  ")}

  <p>For detailed annotated scenarios showing common mistakes and analysis,
  see <a href="/docs/recipe-scenarios${kq}">Recipe Check Scenarios</a>.</p>

  <h2>Core model: Traces, Evidence, References</h2>
  <p>Inspired by <a href="https://en.wikipedia.org/wiki/Toulmin_model">Toulmin argumentation</a>:</p>
  <table>
    <tr><th>Entity</th><th>What it is</th><th>User-facing name</th><th>Toulmin equivalent</th></tr>
    <tr><td><strong>Trace</strong></td><td>A subjective taste or judgment. Preferred format:
    <a href="https://en.wikipedia.org/wiki/Design_thinking">Design Thinking</a> user story.</td><td>Recipe</td><td>Claim</td></tr>
    <tr><td><strong>Evidence</strong></td><td>Your interpretation of how a reference connects to the trace.</td><td>Evidence</td><td>Warrant</td></tr>
    <tr><td><strong>Reference</strong></td><td>A raw, direct quote from a source of truth + citation. No interpretation.</td><td>Reference</td><td>Data</td></tr>
  </table>

  <h2>Principles</h2>
  ${PRINCIPLES.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")}

  <h3>Evidence by example</h3>
  <p>Each evidence entry has three parts, separated by blank lines between entries:</p>
  <pre>
Your interpretation of how this reference supports the recipe.
&gt; "Direct quote from the source &mdash; exact words, not a summary"
&mdash; Source citation (URL, document name, chat timestamp, etc.)

Next evidence entry (interpretation of the next reference).
&gt; "Another direct quote"
&mdash; Another source
  </pre>

  <h2>${esc(RELATED_EVIDENCE_IS_NEUTRAL.title)}</h2>
  <p>${esc(RELATED_EVIDENCE_IS_NEUTRAL.text)}</p>

  <h2>Coverage signal</h2>
  <p>A recipe&rsquo;s coverage strengthens when new, <em>diverse</em> evidence arrives
  from <em>different</em> agent sessions (different API keys). One agent reinforcing
  itself counts less than multiple independent sessions converging.</p>

  <h2>${esc(RESPONSE_SIZE_CONTROL.title)}</h2>
  <p>${RESPONSE_SIZE_CONTROL.text.split("\n").map((line: string) => esc(line)).join("<br>\n  ")}</p>

  <h2>${esc(CONCEPT_AXES.title)}</h2>
  ${CONCEPT_AXES.text.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")}

  <h2>${esc(GROUPS_GUIDE.title)}</h2>
  ${GROUPS_GUIDE.text.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")}

  <h2>${esc(CONNECTION_TIERS.title)}</h2>
  ${CONNECTION_TIERS.text.split("\n\n").map((p: string) => `<p>${esc(p)}</p>`).join("\n  ")}

  <h2>Tips</h2>
  <ul>
    ${TIPS.map((t) => `<li>${esc(t)}</li>`).join("\n    ")}
  </ul>

  <h2>Technical details</h2>
  <ul>
    <li>Search: hybrid &mdash; full-text (tsvector) + <a href="https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/">gemini-embedding-2-preview</a> semantic vectors (SEMANTIC_SIMILARITY)</li>
    <li>Include file links in references &mdash; no upload needed, our system can fetch them</li>
    <li>Markdown encouraged in all text fields</li>
    <li><strong>MCP tools available:</strong> <a href="/docs/mcp-setup${kq}">Set up check_recipe and get_briefing</a> for Codex, Claude Code, Claude Desktop, and other MCP-compatible agents</li>
    <li><strong>Cold start?</strong> <a href="/docs/bootstrap${kq}">Bootstrap your corpus</a> from existing AI agent sessions</li>
  </ul>

  </div>
</body>
</html>`;
  return c.html(html);
});

/**
 * GET /docs/mcp-setup — MCP configuration instructions with copy-paste config.
 * Accepts optional ?key= param to pre-fill the API key in the config snippet.
 */
docs.get("/mcp-setup", (c) => {
  const apiKey = c.req.query("key") || "YOUR_API_KEY";
  const backendUrl = process.env["BACKEND_URL"] || "http://localhost:3101";
  const frontendUrl = process.env["FRONTEND_URL"] || "http://localhost:5273";
  const kq = keyQs(c.req.query("key"));

  // Escape for safe embedding in HTML
  const escKey = apiKey.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escUrl = backendUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escFrontendUrl = frontendUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; MCP Setup</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header><h1>Soup.net &mdash; MCP Setup</h1></header>
  <div class="container">

  <p><a href="/check${kq}">&larr; Back to recipe check</a></p>

  <h2>What is MCP?</h2>
  <p>The <a href="https://modelcontextprotocol.io/">Model Context Protocol</a> gives AI agents
  direct tool access to Soup.net. Instead of browsing the web form, the agent calls
  <code>check_recipe</code> and <code>get_briefing</code> as native tools.</p>
  <p>MCP works with <strong>Codex</strong>, <strong>Claude Code</strong>, <strong>Claude Desktop</strong>,
  and other MCP-compatible agents.
  See also: <a href="https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb">Anthropic&rsquo;s extension guide</a>,
  <a href="https://modelcontextprotocol.io/quickstart/user">MCP quickstart</a>.</p>

  <h2>Getting an API key</h2>
  <p>Log in to the <a href="${escUrl}">Soup.net dashboard</a> and generate a daily or scoped key.
  Daily keys rotate automatically. Scoped keys let you restrict access to specific recipe books with a custom expiry.</p>
  ${apiKey !== "YOUR_API_KEY" ? `<p>Your current key (<code>${escKey.substring(0, 8)}...</code>) is pre-filled in the configs below.</p>` : ""}

  <h2>Two ways to connect</h2>
  <p><strong>Chat-style AIs</strong> (claude.ai, ChatGPT, Mistral Le Chat, Perplexity) connect via
  <strong>OAuth</strong> &mdash; no API key to copy. Add <code>${escUrl}/mcp</code> as a custom connector,
  sign in to Soup.net, and choose which recipe books to share (and read vs. write for each) right in the
  consent screen. Per-client steps for each chat AI are at
  <a href="${escFrontendUrl}/info/connect">${escFrontendUrl}/info/connect</a>.</p>
  <p><strong>Developer tools</strong> (Codex, Claude Code, Claude Desktop, VS Code, Google Antigravity,
  Cursor, Windsurf, Zed) use a <strong>Bearer API key</strong> &mdash; the options below. Most of these
  also accept the OAuth flow above if you&rsquo;d rather sign in than paste a key; point them at
  <code>${escUrl}/mcp</code> and let their built-in OAuth client handle the rest.</p>

  <h2>Option 1: Codex</h2>
  <p>Codex uses <code>config.toml</code>, not <code>.mcp.json</code>. Use
  <code>.codex/config.toml</code> in a trusted project when the Soup.net key should stay scoped
  to that repo. Use <code>~/.codex/config.toml</code> only when the same Soup.net identity
  should apply globally.</p>

  <p><strong>Recommended:</strong> keep the token in an environment variable available where Codex starts:</p>
  <pre>[mcp_servers.soupnet]
url = "${escUrl}/mcp"
bearer_token_env_var = "SOUPNET_API_KEY"</pre>
  <p>Set <code>SOUPNET_API_KEY</code> in Codex&rsquo;s environment, then restart Codex or start a new session.
  Verify with <code>/mcp</code> in the TUI or <code>codex mcp list</code>.</p>
  <p><small>This guidance was checked against Codex docs on 2026-05-16. If it fails, consult the OpenAI Developers docs MCP for current Codex MCP configuration.</small></p>

  <p>If you prefer a self-contained project config and understand the secret-handling risk:</p>
  <pre>[mcp_servers.soupnet]
url = "${escUrl}/mcp"
http_headers = { Authorization = "Bearer ${escKey}" }</pre>
  <p><small>Do not commit a <code>.codex/config.toml</code> file that contains a token.</small></p>

  <h2>Option 2: Claude Desktop</h2>
  <ol>
    <li>Open Claude Desktop</li>
    <li>Click the <strong>Claude</strong> menu (top menu bar) &rarr; <strong>Settings&hellip;</strong></li>
    <li>Go to the <strong>Developer</strong> tab &rarr; click <strong>Edit Config</strong></li>
    <li>Paste the config below into <code>claude_desktop_config.json</code> and save</li>
    <li>Quit and restart Claude Desktop</li>
  </ol>

  <p>Config file location:</p>
  <ul>
    <li><strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
    <li><strong>Windows:</strong> <code>%APPDATA%\\Claude\\claude_desktop_config.json</code></li>
  </ul>

  <p><strong>Important:</strong> Claude Desktop runs commands from <code>C:\\Windows\\System32</code>,
  so all paths in the config must be <strong>absolute</strong>.</p>

  <details open>
    <summary>macOS / Linux config</summary>
    <pre>{
  "mcpServers": {
    "soupnet": {
      "command": "npx",
      "args": ["tsx", "/FULL/PATH/TO/soupnet/apps/mcp-server/src/index.ts"],
      "env": {
        "SOUPNET_BACKEND_URL": "${escUrl}",
        "SOUPNET_API_KEY": "${escKey}"
      }
    }
  }
}</pre>
    <p><small>Replace <code>/FULL/PATH/TO/soupnet</code> with the absolute path to your local soupnet repo.</small></p>
  </details>

  <details>
    <summary>Windows config</summary>
    <pre>{
  "mcpServers": {
    "soupnet": {
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "C:\\\\path\\\\to\\\\soupnet\\\\apps\\\\mcp-server\\\\src\\\\index.ts"],
      "env": {
        "APPDATA": "C:\\\\Users\\\\YOUR_USERNAME\\\\AppData\\\\Roaming",
        "SOUPNET_BACKEND_URL": "${escUrl}",
        "SOUPNET_API_KEY": "${escKey}"
      }
    }
  }
}</pre>
    <p><small>Replace <code>C:\\\\path\\\\to\\\\soupnet</code> with the absolute path to your local soupnet repo,
    and <code>YOUR_USERNAME</code> with your Windows username.
    The <code>APPDATA</code> env var is needed because Claude Desktop doesn&rsquo;t always expand <code>%APPDATA%</code> correctly.</small></p>
  </details>

  <p>After restarting, look for the MCP server indicator in the bottom-right of the chat input.
  Click it to verify <code>check_recipe</code> and <code>get_briefing</code> are listed.</p>

  <details>
    <summary>Alternative: install via desktop extension (.mcpb)</summary>
    <p>If your Claude Desktop version supports extensions:</p>
    <ol>
      <li>Download <a href="/soupnet.mcpb"><strong>soupnet.mcpb</strong></a></li>
      <li>In Claude Desktop: <strong>Settings</strong> &rarr; <strong>Extensions</strong> &rarr; <strong>Advanced settings</strong></li>
      <li>Click <strong>Install Extension&hellip;</strong> and select the downloaded file</li>
      <li>Enter your API key when prompted</li>
    </ol>
    <p><small>This bundles the same MCP server as the manual config above. The extension stores your API key in the OS keychain.</small></p>
  </details>

  <h2>Option 3: Claude Code (CLI)</h2>
  <p>Add this to <code>.mcp.json</code> in your project root (per-project) or <code>~/.claude/.mcp.json</code> (global).
  Claude Code runs from the project directory, so relative paths work here:</p>

  <details open>
    <summary>macOS / Linux config</summary>
    <pre>{
  "mcpServers": {
    "soupnet": {
      "command": "npx",
      "args": ["tsx", "apps/mcp-server/src/index.ts"],
      "env": {
        "SOUPNET_BACKEND_URL": "${escUrl}",
        "SOUPNET_API_KEY": "${escKey}"
      }
    }
  }
}</pre>
  </details>

  <details>
    <summary>Windows config</summary>
    <pre>{
  "mcpServers": {
    "soupnet": {
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "apps/mcp-server/src/index.ts"],
      "env": {
        "SOUPNET_BACKEND_URL": "${escUrl}",
        "SOUPNET_API_KEY": "${escKey}"
      }
    }
  }
}</pre>
  </details>

  <h2>Available tools</h2>
  <table>
    <tr><th>Tool</th><th>Purpose</th></tr>
    <tr>
      <td><code>check_recipe</code></td>
      <td>Check a recipe against Soup.net. Logs your recipe and returns similar recipes with evidence.
      Supports <code>clusters</code> and <code>max_chars</code> params for concise responses.</td>
    </tr>
    <tr>
      <td><code>get_briefing</code></td>
      <td>Returns the Soup.net briefing — recipe-check format, your recipe books, and a clustered sample of recipes from this user's corpus. Call this before your first check.</td>
    </tr>
  </table>

  <h2>Uploading private files</h2>
  <p>The <code>check_recipe</code> tool accepts a <code>file_url</code> parameter for multimodal evidence
  (images, PDFs, audio, video). For files already public on the web, just pass the URL. For private local
  files &mdash; screenshots, generated artifacts, anything that lives only on your disk &mdash; upload them
  first via the <code>POST /uploads</code> REST endpoint, then pass the returned URL.</p>

  <p>Why this two-step? MCP tool calls pass JSON arguments; binary content has to be base64-encoded inline,
  which blows the agent's context window on any meaningful image. The upload endpoint sidesteps this with a
  normal multipart POST, the same shape the
  <a href="https://ai.google.dev/gemini-api/docs/files">Gemini File API</a> uses for the same reason.</p>

  <p><strong>Step 1.</strong> POST your file to <code>${escUrl}/uploads</code> with your API key as a Bearer token:</p>
  <pre>curl -X POST ${escUrl}/uploads \\
  -H "Authorization: Bearer ${escKey}" \\
  -F "file=@/path/to/screenshot.png"</pre>

  <p>Response (200 OK):</p>
  <pre>{
  "ok": true,
  "file_url": "${escUrl}/uploads/9f3c2e1a-....png",
  "content_hash": "sha256-hex...",
  "mime_type": "image/png",
  "size_bytes": 184320
}</pre>

  <p><strong>Step 2.</strong> Pass the returned <code>file_url</code> to <code>check_recipe</code> as the
  <code>file_url</code> parameter. The MCP server detects own-hostname URLs and reads the file directly &mdash;
  no second HTTP fetch.</p>

  <h3>Behavior and security</h3>
  <ul>
    <li><strong>The URL is not publicly servable.</strong> A <code>GET</code> against
    <code>${escUrl}/uploads/&lt;id&gt;.png</code> always returns 404 &mdash; even from the uploading key.
    Treat the URL as an opaque reference token, not a download link. (Same model as Gemini File API file handles.)</li>
    <li><strong>Uploads are bound to the API key that created them.</strong> If a different key tries to use
    your uploaded URL, <code>check_recipe</code> returns the same "could not fetch" error as for a missing URL
    &mdash; no information leak about whether the upload exists.</li>
    <li><strong>When the API key expires or is revoked, its uploads become unreachable.</strong> The api key is
    the security boundary, not the user account. Plan key rotation accordingly: upload + check should happen
    within the same key's lifetime.</li>
    <li>Supported MIME types: PNG, JPEG, WebP, MP4, MOV, MP3, WAV, FLAC, OGG, PDF. Max size 20 MB.</li>
    <li>Rate limit: 100 uploads per hour per API key.</li>
  </ul>

  <h2>Troubleshooting</h2>
  <details>
    <summary>Server not appearing after restart</summary>
    <ul>
      <li>Verify your config JSON is valid (no trailing commas, correct quoting)</li>
      <li>Check that <a href="https://nodejs.org/">Node.js</a> is installed: <code>node --version</code></li>
      <li>Try running the server manually: <code>npx tsx apps/mcp-server/src/index.ts</code></li>
      <li><strong>Claude Desktop logs:</strong>
        <ul>
          <li>macOS: <code>~/Library/Logs/Claude/mcp*.log</code></li>
          <li>Windows: <code>%APPDATA%\\Claude\\logs\\mcp*.log</code></li>
        </ul>
      </li>
    </ul>
  </details>
  <details>
    <summary>ENOENT error on Windows</summary>
    <p>If the server fails with a path error referencing <code>\${APPDATA}</code>,
    add the expanded <code>APPDATA</code> path to your config&rsquo;s <code>env</code> block
    (shown in the Windows config above).</p>
  </details>

  <h2>Remote HTTP (deployed Soup.net)</h2>
  <p>If your Soup.net server is deployed (e.g., at <code>mcp.soup.net</code>), agents can connect over HTTP
  without running a local server. This is the recommended setup for production use.</p>
  <p>Each MCP client has a distinct config schema. The blocks below are confirmed working —
  copy the one that matches your client. <strong>Don't mix schemas</strong>: the top-level key,
  URL field name, and required extras differ by client.</p>

  <h3>Codex (.codex/config.toml or ~/.codex/config.toml)</h3>
  <p>Use project-scoped <code>.codex/config.toml</code> for repo-specific Soup.net keys in trusted projects,
  or <code>~/.codex/config.toml</code> only when the same key should apply everywhere.</p>
  <pre>[mcp_servers.soupnet]
url = "${escUrl}/mcp"
bearer_token_env_var = "SOUPNET_API_KEY"</pre>
  <p><small>Make <code>SOUPNET_API_KEY</code> available where Codex starts, then restart Codex or start a new session.
  Verify with <code>/mcp</code> or <code>codex mcp list</code>. Inline <code>http_headers</code> also works,
  but requires secret hygiene. Checked against Codex docs on 2026-05-16; if it fails, consult the OpenAI Developers docs MCP.</small></p>

  <h3>Claude Code (.mcp.json)</h3>
  <p>Per-project <code>.mcp.json</code> at the repo root, or <code>~/.claude/.mcp.json</code> for global.</p>
  <pre>{
  "mcpServers": {
    "soupnet": {
      "type": "http",
      "url": "${escUrl}/mcp",
      "headers": {
        "Authorization": "Bearer ${escKey}"
      }
    }
  }
}</pre>
  <p><small>One-liner equivalent: <code>claude mcp add --transport http soupnet ${escUrl}/mcp --header "Authorization: Bearer ${escKey}"</code></small></p>

  <h3>VS Code (.vscode/mcp.json)</h3>
  <p>Per-project <code>.vscode/mcp.json</code>. The top-level key is <code>servers</code> (not <code>mcpServers</code>),
  and <code>inputs</code> is required (use <code>[]</code> if you have no prompts).</p>
  <pre>{
  "servers": {
    "soupnet": {
      "url": "${escUrl}/mcp",
      "type": "http",
      "headers": {
        "Authorization": "Bearer ${escKey}"
      }
    }
  },
  "inputs": []
}</pre>

  <h3>Google Antigravity</h3>
  <p>User-global config at <code>~/.gemini/antigravity/mcp_config.json</code>
  (Windows: <code>C:\\Users\\&lt;you&gt;\\.gemini\\antigravity\\mcp_config.json</code>).
  Applies to all projects, not a per-project config. Restart Antigravity after saving.
  Antigravity also supports self-configuration — you can paste the block below into a chat and
  ask the agent to install it.</p>
  <pre>{
  "mcpServers": {
    "soupnet": {
      "serverUrl": "${escUrl}/mcp",
      "headers": {
        "Authorization": "Bearer ${escKey}"
      }
    }
  }
}</pre>
  <p><small><strong>Note:</strong> Antigravity uses <code>serverUrl</code> (not <code>url</code>).</small></p>

  <h3>Claude Desktop (via mcp-remote)</h3>
  <p>Claude Desktop doesn't speak HTTP MCP natively yet — <code>mcp-remote</code> bridges stdio to HTTP.</p>
  <pre>{
  "mcpServers": {
    "soupnet": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${escUrl}/mcp",
               "--header", "Authorization: Bearer ${escKey}"]
    }
  }
}</pre>
  <p><small>Requires Node.js.</small></p>

  <h3>Web agents (no MCP)</h3>
  <p>Agents that can browse the web (ChatGPT, Google Stitch, etc.) can check recipes by visiting:</p>
  <pre>https://mcp.soup.net/check?key=YOUR_API_KEY</pre>
  <p><small>No MCP configuration needed. The web form is designed for AI agents that can fill HTML forms.</small></p>

  <h2>Bootstrap your agent</h2>
  <p>Copy-paste this into your AI agent&rsquo;s system prompt or first message to bootstrap correct understanding.
  The agent&rsquo;s own instructions carry more weight than anything in our system &mdash; this blurb sets the right mental model
  so the agent uses the tools correctly from the start.</p>
  <pre>${esc(BOOTSTRAP_BLURB.text)}</pre>

  <h2>Tips for agents</h2>
  <ul>
    <li><code>max_chars: 2000</code> keeps responses compact when context is tight. The briefing covers the rest.</li>
  </ul>

  <h2>Bootstrap your corpus</h2>
  <p>New to Soup.net? Your corpus starts empty. <a href="/docs/bootstrap${kq}">Bootstrap Your Corpus</a>
  walks you through seeding it by extracting taste and judgment from your existing AI agent sessions.
  Pick a few diverse sessions for the best cross-pollination.</p>

  </div>
</body>
</html>`;
  return c.html(html);
});

/**
 * GET /docs/recipe-scenarios — verbose annotated scenarios for recipe checking.
 * Reads from public/docs/recipe-scenarios.md — the canonical public location.
 * Internal docs (docs/design-thinking.md) cross-link here, not the other way around.
 */
docs.get("/recipe-scenarios", async (c) => {
  const kq = keyQs(c.req.query("key"));
  // public/ is at apps/backend/public/ — resolve from cwd in both Docker and dev
  const tryPaths = [
    resolve(process.cwd(), "public", "docs", "recipe-scenarios.md"),              // docker: cwd=apps/backend
    resolve(process.cwd(), "apps", "backend", "public", "docs", "recipe-scenarios.md"), // dev: cwd=repo root
  ];
  let markdown = "";
  for (const p of tryPaths) {
    try { markdown = await readFile(p, "utf-8"); break; } catch { /* next */ }
  }
  if (!markdown) {
    return c.text("Could not read public/docs/recipe-scenarios.md", 500);
  }

  // Strip the markdown h1 title (we render our own HTML header)
  const body = markdown.replace(/^# .+\n+/, "");

  // Minimal markdown → HTML for the subset we use
  const rendered = body
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;").trimEnd()}</code></pre>`)
    // Blockquotes (> lines, consecutive)
    .replace(/(?:^|\n)((?:> .*\n?)+)/g, (_m, block) => {
      const inner = block.replace(/^> ?/gm, "").trim()
        .replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `\n<blockquote><p>${inner}</p></blockquote>\n`;
    })
    // H2
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Numbered lists
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr>")
    // Paragraphs (double newline separated, skip already-tagged blocks)
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^</.test(trimmed)) return trimmed; // already HTML
      return `<p>${trimmed}</p>`;
    })
    .join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; Recipe Check Scenarios</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header><h1>Soup.net &mdash; Recipe Check Scenarios</h1></header>
  <div class="container">
  <p><a href="/docs/recipe-check-guide${kq}">&larr; Back to recipe check guide</a></p>
  ${rendered}
  </div>
</body>
</html>`;
  return c.html(html);
});

/**
 * GET /docs/bootstrap — guide for users to seed their corpus from existing AI sessions.
 * Reads from public/docs/bootstrap-your-corpus.md.
 */
docs.get("/bootstrap", async (c) => {
  const apiKey = c.req.query("key") || "YOUR_API_KEY";
  const soupNetUrl = process.env["BACKEND_URL"] || "http://localhost:3101";

  const tryPaths = [
    resolve(process.cwd(), "public", "docs", "bootstrap-your-corpus.md"),
    resolve(process.cwd(), "apps", "backend", "public", "docs", "bootstrap-your-corpus.md"),
  ];
  let markdown = "";
  for (const p of tryPaths) {
    try { markdown = await readFile(p, "utf-8"); break; } catch { /* next */ }
  }
  if (!markdown) {
    return c.text("Could not read public/docs/bootstrap-your-corpus.md", 500);
  }

  // Auto-fill the placeholders with actual values
  markdown = markdown
    .replace(/\{SOUP_NET_URL\}/g, soupNetUrl)
    .replace(/\{YOUR_API_KEY\}/g, apiKey);

  const body = markdown.replace(/^# .+\n+/, "");

  const rendered = body
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;").trimEnd()}</code></pre>`)
    .replace(/(?:^|\n)((?:> .*\n?)+)/g, (_m, block) => {
      const inner = block.replace(/^> ?/gm, "").trim()
        .replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `\n<blockquote><p>${inner}</p></blockquote>\n`;
    })
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^---$/gm, "<hr>")
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^</.test(trimmed)) return trimmed;
      return `<p>${trimmed}</p>`;
    })
    .join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; Bootstrap Your Corpus</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header><h1>Soup.net &mdash; Bootstrap Your Corpus</h1></header>
  <div class="container">
  <p><a href="/docs/recipe-check-guide${keyQs(apiKey !== "YOUR_API_KEY" ? apiKey : undefined)}">&larr; Back to recipe check guide</a></p>
  ${rendered}
  </div>
</body>
</html>`;
  return c.html(html);
});

export { docs as docsRoutes };
