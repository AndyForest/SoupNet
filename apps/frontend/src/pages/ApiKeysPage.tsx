import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import { Icon } from "../components/Icon.js";
import { RecipeBookScopePicker } from "../components/RecipeBookScopePicker.js";
import { useClipboard } from "../hooks/useClipboard.js";
import { substituteBriefingKey } from "../lib/briefing-key.js";

// sessionStorage key for the ephemeral custom-briefing handoff. The raw API
// key never goes into the URL — RecipeMapPage reads this once on mount, then
// deletes it. Surviving only until the map page mounts is by design.
export const CUSTOM_BRIEFING_STORAGE_KEY = "soupnet_custom_briefing";

export interface CustomBriefingHandoff {
  rawKey: string;
  label: string;
  keyPrefix: string; // for the banner when label is empty — "you just created (soup_abc1…)"
  readRecipeBookIds: string[];
}

interface ApiKey {
  id: string;
  keyPrefix: string;
  keyType: string;
  readRecipeBookIds: string[];
  writeRecipeBookIds: string[];
  defaultWriteRecipeBookId: string;
  label: string | null;
  expiresAt: string;
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
  description: string | null;
}

interface KeyResponse {
  ok: boolean;
  data?: { key: string; searchUrl: string; expiresAt: string };
  error?: string;
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dailyKey, setDailyKey] = useState<{ searchUrl: string; expiresAt: string } | null>(null);

  // Scoped key form state
  const [showForm, setShowForm] = useState(false);
  const [scopedLabel, setScopedLabel] = useState("");
  const [scopedDays, setScopedDays] = useState("30");
  const [readGroupIds, setReadGroupIds] = useState<string[]>([]);
  const [writeGroupIds, setWriteGroupIds] = useState<string[]>([]);
  const [defaultWriteGroupId, setDefaultWriteGroupId] = useState<string>("");

  // Track just-created key — shows inline in the active keys list
  const [justCreatedKey, setJustCreatedKey] = useState<{ raw: string; id: string } | null>(null);

  // Track which keys are expanded
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: async () => {
      const res = await authFetch("/keys");
      const json = (await res.json()) as { ok: boolean; data: ApiKey[] };
      if (!json.ok) throw new Error("Failed to load keys");
      return json.data;
    },
  });

  const groupsQuery = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await authFetch("/recipe-books");
      const json = (await res.json()) as { ok: boolean; data: Group[] };
      return json.ok ? json.data : [];
    },
  });

  const dailyKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/keys/daily", { method: "POST" });
      const json = (await res.json()) as KeyResponse;
      if (!json.ok) throw new Error(json.error ?? "Failed to generate key");
      return json.data!;
    },
    onSuccess: (data) => {
      setDailyKey(data);
      void queryClient.invalidateQueries({ queryKey: ["keys"] });
    },
  });

  const scopedKeyMutation = useMutation({
    mutationFn: async () => {
      const days = parseInt(scopedDays, 10) || 30;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const groups = groupsQuery.data ?? [];
      const rIds = readGroupIds.length > 0 ? readGroupIds : groups.map((g) => g.id);
      const wIds = writeGroupIds.length > 0 ? writeGroupIds : groups.map((g) => g.id);
      const dwId = defaultWriteGroupId || wIds[0] || "";
      const res = await authFetch("/keys/scoped", {
        method: "POST",
        body: JSON.stringify({
          readRecipeBookIds: rIds,
          writeRecipeBookIds: wIds,
          defaultWriteRecipeBookId: dwId,
          expiresAt,
          label: scopedLabel || undefined,
        }),
      });
      const json = (await res.json()) as KeyResponse;
      if (!json.ok) throw new Error(json.error ?? "Failed to generate key");
      return json.data!;
    },
    onSuccess: (data) => {
      // Reset form, keep Create Key button available
      setShowForm(false);
      setScopedLabel("");
      setScopedDays("30");
      void queryClient.invalidateQueries({ queryKey: ["keys"] });

      // Find the new key in the refreshed list by matching the prefix
      // The raw key is only available now — store it for inline display
      const prefix = data.key.slice(0, 8);
      // We'll match by prefix after the query invalidation refreshes
      setJustCreatedKey({ raw: data.key, id: prefix });
      setExpandedKeyId(prefix); // expand it immediately
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const res = await authFetch(`/keys/${keyId}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean };
      if (!json.ok) throw new Error("Failed to revoke key");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["keys"] });
    },
  });

  function handleShowForm() {
    const allIds = groupsQuery.data?.map((g) => g.id) ?? [];
    setReadGroupIds(allIds);
    setWriteGroupIds(allIds);
    setDefaultWriteGroupId(allIds[0] ?? "");
    setShowForm(true);
  }

  const { copy: copyText, copyAsync, copied } = useClipboard();
  const [briefingPending, setBriefingPending] = useState<string | null>(null);

  // Fetch the unified briefing text for a given raw key. Invoked inside
  // copyAsync so the ClipboardItem Promise preserves iOS Safari's gesture
  // context across the fetch await (plain onSuccess copies silently no-op
  // on iPhone). POST body keeps the raw key out of the request URL; the
  // response carries only the YOUR_API_KEY placeholder, substituted here.
  async function fetchBriefingText(rawKey: string): Promise<string> {
    const res = await authFetch("/keys/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: rawKey }),
    });
    const json = (await res.json()) as { ok: boolean; data?: { text: string } };
    if (!json.ok || !json.data) throw new Error("Failed to get briefing");
    return substituteBriefingKey(json.data.text, rawKey);
  }

  async function handleCopyBriefing(keyId: string, rawKey: string) {
    setBriefingPending(keyId);
    try {
      await copyAsync(() => fetchBriefingText(rawKey), `briefing-${keyId}`);
    } finally {
      setBriefingPending(null);
    }
  }

  const groups = groupsQuery.data ?? [];
  const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));

  // Match just-created key to an active key by prefix
  const justCreatedRawKey = justCreatedKey
    ? keysQuery.data?.find((k) => k.keyPrefix === justCreatedKey.id) ? justCreatedKey.raw : null
    : null;

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>API Keys</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
          Manage credentials for your AI agents.
        </p>
      </header>

      {/* Daily recipe check link */}
      <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Daily Recipe Check Link</h3>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
          Generate a link valid for 24 hours. Share it with colleagues or paste into an agent session.
        </p>
        <button onClick={() => dailyKeyMutation.mutate()} disabled={dailyKeyMutation.isPending}>
          <Icon name="copy" size={16} />
          {dailyKeyMutation.isPending ? "Generating..." : "Generate Link"}
        </button>

        {dailyKeyMutation.isError && (
          <p style={{ color: "var(--color-error)", fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>
            {dailyKeyMutation.error.message}
          </p>
        )}

        {dailyKey && (
          <div style={{ marginTop: "var(--space-md)" }}>
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
              <input readOnly value={dailyKey.searchUrl} className="text-mono" style={{ fontSize: "0.8rem" }} />
              <button className="btn-secondary" onClick={() => void copyText(dailyKey.searchUrl, "daily")} style={{ flexShrink: 0 }}>
                {copied === "daily" ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
              Expires: {new Date(dailyKey.expiresAt).toLocaleString()}
            </p>
          </div>
        )}
      </section>

      {/* Agent API Key — form + active keys together */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-md)" }}>
          <h2 style={{ fontSize: "1.15rem" }}>Agent API Keys</h2>
          {!showForm && (
            <button className="btn-secondary" onClick={handleShowForm} style={{ fontSize: "0.85rem" }}>
              <Icon name="plus" size={14} /> Create Key
            </button>
          )}
        </div>

        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
          Longer-lived keys for MCP integrations. Click a key to see its scope and setup instructions.
        </p>

        {/* Create form */}
        {showForm && (
          <div className="card" style={{ marginBottom: "var(--space-md)" }}>
            <h4 style={{ marginBottom: "var(--space-sm)" }}>New API Key</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <div>
                <label htmlFor="scopedLabel">Label (optional)</label>
                <input
                  id="scopedLabel"
                  value={scopedLabel}
                  onChange={(e) => setScopedLabel(e.target.value)}
                  placeholder="e.g., Claude Code, ChatGPT"
                />
              </div>
              <div>
                <label htmlFor="scopedDays">Valid for (days)</label>
                <input
                  id="scopedDays"
                  type="number"
                  min="1"
                  max="365"
                  value={scopedDays}
                  onChange={(e) => setScopedDays(e.target.value)}
                />
              </div>

              {groups.length > 1 && (
                <RecipeBookScopePicker
                  books={groups}
                  readIds={readGroupIds}
                  writeIds={writeGroupIds}
                  defaultWriteId={defaultWriteGroupId}
                  setReadIds={setReadGroupIds}
                  setWriteIds={setWriteGroupIds}
                  setDefaultWriteId={setDefaultWriteGroupId}
                />
              )}

              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <button onClick={() => scopedKeyMutation.mutate()} disabled={scopedKeyMutation.isPending}>
                  {scopedKeyMutation.isPending ? "Generating..." : "Generate Key"}
                </button>
                <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>

              {scopedKeyMutation.isError && (
                <p style={{ color: "var(--color-error)", fontSize: "0.875rem" }}>
                  {scopedKeyMutation.error.message}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Active keys list */}
        {keysQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}
        {keysQuery.isError && <p style={{ color: "var(--color-error)" }}>Failed to load keys.</p>}
        {keysQuery.data && keysQuery.data.length === 0 && (
          <p style={{ color: "var(--color-on-surface-variant)" }}>No active keys.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {keysQuery.data?.map((key) => {
            const isExpanded = expandedKeyId === key.id || (justCreatedKey?.id === key.keyPrefix);
            const isJustCreated = justCreatedKey?.id === key.keyPrefix;
            const rawKey = isJustCreated ? justCreatedRawKey : null;

            return (
              <div
                key={key.id}
                style={{
                  background: isJustCreated ? "var(--color-surface-container)" : "var(--color-surface-container-low)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-md) var(--space-lg)",
                  border: isJustCreated ? "2px solid var(--color-primary)" : undefined,
                }}
              >
                {/* Key header — click to expand */}
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => setExpandedKeyId(isExpanded && !isJustCreated ? null : key.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                    <span style={{
                      display: "inline-block",
                      transition: "transform 0.15s",
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      fontSize: "0.75rem",
                      color: "var(--color-on-surface-variant)",
                    }}>&#9654;</span>
                    <span className="text-mono">{key.keyPrefix}...</span>
                    <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                      {key.keyType}{key.label ? ` — ${key.label}` : ""}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-outline-variant)" }}>
                      expires {new Date(key.expiresAt).toLocaleDateString()}
                    </span>
                    {isJustCreated && (
                      <span className="pill" style={{ fontSize: "0.6rem", background: "var(--color-primary)", color: "var(--color-on-primary)" }}>
                        NEW
                      </span>
                    )}
                  </div>
                  <button
                    className="btn-danger"
                    onClick={(e) => { e.stopPropagation(); revokeMutation.mutate(key.id); }}
                    disabled={revokeMutation.isPending}
                    style={{ fontSize: "0.75rem", padding: "0.35rem 0.7rem" }}
                  >
                    Revoke
                  </button>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-md)" }}>
                    {/* One-time raw key display for just-created keys */}
                    {rawKey && (
                      <div style={{
                        marginBottom: "var(--space-md)",
                        padding: "var(--space-md)",
                        background: "var(--color-surface-container-high)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-secondary)",
                      }}>
                        <p style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "var(--space-sm)", color: "var(--color-secondary)" }}>
                          Key shown once only — copy it now
                        </p>
                        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                          <input readOnly value={rawKey} className="text-mono" style={{ fontSize: "0.78rem" }} />
                          <button className="btn-secondary" onClick={() => void copyText(rawKey, `key-${key.id}`)} style={{ flexShrink: 0, fontSize: "0.8rem" }}>
                            {copied === `key-${key.id}` ? "Copied!" : "Copy"}
                          </button>
                        </div>

                        <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)", flexWrap: "wrap" }}>
                          <button
                            onClick={() => void handleCopyBriefing(key.id, rawKey)}
                            disabled={briefingPending !== null}
                            style={{ flex: 1, minWidth: 150, justifyContent: "center", fontSize: "0.78rem", whiteSpace: "nowrap" }}
                          >
                            {copied === `briefing-${key.id}`
                              ? "Copied!"
                              : briefingPending === key.id
                                ? "Generating..."
                                : "Copy agent briefing"}
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              const handoff: CustomBriefingHandoff = {
                                rawKey,
                                label: key.label ?? "",
                                keyPrefix: key.keyPrefix,
                                readRecipeBookIds: key.readRecipeBookIds,
                              };
                              try {
                                sessionStorage.setItem(CUSTOM_BRIEFING_STORAGE_KEY, JSON.stringify(handoff));
                              } catch { /* sessionStorage unavailable — the map just falls back to the daily-key flow */ }
                              void navigate({ to: "/app/map" });
                            }}
                            style={{ flex: 1, minWidth: 150, justifyContent: "center", fontSize: "0.78rem", whiteSpace: "nowrap" }}
                            title="Open the Recipe Map with this key's read recipe books preselected. Slice the corpus until you like the clusters, then copy a briefing tied to this key."
                          >
                            Custom Briefing →
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Scope details — always visible when expanded */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)", fontSize: "0.85rem" }}>
                      <div>
                        <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>Read recipe books</p>
                        {key.readRecipeBookIds.length === 0 ? (
                          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>None</p>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: "var(--space-md)", listStyle: "disc" }}>
                            {key.readRecipeBookIds.map((id) => (
                              <li key={id} className="text-xs">{groupNameMap.get(id) ?? id.slice(0, 8)}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>Write recipe books</p>
                        {key.writeRecipeBookIds.length === 0 ? (
                          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>None</p>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: "var(--space-md)", listStyle: "disc" }}>
                            {key.writeRecipeBookIds.map((id) => (
                              <li key={id} className="text-xs">
                                {groupNameMap.get(id) ?? id.slice(0, 8)}
                                {id === key.defaultWriteRecipeBookId && <span style={{ color: "var(--color-primary)" }}> (default)</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
                      <a
                        href={`/map?groupId=${encodeURIComponent(key.defaultWriteRecipeBookId)}`}
                        style={{ color: "var(--color-primary)", fontSize: "0.8rem", textDecoration: "none" }}
                      >
                        Map default recipe book →
                      </a>
                      <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                        Created {new Date(key.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
