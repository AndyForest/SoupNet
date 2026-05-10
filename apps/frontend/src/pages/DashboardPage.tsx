import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { authFetch } from "../auth.js";
import { useTraces, useTraceCount } from "../hooks/useTraces.js";
import { Icon } from "../components/Icon.js";
import { useClipboard } from "../hooks/useClipboard.js";

// Note: the email-verification banner that used to live here has been
// replaced by the /verify-pending route, which is the only authed route an
// unverified user can reach. The router guard handles the redirect.

interface Group {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface PendingInvite {
  id: string;
  groupId: string;
  groupName: string;
  groupSlug: string;
  groupDescription: string | null;
  inviterEmail: string;
  createdAt: string;
  expiresAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tracesQuery = useTraces(10);
  const traceCountQuery = useTraceCount();
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const { copyAsync, copied } = useClipboard(2500);
  const [dailyOpened, setDailyOpened] = useState(false);
  const [briefingPending, setBriefingPending] = useState<"mcp" | "web" | null>(null);
  const groupSelectRef = useRef<HTMLSelectElement>(null);

  // Pending group invitations — top of the dashboard feed (tier 1: action
  // required). See docs/design-thinking.md §Dashboard as a Feed.
  const pendingInvitesQuery = useQuery({
    queryKey: ["invitations-pending"],
    queryFn: async () => {
      const res = await authFetch("/invitations/pending");
      const json = (await res.json()) as { ok: boolean; data: PendingInvite[] };
      return json.ok ? json.data : [];
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await authFetch(`/invitations/${inviteId}/accept`, { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { groupSlug: string | null; groupName: string | null };
        error?: string;
      };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to accept");
      return json.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["invitations-pending"] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      if (data.groupSlug) {
        void navigate({ to: "/app/recipe-books", search: { justJoined: data.groupSlug } as never });
      }
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await authFetch(`/invitations/${inviteId}/decline`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to decline");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations-pending"] });
    },
  });

  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: async () => {
      const res = await authFetch("/keys");
      const json = (await res.json()) as { ok: boolean; data: unknown[] };
      return json.ok ? json.data : [];
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

  // Set initial selected group to first group
  const groups = groupsQuery.data ?? [];
  const effectiveGroupId = selectedGroupId || (groups.length > 0 ? groups[0]!.id : "");
  const selectedGroup = groups.find(g => g.id === effectiveGroupId);

  // Mint a daily key scoped to the focus group, then fetch the briefing.
  // Called inside copyAsync so the ClipboardItem Promise keeps iOS Safari's
  // user-gesture context alive across both awaits — a plain onSuccess copy
  // would silently no-op on iPhone.
  async function fetchBriefingText(type: "mcp" | "web"): Promise<string> {
    const body = effectiveGroupId ? { writeRecipeBookId: effectiveGroupId } : undefined;
    const keyRes = await authFetch("/keys/daily", {
      method: "POST",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const keyJson = (await keyRes.json()) as { ok: boolean; data?: { key: string; searchUrl: string } };
    if (!keyJson.ok || !keyJson.data) throw new Error("Failed to generate key");

    const briefRes = await authFetch(`/keys/briefing?type=${type}&key=${encodeURIComponent(keyJson.data.key)}`);
    const briefJson = (await briefRes.json()) as { ok: boolean; data?: { text: string } };
    if (!briefJson.ok || !briefJson.data) throw new Error("Failed to get briefing");

    void queryClient.invalidateQueries({ queryKey: ["keys"] });
    return briefJson.data.text;
  }

  async function handleCopyBriefing(type: "mcp" | "web") {
    setBriefingPending(type);
    try {
      await copyAsync(() => fetchBriefingText(type), type);
    } finally {
      setBriefingPending(null);
    }
  }

  const dailyGoMutation = useMutation({
    mutationFn: async () => {
      const body = effectiveGroupId ? { writeRecipeBookId: effectiveGroupId } : undefined;
      const res = await authFetch("/keys/daily", {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const json = (await res.json()) as { ok: boolean; data?: { searchUrl: string } };
      if (!json.ok || !json.data) throw new Error("Failed to generate key");
      return json.data;
    },
    onSuccess: (data) => {
      window.open(data.searchUrl, "_blank");
      setDailyOpened(true);
      setTimeout(() => setDailyOpened(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ["keys"] });
    },
  });

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>Dashboard</h1>
      </header>

      {/* Pending invitations — top of the feed. Action required (tier 1). */}
      {pendingInvitesQuery.data && pendingInvitesQuery.data.length > 0 && (
        <section style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "var(--space-md)" }}>
            Recipe book invitations ({pendingInvitesQuery.data.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {pendingInvitesQuery.data.map((inv) => {
              const expiresIn = Math.max(0, Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
              return (
                <div
                  key={inv.id}
                  className="card"
                  style={{
                    borderLeft: "4px solid var(--color-primary)",
                    padding: "var(--space-md) var(--space-lg)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "var(--space-md)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {inv.inviterEmail} invited you to <span style={{ color: "var(--color-primary)" }}>{inv.groupName}</span>
                    </p>
                    {inv.groupDescription && (
                      <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", margin: "var(--space-xs) 0 0 0" }}>
                        {inv.groupDescription}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                      Expires in {expiresIn}d. Accepting lets your AI agent share this recipe book's accumulated taste.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <button
                      className="btn"
                      onClick={() => acceptInviteMutation.mutate(inv.id)}
                      disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                      style={{ fontSize: "0.85rem" }}
                    >
                      {acceptInviteMutation.isPending && acceptInviteMutation.variables === inv.id ? "Accepting..." : "Accept"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => declineInviteMutation.mutate(inv.id)}
                      disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                      style={{ fontSize: "0.85rem" }}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-2xl)" }}>
        <div className="card" style={{ textAlign: "center", padding: "var(--space-lg)" }}>
          <p className="text-label">Recipes Checked</p>
          <p style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 700, color: "var(--color-primary)", lineHeight: 1.2, marginTop: "var(--space-xs)" }}>
            {traceCountQuery.data ?? "—"}
          </p>
        </div>
        <Link to="/app/keys" style={{ textDecoration: "none" }}>
          <div className="card" style={{ textAlign: "center", padding: "var(--space-lg)", cursor: "pointer" }}>
            <p className="text-label">Active Keys</p>
            <p style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 700, color: "var(--color-primary)", lineHeight: 1.2, marginTop: "var(--space-xs)" }}>
              {keysQuery.data ? (keysQuery.data as unknown[]).length : "—"}
            </p>
          </div>
        </Link>
        <Link to="/app/recipe-books" style={{ textDecoration: "none" }}>
          <div className="card" style={{ textAlign: "center", padding: "var(--space-lg)", cursor: "pointer" }}>
            <p className="text-label">Recipe Books</p>
            <p style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 700, color: "var(--color-primary)", lineHeight: 1.2, marginTop: "var(--space-xs)" }}>
              {groups.length || "—"}
            </p>
          </div>
        </Link>
      </div>

      {/* Two-column: recent traces + quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "var(--space-xl)", alignItems: "start" }}>
        {/* Recipe check log */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-md)" }}>
            <h2 style={{ fontSize: "1.15rem" }}>Recipe Check Log</h2>
            <Link to="/app/checks" style={{ color: "var(--color-primary)", fontSize: "0.8rem", textDecoration: "none" }}>
              View all →
            </Link>
          </div>
          {tracesQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {tracesQuery.data?.map((trace) => (
              <div
                key={trace.id}
                style={{
                  background: "var(--color-surface-container-low)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-md) var(--space-lg)",
                }}
              >
                <Link
                  to="/app/traces/$traceId"
                  params={{ traceId: trace.id }}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <p style={{ marginBottom: "var(--space-xs)", lineHeight: 1.5 }}>
                    {trace.claimText.length > 140 ? trace.claimText.slice(0, 140) + "..." : trace.claimText}
                  </p>
                </Link>
                <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
                  {trace.apiKeyLabel && (
                    <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                      {trace.apiKeyLabel}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                    {timeAgo(trace.createdAt)}
                  </span>
                  {(trace.evidenceCount ?? 0) > 0 && (
                    <span className="pill" style={{ fontSize: "0.65rem" }}>
                      {trace.evidenceCount} evidence
                    </span>
                  )}
                  <a
                    href={`/map?query=${encodeURIComponent(trace.claimText)}`}
                    style={{ color: "var(--color-primary)", fontSize: "0.7rem", textDecoration: "none" }}
                  >
                    Map from here →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right sidebar */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
          {/* Group selector — shared between both sections */}
          {groups.length > 0 && (
            <div>
              <label htmlFor="dashboard-group" className="text-label" style={{ display: "block", marginBottom: "var(--space-xs)" }}>
                Focus recipe book ▾
              </label>
              <select
                ref={groupSelectRef}
                id="dashboard-group"
                value={effectiveGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "var(--space-sm) var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  border: "2px solid var(--color-primary)",
                  background: "var(--color-surface)",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: "var(--color-on-surface)",
                  cursor: "pointer",
                  appearance: "auto",
                }}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              {selectedGroup?.description && (
                <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                  {selectedGroup.description}
                </p>
              )}
            </div>
          )}

          {/* For Your Agents */}
          <section>
            <h2 style={{ fontSize: "1.05rem", marginBottom: "var(--space-md)" }}>For Your Agents</h2>
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>
              Generates a 24-hour key: reads all recipe books, writes to <strong>{selectedGroup?.name ?? "your recipe book"}</strong>.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <button
                onClick={() => void handleCopyBriefing("mcp")}
                disabled={briefingPending !== null}
                style={{ width: "100%", justifyContent: "center", fontSize: "0.85rem" }}
              >
                <Icon name="copy" size={14} />
                {copied === "mcp" ? "Copied!" : briefingPending === "mcp" ? "Generating..." : "Copy MCP agent briefing"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => void handleCopyBriefing("web")}
                disabled={briefingPending !== null}
                style={{ width: "100%", justifyContent: "center", fontSize: "0.85rem" }}
              >
                <Icon name="copy" size={14} />
                {copied === "web" ? "Copied!" : briefingPending === "web" ? "Generating..." : "Copy web agent briefing"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => dailyGoMutation.mutate()}
                disabled={dailyGoMutation.isPending}
                style={{ width: "100%", justifyContent: "center", fontSize: "0.85rem" }}
              >
                <Icon name="external-link" size={14} />
                {dailyOpened ? "Opened!" : dailyGoMutation.isPending ? "Opening..." : "Open recipe check page"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-sm)" }}>
              For granular key control, <Link to="/app/keys" style={{ color: "var(--color-primary)" }}>manage API keys</Link>.
            </p>
          </section>

          {/* Collaboration */}
          <section>
            <h2 style={{ fontSize: "1.05rem", marginBottom: "var(--space-xs)" }}>Collaboration</h2>
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)", lineHeight: 1.4 }}>
              Invite people to your recipe books so your agents share context. Open a book to send an invite.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <Link to="/app/map" search={selectedGroup ? { groupId: effectiveGroupId } : {}} style={{ textDecoration: "none" }}>
                <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", fontSize: "0.85rem" }}>
                  <Icon name="map" size={14} />
                  Recipe Map{selectedGroup ? `: ${selectedGroup.name}` : ""}
                </button>
              </Link>
              <Link to="/app/recipe-books" style={{ textDecoration: "none" }}>
                <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", fontSize: "0.85rem" }}>
                  <Icon name="users" size={14} />
                  Manage Recipe Books
                </button>
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
