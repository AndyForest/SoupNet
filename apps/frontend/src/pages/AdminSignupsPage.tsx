import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "../auth.js";
import {
  AdminLayout,
  AdminPageHeader,
  AdminMetricCard,
  AdminTable,
  AdminEmptyState,
  useAdminGate,
  type AdminColumn,
} from "../components/admin/index.js";

interface SettingsData {
  signupCap: number;
  embeddingsEnabled: boolean;
  currentUsers: number;
  pendingInvitations: number;
}

type QueueRowType = "waitlist" | "admin_invite" | "member_invite";

interface QueueRow {
  id: string;
  email: string;
  type: QueueRowType;
  reason: string | null;
  inviterEmail: string | null;
  invitedAt: string | null;
  notifiedAt: string | null;
  createdAt: string;
  registered: boolean;
  invitePending: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const TYPE_LABELS: Record<QueueRowType, { label: string; color: string }> = {
  waitlist: { label: "Waitlist", color: "var(--color-on-surface-variant)" },
  member_invite: { label: "Member invite", color: "#3b82f6" },
  admin_invite: { label: "Admin invite", color: "#8b5cf6" },
};

function rowStatus(row: QueueRow): { label: string; color: string } {
  if (row.registered) return { label: "Registered", color: "var(--color-success)" };
  if (row.type === "waitlist" && row.notifiedAt) {
    return { label: `Notified ${formatDate(row.notifiedAt)}`, color: "#3b82f6" };
  }
  if (row.invitePending || row.invitedAt) return { label: "Invite pending", color: "#3b82f6" };
  return { label: "Waiting", color: "var(--color-on-surface-variant)" };
}

export function AdminSignupsPage() {
  const queryClient = useQueryClient();
  const [capInput, setCapInput] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState<{ email: string; inviteUrl: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { gate, isAdmin } = useAdminGate();

  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const res = await authFetch("/admin/settings");
      const json = (await res.json()) as { ok: boolean; data?: SettingsData };
      if (!json.ok || !json.data) throw new Error("Failed to load settings");
      return json.data;
    },
    enabled: isAdmin,
  });

  const queueQuery = useQuery({
    queryKey: ["admin", "waitlist"],
    queryFn: async () => {
      const res = await authFetch("/admin/waitlist");
      const json = (await res.json()) as { ok: boolean; data?: QueueRow[] };
      if (!json.ok || !json.data) throw new Error("Failed to load signup queue");
      return json.data;
    },
    enabled: isAdmin,
  });

  const updateCapMutation = useMutation({
    mutationFn: async (signupCap: number) => {
      const res = await authFetch("/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signupCap }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to update the cap");
      return json;
    },
    onSuccess: () => {
      setCapInput(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await authFetch("/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { email: string; inviteUrl: string };
      };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to create invitation");
      return json.data;
    },
    onSuccess: (data) => {
      setInviteError(null);
      setInviteResult({ email: data.email, inviteUrl: data.inviteUrl });
      setInviteEmail("");
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err) => {
      setInviteResult(null);
      setInviteError(err instanceof Error ? err.message : "Failed to create invitation");
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/admin/waitlist/${id}/notify`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to send notification");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "emails"] });
    },
  });

  if (gate) return gate;

  const settings = settingsQuery.data;
  const queue = queueQuery.data ?? [];
  const waitingCount = queue.filter((row) => rowStatus(row).label === "Waiting").length;
  const capUsed = (settings?.currentUsers ?? 0) + (settings?.pendingInvitations ?? 0);
  const capRemaining = settings ? Math.max(0, settings.signupCap - capUsed) : 0;

  const columns: AdminColumn<QueueRow>[] = [
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <a href={`mailto:${row.email}`} style={{ color: "var(--color-on-surface)" }}>
          {row.email}
        </a>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => {
        const t = TYPE_LABELS[row.type];
        return (
          <span style={{
            display: "inline-block",
            padding: "2px var(--space-sm)",
            background: "var(--color-surface-container-high)",
            color: t.color,
            borderRadius: "var(--radius-sm)",
            fontSize: "0.75rem",
            fontWeight: 500,
          }}>
            {t.label}
          </span>
        );
      },
    },
    {
      key: "reason",
      header: "Use case / inviter",
      render: (row) => (
        <span
          title={row.reason ?? row.inviterEmail ?? ""}
          style={{
            display: "inline-block",
            maxWidth: 300,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: row.reason || row.inviterEmail ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
          }}
        >
          {row.reason ?? (row.inviterEmail ? `invited by ${row.inviterEmail}` : "—")}
        </span>
      ),
    },
    { key: "createdAt", header: "In line since", render: (row) => formatDate(row.createdAt) },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const status = rowStatus(row);
        return <span style={{ color: status.color, fontWeight: 500 }}>{status.label}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.type === "waitlist" && !row.registered ? (
          <button
            className="btn-secondary"
            disabled={notifyMutation.isPending}
            title="Email this person that a spot opened (they asked to be notified)"
            onClick={() => notifyMutation.mutate(row.id)}
            style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
          >
            {row.notifiedAt ? "Re-notify" : "Notify"}
          </button>
        ) : null,
    },
  ];

  return (
    <AdminLayout>
      <AdminPageHeader
        title="Signups"
        subtitle="The signup cap, the waitlist, and who's been invited in."
      />

      <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap", padding: "0 var(--space-lg)" }}>
        <AdminMetricCard
          label="Signup cap"
          value={settings ? `${capUsed} / ${settings.signupCap}` : "…"}
          hint={settings ? `${settings.currentUsers} verified + ${settings.pendingInvitations} reserved by invites` : undefined}
        />
        <AdminMetricCard
          label="Slots remaining"
          value={settings ? capRemaining : "…"}
          hint="Self-signups left before the waitlist kicks in"
        />
        <AdminMetricCard
          label="In line"
          value={queueQuery.data ? queue.length : "…"}
          hint={queueQuery.data ? `${waitingCount} still waiting` : undefined}
        />
      </div>

      <section style={{ padding: "var(--space-lg)" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "var(--space-sm)" }}>Signup cap</h2>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.875rem", marginBottom: "var(--space-md)", maxWidth: 640 }}>
          Verified users and pending member invitations count against the cap — a member
          invitation reserves a place at the top of the waitlist, it doesn't bypass it.
          Set to 0 to close self-signups entirely. After raising the cap, notify the
          longest-waiting entries below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = parseInt(capInput ?? "", 10);
            if (!Number.isNaN(next) && next >= 0) {
              updateCapMutation.mutate(next);
            }
          }}
          style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}
        >
          <input
            type="number"
            min={0}
            value={capInput ?? settings?.signupCap ?? ""}
            onChange={(e) => setCapInput(e.target.value)}
            style={{ width: 120 }}
            aria-label="Signup cap"
          />
          <button type="submit" disabled={capInput === null || updateCapMutation.isPending}>
            {updateCapMutation.isPending ? "Saving…" : "Save cap"}
          </button>
        </form>
        {updateCapMutation.isError ? (
          <p style={{ color: "var(--color-error)", fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>
            {updateCapMutation.error instanceof Error
              ? updateCapMutation.error.message
              : "Failed to update the cap"}
          </p>
        ) : null}
      </section>

      <section style={{ padding: "0 var(--space-lg) var(--space-lg)" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "var(--space-sm)" }}>Admin invite</h2>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.875rem", marginBottom: "var(--space-md)", maxWidth: 640 }}>
          Creates a full cap-bypass invitation. No email is sent — share the link
          through your own channel. Recipe-book membership can be granted separately
          once they're in.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (inviteEmail.trim()) inviteMutation.mutate(inviteEmail.trim());
          }}
          style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="person@example.com"
            style={{ width: 280 }}
            aria-label="Invite email"
          />
          <button type="submit" disabled={inviteMutation.isPending}>
            {inviteMutation.isPending ? "Creating…" : "Create invite link"}
          </button>
        </form>
        {inviteError ? (
          <p style={{ color: "var(--color-error)", fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>
            {inviteError}
          </p>
        ) : null}
        {inviteResult ? (
          <div style={{
            marginTop: "var(--space-md)",
            padding: "var(--space-md)",
            background: "var(--color-surface-container-low)",
            fontSize: "0.85rem",
            display: "flex",
            gap: "var(--space-sm)",
            alignItems: "center",
            flexWrap: "wrap",
          }}>
            <span style={{ color: "var(--color-on-surface-variant)" }}>
              Invite for <strong>{inviteResult.email}</strong> (expires in 7 days):
            </span>
            <code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{inviteResult.inviteUrl}</code>
            <button
              className="btn-secondary"
              style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
              onClick={() => {
                void navigator.clipboard.writeText(inviteResult.inviteUrl).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : null}
      </section>

      <section style={{ padding: "0 var(--space-lg) var(--space-lg)" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "var(--space-sm)" }}>Signup queue</h2>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.875rem", marginBottom: "var(--space-md)", maxWidth: 640 }}>
          Everyone in line: waitlist signups plus pending invitations. People holding an
          invitation are at the top; the rest are oldest first. Notify sends the
          "spot opened" email waitlist signups asked for.
        </p>
        <AdminTable
          rows={queue}
          columns={columns}
          rowKey={(row) => row.id}
          empty={
            <AdminEmptyState
              title="Nobody in line"
              body="When the signup cap is full, the login page collects waitlist emails here; pending invitations show here too."
            />
          }
        />
      </section>

    </AdminLayout>
  );
}
