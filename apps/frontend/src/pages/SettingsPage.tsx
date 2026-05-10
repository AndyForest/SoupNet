import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, clearToken } from "../auth.js";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../components/Icon.js";
import { useClipboard } from "../hooks/useClipboard.js";

const BACKEND_URL = import.meta.env.VITE_API_BASE ?? "http://localhost:3101";
const MCP_URL = `${BACKEND_URL}/mcp`;
const DOCS_URL = `${BACKEND_URL}/docs/mcp-setup`;

function claudeCodeCli(key: string): string {
  return `claude mcp add --transport http soupnet ${MCP_URL} --header "Authorization: Bearer ${key}"`;
}

function claudeCodeConfig(key: string): string {
  return JSON.stringify({
    mcpServers: {
      soupnet: {
        type: "http",
        url: MCP_URL,
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  }, null, 2);
}

function vscodeConfig(key: string): string {
  return JSON.stringify({
    servers: {
      soupnet: {
        url: MCP_URL,
        type: "http",
        headers: { Authorization: `Bearer ${key}` },
      },
    },
    inputs: [],
  }, null, 2);
}

function claudeDesktopConfig(key: string): string {
  return JSON.stringify({
    mcpServers: {
      soupnet: {
        command: "npx",
        args: ["-y", "mcp-remote", MCP_URL, "--header", `Authorization: Bearer ${key}`],
      },
    },
  }, null, 2);
}

function antigravityConfig(key: string): string {
  return JSON.stringify({
    mcpServers: {
      soupnet: {
        serverUrl: MCP_URL,
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  }, null, 2);
}

interface AdminSettings {
  signupCap: number;
  currentUsers: number;
  pendingInvitations: number;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [capInput, setCapInput] = useState("");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string; emailVerified?: boolean } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  const isAdmin = meQuery.data?.role === "system";

  // Fetch user's API keys to pre-fill setup configs
  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: async () => {
      const res = await authFetch("/keys");
      const json = (await res.json()) as { ok: boolean; data?: Array<{ keyPrefix: string }> };
      return json.data ?? [];
    },
  });
  const urlParams = new URLSearchParams(window.location.search);
  const keyFromUrl = urlParams.get("key");
  const firstKeyPrefix = keysQuery.data?.[0]?.keyPrefix ?? "YOUR_API_KEY";
  const hasKey = !!keyFromUrl || firstKeyPrefix !== "YOUR_API_KEY";
  const keyPlaceholder = keyFromUrl || (firstKeyPrefix !== "YOUR_API_KEY" ? `${firstKeyPrefix}...` : "YOUR_API_KEY (generate one on the Keys page)");

  const adminSettingsQuery = useQuery<AdminSettings>({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const res = await authFetch("/admin/settings");
      const json = (await res.json()) as { ok: boolean; data: AdminSettings };
      if (!json.ok) throw new Error("Failed");
      return json.data;
    },
    enabled: isAdmin,
  });

  const updateCapMutation = useMutation({
    mutationFn: async (newCap: number) => {
      const res = await authFetch("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ signupCap: newCap }),
      });
      const json = (await res.json()) as { ok: boolean };
      if (!json.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      setCapInput("");
    },
  });

  function handleLogout() {
    clearToken();
    void navigate({ to: "/auth/login" });
  }

  const { copy: handleCopy, copied } = useClipboard();

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/auth/me/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      // Prefer the server's filename (Content-Disposition) but fall back to a
      // sensible default — some browsers strip the attribute under CORS.
      const disp = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disp);
      const filename = match?.[1] ?? `soupnet-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>Settings</h1>
      </header>

      {/* Account */}
      <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h3 style={{ marginBottom: "var(--space-md)" }}>Account</h3>
        {meQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}
        {meQuery.data && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontFamily: "var(--font-headline)", fontWeight: 600 }}>{meQuery.data.email}</p>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                Role: {meQuery.data.role}
              </p>
            </div>
            <button className="btn-secondary" onClick={handleLogout} style={{ fontSize: "0.8rem" }}>
              Sign out
            </button>
          </div>
        )}
      </section>

      {/* Agent Setup Guide */}
      <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Agent Setup</h3>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
          Connect your AI agents to Soup.net.{" "}
          {!hasKey && <strong>First, generate an API key on the <a href="/app/keys">Keys page</a>.</strong>}
          {" "}<a href={DOCS_URL} target="_blank" rel="noopener">Full setup guide →</a>
        </p>

        {/* Claude Code — quickest path */}
        <ConfigBlock
          title="Claude Code (quickest)"
          label="claude-code-cli"
          copied={copied}
          onCopy={handleCopy}
          code={claudeCodeCli(keyPlaceholder)}
          note="Run this in your terminal. One command — done."
        />

        {/* Claude Code — .mcp.json config */}
        <ConfigBlock
          title="Claude Code (.mcp.json)"
          label="claude-code"
          copied={copied}
          onCopy={handleCopy}
          code={claudeCodeConfig(keyPlaceholder)}
          note="Add to .mcp.json in your project root, or ~/.claude/.mcp.json for global."
        />

        {/* VS Code — separate schema: top-level `servers` + `inputs: []` */}
        <ConfigBlock
          title="VS Code (.vscode/mcp.json)"
          label="vscode"
          copied={copied}
          onCopy={handleCopy}
          code={vscodeConfig(keyPlaceholder)}
          note="Add to .vscode/mcp.json in your project root. VS Code uses `servers` (not `mcpServers`) and requires the `inputs` array."
        />

        {/* Google Antigravity */}
        <ConfigBlock
          title="Google Antigravity"
          label="antigravity"
          copied={copied}
          onCopy={handleCopy}
          code={antigravityConfig(keyPlaceholder)}
          note="Add to ~/.gemini/antigravity/mcp_config.json — user-global, applies to all projects. Restart Antigravity after saving."
        />

        {/* Claude Desktop — stdio bridge via mcp-remote */}
        <ConfigBlock
          title="Claude Desktop"
          label="claude-desktop"
          copied={copied}
          onCopy={handleCopy}
          code={claudeDesktopConfig(keyPlaceholder)}
          note="Add to your Claude Desktop config file. Uses mcp-remote to bridge stdio to HTTP. Or download the extension at the setup guide link above."
        />

        {/* Web agents */}
        <div style={{ marginTop: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", background: "var(--color-surface-container-low)", borderRadius: "var(--radius-md)", fontSize: "0.85rem" }}>
          <strong>Web agents (ChatGPT, Stitch, etc.):</strong> No MCP needed — browse to{" "}
          <a href={`${BACKEND_URL}/check`} target="_blank" rel="noopener">
            {BACKEND_URL}/check?key={keyPlaceholder}
          </a>
        </div>
      </section>

      {/* Your Data — export */}
      <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Your Data</h3>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
          Your recipes, evidence, and references are yours. Export a full copy as JSON whenever you want —
          including your recipes, the evidence and references you've submitted with them, your recipe book memberships,
          and API key metadata. System-generated data (vectors, embeddings, audit logs) is not included since it's
          derived from what you contributed.
        </p>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            style={{ fontSize: "0.85rem" }}
          >
            {exportMutation.isPending ? "Preparing export..." : "Export my data (JSON)"}
          </button>
          {exportMutation.isError && (
            <span style={{ color: "var(--color-error)", fontSize: "0.8rem" }}>
              {(exportMutation.error as Error).message}
            </span>
          )}
          {exportMutation.isSuccess && !exportMutation.isPending && (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              Downloaded.
            </span>
          )}
        </div>
      </section>

      {/* System Admin (system role only) */}
      {isAdmin && (
        <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>System Admin</h3>

          {adminSettingsQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}
          {adminSettingsQuery.data && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
                <div style={{ background: "var(--color-surface-container-low)", borderRadius: "var(--radius-md)", padding: "var(--space-md)", textAlign: "center" }}>
                  <p className="text-label">Signup Cap</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-primary)", marginTop: "var(--space-xs)" }}>
                    {adminSettingsQuery.data.signupCap}
                  </p>
                </div>
                <div style={{ background: "var(--color-surface-container-low)", borderRadius: "var(--radius-md)", padding: "var(--space-md)", textAlign: "center" }}>
                  <p className="text-label">Verified Users</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-primary)", marginTop: "var(--space-xs)" }}>
                    {adminSettingsQuery.data.currentUsers}
                  </p>
                </div>
                <div style={{ background: "var(--color-surface-container-low)", borderRadius: "var(--radius-md)", padding: "var(--space-md)", textAlign: "center" }}>
                  <p className="text-label">Pending Invites</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-primary)", marginTop: "var(--space-xs)" }}>
                    {adminSettingsQuery.data.pendingInvitations}
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="signupCap">Set signup cap (0 = no self-signups)</label>
                  <input
                    id="signupCap"
                    type="number"
                    min="0"
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                    placeholder={String(adminSettingsQuery.data.signupCap)}
                  />
                </div>
                <button
                  onClick={() => {
                    const val = parseInt(capInput, 10);
                    if (!isNaN(val) && val >= 0) updateCapMutation.mutate(val);
                  }}
                  disabled={updateCapMutation.isPending || !capInput}
                >
                  {updateCapMutation.isPending ? "Saving..." : "Update Cap"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Privacy defaults (placeholder) */}
      <section className="card">
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Privacy Defaults</h3>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem" }}>
          Default privacy and storage settings for new traces. Coming soon.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)", marginTop: "var(--space-md)", opacity: 0.5, pointerEvents: "none" }}>
          <div>
            <label>Default Privacy Level</label>
            <select defaultValue="user_only">
              <option value="agent_only">Agent Only</option>
              <option value="user_only">User Only</option>
              <option value="group">Recipe Book</option>
              <option value="org_only">Organization</option>
            </select>
          </div>
          <div>
            <label>Default Storage Mode</label>
            <select defaultValue="full">
              <option value="full">Full</option>
              <option value="indexed">Indexed</option>
              <option value="air-gapped">Air-gapped</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}

function ConfigBlock({ title, label, copied, onCopy, code, note }: {
  title: string;
  label: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
  code: string;
  note: string;
}) {
  return (
    <div style={{ marginBottom: "var(--space-md)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-xs)" }}>
        <h4 style={{ fontSize: "0.95rem" }}>{title}</h4>
        <button className="btn-ghost" onClick={() => onCopy(code, label)} style={{ fontSize: "0.75rem" }}>
          <Icon name="copy" size={14} />
          {copied === label ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre style={{
        background: "var(--color-surface-container-high)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md)",
        fontFamily: "var(--font-mono)",
        fontSize: "0.78rem",
        lineHeight: 1.5,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}>
        {code}
      </pre>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
        {note}
      </p>
    </div>
  );
}
