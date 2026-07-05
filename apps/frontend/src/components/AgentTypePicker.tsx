import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Icon } from "./Icon.js";

/**
 * Agent-type picker — the four archetypes of AI a user might connect,
 * each mapping onto an existing connection path. Rendered in two places:
 * the dashboard's zero-checks empty state, and the top of /info/connect
 * (its permanent home, for adding a second or third agent later).
 *
 * The picker curates instruction content that lives elsewhere — the full
 * per-client steps stay in docs/connectors/index.md (rendered below the
 * picker on /info/connect) and on the API Keys page. If a client's setup
 * changes, update those sources; keep these steps to the shape of the path.
 */

type ArchetypeId = "coding" | "desktop" | "web-mcp" | "web-url";

interface Archetype {
  id: ArchetypeId;
  icon: "key" | "download" | "external-link" | "copy";
  title: string;
  examples: string;
  blurb: string;
  steps: ReactNode[];
}

const mcpUrl = <code style={{ fontSize: "0.85em" }}>https://mcp.soup.net/mcp</code>;

const keysLink = (label: string) => (
  <Link to="/app/keys" style={{ color: "var(--color-primary)" }}>{label}</Link>
);

const ARCHETYPES: Archetype[] = [
  {
    id: "coding",
    icon: "key",
    title: "Coding tools",
    examples: "Claude Code, VS Code Copilot, Codex, Antigravity, Cursor, Windsurf, Zed",
    blurb: "Terminal and editor agents connect over MCP with an API key.",
    steps: [
      <>Open the {keysLink("API Keys page")} — it has a ready-made config snippet for each client.</>,
      <>Paste the one-line config into your client's MCP file and start a new session.</>,
      <>Copy the agent briefing and paste it into that session — it introduces your recipe books and shows the agent when a recipe check is worth making.</>,
    ],
  },
  {
    id: "desktop",
    icon: "download",
    title: "Desktop AI apps",
    examples: "Claude Desktop, Cowork",
    blurb: "Installed apps connect the same way — Claude Desktop has a one-click extension.",
    steps: [
      <>Open the {keysLink("API Keys page")} — Claude Desktop installs the Soup.net extension (.mcpb); other desktop apps use the same config snippets as coding tools.</>,
      <>Restart the app so the Soup.net tools appear.</>,
      <>Copy the agent briefing and paste it into a new chat so the agent starts with your recipe books in view.</>,
    ],
  },
  {
    id: "web-mcp",
    icon: "external-link",
    title: "Web chatbots with connectors",
    examples: "claude.ai, ChatGPT (Developer Mode), Le Chat, Perplexity",
    blurb: "Chat AIs that accept custom connectors — you sign in through Soup.net, no keys to paste.",
    steps: [
      <>In your AI's settings, add a custom connector with the URL {mcpUrl}.</>,
      <>Choose OAuth, sign in to Soup.net when redirected, and pick which recipe books to share.</>,
      <>Ask the AI to "recipe check Soup.net" on your next judgment call — or copy the agent briefing into the chat for a running start.</>,
    ],
  },
  {
    id: "web-url",
    icon: "copy",
    title: "Web chatbots without MCP",
    examples: "ChatGPT (free), Stitch, Grok, DeepSeek",
    blurb: "Any AI that can read and build URLs can check recipes — no connector needed.",
    steps: [
      <>Copy the agent briefing — it carries a 24-hour key, the check-page URL, and full instructions.</>,
      <>Paste it at the start of your chat.</>,
      <>When the AI proposes a recipe check, it hands you a link; opening the link runs the check and logs the trace.</>,
    ],
  },
];

interface AgentTypePickerProps {
  /**
   * Rendered under the selected card's steps — the host's standard
   * "Copy agent briefing" button (or a sign-in prompt on public pages).
   */
  briefingSlot: ReactNode;
  /**
   * Host-specific closing line under the briefing slot, e.g. a pointer to
   * the full instructions ("Full per-client steps are on the Connect to AI
   * page" on the dashboard; "Detailed steps for every client continue
   * below" on /info/connect).
   */
  footnote?: ReactNode;
}

export function AgentTypePicker({ briefingSlot, footnote }: AgentTypePickerProps) {
  const [selectedId, setSelectedId] = useState<ArchetypeId | null>(null);
  const selected = ARCHETYPES.find((a) => a.id === selectedId);

  return (
    <div>
      <p className="text-label" style={{ marginBottom: "var(--space-md)" }}>
        Which kind of AI are you connecting?
      </p>
      <div className="grid-2-cards" style={{ gap: "var(--space-md)" }}>
        {ARCHETYPES.map((a) => {
          const active = a.id === selectedId;
          return (
            <button
              key={a.id}
              className="btn-ghost"
              onClick={() => setSelectedId(active ? null : a.id)}
              aria-pressed={active}
              style={{
                display: "block",
                textAlign: "left",
                padding: "var(--space-md) var(--space-lg)",
                borderRadius: "var(--radius-lg)",
                border: active
                  ? "2px solid var(--color-primary)"
                  : "2px solid var(--color-outline-variant, #d0d0d0)",
                background: active
                  ? "var(--color-surface-container-low)"
                  : "var(--color-surface-container-lowest)",
                cursor: "pointer",
                width: "100%",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-xs)" }}>
                <span style={{ color: "var(--color-primary)", display: "inline-flex" }}>
                  <Icon name={a.icon} size={16} />
                </span>
                <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--color-on-surface)" }}>
                  {a.title}
                </span>
              </span>
              <span className="text-xs" style={{ display: "block", color: "var(--color-on-surface-variant)", lineHeight: 1.45 }}>
                {a.examples}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div
          className="card"
          style={{
            marginTop: "var(--space-md)",
            borderLeft: "4px solid var(--color-primary)",
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: "var(--space-xs)", fontSize: "0.95rem" }}>
            {selected.title}
          </p>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>
            {selected.blurb}
          </p>
          <ol style={{ margin: 0, paddingLeft: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {selected.steps.map((step, i) => (
              <li key={i} style={{ lineHeight: 1.55, fontSize: "0.9rem" }}>{step}</li>
            ))}
          </ol>
          <div style={{ marginTop: "var(--space-lg)", maxWidth: 340 }}>
            {briefingSlot}
          </div>
          {footnote && (
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)", marginBottom: 0 }}>
              {footnote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
